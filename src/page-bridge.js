// page-bridge.js
// 繝壹・繧ｸ繧ｳ繝ｳ繝・く繧ｹ繝医〒蜍穂ｽ懶ｼ・ kintone.api 縺檎峩謗･菴ｿ縺医ｋ・・
(function () {
  if (window.__kfav_pageBridgeLoaded) return;
  window.__kfav_pageBridgeLoaded = true;

  const ORIGIN = location.origin;
const viewsCache = new Map(); // appId -> views
const fieldsCache = new Map(); // appId -> fields metadata cache
const appMetaCache = new Map(); // appId -> { name, raw }
const formLayoutCache = new Map(); // appId -> layout response
const PB_API_USAGE_EVENT = '__kfav_api_usage__';
const PB_DEBUG_FLAG_KEY = '__PB_DEBUG_API__';
const PB_DEBUG_DEFAULT = false;
const PB_DOM_METADATA_FALLBACK_FLAG_KEY = '__PB_ENABLE_DOM_METADATA_FALLBACK__';
const PB_DOM_METADATA_FALLBACK_DEFAULT = false;

function normalizeEndpointForTelemetry(path) {
  const raw = String(path || '').trim();
  if (!raw) return '';
  if (!raw.startsWith('/k/v1/')) return raw;
  if (raw.endsWith('.json')) return raw;
  return `${raw}.json`;
}

function getFormLayoutSessionKey(appId) {
  return `pb_form_layout_cache:${String(appId || '').trim()}`;
}

function loadFormLayoutFromSession(appId) {
  const key = String(appId || '').trim();
  if (!key) return null;
  try {
    const raw = window.sessionStorage?.getItem(getFormLayoutSessionKey(key));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch (_err) {
    return null;
  }
}

function saveFormLayoutToSession(appId, layout) {
  const key = String(appId || '').trim();
  if (!key || !layout || typeof layout !== 'object') return;
  try {
    window.sessionStorage?.setItem(getFormLayoutSessionKey(key), JSON.stringify(layout));
  } catch (_err) {
    // ignore storage failures
  }
}

function clearFormLayoutCache(appId) {
  const key = String(appId || '').trim();
  if (!key) return;
  formLayoutCache.delete(key);
  try {
    window.sessionStorage?.removeItem(getFormLayoutSessionKey(key));
  } catch (_err) {
    // ignore storage failures
  }
}

function normalizeApiMeta(meta = {}) {
  return {
    feature: String(meta?.feature || 'other').trim().toLowerCase() || 'other',
    trigger: String(meta?.trigger || 'unknown').trim().toLowerCase() || 'unknown',
    source: String(meta?.source || 'page_bridge').trim() || 'page_bridge',
    logGroup: String(meta?.logGroup || '').trim().toLowerCase() || '',
    cache: String(meta?.cache || '').trim().toLowerCase() || '',
    flow: String(meta?.flow || '').trim().toLowerCase() || ''
  };
}

function isPbDebugEnabled() {
  try {
    return PB_DEBUG_DEFAULT || Boolean(window?.[PB_DEBUG_FLAG_KEY]);
  } catch (_err) {
    return PB_DEBUG_DEFAULT;
  }
}

function pbDebug(message, extra) {
  if (!isPbDebugEnabled()) return;
  if (extra === undefined) {
    console.debug(message);
  } else {
    console.debug(message, extra);
  }
}

function isDomMetadataFallbackEnabled() {
  try {
    if (Boolean(window?.[PB_DOM_METADATA_FALLBACK_FLAG_KEY])) return true;
  } catch (_err) {
    // ignore
  }
  return PB_DOM_METADATA_FALLBACK_DEFAULT;
}

function logDomFallbackUsed(scope) {
  try {
    console.debug(`PB DOM fallback used: ${String(scope || 'unknown')}`);
  } catch (_err) {
    // ignore
  }
}

function emitApiUsage(payload) {
  try {
    window.postMessage({ [PB_API_USAGE_EVENT]: true, payload }, ORIGIN);
  } catch (_err) {
    // ignore telemetry emit failures
  }
}

function resolveRequestKind(endpoint) {
  const path = String(endpoint || '').trim().toLowerCase();
  if (path.includes('/records/acl/evaluate')) return 'acl';
  if (path.includes('/records')) return 'records';
  if (path.includes('/app/form/fields')) return 'metadata_fields';
  if (path.includes('/app/views')) return 'metadata_views';
  if (path.includes('/app.json')) return 'metadata_app';
  return 'rest';
}

function resolveApiCategory(feature) {
  const value = String(feature || '').trim().toLowerCase();
  if (value.startsWith('watchlist')) return 'watchlist';
  if (value.startsWith('overlay')) return 'overlay';
  if (value.startsWith('metadata') || value === 'bootstrap' || value === 'admin') return 'admin';
  if (value === 'record_pin') return 'record_pin';
  if (value === 'recent') return 'recent';
  return 'other';
}

function normalizeAppIdForBulk(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  if (!/^\d+$/.test(text)) return text;
  const normalized = String(Number(text));
  return normalized === 'NaN' ? text : normalized;
}

function cacheAppMeta(appId, payload) {
  const key = String(appId || '').trim();
  if (!key) return '';
  const name = String(payload?.name || payload?.app?.name || '').trim();
  const raw = payload && typeof payload === 'object' ? payload : undefined;
  if (!name && !raw) return '';
  appMetaCache.set(key, { name, raw });
  return name;
}

function getCachedAppName(appId) {
  const key = String(appId || '').trim();
  if (!key) return '';
  return String(appMetaCache.get(key)?.name || '').trim();
}

function resolveAppIdForApiSend(endpoint, payload) {
  if (Object.prototype.hasOwnProperty.call(payload || {}, 'app')) {
    return normalizeAppIdForBulk(payload?.app);
  }
  if (Object.prototype.hasOwnProperty.call(payload || {}, 'id')) {
    return normalizeAppIdForBulk(payload?.id);
  }
  return '';
}

async function callKintoneApi(path, method, payload, apiMeta = {}) {
  const sdk = window.kintone;
  if (!sdk?.api) throw new Error('kintone api unavailable');
  const meta = normalizeApiMeta(apiMeta);
  const endpoint = normalizeEndpointForTelemetry(path);
  const verb = String(method || 'GET').trim().toUpperCase() || 'GET';
  const requestKind = resolveRequestKind(endpoint);
  const appId = resolveAppIdForApiSend(endpoint, payload);
  const category = resolveApiCategory(meta.feature);
  pbDebug(
    `[API_SEND] endpoint=${endpoint} method=${verb} appId=${appId || '-'} category=${category} feature=${meta.feature} requestCount=1 cache=${meta.cache || 'miss'} flow=${meta.flow || 'main'} trigger=${meta.trigger}`
  );
  try {
    const response = await sdk.api(sdk.api.url(path, true), verb, payload);
    emitApiUsage({
      feature: meta.feature,
      endpoint,
      method: verb,
      trigger: meta.trigger,
      source: meta.source,
      ok: true,
      sent: true,
      requestCount: 1,
      requestKind
    });
    if (meta.logGroup) {
      const cacheText = meta.cache ? ` cache=${meta.cache}` : '';
      pbDebug(`[PB][${meta.logGroup}] endpoint=${endpoint} trigger=${meta.trigger}${cacheText}`);
    }
    return response;
  } catch (error) {
    emitApiUsage({
      feature: meta.feature,
      endpoint,
      method: verb,
      trigger: meta.trigger,
      source: meta.source,
      ok: false,
      sent: true,
      requestCount: 1,
      requestKind,
      error: String(error?.message || error || 'api_failed')
    });
    if (meta.logGroup) {
      pbDebug(
        `[PB][${meta.logGroup}] endpoint=${endpoint} trigger=${meta.trigger} error=${String(error?.message || error || 'api_failed')}`
      );
    }
    throw error;
  }
}

function logApiCache(meta, endpointPath, cacheState) {
  const normalized = normalizeApiMeta({ ...meta, cache: cacheState });
  if (!normalized.logGroup) return;
  const endpoint = normalizeEndpointForTelemetry(endpointPath);
  pbDebug(
    `[PB][${normalized.logGroup}] endpoint=${endpoint} trigger=${normalized.trigger} cache=${normalized.cache}`
  );
}

function normalizeChoiceList(prop) {
  if (!prop || typeof prop !== 'object' || !prop.options) return [];
  return Object.values(prop.options)
    .map((opt) => (opt && typeof opt === 'object' && opt.label ? String(opt.label) : ''))
    .filter((label) => label);
}

function normalizeLookupMeta(code, prop) {
  const src = prop && typeof prop === 'object' ? (prop.lookup || null) : null;
  if (!src || typeof src !== 'object') return undefined;
  const relatedAppRaw = src.relatedApp;
  const relatedApp = (typeof relatedAppRaw === 'string' || typeof relatedAppRaw === 'number')
    ? String(relatedAppRaw)
    : (relatedAppRaw && typeof relatedAppRaw === 'object'
      ? String(relatedAppRaw.app || relatedAppRaw.id || '')
      : '');
  const keyField = String(
    src.keyField
    || src.lookupField
    || src.relatedKeyField
    || src.fieldCode
    || ''
  ).trim();
  const out = {};
  if (keyField) out.keyField = keyField;
  if (relatedApp) out.relatedApp = relatedApp;
  return Object.keys(out).length ? out : undefined;
}

function normalizeSubtableMeta(prop) {
  const fieldsObj = prop && typeof prop === 'object' && prop.fields && typeof prop.fields === 'object'
    ? prop.fields
    : null;
  if (!fieldsObj) return undefined;
  const fields = Object.keys(fieldsObj).map((code, index) => {
    const child = fieldsObj[code] || {};
    const meta = {
      code,
      label: child.label || '',
      type: child.type || '',
      required: Boolean(child.required),
      choices: normalizeChoiceList(child),
      orderIndex: index
    };
    const lookup = normalizeLookupMeta(code, child);
    if (lookup) meta.lookup = lookup;
    return meta;
  });
  markLookupAutoFields(fieldsObj, fields);
  return { fields };
}

function normalizeFieldMetaFromProperties(properties) {
  if (!properties || typeof properties !== 'object') return [];
  const metas = Object.keys(properties).map((code) => {
    const prop = properties[code] || {};
    const meta = {
      code,
      label: prop.label || '',
      type: prop.type || '',
      required: Boolean(prop.required),
      choices: normalizeChoiceList(prop)
    };
    const lookup = normalizeLookupMeta(code, prop);
    if (lookup) meta.lookup = lookup;
    if (meta.type === 'SUBTABLE') {
      const subtable = normalizeSubtableMeta(prop);
      if (subtable) meta.subtable = subtable;
    }
    return meta;
  });
  markLookupAutoFields(properties, metas);
  return metas;
}

function collectLookupRelatedCodes(value, knownCodes, out) {
  if (!value) return;
  if (typeof value === 'string') {
    if (knownCodes.has(value)) out.add(value);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => collectLookupRelatedCodes(item, knownCodes, out));
    return;
  }
  if (typeof value === 'object') {
    Object.values(value).forEach((item) => collectLookupRelatedCodes(item, knownCodes, out));
  }
}

function markLookupAutoFields(properties, metas) {
  const knownCodes = new Set(Object.keys(properties || {}));
  if (!knownCodes.size) return;
  const metaMap = new Map((metas || []).map((meta) => [meta.code, meta]));
  Object.keys(properties || {}).forEach((sourceCode) => {
    const prop = properties[sourceCode] || {};
    const lookup = prop.lookup;
    if (!lookup || typeof lookup !== 'object') return;
    const keyField = String(
      lookup.keyField
      || lookup.lookupField
      || lookup.relatedKeyField
      || lookup.fieldCode
      || sourceCode
      || ''
    ).trim();
    const related = new Set();
    collectLookupRelatedCodes(lookup, knownCodes, related);
    related.delete(sourceCode);
    if (keyField) related.delete(keyField);
    related.forEach((targetCode) => {
      const target = metaMap.get(targetCode);
      if (!target) return;
      target.lookupAuto = true;
      if (!target.lookup || !target.lookup.keyField) {
        target.lookup = { ...(target.lookup || {}), keyField };
      }
    });
  });
}

  function pickAppNameFromDom() {
    const selectors = [
      '.gaia-argoui-app-index-appname span',
      '.gaia-argoui-app-index-toolbar-title span',
      '.gaia-argoui-app-title span',
      '[data-test-id="app-title-text"]',
      '[data-test-id="app-title"]'
    ];
    for (const selector of selectors) {
      try {
        const el = document.querySelector(selector);
        if (el && el.textContent) {
          const text = el.textContent.trim();
          if (text) return text;
        }
      } catch (_e) { /* ignore */ }
    }

    const docTitle = document.title || '';
    if (docTitle) {
      const parts = docTitle.split(' - ');
      if (parts.length) return parts[0].trim();
      return docTitle.trim();
    }
    return '';
  }

  function pickAppNameFromPayload(payload) {
    return String(payload?.name || payload?.app?.name || '').trim();
  }

  async function fetchAppJson(appId, apiMeta = {}) {
    const safeAppId = String(appId || '').trim();
    if (!safeAppId) throw new Error('appId is required');
    const meta = normalizeApiMeta({
      feature: 'metadata_app',
      logGroup: 'bootstrap',
      ...apiMeta
    });
    const response = await callKintoneApi('/k/v1/app.json', 'GET', { id: safeAppId }, meta);
    cacheAppMeta(safeAppId, response);
    return response;
  }

  async function getAppName(appId, options = {}) {
    const allowApi = options?.allowApi !== false;
    if (!appId) return '';
    try {
      if (typeof window.kintone?.app?.getName === 'function') {
        const fromRuntime = String(window.kintone.app.getName() || '').trim();
        if (fromRuntime) return fromRuntime;
      }
    } catch (_e) { /* ignore */ }
    const fromCache = getCachedAppName(appId);
    if (fromCache) return fromCache;
    if (!allowApi) return '';
    try {
      const resp = await fetchAppJson(appId, options?.apiMeta || {});
      const name = pickAppNameFromPayload(resp);
      if (name) return name;
    } catch (_e) { /* ignore */ }
    const fromDom = pickAppNameFromDom();
    if (fromDom) {
      logDomFallbackUsed('pickAppNameFromDom');
      return fromDom;
    }
    return '';
  }

  async function getAppMeta(appId, apiMeta = {}) {
    const cacheName = getCachedAppName(appId);
    if (cacheName) {
      const key = String(appId || '').trim();
      return {
        name: cacheName,
        raw: appMetaCache.get(key)?.raw
      };
    }
    const resp = await fetchAppJson(appId, apiMeta);
    cacheAppMeta(appId, resp);
    return {
      name: pickAppNameFromPayload(resp),
      raw: resp && typeof resp === 'object' ? resp : undefined
    };
  }

  async function getViews(appId, apiMeta = {}) {
    const meta = normalizeApiMeta({
      feature: 'metadata_views',
      logGroup: 'overlay',
      cache: 'miss',
      ...apiMeta
    });
    const resp = await callKintoneApi('/k/v1/app/views', 'GET', { app: String(appId) }, meta);
    return resp.views || {};
  }

  async function getFormLayout(appId, apiMeta = {}) {
    const key = String(appId || '').trim();
    if (!key) return {};
    const forceRefresh = Boolean(apiMeta?.forceRefresh);
    const meta = normalizeApiMeta({
      feature: 'overlay',
      logGroup: 'overlay',
      trigger: forceRefresh ? 'subtable_layout_manual_refresh' : (apiMeta?.trigger || 'subtable_modal_open'),
      source: String(apiMeta?.source || 'overlay'),
      ...apiMeta
    });

    if (forceRefresh) {
      clearFormLayoutCache(key);
    } else if (formLayoutCache.has(key)) {
      logApiCache(meta, '/k/v1/app/form/layout', 'hit-memory');
      const cached = formLayoutCache.get(key);
      return cached && typeof cached === 'object' ? cached : {};
    } else {
      const sessionCached = loadFormLayoutFromSession(key);
      if (sessionCached) {
        formLayoutCache.set(key, sessionCached);
        logApiCache(meta, '/k/v1/app/form/layout', 'hit-session');
        return sessionCached;
      }
    }

    logApiCache(meta, '/k/v1/app/form/layout', forceRefresh ? 'manual-refresh' : 'miss');
    const resp = await callKintoneApi('/k/v1/app/form/layout', 'GET', { app: key }, meta);
    const layout = resp && typeof resp === 'object' ? resp : {};
    formLayoutCache.set(key, layout);
    saveFormLayoutToSession(key, layout);
    return layout;
  }

  async function getViewsCached(appId, apiMeta = {}) {
    const key = String(appId);
    if (viewsCache.has(key)) {
      logApiCache(
        { feature: 'metadata_views', logGroup: 'overlay', ...apiMeta },
        '/k/v1/app/views',
        'hit'
      );
      return viewsCache.get(key) || {};
    }
    logApiCache(
      { feature: 'metadata_views', logGroup: 'overlay', ...apiMeta },
      '/k/v1/app/views',
      'miss'
    );
    viewsCache.set(key, await getViews(appId, { ...apiMeta, cache: 'miss' }));
    return viewsCache.get(key) || {};
  }

  async function getFields(appId, apiMeta = {}) {
    const key = String(appId || '');
    if (!key) return [];
    if (fieldsCache.has(key)) {
      logApiCache(
        { feature: 'metadata_fields', logGroup: 'overlay', ...apiMeta },
        '/k/v1/app/form/fields',
        'hit'
      );
      return fieldsCache.get(key).map((field) => ({ ...field }));
    }

    logApiCache(
      { feature: 'metadata_fields', logGroup: 'overlay', ...apiMeta },
      '/k/v1/app/form/fields',
      'miss'
    );
    const fields = await fetchFieldsWithFallback(key, apiMeta);
    fieldsCache.set(key, fields);
    return fields.map((field) => ({ ...field }));
  }

  async function getFieldsMeta(appId, apiMeta = {}) {
    const key = String(appId || '');
    if (!key) return [];
    const sdk = window.kintone;
    if (!sdk?.api) return [];
    try {
      const meta = normalizeApiMeta({
        feature: 'metadata_fields',
        logGroup: 'overlay',
        ...apiMeta
      });
      const resp = await callKintoneApi('/k/v1/app/form/fields', 'GET', { app: key }, meta);
      return normalizeFieldMetaFromProperties(resp?.properties || {});
    } catch (error) {
      if (typeof console !== 'undefined' && console.warn) {
        console.warn('[kintone-favorites] getFieldsMeta failed via form API, falling back to getFields', error);
      }
      const fallback = await getFields(key);
      return fallback.map((field) => ({
        code: field.code,
        label: field.label || '',
        type: field.type || '',
        required: false,
        choices: Array.isArray(field.choices) ? field.choices : []
      }));
    }
  }

  async function getFieldsMetaBundle(appId, apiMeta = {}) {
    const key = String(appId || '');
    if (!key) return { normalized: [], raw: {} };
    const sdk = window.kintone;
    if (!sdk?.api) return { normalized: [], raw: {} };
    try {
      const meta = normalizeApiMeta({
        feature: 'metadata_fields',
        logGroup: 'overlay',
        ...apiMeta
      });
      const resp = await callKintoneApi('/k/v1/app/form/fields', 'GET', { app: key }, meta);
      const raw = resp && typeof resp === 'object' ? resp : {};
      return {
        normalized: normalizeFieldMetaFromProperties(raw?.properties || {}),
        raw
      };
    } catch (error) {
      if (typeof console !== 'undefined' && console.warn) {
        console.warn('[kintone-favorites] getFieldsMetaBundle failed via form API, falling back to getFields', error);
      }
      const fallback = await getFields(key);
      return {
        normalized: fallback.map((field) => ({
          code: field.code,
          label: field.label || '',
          type: field.type || '',
          required: false,
          choices: Array.isArray(field.choices) ? field.choices : []
        })),
        raw: {}
      };
    }
  }

  async function fetchFieldsWithFallback(appId, apiMeta = {}) {
    const sdk = window.kintone;
    if (!sdk?.api) return [];
    try {
      // 繧｢繝励Μ縺ｮ繝輔ぅ繝ｼ繝ｫ繝牙ｮ夂ｾｩ繧貞叙蠕暦ｼ域ｨｩ髯舌′縺ｪ縺・ｴ蜷医・萓句､問・蜻ｼ縺ｳ蜃ｺ縺怜・縺ｧ繝輔か繝ｼ繝ｫ繝舌ャ繧ｯ・・
      const meta = normalizeApiMeta({
        feature: 'metadata_fields',
        logGroup: 'overlay',
        ...apiMeta
      });
      const resp = await callKintoneApi('/k/v1/app/form/fields', 'GET', { app: String(appId) }, meta);
      // 霑泌唆: { code, label, type } 縺ｮ驟榊・
      const props = resp?.properties || {};
      return Object.keys(props).map((code) => ({
        code,
        label: props[code].label || '',
        type: props[code].type || '',
        choices: normalizeChoiceList(props[code])
      }));
    } catch (error) {
      if (typeof console !== 'undefined' && console.warn) {
        console.warn('[kintone-favorites] getFields failed via form API, falling back to records API', error);
      }
      const fallback = await fetchFieldsFromRecords(appId, {
        ...apiMeta,
        skipRestFieldLabelLookup: true
      });
      if (fallback.length) return fallback;
      throw error;
    }
  }

  function collectFieldLabelsFromDom() {
    logDomFallbackUsed('collectFieldLabelsFromDom');
    const labels = new Map();
    const selectors = [
      'th[data-field-code]',
      '[role="columnheader"][data-field-code]'
    ];
    for (const selector of selectors) {
      try {
        const nodes = document.querySelectorAll(selector);
        nodes.forEach((node) => {
          const code = node?.getAttribute?.('data-field-code');
          if (!code || labels.has(code)) return;
          const text = (node.textContent || '').trim();
          if (text) labels.set(code, text);
        });
      } catch (_e) {
        // ignore selector errors
      }
    }
    return labels;
  }

  function collectViewColumnsFromDom() {
    logDomFallbackUsed('collectViewColumnsFromDom');
    const columns = [];
    const selectors = [
      'thead th[data-field-code]',
      '[role="columnheader"][data-field-code]',
      'th[data-field-code]'
    ];
    const seen = new Set();
    for (const selector of selectors) {
      try {
        const nodes = document.querySelectorAll(selector);
        nodes.forEach((node) => {
          const code = String(node?.getAttribute?.('data-field-code') || '').trim();
          if (!code) return;
          const rawIndex = typeof node.cellIndex === 'number'
            ? node.cellIndex
            : Array.from(node.parentElement?.children || []).indexOf(node);
          const key = `${rawIndex}:${code}`;
          if (seen.has(key)) return;
          const label = String(node.textContent || '').trim();
          columns.push({
            index: rawIndex >= 0 ? rawIndex : columns.length,
            fieldCode: code,
            label
          });
          seen.add(key);
        });
        if (columns.length) break;
      } catch (_e) {
        // ignore selector errors
      }
    }
    return columns;
  }

  async function getFieldLabelMapByPriority(appId, apiMeta = {}) {
    const appKey = String(appId || '').trim();
    const skipRest = Boolean(apiMeta?.skipRestFieldLabelLookup);
    if (!appKey) return new Map();

    const cachedFields = fieldsCache.get(appKey);
    if (Array.isArray(cachedFields) && cachedFields.length) {
      const labelMapFromCache = new Map();
      cachedFields.forEach((field) => {
        const code = String(field?.code || '').trim();
        const label = String(field?.label || '').trim();
        if (code && label && !labelMapFromCache.has(code)) labelMapFromCache.set(code, label);
      });
      if (labelMapFromCache.size) return labelMapFromCache;
    }

    if (!skipRest) {
      try {
        const meta = normalizeApiMeta({
          feature: 'metadata_fields',
          logGroup: 'overlay',
          ...apiMeta
        });
        const resp = await callKintoneApi('/k/v1/app/form/fields', 'GET', { app: appKey }, meta);
        const normalized = normalizeFieldMetaFromProperties(resp?.properties || {});
        if (normalized.length) {
          fieldsCache.set(appKey, normalized);
          const labelMapFromRest = new Map();
          normalized.forEach((field) => {
            const code = String(field?.code || '').trim();
            const label = String(field?.label || '').trim();
            if (code && label && !labelMapFromRest.has(code)) labelMapFromRest.set(code, label);
          });
          if (labelMapFromRest.size) return labelMapFromRest;
        }
      } catch (_err) {
        // fall through to debug fallback
      }
    }

    if (isDomMetadataFallbackEnabled()) {
      return collectFieldLabelsFromDom();
    }
    return new Map();
  }

  async function fetchFieldsFromRecords(appId, apiMeta = {}) {
    const sdk = window.kintone;
    if (!sdk?.api) return [];
    try {
      const params = {
        app: String(appId),
        query: 'limit 1',
        totalCount: false
      };
      const meta = normalizeApiMeta({
        feature: 'metadata_fields',
        logGroup: 'overlay',
        ...apiMeta
      });
      const resp = await callKintoneApi('/k/v1/records', 'GET', params, meta);
      const firstRecord = Array.isArray(resp?.records) && resp.records.length ? resp.records[0] : null;
      if (!firstRecord) return [];
      const labels = await getFieldLabelMapByPriority(appId, apiMeta);
      const fields = [];
      for (const [code, meta] of Object.entries(firstRecord)) {
        if (!code || code.startsWith('$')) continue;
        if (!meta || typeof meta !== 'object' || !meta.type) continue;
        fields.push({
          code,
          label: labels.get(code) || '',
          type: meta.type,
          choices: []
        });
      }
      return fields;
    } catch (fallbackError) {
      if (typeof console !== 'undefined' && console.warn) {
        console.warn('[kintone-favorites] getFields fallback via records API failed', fallbackError);
      }
      return [];
    }
  }

  const EDITABLE_TYPES = new Set([
    'SINGLE_LINE_TEXT',
    'MULTI_LINE_TEXT',
    'NUMBER',
    'DATE',
    'LINK',
    'RADIO_BUTTON',
    'DROP_DOWN',
    'CHECK_BOX',
    'MULTI_SELECT',
    'CALC',
    'RICH_TEXT',
    'SUBTABLE',
    'LOOKUP'
  ]);

  function extractQueryFromViews(viewsObj, viewIdOrName) {
    const entries = Object.entries(viewsObj || {});
    const byId = entries.find(([, v]) => String(v.id) === String(viewIdOrName));
    if (byId) return (byId[1].filterCond || '') + (byId[1].sort ? ` order by ${byId[1].sort}` : '');
    const byName = entries.find(([name]) => name === viewIdOrName);
    if (byName) {
      const v = byName[1];
      return (v.filterCond || '') + (v.sort ? ` order by ${v.sort}` : '');
    }

    return '';
  }

  function filterCondFromViews(viewsObj, viewIdOrName) {
    const entries = Object.entries(viewsObj || {});
    const byId = entries.find(([, v]) => String(v.id) === String(viewIdOrName));
    if (byId) return byId[1].filterCond || '';
    const byName = entries.find(([name]) => name === viewIdOrName);
    if (byName) return byName[1].filterCond || '';
    return '';
  }

  function combineQuery(base, extra) {
    const A = (base || '').trim();
    const B = (extra || '').trim();
    if (A && B) return `${A} and (${B})`;
    return A || B || '';
  }

  function splitQueryParts(query) {
    const original = String(query || '');
    const lower = original.toLowerCase();
    const markers = [];
    const orderIndex = lower.indexOf(' order by ');
    if (orderIndex >= 0) markers.push(orderIndex);
    const limitIndex = lower.indexOf(' limit ');
    if (limitIndex >= 0) markers.push(limitIndex);
    const offsetIndex = lower.indexOf(' offset ');
    if (offsetIndex >= 0) markers.push(offsetIndex);
    if (!markers.length) {
      return { filter: original.trim(), trailing: '' };
    }
    const first = Math.min(...markers);
    const filter = original.slice(0, first).trim();
    const trailing = original.slice(first).trim();
    return { filter, trailing };
  }

  function hasOrderClause(query) {
    return /\border\s+by\b/i.test(query || '');
  }

  function extractColumnOrder(view) {
    const order = [];
    if (!view) return order;
    if (Array.isArray(view.columns)) {
      view.columns.forEach((col) => {
        if (!col) return;
        let code = null;
        if (typeof col === 'string') {
          code = col;
        } else if (col && typeof col === 'object') {
          if (col.field) code = col.field;
          else if (col.code) code = col.code;
          else if (col.id) code = col.id;
        }
        if (code && !order.includes(code)) order.push(code);
      });
    }
    if (!order.length && Array.isArray(view.fields)) {
      view.fields.forEach((col) => {
        if (!col) return;
        let code = null;
        if (typeof col === 'string') {
          code = col;
        } else if (col && typeof col === 'object') {
          if (col.field) code = col.field;
          else if (col.code) code = col.code;
          else if (col.id) code = col.id;
        }
        if (code && !order.includes(code)) order.push(code);
      });
    }
    if (!order.length && Array.isArray(view.layout)) {
      view.layout.forEach((row) => {
        if (!row || typeof row !== 'object') return;
        if (Array.isArray(row.fields)) {
          row.fields.forEach((field) => {
            if (!field) return;
            let code = null;
            if (typeof field === 'string') {
              code = field;
            } else if (field && typeof field === 'object') {
              if (field.field) code = field.field;
              else if (field.code) code = field.code;
              else if (field.id) code = field.id;
            }
            if (code && !order.includes(code)) order.push(code);
          });
        }
      });
    }
    return order;
  }

  function getCurrentViewIdFromUrl() {
    try {
      const url = new URL(location.href);
      return String(url.searchParams.get('view') || '').trim();
    } catch (_err) {
      return '';
    }
  }

  function pickCurrentViewFromViews(viewsObj, preferredViewId = '') {
    const entries = Object.entries(viewsObj || {});
    let selectedView = null;
    let selectedViewName = '';
    const viewId = String(preferredViewId || '').trim();
    if (viewId) {
      const found = entries.find(([, v]) => String(v?.id || '') === viewId);
      if (found) {
        selectedView = found[1];
        selectedViewName = found[0];
      }
    }
    if (!selectedView) {
      const currentName = typeof window.kintone?.app?.getViewName === 'function'
        ? String(window.kintone.app.getViewName() || '').trim()
        : '';
      if (currentName && viewsObj?.[currentName]) {
        selectedView = viewsObj[currentName];
        selectedViewName = currentName;
      }
    }
    if (!selectedView && entries.length) {
      selectedView = entries[0][1];
      selectedViewName = entries[0][0];
    }
    return { selectedView, selectedViewName };
  }

  async function buildDevViewMeta(appId, viewId = '') {
    const app = String(appId || '').trim();
    if (!app) return { viewId: '', viewName: '', columns: [] };
    const views = await getViewsCached(app);
    const chosen = pickCurrentViewFromViews(views, viewId || getCurrentViewIdFromUrl());
    const selectedView = chosen.selectedView;
    const selectedViewName = chosen.selectedViewName;
    const fieldOrder = extractColumnOrder(selectedView);

    let fieldLabelMap = new Map();
    try {
      const fields = await getFields(app);
      fieldLabelMap = new Map(fields.map((field) => [field.code, field.label || '']));
    } catch (_err) {
      // ignore
    }
    const columnsFromView = fieldOrder.map((code, index) => ({
      index,
      fieldCode: String(code || ''),
      label: String(fieldLabelMap.get(code) || '')
    }));
    let columns = columnsFromView;
    if (!columns.length && isDomMetadataFallbackEnabled()) {
      columns = collectViewColumnsFromDom().map((column, index) => ({
        index: Number.isInteger(column.index) ? column.index : index,
        fieldCode: String(column.fieldCode || ''),
        label: String(column.label || fieldLabelMap.get(column.fieldCode) || '')
      }));
    }
    return {
      viewId: selectedView?.id ? String(selectedView.id) : '',
      viewName: selectedViewName || '',
      columns
    };
  }

  async function countRecords(appId, query, apiMeta = {}) {
    const params = { app: String(appId), totalCount: true, size: 1 };
    if (query && query.trim()) params.query = query;
    const resp = await callKintoneApi('/k/v1/records', 'GET', params, {
      feature: 'watchlist',
      trigger: 'watchlist_refresh',
      logGroup: 'watchlist',
      ...apiMeta
    });
    return parseInt(resp.totalCount || '0', 10);
  }

  async function countRecordsBulk(entries, apiMeta = {}) {
    const normalizedEntries = (Array.isArray(entries) ? entries : [])
      .map((entry) => ({
        id: String(entry?.id || '').trim(),
        appId: normalizeAppIdForBulk(entry?.appId),
        query: String(entry?.query || '').trim()
      }))
      .filter((entry) => entry.id && entry.appId);
    const counts = {};
    const errors = {};
    if (!normalizedEntries.length) return { counts, errors };
    const trigger = String(apiMeta?.trigger || 'watchlist_refresh');
    const source = String(apiMeta?.source || 'watchlist');
    const logGroup = String(apiMeta?.logGroup || 'watchlist');
    const flow = String(apiMeta?.flow || 'parallel_get');
    const results = await Promise.all(
      normalizedEntries.map(async (entry) => {
        try {
          const count = await countRecords(entry.appId, entry.query, {
            feature: 'watchlist',
            trigger,
            source,
            logGroup,
            flow
          });
          if (!Number.isFinite(count)) {
            return { id: entry.id, count: null, error: 'missing_total_count' };
          }
          return { id: entry.id, count };
        } catch (error) {
          return { id: entry.id, count: null, error: String(error?.message || error) };
        }
      })
    );
    results.forEach((result) => {
      if (!result?.id) return;
      counts[result.id] = result.count;
      if (result.error) {
        errors[result.id] = result.error;
      }
    });
    return { counts, errors };
  }

  function normalizePermissionState(value, fallback = 'unknown') {
    if (value === 'allow' || value === 'deny' || value === 'unknown') return value;
    if (typeof value === 'boolean') return value ? 'allow' : 'deny';
    if (typeof value === 'number') return value !== 0 ? 'allow' : 'deny';
    if (typeof value === 'string') {
      const normalized = value.trim().toLowerCase();
      if (!normalized) return fallback;
      if (['allow', 'allowed', 'true', '1', 'yes', 'read', 'write', 'grant', 'granted'].includes(normalized)) return 'allow';
      if (['deny', 'denied', 'false', '0', 'no', 'none', 'forbidden'].includes(normalized)) return 'deny';
      if (['unknown', 'unresolved'].includes(normalized)) return 'unknown';
      return fallback;
    }
    return fallback;
  }

  function normalizeRightSet(raw, fallback = { view: 'unknown', add: 'unknown', edit: 'unknown', delete: 'unknown', source: 'unknown' }) {
    const source = raw && typeof raw === 'object' ? raw : {};
    const view = normalizePermissionState(
      source.view ?? source.read ?? source.browse ?? source.canView ?? source.isViewable,
      fallback.view
    );
    const add = normalizePermissionState(
      source.add ?? source.create ?? source.write ?? source.canAdd ?? source.canCreate,
      fallback.add
    );
    const edit = normalizePermissionState(
      source.edit ?? source.update ?? source.write ?? source.canEdit ?? source.canUpdate,
      fallback.edit
    );
    const del = normalizePermissionState(
      source.delete ?? source.remove ?? source.canDelete ?? source.canRemove,
      fallback.delete
    );
    let sourceState = fallback.source || 'unknown';
    if (source.source === 'api' || source.source === 'fallback' || source.source === 'unknown') {
      sourceState = source.source;
    } else if (view !== 'unknown' || add !== 'unknown' || edit !== 'unknown' || del !== 'unknown') {
      sourceState = 'api';
    }
    return {
      view,
      add,
      edit,
      delete: del,
      source: sourceState
    };
  }

  function emptyRecordPermissionMap(ids) {
    const out = {};
    (ids || []).forEach((id) => {
      const key = String(id || '').trim();
      if (!key) return;
      out[key] = { view: 'unknown', edit: 'unknown', delete: 'unknown', source: 'unknown' };
    });
    return out;
  }

  function pickAppPermissionCandidate(resp) {
    if (!resp || typeof resp !== 'object') return null;
    const candidates = [
      resp.permissions,
      resp.permission,
      resp.rights,
      resp.acl,
      resp.appPermissions,
      resp.result
    ];
    for (const candidate of candidates) {
      if (candidate && typeof candidate === 'object' && !Array.isArray(candidate)) {
        return candidate;
      }
    }
    return null;
  }

  function pickRecordPermissionEntries(resp) {
    if (!resp || typeof resp !== 'object') return [];
    const candidates = [
      resp.records,
      resp.permissions,
      resp.results,
      resp.items
    ];
    for (const candidate of candidates) {
      if (Array.isArray(candidate)) return candidate;
      if (candidate && typeof candidate === 'object') {
        if (Array.isArray(candidate.records)) return candidate.records;
        if (Array.isArray(candidate.items)) return candidate.items;
        if (Array.isArray(candidate.results)) return candidate.results;
      }
    }
    return [];
  }

  async function fetchAppPermissions(appId, apiMeta = {}) {
    const fallback = { view: 'unknown', add: 'unknown', edit: 'unknown', delete: 'unknown', source: 'unknown' };
    const sdk = window.kintone;
    if (!sdk?.api) return fallback;
    const app = String(appId || '').trim();
    if (!app) return fallback;

    const attempts = [
      { path: '/k/v1/app/acl/evaluate', method: 'POST', payload: { app } },
      { path: '/k/v1/app/permissions', method: 'GET', payload: { app } },
      { path: '/k/v1/app/acl', method: 'GET', payload: { app } }
    ];

    for (const attempt of attempts) {
      try {
        const resp = await callKintoneApi(attempt.path, attempt.method, attempt.payload, {
          feature: 'overlay_acl',
          trigger: 'acl_check',
          logGroup: 'overlay',
          ...apiMeta
        });
        console.debug('[excel-permission-api]', {
          appId: app,
          type: 'app',
          path: attempt.path,
          result: resp
        });
        const candidate = pickAppPermissionCandidate(resp) || resp;
        return normalizeRightSet(candidate, { view: 'unknown', add: 'unknown', edit: 'unknown', delete: 'unknown', source: 'api' });
      } catch (_err) {
        // try next
      }
    }
    console.debug('[excel-permission-api]', {
      appId: app,
      type: 'app',
      result: 'fallback_unknown'
    });
    return fallback;
  }

  async function fetchRecordPermissions(appId, ids, apiMeta = {}) {
    const idList = (ids || []).map((id) => String(id || '').trim()).filter(Boolean);
    const fallback = emptyRecordPermissionMap(idList);
    const sdk = window.kintone;
    if (!sdk?.api) return fallback;
    const app = String(appId || '').trim();
    if (!app || !idList.length) return fallback;

    const attempts = [
      { path: '/k/v1/records/acl/evaluate', method: 'POST', payload: { app, ids: idList } },
      { path: '/k/v1/records/permissions', method: 'GET', payload: { app, ids: idList } }
    ];

    for (const attempt of attempts) {
      try {
        const resp = await callKintoneApi(attempt.path, attempt.method, attempt.payload, {
          feature: 'overlay_acl',
          trigger: 'acl_check',
          logGroup: 'overlay',
          ...apiMeta
        });
        console.debug('[excel-permission-api]', {
          appId: app,
          type: 'record',
          path: attempt.path,
          ids: idList,
          result: resp
        });
        const entries = pickRecordPermissionEntries(resp);
        if (!entries.length) continue;
        const out = { ...fallback };
        entries.forEach((entry) => {
          const id = String(entry?.id ?? entry?.recordId ?? entry?.record ?? '').trim();
          if (!id) return;
          const raw = entry?.permissions || entry?.permission || entry?.rights || entry;
          const normalized = normalizeRightSet(raw, { view: 'unknown', add: 'unknown', edit: 'unknown', delete: 'unknown', source: 'api' });
          out[id] = {
            view: normalized.view,
            edit: normalized.edit,
            delete: normalized.delete,
            source: normalized.source || 'api'
          };
        });
        return out;
      } catch (_err) {
        // try next
      }
    }
    console.debug('[excel-permission-api]', {
      appId: app,
      type: 'record',
      ids: idList,
      result: 'fallback_unknown'
    });
    return fallback;
  }

  async function fetchEvaluatedRecordAcl(appId, ids, apiMeta = {}) {
    const idList = (ids || []).map((id) => String(id || '').trim()).filter(Boolean);
    if (!idList.length) return [];
    const sdk = window.kintone;
    if (!sdk?.api) return [];
    const app = String(appId || '').trim();
    if (!app) return [];
    const resp = await callKintoneApi(
      '/k/v1/records/acl/evaluate.json',
      'GET',
      { app, ids: idList },
      {
        feature: 'overlay_acl',
        trigger: 'acl_check',
        logGroup: 'overlay',
        ...apiMeta
      }
    );
    console.debug('[excel-permission-api]', {
      appId: app,
      type: 'record_acl_evaluate',
      ids: idList,
      result: resp
    });
    if (Array.isArray(resp?.rights)) return resp.rights;
    if (Array.isArray(resp?.records)) return resp.records;
    return [];
  }

  function tzOffsetStr(d) {
    // "+09:00" 縺ｮ繧医≧縺ｪ陦ｨ險倥ｒ霑斐☆
    const offMin = -d.getTimezoneOffset(); // JS縺ｯ縲袈TC縺九ｉ縺ｮ蟾ｮ縲阪ｒ騾・ｬｦ蜿ｷ縺ｧ霑斐☆
    const sign = offMin >= 0 ? '+' : '-';
    const a = Math.abs(offMin);
    const hh = String(Math.floor(a / 60)).padStart(2, '0');
    const mm = String(a % 60).padStart(2, '0');
    return `${sign}${hh}:${mm}`;
  }

  window.addEventListener('message', async (ev) => {
    if (ev.origin !== ORIGIN) return;
    const msg = ev.data || {};
    if (!msg || msg.__kfav__ !== true) return;

    const { id, type, payload } = msg;

    try {
      if (type === 'EXCEL_GET_APP_CONTEXT') {
        const appId = window.kintone?.app?.getId?.();
        const query = window.kintone?.app?.getQuery?.() || '';
        let appName = '';
        if (appId) {
          appName = await getAppName(appId, { allowApi: false });
        }
        window.postMessage({ __kfav__: true, replyTo: id, ok: true, appId, query, appName }, ORIGIN);
        return;
      }

      if (type === 'META_GET_APP') {
        const appId = String(payload?.appId || '').trim();
        if (!appId) throw new Error('appId is required');
        const source = String(payload?.source || 'metadata_bundle');
        const feature = source.includes('launcher') ? 'bootstrap' : 'metadata_app';
        const app = await getAppMeta(appId, {
          feature,
          trigger: String(payload?.trigger || 'panel_open'),
          source,
          logGroup: 'bootstrap'
        });
        window.postMessage({ __kfav__: true, replyTo: id, ok: true, app }, ORIGIN);
        return;
      }

      if (type === 'META_GET_VIEWS') {
        const appId = String(payload?.appId || '').trim();
        if (!appId) throw new Error('appId is required');
        const views = await getViews(appId, {
          feature: 'metadata_views',
          trigger: String(payload?.trigger || 'overlay_open'),
          source: String(payload?.source || 'metadata_bundle'),
          logGroup: 'overlay'
        });
        window.postMessage({ __kfav__: true, replyTo: id, ok: true, views }, ORIGIN);
        return;
      }

      if (type === 'META_GET_FIELDS') {
        const appId = String(payload?.appId || '').trim();
        if (!appId) throw new Error('appId is required');
        const fields = await getFieldsMetaBundle(appId, {
          feature: 'metadata_fields',
          trigger: String(payload?.trigger || 'overlay_open'),
          source: String(payload?.source || 'metadata_bundle'),
          logGroup: 'overlay'
        });
        window.postMessage({ __kfav__: true, replyTo: id, ok: true, fields }, ORIGIN);
        return;
      }

      if (type === 'EXCEL_GET_LOGIN_USER') {
        const user = typeof window.kintone?.getLoginUser === 'function' ? window.kintone.getLoginUser() : null;
        if (!user) throw new Error('Could not retrieve login user');
        window.postMessage({
          __kfav__: true,
          replyTo: id,
          ok: true,
          user: { language: user.language || '' }
        }, ORIGIN);
        return;
      }

      if (type === 'CHECK_KINTONE_READY') {
        const ready = typeof window.kintone?.api === 'function';
        let appId = '';
        if (ready && typeof window.kintone?.app?.getId === 'function') {
          appId = window.kintone.app.getId() || '';
        }
        let language = '';
        if (ready && typeof window.kintone?.getLoginUser === 'function') {
          try {
            language = window.kintone.getLoginUser()?.language || '';
          } catch (_e) {}
        }
        window.postMessage({
          __kfav__: true,
          replyTo: id,
          ok: true,
          ready,
          appId,
          language
        }, ORIGIN);
        return;
      }

      if (type === 'DEV_GET_LIST_CONTEXT') {
        const appId = typeof window.kintone?.app?.getId === 'function'
          ? String(window.kintone.app.getId() || '')
          : '';
        const viewId = getCurrentViewIdFromUrl();
        const viewName = typeof window.kintone?.app?.getViewName === 'function'
          ? String(window.kintone.app.getViewName() || '')
          : '';
        let query = '';
        try {
          query = typeof window.kintone?.app?.getQuery === 'function'
            ? String(window.kintone.app.getQuery() || '').trim()
            : '';
        } catch (_err) {
          query = '';
        }
        if (!query && appId) {
          try {
            const views = await getViewsCached(appId);
            const fallbackQuery = extractQueryFromViews(views, viewId || viewName);
            query = String(fallbackQuery || '').trim();
          } catch (_err) {
            // ignore
          }
        }
        if (!query) {
          try {
            const url = new URL(location.href);
            query = String(url.searchParams.get('query') || '').trim();
          } catch (_err) {
            // ignore
          }
        }
        window.postMessage({
          __kfav__: true,
          replyTo: id,
          ok: true,
          appId,
          viewId,
          viewName,
          query,
          url: location.href,
          title: document.title || ''
        }, ORIGIN);
        return;
      }

      if (type === 'DEV_GET_VIEW_META') {
        const appId = String(
          payload?.appId
          || (typeof window.kintone?.app?.getId === 'function' ? window.kintone.app.getId() : '')
          || ''
        ).trim();
        const viewId = String(payload?.viewId || '').trim();
        const meta = await buildDevViewMeta(appId, viewId);
        window.postMessage({
          __kfav__: true,
          replyTo: id,
          ok: true,
          appId,
          ...meta
        }, ORIGIN);
        return;
      }

      if (type === 'EXCEL_GET_FIELDS') {
        const appId = payload?.appId;
        if (!appId) throw new Error('appId is required');
        const fields = await getFields(appId);
        const editable = fields.filter(f => EDITABLE_TYPES.has(f.type));
        window.postMessage({ __kfav__: true, replyTo: id, ok: true, fields: editable }, ORIGIN);
        return;
      }

      if (type === 'EXCEL_GET_FIELDS_META') {
        const appId = payload?.appId;
        if (!appId) throw new Error('appId is required');
        const fieldsMeta = await getFieldsMeta(appId, {
          feature: 'metadata_fields',
          trigger: String(payload?.__pbTrigger || payload?.trigger || 'overlay_open'),
          source: 'overlay'
        });
        window.postMessage({ __kfav__: true, replyTo: id, ok: true, fieldsMeta }, ORIGIN);
        return;
      }

      if (type === 'EXCEL_GET_FORM_LAYOUT') {
        const appId = payload?.appId;
        if (!appId) throw new Error('appId is required');
        const layout = await getFormLayout(appId, {
          feature: 'overlay',
          trigger: String(payload?.__pbTrigger || payload?.trigger || 'subtable_modal_open'),
          source: 'overlay',
          forceRefresh: Boolean(payload?.forceRefresh)
        });
        window.postMessage({ __kfav__: true, replyTo: id, ok: true, layout }, ORIGIN);
        return;
      }

      if (type === 'EXCEL_GET_RECORDS') {
        const appId = payload?.appId;
        if (!appId) throw new Error('appId is required');
        const fields = Array.isArray(payload?.fields) ? payload.fields.filter(Boolean) : [];
        const params = {
          app: String(appId),
          fields: Array.from(new Set(['$id', '$revision'].concat(fields))),
          totalCount: true
        };
        const query = String(payload?.query || '');
        if (query.trim()) params.query = query.trim();
        const resp = await callKintoneApi('/k/v1/records', 'GET', params, {
          feature: 'overlay_records',
          trigger: String(payload?.__pbTrigger || payload?.trigger || 'overlay_open'),
          source: 'overlay',
          logGroup: 'overlay'
        });
        window.postMessage({
          __kfav__: true,
          replyTo: id,
          ok: true,
          records: resp.records || [],
          totalCount: typeof resp.totalCount === 'number' ? resp.totalCount : Number(resp.totalCount || 0)
        }, ORIGIN);
        return;
      }

      if (type === 'EXCEL_GET_RECORDS_BY_IDS') {
        const appId = payload?.appId;
        const ids = Array.isArray(payload?.ids) ? payload.ids.filter(Boolean) : [];
        if (!appId) throw new Error('appId is required');
        if (!ids.length) {
          window.postMessage({ __kfav__: true, replyTo: id, ok: true, records: [] }, ORIGIN);
          return;
        }
        const fields = Array.isArray(payload?.fields) ? payload.fields.filter(Boolean) : [];
        const params = {
          app: String(appId),
          ids: ids.map(String),
          fields: Array.from(new Set(['$id', '$revision'].concat(fields)))
        };
        const resp = await callKintoneApi('/k/v1/records', 'GET', params, {
          feature: 'overlay_records',
          trigger: String(payload?.__pbTrigger || payload?.trigger || 'save_refetch'),
          source: 'overlay',
          logGroup: 'overlay'
        });
        window.postMessage({ __kfav__: true, replyTo: id, ok: true, records: resp.records || [] }, ORIGIN);
        return;
      }

      if (type === 'EXCEL_GET_VIEW_INFO') {
        const appId = payload?.appId;
        if (!appId) throw new Error('appId is required');
        const currentQuery = String(payload?.currentQuery || '');
        const viewId = payload?.viewId ? String(payload.viewId) : '';
        const views = await getViewsCached(appId, {
          feature: 'metadata_views',
          trigger: String(payload?.__pbTrigger || payload?.trigger || 'overlay_open'),
          source: 'overlay',
          logGroup: 'overlay'
        });
        const entries = Object.entries(views || {});
        let selectedView = null;
        let selectedViewName = '';
        if (viewId) {
          const found = entries.find(([name, v]) => String(v.id) === viewId);
          if (found) {
            selectedView = found[1];
            selectedViewName = found[0];
          }
        }
        if (!selectedView) {
          const currentName = typeof window.kintone?.app?.getViewName === 'function' ? window.kintone.app.getViewName() : '';
          if (currentName && views[currentName]) {
            selectedView = views[currentName];
            selectedViewName = currentName;
          }
        }
        if (!selectedView && entries.length) {
          selectedView = entries[0][1];
          selectedViewName = entries[0][0];
        }

        const baseFilter = selectedView?.filterCond || '';
        const { filter: currentFilter, trailing } = splitQueryParts(currentQuery);
        const mergedFilter = combineQuery(baseFilter, currentFilter);
        const parts = [];
        if (mergedFilter) parts.push(mergedFilter);
        if (trailing) {
          parts.push(trailing);
        } else if (selectedView?.sort && !hasOrderClause(currentQuery)) {
          parts.push(`order by ${selectedView.sort}`);
        }
        let finalQuery = parts.join(' ').trim();
        if (!finalQuery) {
          finalQuery = currentQuery.trim() || baseFilter.trim() || '';
        }

        const fieldOrder = extractColumnOrder(selectedView);

        window.postMessage({
          __kfav__: true,
          replyTo: id,
          ok: true,
          query: finalQuery,
          fieldOrder,
          viewId: selectedView?.id ? String(selectedView.id) : '',
          viewName: selectedViewName || ''
        }, ORIGIN);
        return;
      }

      if (type === 'CP_GET_CONTEXT') {
        const sdk = window.kintone;
        const appId = sdk?.app?.getId?.() ?? null;
        const recordId = (() => {
          try { return sdk?.app?.record?.getId?.() ?? null; } catch (_) { return null; }
        })();
        const query = (() => {
          try { return sdk?.app?.getQueryCondition?.() ?? ''; } catch (_) { return ''; }
        })();
        window.postMessage({
          __kfav__: true, replyTo: id, ok: true,
          result: {
            appId: appId != null ? String(appId) : null,
            recordId: recordId != null ? String(recordId) : null,
            query: String(query)
          }
        }, ORIGIN);
        return;
      }

      if (type === 'CP_GET_FIELDS') {
        const appId = String(payload?.appId || '').trim();
        if (!appId) throw new Error('appId is required');
        const resp = await callKintoneApi('/k/v1/app/form/fields', 'GET', { app: appId }, {
          feature: 'command_palette',
          trigger: 'cp_field_codes',
          source: 'command_palette'
        });
        const rawFields = resp?.properties || {};
        const fields = Object.values(rawFields).map((f) => ({
          code: String(f.code || ''),
          label: String(f.label || ''),
          type: String(f.type || '')
        })).sort((a, b) => a.code.localeCompare(b.code));
        window.postMessage({ __kfav__: true, replyTo: id, ok: true, result: { fields } }, ORIGIN);
        return;
      }

      if (type === 'CP_NAVIGATE') {
        const url = String(payload?.url || '').trim();
        if (url) window.location.href = url;
        window.postMessage({ __kfav__: true, replyTo: id, ok: true, result: {} }, ORIGIN);
        return;
      }

      if (type === 'EXCEL_PUT_RECORDS') {
        const appId = payload?.appId;
        const records = Array.isArray(payload?.records) ? payload.records : null;
        if (!appId || !records) throw new Error('appId and records are required');
        const req = { app: String(appId), records };
        const resp = await callKintoneApi('/k/v1/records', 'PUT', req, {
          feature: 'overlay_records',
          trigger: String(payload?.__pbTrigger || payload?.trigger || 'save_click'),
          source: 'overlay',
          logGroup: 'overlay'
        });
        window.postMessage({ __kfav__: true, replyTo: id, ok: true, result: resp }, ORIGIN);
        return;
      }

      if (type === 'EXCEL_POST_RECORDS') {
        const appId = payload?.appId;
        const records = Array.isArray(payload?.records) ? payload.records : null;
        if (!appId || !records) throw new Error('appId and records are required');
        const req = { app: String(appId), records };
        const resp = await callKintoneApi('/k/v1/records', 'POST', req, {
          feature: 'overlay_records',
          trigger: String(payload?.__pbTrigger || payload?.trigger || 'save_click'),
          source: 'overlay',
          logGroup: 'overlay'
        });
        window.postMessage({ __kfav__: true, replyTo: id, ok: true, result: resp }, ORIGIN);
        return;
      }

      if (type === 'EXCEL_DELETE_RECORDS') {
        const appId = payload?.appId;
        const ids = Array.isArray(payload?.ids) ? payload.ids.map((v) => String(v || '').trim()).filter(Boolean) : [];
        if (!appId) throw new Error('appId is required');
        if (!ids.length) {
          window.postMessage({ __kfav__: true, replyTo: id, ok: true, result: { ids: [] } }, ORIGIN);
          return;
        }
        const req = { app: String(appId), ids };
        const resp = await callKintoneApi('/k/v1/records', 'DELETE', req, {
          feature: 'overlay_records',
          trigger: String(payload?.__pbTrigger || payload?.trigger || 'save_click'),
          source: 'overlay',
          logGroup: 'overlay'
        });
        window.postMessage({ __kfav__: true, replyTo: id, ok: true, result: resp || { ids } }, ORIGIN);
        return;
      }

      if (type === 'EXCEL_UPLOAD_FILE') {
        const files = Array.isArray(payload?.files) ? payload.files : [];
        if (!files.length) {
          window.postMessage({ __kfav__: true, replyTo: id, ok: true, result: { fileKeys: [] } }, ORIGIN);
          return;
        }
        const sdk = window.kintone;
        if (!sdk?.getRequestToken) throw new Error('kintone.getRequestToken unavailable');
        const uploadEndpoint = '/k/v1/file.json';
        const trigger = String(payload?.__pbTrigger || payload?.trigger || 'save_click');
        const fileKeys = [];
        for (const file of files) {
          const token = sdk.getRequestToken();
          const form = new FormData();
          form.append('file', file, file.name);
          const resp = await fetch(uploadEndpoint, {
            method: 'POST',
            headers: { 'X-Cybozu-RequestToken': token, 'X-Requested-With': 'XMLHttpRequest' },
            body: form
          });
          if (!resp.ok) {
            const text = await resp.text().catch(() => '');
            const err = new Error(`file upload failed: ${resp.status} ${text}`);
            emitApiUsage({ feature: 'overlay_file_upload', endpoint: uploadEndpoint, method: 'POST', trigger, source: 'overlay', ok: false, sent: true, requestCount: 1, requestKind: 'rest', error: err.message });
            throw err;
          }
          const json = await resp.json();
          emitApiUsage({ feature: 'overlay_file_upload', endpoint: uploadEndpoint, method: 'POST', trigger, source: 'overlay', ok: true, sent: true, requestCount: 1, requestKind: 'rest' });
          fileKeys.push(json.fileKey);
        }
        window.postMessage({ __kfav__: true, replyTo: id, ok: true, result: { fileKeys } }, ORIGIN);
        return;
      }

      if (type === 'EXCEL_EVALUATE_RECORD_ACL') {
        const appId = payload?.appId;
        const ids = Array.isArray(payload?.ids) ? payload.ids : [];
        if (!appId) throw new Error('appId is required');
        const rights = await fetchEvaluatedRecordAcl(appId, ids, {
          feature: 'overlay_acl',
          trigger: String(payload?.__pbTrigger || payload?.trigger || 'acl_check'),
          source: 'overlay',
          logGroup: 'overlay'
        });
        window.postMessage({ __kfav__: true, replyTo: id, ok: true, rights }, ORIGIN);
        return;
      }

      if (type === 'COUNT_VIEW') {
        const { appId, viewIdOrName } = payload;
        const views = await getViews(appId, {
          feature: 'watchlist',
          trigger: String(payload?.__pbTrigger || payload?.trigger || 'watchlist_refresh'),
          source: 'watchlist',
          logGroup: 'watchlist'
        });
        const query = extractQueryFromViews(views, viewIdOrName);
        const count = await countRecords(appId, query, {
          feature: 'watchlist',
          trigger: String(payload?.__pbTrigger || payload?.trigger || 'watchlist_refresh'),
          source: 'watchlist',
          logGroup: 'watchlist'
        });
        window.postMessage({ __kfav__: true, replyTo: id, ok: true, count }, ORIGIN);
        return;
      }

      if (type === 'COUNT_APP_QUERY') {
        const { appId, query } = payload;
        const count = await countRecords(appId, query || '', {
          feature: 'watchlist',
          trigger: String(payload?.__pbTrigger || payload?.trigger || 'watchlist_refresh'),
          source: 'watchlist',
          logGroup: 'watchlist'
        });
        window.postMessage({ __kfav__: true, replyTo: id, ok: true, count }, ORIGIN);
        return;
      }

      if (type === 'GET_APP_NAME') {
        const appId = payload?.appId;
        if (!appId) throw new Error('appId is required');
        const source = String(payload?.source || 'launcher');
        const feature = source.includes('launcher') ? 'bootstrap' : 'metadata_app';
        const app = await getAppMeta(appId, {
          feature,
          trigger: String(payload?.__pbTrigger || payload?.trigger || 'panel_open'),
          source,
          logGroup: 'bootstrap'
        });
        window.postMessage({
          __kfav__: true,
          replyTo: id,
          ok: true,
          name: String(app?.name || '')
        }, ORIGIN);
        return;
      }

      if (type === 'COUNT_BULK') {
        const items = Array.isArray(payload?.items) ? payload.items : [];
        const counts = {};
        const errors = {};
        const bulkTargets = [];
        for (const item of items) {
          const key = item?.id;
          if (!key) continue;
          try {
            if (!item.appId) {
              counts[key] = null;
              errors[key] = 'appId is not set';
              continue;
            }
            const appId = String(item.appId);
            const normalizedAppId = normalizeAppIdForBulk(appId);
            if (!normalizedAppId) {
              counts[key] = null;
              errors[key] = 'appId is invalid';
              continue;
            }
            const queryRaw = item?.query;
            const finalQuery = String(queryRaw == null ? '' : queryRaw).trim();
            if (finalQuery === '-') {
              counts[key] = null;
              errors[key] = 'query is not set';
              continue;
            }
            bulkTargets.push({
              id: key,
              appId: normalizedAppId,
              query: finalQuery
            });
          } catch (e) {
            counts[key] = null;
            errors[key] = String(e?.message || e);
          }
        }
        const bulkResult = await countRecordsBulk(bulkTargets, {
          feature: 'watchlist',
          trigger: String(payload?.__pbTrigger || payload?.trigger || 'watchlist_refresh'),
          source: 'watchlist',
          logGroup: 'watchlist',
          flow: 'parallel_get'
        });
        Object.assign(counts, bulkResult.counts || {});
        Object.assign(errors, bulkResult.errors || {});
        const payloadOut = { __kfav__: true, replyTo: id, ok: true, counts };
        if (Object.keys(errors).length) payloadOut.errors = errors;
        window.postMessage(payloadOut, ORIGIN);
        return;
      }

      if (type === 'LIST_VIEWS') {
        const { appId } = payload;
        const views = await getViews(appId, {
          feature: 'watchlist',
          trigger: String(payload?.__pbTrigger || payload?.trigger || 'watchlist_refresh'),
          source: 'watchlist',
          logGroup: 'watchlist'
        });
        window.postMessage({ __kfav__: true, replyTo: id, ok: true, views }, ORIGIN);
        return;
      }
      // 逶ｴ霑代せ繧ｱ繧ｸ繝･繝ｼ繝ｫ蜿門ｾ暦ｼ壻ｻｻ諢上い繝励Μ ﾃ・莉ｻ諢上・譌･莉倥ヵ繧｣繝ｼ繝ｫ繝・ﾃ・蜈・騾ｱ髢・
      if (type === 'LIST_SCHEDULE') {
        const { appId, dateField, endDate, extraQuery = '', titleField = '', limit = 20 } = payload;
        const today = new Date();
        const yyyy = today.getFullYear();
        const mm = String(today.getMonth() + 1).padStart(2, '0');
        const dd = String(today.getDate()).padStart(2, '0');
        const todayDate = `${yyyy}-${mm}-${dd}`;
        const off = tzOffsetStr(today);
        const startDT = `${todayDate}T00:00:00${off}`;
        const endDT = `${endDate}T23:59:59${off}`;

        // 繝輔ぅ繝ｼ繝ｫ繝牙梛繧貞叙蠕励＠縺ｦ DATE / DATETIME 繧貞愛螳夲ｼ亥､ｱ謨玲凾縺ｯDATE縺ｨ縺励※蜃ｦ逅・ｼ・
        let fieldType = 'DATE';
        try {
          const fieldsMeta = await getFields(appId);
          const meta = fieldsMeta.find(f => f.code === dateField);
          if (meta && meta.type) fieldType = meta.type; // "DATE" | "DATETIME" 縺ｪ縺ｩ
        } catch (_e) { /* 讓ｩ髯舌′辟｡縺・ｭ峨・鮟吶▲縺ｦ繝輔か繝ｼ繝ｫ繝舌ャ繧ｯ */ }

        let q;
        if (fieldType === 'DATETIME') {
          q = `${dateField} >= "${startDT}" and ${dateField} <= "${endDT}"`;
        } else {
          q = `${dateField} >= "${todayDate}" and ${dateField} <= "${endDate}"`;
        }
        // 遨ｺ逋ｽ髯､螟厄ｼ亥ｿｵ縺ｮ縺溘ａ・・
        q += ` and ${dateField} != ""`;
        if (extraQuery && String(extraQuery).trim()) q += ` and (${extraQuery})`;
        q += ` order by ${dateField} asc limit ${Math.max(1, Math.min(100, limit))}`;

        const fields = Array.from(new Set(['$id', dateField].concat(titleField ? [titleField] : [])));
        const resp = await callKintoneApi('/k/v1/records', 'GET',
          { app: String(appId), query: q, fields },
          {
            feature: 'watchlist',
            trigger: String(payload?.__pbTrigger || payload?.trigger || 'watchlist_refresh'),
            source: 'watchlist',
            logGroup: 'watchlist'
          });
        //縺昴・縺ｾ縺ｾ霑斐☆・域紛蠖｢縺ｯ諡｡蠑ｵ蛛ｴ縺ｧ・・
        window.postMessage({ __kfav__: true, replyTo: id, ok: true, records: resp.records || [] }, ORIGIN);
        return;
      }
      // 繝輔ぅ繝ｼ繝ｫ繝我ｸ隕ｧ・亥梛莉倥″・峨ｒ霑斐☆・啅I縺ｮ驕ｸ謚櫁｣懷勧逕ｨ
      if (type === 'LIST_FIELDS') {
        const { appId } = payload;
        const fields = await getFields(appId);
        window.postMessage({ __kfav__: true, replyTo: id, ok: true, fields }, ORIGIN);
        return;
      }

      if (type === 'PIN_FETCH') {
        const items = Array.isArray(payload?.items) ? payload.items : [];
        const results = {};
        for (const item of items) {
          const key = item?.id;
          if (!key) continue;
          try {
            if (!item.appId || !item.recordId) {
              results[key] = { ok: false, error: 'appId / recordId is required' };
              continue;
            }
            const params = {
              app: String(item.appId),
              id: String(item.recordId)
            };
            if (Array.isArray(item.fields) && item.fields.length) {
              params.fields = item.fields;
            }
            const resp = await callKintoneApi('/k/v1/record', 'GET', params, {
              feature: 'record_pin',
              trigger: String(payload?.__pbTrigger || payload?.trigger || 'panel_open'),
              source: 'record_pin',
              logGroup: 'record_pin'
            });
            results[key] = { ok: true, record: resp.record || {} };
          } catch (error) {
            results[key] = { ok: false, error: String(error?.message || error) };
          }
        }
        window.postMessage({ __kfav__: true, replyTo: id, ok: true, results }, ORIGIN);
        return;
      }
    } catch (e) {
      const payloadOut = {
        __kfav__: true,
        replyTo: id,
        ok: false,
        error: String(e?.message || e)
      };
      if (e && typeof e === 'object') {
        if ('code' in e) payloadOut.errorCode = e.code;
        if ('status' in e) payloadOut.status = e.status;
        if ('errors' in e) payloadOut.errorDetails = e.errors;
      }
      window.postMessage(payloadOut, ORIGIN);
    }
  });
})();
