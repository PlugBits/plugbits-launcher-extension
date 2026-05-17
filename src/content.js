// content.js
// 1) page-bridge.js  2) popup/background  window.postMessage 
(function bootstrap() {
  function isKintoneLikeHost(hostname) {
    return /\.kintone(?:-dev)?\.com$/i.test(String(hostname || ''))
      || /\.cybozu\.com$/i.test(String(hostname || ''));
  }

  function isGaroonLikePath(pathname) {
    const path = String(pathname || '').trim().toLowerCase();
    if (!path) return false;
    return /^\/(?:g|grn|garoon)(?:\/|$)/.test(path);
  }

  function getKintoneAppPageType(pathname) {
    const path = String(pathname || '');
    if (/^\/k\/\d+\/?$/.test(path)) return 'list';
    if (/^\/k\/\d+\/show(?:\/|$)/.test(path)) return 'detail';
    if (/^\/k\/\d+\/edit(?:\/|$)/.test(path)) return 'edit';
    if (/^\/k\/\d+\/create(?:\/|$)/.test(path)) return 'create';
    return 'unsupported';
  }

  function normalizeNumericId(value) {
    const text = String(value == null ? '' : value).trim();
    return /^\d+$/.test(text) ? text : '';
  }

  function getKintoneAppIdSafe() {
    try {
      const appApi = window?.kintone?.app;
      if (!appApi || typeof appApi.getId !== 'function') return '';
      const raw = appApi.getId();
      return normalizeNumericId(raw);
    } catch (_err) {
      return '';
    }
  }

  function hasAppContextUrlHint(url) {
    if (!url) return false;
    const pathname = String(url.pathname || '');
    const search = String(url.search || '');
    const hash = String(url.hash || '');
    const pageType = getKintoneAppPageType(pathname);
    if (pageType !== 'unsupported') return true;
    if (/\/k\/\d+\/(?:show|edit|create)(?:\/|$)/.test(hash)) return true;
    if (/^#\/?k\/\d+\/?(?:[?#].*)?$/.test(hash)) return true;
    if (/[?&](?:app|appId)=\d+(?:[&#]|$)/i.test(search)) return true;
    if (/(?:^#|[?&])(?:app|appId)=\d+(?:[&#]|$)/i.test(hash)) return true;
    if (/(?:^#|[?&])record=\d+(?:[&#]|$)/i.test(hash) && /\/k\/\d+\/show(?:\/|$)/.test(pathname)) return true;
    return false;
  }

  function hasAppContextDomHint() {
    try {
      if (document.querySelector('[data-app-id], [data-view-id]')) {
        console.debug('PB DOM fallback used: hasAppContextDomHint(data-attr)');
        return true;
      }
      if (document.querySelector('.gaia-argoui-app-index-toolbar, .recordlist-gaia, .record-gaia')) {
        console.debug('PB DOM fallback used: hasAppContextDomHint(gaia)');
        return true;
      }
      return false;
    } catch (_err) {
      return false;
    }
  }

  function hasAppContextApiHint() {
    try {
      const appApi = window?.kintone?.app;
      if (!appApi || typeof appApi !== 'object') return false;
      if (typeof appApi.getQuery === 'function') {
        const query = appApi.getQuery();
        if (typeof query === 'string') return true;
      }
      if (typeof appApi.getViewName === 'function') {
        const viewName = appApi.getViewName();
        if (typeof viewName === 'string') return true;
      }
      if (typeof appApi.getHeaderMenuSpaceElement === 'function') {
        const headerSpace = appApi.getHeaderMenuSpaceElement();
        if (headerSpace !== undefined) return true;
      }
      return false;
    } catch (_err) {
      return false;
    }
  }

  function isSupportedHostPage() {
    try {
      const href = String(location?.href || '');
      if (!href) return false;
      const url = new URL(href);
      if (!isKintoneLikeHost(url.hostname)) return false;
      if (isGaroonLikePath(url.pathname)) return false;
      const hasBody = Boolean(document?.body || document?.documentElement);
      if (!hasBody) return false;
      return true;
    } catch (_err) {
      return false;
    }
  }

  function isSupportedAppContextPage() {
    try {
      if (!isSupportedHostPage()) return false;
      const hasBody = Boolean(document?.body || document?.documentElement);
      if (!hasBody) return false;
      const href = String(location?.href || '');
      if (!href) return false;
      const url = new URL(href);
      if (hasAppContextUrlHint(url)) return true;
      const appApi = window?.kintone?.app;
      const hasGetId = Boolean(appApi && typeof appApi.getId === 'function');
      const appId = hasGetId ? getKintoneAppIdSafe() : '';
      if (appId) return true;
      if (hasAppContextApiHint()) return true;
      if (hasAppContextDomHint()) return true;
      return false;
    } catch (_err) {
      return false;
    }
  }

  // Keep host-level features alive on supported kintone hosts.
  if (!isSupportedHostPage()) return;
  if (window.__kfav_content_injected) return;
  window.__kfav_content_injected = true;

  (function injectBridge() {
    const s = document.createElement('script');
    s.src = chrome.runtime.getURL('page-bridge.js');
    s.async = false;
    (document.head || document.documentElement).appendChild(s);
    s.onload = () => s.remove();
  })();

  const pendingKey = '__kfav_pending_map';
  const pending = window[pendingKey] instanceof Map ? window[pendingKey] : new Map();
  window[pendingKey] = pending;

  const API_USAGE_DAILY_KEY = 'apiUsageDaily';
  const API_USAGE_ADMIN_BREAKDOWN_DAILY_KEY = 'apiUsageAdminBreakdownDaily';
  const API_USAGE_RETENTION_DAYS = 31;
  const API_USAGE_FLUSH_DELAY_MS = 1200;
  const API_USAGE_FEATURE_VALUES = new Set([
    'watchlist',
    'watchlist_bulk',
    'record_pin',
    'recent',
    'overlay',
    'overlay_records',
    'overlay_acl',
    'bootstrap',
    'metadata_app',
    'metadata_views',
    'metadata_fields',
    'admin',
    'other'
  ]);
  const API_USAGE_FEATURE_ALIASES = {
    pins: 'record_pin',
    launcher: 'admin',
    options: 'admin',
    auth: 'admin',
    watchlist: 'watchlist_bulk',
    watchlist_panel: 'watchlist_bulk',
    watchlist_tick: 'watchlist_bulk',
    watchlist_resume: 'watchlist_bulk',
    watchlist_manual: 'watchlist_bulk',
    watchlist_panel_open: 'watchlist_bulk',
    watchlist_visible_tick: 'watchlist_bulk',
    watchlist_resume_catchup: 'watchlist_bulk',
    watchlist_expand: 'watchlist_bulk',
    watchlist_focus_resume: 'watchlist_bulk',
    watchlist_tab_resume: 'watchlist_bulk'
  };
  const API_USAGE_ADMIN_CATEGORY_VALUES = new Set([
    'settings',
    'app_cache',
    'permission',
    'bootstrap',
    'usage_stats',
    'debug',
    'other'
  ]);
  const PB_API_USAGE_EVENT = '__kfav_api_usage__';
  const API_USAGE_REST_ONLY = true;
  const apiUsagePending = {};
  const apiUsageAdminPending = {};
  let apiUsageFlushTimer = null;
  let apiUsageFlushPromise = Promise.resolve();

  function toLocalDateKey(date = new Date()) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  function normalizeUsageFeature(value) {
    const feature = String(value || '').trim().toLowerCase();
    if (API_USAGE_FEATURE_VALUES.has(feature)) return feature;
    if (Object.prototype.hasOwnProperty.call(API_USAGE_FEATURE_ALIASES, feature)) {
      return API_USAGE_FEATURE_ALIASES[feature];
    }
    return 'other';
  }

  function createUsageStat(raw) {
    const count = Number(raw?.count || 0);
    const success = Number(raw?.success || 0);
    const error = Number(raw?.error || 0);
    return {
      count: Number.isFinite(count) && count > 0 ? count : 0,
      success: Number.isFinite(success) && success > 0 ? success : 0,
      error: Number.isFinite(error) && error > 0 ? error : 0
    };
  }

  function normalizeAdminUsageCategory(value) {
    const category = String(value || '').trim().toLowerCase();
    if (API_USAGE_ADMIN_CATEGORY_VALUES.has(category)) return category;
    return 'other';
  }

  function isUsageStatLike(raw) {
    if (!raw || typeof raw !== 'object') return false;
    return Object.prototype.hasOwnProperty.call(raw, 'count')
      || Object.prototype.hasOwnProperty.call(raw, 'success')
      || Object.prototype.hasOwnProperty.call(raw, 'error');
  }

  function mergeUsageStat(featureMap, featureValue, stat) {
    const feature = normalizeUsageFeature(featureValue);
    const target = featureMap[feature] || (featureMap[feature] = { count: 0, success: 0, error: 0 });
    target.count += Number(stat?.count || 0);
    target.success += Number(stat?.success || 0);
    target.error += Number(stat?.error || 0);
  }

  function mergeAdminUsageStat(categoryMap, categoryValue, stat) {
    const category = normalizeAdminUsageCategory(categoryValue);
    const target = categoryMap[category] || (categoryMap[category] = { count: 0, success: 0, error: 0 });
    target.count += Number(stat?.count || 0);
    target.success += Number(stat?.success || 0);
    target.error += Number(stat?.error || 0);
  }

  function normalizeApiUsageDaily(raw) {
    if (!raw || typeof raw !== 'object') return {};
    const daily = {};
    Object.entries(raw).forEach(([dateKey, featureMap]) => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateKey))) return;
      if (!featureMap || typeof featureMap !== 'object') return;
      const normalizedFeatureMap = {};
      Object.entries(featureMap).forEach(([featureKey, bucket]) => {
        const feature = normalizeUsageFeature(featureKey);
        if (isUsageStatLike(bucket)) {
          mergeUsageStat(normalizedFeatureMap, feature, createUsageStat(bucket));
          return;
        }
        // Legacy format compatibility:
        // { date: { menu: { purpose: { count/success/error } } } }
        if (!bucket || typeof bucket !== 'object') return;
        Object.values(bucket).forEach((legacyStat) => {
          if (!isUsageStatLike(legacyStat)) return;
          mergeUsageStat(normalizedFeatureMap, feature, createUsageStat(legacyStat));
        });
      });
      if (Object.keys(normalizedFeatureMap).length) {
        daily[dateKey] = normalizedFeatureMap;
      }
    });
    return daily;
  }

  function normalizeApiUsageAdminBreakdownDaily(raw) {
    if (!raw || typeof raw !== 'object') return {};
    const daily = {};
    Object.entries(raw).forEach(([dateKey, categoryMap]) => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateKey))) return;
      if (!categoryMap || typeof categoryMap !== 'object') return;
      const normalizedCategoryMap = {};
      Object.entries(categoryMap).forEach(([categoryKey, bucket]) => {
        const category = normalizeAdminUsageCategory(categoryKey);
        if (isUsageStatLike(bucket)) {
          mergeAdminUsageStat(normalizedCategoryMap, category, createUsageStat(bucket));
          return;
        }
        if (!bucket || typeof bucket !== 'object') return;
        Object.values(bucket).forEach((legacyStat) => {
          if (!isUsageStatLike(legacyStat)) return;
          mergeAdminUsageStat(normalizedCategoryMap, category, createUsageStat(legacyStat));
        });
      });
      if (Object.keys(normalizedCategoryMap).length) {
        daily[dateKey] = normalizedCategoryMap;
      }
    });
    return daily;
  }

  function upsertUsageStat(container, dateKey, featureValue, successValue, count = 1) {
    const feature = normalizeUsageFeature(featureValue);
    const daily = container[dateKey] || (container[dateKey] = {});
    const stat = daily[feature] || (daily[feature] = { count: 0, success: 0, error: 0 });
    stat.count += count;
    if (successValue) {
      stat.success += count;
    } else {
      stat.error += count;
    }
  }

  function upsertAdminUsageStat(container, dateKey, categoryValue, successValue, count = 1) {
    const category = normalizeAdminUsageCategory(categoryValue);
    const daily = container[dateKey] || (container[dateKey] = {});
    const stat = daily[category] || (daily[category] = { count: 0, success: 0, error: 0 });
    stat.count += count;
    if (successValue) {
      stat.success += count;
    } else {
      stat.error += count;
    }
  }

  function copyAndResetPendingApiUsage() {
    const dateKeys = Object.keys(apiUsagePending);
    if (!dateKeys.length) return null;
    const snapshot = {};
    dateKeys.forEach((dateKey) => {
      const featureMap = apiUsagePending[dateKey];
      if (!featureMap || typeof featureMap !== 'object') return;
      snapshot[dateKey] = {};
      Object.entries(featureMap).forEach(([feature, stat]) => {
        if (!isUsageStatLike(stat)) return;
        snapshot[dateKey][feature] = createUsageStat(stat);
      });
    });
    dateKeys.forEach((key) => {
      delete apiUsagePending[key];
    });
    return snapshot;
  }

  function copyAndResetPendingAdminUsage() {
    const dateKeys = Object.keys(apiUsageAdminPending);
    if (!dateKeys.length) return null;
    const snapshot = {};
    dateKeys.forEach((dateKey) => {
      const categoryMap = apiUsageAdminPending[dateKey];
      if (!categoryMap || typeof categoryMap !== 'object') return;
      snapshot[dateKey] = {};
      Object.entries(categoryMap).forEach(([category, stat]) => {
        if (!isUsageStatLike(stat)) return;
        snapshot[dateKey][category] = createUsageStat(stat);
      });
    });
    dateKeys.forEach((key) => {
      delete apiUsageAdminPending[key];
    });
    return snapshot;
  }

  function pruneOldApiUsageDaily(daily) {
    const cutoff = new Date();
    cutoff.setHours(0, 0, 0, 0);
    cutoff.setDate(cutoff.getDate() - (API_USAGE_RETENTION_DAYS - 1));
    const cutoffKey = toLocalDateKey(cutoff);
    Object.keys(daily).forEach((dateKey) => {
      if (dateKey < cutoffKey) delete daily[dateKey];
    });
  }

  function mergeApiUsageSnapshot(daily, snapshot) {
    if (!snapshot || typeof snapshot !== 'object') return;
    Object.entries(snapshot).forEach(([dateKey, featureMap]) => {
      if (!featureMap || typeof featureMap !== 'object') return;
      Object.entries(featureMap).forEach(([feature, stat]) => {
        const count = Number(stat?.count || 0);
        const success = Number(stat?.success || 0);
        const error = Number(stat?.error || 0);
        if (!count && !success && !error) return;
        if (success > 0) {
          upsertUsageStat(daily, dateKey, feature, true, success);
        }
        if (error > 0) {
          upsertUsageStat(daily, dateKey, feature, false, error);
        }
        const diff = count - success - error;
        if (diff > 0) {
          upsertUsageStat(daily, dateKey, feature, true, diff);
        }
      });
    });
  }

  function mergeApiUsageAdminBreakdownSnapshot(daily, snapshot) {
    if (!snapshot || typeof snapshot !== 'object') return;
    Object.entries(snapshot).forEach(([dateKey, categoryMap]) => {
      if (!categoryMap || typeof categoryMap !== 'object') return;
      Object.entries(categoryMap).forEach(([category, stat]) => {
        const count = Number(stat?.count || 0);
        const success = Number(stat?.success || 0);
        const error = Number(stat?.error || 0);
        if (!count && !success && !error) return;
        if (success > 0) {
          upsertAdminUsageStat(daily, dateKey, category, true, success);
        }
        if (error > 0) {
          upsertAdminUsageStat(daily, dateKey, category, false, error);
        }
        const diff = count - success - error;
        if (diff > 0) {
          upsertAdminUsageStat(daily, dateKey, category, true, diff);
        }
      });
    });
  }

  function scheduleApiUsageFlush() {
    if (apiUsageFlushTimer !== null) return;
    apiUsageFlushTimer = window.setTimeout(() => {
      apiUsageFlushTimer = null;
      void flushApiUsageDaily();
    }, API_USAGE_FLUSH_DELAY_MS);
  }

  function classifyAdminUsageCategory(type, meta = {}) {
    const explicit = normalizeAdminUsageCategory(meta?.adminCategory || meta?.adminPurpose || meta?.purpose);
    if (explicit !== 'other') return explicit;
    const messageType = String(type || '').trim().toUpperCase();
    if (!messageType) return 'other';
    if (messageType === 'GET_APP_NAME') return 'app_cache';
    if (messageType === 'CHECK_KINTONE_READY') return 'bootstrap';
    if (messageType.startsWith('DEV_')) return 'debug';
    if (messageType.includes('PERMISSION')) return 'permission';
    return 'other';
  }

  async function flushApiUsageDaily() {
    const snapshot = copyAndResetPendingApiUsage();
    const adminSnapshot = copyAndResetPendingAdminUsage();
    if (!snapshot && !adminSnapshot) return;
    apiUsageFlushPromise = apiUsageFlushPromise.then(async () => {
      const stored = await chrome.storage.local.get([API_USAGE_DAILY_KEY, API_USAGE_ADMIN_BREAKDOWN_DAILY_KEY]);
      const daily = normalizeApiUsageDaily(stored?.[API_USAGE_DAILY_KEY]);
      const adminDaily = normalizeApiUsageAdminBreakdownDaily(stored?.[API_USAGE_ADMIN_BREAKDOWN_DAILY_KEY]);
      mergeApiUsageSnapshot(daily, snapshot);
      mergeApiUsageAdminBreakdownSnapshot(adminDaily, adminSnapshot);
      pruneOldApiUsageDaily(daily);
      pruneOldApiUsageDaily(adminDaily);
      const payload = {};
      const removeKeys = [];
      if (Object.keys(daily).length) {
        payload[API_USAGE_DAILY_KEY] = daily;
      } else {
        removeKeys.push(API_USAGE_DAILY_KEY);
      }
      if (Object.keys(adminDaily).length) {
        payload[API_USAGE_ADMIN_BREAKDOWN_DAILY_KEY] = adminDaily;
      } else {
        removeKeys.push(API_USAGE_ADMIN_BREAKDOWN_DAILY_KEY);
      }
      if (Object.keys(payload).length) {
        await chrome.storage.local.set(payload);
      }
      if (removeKeys.length) {
        await chrome.storage.local.remove(removeKeys);
      }
    }).catch(() => {
      // Ignore telemetry write failures.
    });
    await apiUsageFlushPromise;
  }

  function classifyApiUsageFeature(type, meta = {}) {
    const messageType = String(type || '').trim().toUpperCase();
    if (messageType === 'META_GET_APP') return 'metadata_app';
    if (messageType === 'META_GET_VIEWS') return 'metadata_views';
    if (messageType === 'META_GET_FIELDS') return 'metadata_fields';
    if (messageType === 'CHECK_KINTONE_READY') return 'bootstrap';
    if (messageType === 'EXCEL_EVALUATE_RECORD_ACL') return 'overlay_acl';
    if (
      messageType === 'EXCEL_GET_RECORDS'
      || messageType === 'EXCEL_GET_RECORDS_BY_IDS'
      || messageType === 'EXCEL_POST_RECORDS'
      || messageType === 'EXCEL_PUT_RECORDS'
      || messageType === 'EXCEL_DELETE_RECORDS'
    ) {
      return 'overlay_records';
    }
    const explicitFeature = normalizeUsageFeature(meta?.feature);
    if (explicitFeature !== 'other') return explicitFeature;
    if (!messageType) return 'other';
    if (messageType.startsWith('EXCEL_')) return 'overlay';
    if (messageType.startsWith('COUNT_') || messageType.startsWith('LIST_')) return 'watchlist';
    if (messageType === 'PIN_FETCH') return 'record_pin';
    if (messageType === 'GET_APP_NAME') return 'admin';
    if (messageType.startsWith('DEV_')) return 'admin';
    return 'other';
  }

  function shouldSkipLegacyUsageTracking(type) {
    const messageType = String(type || '').trim().toUpperCase();
    if (!messageType) return true;
    if (messageType.startsWith('DEV_')) return false;
    if (messageType === 'PING_CONTENT') return true;
    return true;
  }

  function trackApiUsage(type, response, meta = {}) {
    if (API_USAGE_REST_ONLY || shouldSkipLegacyUsageTracking(type)) return;
    const feature = classifyApiUsageFeature(type, meta);
    const success = Boolean(response?.ok);
    const dateKey = toLocalDateKey();
    upsertUsageStat(apiUsagePending, dateKey, feature, success, 1);
    if (feature === 'admin') {
      const category = classifyAdminUsageCategory(type, meta);
      upsertAdminUsageStat(apiUsageAdminPending, dateKey, category, success, 1);
    }
    scheduleApiUsageFlush();
  }

  function trackRestApiUsage(payload = {}) {
    if (payload?.sent !== true) return;
    const endpoint = String(payload?.endpoint || '').trim();
    if (!endpoint || !endpoint.startsWith('/k/v1/')) return;
    let feature = normalizeUsageFeature(payload?.feature);
    if (feature === 'watchlist') feature = 'watchlist_bulk';
    if (feature === 'other') return;
    const success = payload?.ok !== false;
    const requestCountRaw = Number(payload?.requestCount);
    const requestCount = Number.isFinite(requestCountRaw) && requestCountRaw > 0
      ? Math.floor(requestCountRaw)
      : 1;
    const dateKey = toLocalDateKey();
    upsertUsageStat(apiUsagePending, dateKey, feature, success, requestCount);
    if (feature === 'admin') {
      const category = normalizeAdminUsageCategory(payload?.adminCategory || payload?.category || payload?.source);
      upsertAdminUsageStat(apiUsageAdminPending, dateKey, category, success, requestCount);
    }
    scheduleApiUsageFlush();
  }

  window.addEventListener('pagehide', () => {
    void flushApiUsageDaily();
  }, true);

  function uuid() {
    return crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2);
  }

  window.addEventListener('message', (ev) => {
    if (ev.origin !== location.origin) return;
    const data = ev.data || {};
    if (data && data[PB_API_USAGE_EVENT] === true) {
      trackRestApiUsage(data.payload || {});
      return;
    }
    if (!data || data.__kfav__ !== true || !data.replyTo) return;
    const entry = pending.get(data.replyTo);
    if (entry) {
      pending.delete(data.replyTo);
      entry.resolve(data);
    }
  });

  function postToPage(type, payload, meta = {}) {
    const id = uuid();
    const p = new Promise((resolve) => {
      pending.set(id, { resolve });
      setTimeout(() => {
        if (pending.has(id)) {
          pending.delete(id);
          resolve({ ok: false, error: 'Timeout' });
        }
      }, 10000);
    });
    try {
      window.postMessage({ __kfav__: true, id, type, payload }, location.origin);
    } catch (error) {
      pending.delete(id);
      const failed = { ok: false, error: String(error?.message || error || 'post_message_failed') };
      trackApiUsage(type, failed, meta);
      return Promise.resolve(failed);
    }
    return p.then((response) => {
      trackApiUsage(type, response, meta);
      return response;
    });
  }

  let overlayController = null;
  let appOnlyFeaturesInitialized = false;
  let appOnlyInitWaitPromise = null;
  let devContextCaptureAttached = false;
  let recentWatcherStarted = false;
  let overlayShortcutListenerAttached = false;
  const APP_CONTEXT_INIT_RETRY_INTERVAL_MS = 200;
  const APP_CONTEXT_INIT_MAX_ATTEMPTS = 10;

  const devContextState = {
    target: null,
    lastContextInfo: null
  };
  let spaLifecycleReady = false;
  let spaCurrentContextKey = '';
  let spaLastAppContextKey = '';

  function normalizeFieldCode(value) {
    const code = String(value || '').trim();
    return code ? code : '';
  }

  function pickContextTarget(eventTarget) {
    if (!eventTarget) return null;
    if (eventTarget instanceof Element) return eventTarget;
    if (eventTarget.parentElement) return eventTarget.parentElement;
    return null;
  }

  function normalizeContextText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim().slice(0, 200);
  }

  function computeCellLikeIndex(cell) {
    if (!cell) return null;
    if (typeof cell.cellIndex === 'number' && cell.cellIndex >= 0) return cell.cellIndex;
    const row = cell.parentElement;
    if (!row) return null;
    const siblings = Array.from(row.children).filter((node) => {
      if (!(node instanceof Element)) return false;
      return node.matches('th,td,[role="columnheader"],[role="gridcell"]');
    });
    const index = siblings.indexOf(cell);
    return index >= 0 ? index : null;
  }

  function createLastContextInfo(target, clientX, clientY) {
    const overlayNode = target?.closest?.('[data-field-code]') || null;
    const overlayFieldCode = normalizeFieldCode(overlayNode?.getAttribute?.('data-field-code') || '');
    const cellNode = target?.closest?.('th,td,[role="columnheader"],[role="gridcell"]') || null;
    const role = String(cellNode?.getAttribute?.('role') || '').toLowerCase();
    const tag = String(cellNode?.tagName || '').toUpperCase();
    const isHeader = tag === 'TH' || role === 'columnheader';
    const cellIndex = computeCellLikeIndex(cellNode);
    const targetTag = target?.tagName ? String(target.tagName).toLowerCase() : null;
    const targetText = normalizeContextText(target?.textContent || '');
    return {
      x: Number(clientX || 0),
      y: Number(clientY || 0),
      timestamp: Date.now(),
      targetTag,
      targetText,
      overlayFieldCode: overlayFieldCode || null,
      cellIndex: typeof cellIndex === 'number' ? cellIndex : null,
      isHeader,
      isListLike: Boolean(cellNode || overlayFieldCode),
      hasTarget: Boolean(target)
    };
  }

  function debugDevField(stage, payload) {
    try {
      console.log(`[kfav][DEV] field resolve ${stage}`, payload);
    } catch (_err) {
      // ignore
    }
  }

  function attachDevContextCapture() {
    if (devContextCaptureAttached) return;
    document.addEventListener('contextmenu', (event) => {
      const target = pickContextTarget(event.target);
      devContextState.target = target;
      devContextState.lastContextInfo = createLastContextInfo(target, event.clientX, event.clientY);
    }, true);
    devContextCaptureAttached = true;
  }

  let currentPageContext = {
    href: location.href,
    timestamp: Date.now()
  };

  function buildSpaContextKey(rawHref) {
    try {
      const href = String(rawHref || location?.href || '').trim();
      if (!href) return '';
      const url = new URL(href);
      const pathname = String(url.pathname || '');
      const pageType = getKintoneAppPageType(pathname);
      const appMatch = pathname.match(/\/k\/(\d+)(?:\/|$)/);
      const appId = String(appMatch?.[1] || '').trim();
      const viewId = String(url.searchParams.get('view') || '').trim();
      const recordMatch = String(url.hash || '').match(/record=(\d+)/i);
      const recordId = String(recordMatch?.[1] || '').trim();
      return [
        url.origin,
        pageType,
        `app:${appId || '-'}`,
        `view:${viewId || '-'}`,
        `record:${recordId || '-'}`,
        `path:${pathname}`,
        `search:${String(url.search || '')}`,
        `hash:${String(url.hash || '')}`
      ].join('|');
    } catch (_err) {
      return '';
    }
  }

  function logSpaLifecycle(action, contextKey, trigger) {
    const key = String(contextKey || '').trim();
    const trig = String(trigger || 'unknown').trim();
    if (!key) return;
    console.debug(`PB SPA ${action} context=${key} trigger=${trig}`);
  }

  function handleSpaLifecycle(trigger, href) {
    if (!spaLifecycleReady) return;
    const nextContextKey = buildSpaContextKey(href);
    if (!nextContextKey) return;
    const previousContextKey = spaCurrentContextKey;
    spaCurrentContextKey = nextContextKey;
    if (!isSupportedAppContextPage()) {
      if (overlayController?.isOpen) {
        try {
          overlayController.close(true);
        } catch (_err) {
          // ignore
        }
      }
      spaLastAppContextKey = '';
      logSpaLifecycle('dispose', nextContextKey, trigger);
      return;
    }
    if (!appOnlyFeaturesInitialized) {
      const initialized = initAppOnlyFeatures();
      if (initialized) {
        spaLastAppContextKey = nextContextKey;
        const action = previousContextKey && previousContextKey !== nextContextKey ? 'reinit' : 'init';
        logSpaLifecycle(action, nextContextKey, trigger);
      }
      return;
    }
    if (spaLastAppContextKey === nextContextKey) {
      logSpaLifecycle('skip duplicate init', nextContextKey, trigger);
      return;
    }
    spaLastAppContextKey = nextContextKey;
    logSpaLifecycle('reinit', nextContextKey, trigger);
  }

  function notifyPageContextUpdated(trigger) {
    const previousHref = String(currentPageContext?.href || '');
    const nextHref = String(location?.href || '');
    currentPageContext = {
      href: nextHref,
      timestamp: Date.now()
    };
    try {
      chrome.runtime.sendMessage({
        type: 'PAGE_CONTEXT_UPDATED',
        payload: {
          href: currentPageContext.href,
          timestamp: currentPageContext.timestamp,
          trigger: String(trigger || 'unknown')
        }
      }).catch(() => {});
    } catch (_err) {
      // ignore
    }
    if (nextHref && nextHref !== previousHref) {
      handleSpaLifecycle(trigger, nextHref);
    }
  }

  document.addEventListener('click', (event) => {
    if (event.button !== 0) return;
    notifyPageContextUpdated('click');
  }, true);
  window.addEventListener('hashchange', () => notifyPageContextUpdated('hashchange'), true);
  window.addEventListener('popstate', () => notifyPageContextUpdated('popstate'), true);

  function wrapHistoryMethodForContext(name) {
    const original = history[name];
    if (typeof original !== 'function') return;
    history[name] = function patchedHistoryMethod(...args) {
      const result = original.apply(this, args);
      notifyPageContextUpdated(name);
      return result;
    };
  }
  wrapHistoryMethodForContext('pushState');
  wrapHistoryMethodForContext('replaceState');
  notifyPageContextUpdated('init');

  async function writeClipboardText(text) {
    const value = String(text || '');
    if (!value) return false;
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
        return true;
      }
    } catch (_err) {
      // fallback below
    }
    try {
      const ta = document.createElement('textarea');
      ta.value = value;
      ta.setAttribute('readonly', 'readonly');
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      ta.style.top = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      ta.setSelectionRange(0, ta.value.length);
      const ok = document.execCommand('copy');
      ta.remove();
      return Boolean(ok);
    } catch (_err) {
      return false;
    }
  }

  async function resolveDevQuery() {
    const context = await postToPage('DEV_GET_LIST_CONTEXT', {}, { feature: 'admin', adminCategory: 'debug' });
    if (!context?.ok) return { ok: false, reason: context?.error || 'context_unavailable' };
    const query = String(context.query || '').trim();
    if (!query) return { ok: false, reason: 'query_not_found' };
    return { ok: true, value: query };
  }

  function resolveFieldCodeFromTarget(target) {
    if (!target || typeof target.closest !== 'function') return '';
    const direct = target.closest('[data-field-code]');
    if (direct?.getAttribute) {
      const code = normalizeFieldCode(direct.getAttribute('data-field-code'));
      if (code) return code;
    }
    return '';
  }

  async function resolveFieldCodeByViewMeta(lastContextInfo) {
    const colIndex = Number(lastContextInfo?.cellIndex);
    if (!Number.isInteger(colIndex) || colIndex < 0) {
      return { ok: false, reason: 'cell_index_not_found' };
    }
    const context = await postToPage('DEV_GET_LIST_CONTEXT', {}, { feature: 'admin', adminCategory: 'debug' });
    if (!context?.ok) {
      return { ok: false, reason: 'view_meta_missing' };
    }
    const meta = await postToPage('DEV_GET_VIEW_META', {
      appId: context?.appId || '',
      viewId: context?.viewId || ''
    }, { feature: 'admin', adminCategory: 'debug' });
    if (!meta?.ok) {
      return { ok: false, reason: 'view_meta_missing' };
    }
    const columns = Array.isArray(meta.columns) ? meta.columns : [];
    debugDevField('candidates', {
      lastContextInfo,
      detectedCellIndex: colIndex,
      isHeader: Boolean(lastContextInfo?.isHeader),
      viewColumns: columns
    });
    const candidateIndexes = [colIndex, colIndex - 1, colIndex + 1, colIndex - 2, colIndex + 2]
      .filter((idx) => idx >= 0);
    for (const idx of candidateIndexes) {
      const hit = columns.find((column) => Number(column?.index) === idx) || columns[idx];
      const code = normalizeFieldCode(hit?.fieldCode);
      if (code) {
        return { ok: true, value: code };
      }
    }
    return { ok: false, reason: 'field_code_not_resolved' };
  }

  async function resolveDevFieldCode() {
    const target = devContextState.target;
    const lastContextInfo = devContextState.lastContextInfo;
    if (!target) {
      debugDevField('result', { ok: false, reason: 'no_context_target' });
      return { ok: false, reason: 'no_context_target' };
    }
    debugDevField('start', {
      lastContextInfo
    });

    const overlayFieldCode = normalizeFieldCode(lastContextInfo?.overlayFieldCode || '');
    if (overlayFieldCode) {
      debugDevField('result', { ok: true, source: 'overlay', fieldCode: overlayFieldCode });
      return { ok: true, value: overlayFieldCode };
    }

    const viaViewMeta = await resolveFieldCodeByViewMeta(lastContextInfo);
    if (viaViewMeta?.ok && viaViewMeta?.value) {
      debugDevField('result', { ok: true, source: 'view_meta', fieldCode: viaViewMeta.value });
      return viaViewMeta;
    }

    const fallbackCode = resolveFieldCodeFromTarget(target);
    if (fallbackCode) {
      debugDevField('result', { ok: true, source: 'target_dataset', fieldCode: fallbackCode });
      return { ok: true, value: fallbackCode };
    }

    const reason = viaViewMeta?.reason || 'field_code_not_resolved';
    debugDevField('result', {
      ok: false,
      reason,
      overlayFieldCode: lastContextInfo?.overlayFieldCode || null,
      detectedCellIndex: lastContextInfo?.cellIndex ?? null,
      isHeader: Boolean(lastContextInfo?.isHeader)
    });
    return { ok: false, reason };
  }

  async function copyDevValue(handlerName) {
    const resolver = handlerName === 'query' ? resolveDevQuery : resolveDevFieldCode;
    const resolved = await resolver();
    if (!resolved?.ok || !resolved?.value) {
      return { ok: false, reason: resolved?.reason || 'not_found' };
    }
    const copied = await writeClipboardText(resolved.value);
    if (!copied) {
      if (handlerName === 'field_code') {
        debugDevField('result', { ok: false, reason: 'clipboard_failed' });
      }
      return { ok: false, reason: 'clipboard_failed' };
    }
    console.log('[kfav][DEV] copied', { type: handlerName, value: resolved.value });
    return { ok: true, value: resolved.value };
  }

  function unsupportedAppContextResult() {
    return { ok: false, reason: 'unsupported_page' };
  }

  function shouldRetryAppOnlyInitialization() {
    if (!isSupportedHostPage()) return false;
    try {
      const href = String(location?.href || '');
      if (!href) return false;
      const url = new URL(href);
      return hasAppContextUrlHint(url);
    } catch (_err) {
      return false;
    }
  }

  function ensureAppOnlyFeaturesReady() {
    if (appOnlyFeaturesInitialized) return true;
    return initAppOnlyFeatures();
  }

  async function waitForAppContextAndInit() {
    if (ensureAppOnlyFeaturesReady()) return true;
    if (!shouldRetryAppOnlyInitialization()) return false;
    if (appOnlyInitWaitPromise) return appOnlyInitWaitPromise;
    appOnlyInitWaitPromise = new Promise((resolve) => {
      let attempts = 0;
      const run = () => {
        attempts += 1;
        if (ensureAppOnlyFeaturesReady()) {
          appOnlyInitWaitPromise = null;
          resolve(true);
          return;
        }
        if (attempts >= APP_CONTEXT_INIT_MAX_ATTEMPTS) {
          appOnlyInitWaitPromise = null;
          resolve(false);
          return;
        }
        window.setTimeout(run, APP_CONTEXT_INIT_RETRY_INTERVAL_MS);
      };
      run();
    });
    return appOnlyInitWaitPromise;
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    (async () => {
      try {
        if (msg?.type === 'DEV_COPY_QUERY') {
          if (!(await waitForAppContextAndInit())) {
            sendResponse(unsupportedAppContextResult()); return;
          }
          const result = await copyDevValue('query');
          sendResponse(result); return;
        }
        if (msg?.type === 'DEV_COPY_TEXT') {
          const text = String(msg?.text || '');
          const label = String(msg?.label || 'text');
          if (!text) {
            sendResponse({ ok: false, reason: 'empty_text' }); return;
          }
          const copied = await writeClipboardText(text);
          if (!copied) {
            console.warn('[kfav][DEV] copy failed', { reason: 'clipboard_failed', label });
            sendResponse({ ok: false, reason: 'clipboard_failed' }); return;
          }
          console.log('[kfav][DEV] copied', { type: label });
          sendResponse({ ok: true }); return;
        }
        if (msg?.type === 'DEV_COPY_FIELD_CODE') {
          if (!(await waitForAppContextAndInit())) {
            sendResponse(unsupportedAppContextResult()); return;
          }
          const result = await copyDevValue('field_code');
          sendResponse(result); return;
        }
        if (msg?.type === 'COUNT_BULK') {
          const res = await postToPage('COUNT_BULK', msg.payload, { feature: 'watchlist' });
          sendResponse(res); return;
        }
        if (msg?.type === 'PING_CONTENT') {
          sendResponse({ ok: true }); return;
        }
        if (msg?.type === 'COUNT_VIEW') {
          const res = await postToPage('COUNT_VIEW', msg.payload, { feature: 'watchlist' });
          sendResponse(res); return;
        }
        if (msg?.type === 'COUNT_APP_QUERY') {
          const res = await postToPage('COUNT_APP_QUERY', msg.payload, { feature: 'watchlist' });
          sendResponse(res); return;
        }
        if (msg?.type === 'LIST_VIEWS') {
          const res = await postToPage('LIST_VIEWS', msg.payload, { feature: 'watchlist' });
          sendResponse(res); return;
        }
        if (msg?.type === 'LIST_SCHEDULE') {
          const res = await postToPage('LIST_SCHEDULE', msg.payload, { feature: 'watchlist' });
          sendResponse(res); return;
        }
        if (msg?.type === 'LIST_FIELDS') {
          const res = await postToPage('LIST_FIELDS', msg.payload, { feature: 'watchlist' });
          sendResponse(res); return;
        }
        if (msg?.type === 'PIN_FETCH') {
          const res = await postToPage('PIN_FETCH', msg.payload, { feature: 'record_pin' });
          sendResponse(res); return;
        }
        if (msg?.type === 'GET_APP_NAME') {
          const res = await postToPage('GET_APP_NAME', msg.payload, { feature: 'admin', adminCategory: 'app_cache' });
          sendResponse(res); return;
        }
        if (msg?.type === 'META_GET_APP') {
          const res = await postToPage('META_GET_APP', msg.payload, { feature: 'metadata_app' });
          sendResponse(res); return;
        }
        if (msg?.type === 'META_GET_VIEWS') {
          const res = await postToPage('META_GET_VIEWS', msg.payload, { feature: 'metadata_views' });
          sendResponse(res); return;
        }
        if (msg?.type === 'META_GET_FIELDS') {
          const res = await postToPage('META_GET_FIELDS', msg.payload, { feature: 'metadata_fields' });
          sendResponse(res); return;
        }
        if (msg?.type === 'CHECK_KINTONE_READY') {
          const res = await postToPage('CHECK_KINTONE_READY', msg.payload, { feature: 'bootstrap', adminCategory: 'bootstrap' });
          sendResponse(res); return;
        }
        if (msg?.type === 'EXCEL_GET_OVERLAY_LAUNCH_STATE') {
          const res = await getOverlayLaunchState();
          sendResponse(res); return;
        }
        if (msg?.type === 'EXCEL_OPEN_OVERLAY_FROM_SIDEPANEL') {
          if (!(await waitForAppContextAndInit())) {
            sendResponse({ ok: false, reason: 'app_context_not_ready' }); return;
          }
          const res = await openOverlayByCurrentPage('sidepanel');
          sendResponse(res); return;
        }
        sendResponse({ ok: false, error: 'Unknown message type' });
      } catch (e) {
        sendResponse({ ok: false, error: String(e?.message || e) });
      }
    })();
    return true;
  });

  const RECENT_TRACK_INTERVAL_MS = 500;
  const RECENT_UPSERT_COOLDOWN_MS = 2000;
  let lastObservedHref = '';
  let lastRecentId = '';
  let lastRecentAt = 0;

  function isKintoneHostName(hostname) {
    return /\.kintone(?:-dev)?\.com$/.test(hostname) || /\.cybozu\.com$/.test(hostname);
  }

  function parseRecentRecordFromUrl(rawUrl) {
    try {
      const url = new URL(rawUrl);
      if (!isKintoneHostName(url.hostname)) return null;
      const appMatch = url.pathname.match(/\/k\/(\d+)\/show(?:\/|$)/);
      if (!appMatch) return null;
      const appId = appMatch[1];
      const hash = String(url.hash || '');
      const hashMatch = hash.match(/(?:^#|[?&])record=(\d+)/);
      const searchMatch = String(url.search || '').match(/[?&]record=(\d+)/);
      const recordId = (hashMatch && hashMatch[1]) || (searchMatch && searchMatch[1]) || '';
      if (!recordId) return null;
      const host = url.origin.replace(/\/$/, '');
      const normalizedUrl = `${host}/k/${encodeURIComponent(appId)}/show#record=${encodeURIComponent(recordId)}`;
      let appName = '';
      try {
        if (typeof window.kintone?.app?.getName === 'function') {
          appName = String(window.kintone.app.getName() || '').trim();
        }
      } catch (_err) {
        appName = '';
      }
      const now = Date.now();
      return {
        id: `${host}|${appId}|${recordId}`,
        host,
        appId,
        recordId,
        appName,
        url: normalizedUrl,
        visitedAt: now
      };
    } catch (_err) {
      return null;
    }
  }

  function parseDetailOverlayContext(rawUrl) {
    const parsed = parseRecentRecordFromUrl(rawUrl);
    if (!parsed) return null;
    const appId = String(parsed.appId || '').trim();
    const recordId = String(parsed.recordId || '').trim();
    if (!appId || !recordId) return null;
    return {
      appId,
      recordId,
      href: String(rawUrl || location.href)
    };
  }

  function parseListOverlayContext(rawUrl) {
    try {
      const url = new URL(rawUrl || location.href);
      if (!isKintoneHostName(url.hostname)) return null;
      const match = String(url.pathname || '').match(/^\/k\/(\d+)\/?$/);
      if (!match) return null;
      return {
        appId: String(match[1] || '').trim(),
        href: String(rawUrl || location.href)
      };
    } catch (_err) {
      return null;
    }
  }

  function tryUpsertRecentRecord() {
    const record = parseRecentRecordFromUrl(location.href);
    if (!record) return;
    const now = Date.now();
    if (record.id === lastRecentId && (now - lastRecentAt) < RECENT_UPSERT_COOLDOWN_MS) return;
    lastRecentId = record.id;
    lastRecentAt = now;
    chrome.runtime.sendMessage({ type: 'RECENT_UPSERT', payload: record }).catch(() => {});
  }

  function startRecentRecordWatcher() {
    if (recentWatcherStarted) return;
    recentWatcherStarted = true;
    lastObservedHref = location.href;
    tryUpsertRecentRecord();
    setInterval(() => {
      const currentHref = location.href;
      if (currentHref === lastObservedHref) return;
      lastObservedHref = currentHref;
      tryUpsertRecentRecord();
    }, RECENT_TRACK_INTERVAL_MS);
  }

  const overlayTexts = {
    ja: {
      title: "Excelモード",
      loading: "読み込み中…",
      loadFailed: "データの取得に失敗しました",
      noEditableFields: "編集可能なフィールドがありません",
      btnSave: "保存",
      btnSaving: "保存中...",
      btnUndo: "↶ Undo",
      btnRedo: "↷ Redo",
      titleUndo: "元に戻す (Ctrl+Z)",
      titleRedo: "やり直し (Ctrl+Y)",
      btnAddRow: "＋ 行追加",
      btnPrev: "◀ 前へ",
      btnNext: "次へ ▶",
      btnClose: "閉じる",
      modeViewOnly: "Standard",
      toastNoChanges: "変更はありません",
      toastInvalidCells: "エラーを解消してから保存してください",
      toastRequiredMissing: "必須項目を入力してください",
      toastViewOnlyBlocked: "Proモードで利用できます",
      overlayProOnly: "Proモードで利用できます",
      overlayStandardReadonly: "Standardでは閲覧のみ利用できます",
      overlayProComingSoon: "Proモードは近日公開予定です",
      lookupAutoReadonly: "LOOKUPにより自動入力されるため編集できません",
      toastSaveSuccess: "保存しました",
      toastSaveFailed: "保存に失敗しました",
      confirmClose: "未保存の変更があります。閉じますか？",
      confirmPageMoveUnsaved: "未保存の変更があります。ページを移動しますか？",
      reloading: "一覧を更新しています…",
      conflictRetry: "最新のデータを反映して再保存します…",
      conflictNoChanges: "最新のデータと一致しました",
      conflictFailed: "他の変更と競合し保存できませんでした",
      btnSubtableEdit: "編集",
      subtableTitle: "サブテーブル編集",
      subtableClose: "閉じる",
      subtableAddRow: "＋ 行追加",
      subtableAutoWidth: "自動調整",
      subtableReloadLayout: "レイアウト再取得",
      subtableOpen: "開く",
      subtableRemoveRow: "削除",
      subtableSave: "保存",
      subtableCancel: "キャンセル",
      subtableRows: (n) => `${n} 行`,
      subtableEmpty: "行がありません",
      subtableActionsAria: "操作",
      toastSubtableLayoutReloaded: "レイアウトを再取得しました",
      toastSubtableLayoutReloadFailed: "レイアウトの再取得に失敗しました",
      multilineTitle: "複数行テキスト編集",
      multilineSave: "保存",
      multilineCancel: "キャンセル",
      multiChoiceTitle: "複数選択",
      multiChoiceApply: "適用",
      multiChoiceClear: "クリア",
      richTextReadonly: "リッチテキストは閲覧のみ対応です",
      permNoAdd: "追加権限がありません",
      permNoEdit: "編集権限がありません",
      permNoFieldEdit: "このフィールドは編集できません",
      permNoDelete: "削除権限がありません",
      permUnknown: "権限未判定",
      permWarningUnknown: "権限を確認できないため、一部編集を無効化しています",
      permViewOnly: "閲覧のみ",
      permEditable: "編集可",
      permDeletable: "削除可",
      rowDeletePending: "削除予定",
      rowDeleteToggle: "削除予定にする",
      rowDeleteUndo: "削除予定を解除",
      rowDeleteNewUndo: "新規行を取消",
      rowDeletePendingTitle: "削除予定（保存時に削除）",
      toastPasteSkipped: (n) => `${n}件のセルを権限によりスキップしました`,
      toastCopySuccess: "コピーしました",
      toastCopyFailed: "コピーに失敗しました",
      dirtyLabel: (n) => `未保存: ${n}`,
      statusSum: "合計",
      statusAvg: "平均",
      statusCount: "件数",
      statusSelectedCells: "選択セル",
      statusFilteredRows: "フィルタ後",
      statusPendingDeletes: "削除予定",
      statusNewRows: "新規行",
      btnColumns: "列順",
      layoutPresetLabel: "レイアウト",
      layoutPresetSave: "保存",
      layoutPresetDuplicate: "複製",
      layoutPresetRename: "名前変更",
      layoutPresetDelete: "削除",
      layoutPresetMenu: "レイアウト操作",
      layoutPresetDefault: "標準",
      layoutPresetNewName: "新しいレイアウト",
      layoutPresetDeleteConfirm: "このレイアウトを削除しますか？",
      layoutPresetPromptName: "レイアウト名を入力してください",
      btnFieldsViewOnly: "ビュー",
      btnFieldsAll: "全項目",
      titleFieldsViewOnly: "現在のビュー項目のみ表示",
      titleFieldsAll: "全項目を表示",
      btnLayoutGrid: "Grid",
      btnLayoutForm: "Form",
      titleLayoutGrid: "グリッド表示",
      titleLayoutForm: "縦表示",
      formFieldHeader: "Field",
      formValueHeader: "Value",
      filterButton: "フィルター",
      filterTitle: "フィルター",
      filterContains: "含む",
      filterEquals: "一致",
      filterStartsWith: "前方一致",
      filterFrom: "開始",
      filterTo: "終了",
      filterClear: "クリア",
      filterApply: "適用",
      columnsTitle: "列の並び替え",
      columnsHint: "ヘッダーをドラッグして並び順を変え、幅はドラッグまたは自動調整ボタンで変更できます。",
      columnsVisibilityTitle: "表示列",
      columnsAutoWidth: "自動調整",
      columnsSave: "列順を保存",
      columnsReset: "リセット",
      columnsClose: "閉じる",
      columnsEmpty: "列情報がありません",
      toastColumnsSaved: "列順を保存しました",
      toastColumnsReset: "列順をリセットしました",
      toastColumnsAutoWidth: "列幅を自動調整しました",
      toastLayoutPresetSaved: "レイアウトを保存しました",
      toastLayoutPresetDeleted: "レイアウトを削除しました",
      toastLayoutPresetRenamed: "レイアウト名を変更しました",
      toastLayoutPresetDuplicated: "レイアウトを複製しました",
      errorUnsupportedFilter: "この一覧には一時的なフィルター/ソートが含まれているため、Excelモードを起動できません。ビューを標準状態に戻してから再試行してください。",
      overlayUnsupportedPage: "この画面では Excel Overlay を利用できません。一覧/詳細画面で利用できます。"
    },
    en: {
      title: "Excel mode",
      loading: "Loading…",
      loadFailed: "Failed to load data",
      noEditableFields: "No editable fields found",
      btnSave: "Save",
      btnSaving: "Saving...",
      btnUndo: "↶ Undo",
      btnRedo: "↷ Redo",
      titleUndo: "Undo (Ctrl+Z)",
      titleRedo: "Redo (Ctrl+Y)",
      btnAddRow: "+ Add row",
      btnPrev: "◀ Prev",
      btnNext: "Next ▶",
      btnClose: "Close",
      modeViewOnly: "Standard",
      toastNoChanges: "No changes",
      toastInvalidCells: "Fix errors before saving",
      toastRequiredMissing: "Please fill required fields",
      toastViewOnlyBlocked: "Available in Pro mode",
      overlayProOnly: "Available in Pro mode",
      overlayStandardReadonly: "Editing is disabled in Standard mode",
      overlayProComingSoon: "Pro mode is coming soon",
      lookupAutoReadonly: "This field is auto-populated by LOOKUP and cannot be edited",
      toastSaveSuccess: "Changes saved",
      toastSaveFailed: "Failed to save changes",
      confirmClose: "You have unsaved changes. Close anyway?",
      confirmPageMoveUnsaved: "You have unsaved changes. Move to another page?",
      reloading: "Refreshing list…",
      conflictRetry: "Data updated, retrying save…",
      conflictNoChanges: "Your edits now match the latest data",
      conflictFailed: "Conflicted with other changes; save aborted",
      btnSubtableEdit: "Edit",
      subtableTitle: "Edit subtable",
      subtableClose: "Close",
      subtableAddRow: "+ Add row",
      subtableAutoWidth: "Auto width",
      subtableReloadLayout: "Reload layout",
      subtableOpen: "Open",
      subtableRemoveRow: "Delete",
      subtableSave: "Save",
      subtableCancel: "Cancel",
      subtableRows: (n) => (n === 1 ? '1 row' : `${n} rows`),
      subtableEmpty: "No rows",
      subtableActionsAria: "Actions",
      toastSubtableLayoutReloaded: "Layout reloaded",
      toastSubtableLayoutReloadFailed: "Failed to reload layout",
      multilineTitle: "Edit multi-line text",
      multilineSave: "Save",
      multilineCancel: "Cancel",
      multiChoiceTitle: "Multiple choice",
      multiChoiceApply: "Apply",
      multiChoiceClear: "Clear",
      richTextReadonly: "Rich text is view-only",
      permNoAdd: "No add permission",
      permNoEdit: "No edit permission",
      permNoFieldEdit: "This field cannot be edited",
      permNoDelete: "No delete permission",
      permUnknown: "Permission unknown",
      permWarningUnknown: "Permissions could not be verified, so some editing is disabled",
      permViewOnly: "View only",
      permEditable: "Editable",
      permDeletable: "Deletable",
      rowDeletePending: "Pending delete",
      rowDeleteToggle: "Mark row for delete",
      rowDeleteUndo: "Unmark delete",
      rowDeleteNewUndo: "Discard new row",
      rowDeletePendingTitle: "Pending delete (will delete on save)",
      toastPasteSkipped: (n) => `${n} cells were skipped due to permissions`,
      toastCopySuccess: "Copied",
      toastCopyFailed: "Copy failed",
      dirtyLabel: (n) => `Unsaved: ${n}`,
      statusSum: "Sum",
      statusAvg: "Avg",
      statusCount: "Count",
      statusSelectedCells: "Selected",
      statusFilteredRows: "Filtered",
      statusPendingDeletes: "Pending delete",
      statusNewRows: "New rows",
      btnColumns: "Columns",
      layoutPresetLabel: "Layout",
      layoutPresetSave: "Save",
      layoutPresetDuplicate: "Duplicate",
      layoutPresetRename: "Rename",
      layoutPresetDelete: "Delete",
      layoutPresetMenu: "Layout actions",
      layoutPresetDefault: "Default",
      layoutPresetNewName: "New layout",
      layoutPresetDeleteConfirm: "Delete this layout?",
      layoutPresetPromptName: "Enter layout name",
      btnFieldsViewOnly: "View",
      btnFieldsAll: "All fields",
      titleFieldsViewOnly: "Show only fields in current view",
      titleFieldsAll: "Show all fields",
      btnLayoutGrid: "Grid",
      btnLayoutForm: "Form",
      titleLayoutGrid: "Grid layout",
      titleLayoutForm: "Form layout",
      formFieldHeader: "Field",
      formValueHeader: "Value",
      filterButton: "Filter",
      filterTitle: "Filter",
      filterContains: "contains",
      filterEquals: "equals",
      filterStartsWith: "starts with",
      filterFrom: "from",
      filterTo: "to",
      filterClear: "Clear",
      filterApply: "Apply",
      columnsTitle: "Reorder columns",
      columnsHint: "Drag the header chips below to reorder columns, then save the layout for future sessions.",
      columnsVisibilityTitle: "Visible columns",
      columnsAutoWidth: "Auto width",
      columnsSave: "Save order",
      columnsReset: "Reset",
      columnsClose: "Close",
      columnsEmpty: "No columns available",
      toastColumnsSaved: "Column order saved",
      toastColumnsReset: "Column order reset",
      toastColumnsAutoWidth: "Column widths adjusted",
      toastLayoutPresetSaved: "Layout saved",
      toastLayoutPresetDeleted: "Layout deleted",
      toastLayoutPresetRenamed: "Layout renamed",
      toastLayoutPresetDuplicated: "Layout duplicated",
      errorUnsupportedFilter: "This list has ad-hoc filters/sorting that cannot be replayed in Excel mode. Clear the filter and try again.",
      overlayUnsupportedPage: "Excel Overlay is only available on list/detail pages."
    }
  };

  const overlayConfig = {
    limit: 100,
    allowedTypes: new Set([
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
      'LOOKUP',
      'FILE'
    ])
  };

  const UI_LANGUAGE_KEY = 'uiLanguage';
  const UI_LANGUAGE_VALUES = ['auto', 'ja', 'en'];
  const DEFAULT_UI_LANGUAGE = 'auto';
  const DEFAULT_OVERLAY_LANGUAGE = 'ja';

  const COLUMN_PREF_STORAGE_KEY = 'kfavExcelColumns';
  const OVERLAY_LAYOUT_PRESETS_KEY = 'kfavOverlayLayoutPresets';
  const SUBTABLE_WIDTH_PREF_STORAGE_KEY = 'kfavExcelSubtableWidths';
  const EXCEL_OVERLAY_MODE_KEY = 'kfavExcelOverlayMode';
  const EXCEL_OVERLAY_MODE_STANDARD = 'standard';
  const EXCEL_OVERLAY_MODE_PRO = 'pro';
  const DEFAULT_EXCEL_OVERLAY_MODE = EXCEL_OVERLAY_MODE_STANDARD;
  const EXCEL_OVERLAY_MODE_VALUES = new Set([EXCEL_OVERLAY_MODE_STANDARD, EXCEL_OVERLAY_MODE_PRO]);
  const OVERLAY_RUNTIME_MODE_LIST = 'list';
  const OVERLAY_RUNTIME_MODE_DETAIL_SINGLE_ROW = 'detail-single-row';
  const OVERLAY_LAYOUT_MODE_GRID = 'grid';
  const OVERLAY_LAYOUT_MODE_FORM = 'form';
  const LIST_FIELD_SCOPE_VIEW_ONLY = 'view-only';
  const LIST_FIELD_SCOPE_ALL_FIELDS = 'all-fields';
  const MAX_COLUMN_PREF_ENTRIES = 80;
  const MAX_LAYOUT_PRESET_APP_ENTRIES = 80;
  const MAX_LAYOUT_PRESET_COUNT = 12;
  const MAX_SUBTABLE_WIDTH_PREF_ENTRIES = 160;
  const DEFAULT_COLUMN_WIDTH = 160;
  const MIN_COLUMN_WIDTH = 96;
  const MAX_COLUMN_WIDTH = 320;

  let overlayCssLoaded = false;

  function normalizeUiLanguage(raw) {
    const value = String(raw || '').trim().toLowerCase();
    if (!value) return DEFAULT_OVERLAY_LANGUAGE;
    if (value === 'ja' || value.startsWith('ja-')) return 'ja';
    return 'en';
  }

  function normalizeUiLanguageSetting(raw) {
    const value = String(raw || '').trim().toLowerCase();
    if (UI_LANGUAGE_VALUES.includes(value)) return value;
    return DEFAULT_UI_LANGUAGE;
  }

  function getBrowserUiLanguage() {
    try {
      const browserLang = navigator.language || (Array.isArray(navigator.languages) ? navigator.languages[0] : '');
      return normalizeUiLanguage(browserLang);
    } catch (_err) {
      return DEFAULT_OVERLAY_LANGUAGE;
    }
  }

  function resolveEffectiveUiLanguage(setting) {
    if (setting === 'ja' || setting === 'en') return setting;
    return getBrowserUiLanguage();
  }

  async function resolveOverlayUiLanguage() {
    let setting = DEFAULT_UI_LANGUAGE;
    try {
      const stored = await chrome.storage.local.get(UI_LANGUAGE_KEY);
      setting = normalizeUiLanguageSetting(stored?.[UI_LANGUAGE_KEY]);
    } catch (_err) {
      setting = DEFAULT_UI_LANGUAGE;
    }
    return {
      setting,
      language: resolveEffectiveUiLanguage(setting)
    };
  }

  function resolveText(language, key, ...args) {
    const primary = overlayTexts[language] || {};
    const value = primary[key];
    if (typeof value === 'function') return value(...args);
    if (typeof value === 'string') return value;
    const fallbackJa = overlayTexts.ja?.[key];
    if (typeof fallbackJa === 'function') return fallbackJa(...args);
    if (typeof fallbackJa === 'string') return fallbackJa;
    return key;
  }

  function normalizeExcelOverlayMode(value) {
    if (value === 'edit') return EXCEL_OVERLAY_MODE_PRO;
    if (value === 'view' || value === 'off') return EXCEL_OVERLAY_MODE_STANDARD;
    return EXCEL_OVERLAY_MODE_VALUES.has(value) ? value : DEFAULT_EXCEL_OVERLAY_MODE;
  }

  function createPermissionServiceSafe() {
    if (typeof createPermissionService === 'function') {
      return createPermissionService();
    }
    return {
      init() {},
      setFields() {},
      setAppPermission() {},
      setPendingDeletes() {},
      refreshRecordAcl() {},
      upsertRecordAcl() {},
      removeRecordAcl() {},
      clearRecordAcl() {},
      canEditRecord() { return false; },
      canDeleteRecord() { return false; },
      canAddRow() { return false; },
      canEditCell() { return false; },
      getCellPermission() { return { editable: false, reason: 'no_acl' }; },
      filterPasteTargets(targets) {
        return { applicable: [], skipped: Array.isArray(targets) ? targets : [] };
      },
      isSystemField() { return true; },
      isLookupField() { return false; },
      isFieldTypeEditable() { return false; }
    };
  }

  function createProServiceSafe() {
    if (typeof createProService === 'function') {
      return createProService();
    }
    return {
      async getDeveloperOverride() { return false; },
      async setDeveloperOverride() {},
      async getProAccessState() {
        return {
          enabled: false,
          reason: 'service_unavailable',
          source: 'fallback'
        };
      },
      async isProEnabled() { return false; },
      async canUseProFeature() { return false; },
      clearCaches() {}
    };
  }

  function columnLabel(index) {
    let n = index;
    let label = '';
    while (n >= 0) {
      const char = String.fromCharCode(65 + (n % 26));
      label = char + label;
      n = Math.floor(n / 26) - 1;
    }
    return label;
  }

  class ExcelOverlayController {
    constructor(postFn) {
      this.postFn = postFn;
      this.permissionService = createPermissionServiceSafe();
      this.proService = createProServiceSafe();
      this.isOpen = false;
      this.root = null;
      this.surface = null;
      this.bodyScroll = null;
      this.columnHeaderScroll = null;
      this.rowHeaderScroll = null;
      this.toastHost = null;
      this.loadingEl = null;
      this.permissionWarningEl = null;
      this.dirtyBadge = null;
      this.saveButton = null;
      this.saveButtonSpinner = null;
      this.saveButtonLabel = null;
      this.undoButton = null;
      this.redoButton = null;
      this.closeButton = null;
      this.addRowButton = null;
      this.titleElement = null;
      this.layoutToggleWrap = null;
      this.gridLayoutButton = null;
      this.formLayoutButton = null;
      this.fieldScopeToggleWrap = null;
      this.fieldScopeViewButton = null;
      this.fieldScopeAllButton = null;
      this.layoutPresetWrap = null;
      this.layoutPresetLabel = null;
      this.layoutPresetSelect = null;
      this.layoutPresetMenuButton = null;
      this.layoutPresetMenu = null;
      this.layoutPresetMenuOpen = false;
      this.layoutPresetSaveButton = null;
      this.layoutPresetDuplicateButton = null;
      this.layoutPresetRenameButton = null;
      this.layoutPresetDeleteButton = null;
      this.prevPageButton = null;
      this.nextPageButton = null;
      this.pageLabelElement = null;
      this.appName = '';
      this.statsElements = {
        sum: null,
        avg: null,
        count: null,
        selected: null,
        filtered: null,
        pendingDelete: null,
        newRows: null
      };
      this.language = 'ja';
      this.uiLanguageSetting = DEFAULT_UI_LANGUAGE;
      this.appName = '';
      this.overlayMode = DEFAULT_EXCEL_OVERLAY_MODE;
      this.proEntitlement = false;
      this.proAccessState = {
        enabled: false,
        reason: 'unknown',
        source: 'none'
      };
      this.runtimeMode = OVERLAY_RUNTIME_MODE_LIST;
      this.overlayLayoutMode = OVERLAY_LAYOUT_MODE_GRID;
      this.listFieldScopeMode = LIST_FIELD_SCOPE_ALL_FIELDS;
      this.detailRecordId = '';
      this.detailAppId = '';
      this.detailSourceUrl = '';
      this.modeBadge = null;
      this.viewOnlyNoticeShown = false;
      this.appId = null;
      this.baseQuery = '';
      this.query = '';
      this.pageSize = 100;
      this.pageOffset = 0;
      this.totalCount = 0;
      this.paging = false;
      this.fields = [];
      this.fieldsMeta = [];
      this.listAllFields = [];
      this.viewFieldOrder = [];
      this.recordFetchFieldCodes = [];
      this.fieldMap = new Map();
      this.fieldsMetaMap = new Map();
      this.fieldIndexMap = new Map();
      this.rows = [];
      this.rowMap = new Map();
      this.rowIndexMap = new Map();
      this.aclStatus = { loaded: false, failed: false };
      this.pendingDeletes = new Set();
      this.filters = new Map();
      this.filteredRowIds = null;
      this.filterPanel = null;
      this.needsFilterReapply = false;
      this.sortState = { fieldCode: '', direction: '' };
      this.undoStack = [];
      this.redoStack = [];
      this.isReplayingHistory = false;
      this.maxHistory = 100;
      this.diff = new Map();
      this.invalidCells = new Set();
      this.revisionMap = new Map();
      this.isComposing = false;
      this.saving = false;
      this.handleScroll = this.syncScroll.bind(this);
      this.handleKeyOnOverlay = this.handleOverlayKeydown.bind(this);
      this.handleGlobalArrowKeyCapture = this.handleOverlayGlobalArrowKeydown.bind(this);
      this.handleLayoutPresetMenuOutsidePointerDown = this.handleLayoutPresetMenuOutsidePointerDown.bind(this);
      this.handleLayoutPresetMenuKeyDown = this.handleLayoutPresetMenuKeyDown.bind(this);
      this.handleCompositionStart = () => { this.isComposing = true; };
      this.handleCompositionEnd = () => { this.isComposing = false; };
      this.requireReload = false;
      this.previousFocus = null;
      this.bodyOverflowBackup = '';
      this.reloading = false;
      this.rowHeight = 32;
      this.virtualStart = 0;
      this.virtualEnd = 0;
      this.rowHeaderContainer = null;
      this.tableContainer = null;
      this.gridRoot = null;
      this.gridHead = null;
      this.gridBody = null;
      this.detailFormContainer = null;
      this.inputsByRow = new Map();
      this.pendingFocus = null;
      this.pendingEdit = null;
      this.invalidValueCache = new Map();
      this.selection = null;
      this.armedCell = null;
      this.navigating = false;
      this.dragSelecting = false;
      this.editingCell = null;
      this.handleMouseUp = this.endSelection.bind(this);
      this.columnPrefCache = null;
      this.overlayLayoutPresetCache = null;
      this.overlayLayoutState = null;
      this.subtableWidthPrefCache = null;
      this.formLayoutCache = null;
      this.subtableLayoutOrderCache = new Map();
      this.viewKey = 'default';
      this.viewName = '';
      this.viewId = '';
      this.columnPanelLayer = null;
      this.columnPreviewRow = null;
      this.columnOrderDraft = [];
      this.columnVisibilityDraft = new Set();
      this.columnDraftAllFieldCodes = [];
      this.columnVisibilityList = null;
      this.columnButton = null;
      this.defaultFieldCodes = [];
      this.draggingColumnCode = null;
      this.columnWidthsDraft = new Map();
      this.radioPicker = null;
      this.multiChoicePicker = null;
      this.multilineEditor = null;
      this.newRowSeq = 1;
      this.subtableEditor = null;
      this.pasteFlashTimer = null;
      this.subtableActivationTs = 0;
      this.boundRadioPickerScrollHandler = () => { this.repositionRadioPicker(); };
      this.boundRadioPickerResizeHandler = () => { this.repositionRadioPicker(); };
      this.boundRadioPickerOutsideClick = (event) => {
        if (!this.radioPicker) return;
        const panel = this.radioPicker.panel;
        const input = this.radioPicker.input;
        if (!panel) return;
        if (panel.contains(event.target) || input === event.target) return;
        this.closeRadioPicker();
      };
      this.boundMultiChoicePickerScrollHandler = () => { this.repositionMultiChoicePicker(); };
      this.boundMultiChoicePickerResizeHandler = () => { this.repositionMultiChoicePicker(); };
      this.boundMultiChoicePickerOutsideClick = (event) => {
        if (!this.multiChoicePicker) return;
        const panel = this.multiChoicePicker.panel;
        const input = this.multiChoicePicker.input;
        if (!panel) return;
        if (panel.contains(event.target) || input === event.target) return;
        this.closeMultiChoicePicker(true);
      };
      this.boundFilterPanelOutsideClick = (event) => {
        if (!this.filterPanel) return;
        const panel = this.filterPanel.panel;
        const button = this.filterPanel.button;
        if (!panel) return;
        if (panel.contains(event.target)) return;
        if (button && (button === event.target || button.contains(event.target))) return;
        this.closeFilterPanel();
      };
      this.boundUiLanguageStorageChanged = this.handleUiLanguageStorageChanged.bind(this);
      this.uiLanguageListenerAttached = false;
    }

    async open(options = {}) {
      if (this.isOpen) return;
      await this.loadOverlayMode();
      const requestedRuntimeMode = String(options?.runtimeMode || OVERLAY_RUNTIME_MODE_LIST);
      this.runtimeMode = requestedRuntimeMode === OVERLAY_RUNTIME_MODE_DETAIL_SINGLE_ROW
        ? OVERLAY_RUNTIME_MODE_DETAIL_SINGLE_ROW
        : OVERLAY_RUNTIME_MODE_LIST;
      this.overlayLayoutMode = this.runtimeMode === OVERLAY_RUNTIME_MODE_DETAIL_SINGLE_ROW
        ? OVERLAY_LAYOUT_MODE_FORM
        : OVERLAY_LAYOUT_MODE_GRID;
      this.listFieldScopeMode = LIST_FIELD_SCOPE_ALL_FIELDS;
      this.detailRecordId = String(options?.detailRecordId || '').trim();
      this.detailAppId = String(options?.detailAppId || '').trim();
      this.detailSourceUrl = String(options?.detailSourceUrl || location.href || '').trim();
      if (this.runtimeMode === OVERLAY_RUNTIME_MODE_DETAIL_SINGLE_ROW) {
        const detailContext = this.resolveDetailRecordContext();
        if (!detailContext || !detailContext.recordId) return;
        this.detailRecordId = detailContext.recordId;
        if (!this.detailAppId) this.detailAppId = detailContext.appId || '';
      }
      console.log('[overlay] mode flags', this.getOverlayModeFlags());
      this.isOpen = true;
      try {
        this.previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        this.bodyOverflowBackup = document.body.style.overflow || '';
        document.body.style.overflow = 'hidden';
        this.requireReload = false;
        this.viewOnlyNoticeShown = false;
        await this.ensureStyles();
        await this.loadLanguage();
        this.attachUiLanguageListener();
        this.mountShell();
        this.showLoading(resolveText(this.language, 'loading'));
        await this.fetchData();
        this.hideLoading();
        if (!this.fields.length) {
          this.renderNoFields();
          return;
        }
        console.log('[overlay] render grid start');
        this.renderGrid();
        this.attachEvents();
        this.updateDirtyBadge();
        this.updateStats();
        this.focusFirstCell();
      } catch (error) {
        this.hideLoading();
        this.notify(resolveText(this.language, 'loadFailed'));
        console.error('[kintone-excel-overlay] failed to open overlay', error);
        this.close(true);
      }
    }

    async ensureStyles() {
      if (overlayCssLoaded) return;
      overlayCssLoaded = true;
      const href = chrome.runtime.getURL('overlay.css');
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = href;
      link.dataset.pbOverlay = 'true';
      document.head.appendChild(link);
    }

    mountShell() {
      this.root = document.createElement('div');
      this.root.id = 'pb-excel-overlay';
      this.root.className = 'pb-overlay';

      const surface = document.createElement('div');
      surface.className = 'pb-overlay__surface';
      this.surface = surface;

      const toolbar = this.buildToolbar();
      const permissionWarning = document.createElement('div');
      permissionWarning.className = 'pb-overlay__perm-warning pb-overlay__perm-warning--hidden';
      permissionWarning.textContent = resolveText(this.language, 'permWarningUnknown');
      this.permissionWarningEl = permissionWarning;
      const grid = this.buildGridShell();
      const status = this.buildStatusBar();
      const toastHost = document.createElement('div');
      toastHost.className = 'pb-overlay__toast-host toast-container';
      this.toastHost = toastHost;

      surface.appendChild(toolbar);
      surface.appendChild(permissionWarning);
      surface.appendChild(grid);
      surface.appendChild(status);
      this.root.appendChild(surface);
      this.root.appendChild(toastHost);
      document.body.appendChild(this.root);
    }

    buildToolbar() {
      const toolbar = document.createElement('div');
      toolbar.className = 'pb-overlay__toolbar';

      const titleWrap = document.createElement('div');
      titleWrap.className = 'pb-overlay__toolbar-left';
      const title = document.createElement('span');
      title.className = 'pb-overlay__title';
      title.textContent = this.appName || resolveText(this.language, 'title');
      this.titleElement = title;
      titleWrap.appendChild(title);
      if (this.isOverlayViewOnly()) {
        const badge = document.createElement('span');
        badge.className = 'pb-overlay__mode-badge';
        badge.textContent = resolveText(this.language, 'modeViewOnly');
        this.modeBadge = badge;
        titleWrap.appendChild(badge);
      }

      const actions = document.createElement('div');
      actions.className = 'pb-overlay__toolbar-actions';

      const pager = document.createElement('div');
      pager.className = 'pb-overlay__pager';
      const prevBtn = document.createElement('button');
      prevBtn.type = 'button';
      prevBtn.className = 'pb-overlay__btn pb-overlay__btn--pager';
      prevBtn.textContent = resolveText(this.language, 'btnPrev');
      this.prevPageButton = prevBtn;
      const pageLabel = document.createElement('span');
      pageLabel.className = 'pb-overlay__pager-label';
      pageLabel.textContent = '0-0 / 0';
      this.pageLabelElement = pageLabel;
      const nextBtn = document.createElement('button');
      nextBtn.type = 'button';
      nextBtn.className = 'pb-overlay__btn pb-overlay__btn--pager';
      nextBtn.textContent = resolveText(this.language, 'btnNext');
      this.nextPageButton = nextBtn;
      pager.appendChild(prevBtn);
      pager.appendChild(pageLabel);
      pager.appendChild(nextBtn);
      if (this.isDetailSingleRowMode()) {
        pager.style.display = 'none';
      }

      const columnsBtn = document.createElement('button');
      columnsBtn.type = 'button';
      columnsBtn.className = 'pb-overlay__btn';
      columnsBtn.textContent = resolveText(this.language, 'btnColumns');
      columnsBtn.disabled = true;
      columnsBtn.addEventListener('click', () => { this.openColumnManager(); });
      this.columnButton = columnsBtn;

      const layoutToggle = document.createElement('div');
      layoutToggle.className = 'pb-overlay__layout-toggle';
      const gridLayoutBtn = document.createElement('button');
      gridLayoutBtn.type = 'button';
      gridLayoutBtn.className = 'pb-overlay__layout-btn';
      gridLayoutBtn.addEventListener('click', () => {
        this.setDetailLayoutMode(OVERLAY_LAYOUT_MODE_GRID);
      });
      const formLayoutBtn = document.createElement('button');
      formLayoutBtn.type = 'button';
      formLayoutBtn.className = 'pb-overlay__layout-btn';
      formLayoutBtn.addEventListener('click', () => {
        this.setDetailLayoutMode(OVERLAY_LAYOUT_MODE_FORM);
      });
      layoutToggle.appendChild(gridLayoutBtn);
      layoutToggle.appendChild(formLayoutBtn);
      this.layoutToggleWrap = layoutToggle;
      this.gridLayoutButton = gridLayoutBtn;
      this.formLayoutButton = formLayoutBtn;
      this.updateLayoutToggleUi();

      const presetWrap = document.createElement('div');
      presetWrap.className = 'pb-overlay__preset-wrap';
      const presetLabel = document.createElement('span');
      presetLabel.className = 'pb-overlay__preset-label';
      const presetSelect = document.createElement('select');
      presetSelect.className = 'pb-overlay__preset-select';
      presetSelect.addEventListener('change', () => {
        void this.handleLayoutPresetSelectChanged();
      });
      const presetMenuToggleBtn = document.createElement('button');
      presetMenuToggleBtn.type = 'button';
      presetMenuToggleBtn.className = 'pb-overlay__btn pb-overlay__preset-menu-toggle';
      presetMenuToggleBtn.textContent = '…';
      presetMenuToggleBtn.setAttribute('aria-haspopup', 'menu');
      presetMenuToggleBtn.setAttribute('aria-expanded', 'false');
      presetMenuToggleBtn.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        this.toggleLayoutPresetMenu();
      });
      const presetMenu = document.createElement('div');
      presetMenu.className = 'pb-overlay__preset-menu';
      presetMenu.setAttribute('role', 'menu');
      const presetSaveBtn = document.createElement('button');
      presetSaveBtn.type = 'button';
      presetSaveBtn.className = 'pb-overlay__preset-menu-item';
      presetSaveBtn.setAttribute('role', 'menuitem');
      presetSaveBtn.addEventListener('click', () => {
        this.closeLayoutPresetMenu();
        void this.handleLayoutPresetSave();
      });
      const presetDuplicateBtn = document.createElement('button');
      presetDuplicateBtn.type = 'button';
      presetDuplicateBtn.className = 'pb-overlay__preset-menu-item';
      presetDuplicateBtn.setAttribute('role', 'menuitem');
      presetDuplicateBtn.addEventListener('click', () => {
        this.closeLayoutPresetMenu();
        void this.handleLayoutPresetDuplicate();
      });
      const presetRenameBtn = document.createElement('button');
      presetRenameBtn.type = 'button';
      presetRenameBtn.className = 'pb-overlay__preset-menu-item';
      presetRenameBtn.setAttribute('role', 'menuitem');
      presetRenameBtn.addEventListener('click', () => {
        this.closeLayoutPresetMenu();
        void this.handleLayoutPresetRename();
      });
      const presetDeleteBtn = document.createElement('button');
      presetDeleteBtn.type = 'button';
      presetDeleteBtn.className = 'pb-overlay__preset-menu-item pb-overlay__preset-menu-item--danger';
      presetDeleteBtn.setAttribute('role', 'menuitem');
      presetDeleteBtn.addEventListener('click', () => {
        this.closeLayoutPresetMenu();
        void this.handleLayoutPresetDelete();
      });
      presetMenu.appendChild(presetSaveBtn);
      presetMenu.appendChild(presetDuplicateBtn);
      presetMenu.appendChild(presetRenameBtn);
      presetMenu.appendChild(presetDeleteBtn);
      presetWrap.appendChild(presetLabel);
      presetWrap.appendChild(presetSelect);
      presetWrap.appendChild(presetMenuToggleBtn);
      presetWrap.appendChild(presetMenu);
      this.layoutPresetWrap = presetWrap;
      this.layoutPresetLabel = presetLabel;
      this.layoutPresetSelect = presetSelect;
      this.layoutPresetMenuButton = presetMenuToggleBtn;
      this.layoutPresetMenu = presetMenu;
      this.layoutPresetSaveButton = presetSaveBtn;
      this.layoutPresetDuplicateButton = presetDuplicateBtn;
      this.layoutPresetRenameButton = presetRenameBtn;
      this.layoutPresetDeleteButton = presetDeleteBtn;
      this.updateLayoutPresetToolbarUi();

      const dirty = document.createElement('span');
      dirty.className = 'pb-overlay__dirty';
      dirty.textContent = resolveText(this.language, 'dirtyLabel', 0);
      this.dirtyBadge = dirty;

      const saveBtn = document.createElement('button');
      saveBtn.type = 'button';
      saveBtn.className = 'pb-overlay__btn pb-overlay__btn--primary';
      const saveSpinner = document.createElement('span');
      saveSpinner.className = 'pb-overlay__spinner pb-overlay__spinner--hidden';
      saveSpinner.setAttribute('aria-hidden', 'true');
      const saveLabel = document.createElement('span');
      saveLabel.className = 'pb-overlay__save-label';
      saveLabel.textContent = resolveText(this.language, 'btnSave');
      saveBtn.appendChild(saveSpinner);
      saveBtn.appendChild(saveLabel);
      this.saveButton = saveBtn;
      this.saveButtonSpinner = saveSpinner;
      this.saveButtonLabel = saveLabel;

      const addRowBtn = document.createElement('button');
      addRowBtn.type = 'button';
      addRowBtn.className = 'pb-overlay__btn';
      addRowBtn.textContent = resolveText(this.language, 'btnAddRow');
      if (this.isDetailSingleRowMode()) {
        addRowBtn.style.display = 'none';
      }
      this.addRowButton = addRowBtn;

      const undoBtn = document.createElement('button');
      undoBtn.type = 'button';
      undoBtn.className = 'pb-overlay__btn';
      undoBtn.textContent = resolveText(this.language, 'btnUndo');
      undoBtn.title = resolveText(this.language, 'titleUndo');
      undoBtn.disabled = true;
      this.undoButton = undoBtn;

      const redoBtn = document.createElement('button');
      redoBtn.type = 'button';
      redoBtn.className = 'pb-overlay__btn';
      redoBtn.textContent = resolveText(this.language, 'btnRedo');
      redoBtn.title = resolveText(this.language, 'titleRedo');
      redoBtn.disabled = true;
      this.redoButton = redoBtn;

      const closeBtn = document.createElement('button');
      closeBtn.type = 'button';
      closeBtn.className = 'pb-overlay__btn';
      closeBtn.textContent = resolveText(this.language, 'btnClose');
      this.closeButton = closeBtn;

      const primaryActions = document.createElement('div');
      primaryActions.className = 'pb-overlay__toolbar-primary';
      primaryActions.appendChild(pager);
      primaryActions.appendChild(presetWrap);
      primaryActions.appendChild(layoutToggle);

      const secondaryActions = document.createElement('div');
      secondaryActions.className = 'pb-overlay__toolbar-secondary';
      secondaryActions.appendChild(columnsBtn);
      secondaryActions.appendChild(dirty);
      secondaryActions.appendChild(addRowBtn);
      secondaryActions.appendChild(undoBtn);
      secondaryActions.appendChild(redoBtn);
      secondaryActions.appendChild(saveBtn);
      secondaryActions.appendChild(closeBtn);

      actions.appendChild(primaryActions);
      actions.appendChild(secondaryActions);

      toolbar.appendChild(titleWrap);
      toolbar.appendChild(actions);
      return toolbar;
    }

    buildGridShell() {
      const grid = document.createElement('div');
      grid.className = 'pb-overlay__grid';
      this.gridRoot = grid;

      const head = document.createElement('div');
      head.className = 'pb-overlay__grid-head';
      this.gridHead = head;

      const corner = document.createElement('div');
      corner.className = 'pb-overlay__corner';
      head.appendChild(corner);

      const colScroll = document.createElement('div');
      colScroll.className = 'pb-overlay__col-scroll';

      const colRow = document.createElement('div');
      colRow.className = 'pb-overlay__col-row';
      colScroll.appendChild(colRow);
      head.appendChild(colScroll);
      this.columnHeaderScroll = colScroll;

      const body = document.createElement('div');
      body.className = 'pb-overlay__grid-body';
      this.gridBody = body;

      const rowScroll = document.createElement('div');
      rowScroll.className = 'pb-overlay__row-scroll';
      const rowsWrap = document.createElement('div');
      rowsWrap.className = 'pb-overlay__row-wrap';
      rowScroll.appendChild(rowsWrap);
      this.rowHeaderScroll = rowScroll;

      const cellScroll = document.createElement('div');
      cellScroll.className = 'pb-overlay__cell-scroll';
      cellScroll.tabIndex = 0;
      const cellTable = document.createElement('div');
      cellTable.className = 'pb-overlay__table';
      cellScroll.appendChild(cellTable);
      this.bodyScroll = cellScroll;

      body.appendChild(rowScroll);
      body.appendChild(cellScroll);

      grid.appendChild(head);
      grid.appendChild(body);

      const detailForm = document.createElement('div');
      detailForm.className = 'pb-overlay__detail-form';
      this.detailFormContainer = detailForm;
      grid.appendChild(detailForm);

      return grid;
    }

    buildStatusBar() {
      const status = document.createElement('div');
      status.className = 'pb-overlay__status';

      const selected = document.createElement('span');
      selected.className = 'pb-overlay__status-item';
      this.statsElements.selected = selected;

      const filtered = document.createElement('span');
      filtered.className = 'pb-overlay__status-item';
      this.statsElements.filtered = filtered;

      const pendingDelete = document.createElement('span');
      pendingDelete.className = 'pb-overlay__status-item';
      this.statsElements.pendingDelete = pendingDelete;

      const newRows = document.createElement('span');
      newRows.className = 'pb-overlay__status-item';
      this.statsElements.newRows = newRows;

      const sum = document.createElement('span');
      sum.className = 'pb-overlay__status-item';
      this.statsElements.sum = sum;

      const avg = document.createElement('span');
      avg.className = 'pb-overlay__status-item';
      this.statsElements.avg = avg;

      const count = document.createElement('span');
      count.className = 'pb-overlay__status-item';
      this.statsElements.count = count;

      status.appendChild(selected);
      status.appendChild(filtered);
      status.appendChild(pendingDelete);
      status.appendChild(newRows);
      status.appendChild(sum);
      status.appendChild(avg);
      status.appendChild(count);

      return status;
    }

    attachEvents() {
      if (!this.root) return;
      this.bodyScroll.addEventListener('scroll', this.handleScroll, { passive: true });
      this.saveButton.addEventListener('click', () => { this.save(); });
      this.addRowButton?.addEventListener('click', () => { this.addNewRow(); });
      this.undoButton?.addEventListener('click', () => { this.undo(); });
      this.redoButton?.addEventListener('click', () => { this.redo(); });
      this.prevPageButton?.addEventListener('click', () => { this.prevPage(); });
      this.nextPageButton?.addEventListener('click', () => { this.nextPage(); });
      this.closeButton.addEventListener('click', () => { this.tryClose(); });
      this.root.addEventListener('keydown', this.handleKeyOnOverlay, true);
      document.addEventListener('keydown', this.handleGlobalArrowKeyCapture, true);
      document.addEventListener('mouseup', this.handleMouseUp, true);
    }

    detachEvents() {
      if (!this.root) return;
      if (this.bodyScroll) {
        this.bodyScroll.removeEventListener('scroll', this.handleScroll);
      }
      this.root.removeEventListener('keydown', this.handleKeyOnOverlay, true);
      document.removeEventListener('keydown', this.handleGlobalArrowKeyCapture, true);
      document.removeEventListener('mouseup', this.handleMouseUp, true);
      this.closeLayoutPresetMenu();
    }

    getCurrentViewId() {
      const appApi = typeof window !== 'undefined' && window.kintone && window.kintone.app ? window.kintone.app : null;
      if (appApi && typeof appApi.getSelectedViewId === 'function') {
        const value = appApi.getSelectedViewId();
        if (value !== undefined && value !== null) return String(value);
      }
      const search = location.search;
      if (search) {
        const params = new URLSearchParams(search);
        const viewParam = params.get('view');
        if (viewParam) return viewParam;
      }
      const hash = location.hash || '';
      const match = hash.match(/[?&]view=(\d+)/);
      if (match) return match[1];
      return null;
    }

    splitOverlayQueryParts(query) {
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
      return {
        filter: original.slice(0, first).trim(),
        trailing: original.slice(first).trim()
      };
    }

    hasOverlayOrderClause(query) {
      return /\border\s+by\b/i.test(String(query || ''));
    }

    combineOverlayQuery(base, extra) {
      const A = String(base || '').trim();
      const B = String(extra || '').trim();
      if (A && B) return `${A} and (${B})`;
      return A || B || '';
    }

    extractViewFieldOrder(view) {
      const order = [];
      if (!view || typeof view !== 'object') return order;
      const collect = (value) => {
        if (!value) return;
        let code = '';
        if (typeof value === 'string') {
          code = value;
        } else if (value && typeof value === 'object') {
          code = String(value.field || value.code || value.id || '').trim();
        }
        if (code && !order.includes(code)) order.push(code);
      };
      if (Array.isArray(view.columns)) view.columns.forEach(collect);
      if (!order.length && Array.isArray(view.fields)) view.fields.forEach(collect);
      if (!order.length && Array.isArray(view.layout)) {
        view.layout.forEach((row) => {
          if (!row || typeof row !== 'object' || !Array.isArray(row.fields)) return;
          row.fields.forEach(collect);
        });
      }
      return order;
    }

    pickViewFromViews(viewsObj, preferredViewId = '') {
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

    resolveViewInfoFromMetadata(viewsObj, options = {}) {
      if (!viewsObj || typeof viewsObj !== 'object') return null;
      const currentQuery = String(options?.currentQuery || '').trim();
      const preferredViewId = String(options?.viewId || '').trim();
      const picked = this.pickViewFromViews(viewsObj, preferredViewId);
      const selectedView = picked.selectedView;
      if (!selectedView) return null;
      const selectedViewName = picked.selectedViewName || '';
      const baseFilter = String(selectedView?.filterCond || '').trim();
      const split = this.splitOverlayQueryParts(currentQuery);
      const mergedFilter = this.combineOverlayQuery(baseFilter, split.filter);
      const parts = [];
      if (mergedFilter) parts.push(mergedFilter);
      if (split.trailing) {
        parts.push(split.trailing);
      } else if (selectedView?.sort && !this.hasOverlayOrderClause(currentQuery)) {
        parts.push(`order by ${selectedView.sort}`);
      }
      const finalQuery = parts.join(' ').trim() || currentQuery || baseFilter;
      const fieldOrder = this.extractViewFieldOrder(selectedView);
      return {
        query: finalQuery,
        fieldOrder,
        viewId: selectedView?.id ? String(selectedView.id) : '',
        viewName: selectedViewName
      };
    }

    async getMetadataBundle(options = {}) {
      const host = String(location?.origin || '').trim();
      const appId = String(this.appId || '').trim();
      if (!host || !appId) return null;
      try {
        const res = await chrome.runtime.sendMessage({
          type: 'PB_GET_METADATA_BUNDLE',
          payload: {
            host,
            appId,
            needApp: Boolean(options?.needApp),
            needViews: Boolean(options?.needViews),
            needFields: Boolean(options?.needFields),
            trigger: String(options?.trigger || 'overlay_open'),
            source: String(options?.source || 'overlay'),
            logGroup: String(options?.logGroup || 'overlay')
          }
        });
        return res && typeof res === 'object' ? res : null;
      } catch (_err) {
        return null;
      }
    }

    isDetailSingleRowMode() {
      return this.runtimeMode === OVERLAY_RUNTIME_MODE_DETAIL_SINGLE_ROW;
    }

    isListMode() {
      return this.runtimeMode === OVERLAY_RUNTIME_MODE_LIST;
    }

    normalizeListFieldScopeMode(_mode) {
      return LIST_FIELD_SCOPE_ALL_FIELDS;
    }

    normalizeLayoutMode(mode) {
      return mode === OVERLAY_LAYOUT_MODE_FORM
        ? OVERLAY_LAYOUT_MODE_FORM
        : OVERLAY_LAYOUT_MODE_GRID;
    }

    isDetailFormLayoutMode() {
      return this.isDetailSingleRowMode()
        && this.normalizeLayoutMode(this.overlayLayoutMode) === OVERLAY_LAYOUT_MODE_FORM;
    }

    updateLayoutToggleUi() {
      if (!this.layoutToggleWrap) return;
      const show = this.isDetailSingleRowMode();
      this.layoutToggleWrap.style.display = show ? 'inline-flex' : 'none';
      if (!show) return;
      if (this.gridLayoutButton) {
        this.gridLayoutButton.textContent = resolveText(this.language, 'btnLayoutGrid');
        this.gridLayoutButton.title = resolveText(this.language, 'titleLayoutGrid');
      }
      if (this.formLayoutButton) {
        this.formLayoutButton.textContent = resolveText(this.language, 'btnLayoutForm');
        this.formLayoutButton.title = resolveText(this.language, 'titleLayoutForm');
      }
      const current = this.normalizeLayoutMode(this.overlayLayoutMode);
      this.gridLayoutButton?.classList.toggle('is-active', current === OVERLAY_LAYOUT_MODE_GRID);
      this.formLayoutButton?.classList.toggle('is-active', current === OVERLAY_LAYOUT_MODE_FORM);
    }

    updateFieldScopeToggleUi() {
      if (!this.fieldScopeToggleWrap) return;
      this.fieldScopeToggleWrap.style.display = 'none';
    }

    getOverlayLayoutAppKey() {
      const host = String(location?.origin || '').trim();
      const app = this.appId ? String(this.appId) : '0';
      return `${host}::${app}`;
    }

    createLayoutPresetId() {
      return `preset_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    }

    sanitizeLayoutPresetName(value, fallback = '') {
      const text = String(value || '').replace(/\s+/g, ' ').trim();
      if (!text) return String(fallback || '').trim() || resolveText(this.language, 'layoutPresetDefault');
      return text.slice(0, 40);
    }

    getBaseFieldCodeList(baseFields) {
      return (Array.isArray(baseFields) ? baseFields : [])
        .map((field) => String(field?.code || '').trim())
        .filter(Boolean);
    }

    normalizeLayoutPreset(rawPreset, baseCodes, fallbackName, fallbackId = '') {
      const allowed = new Set(baseCodes);
      const scopeRaw = String(rawPreset?.scope || '').trim().toLowerCase();
      const scope = scopeRaw === 'detail' ? 'detail' : 'list';
      const visibleRaw = Array.isArray(rawPreset?.visibleColumns) ? rawPreset.visibleColumns : [];
      const visible = Array.from(new Set(
        visibleRaw
          .map((code) => String(code || '').trim())
          .filter((code) => allowed.has(code))
      ));
      const visibleColumns = visible.length ? visible : baseCodes.slice();

      const orderRaw = Array.isArray(rawPreset?.columnOrder) ? rawPreset.columnOrder : [];
      const order = [];
      const orderSeen = new Set();
      orderRaw.forEach((codeRaw) => {
        const code = String(codeRaw || '').trim();
        if (!code || !allowed.has(code) || !visibleColumns.includes(code) || orderSeen.has(code)) return;
        order.push(code);
        orderSeen.add(code);
      });
      visibleColumns.forEach((code) => {
        if (orderSeen.has(code)) return;
        order.push(code);
        orderSeen.add(code);
      });

      const widths = {};
      const rawWidths = rawPreset?.columnWidths && typeof rawPreset.columnWidths === 'object'
        ? rawPreset.columnWidths
        : {};
      Object.entries(rawWidths).forEach(([codeRaw, valueRaw]) => {
        const code = String(codeRaw || '').trim();
        if (!code || !allowed.has(code)) return;
        const numeric = Number(valueRaw);
        if (!Number.isFinite(numeric)) return;
        widths[code] = Math.max(MIN_COLUMN_WIDTH, Math.min(MAX_COLUMN_WIDTH, Math.round(numeric)));
      });

      const pinned = Array.isArray(rawPreset?.pinnedColumns)
        ? Array.from(new Set(
          rawPreset.pinnedColumns
            .map((code) => String(code || '').trim())
            .filter((code) => allowed.has(code))
        ))
        : [];

      return {
        id: String(rawPreset?.id || fallbackId || this.createLayoutPresetId()),
        name: this.sanitizeLayoutPresetName(rawPreset?.name, fallbackName),
        scope,
        visibleColumns,
        columnOrder: order,
        columnWidths: widths,
        pinnedColumns: pinned
      };
    }

    createDefaultLayoutPreset(baseFields, legacyPref = null, scope = 'list') {
      const baseCodes = this.getBaseFieldCodeList(baseFields);
      const baseOrder = baseCodes.slice();
      const legacyOrder = Array.isArray(legacyPref?.order) ? legacyPref.order : [];
      const legacyWidths = legacyPref?.widths && typeof legacyPref.widths === 'object' ? legacyPref.widths : {};
      const preset = this.normalizeLayoutPreset({
        id: 'default',
        name: resolveText(this.language, 'layoutPresetDefault'),
        scope,
        visibleColumns: baseCodes,
        columnOrder: legacyOrder.length ? legacyOrder : baseOrder,
        columnWidths: legacyWidths
      }, baseCodes, resolveText(this.language, 'layoutPresetDefault'), 'default');
      return preset;
    }

    async loadOverlayLayoutPresetMap(force = false) {
      if (!force && this.overlayLayoutPresetCache) return this.overlayLayoutPresetCache;
      try {
        const stored = await chrome.storage.local.get(OVERLAY_LAYOUT_PRESETS_KEY);
        const raw = stored?.[OVERLAY_LAYOUT_PRESETS_KEY];
        const map = raw && typeof raw === 'object' ? raw : {};
        this.overlayLayoutPresetCache = { ...map };
        return this.overlayLayoutPresetCache;
      } catch (_err) {
        this.overlayLayoutPresetCache = {};
        return this.overlayLayoutPresetCache;
      }
    }

    async writeOverlayLayoutPresetMap(map) {
      if (!map || !Object.keys(map).length) {
        await chrome.storage.local.remove(OVERLAY_LAYOUT_PRESETS_KEY);
        this.overlayLayoutPresetCache = {};
        return;
      }
      await chrome.storage.local.set({ [OVERLAY_LAYOUT_PRESETS_KEY]: map });
      this.overlayLayoutPresetCache = { ...map };
    }

    async getLatestLegacyColumnPref(baseCodes) {
      const map = await this.loadColumnPrefMap();
      const appPrefix = `${this.appId ? String(this.appId) : '0'}::`;
      const entries = Object.entries(map || {}).filter(([key, value]) => {
        if (!String(key || '').startsWith(appPrefix)) return false;
        if (!value || typeof value !== 'object') return false;
        if (!Array.isArray(value.order)) return false;
        return value.order.length > 0;
      });
      if (!entries.length) return null;
      entries.sort((a, b) => {
        const at = Number(a[1]?.savedAt || 0);
        const bt = Number(b[1]?.savedAt || 0);
        return bt - at;
      });
      const latest = entries[0][1];
      const allowed = new Set(baseCodes);
      const order = latest.order
        .map((code) => String(code || '').trim())
        .filter((code) => allowed.has(code));
      const widths = latest.widths && typeof latest.widths === 'object' ? latest.widths : {};
      return { order, widths };
    }

    normalizeOverlayLayoutState(rawState, baseFields) {
      const baseCodes = this.getBaseFieldCodeList(baseFields);
      const rawPresets = Array.isArray(rawState?.presets) ? rawState.presets : [];
      const presets = rawPresets
        .slice(0, MAX_LAYOUT_PRESET_COUNT)
        .map((preset, index) => this.normalizeLayoutPreset(
          preset,
          baseCodes,
          `${resolveText(this.language, 'layoutPresetDefault')} ${index + 1}`,
          index === 0 ? 'default' : ''
        ))
        .filter((preset) => preset.columnOrder.length > 0 || preset.visibleColumns.length > 0);
      if (!presets.length) {
        presets.push(this.createDefaultLayoutPreset(baseFields));
      }
      const active = String(rawState?.activePresetId || '').trim();
      const hasActive = presets.some((preset) => preset.id === active);
      return {
        host: String(location?.origin || '').trim(),
        appId: String(this.appId || ''),
        activePresetId: hasActive ? active : presets[0].id,
        presets,
        updatedAt: Number(rawState?.updatedAt || Date.now())
      };
    }

    async ensureOverlayLayoutState(baseFields) {
      if (!this.appId) return null;
      const key = this.getOverlayLayoutAppKey();
      const map = { ...(await this.loadOverlayLayoutPresetMap()) };
      const rawState = map[key];
      let nextState = null;
      if (rawState && typeof rawState === 'object') {
        nextState = this.normalizeOverlayLayoutState(rawState, baseFields);
      } else {
        const baseCodes = this.getBaseFieldCodeList(baseFields);
        const legacyPref = await this.getLatestLegacyColumnPref(baseCodes);
        nextState = {
          host: String(location?.origin || '').trim(),
          appId: String(this.appId || ''),
          activePresetId: 'default',
          presets: [this.createDefaultLayoutPreset(
            baseFields,
            legacyPref,
            this.isDetailSingleRowMode() ? 'detail' : 'list'
          )],
          updatedAt: Date.now()
        };
      }
      this.overlayLayoutState = nextState;
      map[key] = nextState;

      const entries = Object.entries(map);
      if (entries.length > MAX_LAYOUT_PRESET_APP_ENTRIES) {
        entries.sort((a, b) => {
          const at = Number(a[1]?.updatedAt || 0);
          const bt = Number(b[1]?.updatedAt || 0);
          return at - bt;
        });
        while (entries.length > MAX_LAYOUT_PRESET_APP_ENTRIES) {
          const [oldKey] = entries.shift();
          if (oldKey) delete map[oldKey];
        }
      }
      await this.writeOverlayLayoutPresetMap(map);
      this.updateLayoutPresetToolbarUi();
      return nextState;
    }

    getActiveLayoutPreset() {
      const state = this.overlayLayoutState;
      if (!state || !Array.isArray(state.presets) || !state.presets.length) return null;
      const activeId = String(state.activePresetId || '').trim();
      const selected = state.presets.find((preset) => preset.id === activeId);
      return selected || state.presets[0];
    }

    logOverlayPresetDebug(activePreset, resolvedFields, reason = '') {
      try {
        const presetId = String(activePreset?.id || '').trim() || '-';
        const visibleColumns = Array.isArray(activePreset?.visibleColumns) ? activePreset.visibleColumns : [];
        const columnOrder = Array.isArray(activePreset?.columnOrder) ? activePreset.columnOrder : [];
        const resolvedColumns = Array.isArray(resolvedFields)
          ? resolvedFields.map((field) => String(field?.code || '').trim()).filter(Boolean)
          : [];
        console.debug(`[PB] OVERLAY preset active id=${presetId}${reason ? ` reason=${reason}` : ''}`);
        console.debug('[PB] OVERLAY preset visibleColumns=', visibleColumns);
        console.debug('[PB] OVERLAY preset columnOrder=', columnOrder);
        console.debug('[PB] OVERLAY resolvedColumns=', resolvedColumns);
      } catch (_err) {
        // ignore debug failures
      }
    }

    resolvePresetColumnConfig(baseFields, preset) {
      const baseCodes = this.getBaseFieldCodeList(baseFields);
      const allowed = new Set(baseCodes);
      const rawVisible = Array.isArray(preset?.visibleColumns) ? preset.visibleColumns : [];
      const visible = Array.from(new Set(
        rawVisible
          .map((code) => String(code || '').trim())
          .filter((code) => allowed.has(code))
      ));
      const visibleColumns = visible.length ? visible : baseCodes.slice();

      const rawOrder = Array.isArray(preset?.columnOrder) ? preset.columnOrder : [];
      const ordered = [];
      const seen = new Set();
      rawOrder.forEach((codeRaw) => {
        const code = String(codeRaw || '').trim();
        if (!code || !allowed.has(code) || !visibleColumns.includes(code) || seen.has(code)) return;
        ordered.push(code);
        seen.add(code);
      });
      visibleColumns.forEach((code) => {
        if (seen.has(code)) return;
        ordered.push(code);
        seen.add(code);
      });
      const widths = preset?.columnWidths && typeof preset.columnWidths === 'object'
        ? preset.columnWidths
        : {};
      return { baseCodes, visibleColumns, orderedCodes: ordered, widths };
    }

    buildVisibleFieldsFromPreset(baseFields, preset) {
      const source = Array.isArray(baseFields) ? baseFields : [];
      const fieldMap = new Map(source.map((field) => [String(field?.code || '').trim(), field]));
      const config = this.resolvePresetColumnConfig(source, preset);
      return config.orderedCodes
        .map((code) => {
          const field = fieldMap.get(code);
          if (!field) return null;
          const numeric = Number(config.widths?.[code]);
          const width = Number.isFinite(numeric)
            ? Math.max(MIN_COLUMN_WIDTH, Math.min(MAX_COLUMN_WIDTH, Math.round(numeric)))
            : DEFAULT_COLUMN_WIDTH;
          return {
            ...field,
            required: Boolean(field.required),
            choices: Array.isArray(field.choices) ? field.choices.map((choice) => String(choice)) : [],
            editable: true,
            width
          };
        })
        .filter(Boolean);
    }

    async persistOverlayLayoutState() {
      if (!this.overlayLayoutState || !this.appId) return;
      const key = this.getOverlayLayoutAppKey();
      const map = { ...(await this.loadOverlayLayoutPresetMap()) };
      this.overlayLayoutState.updatedAt = Date.now();
      map[key] = this.overlayLayoutState;
      await this.writeOverlayLayoutPresetMap(map);
      this.updateLayoutPresetToolbarUi();
    }

    toggleLayoutPresetMenu(forceOpen) {
      const next = typeof forceOpen === 'boolean' ? forceOpen : !this.layoutPresetMenuOpen;
      if (next === this.layoutPresetMenuOpen) return;
      this.layoutPresetMenuOpen = next;
      if (this.layoutPresetWrap) {
        this.layoutPresetWrap.classList.toggle('is-open', this.layoutPresetMenuOpen);
      }
      if (this.layoutPresetMenuButton) {
        this.layoutPresetMenuButton.setAttribute('aria-expanded', this.layoutPresetMenuOpen ? 'true' : 'false');
      }
      if (this.layoutPresetMenuOpen) {
        document.addEventListener('mousedown', this.handleLayoutPresetMenuOutsidePointerDown, true);
        document.addEventListener('keydown', this.handleLayoutPresetMenuKeyDown, true);
      } else {
        document.removeEventListener('mousedown', this.handleLayoutPresetMenuOutsidePointerDown, true);
        document.removeEventListener('keydown', this.handleLayoutPresetMenuKeyDown, true);
      }
    }

    closeLayoutPresetMenu() {
      this.toggleLayoutPresetMenu(false);
    }

    handleLayoutPresetMenuOutsidePointerDown(event) {
      if (!this.layoutPresetMenuOpen || !this.layoutPresetWrap) return;
      if (this.layoutPresetWrap.contains(event.target)) return;
      this.closeLayoutPresetMenu();
    }

    handleLayoutPresetMenuKeyDown(event) {
      if (!this.layoutPresetMenuOpen) return;
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      this.closeLayoutPresetMenu();
      this.layoutPresetMenuButton?.focus();
    }

    updateLayoutPresetToolbarUi() {
      if (!this.layoutPresetWrap) return;
      const hasState = Boolean(this.overlayLayoutState && Array.isArray(this.overlayLayoutState.presets));
      const show = hasState && this.isListMode();
      this.layoutPresetWrap.style.display = show ? 'inline-flex' : 'none';
      if (!show) {
        this.closeLayoutPresetMenu();
        return;
      }
      if (this.layoutPresetLabel) {
        this.layoutPresetLabel.textContent = `${resolveText(this.language, 'layoutPresetLabel')}:`;
      }
      if (this.layoutPresetSelect) {
        const select = this.layoutPresetSelect;
        const activeId = String(this.overlayLayoutState.activePresetId || '').trim();
        const prev = String(select.value || '');
        select.textContent = '';
        this.overlayLayoutState.presets.forEach((preset) => {
          const option = document.createElement('option');
          option.value = String(preset.id || '');
          option.textContent = String(preset.name || resolveText(this.language, 'layoutPresetDefault'));
          select.appendChild(option);
        });
        const resolved = this.overlayLayoutState.presets.some((preset) => String(preset.id) === activeId)
          ? activeId
          : (this.overlayLayoutState.presets[0]?.id || '');
        select.value = resolved || prev || '';
        select.disabled = this.saving || this.overlayLayoutState.presets.length <= 1;
      }
      if (this.layoutPresetMenuButton) {
        this.layoutPresetMenuButton.title = resolveText(this.language, 'layoutPresetMenu');
        this.layoutPresetMenuButton.setAttribute('aria-label', resolveText(this.language, 'layoutPresetMenu'));
        this.layoutPresetMenuButton.disabled = this.saving;
      }
      if (this.layoutPresetSaveButton) {
        this.layoutPresetSaveButton.textContent = resolveText(this.language, 'layoutPresetSave');
        this.layoutPresetSaveButton.disabled = this.saving;
      }
      if (this.layoutPresetDuplicateButton) {
        this.layoutPresetDuplicateButton.textContent = resolveText(this.language, 'layoutPresetDuplicate');
        this.layoutPresetDuplicateButton.disabled = this.saving || this.overlayLayoutState.presets.length >= MAX_LAYOUT_PRESET_COUNT;
      }
      if (this.layoutPresetRenameButton) {
        this.layoutPresetRenameButton.textContent = resolveText(this.language, 'layoutPresetRename');
        this.layoutPresetRenameButton.disabled = this.saving;
      }
      if (this.layoutPresetDeleteButton) {
        this.layoutPresetDeleteButton.textContent = resolveText(this.language, 'layoutPresetDelete');
        this.layoutPresetDeleteButton.disabled = this.saving || this.overlayLayoutState.presets.length <= 1;
      }
    }

    async handleLayoutPresetSelectChanged() {
      if (!this.layoutPresetSelect || !this.overlayLayoutState) return;
      const nextId = String(this.layoutPresetSelect.value || '').trim();
      if (!nextId || nextId === String(this.overlayLayoutState.activePresetId || '')) return;
      this.overlayLayoutState.activePresetId = nextId;
      await this.persistOverlayLayoutState();
      console.debug('[PB] OVERLAY rerender reason=preset_switch');
      await this.applyListFieldScope(this.listFieldScopeMode);
    }

    captureCurrentLayout() {
      const visibleColumns = this.fields.map((field) => String(field?.code || '').trim()).filter(Boolean);
      const columnOrder = visibleColumns.slice();
      const columnWidths = this.collectColumnWidths();
      return { visibleColumns, columnOrder, columnWidths };
    }

    async handleLayoutPresetSave() {
      if (!this.overlayLayoutState) return;
      const active = this.getActiveLayoutPreset();
      if (!active) return;
      const layout = this.captureCurrentLayout();
      active.visibleColumns = layout.visibleColumns;
      active.columnOrder = layout.columnOrder;
      active.columnWidths = { ...(active.columnWidths || {}), ...(layout.columnWidths || {}) };
      await this.persistOverlayLayoutState();
      this.notify(resolveText(this.language, 'toastLayoutPresetSaved'));
    }

    async handleLayoutPresetDuplicate() {
      if (!this.overlayLayoutState) return;
      if (this.overlayLayoutState.presets.length >= MAX_LAYOUT_PRESET_COUNT) return;
      const active = this.getActiveLayoutPreset();
      if (!active) return;
      const nextName = window.prompt(
        resolveText(this.language, 'layoutPresetPromptName'),
        `${active.name || resolveText(this.language, 'layoutPresetDefault')} copy`
      );
      if (nextName === null) return;
      const preset = {
        ...active,
        id: this.createLayoutPresetId(),
        name: this.sanitizeLayoutPresetName(nextName, resolveText(this.language, 'layoutPresetNewName')),
        visibleColumns: Array.isArray(active.visibleColumns) ? active.visibleColumns.slice() : [],
        columnOrder: Array.isArray(active.columnOrder) ? active.columnOrder.slice() : [],
        columnWidths: { ...(active.columnWidths || {}) },
        pinnedColumns: Array.isArray(active.pinnedColumns) ? active.pinnedColumns.slice() : []
      };
      this.overlayLayoutState.presets.push(preset);
      this.overlayLayoutState.activePresetId = preset.id;
      await this.persistOverlayLayoutState();
      await this.applyListFieldScope(this.listFieldScopeMode);
      this.notify(resolveText(this.language, 'toastLayoutPresetDuplicated'));
    }

    async handleLayoutPresetRename() {
      if (!this.overlayLayoutState) return;
      const active = this.getActiveLayoutPreset();
      if (!active) return;
      const nextName = window.prompt(resolveText(this.language, 'layoutPresetPromptName'), active.name || '');
      if (nextName === null) return;
      active.name = this.sanitizeLayoutPresetName(nextName, active.name || resolveText(this.language, 'layoutPresetDefault'));
      await this.persistOverlayLayoutState();
      this.notify(resolveText(this.language, 'toastLayoutPresetRenamed'));
    }

    async handleLayoutPresetDelete() {
      if (!this.overlayLayoutState) return;
      if (!Array.isArray(this.overlayLayoutState.presets) || this.overlayLayoutState.presets.length <= 1) return;
      const activeId = String(this.overlayLayoutState.activePresetId || '').trim();
      if (!window.confirm(resolveText(this.language, 'layoutPresetDeleteConfirm'))) return;
      this.overlayLayoutState.presets = this.overlayLayoutState.presets.filter((preset) => String(preset.id || '') !== activeId);
      if (!this.overlayLayoutState.presets.length) {
        return;
      }
      this.overlayLayoutState.activePresetId = String(this.overlayLayoutState.presets[0].id || '');
      await this.persistOverlayLayoutState();
      await this.applyListFieldScope(this.listFieldScopeMode);
      this.notify(resolveText(this.language, 'toastLayoutPresetDeleted'));
    }

    getRecordFetchFieldCodes() {
      if (Array.isArray(this.recordFetchFieldCodes) && this.recordFetchFieldCodes.length) {
        return this.recordFetchFieldCodes.slice();
      }
      return this.fields
        .map((field) => String(field?.code || '').trim())
        .filter(Boolean);
    }

    getFieldDefinition(fieldCode) {
      const code = String(fieldCode || '').trim();
      if (!code) return null;
      return this.fieldMap.get(code) || this.fieldsMetaMap.get(code) || null;
    }

    sortFieldsByViewOrder(fields) {
      return Array.isArray(fields) ? fields.slice() : [];
    }

    getListScopeBaseFields(_mode) {
      const allSorted = this.sortFieldsByViewOrder(this.listAllFields);
      return allSorted;
    }

    async applyListFieldScope(mode, options = {}) {
      if (!this.isListMode()) return;
      const normalized = this.normalizeListFieldScopeMode(mode);
      this.listFieldScopeMode = normalized;
      const previousSelection = this.selection
        ? {
          row: this.selection.endRow,
          col: this.selection.endCol,
          code: this.fields[this.selection.endCol]?.code || ''
        }
        : null;
      const baseFields = this.getListScopeBaseFields(normalized);
      const baseCodes = baseFields.map((field) => String(field.code || '').trim()).filter(Boolean);
      this.defaultFieldCodes = baseCodes.slice();
      await this.ensureOverlayLayoutState(baseFields);
      const activePreset = this.getActiveLayoutPreset();
      this.fields = this.buildVisibleFieldsFromPreset(baseFields, activePreset);
      this.logOverlayPresetDebug(activePreset, this.fields, 'apply_list_scope');
      this.rebuildFieldMaps();
      this.updateLayoutPresetToolbarUi();
      if (this.columnButton) {
        this.columnButton.disabled = !this.fields.length;
      }
      if (options.skipRender) return;

      const visibleFieldCodes = new Set(this.fields.map((field) => field.code));
      let filtersChanged = false;
      Array.from(this.filters.keys()).forEach((code) => {
        if (!visibleFieldCodes.has(code)) {
          this.filters.delete(code);
          filtersChanged = true;
        }
      });
      if (this.sortState.fieldCode && !visibleFieldCodes.has(this.sortState.fieldCode)) {
        this.sortState = { fieldCode: '', direction: '' };
      }
      if (filtersChanged) {
        this.recomputeFilteredRowIds();
      }
      this.closeFilterPanel();
      this.closeColumnManager(true);
      const currentRow = previousSelection?.row ?? 0;
      const prevCode = previousSelection?.code || '';
      const maxRow = Math.max(0, this.getVisibleRowCount() - 1);
      const nextRow = Math.max(0, Math.min(maxRow, currentRow));
      const nextColByCode = prevCode ? this.fieldIndexMap.get(prevCode) : undefined;
      const nextCol = Number.isFinite(nextColByCode)
        ? Math.max(0, Math.min(this.fields.length - 1, nextColByCode))
        : Math.max(0, Math.min(this.fields.length - 1, previousSelection?.col ?? 0));
      if (this.editingCell) {
        this.exitEditMode();
      }
      this.renderGrid();
      this.updateVirtualRows(true);
      this.syncTableWidth();
      if (this.getVisibleRowCount() > 0 && this.fields.length > 0) {
        this.setSelectionSingle(nextRow, nextCol);
        this.focusCell(nextRow, nextCol);
      } else {
        this.selection = null;
        this.armedCell = null;
      }
      this.updateDirtyBadge();
      this.updateStats();
      this.updatePermissionUiState();
    }

    async setListFieldScopeMode(mode) {
      if (!this.isListMode()) return;
      const normalized = this.normalizeListFieldScopeMode(mode);
      if (normalized === this.listFieldScopeMode && this.fields.length) {
        this.updateLayoutPresetToolbarUi();
        return;
      }
      await this.applyListFieldScope(normalized);
    }

    setDetailLayoutMode(nextMode) {
      if (!this.isDetailSingleRowMode()) return;
      const normalized = this.normalizeLayoutMode(nextMode);
      if (normalized === this.overlayLayoutMode) {
        this.updateLayoutToggleUi();
        return;
      }
      const active = this.getNavigationOrigin(document.activeElement instanceof HTMLInputElement ? document.activeElement : null);
      const nextCol = Math.max(0, Math.min(this.fields.length - 1, Number(active?.col ?? this.selection?.endCol ?? 0)));
      if (this.editingCell) this.exitEditMode();
      this.overlayLayoutMode = normalized;
      this.renderGrid();
      this.updateLayoutToggleUi();
      this.updateDirtyBadge();
      this.updateStats();
      if (this.getVisibleRowCount() > 0 && this.fields.length > 0) {
        this.setSelectionSingle(0, nextCol);
        this.focusCell(0, nextCol);
      }
    }

    resolveDetailRecordContext() {
      const fallback = parseDetailOverlayContext(this.detailSourceUrl || location.href || '');
      const recordId = String(this.detailRecordId || fallback?.recordId || '').trim();
      const appId = String(this.detailAppId || fallback?.appId || '').trim();
      if (!recordId) return null;
      return {
        recordId,
        appId
      };
    }

    async loadLanguage() {
      const resolved = await resolveOverlayUiLanguage();
      this.uiLanguageSetting = resolved.setting;
      this.language = resolved.language;
    }

    attachUiLanguageListener() {
      if (this.uiLanguageListenerAttached) return;
      if (!chrome?.storage?.onChanged?.addListener) return;
      chrome.storage.onChanged.addListener(this.boundUiLanguageStorageChanged);
      this.uiLanguageListenerAttached = true;
    }

    detachUiLanguageListener() {
      if (!this.uiLanguageListenerAttached) return;
      if (!chrome?.storage?.onChanged?.removeListener) return;
      chrome.storage.onChanged.removeListener(this.boundUiLanguageStorageChanged);
      this.uiLanguageListenerAttached = false;
    }

    handleUiLanguageStorageChanged(changes, areaName) {
      if (areaName !== 'local' || !changes || !Object.prototype.hasOwnProperty.call(changes, UI_LANGUAGE_KEY)) {
        return;
      }
      const nextSetting = normalizeUiLanguageSetting(changes[UI_LANGUAGE_KEY]?.newValue);
      const nextLanguage = resolveEffectiveUiLanguage(nextSetting);
      if (nextSetting === this.uiLanguageSetting && nextLanguage === this.language) return;
      this.uiLanguageSetting = nextSetting;
      this.language = nextLanguage;
      if (!this.isOpen || !this.root) return;
      this.applyLanguageToOverlayUi();
    }

    applyLanguageToOverlayUi() {
      if (this.filterPanel?.panel) {
        this.closeFilterPanel();
      }
      if (this.titleElement) {
        this.titleElement.textContent = this.appName || resolveText(this.language, 'title');
      }
      if (this.modeBadge) {
        this.modeBadge.textContent = resolveText(this.language, 'modeViewOnly');
      }
      if (this.prevPageButton) {
        this.prevPageButton.textContent = resolveText(this.language, 'btnPrev');
      }
      if (this.nextPageButton) {
        this.nextPageButton.textContent = resolveText(this.language, 'btnNext');
      }
      if (this.columnButton) {
        this.columnButton.textContent = resolveText(this.language, 'btnColumns');
      }
      this.updateLayoutPresetToolbarUi();
      this.updateLayoutToggleUi();
      if (this.addRowButton) {
        this.addRowButton.textContent = resolveText(this.language, 'btnAddRow');
      }
      if (this.undoButton) {
        this.undoButton.textContent = resolveText(this.language, 'btnUndo');
        this.undoButton.title = resolveText(this.language, 'titleUndo');
      }
      if (this.redoButton) {
        this.redoButton.textContent = resolveText(this.language, 'btnRedo');
        this.redoButton.title = resolveText(this.language, 'titleRedo');
      }
      if (this.closeButton) {
        this.closeButton.textContent = resolveText(this.language, 'btnClose');
      }
      if (this.saveButtonLabel) {
        this.saveButtonLabel.textContent = resolveText(this.language, this.saving ? 'btnSaving' : 'btnSave');
      }
      if (this.permissionWarningEl) {
        this.permissionWarningEl.textContent = resolveText(this.language, 'permWarningUnknown');
      }
      this.refreshHeaderFilterButtonsText();
      this.refreshSubtableEditorTexts();
      if (this.isDetailFormLayoutMode() || (this.tableContainer && this.rowHeaderContainer)) {
        this.updateVirtualRows(true);
      }
      this.updatePermissionUiState();
      this.updateDirtyBadge();
      this.updateStats();
    }

    refreshHeaderFilterButtonsText() {
      const headRow = this.columnHeaderScroll?.querySelector('.pb-overlay__col-row');
      if (!headRow) return;
      const filterLabel = resolveText(this.language, 'filterButton');
      const headerCells = Array.from(headRow.querySelectorAll('.pb-overlay__col-header'));
      headerCells.forEach((cell, index) => {
        const btn = cell.querySelector('.pb-overlay__filter-btn');
        if (!btn) return;
        const field = this.fields[index];
        const fieldLabel = field ? (field.label || field.code) : '';
        btn.title = filterLabel;
        btn.setAttribute('aria-label', fieldLabel ? `${filterLabel}: ${fieldLabel}` : filterLabel);
      });
    }

    refreshSubtableEditorTexts() {
      if (!this.subtableEditor?.panel) return;
      const panel = this.subtableEditor.panel;
      const field = this.fields[this.subtableEditor.colIndex];
      const title = panel.querySelector('.pb-overlay__subtable-title');
      if (title) {
        title.textContent = `${resolveText(this.language, 'subtableTitle')}: ${field?.label || field?.code || ''}`;
      }
      const closeBtn = panel.querySelector('.pb-overlay__subtable-close');
      if (closeBtn) {
        closeBtn.title = resolveText(this.language, 'subtableClose');
        closeBtn.setAttribute('aria-label', resolveText(this.language, 'subtableClose'));
      }
      const addBtn = panel.querySelector('[data-subtable-action="add"]');
      if (addBtn) addBtn.textContent = resolveText(this.language, 'subtableAddRow');
      const autoBtn = panel.querySelector('[data-subtable-action="autowidth"]');
      if (autoBtn) autoBtn.textContent = resolveText(this.language, 'subtableAutoWidth');
      const reloadBtn = panel.querySelector('[data-subtable-action="reload-layout"]');
      if (reloadBtn) reloadBtn.textContent = resolveText(this.language, 'subtableReloadLayout');
      const cancelBtn = panel.querySelector('[data-subtable-action="cancel"]');
      if (cancelBtn) cancelBtn.textContent = resolveText(this.language, 'subtableCancel');
      const saveBtn = panel.querySelector('[data-subtable-action="save"]');
      if (saveBtn) saveBtn.textContent = resolveText(this.language, 'subtableSave');
      const opHeader = panel.querySelector('th.pb-subtable__op');
      if (opHeader) {
        opHeader.setAttribute('aria-label', resolveText(this.language, 'subtableActionsAria'));
      }
      panel.querySelectorAll('.pb-subtable__remove').forEach((btn) => {
        btn.title = resolveText(this.language, 'subtableRemoveRow');
        btn.setAttribute('aria-label', resolveText(this.language, 'subtableRemoveRow'));
      });
      const emptyCell = panel.querySelector('.pb-subtable__empty');
      if (emptyCell) {
        emptyCell.textContent = resolveText(this.language, 'subtableEmpty');
      }
    }

    async loadOverlayMode() {
      let requestedMode = EXCEL_OVERLAY_MODE_STANDARD;
      try {
        const stored = await chrome.storage.sync.get(EXCEL_OVERLAY_MODE_KEY);
        requestedMode = normalizeExcelOverlayMode(String(stored?.[EXCEL_OVERLAY_MODE_KEY] || ''));
      } catch (_err) {
        requestedMode = EXCEL_OVERLAY_MODE_STANDARD;
      }
      const accessState = await this.proService.getProAccessState({
        featureName: 'excel-overlay-edit',
        requestedMode,
        allowDevelopmentInstall: requestedMode === EXCEL_OVERLAY_MODE_PRO
      });
      this.proAccessState = accessState && typeof accessState === 'object'
        ? accessState
        : { enabled: false, reason: 'unknown', source: 'none' };
      this.proEntitlement = Boolean(this.proAccessState.enabled);
      this.overlayMode = this.proEntitlement ? EXCEL_OVERLAY_MODE_PRO : EXCEL_OVERLAY_MODE_STANDARD;
    }

    isProMode() {
      return this.overlayMode === EXCEL_OVERLAY_MODE_PRO;
    }

    canUseEditFeatures() {
      // Future expansion:
      // return this.isProMode() && this.proEntitlement && permissionService.canEdit...
      return this.isProMode() && this.proEntitlement;
    }

    canViewOverlay() {
      return true;
    }

    canEditOverlay() {
      return this.canUseEditFeatures();
    }

    canSaveOverlay() {
      return this.canEditOverlay();
    }

    getOverlayModeFlags() {
      return {
        overlayMode: this.overlayMode,
        runtimeMode: this.runtimeMode,
        proReason: this.proAccessState?.reason || '',
        canViewOverlay: this.canViewOverlay(),
        canEditOverlay: this.canEditOverlay(),
        canSaveOverlay: this.canSaveOverlay()
      };
    }

    isOverlayEditable() {
      return this.canEditOverlay();
    }

    isOverlayViewOnly() {
      return this.canViewOverlay() && !this.canEditOverlay();
    }

    canMutateOverlay(showNotice = false) {
      const allowed = this.canEditOverlay();
      if (!allowed && showNotice) {
        this.notifyViewOnlyBlocked();
      }
      return allowed;
    }

    notifyViewOnlyBlocked() {
      if (this.viewOnlyNoticeShown) return;
      this.viewOnlyNoticeShown = true;
      this.notify(resolveText(this.language, 'toastViewOnlyBlocked'));
      setTimeout(() => {
        this.viewOnlyNoticeShown = false;
      }, 1200);
    }

    async fetchData() {
      const contextRes = await this.postFn('EXCEL_GET_APP_CONTEXT');
      if (!contextRes?.ok || !contextRes.appId) {
        throw new Error('Context unavailable');
      }
      this.appId = contextRes.appId;
      this.appName = contextRes.appName || '';
      const detailContext = this.isDetailSingleRowMode() ? this.resolveDetailRecordContext() : null;
      if (this.isDetailSingleRowMode() && !detailContext) {
        throw new Error('Detail context unavailable');
      }
      if (detailContext?.appId && detailContext.appId !== String(this.appId || '').trim()) {
        this.appId = detailContext.appId;
      }
      const metadataRes = await this.getMetadataBundle({
        needApp: true,
        needViews: this.isListMode(),
        needFields: true
      });
      const metadataBundle = metadataRes?.bundle && typeof metadataRes.bundle === 'object'
        ? metadataRes.bundle
        : null;
      const metadataAppName = String(metadataBundle?.app?.name || '').trim();
      if (metadataAppName) {
        this.appName = metadataAppName;
      }
      if (this.titleElement) {
        this.titleElement.textContent = this.appName || resolveText(this.language, 'title');
      }
      const detailQuery = detailContext ? `$id = "${String(detailContext.recordId).replace(/"/g, '\\"')}"` : '';
      const currentQuery = this.isDetailSingleRowMode() ? detailQuery : (contextRes.query || '');
      const viewId = this.isDetailSingleRowMode() ? null : this.getCurrentViewId();
      this.viewId = '';
      this.viewName = '';
      this.viewKey = 'default';
      let resolvedQuery = currentQuery;
      let viewFieldOrder = [];
      if (!this.isDetailSingleRowMode()) {
        const viewInfoFromMeta = this.resolveViewInfoFromMetadata(metadataBundle?.views?.raw, {
          appId: this.appId,
          viewId,
          currentQuery
        });
        if (viewInfoFromMeta) {
          if (typeof viewInfoFromMeta.query === 'string') {
            resolvedQuery = viewInfoFromMeta.query;
          }
          if (Array.isArray(viewInfoFromMeta.fieldOrder)) {
            viewFieldOrder = viewInfoFromMeta.fieldOrder;
          }
          if (viewInfoFromMeta.viewId) {
            this.viewId = String(viewInfoFromMeta.viewId);
          }
          if (viewInfoFromMeta.viewName) {
            this.viewName = String(viewInfoFromMeta.viewName);
          }
        }
        try {
          if (!viewInfoFromMeta) {
            const viewInfo = await this.postFn('EXCEL_GET_VIEW_INFO', {
              appId: this.appId,
              viewId,
              currentQuery
            });
            if (viewInfo?.ok) {
              if (typeof viewInfo.query === 'string') {
                resolvedQuery = viewInfo.query;
              }
              if (Array.isArray(viewInfo.fieldOrder)) {
                viewFieldOrder = viewInfo.fieldOrder;
              }
              if (viewInfo.viewId) {
                this.viewId = String(viewInfo.viewId);
              }
              if (viewInfo.viewName) {
                this.viewName = String(viewInfo.viewName);
              }
            }
          }
        } catch (_e) {
          // ignore and fall back to currentQuery
        }
        this.viewKey = this.computeViewKey(this.viewId, this.viewName, viewId);
      } else {
        this.viewId = `detail:${detailContext.recordId}`;
        this.viewName = '';
        this.viewKey = this.computeViewKey(this.viewId, this.viewName, 'detail');
      }
      this.viewFieldOrder = Array.from(new Set(
        (Array.isArray(viewFieldOrder) ? viewFieldOrder : [])
          .map((code) => String(code || '').trim())
          .filter(Boolean)
      ));
      this.baseQuery = String(resolvedQuery || '').trim();
      this.query = this.baseQuery;
      this.pageOffset = 0;
      this.totalCount = 0;

      let candidateFields = [];
      const cachedFieldsMeta = Array.isArray(metadataBundle?.fields?.normalized)
        ? metadataBundle.fields.normalized
        : [];
      if (cachedFieldsMeta.length) {
        const allMetaFields = cachedFieldsMeta
          .map((f) => ({
            code: f.code,
            label: f.label || '',
            type: f.type || '',
            required: Boolean(f.required),
            choices: Array.isArray(f.choices) ? f.choices : [],
            lookupAuto: Boolean(f.lookupAuto),
            lookup: f.lookup ? { ...f.lookup } : undefined,
            subtable: f.subtable && Array.isArray(f.subtable.fields)
              ? {
                fields: f.subtable.fields.map((child) => ({
                  ...child,
                  required: Boolean(child?.required),
                  choices: Array.isArray(child.choices) ? child.choices : []
                }))
              }
              : undefined
          }))
          .filter((f) => this.shouldIncludeField(f));

        candidateFields = allMetaFields.filter((f) => overlayConfig.allowedTypes.has(f.type));
      } else {
        const fieldsMetaRes = await this.postFn('EXCEL_GET_FIELDS_META', { appId: this.appId });
        if (fieldsMetaRes?.ok && Array.isArray(fieldsMetaRes.fieldsMeta)) {
          const allMetaFields = fieldsMetaRes.fieldsMeta
            .map((f) => ({
              code: f.code,
              label: f.label || '',
              type: f.type || '',
              required: Boolean(f.required),
              choices: Array.isArray(f.choices) ? f.choices : [],
              lookupAuto: Boolean(f.lookupAuto),
              lookup: f.lookup ? { ...f.lookup } : undefined,
              subtable: f.subtable && Array.isArray(f.subtable.fields)
                ? {
                  fields: f.subtable.fields.map((child) => ({
                    ...child,
                    required: Boolean(child?.required),
                    choices: Array.isArray(child.choices) ? child.choices : []
                  }))
                }
                : undefined
            }))
            .filter((f) => this.shouldIncludeField(f));

          candidateFields = allMetaFields.filter((f) => overlayConfig.allowedTypes.has(f.type));
        } else {
          const fieldsRes = await this.postFn('EXCEL_GET_FIELDS', { appId: this.appId });
          if (!fieldsRes?.ok) throw new Error('Failed to get fields');
          candidateFields = Array.isArray(fieldsRes.fields)
            ? fieldsRes.fields.filter((f) => overlayConfig.allowedTypes.has(f.type))
            : [];
          if (!candidateFields.length && this.isListMode()) {
            const fallbackCodes = Array.from(new Set(
              (Array.isArray(this.viewFieldOrder) ? this.viewFieldOrder : [])
                .map((code) => String(code || '').trim())
                .filter(Boolean)
            ));
            candidateFields = fallbackCodes.map((code) => ({
              code,
              label: code,
              type: 'SINGLE_LINE_TEXT',
              required: false,
              choices: []
            }));
          }
        }
      }
      this.fieldsMeta = candidateFields.map((field) => ({ ...field }));
      this.fieldsMetaMap.clear();
      this.fieldsMeta.forEach((field) => {
        if (field?.code) this.fieldsMetaMap.set(field.code, field);
      });
      this.recordFetchFieldCodes = Array.from(new Set(
        this.fieldsMeta
          .map((field) => String(field?.code || '').trim())
          .filter(Boolean)
      ));
      this.syncPermissionServiceFields();

      if (this.isListMode()) {
        this.listAllFields = this.fieldsMeta.map((field) => ({ ...field }));
        await this.applyListFieldScope(this.listFieldScopeMode, { skipRender: true });
      } else {
        this.listAllFields = [];
        const baseFields = this.fieldsMeta.map((field) => ({ ...field }));
        this.defaultFieldCodes = baseFields.map((field) => String(field.code || '').trim()).filter(Boolean);
        await this.ensureOverlayLayoutState(baseFields);
        const activePreset = this.getActiveLayoutPreset();
        this.fields = this.buildVisibleFieldsFromPreset(baseFields, activePreset);
      }
      this.rebuildFieldMaps();
      await this.loadPermissions();
      await this.loadCurrentPageRecords();
      if (this.isDetailSingleRowMode()) {
        if (!this.rows.length) {
          throw new Error('Detail record not found');
        }
        if (this.rows.length > 1) {
          this.rows = this.rows.slice(0, 1);
          this.rebuildRowMaps();
          this.recomputeFilteredRowIds();
        }
        this.totalCount = 1;
      }
      if (this.columnButton) {
        this.columnButton.disabled = !this.fields.length;
      }
      this.updateLayoutPresetToolbarUi();
    }

    computeViewKey(viewIdValue, viewNameValue, fallbackParam) {
      if (viewIdValue) return `id:${viewIdValue}`;
      if (viewNameValue) return `name:${viewNameValue}`;
      if (fallbackParam) return `param:${fallbackParam}`;
      return 'default';
    }

    normalizeOverlayQuery(baseQuery, pageSize, pageOffset) {
      let raw = String(baseQuery || '').trim();
      raw = raw.replace(/(^|\s+)limit\s+\d+\b/ig, ' ');
      raw = raw.replace(/(^|\s+)offset\s+\d+\b/ig, ' ');
      raw = raw.replace(/\s+/g, ' ').trim();
      const paging = `limit ${pageSize} offset ${pageOffset}`;
      return raw ? `${raw} ${paging}` : paging;
    }

    buildPagedQuery() {
      return this.normalizeOverlayQuery(this.baseQuery || this.query || '', this.pageSize, this.pageOffset);
    }

    syncPermissionServicePendingDeletes() {
      this.permissionService.setPendingDeletes(Array.from(this.pendingDeletes));
    }

    syncPermissionServiceFields() {
      this.permissionService.setFields(this.fieldsMeta);
    }

    getVisibleRows() {
      let visible;
      if (!Array.isArray(this.filteredRowIds)) {
        visible = this.rows.slice();
      } else {
        visible = [];
        this.filteredRowIds.forEach((id) => {
          const row = this.rowMap.get(String(id || '').trim());
          if (row) visible.push(row);
        });
      }
      return this.sortVisibleRows(visible);
    }

    getVisibleRowCount() {
      return this.getVisibleRows().length;
    }

    getVisibleRowAt(index) {
      const rows = this.getVisibleRows();
      return rows[index] || null;
    }

    getVisibleRowIndexById(recordId) {
      const key = String(recordId || '').trim();
      if (!key) return -1;
      const rows = this.getVisibleRows();
      for (let i = 0; i < rows.length; i += 1) {
        if (String(rows[i]?.id || '').trim() === key) return i;
      }
      return -1;
    }

    isSortActive() {
      return Boolean(this.sortState?.fieldCode && this.sortState?.direction);
    }

    getSortDirectionForField(fieldCode) {
      const code = String(fieldCode || '').trim();
      if (!code) return '';
      if (this.sortState.fieldCode !== code) return '';
      if (this.sortState.direction === 'asc' || this.sortState.direction === 'desc') {
        return this.sortState.direction;
      }
      return '';
    }

    toggleSortForField(fieldCode) {
      const code = String(fieldCode || '').trim();
      if (!code) return;
      const current = this.getSortDirectionForField(code);
      if (!current) {
        this.sortState = { fieldCode: code, direction: 'asc' };
      } else if (current === 'asc') {
        this.sortState = { fieldCode: code, direction: 'desc' };
      } else {
        this.sortState = { fieldCode: '', direction: '' };
      }
      this.resetViewAfterSort();
    }

    resetViewAfterSort() {
      this.closeFilterPanel();
      this.closeRadioPicker();
      this.closeMultiChoicePicker();
      this.closeMultilineEditor();
      this.selection = null;
      this.armedCell = null;
      this.editingCell = null;
      this.pendingFocus = null;
      this.pendingEdit = null;
      if (this.bodyScroll) this.bodyScroll.scrollTop = 0;
      this.virtualStart = 0;
      this.virtualEnd = 0;
      this.renderGrid();
      this.updateVirtualRows(true);
      this.updateStats();
      this.updateDirtyBadge();
    }

    isEmptySortValue(value) {
      if (value == null) return true;
      if (Array.isArray(value)) return value.length === 0;
      return String(value).trim() === '';
    }

    parseSortNumber(value) {
      const str = String(value ?? '').trim();
      if (!str) return null;
      const num = Number(str);
      return Number.isNaN(num) ? null : num;
    }

    parseSortDate(value) {
      const str = String(value ?? '').trim();
      if (!str) return null;
      const time = Date.parse(str);
      return Number.isNaN(time) ? null : time;
    }

    compareSortValues(aValue, bValue, field) {
      const aEmpty = this.isEmptySortValue(aValue);
      const bEmpty = this.isEmptySortValue(bValue);
      if (aEmpty && bEmpty) return 0;
      if (aEmpty && !bEmpty) return 1;
      if (!aEmpty && bEmpty) return -1;

      const type = String(field?.type || '');
      if (type === 'NUMBER') {
        const aNum = this.parseSortNumber(aValue);
        const bNum = this.parseSortNumber(bValue);
        if (aNum != null && bNum != null) {
          if (aNum < bNum) return -1;
          if (aNum > bNum) return 1;
          return 0;
        }
      } else if (type === 'DATE') {
        const aDate = this.parseSortDate(aValue);
        const bDate = this.parseSortDate(bValue);
        if (aDate != null && bDate != null) {
          if (aDate < bDate) return -1;
          if (aDate > bDate) return 1;
          return 0;
        }
      }

      const aStr = String(aValue ?? '').toLowerCase();
      const bStr = String(bValue ?? '').toLowerCase();
      return aStr.localeCompare(bStr, undefined, { numeric: true, sensitivity: 'base' });
    }

    sortVisibleRows(rows) {
      if (!Array.isArray(rows) || rows.length <= 1) return Array.isArray(rows) ? rows : [];
      if (!this.isSortActive()) return rows;
      const fieldCode = String(this.sortState.fieldCode || '').trim();
      const direction = this.sortState.direction === 'desc' ? 'desc' : 'asc';
      const field = this.fieldMap.get(fieldCode);
      if (!field) return rows;
      const factor = direction === 'desc' ? -1 : 1;
      const sorted = rows.slice();
      sorted.sort((a, b) => {
        const aValue = a?.values?.[fieldCode];
        const bValue = b?.values?.[fieldCode];
        const base = this.compareSortValues(aValue, bValue, field);
        return base * factor;
      });
      return sorted;
    }

    getFilterTypeForField(field) {
      if (!field) return 'text';
      if (field.type === 'NUMBER') return 'number';
      if (field.type === 'DATE') return 'date';
      if (field.type === 'RADIO_BUTTON' || field.type === 'DROP_DOWN' || field.type === 'CHECK_BOX' || field.type === 'MULTI_SELECT') return 'choice';
      return 'text';
    }

    createDefaultFilter(field) {
      const type = this.getFilterTypeForField(field);
      if (type === 'number' || type === 'date') {
        return { type, mode: 'range', from: '', to: '', value: '', values: [] };
      }
      if (type === 'choice') {
        return { type, mode: 'in', values: [], value: '', from: '', to: '' };
      }
      return { type, mode: 'contains', value: '', from: '', to: '', values: [] };
    }

    isFilterActive(filter) {
      if (!filter || typeof filter !== 'object') return false;
      if (filter.type === 'number' || filter.type === 'date') {
        return String(filter.from || '').trim().length > 0 || String(filter.to || '').trim().length > 0;
      }
      if (filter.type === 'choice') {
        return Array.isArray(filter.values) && filter.values.length > 0;
      }
      return String(filter.value || '').trim().length > 0;
    }

    hasActiveFilters() {
      for (const [, filter] of this.filters.entries()) {
        if (this.isFilterActive(filter)) return true;
      }
      return false;
    }

    getActiveFilterCount() {
      let count = 0;
      this.filters.forEach((filter) => {
        if (this.isFilterActive(filter)) count += 1;
      });
      return count;
    }

    parseFilterNumber(value) {
      const str = String(value ?? '').trim();
      if (!str) return null;
      const num = Number(str);
      return Number.isNaN(num) ? null : num;
    }

    parseFilterDate(value) {
      const str = String(value ?? '').trim();
      if (!str) return null;
      const time = Date.parse(str);
      return Number.isNaN(time) ? null : time;
    }

    matchesFilter(value, filter) {
      if (!this.isFilterActive(filter)) return true;
      if (filter.type === 'number') {
        const current = this.parseFilterNumber(value);
        if (current == null) return false;
        const from = this.parseFilterNumber(filter.from);
        const to = this.parseFilterNumber(filter.to);
        if (from != null && current < from) return false;
        if (to != null && current > to) return false;
        return true;
      }
      if (filter.type === 'date') {
        const current = this.parseFilterDate(value);
        if (current == null) return false;
        const from = this.parseFilterDate(filter.from);
        const to = this.parseFilterDate(filter.to);
        if (from != null && current < from) return false;
        if (to != null && current > to) return false;
        return true;
      }
      if (filter.type === 'choice') {
        const selected = Array.isArray(filter.values) ? filter.values.map((item) => String(item ?? '')) : [];
        if (!selected.length) return true;
        if (Array.isArray(value)) {
          const currentValues = value.map((item) => String(item ?? ''));
          return currentValues.some((item) => selected.includes(item));
        }
        return selected.includes(String(value ?? ''));
      }
      const needle = String(filter.value || '').trim().toLowerCase();
      const hay = String(value ?? '').toLowerCase();
      const mode = String(filter.mode || 'contains');
      if (mode === 'equals') return hay === needle;
      if (mode === 'startsWith') return hay.startsWith(needle);
      return hay.includes(needle);
    }

    recomputeFilteredRowIds() {
      const active = Array.from(this.filters.entries()).filter(([, filter]) => this.isFilterActive(filter));
      if (!active.length) {
        this.filteredRowIds = null;
        return;
      }
      const visible = this.rows.filter((row) => {
        return active.every(([fieldCode, filter]) => {
          const value = row?.values?.[fieldCode] ?? '';
          return this.matchesFilter(value, filter);
        });
      });
      this.filteredRowIds = visible.map((row) => String(row.id || '').trim()).filter(Boolean);
    }

    applyFilters() {
      this.needsFilterReapply = false;
      this.recomputeFilteredRowIds();
      this.resetViewAfterFilter();
    }

    resetViewAfterFilter() {
      this.closeFilterPanel();
      this.closeRadioPicker();
      this.closeMultiChoicePicker();
      this.closeMultilineEditor();
      this.selection = null;
      this.armedCell = null;
      this.editingCell = null;
      this.pendingFocus = null;
      this.pendingEdit = null;
      if (this.bodyScroll) this.bodyScroll.scrollTop = 0;
      this.virtualStart = 0;
      this.virtualEnd = 0;
      this.renderGrid();
      this.updateVirtualRows(true);
      this.updateStats();
      this.updateDirtyBadge();
    }

    clearFieldFilter(fieldCode) {
      const code = String(fieldCode || '').trim();
      if (!code) return;
      this.filters.delete(code);
      this.applyFilters();
    }

    isFieldFilterActive(fieldCode) {
      const filter = this.filters.get(String(fieldCode || '').trim());
      return this.isFilterActive(filter);
    }

    openFilterPanel(field, anchorButton) {
      if (!this.root || !field || !anchorButton) return;
      const fieldCode = String(field.code || '').trim();
      if (!fieldCode) return;
      this.closeFilterPanel();

      const existing = this.filters.get(fieldCode);
      const working = existing
        ? { ...existing, values: Array.isArray(existing.values) ? existing.values.slice() : [] }
        : this.createDefaultFilter(field);

      const panel = document.createElement('div');
      panel.className = 'pb-overlay__filter-panel';
      panel.setAttribute('role', 'dialog');
      panel.addEventListener('click', (event) => event.stopPropagation());

      const title = document.createElement('div');
      title.className = 'pb-overlay__filter-title';
      title.textContent = `${resolveText(this.language, 'filterTitle')}: ${field.label || field.code}`;
      panel.appendChild(title);

      const body = document.createElement('div');
      body.className = 'pb-overlay__filter-body';
      panel.appendChild(body);

      let modeSelect = null;
      let valueInput = null;
      let fromInput = null;
      let toInput = null;
      const choiceInputs = [];

      if (working.type === 'text') {
        modeSelect = document.createElement('select');
        modeSelect.className = 'pb-overlay__filter-select';
        [
          ['contains', resolveText(this.language, 'filterContains')],
          ['equals', resolveText(this.language, 'filterEquals')],
          ['startsWith', resolveText(this.language, 'filterStartsWith')]
        ].forEach(([value, label]) => {
          const option = document.createElement('option');
          option.value = value;
          option.textContent = label;
          if (working.mode === value) option.selected = true;
          modeSelect.appendChild(option);
        });
        valueInput = document.createElement('input');
        valueInput.type = 'text';
        valueInput.className = 'pb-overlay__filter-input';
        valueInput.value = String(working.value || '');
        body.appendChild(modeSelect);
        body.appendChild(valueInput);
      } else if (working.type === 'number') {
        fromInput = document.createElement('input');
        fromInput.type = 'text';
        fromInput.inputMode = 'decimal';
        fromInput.className = 'pb-overlay__filter-input';
        fromInput.placeholder = resolveText(this.language, 'filterFrom');
        fromInput.value = String(working.from || '');
        toInput = document.createElement('input');
        toInput.type = 'text';
        toInput.inputMode = 'decimal';
        toInput.className = 'pb-overlay__filter-input';
        toInput.placeholder = resolveText(this.language, 'filterTo');
        toInput.value = String(working.to || '');
        body.appendChild(fromInput);
        body.appendChild(toInput);
      } else if (working.type === 'date') {
        fromInput = document.createElement('input');
        fromInput.type = 'date';
        fromInput.className = 'pb-overlay__filter-input';
        fromInput.value = String(working.from || '');
        toInput = document.createElement('input');
        toInput.type = 'date';
        toInput.className = 'pb-overlay__filter-input';
        toInput.value = String(working.to || '');
        body.appendChild(fromInput);
        body.appendChild(toInput);
      } else if (working.type === 'choice') {
        const list = document.createElement('div');
        list.className = 'pb-overlay__filter-choices';
        const selected = new Set(Array.isArray(working.values) ? working.values.map((item) => String(item)) : []);
        const choices = Array.isArray(field.choices) ? field.choices : [];
        choices.forEach((choice) => {
          const label = document.createElement('label');
          label.className = 'pb-overlay__filter-choice';
          const check = document.createElement('input');
          check.type = 'checkbox';
          check.value = String(choice);
          check.checked = selected.has(String(choice));
          choiceInputs.push(check);
          const text = document.createElement('span');
          text.textContent = String(choice);
          label.appendChild(check);
          label.appendChild(text);
          list.appendChild(label);
        });
        body.appendChild(list);
      }

      const actions = document.createElement('div');
      actions.className = 'pb-overlay__filter-actions';
      const clearBtn = document.createElement('button');
      clearBtn.type = 'button';
      clearBtn.className = 'pb-overlay__btn';
      clearBtn.textContent = resolveText(this.language, 'filterClear');
      const applyBtn = document.createElement('button');
      applyBtn.type = 'button';
      applyBtn.className = 'pb-overlay__btn pb-overlay__btn--primary';
      applyBtn.textContent = resolveText(this.language, 'filterApply');
      actions.appendChild(clearBtn);
      actions.appendChild(applyBtn);
      panel.appendChild(actions);

      clearBtn.addEventListener('click', () => {
        this.clearFieldFilter(fieldCode);
      });
      applyBtn.addEventListener('click', () => {
        const next = this.createDefaultFilter(field);
        if (working.type === 'text') {
          next.mode = modeSelect ? modeSelect.value : 'contains';
          next.value = valueInput ? String(valueInput.value || '').trim() : '';
        } else if (working.type === 'number' || working.type === 'date') {
          next.from = fromInput ? String(fromInput.value || '').trim() : '';
          next.to = toInput ? String(toInput.value || '').trim() : '';
        } else if (working.type === 'choice') {
          next.values = choiceInputs.filter((input) => input.checked).map((input) => String(input.value || ''));
        }
        if (this.isFilterActive(next)) {
          this.filters.set(fieldCode, next);
        } else {
          this.filters.delete(fieldCode);
        }
        this.applyFilters();
      });

      this.root.appendChild(panel);
      const rootRect = this.root.getBoundingClientRect();
      const anchorRect = anchorButton.getBoundingClientRect();
      const panelRect = panel.getBoundingClientRect();
      const margin = 12;
      let left = anchorRect.left - rootRect.left - panelRect.width + anchorRect.width;
      if (left < margin) left = margin;
      const maxLeft = Math.max(margin, rootRect.width - panelRect.width - margin);
      if (left > maxLeft) left = maxLeft;
      let top = anchorRect.bottom - rootRect.top + 6;
      const maxTop = Math.max(margin, rootRect.height - panelRect.height - margin);
      if (top > maxTop) {
        top = anchorRect.top - rootRect.top - panelRect.height - 6;
      }
      if (top < margin) top = margin;
      panel.style.left = `${left}px`;
      panel.style.top = `${top}px`;

      this.filterPanel = { panel, fieldCode, button: anchorButton };
      document.addEventListener('mousedown', this.boundFilterPanelOutsideClick, true);
      requestAnimationFrame(() => {
        const focusable = panel.querySelector('input,select,button');
        if (focusable instanceof HTMLElement) focusable.focus();
      });
    }

    closeFilterPanel() {
      if (!this.filterPanel) return;
      const { panel } = this.filterPanel;
      if (panel?.parentElement) panel.remove();
      this.filterPanel = null;
      document.removeEventListener('mousedown', this.boundFilterPanelOutsideClick, true);
    }

    updatePagerUi() {
      if (this.isDetailSingleRowMode()) {
        if (this.pageLabelElement) {
          this.pageLabelElement.textContent = this.rows.length ? '1-1 / 1' : '0-0 / 0';
        }
        if (this.prevPageButton) this.prevPageButton.disabled = true;
        if (this.nextPageButton) this.nextPageButton.disabled = true;
        return;
      }
      if (this.pageLabelElement) {
        const total = Math.max(0, Number(this.totalCount || 0));
        if (!total) {
          this.pageLabelElement.textContent = '0-0 / 0';
        } else {
          const visible = Math.max(0, this.getVisibleRowCount());
          if (!visible) {
            this.pageLabelElement.textContent = `0-0 / ${total}`;
          } else {
            const start = Math.min(this.pageOffset + 1, total);
            const end = Math.min(this.pageOffset + visible, total);
            this.pageLabelElement.textContent = `${start}-${end} / ${total}`;
          }
        }
      }
      if (this.prevPageButton) {
        this.prevPageButton.disabled = this.saving || this.paging || this.pageOffset <= 0;
      }
      if (this.nextPageButton) {
        const total = Math.max(0, Number(this.totalCount || 0));
        this.nextPageButton.disabled = this.saving || this.paging || total <= 0 || (this.pageOffset + this.pageSize >= total);
      }
    }

    async loadCurrentPageRecords() {
      const fieldCodes = this.getRecordFetchFieldCodes();
      const pagedQuery = this.buildPagedQuery();
      console.debug('[excel-query]', {
        baseQuery: this.baseQuery || this.query || '',
        pagedQuery
      });
      const recordsRes = await this.postFn('EXCEL_GET_RECORDS', {
        appId: this.appId,
        fields: fieldCodes,
        query: pagedQuery,
        __pbTrigger: 'overlay_open'
      });
      if (!recordsRes?.ok) {
        const errorCode = recordsRes?.errorCode || '';
        if (errorCode === 'GAIA_IL02' || /GAIA_IL02/.test(recordsRes?.error || '')) {
          throw new Error(resolveText(this.language, 'errorUnsupportedFilter'));
        }
        throw new Error(recordsRes?.error || 'Failed to get records');
      }
      this.totalCount = Number(recordsRes.totalCount || 0);
      const records = Array.isArray(recordsRes.records) ? recordsRes.records : [];
      this.rows = records.map((record) => this.transformRecord(record));
      console.log('[overlay] records loaded', records.length);
      this.rebuildRowMaps();
      this.recomputeFilteredRowIds();
      await this.loadEffectiveRecordAcl();
      this.syncPermissionServicePendingDeletes();
      this.updatePermissionUiState();
      this.updatePagerUi();
    }

    discardUnsavedChangesForPaging() {
      this.exitEditMode();
      this.closeRadioPicker();
      this.diff.clear();
      this.invalidCells.clear();
      this.invalidValueCache.clear();
      this.pendingDeletes.clear();
      this.syncPermissionServicePendingDeletes();
      this.updateDirtyBadge();
      this.updateStats();
    }

    confirmPageMoveIfNeeded() {
      if (!this.hasUnsavedChanges()) return true;
      const ok = window.confirm(resolveText(this.language, 'confirmPageMoveUnsaved'));
      if (!ok) return false;
      this.discardUnsavedChangesForPaging();
      return true;
    }

    async reloadPage() {
      if (this.paging || !this.isOpen) return;
      this.paging = true;
      this.updatePagerUi();
      try {
        this.showLoading(resolveText(this.language, 'loading'));
        await this.loadCurrentPageRecords();
        if (this.bodyScroll) this.bodyScroll.scrollTop = 0;
        this.renderGrid();
        this.updateDirtyBadge();
        this.updateStats();
        this.focusFirstCell();
      } catch (error) {
        this.notify(resolveText(this.language, 'loadFailed'));
        console.error('[kintone-excel-overlay] failed to reload page', error);
      } finally {
        this.hideLoading();
        this.paging = false;
        this.updatePermissionUiState();
        this.updatePagerUi();
      }
    }

    async refreshListRowsAfterSave() {
      if (!this.isListMode()) return;
      await this.loadCurrentPageRecords();
      const total = Math.max(0, Number(this.totalCount || 0));
      if (!this.rows.length && total > 0 && this.pageOffset > 0) {
        const maxOffset = Math.max(0, Math.floor((total - 1) / this.pageSize) * this.pageSize);
        if (maxOffset !== this.pageOffset) {
          this.pageOffset = maxOffset;
          await this.loadCurrentPageRecords();
        }
      }
      if (this.bodyScroll) this.bodyScroll.scrollTop = 0;
      this.selection = null;
      this.armedCell = null;
      this.pendingFocus = null;
      this.pendingEdit = null;
      this.virtualStart = 0;
      this.virtualEnd = 0;
      this.renderGrid();
      this.updateStats();
      this.updatePagerUi();
    }

    async prevPage() {
      if (this.pageOffset <= 0 || this.paging) return;
      if (!this.confirmPageMoveIfNeeded()) return;
      this.pageOffset = Math.max(0, this.pageOffset - this.pageSize);
      await this.reloadPage();
    }

    async nextPage() {
      if (this.paging) return;
      if (this.pageOffset + this.pageSize >= this.totalCount) return;
      if (!this.confirmPageMoveIfNeeded()) return;
      this.pageOffset += this.pageSize;
      await this.reloadPage();
    }

    rebuildFieldMaps() {
      this.fieldMap.clear();
      this.fieldIndexMap.clear();
      this.fields.forEach((field, index) => {
        this.fieldMap.set(field.code, field);
        this.fieldIndexMap.set(field.code, index);
      });
    }

    rebuildRowMaps() {
      this.rowMap.clear();
      this.rowIndexMap.clear();
      this.revisionMap.clear();
      this.rows.forEach((row, index) => {
        const id = String(row?.id || '').trim();
        if (!id) return;
        this.rowMap.set(id, row);
        this.rowIndexMap.set(id, index);
        if (row?.revision !== undefined) {
          this.revisionMap.set(id, row.revision);
        }
      });
    }

    isChoiceField(field) {
      const type = field?.type || '';
      return type === 'RADIO_BUTTON' || type === 'DROP_DOWN';
    }

    isMultiChoiceField(field) {
      const type = String(field?.type || '').toUpperCase();
      return type === 'CHECK_BOX' || type === 'MULTI_SELECT';
    }

    isMultiLineField(field) {
      return String(field?.type || '').toUpperCase() === 'MULTI_LINE_TEXT';
    }

    isLinkField(field) {
      return String(field?.type || '').toUpperCase() === 'LINK';
    }

    isRichTextField(field) {
      return String(field?.type || '').toUpperCase() === 'RICH_TEXT';
    }

    isCalcField(field) {
      return String(field?.type || '').toUpperCase() === 'CALC';
    }

    isMultiValueField(field) {
      return this.isMultiChoiceField(field);
    }

    normalizeMultiValue(value, field) {
      let values = [];
      if (Array.isArray(value)) {
        values = value;
      } else if (typeof value === 'string') {
        const raw = value.trim();
        values = raw ? raw.split(/\r?\n|,/g) : [];
      } else if (value == null) {
        values = [];
      } else {
        values = [value];
      }
      const normalized = [];
      const seen = new Set();
      values.forEach((item) => {
        const text = String(item ?? '').trim();
        if (!text || seen.has(text)) return;
        seen.add(text);
        normalized.push(text);
      });
      const choices = Array.isArray(field?.choices)
        ? field.choices.map((choice) => String(choice ?? '').trim()).filter(Boolean)
        : [];
      if (!choices.length) return normalized;
      const choiceSet = new Set(choices);
      return normalized.filter((item) => choiceSet.has(item));
    }

    extractPlainTextFromRichText(value) {
      const html = String(value ?? '');
      if (!html) return '';
      try {
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');
        return String(doc.body?.textContent || '').replace(/\s+/g, ' ').trim();
      } catch (_err) {
        return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      }
    }

    extractReadableTextFromRichText(value) {
      const html = String(value ?? '');
      if (!html) return '';
      try {
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');
        const parts = [];
        const blockTags = new Set(['ADDRESS', 'ARTICLE', 'ASIDE', 'BLOCKQUOTE', 'DIV', 'DL', 'FIELDSET', 'FIGCAPTION', 'FIGURE', 'FOOTER', 'FORM', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'HEADER', 'HR', 'LI', 'MAIN', 'NAV', 'OL', 'P', 'PRE', 'SECTION', 'TABLE', 'TD', 'TH', 'TR', 'UL']);
        const pushNewline = () => {
          if (!parts.length) return;
          const last = parts[parts.length - 1];
          if (last !== '\n') parts.push('\n');
        };
        const walk = (node) => {
          if (!node) return;
          if (node.nodeType === Node.TEXT_NODE) {
            const text = String(node.textContent || '').replace(/\u00a0/g, ' ');
            if (text) parts.push(text);
            return;
          }
          if (node.nodeType !== Node.ELEMENT_NODE) return;
          const tag = String(node.tagName || '').toUpperCase();
          if (tag === 'BR') {
            pushNewline();
            return;
          }
          const isBlock = blockTags.has(tag);
          if (isBlock) pushNewline();
          if (tag === 'LI') parts.push('• ');
          Array.from(node.childNodes || []).forEach((child) => walk(child));
          if (isBlock) pushNewline();
        };
        Array.from(doc.body?.childNodes || []).forEach((child) => walk(child));
        return parts.join('')
          .replace(/\r\n/g, '\n')
          .replace(/\r/g, '\n')
          .split('\n')
          .map((line) => line.replace(/[ \t\f\v]+/g, ' ').trim())
          .join('\n')
          .replace(/\n{3,}/g, '\n\n')
          .trim();
      } catch (_err) {
        return this.extractPlainTextFromRichText(html);
      }
    }

    formatMultiLinePreview(value) {
      const text = String(value ?? '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
      const preview = text.split('\n').map((line) => line.trim()).filter(Boolean).slice(0, 2).join(' / ');
      return preview || '';
    }

    isSubtableField(field) {
      return (field?.type || '') === 'SUBTABLE';
    }

    isUserSelectField(field) {
      const type = String(field?.type || '').toUpperCase();
      return type === 'USER_SELECT' || type === 'ORGANIZATION_SELECT' || type === 'GROUP_SELECT';
    }

    isFileField(field) {
      return String(field?.type || '').toUpperCase() === 'FILE';
    }

    normalizeSelectionLabels(value) {
      if (Array.isArray(value)) {
        return value
          .map((item) => {
            if (item && typeof item === 'object') {
              return String(item.name || item.code || item.value || '').trim();
            }
            return String(item ?? '').trim();
          })
          .filter(Boolean);
      }
      if (value && typeof value === 'object') {
        return [String(value.name || value.code || value.value || '').trim()].filter(Boolean);
      }
      return [];
    }

    isSubtableDisplayableField(field) {
      if (!field || !field.code || !field.type) return false;
      if (String(field.type || '').toUpperCase() === 'SUBTABLE') return false;
      return !this.permissionService.isSystemField(field);
    }

    getFieldPermissionInfo(recordId, field, options = {}) {
      if (!field || !field.code) return { editable: false, reason: 'unknown_field' };
      const localOnly = Boolean(options.localOnly);
      if (this.permissionService.isSystemField(field)) {
        return { editable: false, reason: 'system_field' };
      }
      if (String(field.type || '').toUpperCase() === 'LOOKUP' || field.lookup || field.lookupAuto) {
        return { editable: false, reason: 'lookup_readonly' };
      }
      if (!this.permissionService.isFieldTypeEditable(field)) {
        return { editable: false, reason: 'field_readonly' };
      }
      if (localOnly) {
        return { editable: true, reason: null };
      }
      return this.getCellPermissionInfo(recordId, field.code);
    }

    resolveFieldInteraction(field, permission, options = {}) {
      const editable = Boolean(permission?.editable);
      const canViewOnly = Boolean(options.viewOnly);
      if (this.isRichTextField(field)) return 'modal-view';
      if (this.isMultiLineField(field)) return editable ? 'modal-edit' : (canViewOnly ? 'modal-view' : 'readonly');
      if (this.isMultiChoiceField(field)) return editable ? 'inline-choice-multi' : 'readonly';
      if (this.isChoiceField(field)) return editable ? 'inline-choice-single' : 'readonly';
      if (this.isFileField(field)) return editable ? 'file-drop' : 'readonly';
      if (this.isLinkField(field) || this.isCalcField(field) || this.isUserSelectField(field)) return editable ? 'inline-edit' : 'readonly';
      if (String(field?.type || '').toUpperCase() === 'NUMBER' || String(field?.type || '').toUpperCase() === 'DATE' || String(field?.type || '').toUpperCase() === 'SINGLE_LINE_TEXT') {
        return editable ? 'inline-edit' : 'readonly';
      }
      return 'readonly';
    }

    formatSubtableCellDisplayValue(field, value) {
      if (this.isMultiValueField(field)) {
        return this.normalizeMultiValue(value, field).join(', ');
      }
      if (this.isUserSelectField(field)) {
        return this.normalizeSelectionLabels(value).join(', ');
      }
      if (this.isRichTextField(field)) {
        return this.extractReadableTextFromRichText(value);
      }
      if (this.isMultiLineField(field)) {
        return this.formatMultiLinePreview(value);
      }
      if (this.isLinkField(field)) {
        return String(value ?? '').trim();
      }
      if (Array.isArray(value)) {
        return value.map((item) => String(item ?? '').trim()).filter(Boolean).join(', ');
      }
      if (value && typeof value === 'object') {
        return String(value.name || value.code || value.value || '').trim();
      }
      return value === undefined || value === null ? '' : String(value);
    }

    buildFieldValueModalText(field, value) {
      if (this.isRichTextField(field)) {
        return this.extractReadableTextFromRichText(value);
      }
      if (this.isMultiLineField(field)) {
        return String(value ?? '');
      }
      return this.formatSubtableCellDisplayValue(field, value);
    }

    async loadFormLayout(forceRefresh = false, trigger = 'subtable_modal_open') {
      if (!forceRefresh && this.formLayoutCache) return this.formLayoutCache;
      const response = await this.postFn('EXCEL_GET_FORM_LAYOUT', {
        appId: this.appId,
        forceRefresh,
        __pbTrigger: trigger
      });
      if (!response?.ok) {
        throw new Error(response?.error || 'Failed to load form layout');
      }
      this.formLayoutCache = response.layout && typeof response.layout === 'object' ? response.layout : {};
      return this.formLayoutCache;
    }

    findSubtableLayoutNode(layout, subtableFieldCode) {
      const targetCode = String(subtableFieldCode || '').trim();
      if (!targetCode) return null;
      const visit = (items) => {
        const list = Array.isArray(items) ? items : [];
        for (const item of list) {
          if (!item || typeof item !== 'object') continue;
          if (String(item.type || '').toUpperCase() === 'SUBTABLE' && String(item.code || '').trim() === targetCode) {
            return item;
          }
          const nested = visit(item.layout);
          if (nested) return nested;
        }
        return null;
      };
      return visit(layout?.layout);
    }

    collectLayoutFieldCodes(subtableLayoutNode) {
      const fields = Array.isArray(subtableLayoutNode?.fields) ? subtableLayoutNode.fields : [];
      return fields
        .map((field) => String(field?.code || '').trim())
        .filter(Boolean);
    }

    async getSubtableLayoutFieldOrder(subtableFieldCode, forceRefresh = false, trigger = 'subtable_modal_open') {
      const key = String(subtableFieldCode || '').trim();
      if (!key) return [];
      if (!forceRefresh && this.subtableLayoutOrderCache.has(key)) {
        return this.subtableLayoutOrderCache.get(key) || [];
      }
      const layout = await this.loadFormLayout(forceRefresh, trigger);
      const subtableNode = this.findSubtableLayoutNode(layout, key);
      const codes = this.collectLayoutFieldCodes(subtableNode);
      this.subtableLayoutOrderCache.set(key, codes);
      return codes;
    }

    async getSubtableEditorChildFields(field) {
      const rawFields = Array.isArray(field?.subtable?.fields) ? field.subtable.fields : [];
      const displayable = rawFields.filter((child) => this.isSubtableDisplayableField(child));
      let layoutOrder = [];
      try {
        layoutOrder = await this.getSubtableLayoutFieldOrder(field?.code);
      } catch (_error) {
        layoutOrder = [];
      }
      if (!Array.isArray(layoutOrder) || !layoutOrder.length) return displayable;
      const orderMap = new Map(layoutOrder.map((code, index) => [String(code || '').trim(), index]));
      return displayable.slice().sort((a, b) => {
        const aIndex = orderMap.has(String(a?.code || '').trim()) ? orderMap.get(String(a?.code || '').trim()) : Number.MAX_SAFE_INTEGER;
        const bIndex = orderMap.has(String(b?.code || '').trim()) ? orderMap.get(String(b?.code || '').trim()) : Number.MAX_SAFE_INTEGER;
        if (aIndex !== bIndex) return aIndex - bIndex;
        return Number(a?.orderIndex || 0) - Number(b?.orderIndex || 0);
      });
    }

    async refreshSubtableLayoutFieldOrder(subtableFieldCode) {
      const key = String(subtableFieldCode || '').trim();
      this.formLayoutCache = null;
      if (key) this.subtableLayoutOrderCache.delete(key);
      return this.getSubtableLayoutFieldOrder(key, true, 'subtable_layout_manual_refresh');
    }

    shouldIncludeField(field) {
      if (!field || !field.code || !field.type) return false;
      return true;
    }

    getCellPermissionInfo(recordId, fieldCode) {
      const key = String(recordId || '').trim();
      const code = String(fieldCode || '').trim();
      if (!key || !code) return { editable: false, reason: 'unknown_field' };
      return this.permissionService.getCellPermission(key, code);
    }

    async loadEffectiveRecordAcl() {
      this.permissionService.clearRecordAcl();
      this.aclStatus = { loaded: false, failed: false };
      const appId = String(this.appId || '').trim();
      if (!appId) return;
      const ids = this.rows
        .map((row) => String(row?.id || '').trim())
        .filter((id) => id && !this.isNewRowId(id));
      if (!ids.length) return;

      const chunkSize = 100;
      let succeeded = false;
      let failed = false;
      const allRights = [];
      for (let i = 0; i < ids.length; i += chunkSize) {
        const chunk = ids.slice(i, i + chunkSize);
        try {
          const res = await this.postFn('EXCEL_EVALUATE_RECORD_ACL', {
            appId,
            ids: chunk,
            __pbTrigger: 'acl_check'
          });
          if (!res?.ok) {
            failed = true;
            console.warn('[kintone-excel-overlay] failed to evaluate record acl', {
              appId,
              ids: chunk,
              error: res?.error || 'unknown error'
            });
            continue;
          }
          succeeded = true;
          const rights = Array.isArray(res.rights)
            ? res.rights
            : Array.isArray(res.records)
              ? res.records
              : [];
          allRights.push(...rights);
        } catch (error) {
          failed = true;
          console.warn('[kintone-excel-overlay] record acl evaluation request failed', {
            appId,
            ids: chunk,
            error: String(error?.message || error)
          });
        }
      }
      if (allRights.length) {
        this.permissionService.refreshRecordAcl(allRights);
      }
      this.aclStatus = {
        loaded: succeeded,
        failed: !succeeded && failed
      };
      this.syncPermissionServicePendingDeletes();
      console.debug('[excel-acl-status]', this.aclStatus);
    }

    getRowPermissionStatusText(recordId) {
      const editable = this.permissionService.canEditRecord(recordId);
      const deletable = this.permissionService.canDeleteRecord(recordId);
      const parts = [];
      if (editable) {
        parts.push(resolveText(this.language, 'permEditable'));
      } else {
        parts.push(resolveText(this.language, 'permViewOnly'));
      }
      if (deletable) {
        parts.push(resolveText(this.language, 'permDeletable'));
      }
      return parts.join(' / ');
    }

    async loadPermissions() {
      // Keep default behavior: do not call app-level ACL APIs in normal flow.
      // Effective per-record restrictions are evaluated via EXCEL_EVALUATE_RECORD_ACL.
      this.syncPermissionServiceFields();
      this.permissionService.setAppPermission({
        editable: true,
        addable: true,
        deletable: true,
        source: 'local'
      });
      this.syncPermissionServicePendingDeletes();
      console.debug('[excel-permission-state]', {
        aclStatus: this.aclStatus,
        rows: this.rows.length
      });
    }

    updatePermissionUiState() {
      const canEdit = this.canEditOverlay();
      const canSave = this.canSaveOverlay();
      if (this.addRowButton) {
        const allowed = !this.isDetailSingleRowMode() && canEdit && this.permissionService.canAddRow();
        const blockedReason = this.isDetailSingleRowMode()
          ? ''
          : (canEdit ? resolveText(this.language, 'permNoAdd') : resolveText(this.language, 'toastViewOnlyBlocked'));
        this.addRowButton.disabled = this.saving || !allowed;
        this.addRowButton.title = allowed
          ? ''
          : blockedReason;
      }
      if (this.saveButton && !this.saving) {
        let dirtyCount = 0;
        this.diff.forEach((entry) => {
          dirtyCount += Object.keys(entry).length;
        });
        dirtyCount += this.pendingDeletes.size;
        this.saveButton.disabled = !canSave || dirtyCount === 0;
        this.saveButton.title = canSave ? '' : resolveText(this.language, 'toastViewOnlyBlocked');
      }
      if (this.permissionWarningEl) {
        const showWarning = this.aclStatus.failed === true && this.aclStatus.loaded === false;
        this.permissionWarningEl.classList.toggle('pb-overlay__perm-warning--hidden', !showWarning);
      }
      this.updateHistoryButtons();
      this.updatePagerUi();
    }

    cloneFieldValue(field, value) {
      if (this.isSubtableField(field)) {
        if (Array.isArray(value)) {
          return value.map((row) => ({
            id: row?.id || '',
            value: row && typeof row.value === 'object' ? JSON.parse(JSON.stringify(row.value)) : {}
          }));
        }
        return [];
      }
      if (this.isMultiValueField(field)) {
        return this.normalizeMultiValue(value, field);
      }
      return value === undefined || value === null ? '' : String(value);
    }

    formatCellDisplayValue(field, value) {
      if (this.isSubtableField(field)) {
        const count = Array.isArray(value) ? value.length : 0;
        return count ? resolveText(this.language, 'subtableRows', count) : '';
      }
      if (this.isFileField(field)) {
        if (!Array.isArray(value) || !value.length) return '';
        return value.map((f) => String(f?.name || f?.fileKey || '')).filter(Boolean).join(', ');
      }
      if (this.isMultiValueField(field)) {
        return this.normalizeMultiValue(value, field).join(', ');
      }
      if (this.isRichTextField(field)) {
        return this.extractPlainTextFromRichText(value);
      }
      if (this.isMultiLineField(field)) {
        return this.formatMultiLinePreview(value);
      }
      return value === undefined || value === null ? '' : String(value);
    }

    async loadColumnPrefMap(force = false) {
      if (!force && this.columnPrefCache) return this.columnPrefCache;
      try {
        const stored = await chrome.storage.sync.get(COLUMN_PREF_STORAGE_KEY);
        const raw = stored?.[COLUMN_PREF_STORAGE_KEY];
        const map = raw && typeof raw === 'object' ? raw : {};
        this.columnPrefCache = { ...map };
        return this.columnPrefCache;
      } catch (_err) {
        this.columnPrefCache = {};
        return this.columnPrefCache;
      }
    }

    async writeColumnPrefMap(map) {
      if (!map || !Object.keys(map).length) {
        await chrome.storage.sync.remove(COLUMN_PREF_STORAGE_KEY);
        this.columnPrefCache = {};
        return;
      }
      await chrome.storage.sync.set({ [COLUMN_PREF_STORAGE_KEY]: map });
      this.columnPrefCache = { ...map };
    }

    async loadSubtableWidthPrefMap(force = false) {
      if (!force && this.subtableWidthPrefCache) return this.subtableWidthPrefCache;
      try {
        const stored = await chrome.storage.sync.get(SUBTABLE_WIDTH_PREF_STORAGE_KEY);
        const raw = stored?.[SUBTABLE_WIDTH_PREF_STORAGE_KEY];
        const map = raw && typeof raw === 'object' ? raw : {};
        this.subtableWidthPrefCache = { ...map };
        return this.subtableWidthPrefCache;
      } catch (_err) {
        this.subtableWidthPrefCache = {};
        return this.subtableWidthPrefCache;
      }
    }

    async writeSubtableWidthPrefMap(map) {
      if (!map || !Object.keys(map).length) {
        await chrome.storage.sync.remove(SUBTABLE_WIDTH_PREF_STORAGE_KEY);
        this.subtableWidthPrefCache = {};
        return;
      }
      await chrome.storage.sync.set({ [SUBTABLE_WIDTH_PREF_STORAGE_KEY]: map });
      this.subtableWidthPrefCache = { ...map };
    }

    getSubtableWidthPrefKey(subtableFieldCode) {
      const app = this.appId ? String(this.appId) : '0';
      const fieldCode = String(subtableFieldCode || '').trim() || 'subtable';
      return `${app}::${fieldCode}`;
    }

    getSubtableColumnWidthRange(type) {
      const t = String(type || '').toUpperCase();
      if (t === 'NUMBER' || t === 'CALC') return { min: 100, max: 140, base: 112 };
      if (t === 'DATE') return { min: 120, max: 140, base: 128 };
      if (t === 'DROP_DOWN' || t === 'RADIO_BUTTON') return { min: 160, max: 200, base: 176 };
      if (t === 'CHECK_BOX' || t === 'MULTI_SELECT') return { min: 180, max: 240, base: 200 };
      if (t === 'MULTI_LINE_TEXT' || t === 'RICH_TEXT') return { min: 220, max: 280, base: 240 };
      if (t === 'LOOKUP') return { min: 180, max: 220, base: 190 };
      if (t === 'LINK' || t === 'USER_SELECT' || t === 'ORGANIZATION_SELECT' || t === 'GROUP_SELECT') return { min: 180, max: 220, base: 190 };
      return { min: 180, max: 220, base: 190 };
    }

    normalizeSubtableColumnWidth(width, type) {
      const range = this.getSubtableColumnWidthRange(type);
      const numeric = Number(width);
      if (!Number.isFinite(numeric)) return range.base;
      return Math.max(range.min, Math.min(range.max, Math.round(numeric)));
    }

    estimateSubtableCellWidth(text) {
      const str = String(text ?? '');
      if (!str) return 0;
      let width = 0;
      for (const ch of str) {
        width += ch.charCodeAt(0) > 255 ? 14 : 8;
      }
      return width + 28;
    }

    computeSubtableAutoWidths(childFields, editorRows) {
      const rows = Array.isArray(editorRows) ? editorRows : [];
      const next = {};
      (Array.isArray(childFields) ? childFields : []).forEach((child) => {
        const code = String(child?.code || '').trim();
        if (!code) return;
        const range = this.getSubtableColumnWidthRange(child.type);
        let width = Math.max(range.base, this.estimateSubtableCellWidth(child.label || child.code));
        rows.slice(0, 80).forEach((item) => {
          const raw = item?.value?.[code]?.value;
          width = Math.max(width, this.estimateSubtableCellWidth(this.formatSubtableCellDisplayValue(child, raw)));
        });
        next[code] = this.normalizeSubtableColumnWidth(width, child.type);
      });
      return next;
    }

    async getInitialSubtableColumnWidths(subtableFieldCode, childFields, editorRows) {
      const map = await this.loadSubtableWidthPrefMap();
      const pref = map[this.getSubtableWidthPrefKey(subtableFieldCode)];
      const widths = {};
      (Array.isArray(childFields) ? childFields : []).forEach((child) => {
        const code = String(child?.code || '').trim();
        if (!code) return;
        const saved = pref?.widths?.[code];
        if (saved !== undefined) {
          widths[code] = this.normalizeSubtableColumnWidth(saved, child.type);
          return;
        }
        widths[code] = this.computeSubtableAutoWidths([child], editorRows)[code];
      });
      return widths;
    }

    async persistSubtableColumnWidths(subtableFieldCode, widths) {
      const fieldCode = String(subtableFieldCode || '').trim();
      if (!fieldCode || !widths || typeof widths !== 'object') return;
      const sanitized = {};
      Object.entries(widths).forEach(([code, width]) => {
        const key = String(code || '').trim();
        if (!key) return;
        sanitized[key] = Math.max(80, Math.min(420, Math.round(Number(width) || 0)));
      });
      if (!Object.keys(sanitized).length) return;
      const map = { ...(await this.loadSubtableWidthPrefMap()) };
      const key = this.getSubtableWidthPrefKey(fieldCode);
      map[key] = {
        appId: this.appId || '',
        fieldCode,
        widths: sanitized,
        savedAt: Date.now()
      };
      const entries = Object.entries(map);
      if (entries.length > MAX_SUBTABLE_WIDTH_PREF_ENTRIES) {
        entries.sort((a, b) => {
          const aTime = a[1]?.savedAt || 0;
          const bTime = b[1]?.savedAt || 0;
          return aTime - bTime;
        });
        while (entries.length > MAX_SUBTABLE_WIDTH_PREF_ENTRIES) {
          const [oldKey] = entries.shift();
          if (oldKey) delete map[oldKey];
        }
      }
      await this.writeSubtableWidthPrefMap(map);
    }

    getColumnPrefKey() {
      const app = this.appId ? String(this.appId) : '0';
      const viewKey = this.viewKey || 'default';
      return `${app}::${viewKey}`;
    }

    async getSavedColumnPref(defaultCodes = []) {
      const baseFields = this.getListScopeBaseFields(this.listFieldScopeMode);
      await this.ensureOverlayLayoutState(baseFields.length ? baseFields : this.fieldsMeta);
      const active = this.getActiveLayoutPreset();
      if (!active) return null;
      const allowed = new Set(defaultCodes.length ? defaultCodes : this.fields.map((f) => f.code));
      const order = Array.isArray(active.columnOrder) ? active.columnOrder : [];
      const filteredOrder = order
        .map((code) => String(code || '').trim())
        .filter((code) => allowed.has(code));
      const widths = active.columnWidths && typeof active.columnWidths === 'object'
        ? { ...active.columnWidths }
        : null;
      return { order: filteredOrder, widths, savedAt: this.overlayLayoutState?.updatedAt || 0 };
    }

    async persistColumnPref(order, widths) {
      if (!Array.isArray(order) || !order.length) return;
      const baseFields = this.getListScopeBaseFields(this.listFieldScopeMode);
      const sourceFields = baseFields.length ? baseFields : this.fieldsMeta;
      await this.ensureOverlayLayoutState(sourceFields);
      const active = this.getActiveLayoutPreset();
      if (!active) return;
      const baseCodes = this.getBaseFieldCodeList(sourceFields);
      const allowed = new Set(baseCodes);
      const visibleSet = new Set(
        Array.isArray(active.visibleColumns) && active.visibleColumns.length
          ? active.visibleColumns
          : this.fields.map((field) => String(field?.code || '').trim()).filter(Boolean)
      );
      active.visibleColumns = Array.from(visibleSet).filter((code) => allowed.has(code));
      const nextOrder = [];
      const seen = new Set();
      order.forEach((codeRaw) => {
        const code = String(codeRaw || '').trim();
        if (!code || !allowed.has(code) || !visibleSet.has(code) || seen.has(code)) return;
        nextOrder.push(code);
        seen.add(code);
      });
      active.visibleColumns.forEach((code) => {
        if (seen.has(code)) return;
        nextOrder.push(code);
        seen.add(code);
      });
      active.columnOrder = nextOrder;
      const mergedWidths = active.columnWidths && typeof active.columnWidths === 'object'
        ? { ...active.columnWidths }
        : {};
      if (widths && typeof widths === 'object') {
        Object.entries(widths).forEach(([codeRaw, valueRaw]) => {
          const code = String(codeRaw || '').trim();
          if (!code || !allowed.has(code)) return;
          const numeric = Number(valueRaw);
          if (!Number.isFinite(numeric)) return;
          mergedWidths[code] = Math.max(MIN_COLUMN_WIDTH, Math.min(MAX_COLUMN_WIDTH, Math.round(numeric)));
        });
      }
      active.columnWidths = mergedWidths;
      await this.persistOverlayLayoutState();
      this.updateLayoutPresetToolbarUi();
    }

    async removeColumnOrder() {
      const baseFields = this.getListScopeBaseFields(this.listFieldScopeMode);
      const sourceFields = baseFields.length ? baseFields : this.fieldsMeta;
      await this.ensureOverlayLayoutState(sourceFields);
      const active = this.getActiveLayoutPreset();
      if (!active) return;
      const baseCodes = this.getBaseFieldCodeList(sourceFields);
      active.visibleColumns = baseCodes.slice();
      active.columnOrder = baseCodes.slice();
      active.columnWidths = {};
      await this.persistOverlayLayoutState();
      this.updateLayoutPresetToolbarUi();
    }

    applyColumnOrder(order, options = {}) {
      if (!Array.isArray(order) || !order.length || !this.fields.length) return;
      const updateDraft = options.updateDraft !== false;
      const lookup = new Map(this.fields.map((field) => [field.code, field]));
      const next = [];
      const seen = new Set();
      order.forEach((code) => {
        if (seen.has(code)) return;
        const field = lookup.get(code);
        if (field) {
          next.push(field);
          seen.add(code);
        }
      });
      this.fields.forEach((field) => {
        if (!seen.has(field.code)) {
          next.push(field);
        }
      });
      this.fields = next;
      this.rebuildFieldMaps();
      this.selection = null;
      this.armedCell = null;
      this.editingCell = null;
      this.pendingFocus = null;
      this.pendingEdit = null;
      this.renderGrid();
      this.updateVirtualRows(true);
      this.syncTableWidth();
      if (updateDraft) {
        this.columnOrderDraft = this.fields.map((field) => field.code);
      }
    }

    attachModalBodyScrollGuards(element) {
      if (!element) return;
      const stopPropagation = (event) => {
        event.stopPropagation();
      };
      element.addEventListener('wheel', stopPropagation, { passive: true });
      element.addEventListener('touchmove', stopPropagation, { passive: true });
    }

    openColumnManager() {
      if (!this.surface || this.columnPanelLayer || !this.fields.length) return;
      const layer = document.createElement('div');
      layer.className = 'pb-overlay__column-layer';
      layer.addEventListener('click', (event) => {
        if (event.target === layer) this.closeColumnManager();
      });

      const panel = document.createElement('div');
      panel.className = 'pb-overlay__column-panel';
      panel.setAttribute('role', 'dialog');
      panel.setAttribute('aria-label', resolveText(this.language, 'columnsTitle'));
      panel.addEventListener('keydown', (event) => {
        event.stopPropagation();
      });
      this.attachModalBodyScrollGuards(panel);

      const header = document.createElement('div');
      header.className = 'pb-overlay__column-panel-head';
      const titleWrap = document.createElement('div');
      const title = document.createElement('div');
      title.className = 'pb-overlay__column-panel-title';
      title.textContent = resolveText(this.language, 'columnsTitle');
      const hint = document.createElement('p');
      hint.className = 'pb-overlay__column-panel-hint';
      hint.textContent = resolveText(this.language, 'columnsHint');
      titleWrap.appendChild(title);
      titleWrap.appendChild(hint);
      const closeBtn = document.createElement('button');
      closeBtn.type = 'button';
      closeBtn.className = 'pb-overlay__column-close';
      closeBtn.setAttribute('aria-label', resolveText(this.language, 'columnsClose'));
      closeBtn.textContent = '×';
      closeBtn.addEventListener('click', () => { this.closeColumnManager(); });
      header.appendChild(titleWrap);
      header.appendChild(closeBtn);

      const body = document.createElement('div');
      body.className = 'pb-overlay__column-panel-body';

      const preview = document.createElement('div');
      preview.className = 'pb-overlay__column-preview';
      const previewScroll = document.createElement('div');
      previewScroll.className = 'pb-overlay__column-preview-scroll';
      const previewRow = document.createElement('div');
      previewRow.className = 'pb-overlay__column-preview-row';
      previewScroll.appendChild(previewRow);
      preview.appendChild(previewScroll);

      const visibilityWrap = document.createElement('div');
      visibilityWrap.className = 'pb-overlay__column-visibility';
      const visibilityTitle = document.createElement('div');
      visibilityTitle.className = 'pb-overlay__column-visibility-title';
      visibilityTitle.textContent = resolveText(this.language, 'columnsVisibilityTitle');
      const visibilityList = document.createElement('div');
      visibilityList.className = 'pb-overlay__column-visibility-list';
      visibilityWrap.appendChild(visibilityTitle);
      visibilityWrap.appendChild(visibilityList);

      const footer = document.createElement('div');
      footer.className = 'pb-overlay__column-panel-foot';
      const actions = document.createElement('div');
      actions.className = 'pb-overlay__column-panel-actions';
      const autoBtn = document.createElement('button');
      autoBtn.type = 'button';
      autoBtn.className = 'pb-overlay__btn';
      autoBtn.textContent = resolveText(this.language, 'columnsAutoWidth');
      autoBtn.addEventListener('click', () => { this.autoAdjustColumnWidths(); });

      const resetBtn = document.createElement('button');
      resetBtn.type = 'button';
      resetBtn.className = 'pb-overlay__btn';
      resetBtn.textContent = resolveText(this.language, 'columnsReset');
      resetBtn.addEventListener('click', () => { this.handleColumnReset(); });
      const saveBtn = document.createElement('button');
      saveBtn.type = 'button';
      saveBtn.className = 'pb-overlay__btn pb-overlay__btn--primary';
      saveBtn.textContent = resolveText(this.language, 'columnsSave');
      saveBtn.addEventListener('click', () => { this.handleColumnSave(); });
      actions.appendChild(autoBtn);
      actions.appendChild(resetBtn);
      actions.appendChild(saveBtn);
      footer.appendChild(actions);

      body.appendChild(preview);
      body.appendChild(visibilityWrap);

      panel.appendChild(header);
      panel.appendChild(body);
      panel.appendChild(footer);
      layer.appendChild(panel);
      this.surface.appendChild(layer);

      const activePreset = this.getActiveLayoutPreset();
      const baseFields = this.getListScopeBaseFields(this.listFieldScopeMode);
      const sourceFields = baseFields.length ? baseFields : this.fieldsMeta;
      const sourceCodes = this.getBaseFieldCodeList(sourceFields);
      const config = this.resolvePresetColumnConfig(sourceFields, activePreset);
      this.columnDraftAllFieldCodes = sourceCodes.slice();
      this.columnVisibilityDraft = new Set(config.visibleColumns);
      this.columnOrderDraft = config.orderedCodes.slice();
      this.columnPanelLayer = layer;
      this.columnPreviewRow = previewRow;
      this.columnVisibilityList = visibilityList;
      previewRow.addEventListener('dragover', (event) => {
        if (!this.draggingColumnCode) return;
        if (event.target.closest('.pb-overlay__column-chip')) return;
        event.preventDefault();
      });
      previewRow.addEventListener('drop', (event) => {
        const chip = event.target.closest('.pb-overlay__column-chip');
        if (chip) return;
        if (!this.draggingColumnCode) return;
        event.preventDefault();
        this.handleColumnDrop(null, { append: true });
      });
      this.renderColumnPreview();
      this.renderColumnVisibilityList();

      setTimeout(() => {
        saveBtn.focus();
      }, 0);
    }

    closeColumnManager(skipFocus = false) {
      if (this.columnPanelLayer) {
        this.columnPanelLayer.remove();
      }
      this.columnPanelLayer = null;
      this.columnPreviewRow = null;
      this.columnVisibilityList = null;
      this.draggingColumnCode = null;
      this.columnVisibilityDraft = new Set();
      this.columnDraftAllFieldCodes = [];
      if (!skipFocus && this.columnButton) {
        this.columnButton.focus();
      }
    }

    renderColumnPreview() {
      if (!this.columnPreviewRow) return;
      this.columnPreviewRow.textContent = '';
      if (!this.columnOrderDraft.length) {
        const empty = document.createElement('div');
        empty.className = 'pb-overlay__column-empty';
        empty.textContent = resolveText(this.language, 'columnsEmpty');
        this.columnPreviewRow.appendChild(empty);
        return;
      }
      this.columnOrderDraft.forEach((code, index) => {
        const field = this.fieldMap.get(code) || this.fieldsMetaMap.get(code);
        const activePreset = this.getActiveLayoutPreset();
        const presetWidth = Number(activePreset?.columnWidths?.[code]);
        const baseWidth = Number.isFinite(presetWidth)
          ? Math.max(MIN_COLUMN_WIDTH, Math.min(MAX_COLUMN_WIDTH, Math.round(presetWidth)))
          : (field?.width || DEFAULT_COLUMN_WIDTH);
        const chip = document.createElement('div');
        chip.className = 'pb-overlay__column-chip';
        chip.draggable = true;
        chip.dataset.code = code;
        chip.dataset.width = String(baseWidth);
        chip.style.width = `${baseWidth}px`;
        chip.setAttribute('aria-label', `${columnLabel(index)} ${field?.label || code}`);

        const letter = document.createElement('span');
        letter.className = 'pb-overlay__column-chip-letter';
        letter.textContent = columnLabel(index);

        const label = document.createElement('span');
        label.className = 'pb-overlay__column-chip-label';
        label.textContent = field?.label || code;

        const widthValue = document.createElement('span');
        widthValue.className = 'pb-overlay__column-chip-width';
        widthValue.textContent = `${baseWidth}px`;

        chip.append(letter, label, widthValue);

        chip.addEventListener('dragstart', (event) => {
          this.draggingColumnCode = code;
          chip.classList.add('is-dragging');
          if (event.dataTransfer) {
            event.dataTransfer.effectAllowed = 'move';
            try {
              event.dataTransfer.setData('text/plain', code);
            } catch (_err) {}
          }
        });
        chip.addEventListener('dragend', () => {
          chip.classList.remove('is-dragging');
          chip.classList.remove('is-drop-target');
          this.draggingColumnCode = null;
        });
        chip.addEventListener('dragover', (event) => {
          if (!this.draggingColumnCode || this.draggingColumnCode === code) return;
          event.preventDefault();
          chip.classList.add('is-drop-target');
        });
        chip.addEventListener('dragleave', () => {
          chip.classList.remove('is-drop-target');
        });
        chip.addEventListener('drop', (event) => {
          if (!this.draggingColumnCode) return;
          event.preventDefault();
          chip.classList.remove('is-drop-target');
          this.handleColumnDrop(code);
        });

        const resizer = document.createElement('div');
        resizer.className = 'pb-overlay__column-chip-resizer';
        resizer.setAttribute('role', 'separator');
        resizer.setAttribute('aria-label', `${field?.label || code} width handle`);
        let startX = 0;
        let startWidth = baseWidth;
        const onMouseMove = (event) => {
          const delta = event.clientX - startX;
          const nextWidth = Math.max(MIN_COLUMN_WIDTH, Math.min(MAX_COLUMN_WIDTH, startWidth + delta));
          chip.style.width = `${nextWidth}px`;
          chip.dataset.width = String(nextWidth);
          widthValue.textContent = `${nextWidth}px`;
        };
        const onMouseUp = () => {
          document.removeEventListener('mousemove', onMouseMove);
          document.removeEventListener('mouseup', onMouseUp);
          const finalWidth = Number(chip.dataset.width || startWidth);
          this.applyColumnWidth(code, finalWidth);
          this.persistColumnPref(this.columnOrderDraft, this.collectColumnWidths()).catch(() => {});
        };
        resizer.addEventListener('mousedown', (event) => {
          event.preventDefault();
          event.stopPropagation();
          startX = event.clientX;
          startWidth = Number(chip.dataset.width || baseWidth);
          document.addEventListener('mousemove', onMouseMove);
          document.addEventListener('mouseup', onMouseUp);
        });

        chip.appendChild(resizer);
        this.columnPreviewRow.appendChild(chip);
      });
    }

    renderColumnVisibilityList() {
      if (!this.columnVisibilityList) return;
      this.columnVisibilityList.textContent = '';
      const allCodes = Array.isArray(this.columnDraftAllFieldCodes) ? this.columnDraftAllFieldCodes : [];
      if (!allCodes.length) return;
      allCodes.forEach((code) => {
        const field = this.fieldsMetaMap.get(code) || this.fieldMap.get(code);
        const row = document.createElement('label');
        row.className = 'pb-overlay__column-visibility-item';
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.checked = this.columnVisibilityDraft.has(code);
        input.addEventListener('change', () => {
          if (input.checked) {
            this.columnVisibilityDraft.add(code);
            if (!this.columnOrderDraft.includes(code)) {
              this.columnOrderDraft.push(code);
            }
          } else {
            this.columnVisibilityDraft.delete(code);
            this.columnOrderDraft = this.columnOrderDraft.filter((value) => value !== code);
          }
          this.renderColumnPreview();
        });
        const text = document.createElement('span');
        text.textContent = field?.label || code;
        row.appendChild(input);
        row.appendChild(text);
        this.columnVisibilityList.appendChild(row);
      });
    }

    handleColumnDrop(targetCode, options = {}) {
      if (!this.draggingColumnCode) return;
      if (targetCode && targetCode === this.draggingColumnCode) return;
      const from = this.columnOrderDraft.indexOf(this.draggingColumnCode);
      if (from === -1) return;
      const next = [...this.columnOrderDraft];
      const [moved] = next.splice(from, 1);
      if (options.append || !targetCode) {
        next.push(moved);
      } else {
        const to = next.indexOf(targetCode);
        if (to === -1) return;
        next.splice(to, 0, moved);
      }
      this.columnOrderDraft = next;
      this.draggingColumnCode = null;
      this.renderColumnPreview();
    }

    applyColumnWidth(code, width) {
      const clamped = Math.max(MIN_COLUMN_WIDTH, Math.min(MAX_COLUMN_WIDTH, Math.round(width)));
      const activePreset = this.getActiveLayoutPreset();
      if (activePreset) {
        const nextWidths = activePreset.columnWidths && typeof activePreset.columnWidths === 'object'
          ? { ...activePreset.columnWidths }
          : {};
        nextWidths[code] = clamped;
        activePreset.columnWidths = nextWidths;
      }
      const field = this.fieldMap.get(code);
      if (field) {
        field.width = clamped;
      }
      const colIndex = this.fields.findIndex((f) => f.code === code);
      if (colIndex >= 0) {
        this.updateColumnWidth(colIndex, clamped);
      }
      if (this.columnPreviewRow) {
        this.renderColumnPreview();
      }
    }

    updateColumnWidth(columnIndex, width) {
      const headers = this.columnHeaderScroll?.querySelectorAll('.pb-overlay__col-header');
      if (headers && headers[columnIndex]) {
        headers[columnIndex].style.width = `${width}px`;
        headers[columnIndex].style.minWidth = `${width}px`;
      }
      const rows = this.tableContainer?.querySelectorAll('.pb-overlay__row');
      if (rows) {
        rows.forEach((row) => {
          const cell = row.children[columnIndex];
          if (cell) {
            cell.style.width = `${width}px`;
            cell.style.minWidth = `${width}px`;
          }
        });
      }
      this.syncTableWidth();
    }

    syncTableWidth() {
      if (!this.tableContainer) return;
      const totalWidth = this.fields.reduce((sum, field) => sum + (field.width || DEFAULT_COLUMN_WIDTH), 0);
      this.tableContainer.style.width = `${totalWidth}px`;
    }

    collectColumnWidths() {
      const map = {};
      this.fields.forEach((field) => {
        if (field.width && field.width !== DEFAULT_COLUMN_WIDTH) {
          map[field.code] = field.width;
        }
      });
      return map;
    }

    autoAdjustColumnWidths() {
      if (!this.fields.length) return;
      const measureTextWidth = (text) => {
        if (!text) return 0;
        const str = String(text);
        let width = 0;
        for (const ch of str) {
          width += ch.charCodeAt(0) > 255 ? 16 : 9;
        }
        return Math.round(width * 1.15 + 32);
      };
      const sampleRows = this.rows.slice(0, 60);
      const widths = {};
      this.fields.forEach((field) => {
        const headerWidth = measureTextWidth(field.label || field.code);
        let maxWidth = headerWidth;
        sampleRows.forEach((row) => {
          const value = row?.values?.[field.code] ?? '';
          maxWidth = Math.max(maxWidth, measureTextWidth(value));
        });
        widths[field.code] = Math.max(MIN_COLUMN_WIDTH, Math.min(MAX_COLUMN_WIDTH, Math.round(maxWidth)));
      });
      Object.entries(widths).forEach(([code, width]) => {
        this.applyColumnWidth(code, width);
      });
      if (this.columnPreviewRow) {
        this.renderColumnPreview();
      }
      this.persistColumnPref(this.columnOrderDraft, this.collectColumnWidths()).catch(() => {});
      this.notify(resolveText(this.language, 'toastColumnsAutoWidth'));
    }

    async handleColumnSave() {
      if (!this.columnOrderDraft.length) {
        this.closeColumnManager();
        return;
      }
      try {
        const visibleCodes = Array.from(this.columnVisibilityDraft);
        const activePreset = this.getActiveLayoutPreset();
        if (activePreset) {
          const orderedVisible = this.columnOrderDraft.filter((code) => visibleCodes.includes(code));
          activePreset.visibleColumns = visibleCodes.slice();
          activePreset.columnOrder = orderedVisible.slice();
        }
        const widths = this.collectColumnWidths();
        await this.persistColumnPref(this.columnOrderDraft, widths);
        console.debug('[PB] OVERLAY rerender reason=preset_save');
        if (this.isListMode()) {
          await this.applyListFieldScope(this.listFieldScopeMode);
        } else {
          const baseFields = this.fieldsMeta.map((field) => ({ ...field }));
          await this.ensureOverlayLayoutState(baseFields);
          const active = this.getActiveLayoutPreset();
          this.defaultFieldCodes = this.getBaseFieldCodeList(baseFields);
          this.fields = this.buildVisibleFieldsFromPreset(baseFields, active);
          this.logOverlayPresetDebug(active, this.fields, 'preset_save_non_list');
          this.rebuildFieldMaps();
          this.renderGrid();
          this.updateVirtualRows(true);
          this.syncTableWidth();
        }
        this.notify(resolveText(this.language, 'toastColumnsSaved'));
      } catch (error) {
        console.error('[kintone-excel-overlay] failed to save column order', error);
        this.notify(resolveText(this.language, 'toastSaveFailed'));
      }
      this.closeColumnManager(true);
      if (this.columnButton) this.columnButton.focus();
    }

    async handleColumnReset() {
      try {
        await this.removeColumnOrder();
        if (this.isListMode()) {
          await this.applyListFieldScope(this.listFieldScopeMode);
        } else {
          const baseFields = this.fieldsMeta.map((field) => ({ ...field }));
          await this.ensureOverlayLayoutState(baseFields);
          const activePreset = this.getActiveLayoutPreset();
          this.defaultFieldCodes = this.getBaseFieldCodeList(baseFields);
          this.fields = this.buildVisibleFieldsFromPreset(baseFields, activePreset);
          this.rebuildFieldMaps();
          this.renderGrid();
          this.updateVirtualRows(true);
          this.syncTableWidth();
        }
        this.columnOrderDraft = this.fields.map((field) => field.code);
        this.columnDraftAllFieldCodes = this.defaultFieldCodes.slice();
        this.columnVisibilityDraft = new Set(this.columnOrderDraft);
        this.renderColumnPreview();
        this.renderColumnVisibilityList();
        this.notify(resolveText(this.language, 'toastColumnsReset'));
      } catch (error) {
        console.error('[kintone-excel-overlay] failed to reset column order', error);
        this.notify(resolveText(this.language, 'toastSaveFailed'));
      }
    }

    transformRecord(record) {
      const id = record?.$id?.value ? String(record.$id.value) : '';
      const revision = record?.$revision?.value ? String(record.$revision.value) : undefined;
      const values = {};
      const original = {};
      this.getRecordFetchFieldCodes().forEach((fieldCode) => {
        const field = this.getFieldDefinition(fieldCode);
        const raw = record?.[fieldCode]?.value;
        const baseValue = this.cloneFieldValue(field, raw);
        values[fieldCode] = baseValue;
        original[fieldCode] = this.cloneFieldValue(field, baseValue);
      });
      return { id, revision, values, original, isNew: false };
    }

    renderNoFields() {
      if (!this.surface) return;
      this.surface.innerHTML = '';
      const message = document.createElement('div');
      message.className = 'pb-overlay__message';
      message.textContent = resolveText(this.language, 'noEditableFields');
      const closeBtn = document.createElement('button');
      closeBtn.type = 'button';
      closeBtn.className = 'pb-overlay__btn pb-overlay__btn--primary';
      closeBtn.textContent = resolveText(this.language, 'btnClose');
      closeBtn.addEventListener('click', () => { this.close(true); });
      message.appendChild(closeBtn);
      this.surface.appendChild(message);
    }

    renderGrid() {
      if (!this.surface) return;
      this.closeFilterPanel();
      this.closeRadioPicker();
      this.closeMultiChoicePicker();
      this.closeMultilineEditor();
      this.inputsByRow.clear();
      if (this.columnHeaderScroll) {
        this.columnHeaderScroll.style.transform = '';
      }
      const headRow = this.columnHeaderScroll?.querySelector('.pb-overlay__col-row');
      if (headRow) {
        headRow.style.transform = 'translateX(0px)';
      }
      const rowWrap = this.rowHeaderScroll?.querySelector('.pb-overlay__row-wrap');
      const table = this.bodyScroll?.querySelector('.pb-overlay__table');
      if (headRow) headRow.textContent = '';
      if (rowWrap) rowWrap.textContent = '';
      if (table) table.textContent = '';
      if (this.detailFormContainer) {
        this.detailFormContainer.textContent = '';
      }
      if (this.gridRoot) {
        this.gridRoot.classList.toggle('pb-overlay__grid--detail-form', this.isDetailFormLayoutMode());
      }

      if (this.isDetailFormLayoutMode()) {
        this.rowHeaderContainer = null;
        this.tableContainer = null;
        this.renderDetailForm();
        return;
      }

      const visibleRows = this.getVisibleRows();
      const totalHeight = Math.max(0, visibleRows.length * this.rowHeight);
      if (rowWrap) rowWrap.style.height = `${totalHeight}px`;
      if (table) table.style.height = `${totalHeight}px`;

      this.fields.forEach((field, index) => {
        const headerCell = document.createElement('div');
        headerCell.className = 'pb-overlay__col-header';
        headerCell.style.width = `${field.width || DEFAULT_COLUMN_WIDTH}px`;
        headerCell.style.minWidth = `${field.width || DEFAULT_COLUMN_WIDTH}px`;
        const headerMain = document.createElement('div');
        headerMain.className = 'pb-overlay__col-header-main';
        headerMain.style.cursor = 'pointer';
        const codeSpan = document.createElement('span');
        codeSpan.className = 'pb-overlay__col-code';
        codeSpan.textContent = columnLabel(index);
        const labelWrap = document.createElement('span');
        labelWrap.className = 'pb-overlay__col-label-wrap';
        const labelSpan = document.createElement('span');
        labelSpan.className = 'pb-overlay__col-label';
        labelSpan.textContent = field.label || field.code;
        const sortIndicator = document.createElement('span');
        sortIndicator.className = 'pb-overlay__col-sort-indicator';
        const sortDirection = this.getSortDirectionForField(field.code);
        sortIndicator.textContent = sortDirection === 'asc' ? '▲' : (sortDirection === 'desc' ? '▼' : '');
        labelWrap.appendChild(labelSpan);
        labelWrap.appendChild(sortIndicator);
        headerMain.appendChild(codeSpan);
        headerMain.appendChild(labelWrap);
        const filterBtn = document.createElement('button');
        filterBtn.type = 'button';
        filterBtn.className = 'pb-overlay__filter-btn';
        filterBtn.textContent = '▼';
        const filterLabel = resolveText(this.language, 'filterButton');
        filterBtn.title = filterLabel;
        filterBtn.setAttribute('aria-label', `${filterLabel}: ${field.label || field.code}`);
        if (this.isFieldFilterActive(field.code)) {
          filterBtn.classList.add('pb-overlay__filter-btn--active');
        }
        filterBtn.addEventListener('click', (event) => {
          event.preventDefault();
          event.stopPropagation();
          this.openFilterPanel(field, filterBtn);
        });
        headerMain.addEventListener('click', (event) => {
          event.preventDefault();
          this.toggleSortForField(field.code);
        });
        headerCell.appendChild(headerMain);
        headerCell.appendChild(filterBtn);
        headRow?.appendChild(headerCell);
      });

      const rowContainer = document.createElement('div');
      rowContainer.className = 'pb-overlay__row-virtual';
      rowContainer.style.position = 'absolute';
      rowContainer.style.top = '0';
      rowContainer.style.left = '0';
      rowContainer.style.right = '0';
      rowContainer.style.width = '100%';
      this.rowHeaderContainer = rowContainer;
      rowWrap?.appendChild(rowContainer);

      const tableContainer = document.createElement('div');
      tableContainer.className = 'pb-overlay__table-virtual';
      tableContainer.style.position = 'absolute';
      tableContainer.style.top = '0';
      tableContainer.style.left = '0';
      const totalWidth = this.fields.reduce((sum, field) => sum + (field.width || DEFAULT_COLUMN_WIDTH), 0);
      tableContainer.style.width = `${totalWidth}px`;
      this.tableContainer = tableContainer;
      table?.appendChild(tableContainer);

      this.virtualStart = 0;
      this.virtualEnd = 0;
      this.updateVirtualRows(true);
    }

    renderDetailForm() {
      if (!this.detailFormContainer) return;
      const visibleRows = this.getVisibleRows();
      const row = visibleRows[0] || null;
      const pendingDelete = Boolean(row && this.pendingDeletes.has(String(row.id || '').trim()));
      const formContainer = this.detailFormContainer;
      formContainer.textContent = '';
      formContainer.classList.toggle('pb-overlay__detail-form--pending-delete', pendingDelete);
      const table = document.createElement('div');
      table.className = 'pb-overlay__detail-form-table';
      const head = document.createElement('div');
      head.className = 'pb-overlay__detail-form-head';
      const fieldHead = document.createElement('span');
      fieldHead.className = 'pb-overlay__detail-form-head-cell';
      fieldHead.textContent = resolveText(this.language, 'formFieldHeader');
      const valueHead = document.createElement('span');
      valueHead.className = 'pb-overlay__detail-form-head-cell';
      valueHead.textContent = resolveText(this.language, 'formValueHeader');
      head.appendChild(fieldHead);
      head.appendChild(valueHead);
      table.appendChild(head);

      const inputsRow = [];
      if (row) {
        this.fields.forEach((field, colIndex) => {
          const rowLine = document.createElement('div');
          rowLine.className = 'pb-overlay__detail-form-row';
          const fieldCell = document.createElement('div');
          fieldCell.className = 'pb-overlay__detail-form-field';
          fieldCell.textContent = field.label || field.code;
          fieldCell.title = field.label || field.code;

          const valueCell = document.createElement('div');
          valueCell.className = 'pb-overlay__detail-form-value';
          const cell = document.createElement('div');
          cell.className = 'pb-overlay__cell pb-overlay__detail-form-data-cell';
          cell.dataset.fieldCode = String(field.code || '');
          const input = this.createInputBase(field);
          this.bindInputToRow(input, field, row, 0, colIndex);
          cell.appendChild(input);
          if (this.isSubtableField(field)) {
            valueCell.classList.add('pb-overlay__detail-form-value--subtable');
            cell.classList.add('pb-overlay__detail-form-data-cell--subtable');
            valueCell.title = resolveText(this.language, 'btnSubtableEdit');
            const activate = (event) => {
              this.activateDetailFormSubtable(event, input, 0, colIndex);
            };
            valueCell.addEventListener('mousedown', activate);
            valueCell.addEventListener('click', activate);
          }
          this.applyCellVisualState(input, row, field.code);
          valueCell.appendChild(cell);

          rowLine.appendChild(fieldCell);
          rowLine.appendChild(valueCell);
          table.appendChild(rowLine);
          inputsRow[colIndex] = input;
        });
        this.inputsByRow.set(0, inputsRow);
      }
      formContainer.appendChild(table);
      this.virtualStart = 0;
      this.virtualEnd = row ? 1 : 0;
      this.repaintSelection();
      this.restorePendingFocus();
    }

    updateVirtualRows(force = false) {
      if (this.isDetailFormLayoutMode()) {
        if (force) {
          this.renderDetailForm();
        } else {
          this.restorePendingFocus();
        }
        return;
      }
      if (!this.bodyScroll || !this.tableContainer || !this.rowHeaderContainer) return;
      const visibleRows = this.getVisibleRows();
      const totalRows = visibleRows.length;
      const viewportHeight = this.bodyScroll.clientHeight || (10 * this.rowHeight);
      const scrollTop = this.bodyScroll.scrollTop;
      const buffer = 6;
      const start = Math.max(0, Math.floor(scrollTop / this.rowHeight) - buffer);
      const end = Math.min(totalRows, Math.ceil((scrollTop + viewportHeight) / this.rowHeight) + buffer);
      if (!force && start === this.virtualStart && end === this.virtualEnd) {
        this.restorePendingFocus();
        return;
      }
      this.virtualStart = start;
      this.virtualEnd = end;
      this.inputsByRow.clear();
      this.rowHeaderContainer.textContent = '';
      this.rowHeaderContainer.style.height = `${totalRows * this.rowHeight}px`;
      this.tableContainer.textContent = '';
      const totalWidth = this.fields.reduce((sum, field) => sum + (field.width || DEFAULT_COLUMN_WIDTH), 0);
      this.tableContainer.style.width = `${totalWidth}px`;

      const headerFrag = document.createDocumentFragment();
      const tableFrag = document.createDocumentFragment();

      for (let rowIndex = start; rowIndex < end; rowIndex += 1) {
        const row = visibleRows[rowIndex];
        if (!row) continue;
        const recordId = String(row.id || '').trim();
        const pendingDelete = this.pendingDeletes.has(recordId);
        const rowEditable = this.isOverlayEditable() && this.permissionService.canEditRecord(recordId);
        const rowEditableVisual = this.isOverlayViewOnly() ? true : rowEditable;
        const rowDeletable = !this.isDetailSingleRowMode()
          && this.isOverlayEditable()
          && this.permissionService.canDeleteRecord(recordId);
        const top = rowIndex * this.rowHeight;

        const header = document.createElement('div');
        header.className = 'pb-overlay__row-header';
        header.style.position = 'absolute';
        header.style.top = `${top}px`;
        header.style.left = '0';
        if (!rowEditableVisual) header.classList.add('pb-overlay__row-header--readonly');
        if (pendingDelete) header.classList.add('pb-overlay__row-header--pending-delete');
        if (pendingDelete) {
          header.title = resolveText(this.language, 'rowDeletePendingTitle');
        } else if (!rowEditableVisual) {
          header.title = resolveText(this.language, 'permNoEdit');
        } else {
          header.removeAttribute('title');
        }

        const indexEl = document.createElement('span');
        indexEl.className = 'pb-overlay__row-index';
        indexEl.textContent = String(rowIndex + 1);
        header.appendChild(indexEl);

        const sepEl = document.createElement('span');
        sepEl.className = 'pb-overlay__row-sep';
        sepEl.setAttribute('aria-hidden', 'true');
        header.appendChild(sepEl);

        const deleteBtn = document.createElement('button');
        deleteBtn.type = 'button';
        deleteBtn.className = 'pb-overlay__row-delete pb-overlay__delete-btn';
        deleteBtn.textContent = '🗑';
        if (pendingDelete) {
          deleteBtn.classList.add('is-pending');
        }
        const isNew = this.isNewRowId(recordId);
        if (isNew) {
          deleteBtn.title = resolveText(this.language, 'rowDeleteNewUndo');
          deleteBtn.setAttribute('aria-label', resolveText(this.language, 'rowDeleteNewUndo'));
        } else if (pendingDelete) {
          deleteBtn.title = resolveText(this.language, 'rowDeletePendingTitle');
          deleteBtn.setAttribute('aria-label', resolveText(this.language, 'rowDeletePendingTitle'));
        } else {
          deleteBtn.title = rowDeletable
            ? resolveText(this.language, 'rowDeleteToggle')
            : resolveText(this.language, 'permNoDelete');
          deleteBtn.setAttribute('aria-label', deleteBtn.title);
        }
        if (!isNew && !rowDeletable) {
          deleteBtn.disabled = true;
        }
        deleteBtn.addEventListener('click', (event) => {
          event.preventDefault();
          event.stopPropagation();
          this.togglePendingDelete(recordId);
        });
        header.appendChild(deleteBtn);

        const permEl = document.createElement('span');
        permEl.className = 'pb-overlay__row-perm';
        permEl.textContent = rowEditableVisual ? '✎' : '👁';
        permEl.title = this.getRowPermissionStatusText(recordId);
        header.appendChild(permEl);
        headerFrag.appendChild(header);

        const rowLine = document.createElement('div');
        rowLine.className = 'pb-overlay__row';
        rowLine.style.position = 'absolute';
        rowLine.style.top = `${top}px`;
        rowLine.style.left = '0';
        rowLine.style.width = 'max-content';
        if (!rowEditableVisual) rowLine.classList.add('pb-overlay__row--readonly');
        if (pendingDelete) rowLine.classList.add('pb-overlay__row--pending-delete');

        const inputsRow = [];

        this.fields.forEach((field, colIndex) => {
          const cell = document.createElement('div');
          cell.className = 'pb-overlay__cell';
          cell.dataset.fieldCode = String(field.code || '');
          const fieldWidth = field.width || DEFAULT_COLUMN_WIDTH;
          cell.style.width = `${fieldWidth}px`;
          cell.style.minWidth = `${fieldWidth}px`;
          const input = this.createInputBase(field);
          this.bindInputToRow(input, field, row, rowIndex, colIndex);
          cell.appendChild(input);
          this.applyCellVisualState(input, row, field.code);
          rowLine.appendChild(cell);
          inputsRow[colIndex] = input;
        });

        tableFrag.appendChild(rowLine);
        this.inputsByRow.set(rowIndex, inputsRow);
      }

      this.rowHeaderContainer.appendChild(headerFrag);
      this.tableContainer.appendChild(tableFrag);
      this.repaintSelection();
      this.restorePendingFocus();
    }

    createInputBase(field) {
      const input = document.createElement('input');
      input.className = 'pb-overlay__input';
      input.spellcheck = false;
      if (field.type === 'NUMBER') input.inputMode = 'decimal';
      if (field.type === 'LINK') input.inputMode = 'url';
      if (field.type === 'DATE') input.type = 'date';
      else input.type = 'text';
      if (this.isChoiceField(field)) {
        input.placeholder = field.choices?.[0] || '';
      }
      if (this.isMultiChoiceField(field)) {
        input.placeholder = resolveText(this.language, 'multiChoiceTitle');
      }
      if (this.isMultiLineField(field)) {
        input.placeholder = resolveText(this.language, 'multilineTitle');
      }
      if (this.isRichTextField(field)) {
        input.placeholder = resolveText(this.language, 'richTextReadonly');
      }
      if (this.isSubtableField(field)) {
        input.placeholder = resolveText(this.language, 'btnSubtableEdit');
      }
      if (this.isFileField(field)) {
        input.placeholder = resolveText(this.language, 'fileDropPlaceholder') || 'Drop files here';
      }
      input.readOnly = true;
      input.addEventListener('input', () => { this.onInputChanged(input); });
      input.addEventListener('change', () => { this.onInputChanged(input); });
      input.addEventListener('compositionstart', this.handleCompositionStart);
      input.addEventListener('compositionend', this.handleCompositionEnd);
      input.addEventListener('paste', (event) => { this.handlePaste(event, input); });
      input.addEventListener('mousedown', (event) => { this.handleCellMouseDown(event, input); });
      input.addEventListener('mouseenter', () => { this.handleCellHover(input); });
      input.addEventListener('blur', (event) => {
        this.handleInputBlur(event, input);
      });
      input.addEventListener('click', (event) => {
        this.handleChoiceInputClick(event, input);
      });
      return input;
    }

    bindInputToRow(input, field, row, rowIndex, colIndex) {
      input.dataset.recordId = row.id;
      input.dataset.fieldCode = field.code;
      input.dataset.rowIndex = String(rowIndex);
      input.dataset.colIndex = String(colIndex);
      input.dataset.originalValue = this.formatCellDisplayValue(field, row.original[field.code]);
      const permission = this.getCellPermissionInfo(row.id, field.code);
      const editable = this.isOverlayEditable() && permission.editable;
      input.dataset.editable = editable ? 'true' : 'false';
      input.disabled = false;
      const editableVisual = this.isOverlayViewOnly() ? true : editable;
      const isPending = Boolean(
        this.pendingEdit
        && this.pendingEdit.rowIndex === rowIndex
        && this.pendingEdit.colIndex === colIndex
      );
      const editing = (this.isEditingCell(rowIndex, colIndex) || isPending) && editable;
      const lookupReadonly = permission.reason === 'lookup_readonly';
      const isDropdown = field?.type === 'DROP_DOWN';
      const isRadio = field?.type === 'RADIO_BUTTON';
      const isMultiChoice = this.isMultiChoiceField(field);
      const isLink = this.isLinkField(field);
      const isMultiLine = this.isMultiLineField(field);
      const isCalc = this.isCalcField(field);
      const isRichText = this.isRichTextField(field);
      const isFile = this.isFileField(field);
      const isLookupKey = field?.type === 'SINGLE_LINE_TEXT' && Boolean(field?.lookup);
      const fieldDeniedByAcl = permission.reason === 'field_readonly';
      this.setInputEditingVisual(input, editing);
      input.classList.toggle('pb-overlay__input--readonly', !editableVisual);
      input.classList.toggle('pb-overlay__input--subtable', this.isSubtableField(field));
      if (lookupReadonly) {
        input.title = resolveText(this.language, 'lookupAutoReadonly');
      } else if (!this.isSubtableField(field) && !editableVisual) {
        input.title = resolveText(this.language, fieldDeniedByAcl ? 'permNoFieldEdit' : 'permNoEdit');
      } else if (!this.isSubtableField(field)) {
        input.removeAttribute('title');
      }
      if (input.parentElement) {
        input.parentElement.classList.toggle('pb-overlay__cell--lookup-auto', lookupReadonly);
        input.parentElement.classList.toggle('pb-overlay__cell--readonly', !editableVisual);
        input.parentElement.classList.toggle('pb-overlay__cell--dropdown', isDropdown);
        input.parentElement.classList.toggle('pb-overlay__cell--radio', isRadio);
        input.parentElement.classList.toggle('pb-overlay__cell--multichoice', isMultiChoice);
        input.parentElement.classList.toggle('pb-overlay__cell--link', isLink);
        input.parentElement.classList.toggle('pb-overlay__cell--multiline', isMultiLine);
        input.parentElement.classList.toggle('pb-overlay__cell--calc', isCalc);
        input.parentElement.classList.toggle('pb-overlay__cell--richtext', isRichText);
        input.parentElement.classList.toggle('pb-overlay__cell--file', isFile);
        input.parentElement.classList.toggle('pb-overlay__cell--file-editable', isFile && editable);
        input.parentElement.classList.toggle('pb-overlay__cell--lookup', isLookupKey);
        if (isFile && editable) {
          this.bindFileDrop(input.parentElement, input, field, row);
        }
      }
    }

    bindFileDrop(cell, input, field, row) {
      if (cell.dataset.fileDropBound === '1') return;
      cell.dataset.fileDropBound = '1';
      let dragCounter = 0;
      cell.addEventListener('dragenter', (ev) => {
        ev.preventDefault();
        dragCounter += 1;
        cell.classList.add('pb-overlay__cell--file-dragover');
      });
      cell.addEventListener('dragleave', () => {
        dragCounter -= 1;
        if (dragCounter <= 0) {
          dragCounter = 0;
          cell.classList.remove('pb-overlay__cell--file-dragover');
        }
      });
      cell.addEventListener('dragover', (ev) => {
        ev.preventDefault();
        ev.dataTransfer.dropEffect = 'copy';
      });
      cell.addEventListener('drop', async (ev) => {
        ev.preventDefault();
        dragCounter = 0;
        cell.classList.remove('pb-overlay__cell--file-dragover');
        const files = Array.from(ev.dataTransfer?.files || []);
        if (!files.length) return;
        const recordId = String(input.dataset.recordId || row.id || '');
        if (!recordId || !this.appId) return;
        cell.classList.add('pb-overlay__cell--file-uploading');
        input.value = resolveText(this.language, 'fileUploading') || 'Uploading…';
        try {
          const res = await this.postFn('EXCEL_UPLOAD_FILE', {
            appId: this.appId,
            recordId,
            fieldCode: field.code,
            files,
            __pbTrigger: 'file_drop'
          });
          if (!res?.ok) throw new Error(res?.error || 'upload_failed');
          const targetRow = this.rowMap?.get(recordId) || row;
          if (targetRow) {
            const uploaded = Array.isArray(res.fileKeys)
              ? res.fileKeys.map((k) => ({ fileKey: k, name: files.find((_, i) => res.fileKeys[i] === k)?.name || k }))
              : [];
            const existing = Array.isArray(targetRow.values?.[field.code]) ? targetRow.values[field.code] : [];
            targetRow.values[field.code] = [...existing, ...uploaded];
            targetRow.original[field.code] = targetRow.values[field.code];
          }
          this.applyCellVisualState(input, targetRow || row, field.code);
        } catch (_err) {
          this.applyCellVisualState(input, row, field.code);
        } finally {
          cell.classList.remove('pb-overlay__cell--file-uploading');
        }
      });
    }

    applyCellVisualState(input, row, fieldCode) {
      const field = this.fieldMap.get(fieldCode);
      const value = row?.values ? row.values[fieldCode] ?? '' : '';
      input.value = this.formatCellDisplayValue(field, value);
      const cell = input.parentElement;
      if (!cell) return;
      const diffEntry = this.diff.get(row.id);
      if (diffEntry && diffEntry[fieldCode]) {
        cell.classList.add('pb-overlay__cell--dirty');
      } else {
        cell.classList.remove('pb-overlay__cell--dirty');
      }
      const key = `${row.id}:${fieldCode}`;
      if (this.invalidCells.has(key)) {
        cell.classList.add('pb-overlay__cell--error');
        if (this.invalidValueCache.has(key)) {
          input.value = this.invalidValueCache.get(key) ?? '';
        }
      } else {
        cell.classList.remove('pb-overlay__cell--error');
        if (cell.dataset.errorReason) {
          delete cell.dataset.errorReason;
        }
      }
      const rowIndex = Number(input.dataset.rowIndex || '-1');
      const colIndex = Number(input.dataset.colIndex || '-1');
      if (this.isCellSelected(rowIndex, colIndex)) {
        cell.classList.add('pb-overlay__cell--selected');
      } else {
        cell.classList.remove('pb-overlay__cell--selected');
      }
      if (this.isCellArmed(rowIndex, colIndex)) {
        cell.classList.add('pb-overlay__cell--armed');
      } else {
        cell.classList.remove('pb-overlay__cell--armed');
      }
      if (this.isCellActive(rowIndex, colIndex)) {
        cell.classList.add('pb-overlay__cell--active');
      } else {
        cell.classList.remove('pb-overlay__cell--active');
      }
      const permission = this.getCellPermissionInfo(row.id, fieldCode);
      const editable = this.isOverlayEditable() && permission.editable;
      const editableVisual = this.isOverlayViewOnly() ? true : editable;
      const isPending = Boolean(
        this.pendingEdit
        && this.pendingEdit.rowIndex === rowIndex
        && this.pendingEdit.colIndex === colIndex
      );
      const editing = (this.isEditingCell(rowIndex, colIndex) || isPending) && editable;
      const lookupReadonly = permission.reason === 'lookup_readonly';
      const isDropdown = field?.type === 'DROP_DOWN';
      const isRadio = field?.type === 'RADIO_BUTTON';
      const isMultiChoice = this.isMultiChoiceField(field);
      const isLink = this.isLinkField(field);
      const isMultiLine = this.isMultiLineField(field);
      const isCalc = this.isCalcField(field);
      const isRichText = this.isRichTextField(field);
      const isFile = this.isFileField(field);
      const isLookupKey = field?.type === 'SINGLE_LINE_TEXT' && Boolean(field?.lookup);
      const fieldDeniedByAcl = permission.reason === 'field_readonly';
      this.setInputEditingVisual(input, editing);
      input.classList.toggle('pb-overlay__input--readonly', !editableVisual);
      input.classList.toggle('pb-overlay__input--subtable', this.isSubtableField(field));
      if (lookupReadonly) {
        input.title = resolveText(this.language, 'lookupAutoReadonly');
      } else if (!this.isSubtableField(field) && !editableVisual) {
        input.title = resolveText(this.language, fieldDeniedByAcl ? 'permNoFieldEdit' : 'permNoEdit');
      } else if (!this.isSubtableField(field)) {
        input.removeAttribute('title');
      }
      cell.classList.toggle('pb-overlay__cell--readonly', !editableVisual);
      cell.classList.toggle('pb-overlay__cell--lookup-auto', lookupReadonly);
      cell.classList.toggle('pb-overlay__cell--dropdown', isDropdown);
      cell.classList.toggle('pb-overlay__cell--radio', isRadio);
      cell.classList.toggle('pb-overlay__cell--multichoice', isMultiChoice);
      cell.classList.toggle('pb-overlay__cell--link', isLink);
      cell.classList.toggle('pb-overlay__cell--multiline', isMultiLine);
      cell.classList.toggle('pb-overlay__cell--calc', isCalc);
      cell.classList.toggle('pb-overlay__cell--richtext', isRichText);
      cell.classList.toggle('pb-overlay__cell--file', isFile);
      cell.classList.toggle('pb-overlay__cell--file-editable', isFile && editable);
      cell.classList.toggle('pb-overlay__cell--lookup', isLookupKey);
      cell.classList.toggle('pb-overlay__cell--editing', editing);
    }

    getInput(rowIndex, colIndex) {
      const rowInputs = this.inputsByRow.get(rowIndex);
      if (!rowInputs) return null;
      return rowInputs[colIndex] || null;
    }

    focusCell(rowIndex, colIndex, options = {}) {
      const ensureVisible = options?.ensureVisible !== false;
      const maxRow = Math.max(0, this.getVisibleRowCount() - 1);
      const maxCol = Math.max(0, this.fields.length - 1);
      if (maxRow < 0 || maxCol < 0) return;
      const r = Math.max(0, Math.min(maxRow, rowIndex));
      const c = Math.max(0, Math.min(maxCol, colIndex));
      if (ensureVisible) {
        this.ensureCellVisible(r, c);
      }
      this.pendingFocus = { rowIndex: r, colIndex: c };
      if (this.isDetailFormLayoutMode()) {
        this.restorePendingFocus();
        return;
      }
      if (r < this.virtualStart || r >= this.virtualEnd) {
        if (this.bodyScroll) {
          this.updateVirtualRows(true);
        }
        return;
      }
      this.restorePendingFocus();
    }

    getColumnWidth(colIndex) {
      const field = this.fields[colIndex];
      return Number(field?.width || DEFAULT_COLUMN_WIDTH);
    }

    getColumnLeft(colIndex) {
      let left = 0;
      for (let i = 0; i < colIndex; i += 1) {
        left += this.getColumnWidth(i);
      }
      return left;
    }

    ensureCellVisible(rowIndex, colIndex) {
      const scroller = this.getGridScrollElement();
      if (!scroller) return;
      const rowTop = rowIndex * this.rowHeight;
      const rowBottom = rowTop + this.rowHeight;
      const viewTop = scroller.scrollTop;
      const viewBottom = viewTop + scroller.clientHeight;
      if (rowTop < viewTop) {
        scroller.scrollTop = rowTop;
      } else if (rowBottom > viewBottom) {
        scroller.scrollTop = rowBottom - scroller.clientHeight;
      }

      const colLeft = this.getColumnLeft(colIndex);
      const colRight = colLeft + this.getColumnWidth(colIndex);
      const viewLeft = scroller.scrollLeft;
      const viewRight = viewLeft + scroller.clientWidth;
      if (colLeft < viewLeft) {
        scroller.scrollLeft = colLeft;
      } else if (colRight > viewRight) {
        scroller.scrollLeft = colRight - scroller.clientWidth;
      }
    }

    getGridScrollElement() {
      if (this.isDetailFormLayoutMode() && this.detailFormContainer) {
        return this.detailFormContainer;
      }
      return this.bodyScroll || null;
    }

    syncSelectionScroll(options = {}) {
      const scroller = this.getGridScrollElement();
      if (!scroller) return;
      const rowIndex = Number(options.rowIndex ?? this.selection?.endRow ?? 0);
      const colIndex = Number(options.colIndex ?? this.selection?.endCol ?? 0);
      const rowHeight = Number(this.rowHeight || 32);
      const verticalMargin = Number.isFinite(options.verticalMargin) ? Number(options.verticalMargin) : rowHeight;
      const horizontalMargin = Number.isFinite(options.horizontalMargin) ? Number(options.horizontalMargin) : 24;

      const rowTop = rowIndex * rowHeight;
      const rowBottom = rowTop + rowHeight;
      const viewTop = scroller.scrollTop;
      const viewBottom = viewTop + scroller.clientHeight;

      let nextScrollTop = viewTop;
      if (rowTop < viewTop + verticalMargin) {
        nextScrollTop = Math.max(0, rowTop - verticalMargin);
      } else if (rowBottom > viewBottom - verticalMargin) {
        nextScrollTop = Math.max(0, rowBottom - scroller.clientHeight + verticalMargin);
      }

      const colLeft = this.getColumnLeft(colIndex);
      const colWidth = this.getColumnWidth(colIndex);
      const colRight = colLeft + colWidth;
      const viewLeft = scroller.scrollLeft;
      const viewRight = viewLeft + scroller.clientWidth;

      let nextScrollLeft = viewLeft;
      if (colLeft < viewLeft + horizontalMargin) {
        nextScrollLeft = Math.max(0, colLeft - horizontalMargin);
      } else if (colRight > viewRight - horizontalMargin) {
        nextScrollLeft = Math.max(0, colRight - scroller.clientWidth + horizontalMargin);
      }

      let changed = false;
      if (nextScrollTop !== scroller.scrollTop) {
        scroller.scrollTop = nextScrollTop;
        changed = true;
      }
      if (nextScrollLeft !== scroller.scrollLeft) {
        scroller.scrollLeft = nextScrollLeft;
        changed = true;
      }
      if (changed) {
        this.syncScroll();
      }
    }

    restorePendingFocus() {
      if (!this.pendingFocus) return;
      const { rowIndex, colIndex } = this.pendingFocus;
      const input = this.getInput(rowIndex, colIndex);
      if (!input) return;
      this.pendingFocus = null;
      requestAnimationFrame(() => {
        input.focus();
        const shouldForceEdit = Boolean(
          this.pendingEdit
          && this.pendingEdit.rowIndex === rowIndex
          && this.pendingEdit.colIndex === colIndex
        );
        if (shouldForceEdit) {
          this.forceApplyEditState(input, rowIndex, colIndex);
          this.pendingEdit = null;
        }
        const editing = this.isEditingCell(rowIndex, colIndex);
        const rowInputs = this.inputsByRow.get(rowIndex) || [];
        rowInputs.forEach((candidate) => {
          if (candidate && candidate !== input && candidate.classList?.contains('pb-overlay__input--editing')) {
            this.setInputEditingVisual(candidate, false);
          }
        });
        this.setInputEditingVisual(input, editing);
        const shouldSelectAll = editing && this.editingCell && this.editingCell.selectAll;
        this.applyCaretPlacement(input, shouldSelectAll);
      });
    }

    setInputEditingVisual(input, isEditing) {
      if (!input) return;
      const editable = input.dataset?.editable !== 'false';
      const nextEditing = Boolean(isEditing) && editable && !input.disabled;
      input.readOnly = !nextEditing;
      input.classList.toggle('pb-overlay__input--editing', nextEditing);
      if (input.parentElement) {
        input.parentElement.classList.toggle('pb-overlay__cell--editing', nextEditing);
      }
    }

    forceApplyEditState(input, rowIndex, colIndex) {
      const isSame = this.editingCell
        && this.editingCell.rowIndex === rowIndex
        && this.editingCell.colIndex === colIndex;
      this.editingCell = isSame
        ? { ...this.editingCell, selectAll: false }
        : this.createEditingState(rowIndex, colIndex, false);
      this.setInputEditingVisual(input, true);
      const cell = input.parentElement;
      if (cell) cell.classList.add('pb-overlay__cell--selected');
    }

    canSelectTextInput(input) {
      if (!input) return false;
      const type = (input.type || '').toLowerCase();
      return type === 'text' || type === 'search' || type === 'tel' || type === 'url' || type === 'email' || type === 'password';
    }

    handleInputBlur(event, input) {
      if (this.navigating) return;
      if (!this.editingCell) return;
      if (this.radioPicker && this.radioPicker.input === input) {
        const next = event.relatedTarget;
        if (next && this.radioPicker.panel?.contains(next)) {
          return;
        }
      }
      this.exitEditMode();
      if (this.needsFilterReapply && this.hasActiveFilters()) {
        this.needsFilterReapply = false;
        this.applyFilters();
      }
    }

    applyCaretPlacement(input, selectAll) {
      if (!this.canSelectTextInput(input)) return;
      try {
        if (selectAll) {
          input.select();
        } else {
          const len = input.value.length;
          input.setSelectionRange(len, len);
        }
      } catch (_e) {
        // Some browsers throw for inputs that disallow selection even if type reports text.
      }
    }

    openRadioPicker(rowIndex, colIndex, input) {
      if (!this.root || !input) return;
      const field = this.fields[colIndex];
      if (!field || !this.isChoiceField(field)) return;
      const rawChoices = Array.isArray(field.choices) ? field.choices : [];
      const choices = Array.from(new Set(rawChoices.map((choice) => String(choice || '')).filter((choice) => choice)));
      if (!choices.length) return;

      this.closeRadioPicker();
      const panel = document.createElement('div');
      panel.className = 'pb-overlay__choice-panel';
      panel.setAttribute('role', 'listbox');
      panel.setAttribute('aria-label', field.label || field.code || 'choices');
      const list = document.createElement('div');
      list.className = 'pb-overlay__choice-list';
      const currentValue = input.value || '';
      choices.forEach((choice) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'pb-overlay__choice-item';
        button.dataset.value = choice;
        button.textContent = choice;
        button.setAttribute('role', 'option');
        if (choice === currentValue) {
          button.classList.add('is-selected');
          button.setAttribute('aria-selected', 'true');
        } else {
          button.setAttribute('aria-selected', 'false');
        }
        button.addEventListener('click', () => {
          this.handleRadioChoiceSelect(choice, rowIndex, colIndex);
        });
        list.appendChild(button);
      });
      panel.style.visibility = 'hidden';
      panel.style.left = '0px';
      panel.style.top = '0px';
      panel.appendChild(list);
      this.root.appendChild(panel);
      this.positionRadioPicker(panel, input);
      panel.style.visibility = 'visible';
      const focusTarget = panel.querySelector('.pb-overlay__choice-item.is-selected') || panel.querySelector('.pb-overlay__choice-item');
      if (focusTarget) {
        requestAnimationFrame(() => {
          try {
            focusTarget.focus();
          } catch (_e) { /* noop */ }
        });
      }
      this.radioPicker = { panel, input, rowIndex, colIndex };
      if (this.bodyScroll) {
        this.bodyScroll.addEventListener('scroll', this.boundRadioPickerScrollHandler, { passive: true });
      }
      window.addEventListener('resize', this.boundRadioPickerResizeHandler);
      document.addEventListener('mousedown', this.boundRadioPickerOutsideClick, true);
    }

    positionRadioPicker(panel, anchor) {
      if (!this.root) return;
      const rootRect = this.root.getBoundingClientRect();
      const anchorRect = anchor.getBoundingClientRect();
      const margin = 12;
      const anchorWidth = anchorRect.width || panel.getBoundingClientRect().width;
      panel.style.minWidth = `${Math.max(180, anchorWidth)}px`;
      const panelRect = panel.getBoundingClientRect();
      const maxLeft = Math.max(margin, rootRect.width - panelRect.width - margin);
      let left = anchorRect.left - rootRect.left;
      left = Math.max(margin, Math.min(left, maxLeft));
      let top = anchorRect.bottom - rootRect.top + 6;
      const maxTop = Math.max(margin, rootRect.height - panelRect.height - margin);
      if (top > maxTop) {
        top = anchorRect.top - rootRect.top - panelRect.height - 6;
      }
      if (top < margin) top = margin;
      panel.style.left = `${left}px`;
      panel.style.top = `${top}px`;
    }

    closeRadioPicker(focusInput = false) {
      if (!this.radioPicker) return;
      const { panel, input } = this.radioPicker;
      if (panel?.parentElement) {
        panel.remove();
      }
      this.radioPicker = null;
      if (this.bodyScroll) {
        this.bodyScroll.removeEventListener('scroll', this.boundRadioPickerScrollHandler);
      }
      window.removeEventListener('resize', this.boundRadioPickerResizeHandler);
      document.removeEventListener('mousedown', this.boundRadioPickerOutsideClick, true);
      if (focusInput && input) {
        try {
          input.focus();
        } catch (_e) { /* noop */ }
      }
    }

    openMultiChoicePickerForValues(field, input, currentValues, onApply) {
      if (!this.root || !input || !field || !this.isMultiChoiceField(field)) return;
      const choices = Array.from(new Set((Array.isArray(field.choices) ? field.choices : [])
        .map((choice) => String(choice || '').trim())
        .filter(Boolean)));
      if (!choices.length) return;

      this.closeMultiChoicePicker();
      const draftValues = new Set(this.normalizeMultiValue(currentValues, field));

      const panel = document.createElement('div');
      panel.className = 'pb-overlay__choice-panel pb-overlay__choice-panel--multi';
      panel.setAttribute('role', 'dialog');
      panel.setAttribute('aria-label', field.label || field.code || resolveText(this.language, 'multiChoiceTitle'));

      const title = document.createElement('div');
      title.className = 'pb-overlay__choice-panel-title';
      title.textContent = field.label || resolveText(this.language, 'multiChoiceTitle');
      panel.appendChild(title);

      const list = document.createElement('div');
      list.className = 'pb-overlay__choice-list';
      choices.forEach((choice) => {
        const label = document.createElement('label');
        label.className = 'pb-overlay__choice-check';
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.value = choice;
        checkbox.checked = draftValues.has(choice);
        checkbox.addEventListener('change', () => {
          if (checkbox.checked) draftValues.add(choice);
          else draftValues.delete(choice);
        });
        const text = document.createElement('span');
        text.textContent = choice;
        label.appendChild(checkbox);
        label.appendChild(text);
        list.appendChild(label);
      });
      panel.appendChild(list);

      const actions = document.createElement('div');
      actions.className = 'pb-overlay__choice-actions';
      const clearBtn = document.createElement('button');
      clearBtn.type = 'button';
      clearBtn.className = 'pb-overlay__btn';
      clearBtn.textContent = resolveText(this.language, 'multiChoiceClear');
      clearBtn.addEventListener('click', () => {
        draftValues.clear();
        panel.querySelectorAll('input[type="checkbox"]').forEach((el) => {
          if (el instanceof HTMLInputElement) el.checked = false;
        });
      });
      const cancelBtn = document.createElement('button');
      cancelBtn.type = 'button';
      cancelBtn.className = 'pb-overlay__btn';
      cancelBtn.textContent = resolveText(this.language, 'subtableCancel');
      cancelBtn.addEventListener('click', () => this.closeMultiChoicePicker(true));
      const applyBtn = document.createElement('button');
      applyBtn.type = 'button';
      applyBtn.className = 'pb-overlay__btn pb-overlay__btn--primary';
      applyBtn.textContent = resolveText(this.language, 'multiChoiceApply');
      applyBtn.addEventListener('click', () => {
        const nextValues = choices.filter((choice) => draftValues.has(choice));
        this.closeMultiChoicePicker(true);
        if (typeof onApply === 'function') onApply(nextValues);
      });
      actions.appendChild(clearBtn);
      actions.appendChild(cancelBtn);
      actions.appendChild(applyBtn);
      panel.appendChild(actions);

      panel.style.visibility = 'hidden';
      panel.style.left = '0px';
      panel.style.top = '0px';
      this.root.appendChild(panel);
      this.positionRadioPicker(panel, input);
      panel.style.visibility = 'visible';

      const focusTarget = panel.querySelector('input[type="checkbox"]');
      if (focusTarget instanceof HTMLElement) {
        requestAnimationFrame(() => {
          try {
            focusTarget.focus();
          } catch (_e) { /* noop */ }
        });
      }
      this.multiChoicePicker = { panel, input };
      if (this.bodyScroll) {
        this.bodyScroll.addEventListener('scroll', this.boundMultiChoicePickerScrollHandler, { passive: true });
      }
      window.addEventListener('resize', this.boundMultiChoicePickerResizeHandler);
      document.addEventListener('mousedown', this.boundMultiChoicePickerOutsideClick, true);
    }

    openMultiChoicePicker(rowIndex, colIndex, input) {
      if (!this.root || !input) return;
      const field = this.fields[colIndex];
      const row = this.getVisibleRowAt(rowIndex);
      if (!field || !row || !this.isMultiChoiceField(field)) return;
      this.openMultiChoicePickerForValues(field, input, row.values[field.code], (nextValues) => {
        this.applyEditorValueChange(String(row.id || ''), field, nextValues, {
          historyType: 'cell-edit',
          pushHistory: true,
          applyFilters: true
        });
      });
    }

    repositionMultiChoicePicker() {
      if (!this.multiChoicePicker?.panel || !this.multiChoicePicker.input) return;
      if (!this.root || !this.root.contains(this.multiChoicePicker.input)) {
        this.closeMultiChoicePicker();
        return;
      }
      this.positionRadioPicker(this.multiChoicePicker.panel, this.multiChoicePicker.input);
    }

    closeMultiChoicePicker(focusInput = false) {
      if (!this.multiChoicePicker) return;
      const { panel, input } = this.multiChoicePicker;
      if (panel?.parentElement) {
        panel.remove();
      }
      this.multiChoicePicker = null;
      if (this.bodyScroll) {
        this.bodyScroll.removeEventListener('scroll', this.boundMultiChoicePickerScrollHandler);
      }
      window.removeEventListener('resize', this.boundMultiChoicePickerResizeHandler);
      document.removeEventListener('mousedown', this.boundMultiChoicePickerOutsideClick, true);
      if (focusInput && input) {
        try {
          input.focus();
        } catch (_e) { /* noop */ }
      }
    }

    openFieldValueModal(field, options = {}) {
      if (!this.root || !field) return;
      const titleText = String(options.title || field.label || field.code || '');
      const readOnly = options.readOnly !== false;
      const viewerMode = Boolean(options.viewerMode);
      const value = options.value;
      this.closeMultilineEditor();
      this.closeRadioPicker();
      this.closeMultiChoicePicker();
      this.exitEditMode();

      const layer = document.createElement('div');
      layer.className = 'pb-overlay__multiline-layer';
      const panel = document.createElement('div');
      panel.className = 'pb-overlay__multiline-panel';
      panel.addEventListener('click', (event) => event.stopPropagation());

      const head = document.createElement('div');
      head.className = 'pb-overlay__multiline-head';
      const title = document.createElement('div');
      title.className = 'pb-overlay__multiline-title';
      title.textContent = titleText;
      const closeBtn = document.createElement('button');
      closeBtn.type = 'button';
      closeBtn.className = 'pb-overlay__multiline-close';
      closeBtn.textContent = '×';
      closeBtn.title = resolveText(this.language, 'multilineCancel');
      closeBtn.setAttribute('aria-label', resolveText(this.language, 'multilineCancel'));
      closeBtn.addEventListener('click', () => this.closeMultilineEditor(true));
      head.appendChild(title);
      head.appendChild(closeBtn);

      const body = document.createElement('div');
      body.className = 'pb-overlay__multiline-body';
      let textarea = null;
      if (viewerMode) {
        const viewer = document.createElement('div');
        viewer.className = 'pb-overlay__multiline-viewer';
        viewer.textContent = this.buildFieldValueModalText(field, value);
        body.appendChild(viewer);
      } else {
        textarea = document.createElement('textarea');
        textarea.className = 'pb-overlay__multiline-input';
        textarea.value = String(value ?? '');
        textarea.readOnly = readOnly;
        body.appendChild(textarea);
      }

      const footer = document.createElement('div');
      footer.className = 'pb-overlay__multiline-foot';
      const cancelBtn = document.createElement('button');
      cancelBtn.type = 'button';
      cancelBtn.className = 'pb-overlay__btn';
      cancelBtn.textContent = resolveText(this.language, 'multilineCancel');
      cancelBtn.addEventListener('click', () => this.closeMultilineEditor(true));
      const saveBtn = document.createElement('button');
      saveBtn.type = 'button';
      saveBtn.className = 'pb-overlay__btn pb-overlay__btn--primary';
      saveBtn.textContent = resolveText(this.language, 'multilineSave');
      saveBtn.disabled = readOnly || viewerMode;
      saveBtn.addEventListener('click', () => {
        if (readOnly || viewerMode || !textarea) return;
        if (typeof options.onSave === 'function') {
          options.onSave(textarea.value ?? '');
        }
        this.closeMultilineEditor(true);
      });
      footer.appendChild(cancelBtn);
      if (!viewerMode || !readOnly) {
        footer.appendChild(saveBtn);
      }

      layer.addEventListener('click', () => this.closeMultilineEditor(true));
      panel.appendChild(head);
      panel.appendChild(body);
      panel.appendChild(footer);
      layer.appendChild(panel);
      this.root.appendChild(layer);
      this.multilineEditor = {
        layer,
        panel,
        textarea,
        readOnly,
        anchorInput: options.anchorInput || null
      };
      requestAnimationFrame(() => {
        try {
          if (textarea) {
            textarea.focus();
          } else {
            closeBtn.focus();
          }
          if (textarea && !readOnly) {
            textarea.setSelectionRange(textarea.value.length, textarea.value.length);
          }
        } catch (_e) { /* noop */ }
      });
    }

    openMultilineEditor(rowIndex, colIndex, anchorInput = null) {
      if (!this.root) return;
      const row = this.getVisibleRowAt(rowIndex);
      const field = this.fields[colIndex];
      if (!row || !field || !this.isMultiLineField(field)) return;
      const recordId = String(row.id || '').trim();
      if (!recordId) return;
      const viewOnlyMode = this.isOverlayViewOnly();
      const editable = this.isOverlayEditable() && this.permissionService.canEditCell(recordId, field.code);
      if (!editable && !viewOnlyMode) {
        this.notifyViewOnlyBlocked();
        return;
      }
      this.openFieldValueModal(field, {
        title: `${resolveText(this.language, 'multilineTitle')}: ${field.label || field.code}`,
        value: row.values[field.code] ?? '',
        readOnly: !editable,
        viewerMode: false,
        anchorInput: anchorInput || this.getInput(rowIndex, colIndex),
        onSave: (nextValue) => {
          this.applyEditorValueChange(recordId, field, nextValue, {
            historyType: 'cell-edit',
            pushHistory: true,
            applyFilters: true
          });
        }
      });
    }

    openRichTextViewer(rowIndex, colIndex, anchorInput = null) {
      if (!this.root) return;
      const row = this.getVisibleRowAt(rowIndex);
      const field = this.fields[colIndex];
      if (!row || !field || !this.isRichTextField(field)) return;
      this.openFieldValueModal(field, {
        title: field.label || field.code,
        value: row.values[field.code] ?? '',
        readOnly: true,
        viewerMode: true,
        anchorInput: anchorInput || this.getInput(rowIndex, colIndex)
      });
    }

    closeMultilineEditor(focusInput = false) {
      if (!this.multilineEditor) return;
      const { layer, anchorInput } = this.multilineEditor;
      if (layer?.parentElement) {
        layer.remove();
      }
      this.multilineEditor = null;
      if (focusInput && anchorInput) {
        try {
          anchorInput.focus();
        } catch (_e) { /* noop */ }
      }
    }

    moveRadioPickerFocus(delta, currentTarget) {
      if (!this.radioPicker?.panel) return;
      const buttons = Array.from(this.radioPicker.panel.querySelectorAll('.pb-overlay__choice-item'));
      if (!buttons.length) return;
      let index = -1;
      if (currentTarget instanceof HTMLButtonElement) {
        index = buttons.indexOf(currentTarget);
      }
      if (index === -1) {
        const active = document.activeElement;
        if (active instanceof HTMLButtonElement) {
          index = buttons.indexOf(active);
        }
      }
      if (index === -1) index = 0;
      let nextIndex = index + delta;
      if (nextIndex < 0) nextIndex = buttons.length - 1;
      if (nextIndex >= buttons.length) nextIndex = 0;
      buttons[nextIndex].focus();
    }

    repositionRadioPicker() {
      if (!this.radioPicker?.panel || !this.radioPicker.input) return;
      if (!this.root || !this.root.contains(this.radioPicker.input)) {
        this.closeRadioPicker();
        return;
      }
      this.positionRadioPicker(this.radioPicker.panel, this.radioPicker.input);
    }

    handleRadioChoiceSelect(value, rowIndex, colIndex) {
      const input = this.getInput(rowIndex, colIndex);
      if (!input) {
        this.closeRadioPicker();
        return;
      }
      input.value = value;
      this.onInputChanged(input);
      this.closeRadioPicker(true);
    }

    createSubtableDefaultValue(type) {
      const normalized = String(type || '').toUpperCase();
      if (
        normalized === 'CHECK_BOX'
        || normalized === 'MULTI_SELECT'
        || normalized === 'USER_SELECT'
        || normalized === 'ORGANIZATION_SELECT'
        || normalized === 'GROUP_SELECT'
      ) return [];
      return '';
    }

    async openSubtableEditor(rowIndex, colIndex, anchorInput = null) {
      if (this.saving) return;
      if (!this.root) return;
      const row = this.getVisibleRowAt(rowIndex);
      const field = this.fields[colIndex];
      if (!row || !field || !this.isSubtableField(field)) return;
      const readOnlyMode = !this.isOverlayEditable() || !this.permissionService.canEditRecord(row.id);
      this.closeSubtableEditor(false);
      this.exitEditMode();

      let childFields = await this.getSubtableEditorChildFields(field);
      const sourceRows = Array.isArray(row.values[field.code]) ? row.values[field.code] : [];
      const editorRows = sourceRows.map((item, idx) => ({
        localId: `row:${idx}:${Date.now()}`,
        id: item?.id ? String(item.id) : '',
        value: item && typeof item.value === 'object' ? JSON.parse(JSON.stringify(item.value)) : {}
      }));
      let currentColumnWidths = await this.getInitialSubtableColumnWidths(field.code, childFields, editorRows);

      const layer = document.createElement('div');
      layer.className = 'pb-overlay__subtable-layer';
      const panel = document.createElement('div');
      panel.className = 'pb-overlay__subtable-panel';
      panel.addEventListener('click', (event) => event.stopPropagation());

      const head = document.createElement('div');
      head.className = 'pb-overlay__subtable-head';
      const title = document.createElement('div');
      title.className = 'pb-overlay__subtable-title';
      title.textContent = `${resolveText(this.language, 'subtableTitle')}: ${field.label || field.code}`;
      const closeBtn = document.createElement('button');
      closeBtn.type = 'button';
      closeBtn.className = 'pb-overlay__subtable-close';
      closeBtn.textContent = '×';
      closeBtn.title = resolveText(this.language, 'subtableClose');
      closeBtn.setAttribute('aria-label', resolveText(this.language, 'subtableClose'));
      closeBtn.addEventListener('click', () => this.closeSubtableEditor(true));
      head.appendChild(title);
      head.appendChild(closeBtn);

      const body = document.createElement('div');
      body.className = 'pb-overlay__subtable-body';

      const tableWrap = document.createElement('div');
      tableWrap.className = 'pb-subtable-wrap';
      const table = document.createElement('table');
      table.className = 'pb-subtable';
      const colgroup = document.createElement('colgroup');
      table.appendChild(colgroup);
      const thead = document.createElement('thead');
      const theadRow = document.createElement('tr');
      thead.appendChild(theadRow);
      const tbody = document.createElement('tbody');
      tbody.className = 'pb-subtable__body';
      table.appendChild(thead);
      table.appendChild(tbody);
      tableWrap.appendChild(table);

      const footer = document.createElement('div');
      footer.className = 'pb-overlay__subtable-foot';
      const footerLeft = document.createElement('div');
      footerLeft.className = 'pb-overlay__subtable-foot-group pb-overlay__subtable-foot-group--left';
      const footerRight = document.createElement('div');
      footerRight.className = 'pb-overlay__subtable-foot-group pb-overlay__subtable-foot-group--right';
      const addBtn = document.createElement('button');
      addBtn.type = 'button';
      addBtn.className = 'pb-overlay__btn';
      addBtn.dataset.subtableAction = 'add';
      addBtn.textContent = resolveText(this.language, 'subtableAddRow');
      const autoBtn = document.createElement('button');
      autoBtn.type = 'button';
      autoBtn.className = 'pb-overlay__btn';
      autoBtn.dataset.subtableAction = 'autowidth';
      autoBtn.textContent = resolveText(this.language, 'subtableAutoWidth');
      const reloadBtn = document.createElement('button');
      reloadBtn.type = 'button';
      reloadBtn.className = 'pb-overlay__btn';
      reloadBtn.dataset.subtableAction = 'reload-layout';
      reloadBtn.textContent = resolveText(this.language, 'subtableReloadLayout');
      const cancelBtn = document.createElement('button');
      cancelBtn.type = 'button';
      cancelBtn.className = 'pb-overlay__btn';
      cancelBtn.dataset.subtableAction = 'cancel';
      cancelBtn.textContent = resolveText(this.language, 'subtableCancel');
      const saveBtn = document.createElement('button');
      saveBtn.type = 'button';
      saveBtn.className = 'pb-overlay__btn pb-overlay__btn--primary';
      saveBtn.dataset.subtableAction = 'save';
      saveBtn.textContent = resolveText(this.language, 'subtableSave');
      footerLeft.appendChild(autoBtn);
      footerLeft.appendChild(reloadBtn);
      footerRight.appendChild(addBtn);
      footerRight.appendChild(cancelBtn);
      footerRight.appendChild(saveBtn);
      footer.appendChild(footerLeft);
      footer.appendChild(footerRight);

      const setSubtableCellValue = (item, child, nextValue) => {
        if (!item.value || typeof item.value !== 'object') item.value = {};
        item.value[child.code] = { value: this.deepClone(nextValue) };
      };

      const getChildPermission = (child) => {
        const permission = this.getFieldPermissionInfo(String(row.id || ''), child, { localOnly: true });
        return {
          editable: Boolean(permission.editable) && !readOnlyMode,
          reason: readOnlyMode ? 'record_readonly' : permission.reason
        };
      };

      const renderSubtableColumns = () => {
        colgroup.textContent = '';
        theadRow.textContent = '';
        childFields.forEach((child) => {
          const col = document.createElement('col');
          col.dataset.fieldCode = String(child.code || '');
          colgroup.appendChild(col);

          const th = document.createElement('th');
          th.className = 'pb-subtable__head';
          th.textContent = child.label || child.code;
          theadRow.appendChild(th);
        });
        const opCol = document.createElement('col');
        opCol.className = 'pb-subtable__col-op';
        opCol.style.width = '44px';
        colgroup.appendChild(opCol);
        const opTh = document.createElement('th');
        opTh.className = 'pb-subtable__head pb-subtable__op';
        opTh.setAttribute('aria-label', resolveText(this.language, 'subtableActionsAria'));
        theadRow.appendChild(opTh);
      };

      const applySubtableWidthStyles = () => {
        childFields.forEach((child, index) => {
          const code = String(child.code || '').trim();
          if (!code) return;
          const width = this.normalizeSubtableColumnWidth(currentColumnWidths?.[code], child.type);
          currentColumnWidths[code] = width;
          const col = colgroup.children[index];
          if (col) {
            col.style.width = `${width}px`;
            col.style.minWidth = `${width}px`;
          }
          const headCell = theadRow.children[index];
          if (headCell instanceof HTMLElement) {
            headCell.style.width = `${width}px`;
            headCell.style.minWidth = `${width}px`;
          }
        });
      };

      const renderRows = () => {
        tbody.textContent = '';
        if (!editorRows.length) {
          const emptyRow = document.createElement('tr');
          emptyRow.className = 'pb-subtable__empty-row';
          const emptyCell = document.createElement('td');
          emptyCell.className = 'pb-subtable__empty';
          emptyCell.colSpan = Math.max(1, childFields.length + 1);
          emptyCell.textContent = resolveText(this.language, 'subtableEmpty');
          emptyRow.appendChild(emptyCell);
          tbody.appendChild(emptyRow);
          return;
        }
        editorRows.forEach((item) => {
          const rowEl = document.createElement('tr');
          rowEl.className = 'pb-subtable__row';

          childFields.forEach((child) => {
            const cell = document.createElement('td');
            cell.className = 'pb-subtable__cell';
            const width = this.normalizeSubtableColumnWidth(currentColumnWidths?.[child.code], child.type);
            cell.style.width = `${width}px`;
            cell.style.minWidth = `${width}px`;
            const rawCell = item.value?.[child.code]?.value;
            const displayValue = this.formatSubtableCellDisplayValue(child, rawCell);
            const permission = getChildPermission(child);
            const interaction = this.resolveFieldInteraction(child, permission, { viewOnly: true });
            if (interaction === 'inline-choice-single') {
              const select = document.createElement('select');
              select.className = 'pb-overlay__subtable-input';
              const empty = document.createElement('option');
              empty.value = '';
              empty.textContent = '';
              select.appendChild(empty);
              (Array.isArray(child.choices) ? child.choices : []).forEach((choice) => {
                const option = document.createElement('option');
                option.value = String(choice || '');
                option.textContent = String(choice || '');
                option.selected = String(rawCell ?? '') === option.value;
                select.appendChild(option);
              });
              select.disabled = !permission.editable;
              select.addEventListener('change', () => {
                setSubtableCellValue(item, child, select.value);
              });
              cell.appendChild(select);
            } else if (interaction === 'inline-choice-multi') {
              const trigger = document.createElement('button');
              trigger.type = 'button';
              trigger.className = 'pb-overlay__subtable-choice-trigger';
              trigger.textContent = displayValue || ' ';
              trigger.disabled = !permission.editable;
              trigger.addEventListener('click', () => {
                if (!permission.editable) return;
                this.openMultiChoicePickerForValues(child, trigger, rawCell, (nextValues) => {
                  setSubtableCellValue(item, child, nextValues);
                  renderRows();
                });
              });
              cell.appendChild(trigger);
            } else {
              const input = document.createElement('input');
              input.className = 'pb-overlay__subtable-input';
              input.type = String(child.type || '').toUpperCase() === 'DATE' ? 'date' : 'text';
              if (String(child.type || '').toUpperCase() === 'NUMBER') input.inputMode = 'decimal';
              input.style.width = `${Math.max(80, width - 16)}px`;
              if (interaction === 'inline-edit') {
                input.value = rawCell === undefined || rawCell === null ? '' : String(rawCell);
                input.disabled = !permission.editable;
                input.readOnly = !permission.editable;
                input.addEventListener('input', () => {
                  if (!permission.editable) return;
                  setSubtableCellValue(item, child, input.value);
                });
              } else {
                input.value = displayValue;
                input.readOnly = true;
                input.disabled = false;
                input.classList.add('pb-overlay__subtable-input--readonly');
                if (interaction === 'modal-edit' || interaction === 'modal-view') {
                  input.classList.add('pb-overlay__subtable-input--modal');
                  input.addEventListener('click', () => {
                    const editableModal = interaction === 'modal-edit';
                    this.openFieldValueModal(child, {
                      title: editableModal
                        ? `${resolveText(this.language, 'multilineTitle')}: ${child.label || child.code}`
                        : (child.label || child.code),
                      value: rawCell ?? '',
                      readOnly: !editableModal,
                      viewerMode: this.isRichTextField(child),
                      anchorInput: input,
                      onSave: (nextValue) => {
                        setSubtableCellValue(item, child, nextValue);
                        renderRows();
                      }
                    });
                  });
                }
                if (child.lookup || child.lookupAuto || String(child.type || '').toUpperCase() === 'LOOKUP') {
                  input.title = resolveText(this.language, 'lookupAutoReadonly');
                }
              }
              cell.appendChild(input);
            }
            rowEl.appendChild(cell);
          });

          const opCell = document.createElement('td');
          opCell.className = 'pb-subtable__cell pb-subtable__op';
          const removeBtn = document.createElement('button');
          removeBtn.type = 'button';
          removeBtn.className = 'pb-overlay__btn pb-subtable__remove';
          removeBtn.textContent = '×';
          removeBtn.title = resolveText(this.language, 'subtableRemoveRow');
          removeBtn.setAttribute('aria-label', resolveText(this.language, 'subtableRemoveRow'));
          removeBtn.disabled = readOnlyMode;
          removeBtn.addEventListener('click', () => {
            if (readOnlyMode) return;
            const idx = editorRows.indexOf(item);
            if (idx >= 0) {
              editorRows.splice(idx, 1);
              renderRows();
            }
          });
          opCell.appendChild(removeBtn);
          rowEl.appendChild(opCell);
          tbody.appendChild(rowEl);
        });
      };

      addBtn.addEventListener('click', () => {
        if (readOnlyMode) return;
        const value = {};
        childFields.forEach((child) => {
          value[child.code] = { value: this.createSubtableDefaultValue(child.type) };
        });
        editorRows.push({
          localId: `row:new:${Date.now()}:${Math.random().toString(16).slice(2)}`,
          id: '',
          value
        });
        renderRows();
      });

      autoBtn.addEventListener('click', () => {
        currentColumnWidths = this.computeSubtableAutoWidths(childFields, editorRows);
        applySubtableWidthStyles();
        renderRows();
        void this.persistSubtableColumnWidths(field.code, currentColumnWidths);
      });

      reloadBtn.addEventListener('click', async () => {
        if (reloadBtn.disabled) return;
        reloadBtn.disabled = true;
        try {
          await this.refreshSubtableLayoutFieldOrder(field.code);
          childFields = await this.getSubtableEditorChildFields(field);
          currentColumnWidths = await this.getInitialSubtableColumnWidths(field.code, childFields, editorRows);
          renderSubtableColumns();
          applySubtableWidthStyles();
          renderRows();
          this.notify(resolveText(this.language, 'toastSubtableLayoutReloaded'));
        } catch (_error) {
          this.notify(resolveText(this.language, 'toastSubtableLayoutReloadFailed'));
        } finally {
          reloadBtn.disabled = false;
        }
      });

      cancelBtn.addEventListener('click', () => this.closeSubtableEditor(true));
      saveBtn.addEventListener('click', () => {
        if (readOnlyMode) {
          this.notifyViewOnlyBlocked();
          return;
        }
        const beforeValueSnapshot = this.deepClone(row.values[field.code]);
        for (const item of editorRows) {
          for (const child of childFields) {
            const raw = item?.value?.[child.code]?.value;
            const interaction = this.resolveFieldInteraction(child, getChildPermission(child), { viewOnly: true });
            if (interaction === 'inline-edit' || interaction === 'inline-choice-single' || interaction === 'inline-choice-multi' || interaction === 'modal-edit') {
              const validation = this.validate(raw ?? '', child);
              if (!validation.ok) {
                this.notify(resolveText(this.language, 'toastInvalidCells'));
                return;
              }
              setSubtableCellValue(item, child, validation.value);
            }
          }
        }
        const nextValue = editorRows.map((item) => {
          const out = { value: item.value && typeof item.value === 'object' ? JSON.parse(JSON.stringify(item.value)) : {} };
          if (item.id) out.id = item.id;
          return out;
        });
        const currentRow = this.rowMap.get(row.id);
        if (!currentRow) {
          this.closeSubtableEditor(true);
          return;
        }
        currentRow.values[field.code] = nextValue;
        const originalValue = currentRow.original[field.code];
        const changed = JSON.stringify(nextValue) !== JSON.stringify(originalValue);
        if (changed) {
          this.addDiff(currentRow.id, field.code, nextValue, 'SUBTABLE');
          this.pushHistory({
            type: 'subtable-edit',
            payload: {
              recordId: currentRow.id,
              fieldCode: field.code,
              before: beforeValueSnapshot,
              after: this.deepClone(nextValue)
            }
          });
        } else {
          this.removeDiff(currentRow.id, field.code);
        }
        const input = this.findInput(currentRow.id, field.code);
        if (input) {
          this.applyCellVisualState(input, currentRow, field.code);
        }
        this.updateDirtyBadge();
        this.updateStats();
        void this.persistSubtableColumnWidths(field.code, currentColumnWidths);
        this.closeSubtableEditor(true);
      });
      addBtn.disabled = readOnlyMode;
      autoBtn.disabled = false;
      reloadBtn.disabled = false;
      saveBtn.disabled = readOnlyMode;

      layer.addEventListener('click', () => this.closeSubtableEditor(true));
      layer.appendChild(panel);
      body.appendChild(tableWrap);
      panel.appendChild(head);
      panel.appendChild(body);
      panel.appendChild(footer);
      this.root.appendChild(layer);
      renderSubtableColumns();
      applySubtableWidthStyles();
      renderRows();
      this.subtableEditor = {
        layer,
        panel,
        rowIndex,
        colIndex,
        anchorInput: anchorInput || this.getInput(rowIndex, colIndex),
        subtableFieldCode: String(field.code || ''),
        getCurrentWidths: () => ({ ...currentColumnWidths })
      };
    }

    closeSubtableEditor(focusInput = false) {
      if (!this.subtableEditor) return;
      const { layer, anchorInput, subtableFieldCode, getCurrentWidths } = this.subtableEditor;
      const widths = typeof getCurrentWidths === 'function' ? getCurrentWidths() : null;
      if (subtableFieldCode && widths && Object.keys(widths).length) {
        void this.persistSubtableColumnWidths(subtableFieldCode, widths);
      }
      if (layer?.parentElement) layer.remove();
      this.subtableEditor = null;
      if (focusInput && anchorInput) {
        try {
          anchorInput.focus();
        } catch (_e) { /* noop */ }
      }
    }

    isDetailFormSubtableInput(input) {
      if (!input || !this.isDetailFormLayoutMode()) return false;
      const fieldCode = String(input.dataset.fieldCode || '').trim();
      if (!fieldCode) return false;
      const field = this.fieldMap.get(fieldCode);
      return Boolean(field && this.isSubtableField(field));
    }

    activateDetailFormSubtable(event, input, rowIndex, colIndex) {
      if (!input || this.saving) return;
      if (event && typeof event.button === 'number' && event.button !== 0) return;
      const now = Date.now();
      if (now - this.subtableActivationTs < 150) {
        if (event) {
          event.preventDefault();
          event.stopPropagation();
          if (typeof event.stopImmediatePropagation === 'function') {
            event.stopImmediatePropagation();
          }
        }
        return;
      }
      this.subtableActivationTs = now;
      if (event) {
        event.preventDefault();
        event.stopPropagation();
        if (typeof event.stopImmediatePropagation === 'function') {
          event.stopImmediatePropagation();
        }
      }
      this.dragSelecting = false;
      void this.openSubtableEditor(rowIndex, colIndex, input);
    }

    handleCellMouseDown(event, input) {
      if (this.saving) return;
      if (event.button !== 0) return;
      const rowIndex = Number(input.dataset.rowIndex || '0');
      const colIndex = Number(input.dataset.colIndex || '0');
      if (this.isDetailFormSubtableInput(input)) {
        this.activateDetailFormSubtable(event, input, rowIndex, colIndex);
        return;
      }
      const editing = this.isEditingCell(rowIndex, colIndex);

      if (editing) {
        event.stopPropagation();
        if (this.editingCell) {
          this.editingCell.selectAll = false;
        }
        this.dragSelecting = false;
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      if (event.shiftKey) {
        this.startSelection(rowIndex, colIndex, true);
        this.armedCell = { rowIndex, colIndex };
        return;
      }
      this.startSelection(rowIndex, colIndex, false);
      this.armedCell = { rowIndex, colIndex };
      if (event.detail >= 2) {
        this.enterEditMode(rowIndex, colIndex, input, true);
      }
    }

    handleCellHover(input) {
      if (!this.dragSelecting || this.editingCell) return;
      const rowIndex = Number(input.dataset.rowIndex || '0');
      const colIndex = Number(input.dataset.colIndex || '0');
      this.updateSelectionRange(rowIndex, colIndex);
    }

    handleChoiceInputClick(event, input) {
      if (this.saving) return;
      if (!input) return;
      const fieldCode = input.dataset.fieldCode;
      const recordId = input.dataset.recordId || '';
      if (!fieldCode) return;
      const field = this.fieldMap.get(fieldCode);
      const rowIndex = Number(input.dataset.rowIndex || '0');
      const colIndex = Number(input.dataset.colIndex || '0');
      if (!field) return;
      if (this.isLinkField(field) && input.readOnly) {
        const wantsOpen = Boolean(event?.ctrlKey || event?.metaKey);
        if (wantsOpen) {
          const raw = String((this.rowMap.get(recordId)?.values?.[fieldCode] ?? input.value ?? '') || '').trim();
          if (raw) {
            let href = raw;
            if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(href)) {
              href = `https://${href}`;
            }
            try {
              window.open(href, '_blank', 'noopener,noreferrer');
            } catch (_err) {
              // noop
            }
          }
          event?.preventDefault?.();
          event?.stopPropagation?.();
        }
        return;
      }
      if (this.isRichTextField(field)) {
        event?.preventDefault?.();
        event?.stopPropagation?.();
        if (typeof event?.stopImmediatePropagation === 'function') {
          event.stopImmediatePropagation();
        }
        this.openRichTextViewer(rowIndex, colIndex, input);
        return;
      }
      if (this.isMultiLineField(field)) {
        const canOpen = this.isOverlayViewOnly() || (this.isOverlayEditable() && this.permissionService.canEditCell(recordId, fieldCode));
        if (!canOpen) return;
        event?.preventDefault?.();
        event?.stopPropagation?.();
        if (typeof event?.stopImmediatePropagation === 'function') {
          event.stopImmediatePropagation();
        }
        this.openMultilineEditor(rowIndex, colIndex, input);
        return;
      }
      if (this.isSubtableField(field)) {
        if (this.isDetailFormLayoutMode()) return;
        this.openSubtableEditor(rowIndex, colIndex, input);
        return;
      }
      if (this.isMultiChoiceField(field)) {
        if (!this.permissionService.canEditCell(recordId, fieldCode) || !this.isOverlayEditable()) return;
        if (!this.isEditingCell(rowIndex, colIndex)) return;
        this.openMultiChoicePicker(rowIndex, colIndex, input);
        return;
      }
      if (!this.isChoiceField(field)) return;
      if (!this.permissionService.canEditCell(recordId, fieldCode)) return;
      if (!this.isEditingCell(rowIndex, colIndex)) return;
      if (this.radioPicker && this.radioPicker.input === input) return;
      this.openRadioPicker(rowIndex, colIndex, input);
    }

    onInputChanged(input) {
      if (!this.canMutateOverlay(false)) return;
      const recordId = input.dataset.recordId;
      const fieldCode = input.dataset.fieldCode;
      if (!recordId || !fieldCode) return;
      const key = `${recordId}:${fieldCode}`;
      const field = this.fieldMap.get(fieldCode);
      if (!field) return;
      const cellPermission = this.getCellPermissionInfo(recordId, fieldCode);
      if (!cellPermission.editable || !this.isOverlayEditable()) return;
      const cell = input.parentElement;
      if (!cell) return;

      const rawValue = input.value;
      const validation = this.validate(rawValue, field);

      if (!validation.ok) {
        cell.classList.add('pb-overlay__cell--error');
        this.invalidCells.add(key);
        this.invalidValueCache.set(key, rawValue);
      } else {
        cell.classList.remove('pb-overlay__cell--error');
        this.invalidCells.delete(key);
        this.invalidValueCache.delete(key);
      }

      if (!validation.ok) {
        this.markDirtyState(recordId, fieldCode, input.dataset.originalValue, null);
        this.updateStats();
        return;
      }

      const normalized = validation.value;
      const row = this.rowMap.get(recordId);
      const originalValue = row ? row.original[fieldCode] : input.dataset.originalValue;
      if (row) {
        row.values[fieldCode] = normalized;
      }
      if (this.isMultiValueField(field)) {
        input.value = this.formatCellDisplayValue(field, normalized);
      } else if (this.isRichTextField(field)) {
        input.value = this.formatCellDisplayValue(field, normalized);
      }

      if (this.valuesEqual(normalized, originalValue)) {
        cell.classList.remove('pb-overlay__cell--dirty');
        this.removeDiff(recordId, fieldCode);
      } else {
        cell.classList.add('pb-overlay__cell--dirty');
        this.addDiff(recordId, fieldCode, normalized, field.type);
      }
      this.updateDirtyBadge();
      if (this.hasActiveFilters()) {
        const rowIndex = Number(input.dataset.rowIndex || '-1');
        const colIndex = Number(input.dataset.colIndex || '-1');
        const editingNow = this.isEditingCell(rowIndex, colIndex) && !input.readOnly;
        if (editingNow) {
          this.needsFilterReapply = true;
        } else {
          this.applyFilters();
          return;
        }
      }
      this.updateStats();
    }

    handlePaste(event, input) {
      if (!this.canMutateOverlay(true)) return;
      if (!event.clipboardData) return;
      const text = event.clipboardData.getData('text');
      if (!text) return;
      event.preventDefault();
      const { matrix, rowCount, colCount } = this.parseClipboardMatrix(text);
      if (!rowCount || !colCount) return;
      const startRow = Number(input?.dataset?.rowIndex || '0');
      const startCol = Number(input?.dataset?.colIndex || '0');
      this.applyPastedMatrixAt(matrix, startRow, startCol);
    }

    parseClipboardMatrix(text) {
      const normalized = String(text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
      const lines = normalized.split('\n');
      if (lines.length && lines[lines.length - 1] === '') {
        lines.pop();
      }
      if (!lines.length) return { matrix: [], rowCount: 0, colCount: 0 };
      const matrix = lines.map((line) => line.split('\t'));
      const rowCount = matrix.length;
      const colCount = matrix.reduce((max, row) => Math.max(max, row.length), 0);
      return { matrix, rowCount, colCount };
    }

    getFormClipboardLinesFromSelection(selection) {
      if (!selection) return [];
      const row = this.getVisibleRowAt(selection.startRow);
      if (!row) return [];
      const lines = [];
      for (let c = selection.startCol; c <= selection.endCol; c += 1) {
        const field = this.fields[c];
        if (!field) continue;
        const value = row.values[field.code];
        lines.push(this.formatCellDisplayValue(field, value));
      }
      return lines;
    }

    getPasteStartCell() {
      if (this.selection) {
        return {
          rowIndex: this.selection.startRow,
          colIndex: this.selection.startCol
        };
      }
      const active = document.activeElement;
      if (active instanceof HTMLInputElement) {
        return {
          rowIndex: Number(active.dataset.rowIndex || '0'),
          colIndex: Number(active.dataset.colIndex || '0')
        };
      }
      return { rowIndex: 0, colIndex: 0 };
    }

    async pasteClipboard() {
      if (!this.canMutateOverlay(true)) return;
      if (this.saving) return;
      let text = '';
      try {
        if (!navigator?.clipboard?.readText) return;
        text = await navigator.clipboard.readText();
      } catch (error) {
        console.warn('[kintone-excel-overlay] clipboard read failed', error);
        return;
      }
      const { matrix, rowCount, colCount } = this.parseClipboardMatrix(text);
      if (!rowCount || !colCount) return;
      const start = this.getPasteStartCell();
      this.exitEditMode();
      this.applyPastedMatrixAt(matrix, start.rowIndex, start.colIndex);
    }

    applyPastedMatrixAt(matrix, startRow, startCol) {
      if (!this.canMutateOverlay(true)) return;
      if (!Array.isArray(matrix) || !matrix.length) return;
      if (this.isDetailFormLayoutMode()) {
        this.applyFormPastedMatrixAt(matrix, startCol);
        return;
      }
      const rowCount = this.getVisibleRowCount();
      const colCount = this.fields.length;
      let attemptedRows = 0;
      let attemptedCols = 0;
      const targets = [];
      for (let r = 0; r < matrix.length; r += 1) {
        const targetRowIndex = startRow + r;
        if (targetRowIndex >= rowCount) break;
        const rowValues = matrix[r];
        for (let c = 0; c < rowValues.length; c += 1) {
          const targetColIndex = startCol + c;
          if (targetColIndex >= colCount) break;
          const row = this.getVisibleRowAt(targetRowIndex);
          const field = this.fields[targetColIndex];
          if (!row || !field) continue;
          targets.push({
            recordId: String(row.id || '').trim(),
            fieldCode: String(field.code || '').trim(),
            rowIndex: targetRowIndex,
            colIndex: targetColIndex,
            value: rowValues[c]
          });
          attemptedCols = Math.max(attemptedCols, c + 1);
        }
        attemptedRows = r + 1;
      }

      const filteredTargets = this.permissionService.filterPasteTargets(targets);
      const applicableTargets = Array.isArray(filteredTargets?.applicable) ? filteredTargets.applicable : [];
      const skippedTargets = Array.isArray(filteredTargets?.skipped) ? filteredTargets.skipped : [];
      const pasteChanges = [];
      applicableTargets.forEach((target) => {
        const change = this.applyPastedValue(target.rowIndex, target.colIndex, target.value);
        if (change) pasteChanges.push(change);
      });

      if (skippedTargets.length) {
        this.notify(resolveText(this.language, 'toastPasteSkipped', skippedTargets.length));
      }
      if (!attemptedRows || !attemptedCols) return;
      if (!applicableTargets.length) return;
      if (pasteChanges.length) {
        this.pushHistory({
          type: 'paste',
          payload: { changes: pasteChanges }
        });
      }
      const endRow = Math.min(rowCount - 1, startRow + attemptedRows - 1);
      const endCol = Math.min(colCount - 1, startCol + attemptedCols - 1);
      this.selection = {
        startRow,
        endRow,
        startCol,
        endCol,
        anchorRow: startRow,
        anchorCol: startCol
      };
      this.repaintSelection();
      this.updateStats();
      this.flashPastedRange(startRow, endRow, startCol, endCol);
      if (this.hasActiveFilters()) {
        this.needsFilterReapply = false;
        this.applyFilters();
      }
    }

    applyFormPastedMatrixAt(matrix, startCol) {
      if (!this.canMutateOverlay(true)) return;
      if (!Array.isArray(matrix) || !matrix.length) return;
      const colCount = this.fields.length;
      if (!this.getVisibleRowCount() || !colCount) return;
      const targetRowIndex = 0;
      const normalizedStartCol = Math.max(0, Math.min(colCount - 1, Number(startCol || 0)));
      const values = matrix.map((row) => (Array.isArray(row) && row.length ? row[0] : ''));
      const targets = [];
      for (let i = 0; i < values.length; i += 1) {
        const targetColIndex = normalizedStartCol + i;
        if (targetColIndex >= colCount) break;
        const row = this.getVisibleRowAt(targetRowIndex);
        const field = this.fields[targetColIndex];
        if (!row || !field) continue;
        targets.push({
          recordId: String(row.id || '').trim(),
          fieldCode: String(field.code || '').trim(),
          rowIndex: targetRowIndex,
          colIndex: targetColIndex,
          value: values[i]
        });
      }

      const filteredTargets = this.permissionService.filterPasteTargets(targets);
      const applicableTargets = Array.isArray(filteredTargets?.applicable) ? filteredTargets.applicable : [];
      const skippedTargets = Array.isArray(filteredTargets?.skipped) ? filteredTargets.skipped : [];
      const pasteChanges = [];
      applicableTargets.forEach((target) => {
        const change = this.applyPastedValue(target.rowIndex, target.colIndex, target.value);
        if (change) pasteChanges.push(change);
      });

      if (skippedTargets.length) {
        this.notify(resolveText(this.language, 'toastPasteSkipped', skippedTargets.length));
      }
      if (!applicableTargets.length) return;
      if (pasteChanges.length) {
        this.pushHistory({
          type: 'paste',
          payload: { changes: pasteChanges }
        });
      }
      const endCol = Math.min(colCount - 1, normalizedStartCol + Math.max(0, values.length - 1));
      this.selection = {
        startRow: targetRowIndex,
        endRow: targetRowIndex,
        startCol: normalizedStartCol,
        endCol,
        anchorRow: targetRowIndex,
        anchorCol: normalizedStartCol
      };
      this.repaintSelection();
      this.updateStats();
      this.flashPastedRange(targetRowIndex, targetRowIndex, normalizedStartCol, endCol);
      if (this.hasActiveFilters()) {
        this.needsFilterReapply = false;
        this.applyFilters();
      }
    }

    flashPastedRange(startRow, endRow, startCol, endCol) {
      const flashedCells = [];
      for (let r = startRow; r <= endRow; r += 1) {
        for (let c = startCol; c <= endCol; c += 1) {
          const input = this.getInput(r, c);
          const cell = input?.parentElement;
          if (!cell) continue;
          cell.classList.add('pb-overlay__cell--paste-flash');
          flashedCells.push(cell);
        }
      }
      if (this.pasteFlashTimer) {
        clearTimeout(this.pasteFlashTimer);
      }
      this.pasteFlashTimer = setTimeout(() => {
        flashedCells.forEach((cell) => cell.classList.remove('pb-overlay__cell--paste-flash'));
        this.pasteFlashTimer = null;
      }, 220);
    }

    applyPastedValue(rowIndex, colIndex, rawValue) {
      const row = this.getVisibleRowAt(rowIndex);
      const field = this.fields[colIndex];
      if (!row || !field) return null;
      if (this.isSubtableField(field)) return null;
      const cellPermission = this.getCellPermissionInfo(row.id, field.code);
      if (!this.isOverlayEditable() || !cellPermission.editable) return null;
      const beforeValue = this.deepClone(row.values[field.code]);
      const input = this.getInput(rowIndex, colIndex);
      if (input) {
        input.value = rawValue;
        this.onInputChanged(input);
        const afterValue = this.deepClone(row.values[field.code]);
        if (this.valuesEqual(beforeValue, afterValue)) return null;
        return {
          recordId: row.id,
          fieldCode: field.code,
          before: beforeValue,
          after: afterValue
        };
      }
      const recordId = row.id;
      const fieldCode = field.code;
      const key = `${recordId}:${fieldCode}`;
      const validation = this.validate(rawValue, field);
      if (!validation.ok) {
        this.invalidCells.add(key);
        this.invalidValueCache.set(key, rawValue);
        this.markDirtyState(recordId, fieldCode, row.original[fieldCode], null);
        this.updateDirtyBadge();
        this.updateStats();
        return null;
      }
      this.invalidCells.delete(key);
      this.invalidValueCache.delete(key);
      const normalized = validation.value;
      row.values[fieldCode] = normalized;
      if (this.valuesEqual(normalized, row.original[fieldCode])) {
        this.removeDiff(recordId, fieldCode);
      } else {
        this.addDiff(recordId, fieldCode, normalized, field.type);
      }
      this.updateDirtyBadge();
      this.updateStats();
      const afterValue = this.deepClone(row.values[fieldCode]);
      if (this.valuesEqual(beforeValue, afterValue)) return null;
      return {
        recordId,
        fieldCode,
        before: beforeValue,
        after: afterValue
      };
    }

    setSelectionSingle(rowIndex, colIndex) {
      const maxRow = Math.max(0, this.getVisibleRowCount() - 1);
      const maxCol = Math.max(0, this.fields.length - 1);
      if (maxRow < 0 || maxCol < 0) {
        this.selection = null;
        this.armedCell = null;
        this.repaintSelection();
        this.updateStats();
        return;
      }
      const r = Math.max(0, Math.min(maxRow, rowIndex));
      const c = Math.max(0, Math.min(maxCol, colIndex));
      this.selection = {
        anchorRow: r,
        anchorCol: c,
        startRow: r,
        endRow: r,
        startCol: c,
        endCol: c
      };
      this.armedCell = { rowIndex: r, colIndex: c };
      this.dragSelecting = false;
      this.repaintSelection();
      this.updateStats();
    }

    setSelection(rowIndex, colIndex, options = {}) {
      const maxRow = Math.max(0, this.getVisibleRowCount() - 1);
      const maxCol = Math.max(0, this.fields.length - 1);
      if (maxRow < 0 || maxCol < 0) {
        this.selection = null;
        this.armedCell = null;
        this.repaintSelection();
        this.updateStats();
        return null;
      }
      const r = Math.max(0, Math.min(maxRow, rowIndex));
      const c = Math.max(0, Math.min(maxCol, colIndex));
      const extend = options?.extend === true;

      if (extend) {
        if (!this.selection) {
          this.selection = {
            anchorRow: r,
            anchorCol: c,
            startRow: r,
            endRow: r,
            startCol: c,
            endCol: c
          };
        } else {
          const anchorRow = typeof this.selection.anchorRow === 'number' ? this.selection.anchorRow : this.selection.startRow;
          const anchorCol = typeof this.selection.anchorCol === 'number' ? this.selection.anchorCol : this.selection.startCol;
          this.selection.startRow = Math.min(anchorRow, r);
          this.selection.endRow = Math.max(anchorRow, r);
          this.selection.startCol = Math.min(anchorCol, c);
          this.selection.endCol = Math.max(anchorCol, c);
        }
      } else {
        this.selection = {
          anchorRow: r,
          anchorCol: c,
          startRow: r,
          endRow: r,
          startCol: c,
          endCol: c
        };
      }

      this.armedCell = { rowIndex: r, colIndex: c };
      this.dragSelecting = false;
      this.repaintSelection();
      this.updateStats();
      this.syncSelectionScroll({ rowIndex: r, colIndex: c });
      if (options?.focus !== false) {
        this.focusCell(r, c, { ensureVisible: false });
      }
      return { row: r, col: c };
    }

    startSelection(rowIndex, colIndex, extend = false) {
      this.exitEditMode();
      const maxRow = Math.max(0, this.getVisibleRowCount() - 1);
      const maxCol = Math.max(0, this.fields.length - 1);
      if (maxRow < 0 || maxCol < 0) return;
      const r = Math.max(0, Math.min(maxRow, rowIndex));
      const c = Math.max(0, Math.min(maxCol, colIndex));
      if (!extend || !this.selection) {
        this.selection = {
          anchorRow: r,
          anchorCol: c,
          startRow: r,
          endRow: r,
          startCol: c,
          endCol: c
        };
      } else {
        if (typeof this.selection.anchorRow !== 'number') {
          this.selection.anchorRow = this.selection.startRow;
          this.selection.anchorCol = this.selection.startCol;
        }
        this.selection.startRow = Math.min(this.selection.anchorRow, r);
        this.selection.endRow = Math.max(this.selection.anchorRow, r);
        this.selection.startCol = Math.min(this.selection.anchorCol, c);
        this.selection.endCol = Math.max(this.selection.anchorCol, c);
      }
      this.armedCell = { rowIndex: r, colIndex: c };
      this.dragSelecting = true;
      this.repaintSelection();
      this.updateStats();
      this.focusCell(r, c);
    }

    updateSelectionRange(rowIndex, colIndex, focus = false) {
      const maxRow = Math.max(0, this.getVisibleRowCount() - 1);
      const maxCol = Math.max(0, this.fields.length - 1);
      if (maxRow < 0 || maxCol < 0) return;
      const r = Math.max(0, Math.min(maxRow, rowIndex));
      const c = Math.max(0, Math.min(maxCol, colIndex));
      if (!this.selection) {
        this.selection = {
          anchorRow: r,
          anchorCol: c,
          startRow: r,
          endRow: r,
          startCol: c,
          endCol: c
        };
      } else {
        const anchorRow = typeof this.selection.anchorRow === 'number' ? this.selection.anchorRow : r;
        const anchorCol = typeof this.selection.anchorCol === 'number' ? this.selection.anchorCol : c;
        this.selection.startRow = Math.min(anchorRow, r);
        this.selection.endRow = Math.max(anchorRow, r);
        this.selection.startCol = Math.min(anchorCol, c);
        this.selection.endCol = Math.max(anchorCol, c);
      }
      this.repaintSelection();
      this.updateStats();
      if (focus) {
        this.focusCell(r, c);
      }
    }

    endSelection() {
      this.dragSelecting = false;
    }

    isCellSelected(rowIndex, colIndex) {
      if (!this.selection) return false;
      if (rowIndex < 0 || colIndex < 0) return false;
      const s = this.selection;
      return rowIndex >= s.startRow && rowIndex <= s.endRow
        && colIndex >= s.startCol && colIndex <= s.endCol;
    }

    isCellArmed(rowIndex, colIndex) {
      if (!this.armedCell) return false;
      if (this.editingCell) return false;
      return this.armedCell.rowIndex === rowIndex && this.armedCell.colIndex === colIndex;
    }

    isCellActive(rowIndex, colIndex) {
      if (this.isEditingCell(rowIndex, colIndex)) return true;
      if (!this.armedCell) return false;
      return this.armedCell.rowIndex === rowIndex && this.armedCell.colIndex === colIndex;
    }

    repaintSelection() {
      this.inputsByRow.forEach((rowInputs, rowIndex) => {
        if (!Array.isArray(rowInputs)) return;
        rowInputs.forEach((input, colIndex) => {
          if (!input) return;
          const cell = input.parentElement;
          if (!cell) return;
          const r = Number(rowIndex);
          const c = Number(colIndex);
          if (this.isCellSelected(Number(rowIndex), Number(colIndex))) {
            cell.classList.add('pb-overlay__cell--selected');
          } else {
            cell.classList.remove('pb-overlay__cell--selected');
          }
          if (this.isCellArmed(r, c)) {
            cell.classList.add('pb-overlay__cell--armed');
          } else {
            cell.classList.remove('pb-overlay__cell--armed');
          }
          if (this.isCellActive(r, c)) {
            cell.classList.add('pb-overlay__cell--active');
          } else {
            cell.classList.remove('pb-overlay__cell--active');
          }
          if (this.isEditingCell(r, c) && input.classList.contains('pb-overlay__input--editing')) {
            cell.classList.add('pb-overlay__cell--editing');
          } else {
            cell.classList.remove('pb-overlay__cell--editing');
          }
        });
      });
    }

    isEditingCell(rowIndex, colIndex) {
      if (!this.editingCell) return false;
      return this.editingCell.rowIndex === rowIndex && this.editingCell.colIndex === colIndex;
    }

    enterEditMode(rowIndex, colIndex, input, selectAll = false) {
      if (this.saving) return;
      const maxRow = Math.max(0, this.getVisibleRowCount() - 1);
      const maxCol = Math.max(0, this.fields.length - 1);
      if (maxRow < 0 || maxCol < 0) return;
      const r = Math.max(0, Math.min(maxRow, rowIndex));
      const c = Math.max(0, Math.min(maxCol, colIndex));
      const field = this.fields[c];
      const targetRow = this.getVisibleRowAt(r);
      const targetRecordId = String(targetRow?.id || '').trim();
      const cellPermission = this.getCellPermissionInfo(targetRecordId, String(field?.code || ''));
      if (!this.isOverlayEditable() || !cellPermission.editable) {
        if (this.isSubtableField(field)) {
          if (targetRecordId) {
            this.openSubtableEditor(r, c, input || this.getInput(r, c));
          }
        } else if (this.isMultiLineField(field) && (this.isOverlayViewOnly() || targetRecordId)) {
          this.openMultilineEditor(r, c, input || this.getInput(r, c));
        } else if (this.isRichTextField(field)) {
          this.openRichTextViewer(r, c, input || this.getInput(r, c));
        }
        return;
      }
      if (this.editingCell && (this.editingCell.rowIndex !== r || this.editingCell.colIndex !== c)) {
        this.exitEditMode();
      }
      this.dragSelecting = false;
      this.setSelectionSingle(r, c);
      this.armedCell = null;
      this.pendingEdit = null;
      const targetInput = input || this.getInput(r, c);
      if (this.isMultiLineField(field)) {
        this.closeRadioPicker();
        this.closeMultiChoicePicker();
        this.editingCell = null;
        this.openMultilineEditor(r, c, targetInput);
        return;
      }
      if (this.isRichTextField(field)) {
        this.closeRadioPicker();
        this.closeMultiChoicePicker();
        this.editingCell = null;
        this.openRichTextViewer(r, c, targetInput);
        return;
      }
      if (this.isMultiChoiceField(field)) {
        this.closeRadioPicker();
        this.editingCell = null;
        this.openMultiChoicePicker(r, c, targetInput);
        return;
      }
      this.editingCell = this.createEditingState(r, c, !!selectAll);
      if (targetInput) {
        this.setInputEditingVisual(targetInput, true);
        requestAnimationFrame(() => {
          targetInput.focus();
          if (this.editingCell && this.editingCell.rowIndex === r && this.editingCell.colIndex === c) {
            this.applyCaretPlacement(targetInput, !!this.editingCell.selectAll);
          }
          if (this.isChoiceField(field)) {
            this.openRadioPicker(r, c, targetInput);
          }
        });
      }
    }

    exitEditMode() {
      if (!this.editingCell) return;
      const previousEditingCell = this.editingCell;
      const { rowIndex, colIndex } = previousEditingCell;
      this.closeRadioPicker();
      this.closeMultiChoicePicker();
      const input = this.getInput(rowIndex, colIndex);
      if (input) {
        this.setInputEditingVisual(input, false);
      }
      this.commitCellEditHistory(previousEditingCell);
      this.editingCell = null;
      this.pendingEdit = null;
      this.setSelectionSingle(rowIndex, colIndex);
    }

    createEditingState(rowIndex, colIndex, selectAll = false) {
      const row = this.getVisibleRowAt(rowIndex);
      const field = this.fields[colIndex];
      const recordId = String(row?.id || '').trim();
      const fieldCode = String(field?.code || '').trim();
      const beforeValue = row && fieldCode ? this.deepClone(row.values[fieldCode]) : '';
      return {
        rowIndex,
        colIndex,
        selectAll: Boolean(selectAll),
        recordId,
        fieldCode,
        beforeValue
      };
    }

    commitCellEditHistory(editState) {
      if (!editState || this.isReplayingHistory) return;
      const recordId = String(editState.recordId || '').trim();
      const fieldCode = String(editState.fieldCode || '').trim();
      if (!recordId || !fieldCode) return;
      const row = this.rowMap.get(recordId);
      if (!row) return;
      const before = this.deepClone(editState.beforeValue);
      const after = this.deepClone(row.values[fieldCode]);
      if (this.valuesEqual(before, after)) return;
      this.pushHistory({
        type: 'cell-edit',
        payload: {
          recordId,
          fieldCode,
          before,
          after
        }
      });
    }

    applyEditorValueChange(recordId, field, nextRawValue, options = {}) {
      const key = String(recordId || '').trim();
      const fieldCode = String(field?.code || '').trim();
      if (!key || !fieldCode || !field) return false;
      const row = this.rowMap.get(key);
      if (!row) return false;
      const before = this.deepClone(row.values[fieldCode]);
      let nextValue;
      if (this.isMultiValueField(field)) {
        nextValue = this.normalizeMultiValue(nextRawValue, field);
      } else if (this.isRichTextField(field)) {
        nextValue = String(nextRawValue ?? '');
      } else {
        const validation = this.validate(nextRawValue, field);
        if (!validation.ok) return false;
        nextValue = validation.value;
      }
      if (this.valuesEqual(before, nextValue)) return false;

      row.values[fieldCode] = this.deepClone(nextValue);
      const original = row.original[fieldCode];
      if (this.valuesEqual(nextValue, original)) {
        this.removeDiff(key, fieldCode);
      } else {
        this.addDiff(key, fieldCode, nextValue, field.type);
      }

      const invalidKey = `${key}:${fieldCode}`;
      this.invalidCells.delete(invalidKey);
      this.invalidValueCache.delete(invalidKey);

      const input = this.findInput(key, fieldCode);
      if (input) {
        input.dataset.originalValue = this.formatCellDisplayValue(field, row.original[fieldCode]);
        input.value = this.formatCellDisplayValue(field, row.values[fieldCode]);
        this.applyCellVisualState(input, row, fieldCode);
      }

      if (options.pushHistory !== false) {
        this.pushHistory({
          type: options.historyType || 'cell-edit',
          payload: {
            recordId: key,
            fieldCode,
            before,
            after: this.deepClone(nextValue)
          }
        });
      }

      this.updateDirtyBadge();
      if (this.hasActiveFilters() && options.applyFilters !== false) {
        this.applyFilters();
      } else {
        this.updateStats();
      }
      return true;
    }

    async copySelectionToClipboard() {
      this.exitEditMode();
      let sel = this.selection;
      if (!sel) {
        const active = this.pendingFocus || (() => {
          const el = document.activeElement;
          if (el instanceof HTMLInputElement && el.dataset) {
            return {
              rowIndex: Number(el.dataset.rowIndex || '0'),
              colIndex: Number(el.dataset.colIndex || '0')
            };
          }
          return { rowIndex: 0, colIndex: 0 };
        })();
        this.setSelectionSingle(active.rowIndex, active.colIndex);
        sel = this.selection;
      }
      if (!sel) return;
      const text = this.isDetailFormLayoutMode()
        ? this.getFormClipboardLinesFromSelection(sel).join('\n')
        : (() => {
          const rowsOut = [];
          for (let r = sel.startRow; r <= sel.endRow; r += 1) {
            const rowVals = [];
            const rowData = this.getVisibleRowAt(r);
            for (let c = sel.startCol; c <= sel.endCol; c += 1) {
              const field = this.fields[c];
              const value = rowData && field ? rowData.values[field.code] : '';
              rowVals.push(field ? this.formatCellDisplayValue(field, value) : '');
            }
            rowsOut.push(rowVals.join('\t'));
          }
          return rowsOut.join('\n');
        })();
      try {
        if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
          await navigator.clipboard.writeText(text);
        } else {
          const textarea = document.createElement('textarea');
          textarea.value = text;
          textarea.setAttribute('readonly', 'true');
          textarea.style.position = 'fixed';
          textarea.style.top = '-9999px';
          document.body.appendChild(textarea);
          textarea.focus();
          textarea.select();
          const ok = document.execCommand('copy');
          textarea.remove();
          if (!ok) throw new Error('execCommand copy returned false');
        }
        this.notify(resolveText(this.language, 'toastCopySuccess'));
      } catch (error) {
        this.notify(resolveText(this.language, 'toastCopyFailed'));
        console.error('[kintone-excel-overlay] copy failed', error);
      }
    }

    addDiff(recordId, fieldCode, value, type) {
      let entry = this.diff.get(recordId);
      if (!entry) {
        entry = {};
        this.diff.set(recordId, entry);
      }
      entry[fieldCode] = { value, type };
    }

    removeDiff(recordId, fieldCode) {
      const entry = this.diff.get(recordId);
      if (!entry) return;
      delete entry[fieldCode];
      if (Object.keys(entry).length === 0) {
        this.diff.delete(recordId);
      }
    }

    markDirtyState(recordId, fieldCode, originalValue, value) {
      if (value === originalValue) {
        this.removeDiff(recordId, fieldCode);
        const input = this.findInput(recordId, fieldCode);
        if (input) input.parentElement.classList.remove('pb-overlay__cell--dirty');
      }
      this.updateDirtyBadge();
    }

    findInput(recordId, fieldCode) {
      const rowIndex = this.getVisibleRowIndexById(recordId);
      if (rowIndex < 0) return null;
      const colIndex = this.fieldIndexMap.get(fieldCode);
      if (colIndex === undefined) return null;
      return this.getInput(rowIndex, colIndex);
    }

    updateDirtyBadge() {
      if (!this.dirtyBadge) return;
      let count = 0;
      this.diff.forEach((entry) => {
        count += Object.keys(entry).length;
      });
      count += this.pendingDeletes.size;
      this.dirtyBadge.textContent = resolveText(this.language, 'dirtyLabel', count);
      if (count > 0) {
        this.dirtyBadge.classList.add('pb-overlay__dirty--active');
      } else {
        this.dirtyBadge.classList.remove('pb-overlay__dirty--active');
      }
      if (this.saveButton && !this.saving) {
        const canSave = this.canSaveOverlay();
        this.saveButton.disabled = !canSave || count === 0;
        this.saveButton.title = canSave ? '' : resolveText(this.language, 'toastViewOnlyBlocked');
      }
    }

    updateStats() {
      const numbers = [];
      const visibleRows = this.getVisibleRows();
      let selectedCells = 0;
      if (this.selection) {
        const selectedRows = Math.max(0, this.selection.endRow - this.selection.startRow + 1);
        const selectedCols = Math.max(0, this.selection.endCol - this.selection.startCol + 1);
        selectedCells = selectedRows * selectedCols;
        for (let r = this.selection.startRow; r <= this.selection.endRow; r += 1) {
          const row = visibleRows[r];
          if (!row) continue;
          for (let c = this.selection.startCol; c <= this.selection.endCol; c += 1) {
            const field = this.fields[c];
            if (!field || field.type !== 'NUMBER') continue;
            const raw = row.values[field.code];
            if (raw === undefined || raw === null || raw === '') continue;
            const parsed = Number(String(raw).replace(/,/g, ''));
            if (!Number.isNaN(parsed)) numbers.push(parsed);
          }
        }
      } else {
        this.diff.forEach((entry) => {
          Object.keys(entry).forEach((fieldCode) => {
            const item = entry[fieldCode];
            if (!item || item.type !== 'NUMBER') return;
            const parsed = Number(String(item.value).replace(/,/g, ''));
            if (!Number.isNaN(parsed)) numbers.push(parsed);
          });
        });
      }

      const count = numbers.length;
      const sum = numbers.reduce((acc, v) => acc + v, 0);
      const avg = count ? (sum / count) : 0;
      const sumDisplay = count ? sum : '-';
      const avgDisplay = count ? avg.toFixed(2) : '-';
      const countDisplay = count || '-';
      const filteredRowsCount = visibleRows.length;
      const pendingDeleteCount = this.pendingDeletes.size;
      const newRowsCount = this.rows.reduce((acc, row) => acc + (this.isNewRowId(row?.id) ? 1 : 0), 0);

      if (this.statsElements.selected) {
        this.statsElements.selected.textContent = `${resolveText(this.language, 'statusSelectedCells')}: ${selectedCells}`;
      }
      if (this.statsElements.filtered) {
        this.statsElements.filtered.textContent = `${resolveText(this.language, 'statusFilteredRows')}: ${filteredRowsCount}`;
      }
      if (this.statsElements.pendingDelete) {
        this.statsElements.pendingDelete.textContent = `${resolveText(this.language, 'statusPendingDeletes')}: ${pendingDeleteCount}`;
      }
      if (this.statsElements.newRows) {
        this.statsElements.newRows.textContent = `${resolveText(this.language, 'statusNewRows')}: ${newRowsCount}`;
      }
      if (this.statsElements.sum) {
        this.statsElements.sum.textContent = `${resolveText(this.language, 'statusSum')}: ${sumDisplay}`;
      }
      if (this.statsElements.avg) {
        this.statsElements.avg.textContent = `${resolveText(this.language, 'statusAvg')}: ${avgDisplay}`;
      }
      if (this.statsElements.count) {
        this.statsElements.count.textContent = `${resolveText(this.language, 'statusCount')}: ${countDisplay}`;
      }
    }

    validate(value, field) {
      const type = field?.type;
      const trimmed = String(value ?? '').trim();
      if (type === 'NUMBER') {
        if (!trimmed) return { ok: true, value: '' };
        const num = Number(trimmed);
        if (Number.isNaN(num)) return { ok: false, error: 'NaN' };
        return { ok: true, value: trimmed };
      }
      if (type === 'DATE') {
        if (!trimmed) return { ok: true, value: '' };
        const re = /^\d{4}-\d{2}-\d{2}$/;
        if (!re.test(trimmed)) return { ok: false, error: 'Invalid date' };
        return { ok: true, value: trimmed };
      }
      if (type === 'RADIO_BUTTON' || type === 'DROP_DOWN') {
        if (!trimmed) return { ok: true, value: '' };
        const choices = Array.isArray(field?.choices) ? field.choices : [];
        if (choices.length && !choices.includes(trimmed)) {
          return { ok: false, error: 'Invalid choice' };
        }
        return { ok: true, value: trimmed };
      }
      if (type === 'CHECK_BOX' || type === 'MULTI_SELECT') {
        if (Array.isArray(value)) {
          return { ok: true, value: this.normalizeMultiValue(value, field) };
        }
        const normalized = this.normalizeMultiValue(trimmed, field);
        return { ok: true, value: normalized };
      }
      if (type === 'RICH_TEXT') {
        return { ok: true, value: String(value ?? '') };
      }
      return { ok: true, value: value ?? '' };
    }

    applyLimit(baseQuery, limit) {
      const size = Number(limit);
      if (!Number.isFinite(size) || size <= 0) return String(baseQuery || '').trim();
      return this.normalizeOverlayQuery(baseQuery, Math.floor(size), 0);
    }

    deepClone(value) {
      if (value === undefined) return undefined;
      if (typeof structuredClone === 'function') {
        try {
          return structuredClone(value);
        } catch (_err) {
          // fallback below
        }
      }
      return JSON.parse(JSON.stringify(value));
    }

    valuesEqual(a, b) {
      return JSON.stringify(a) === JSON.stringify(b);
    }

    pushHistory(entry) {
      if (!entry || this.isReplayingHistory) return;
      this.undoStack.push({
        ...entry,
        timestamp: Date.now()
      });
      if (this.undoStack.length > this.maxHistory) {
        this.undoStack.shift();
      }
      this.redoStack = [];
      this.updateHistoryButtons();
    }

    clearHistory() {
      this.undoStack = [];
      this.redoStack = [];
      this.updateHistoryButtons();
    }

    updateHistoryButtons() {
      if (this.undoButton) {
        this.undoButton.disabled = this.saving || !this.canEditOverlay() || this.undoStack.length === 0;
      }
      if (this.redoButton) {
        this.redoButton.disabled = this.saving || !this.canEditOverlay() || this.redoStack.length === 0;
      }
    }

    setRowFieldValueFromHistory(recordId, fieldCode, nextValue) {
      const key = String(recordId || '').trim();
      const code = String(fieldCode || '').trim();
      if (!key || !code) return;
      const row = this.rowMap.get(key);
      const field = this.fieldMap.get(code);
      if (!row || !field) return;
      const value = this.deepClone(nextValue);
      row.values[code] = value;
      const original = row.original[code];
      if (this.valuesEqual(value, original)) {
        this.removeDiff(key, code);
      } else {
        this.addDiff(key, code, value, field.type);
      }
      const invalidKey = `${key}:${code}`;
      this.invalidCells.delete(invalidKey);
      this.invalidValueCache.delete(invalidKey);
      const input = this.findInput(key, code);
      if (input) {
        input.value = this.formatCellDisplayValue(field, row.values[code]);
        this.applyCellVisualState(input, row, code);
      }
    }

    applyDeleteToggleState(recordId, nextState) {
      const key = String(recordId || '').trim();
      if (!key || this.isNewRowId(key)) return;
      const shouldSet = Boolean(nextState);
      if (shouldSet) this.pendingDeletes.add(key);
      else this.pendingDeletes.delete(key);
      this.syncPermissionServicePendingDeletes();
      const editingRowId = this.editingCell ? this.getVisibleRowAt(this.editingCell.rowIndex)?.id : '';
      if (editingRowId && String(editingRowId) === key) {
        this.exitEditMode();
      }
      this.updateVirtualRows(true);
      this.updateDirtyBadge();
      this.updateStats();
    }

    restoreHistoryAddRow(rowSnapshot, index) {
      const row = this.deepClone(rowSnapshot);
      const id = String(row?.id || '').trim();
      if (!id) return;
      if (this.rowMap.has(id)) return;
      const insertAt = Math.max(0, Math.min(Number(index) || 0, this.rows.length));
      this.rows.splice(insertAt, 0, row);
      this.rebuildRowMaps();
      this.recomputeFilteredRowIds();
      this.updateVirtualRows(true);
      this.updateDirtyBadge();
      this.updateStats();
    }

    removeHistoryAddRow(rowId) {
      const key = String(rowId || '').trim();
      if (!key) return;
      const index = this.rows.findIndex((row) => String(row?.id || '').trim() === key);
      if (index < 0) return;
      if (this.editingCell && this.getVisibleRowAt(this.editingCell.rowIndex)?.id === key) {
        this.exitEditMode();
      }
      this.rows.splice(index, 1);
      this.pendingDeletes.delete(key);
      this.syncPermissionServicePendingDeletes();
      this.diff.delete(key);
      this.rowMap.delete(key);
      this.rowIndexMap.delete(key);
      this.revisionMap.delete(key);
      this.permissionService.removeRecordAcl(key);
      this.clearInvalidStateForRecord(key);
      this.rebuildRowMaps();
      this.recomputeFilteredRowIds();
      const visibleCount = this.getVisibleRowCount();
      if (!visibleCount) {
        this.selection = null;
        this.armedCell = null;
      } else if (this.selection) {
        const nextRow = Math.max(0, Math.min(visibleCount - 1, this.selection.startRow || 0));
        const nextCol = Math.max(0, Math.min(this.fields.length - 1, this.selection.startCol || 0));
        this.setSelectionSingle(nextRow, nextCol);
      }
      this.updateVirtualRows(true);
      this.updateDirtyBadge();
      this.updateStats();
    }

    applyHistoryEntry(entry, reverse = false) {
      if (!entry || !entry.type) return;
      const payload = entry.payload || {};
      let shouldRecomputeFilters = false;
      if (entry.type === 'cell-edit') {
        const nextValue = reverse ? payload.before : payload.after;
        this.setRowFieldValueFromHistory(payload.recordId, payload.fieldCode, nextValue);
        shouldRecomputeFilters = true;
      } else if (entry.type === 'paste') {
        const changes = Array.isArray(payload.changes) ? payload.changes.slice() : [];
        if (reverse) changes.reverse();
        changes.forEach((change) => {
          const nextValue = reverse ? change.before : change.after;
          this.setRowFieldValueFromHistory(change.recordId, change.fieldCode, nextValue);
        });
        shouldRecomputeFilters = true;
      } else if (entry.type === 'add-row') {
        if (reverse) {
          this.removeHistoryAddRow(payload.row?.id);
        } else {
          this.restoreHistoryAddRow(payload.row, payload.index);
        }
      } else if (entry.type === 'toggle-delete') {
        const nextValue = reverse ? payload.before : payload.after;
        this.applyDeleteToggleState(payload.recordId, nextValue);
      } else if (entry.type === 'subtable-edit') {
        const nextValue = reverse ? payload.before : payload.after;
        this.setRowFieldValueFromHistory(payload.recordId, payload.fieldCode, nextValue);
        shouldRecomputeFilters = true;
      }
      if (shouldRecomputeFilters && this.hasActiveFilters()) {
        this.recomputeFilteredRowIds();
      }
    }

    undo() {
      if (!this.canMutateOverlay(true)) return;
      if (this.saving || !this.undoStack.length) return;
      const entry = this.undoStack.pop();
      this.isReplayingHistory = true;
      try {
        this.applyHistoryEntry(entry, true);
        this.redoStack.push(entry);
      } finally {
        this.isReplayingHistory = false;
      }
      this.updateHistoryButtons();
      this.updateVirtualRows(true);
      this.repaintSelection();
      this.updateDirtyBadge();
      this.updateStats();
    }

    redo() {
      if (!this.canMutateOverlay(true)) return;
      if (this.saving || !this.redoStack.length) return;
      const entry = this.redoStack.pop();
      this.isReplayingHistory = true;
      try {
        this.applyHistoryEntry(entry, false);
        this.undoStack.push(entry);
      } finally {
        this.isReplayingHistory = false;
      }
      this.updateHistoryButtons();
      this.updateVirtualRows(true);
      this.repaintSelection();
      this.updateDirtyBadge();
      this.updateStats();
    }

    syncScroll() {
      if (!this.bodyScroll) return;
      if (this.isDetailFormLayoutMode()) return;
      const scrollLeft = this.bodyScroll.scrollLeft;
      const scrollTop = this.bodyScroll.scrollTop;
      if (this.columnHeaderScroll) {
        const headRow = this.columnHeaderScroll.querySelector('.pb-overlay__col-row');
        if (headRow) {
          headRow.style.transform = `translateX(${-scrollLeft}px)`;
        }
      }
      if (this.rowHeaderScroll) {
        this.rowHeaderScroll.scrollTop = scrollTop;
      }
      this.updateVirtualRows();
    }

    focusFirstCell() {
      if (!this.getVisibleRowCount() || !this.fields.length) return;
      this.setSelectionSingle(0, 0);
      this.focusCell(0, 0);
    }

    findFirstEditableColIndex(recordId = '') {
      const index = this.fields.findIndex((field) => this.permissionService.canEditCell(recordId, field.code));
      return index >= 0 ? index : 0;
    }

    addNewRow() {
      if (!this.canMutateOverlay(true)) return;
      if (this.saving) return;
      if (!this.permissionService.canAddRow()) return;
      if (!this.fields.length) return;
      const tempId = `NEW:${Date.now()}:${this.newRowSeq++}`;
      const values = {};
      const original = {};
      this.fields.forEach((field) => {
        const base = this.isSubtableField(field) ? [] : '';
        values[field.code] = this.cloneFieldValue(field, base);
        original[field.code] = this.cloneFieldValue(field, base);
      });
      const row = {
        id: tempId,
        revision: undefined,
        values,
        original,
        isNew: true
      };
      this.rows.unshift(row);
      this.pushHistory({
        type: 'add-row',
        payload: {
          row: this.deepClone(row),
          index: 0
        }
      });
      this.rebuildRowMaps();
      this.recomputeFilteredRowIds();
      if (this.bodyScroll) {
        this.bodyScroll.scrollTop = 0;
      }
      this.updateVirtualRows(true);
      const colIndex = this.findFirstEditableColIndex(tempId);
      this.setSelectionSingle(0, colIndex);
      this.focusCell(0, colIndex);
      const targetInput = this.getInput(0, colIndex);
      if (targetInput) {
        this.enterEditMode(0, colIndex, targetInput, true);
      }
    }

    removeNewRowById(recordId) {
      const key = String(recordId || '').trim();
      if (!key || !this.isNewRowId(key)) return;
      const index = this.rows.findIndex((row) => String(row?.id || '').trim() === key);
      if (index < 0) return;
      if (this.editingCell && this.getVisibleRowAt(this.editingCell.rowIndex)?.id === key) {
        this.exitEditMode();
      }
      this.rows.splice(index, 1);
      this.pendingDeletes.delete(key);
      this.syncPermissionServicePendingDeletes();
      this.diff.delete(key);
      this.permissionService.removeRecordAcl(key);
      this.clearInvalidStateForRecord(key);
      this.rebuildRowMaps();
      this.recomputeFilteredRowIds();
      const visibleCount = this.getVisibleRowCount();
      if (!visibleCount) {
        this.selection = null;
        this.armedCell = null;
      } else if (this.selection) {
        const nextRow = Math.max(0, Math.min(visibleCount - 1, this.selection.startRow || 0));
        const nextCol = Math.max(0, Math.min(this.fields.length - 1, this.selection.startCol || 0));
        this.setSelectionSingle(nextRow, nextCol);
      }
      this.updateVirtualRows(true);
      this.updateDirtyBadge();
      this.updateStats();
    }

    togglePendingDelete(recordId) {
      if (!this.canMutateOverlay(true)) return;
      const key = String(recordId || '').trim();
      if (!key || this.saving) return;
      if (this.isNewRowId(key)) {
        this.removeNewRowById(key);
        return;
      }
      if (!this.permissionService.canDeleteRecord(key)) return;
      const before = this.pendingDeletes.has(key);
      if (this.pendingDeletes.has(key)) {
        this.pendingDeletes.delete(key);
      } else {
        this.pendingDeletes.add(key);
      }
      this.syncPermissionServicePendingDeletes();
      const after = this.pendingDeletes.has(key);
      if (before !== after) {
        this.pushHistory({
          type: 'toggle-delete',
          payload: {
            recordId: key,
            before,
            after
          }
        });
      }
      const editingRowId = this.editingCell ? this.getVisibleRowAt(this.editingCell.rowIndex)?.id : '';
      if (editingRowId && String(editingRowId) === key) {
        this.exitEditMode();
      }
      this.updateVirtualRows(true);
      this.updateDirtyBadge();
      this.updateStats();
    }

    handleOverlayKeydown(event) {
      if (!this.isOpen) return;
      const target = event.target;
      if (!this.root?.contains(target)) return;
      if (this.saving) {
        const keyLower = String(event.key || '').toLowerCase();
        if ((event.ctrlKey || event.metaKey) && keyLower === 's') {
          event.preventDefault();
          event.stopPropagation();
          event.stopImmediatePropagation();
        }
        return;
      }
      if (!this.isComposing && (event.ctrlKey || event.metaKey) && !event.altKey) {
        const key = String(event.key || '').toLowerCase();
        const wantsUndo = key === 'z' && !event.shiftKey;
        const wantsRedo = key === 'y' || (key === 'z' && event.shiftKey);
        if (wantsUndo || wantsRedo) {
          event.preventDefault();
          event.stopPropagation();
          event.stopImmediatePropagation();
          if (wantsUndo) {
            this.undo();
          } else {
            this.redo();
          }
          return;
        }
      }

      if (this.handleEscapeForFrontLayer(event)) {
        return;
      }

      if (this.columnPanelLayer && this.columnPanelLayer.contains(target)) {
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          event.stopImmediatePropagation();
          this.closeColumnManager();
        }
        return;
      }

      if (this.filterPanel?.panel && this.filterPanel.panel.contains(target)) {
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          event.stopImmediatePropagation();
          this.closeFilterPanel();
        }
        return;
      }
      if (this.filterPanel && event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        this.closeFilterPanel();
        return;
      }

      if (this.multilineEditor?.panel && this.multilineEditor.panel.contains(target)) {
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          event.stopImmediatePropagation();
          this.closeMultilineEditor(true);
        }
        return;
      }

      if (this.multiChoicePicker?.panel && this.multiChoicePicker.panel.contains(target)) {
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          event.stopImmediatePropagation();
          this.closeMultiChoicePicker(true);
        }
        return;
      }

      if (this.radioPicker?.panel && this.radioPicker.panel.contains(target)) {
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          event.stopImmediatePropagation();
          this.closeRadioPicker(true);
        } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
          event.preventDefault();
          event.stopPropagation();
          event.stopImmediatePropagation();
          const delta = event.key === 'ArrowUp' ? -1 : 1;
          this.moveRadioPickerFocus(delta, target);
        }
        return;
      }

      if (this.subtableEditor?.panel && this.subtableEditor.panel.contains(target)) {
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          event.stopImmediatePropagation();
          this.closeSubtableEditor(true);
        }
        return;
      }

      const targetInput = target instanceof HTMLInputElement ? target : null;
      const fieldCode = targetInput?.dataset.fieldCode || '';
      const field = fieldCode ? this.fieldMap.get(fieldCode) : null;
      const recordId = targetInput?.dataset.recordId || '';
      const isChoiceField = this.isChoiceField(field);
      const isMultiChoiceField = this.isMultiChoiceField(field);
      const isSubtableField = this.isSubtableField(field);
      const isEditableField = this.permissionService.canEditCell(recordId, fieldCode);
      const isSpaceKey = event.key === ' ' || event.key === 'Spacebar';
      const isArrowKey = event.key === 'ArrowUp'
        || event.key === 'ArrowDown'
        || event.key === 'ArrowLeft'
        || event.key === 'ArrowRight';

      if (this.handleOverlayArrowNavigation(event, targetInput instanceof HTMLInputElement ? targetInput : null)) {
        return;
      }

      if (targetInput && targetInput.readOnly && (event.key === 'Enter' || event.key === 'F2')) {
        if (event.key === 'Enter' && this.isComposing) return;
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        const rowIndex = Number(targetInput.dataset.rowIndex || '0');
        const colIndex = Number(targetInput.dataset.colIndex || '0');
        this.armedCell = { rowIndex, colIndex };
        this.enterEditMode(rowIndex, colIndex, targetInput, true);
        return;
      }

      if (targetInput && targetInput.readOnly && isSubtableField) {
        const wantsOpen = !event.ctrlKey && !event.metaKey && !event.altKey && (event.key === 'Enter' || isSpaceKey);
        if (wantsOpen) {
          event.preventDefault();
          event.stopPropagation();
          event.stopImmediatePropagation();
          const rowIndex = Number(targetInput.dataset.rowIndex || '0');
          const colIndex = Number(targetInput.dataset.colIndex || '0');
          this.openSubtableEditor(rowIndex, colIndex, targetInput);
          return;
        }
      }

      if (targetInput && targetInput.readOnly && isChoiceField && isEditableField) {
        const wantsDirectOpen = !event.ctrlKey && !event.metaKey && !event.altKey && (event.key === 'Enter' || isSpaceKey);
        if (wantsDirectOpen) {
          event.preventDefault();
          event.stopPropagation();
          event.stopImmediatePropagation();
          const rowIndex = Number(targetInput.dataset.rowIndex || '0');
          const colIndex = Number(targetInput.dataset.colIndex || '0');
          this.enterEditMode(rowIndex, colIndex, targetInput, false);
          return;
        }
      }

      if (targetInput && targetInput.readOnly && isMultiChoiceField && isEditableField) {
        const wantsDirectOpen = !event.ctrlKey && !event.metaKey && !event.altKey && (event.key === 'Enter' || isSpaceKey);
        if (wantsDirectOpen) {
          event.preventDefault();
          event.stopPropagation();
          event.stopImmediatePropagation();
          const rowIndex = Number(targetInput.dataset.rowIndex || '0');
          const colIndex = Number(targetInput.dataset.colIndex || '0');
          this.enterEditMode(rowIndex, colIndex, targetInput, false);
          return;
        }
      }

      if (targetInput && !targetInput.readOnly) {
        if (isChoiceField) {
          const wantsPicker = isSpaceKey && !event.ctrlKey && !event.metaKey && !event.altKey;
          if (wantsPicker) {
            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation();
            const rowIndex = Number(targetInput.dataset.rowIndex || '0');
            const colIndex = Number(targetInput.dataset.colIndex || '0');
            this.openRadioPicker(rowIndex, colIndex, targetInput);
            return;
          }
        }
        const keyLower = String(event.key || '').toLowerCase();
        if ((event.ctrlKey || event.metaKey) && keyLower === 'c') {
          return;
        }
        if ((event.ctrlKey || event.metaKey) && keyLower === 'v') {
          event.preventDefault();
          event.stopPropagation();
          event.stopImmediatePropagation();
          this.pasteClipboard();
          return;
        }
        if (isArrowKey) {
          // While editing, arrow keys should move the text caret, not cell focus.
          return;
        }
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          event.stopImmediatePropagation();
          this.exitEditMode();
          return;
        }
        if (event.key === 'Enter' || event.key === 'Tab') {
          if (event.key === 'Enter' && this.isComposing) return;
          event.preventDefault();
          event.stopPropagation();
          event.stopImmediatePropagation();
          const isTabKey = event.key === 'Tab';
          const rowDelta = isTabKey ? 0 : (event.shiftKey ? -1 : 1);
          const colDelta = isTabKey ? (event.shiftKey ? -1 : 1) : 0;
          this.moveEditingFocus(rowDelta, colDelta);
          return;
        }
        return;
      }

      const globalKeyLower = String(event.key || '').toLowerCase();
      if ((event.ctrlKey || event.metaKey) && globalKeyLower === 'c') {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        this.exitEditMode();
        this.copySelectionToClipboard();
        return;
      }
      if ((event.ctrlKey || event.metaKey) && globalKeyLower === 'v') {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        this.pasteClipboard();
        return;
      }

      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        this.tryClose();
        return;
      }

      if (!targetInput) {
        if ((event.key === 'Enter' || event.key === 'F2') && this.armedCell) {
          event.preventDefault();
          event.stopPropagation();
          event.stopImmediatePropagation();
          const { rowIndex, colIndex } = this.armedCell;
          const armedInput = this.getInput(rowIndex, colIndex);
          if (armedInput) {
            this.enterEditMode(rowIndex, colIndex, armedInput, true);
          }
          return;
        }
        if (event.key === 's' && (event.ctrlKey || event.metaKey)) {
          event.preventDefault();
          event.stopPropagation();
          event.stopImmediatePropagation();
          this.save();
        }
        return;
      }
      if (event.key === 'Enter' && !event.ctrlKey && !event.metaKey) {
        if (this.isComposing) return;
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        const delta = event.shiftKey ? -1 : 1;
        this.exitEditMode();
        const coords = this.moveFocus(targetInput, delta, 0);
        if (coords) {
          this.setSelectionSingle(coords.row, coords.col);
        }
        return;
      }
      if (event.key === 'Tab') {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        const delta = event.shiftKey ? -1 : 1;
        this.exitEditMode();
        const coords = this.moveFocus(targetInput, 0, delta);
        if (coords) {
          this.setSelectionSingle(coords.row, coords.col);
        }
        return;
      }
      if (event.key === 's' && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        this.save();
        return;
      }
    }

    handleEscapeForFrontLayer(event) {
      if (!event || event.key !== 'Escape') return false;
      // Close only the front-most transient UI and stop bubbling to overlay close.
      if (this.columnPanelLayer) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        this.closeColumnManager();
        return true;
      }
      if (this.filterPanel?.panel) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        this.closeFilterPanel();
        return true;
      }
      if (this.multilineEditor?.panel) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        this.closeMultilineEditor(true);
        return true;
      }
      if (this.multiChoicePicker?.panel) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        this.closeMultiChoicePicker(true);
        return true;
      }
      if (this.radioPicker?.panel) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        this.closeRadioPicker(true);
        return true;
      }
      if (this.subtableEditor?.panel) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        this.closeSubtableEditor(true);
        return true;
      }
      return false;
    }

    isOverlayArrowKey(event) {
      const key = String(event?.key || '');
      return key === 'ArrowUp'
        || key === 'ArrowDown'
        || key === 'ArrowLeft'
        || key === 'ArrowRight';
    }

    isFocusInsideOverlay(target = null) {
      if (!this.root) return false;
      const active = document.activeElement;
      if (active && this.root.contains(active)) return true;
      if (target instanceof Node && this.root.contains(target)) return true;
      if (
        this.selection
        && (target === document.body || target === document.documentElement || target === document)
      ) {
        return true;
      }
      return false;
    }

    handleOverlayGlobalArrowKeydown(event) {
      if (!this.isOpen) return;
      if (event.defaultPrevented) return;
      const input = event.target instanceof HTMLInputElement ? event.target : null;
      this.handleOverlayArrowNavigation(event, input);
    }

    handleOverlayArrowNavigation(event, input = null) {
      if (!this.isOpen) return false;
      if (!this.isOverlayArrowKey(event)) return false;
      if (!this.isFocusInsideOverlay(event.target)) return false;
      if (this.shouldUseNativeArrowNavigation(input, event.target)) return false;

      const target = event.target;
      if (this.columnPanelLayer && this.columnPanelLayer.contains(target)) return false;
      if (this.filterPanel?.panel && this.filterPanel.panel.contains(target)) return false;
      if (this.subtableEditor?.panel && this.subtableEditor.panel.contains(target)) return false;
      if (this.multilineEditor?.panel && this.multilineEditor.panel.contains(target)) return false;
      if (this.multiChoicePicker?.panel && this.multiChoicePicker.panel.contains(target)) return false;
      if (this.radioPicker?.panel && this.radioPicker.panel.contains(target)) return false;
      if (this.editingCell) return false;

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();

      const delta = this.getArrowDelta(event.key);
      if (!delta) return true;
      const origin = this.getNavigationOrigin(input);
      if (!origin) return true;
      const next = this.computeNextCoords(origin.row, origin.col, delta.rowDelta, delta.colDelta);
      if (!next) return true;
      if (event.shiftKey && !this.selection) {
        this.selection = {
          anchorRow: origin.row,
          anchorCol: origin.col,
          startRow: origin.row,
          endRow: origin.row,
          startCol: origin.col,
          endCol: origin.col
        };
      }
      this.setSelection(next.row, next.col, { extend: event.shiftKey, focus: true });
      return true;
    }

    shouldUseNativeArrowNavigation(input, target) {
      const isEditableInput = (node) => {
        if (!node) return false;
        if (node instanceof HTMLInputElement) {
          return !node.readOnly && !node.disabled;
        }
        if (node instanceof HTMLTextAreaElement) {
          return !node.readOnly && !node.disabled;
        }
        if (node instanceof HTMLElement && node.isContentEditable) {
          return true;
        }
        return false;
      };

      if (isEditableInput(input)) return true;
      const active = document.activeElement;
      if (active && this.root?.contains(active) && isEditableInput(active)) return true;

      if (target instanceof HTMLElement && this.root?.contains(target)) {
        const editableHost = target.closest('textarea,input,[contenteditable="true"]');
        if (editableHost && isEditableInput(editableHost)) {
          return true;
        }
      }
      return false;
    }

    computeNextCoords(rowIndex, colIndex, rowDelta, colDelta) {
      let nextRow = rowIndex + rowDelta;
      let nextCol = colIndex + colDelta;

      const rowCount = this.getVisibleRowCount();
      const colCount = this.fields.length;
      if (!rowCount || !colCount) return null;

      if (rowDelta !== 0 && colDelta === 0) {
        if (nextRow < 0) nextRow = 0;
        if (nextRow >= rowCount) nextRow = rowCount - 1;
      }
      if (colDelta !== 0 && rowDelta === 0) {
        if (nextCol < 0) {
          nextCol = colCount - 1;
          nextRow = Math.max(0, rowIndex - 1);
        } else if (nextCol >= colCount) {
          nextCol = 0;
          nextRow = Math.min(rowCount - 1, rowIndex + 1);
        }
      }

      nextRow = Math.max(0, Math.min(rowCount - 1, nextRow));
      nextCol = Math.max(0, Math.min(colCount - 1, nextCol));
      return { row: nextRow, col: nextCol };
    }

    moveEditingFocus(rowDelta, colDelta) {
      const active = document.activeElement;
      if (!(active instanceof HTMLInputElement)) return;
      this.onInputChanged(active);
      const prevRow = Number(active.dataset.rowIndex || '0');
      const prevCol = Number(active.dataset.colIndex || '0');
      const previousEditingCell = this.editingCell
        ? {
          ...this.editingCell,
          beforeValue: this.deepClone(this.editingCell.beforeValue)
        }
        : null;
      const next = this.computeNextCoords(prevRow, prevCol, rowDelta, colDelta);
      if (!next) return;
      const prevInput = this.getInput(prevRow, prevCol) || active;
      this.setInputEditingVisual(prevInput, false);
      this.commitCellEditHistory(previousEditingCell);
      this.editingCell = this.createEditingState(next.row, next.col, false);
      const nextInput = this.getInput(next.row, next.col);
      this.setInputEditingVisual(nextInput, true);
      this.setSelectionSingle(next.row, next.col);
      this.pendingEdit = { rowIndex: next.row, colIndex: next.col };
      this.armedCell = { rowIndex: next.row, colIndex: next.col };
      this.repaintSelection();
      this.navigating = true;
      try {
        this.focusCell(next.row, next.col);
      } finally {
        setTimeout(() => {
          this.navigating = false;
        }, 0);
      }
    }

    moveFocus(currentInput, rowDelta, colDelta) {
      const rowIndex = Number(currentInput.dataset.rowIndex || '0');
      const colIndex = Number(currentInput.dataset.colIndex || '0');
      const next = this.computeNextCoords(rowIndex, colIndex, rowDelta, colDelta);
      if (!next) return null;
      const { row: nextRow, col: nextCol } = next;
      this.focusCell(nextRow, nextCol);
      return { row: nextRow, col: nextCol };
    }

    getArrowDelta(key) {
      if (key === 'ArrowUp') return { rowDelta: -1, colDelta: 0 };
      if (key === 'ArrowDown') return { rowDelta: 1, colDelta: 0 };
      if (key === 'ArrowLeft') return { rowDelta: 0, colDelta: -1 };
      if (key === 'ArrowRight') return { rowDelta: 0, colDelta: 1 };
      return null;
    }

    getNavigationOrigin(input = null) {
      if (input instanceof HTMLInputElement) {
        const row = Number(input.dataset.rowIndex || '0');
        const col = Number(input.dataset.colIndex || '0');
        if (Number.isFinite(row) && Number.isFinite(col)) {
          return { row, col };
        }
      }
      if (this.editingCell) {
        return { row: this.editingCell.rowIndex, col: this.editingCell.colIndex };
      }
      if (this.armedCell) {
        return { row: this.armedCell.rowIndex, col: this.armedCell.colIndex };
      }
      if (this.selection) {
        return { row: this.selection.endRow, col: this.selection.endCol };
      }
      if (this.getVisibleRowCount() > 0 && this.fields.length > 0) {
        return { row: 0, col: 0 };
      }
      return null;
    }

    navigateSelectionByArrow(key, extend = false, input = null) {
      const delta = this.getArrowDelta(key);
      if (!delta) return null;
      const origin = this.getNavigationOrigin(input);
      if (!origin) return null;
      const next = this.computeNextCoords(origin.row, origin.col, delta.rowDelta, delta.colDelta);
      if (!next) return null;

      if (this.editingCell) {
        this.exitEditMode();
      }

      this.setSelection(next.row, next.col, { extend, focus: true });
      return next;
    }

    hasUnsavedChanges() {
      if (this.pendingDeletes.size > 0) return true;
      if (this.rows.some((row) => this.isNewRowId(row?.id))) return true;
      let has = false;
      this.diff.forEach((entry) => {
        if (Object.keys(entry).length) has = true;
      });
      return has;
    }

    isConflictResponse(response) {
      if (!response) return false;
      const status = Number(response.status || 0);
      if (status === 409 || status === 412) return true;
      const code = String(response.errorCode || '');
      return code === 'GAIA_CO02' || code === 'GAIA_CO03' || code === 'CB_WA01';
    }

    isNewRowId(recordId) {
      return String(recordId || '').startsWith('NEW:');
    }

    toRecordPayloadValue(field, value) {
      if (this.isSubtableField(field)) {
        const rows = Array.isArray(value) ? value : [];
        return rows.map((row) => ({
          id: row?.id ? String(row.id) : undefined,
          value: row && typeof row.value === 'object' ? JSON.parse(JSON.stringify(row.value)) : {}
        })).map((row) => {
          if (!row.id) delete row.id;
          return row;
        });
      }
      if (this.isMultiValueField(field)) {
        return this.normalizeMultiValue(value, field);
      }
      return value ?? '';
    }

    buildRecordPayload(recordId) {
      const fields = this.diff.get(recordId);
      if (!fields) return null;
      const record = {};
      Object.keys(fields).forEach((fieldCode) => {
        const field = this.getFieldDefinition(fieldCode);
        if (!field) return;
        const item = fields[fieldCode];
        if (!item) return;
        if (item.type === 'SUBTABLE') {
          record[fieldCode] = {
            value: this.toRecordPayloadValue(field, item.value)
          };
          return;
        }
        if (!this.permissionService.canEditCell(recordId, fieldCode)) return;
        record[fieldCode] = { value: this.toRecordPayloadValue(field, item.value) };
      });
      return Object.keys(record).length ? record : null;
    }

    createPutBatches() {
      const entries = [];
      Array.from(this.diff.keys()).forEach((recordId) => {
        if (this.isNewRowId(recordId)) return;
        if (this.pendingDeletes.has(recordId)) return;
        const record = this.buildRecordPayload(recordId);
        if (!record) return;
        const revision = this.revisionMap.get(recordId);
        const item = { id: recordId, record };
        if (revision !== undefined) item.revision = revision;
        entries.push(item);
      });
      const batches = [];
      for (let i = 0; i < entries.length; i += 50) {
        batches.push(entries.slice(i, i + 50));
      }
      return batches;
    }

    createPostBatches() {
      const entries = [];
      Array.from(this.diff.keys()).forEach((recordId) => {
        if (!this.isNewRowId(recordId)) return;
        if (this.pendingDeletes.has(recordId)) return;
        const record = this.buildRecordPayload(recordId);
        if (!record) return;
        entries.push({ tempId: recordId, record });
      });
      const batches = [];
      for (let i = 0; i < entries.length; i += 50) {
        batches.push(entries.slice(i, i + 50));
      }
      return batches;
    }

    createDeleteBatches() {
      const ids = Array.from(this.pendingDeletes).filter((id) => !this.isNewRowId(id));
      const batches = [];
      for (let i = 0; i < ids.length; i += 50) {
        batches.push(ids.slice(i, i + 50));
      }
      return batches;
    }

    isRequiredCheckTargetField(field) {
      if (!field || !field.required) return false;
      if (this.isSubtableField(field)) return false;
      return this.permissionService.canEditCell('NEW:required-check', String(field.code || ''));
    }

    isMissingRequiredValue(field, value) {
      if (!this.isRequiredCheckTargetField(field)) return false;
      if (field.type === 'NUMBER') {
        return String(value ?? '').trim() === '';
      }
      return String(value ?? '').trim() === '';
    }

    hasRequiredMissingInInvalidSet() {
      for (const key of this.invalidCells) {
        const sep = key.lastIndexOf(':');
        if (sep <= 0) continue;
        const recordId = key.slice(0, sep);
        const fieldCode = key.slice(sep + 1);
        if (!this.isNewRowId(recordId)) continue;
        const field = this.fieldMap.get(fieldCode);
        const row = this.rowMap.get(recordId);
        if (!field || !row) continue;
        if (this.isMissingRequiredValue(field, row.values[fieldCode])) {
          return true;
        }
      }
      return false;
    }

    validateRequiredForNewRows(postBatches) {
      if (!Array.isArray(postBatches) || !postBatches.length) return true;
      const ids = Array.from(new Set(
        postBatches.flatMap((batch) => (Array.isArray(batch) ? batch.map((entry) => String(entry?.tempId || '')) : []))
      )).filter(Boolean);
      if (!ids.length) return true;

      let firstErrorCell = null;
      let hasMissing = false;
      ids.forEach((recordId) => {
        const row = this.rowMap.get(recordId);
        if (!row) return;
        this.fields.forEach((field) => {
          if (!this.isRequiredCheckTargetField(field)) return;
          const key = `${recordId}:${field.code}`;
          const missing = this.isMissingRequiredValue(field, row.values[field.code]);
          const input = this.findInput(recordId, field.code);
          if (missing) {
            hasMissing = true;
            this.invalidCells.add(key);
            this.invalidValueCache.delete(key);
            if (input?.parentElement) {
              input.parentElement.classList.add('pb-overlay__cell--error');
              input.parentElement.dataset.errorReason = 'required';
            }
            if (!firstErrorCell) {
              const rowIndex = this.getVisibleRowIndexById(recordId);
              const colIndex = this.fieldIndexMap.get(field.code);
              if (rowIndex >= 0 && colIndex !== undefined) {
                firstErrorCell = { rowIndex, colIndex };
              }
            }
          } else {
            this.invalidCells.delete(key);
            this.invalidValueCache.delete(key);
            if (input?.parentElement) {
              input.parentElement.classList.remove('pb-overlay__cell--error');
              if (input.parentElement.dataset.errorReason === 'required') {
                delete input.parentElement.dataset.errorReason;
              }
            }
          }
        });
      });

      if (!hasMissing) return true;
      this.updateVirtualRows(true);
      this.updateDirtyBadge();
      this.updateStats();
      this.notify(resolveText(this.language, 'toastRequiredMissing'));
      if (firstErrorCell) {
        this.setSelectionSingle(firstErrorCell.rowIndex, firstErrorCell.colIndex);
        this.focusCell(firstErrorCell.rowIndex, firstErrorCell.colIndex);
      }
      return false;
    }

    markBatchError(batch) {
      if (!Array.isArray(batch)) return;
      batch.forEach((entry) => {
        const rowId = String(entry?.id || entry?.tempId || '');
        if (!rowId) return;
        const row = this.rowMap.get(rowId);
        if (!row) return;
        this.fields.forEach((field) => {
          const input = this.findInput(rowId, field.code);
          if (!input || !input.parentElement) return;
          input.parentElement.classList.add('pb-overlay__cell--error');
        });
      });
    }

    setSaving(flag) {
      const saving = Boolean(flag);
      this.saving = saving;

      if (saving) {
        this.exitEditMode();
        this.closeRadioPicker();
      }

      if (this.saveButton) {
        this.saveButton.disabled = saving;
        this.saveButton.classList.toggle('is-saving', saving);
      }
      this.updatePermissionUiState();
      if (this.closeButton) this.closeButton.disabled = saving;
      if (this.columnButton) {
        this.columnButton.disabled = saving || !this.fields.length;
      }
      if (this.layoutPresetSelect) {
        this.layoutPresetSelect.disabled = saving || !this.overlayLayoutState || this.overlayLayoutState.presets.length <= 1;
      }
      if (this.layoutPresetMenuButton) this.layoutPresetMenuButton.disabled = saving;
      if (this.layoutPresetSaveButton) this.layoutPresetSaveButton.disabled = saving;
      if (this.layoutPresetDuplicateButton) {
        this.layoutPresetDuplicateButton.disabled = saving || !this.overlayLayoutState || this.overlayLayoutState.presets.length >= MAX_LAYOUT_PRESET_COUNT;
      }
      if (this.layoutPresetRenameButton) this.layoutPresetRenameButton.disabled = saving;
      if (this.layoutPresetDeleteButton) {
        this.layoutPresetDeleteButton.disabled = saving || !this.overlayLayoutState || this.overlayLayoutState.presets.length <= 1;
      }
      if (saving) this.closeLayoutPresetMenu();
      if (this.gridLayoutButton) {
        this.gridLayoutButton.disabled = saving;
      }
      if (this.formLayoutButton) {
        this.formLayoutButton.disabled = saving;
      }
      this.updateHistoryButtons();

      if (this.saveButtonLabel) {
        this.saveButtonLabel.textContent = resolveText(this.language, saving ? 'btnSaving' : 'btnSave');
      }
      if (this.saveButtonSpinner) {
        this.saveButtonSpinner.classList.toggle('pb-overlay__spinner--hidden', !saving);
      }

      this.inputsByRow.forEach((inputs) => {
        inputs.forEach((input) => {
          if (!input) return;
          input.disabled = saving;
          if (saving) input.readOnly = true;
        });
      });

      if (!saving) {
        this.updateVirtualRows(true);
        this.updateDirtyBadge();
      }
    }

    getRefetchFieldCodes() {
      const codes = new Set(this.getRecordFetchFieldCodes());
      this.fieldsMeta.forEach((field) => {
        if (!field || field.type !== 'SUBTABLE') return;
        const code = String(field.code || '').trim();
        if (code) codes.add(code);
      });
      return Array.from(codes);
    }

    async refetchRowsByIds(ids) {
      const uniqueIds = Array.from(new Set(
        (ids || [])
          .map((id) => String(id || '').trim())
          .filter((id) => id && !this.isNewRowId(id))
      ));
      if (!uniqueIds.length || !this.appId) return;

      const fields = this.getRefetchFieldCodes();
      const fetchedIds = new Set();
      const chunkSize = 100;

      for (let i = 0; i < uniqueIds.length; i += chunkSize) {
        const chunk = uniqueIds.slice(i, i + chunkSize);
        const response = await this.postFn('EXCEL_GET_RECORDS_BY_IDS', {
          appId: this.appId,
          ids: chunk,
          fields,
          __pbTrigger: 'save_refetch'
        });
        if (!response?.ok) {
          console.warn('[kintone-excel-overlay] refetchRowsByIds failed', {
            ids: chunk,
            error: response?.error || 'unknown error'
          });
          continue;
        }
        const records = Array.isArray(response.records) ? response.records : [];
        records.forEach((record) => {
          const id = String(record?.$id?.value || '').trim();
          if (id) fetchedIds.add(id);
          this.refreshRowFromRemote(record);
        });
      }

      const missingIds = uniqueIds.filter((id) => !fetchedIds.has(id));
      if (missingIds.length) {
        console.warn('[kintone-excel-overlay] refetchRowsByIds returned partial records', { missingIds });
      }
    }

    async save() {
      if (!this.canMutateOverlay(true)) return;
      if (this.saving) return;
      if (this.invalidCells.size > 0) {
        const key = this.hasRequiredMissingInInvalidSet() ? 'toastRequiredMissing' : 'toastInvalidCells';
        this.notify(resolveText(this.language, key));
        return;
      }
      let putBatches = this.createPutBatches();
      let postBatches = this.createPostBatches();
      let deleteBatches = this.createDeleteBatches();
      if (!putBatches.length && !postBatches.length && !deleteBatches.length) {
        this.notify(resolveText(this.language, 'toastNoChanges'));
        return;
      }
      if (!this.validateRequiredForNewRows(postBatches)) {
        return;
      }
      this.setSaving(true);
      let anySaved = false;
      const savedIds = new Set();
      try {
        for (let index = 0; index < putBatches.length;) {
          let batch = putBatches[index];
          let attempt = 0;
          while (attempt < 2) {
            attempt += 1;
            const response = await this.postFn('EXCEL_PUT_RECORDS', {
              appId: this.appId,
              records: batch,
              __pbTrigger: 'save_click'
            });
            if (response?.ok) {
              this.applySaveResult(batch, response.result);
              batch.forEach((entry) => {
                const id = String(entry?.id || '').trim();
                if (id) savedIds.add(id);
              });
              anySaved = true;
              break;
            }
            if (attempt === 1 && this.isConflictResponse(response)) {
              const handling = await this.handleConflict(batch);
              if (handling === 'retry') {
                this.notify(resolveText(this.language, 'conflictRetry'));
                putBatches = this.createPutBatches();
                postBatches = this.createPostBatches();
                deleteBatches = this.createDeleteBatches();
                if (!putBatches.length && !postBatches.length && !deleteBatches.length) {
                  this.updateDirtyBadge();
                  this.updateStats();
                  this.notify(resolveText(this.language, 'conflictNoChanges'));
                  return;
                }
                index = 0;
                batch = putBatches[index];
                attempt = 0;
                continue;
              }
              if (handling === 'cleared') {
                this.updateDirtyBadge();
                this.updateStats();
                this.notify(resolveText(this.language, 'conflictNoChanges'));
                return;
              }
            }
            const err = new Error(response?.error || 'save failed');
            this.markBatchError(batch);
            if (this.isConflictResponse(response)) {
              err.conflict = true;
            }
            throw err;
          }
          index += 1;
        }
        for (const batch of postBatches) {
          const response = await this.postFn('EXCEL_POST_RECORDS', {
            appId: this.appId,
            records: batch.map((entry) => ({ ...entry.record })),
            __pbTrigger: 'save_click'
          });
          if (!response?.ok) {
            this.markBatchError(batch);
            throw new Error(response?.error || 'create failed');
          }
          const createdIds = this.applyCreateResult(batch, response.result);
          createdIds.forEach((id) => {
            const normalized = String(id || '').trim();
            if (normalized) savedIds.add(normalized);
          });
          anySaved = true;
        }
        for (const batch of deleteBatches) {
          const response = await this.postFn('EXCEL_DELETE_RECORDS', {
            appId: this.appId,
            ids: batch,
            __pbTrigger: 'save_click'
          });
          if (!response?.ok) {
            throw new Error(response?.error || 'delete failed');
          }
          this.applyDeleteResult(batch);
          anySaved = true;
        }
        if (anySaved) {
          if (this.isListMode()) {
            try {
              await this.refreshListRowsAfterSave();
            } catch (error) {
              console.warn('[kintone-excel-overlay] failed to refresh list rows after save', error);
            }
          } else if (savedIds.size) {
            await this.refetchRowsByIds(Array.from(savedIds));
          }
          this.notify(resolveText(this.language, 'toastSaveSuccess'));
          this.diff.clear();
          this.pendingDeletes.clear();
          this.syncPermissionServicePendingDeletes();
          this.clearHistory();
          this.updateDirtyBadge();
          this.updateStats();
          this.requireReload = false;
        }
      } catch (error) {
        const key = error?.conflict ? 'conflictFailed' : 'toastSaveFailed';
        this.notify(resolveText(this.language, key));
        console.error('[kintone-excel-overlay] save failed', error);
      } finally {
        this.setSaving(false);
      }
    }

    applySaveResult(batch, result) {
      const records = result?.records;
      const revisionById = new Map();
      if (Array.isArray(records)) {
        records.forEach((item, index) => {
          const id = item?.id || batch[index]?.id;
          if (id && item?.revision !== undefined) {
            revisionById.set(String(id), String(item.revision));
          }
        });
      }
      batch.forEach((entry) => {
        const row = this.rowMap.get(entry.id);
        if (!row) return;
        Object.keys(entry.record).forEach((fieldCode) => {
          const field = this.getFieldDefinition(fieldCode);
          const value = this.cloneFieldValue(field, entry.record[fieldCode].value);
          row.original[fieldCode] = this.cloneFieldValue(field, value);
          row.values[fieldCode] = this.cloneFieldValue(field, value);
          const input = this.findInput(entry.id, fieldCode);
          if (input) {
            input.dataset.originalValue = this.formatCellDisplayValue(field, row.original[fieldCode]);
            input.value = this.formatCellDisplayValue(field, row.values[fieldCode]);
            this.applyCellVisualState(input, row, fieldCode);
          }
        });
        const newRevision = revisionById.get(entry.id);
        if (newRevision) {
          row.revision = newRevision;
          this.revisionMap.set(entry.id, newRevision);
        }
        this.diff.delete(entry.id);
        this.clearInvalidStateForRecord(entry.id);
      });
    }

    applyCreateResult(batch, result) {
      const ids = Array.isArray(result?.ids) ? result.ids : [];
      const revisions = Array.isArray(result?.revisions) ? result.revisions : [];
      const createdIds = [];
      batch.forEach((entry, index) => {
        const tempId = entry.tempId;
        const newId = ids[index] != null ? String(ids[index]) : '';
        if (!tempId || !newId) return;
        createdIds.push(newId);
        const row = this.rowMap.get(tempId);
        if (!row) return;
        const newRevision = revisions[index] != null ? String(revisions[index]) : undefined;
        Object.keys(entry.record || {}).forEach((fieldCode) => {
          const field = this.getFieldDefinition(fieldCode);
          const value = this.cloneFieldValue(field, entry.record[fieldCode]?.value);
          row.original[fieldCode] = this.cloneFieldValue(field, value);
          row.values[fieldCode] = this.cloneFieldValue(field, value);
        });
        row.id = newId;
        row.isNew = false;
        if (newRevision !== undefined) row.revision = newRevision;

        const rowIndex = this.rowIndexMap.get(tempId);
        this.rowMap.delete(tempId);
        this.rowMap.set(newId, row);
        if (rowIndex !== undefined) {
          this.rowIndexMap.delete(tempId);
          this.rowIndexMap.set(newId, rowIndex);
        }
        this.revisionMap.delete(tempId);
        if (newRevision !== undefined) this.revisionMap.set(newId, newRevision);
        this.diff.delete(tempId);
        this.clearInvalidStateForRecord(tempId);
        this.permissionService.removeRecordAcl(tempId);
        this.permissionService.upsertRecordAcl({
          id: newId,
          record: { viewable: true, editable: true, deletable: true },
          fields: {}
        });

        this.fields.forEach((field) => {
          const input = this.findInput(newId, field.code);
          if (!input) return;
          input.dataset.recordId = newId;
          input.dataset.originalValue = this.formatCellDisplayValue(field, row.original[field.code]);
          this.applyCellVisualState(input, row, field.code);
        });
      });
      this.recomputeFilteredRowIds();
      this.updateVirtualRows(true);
      return createdIds;
    }

    applyDeleteResult(ids) {
      const deleteIds = new Set(
        (ids || [])
          .map((id) => String(id || '').trim())
          .filter((id) => id && !this.isNewRowId(id))
      );
      if (!deleteIds.size) return;

      if (this.editingCell) {
        const editingRowId = String(this.getVisibleRowAt(this.editingCell.rowIndex)?.id || '').trim();
        if (editingRowId && deleteIds.has(editingRowId)) {
          this.exitEditMode();
        }
      }

      this.rows = this.rows.filter((row) => !deleteIds.has(String(row?.id || '').trim()));
      deleteIds.forEach((id) => {
        this.pendingDeletes.delete(id);
        this.diff.delete(id);
        this.rowMap.delete(id);
        this.rowIndexMap.delete(id);
        this.revisionMap.delete(id);
        this.permissionService.removeRecordAcl(id);
        this.clearInvalidStateForRecord(id);
      });
      this.syncPermissionServicePendingDeletes();

      this.rebuildRowMaps();
      this.recomputeFilteredRowIds();
      const visibleCount = this.getVisibleRowCount();
      if (!visibleCount) {
        this.selection = null;
        this.armedCell = null;
      } else if (this.selection) {
        const nextRow = Math.max(0, Math.min(visibleCount - 1, this.selection.startRow || 0));
        const nextCol = Math.max(0, Math.min(this.fields.length - 1, this.selection.startCol || 0));
        this.setSelectionSingle(nextRow, nextCol);
      }
      this.updateVirtualRows(true);
    }

    tryClose() {
      if (this.hasUnsavedChanges()) {
        const ok = window.confirm(resolveText(this.language, 'confirmClose'));
        if (!ok) return;
      }
      this.close(true);
    }

    close(force = false) {
      if (!force && this.saving) return;
      this.isOpen = false;
      this.detachUiLanguageListener();
      this.closeColumnManager(true);
      this.closeFilterPanel();
      this.closeRadioPicker();
      this.closeMultiChoicePicker();
      this.closeMultilineEditor();
      this.closeSubtableEditor();
      if (this.requireReload) {
        this.requireReload = false;
        this.reloading = true;
        this.detachEvents();
        if (this.surface) {
          this.surface.classList.add('pb-overlay__surface--reloading');
        }
        this.showLoading(resolveText(this.language, 'reloading'));
        if (document.body) {
          document.body.style.overflow = this.bodyOverflowBackup || '';
        }
        this.bodyOverflowBackup = '';
        this.previousFocus = null;
        setTimeout(() => {
          try {
            window.location.reload();
          } catch (_e) {
            window.location.href = window.location.href;
          }
        }, 50);
        return;
      }
      this.detachEvents();
      if (this.root) {
        this.root.remove();
      }
      this.root = null;
      this.surface = null;
      this.bodyScroll = null;
      this.columnHeaderScroll = null;
      this.rowHeaderScroll = null;
      this.toastHost = null;
      this.loadingEl = null;
      this.permissionWarningEl = null;
      this.dirtyBadge = null;
      this.saveButton = null;
      this.saveButtonSpinner = null;
      this.saveButtonLabel = null;
      this.addRowButton = null;
      this.undoButton = null;
      this.redoButton = null;
      this.layoutToggleWrap = null;
      this.gridLayoutButton = null;
      this.formLayoutButton = null;
      this.fieldScopeToggleWrap = null;
      this.fieldScopeViewButton = null;
      this.fieldScopeAllButton = null;
      this.layoutPresetWrap = null;
      this.layoutPresetLabel = null;
      this.layoutPresetSelect = null;
      this.layoutPresetMenuButton = null;
      this.layoutPresetMenu = null;
      this.layoutPresetMenuOpen = false;
      this.layoutPresetSaveButton = null;
      this.layoutPresetDuplicateButton = null;
      this.layoutPresetRenameButton = null;
      this.layoutPresetDeleteButton = null;
      this.prevPageButton = null;
      this.nextPageButton = null;
      this.pageLabelElement = null;
      this.closeButton = null;
      this.titleElement = null;
      this.modeBadge = null;
      this.appName = '';
      this.baseQuery = '';
      this.query = '';
      this.runtimeMode = OVERLAY_RUNTIME_MODE_LIST;
      this.overlayLayoutMode = OVERLAY_LAYOUT_MODE_GRID;
      this.listFieldScopeMode = LIST_FIELD_SCOPE_ALL_FIELDS;
      this.detailRecordId = '';
      this.detailAppId = '';
      this.detailSourceUrl = '';
      this.pageOffset = 0;
      this.totalCount = 0;
      this.paging = false;
      this.statsElements = {
        sum: null,
        avg: null,
        count: null,
        selected: null,
        filtered: null,
        pendingDelete: null,
        newRows: null
      };
      this.fields = [];
      this.fieldsMeta = [];
      this.listAllFields = [];
      this.viewFieldOrder = [];
      this.overlayLayoutState = null;
      this.recordFetchFieldCodes = [];
      this.fieldMap.clear();
      this.fieldsMetaMap.clear();
      this.fieldIndexMap.clear();
      this.rows = [];
      this.rowMap.clear();
      this.rowIndexMap.clear();
      this.permissionService.clearRecordAcl();
      this.aclStatus = { loaded: false, failed: false };
      this.pendingDeletes.clear();
      this.syncPermissionServicePendingDeletes();
      this.filters.clear();
      this.filteredRowIds = null;
      this.filterPanel = null;
      this.syncPermissionServiceFields();
      this.permissionService.setAppPermission({
        editable: true,
        addable: true,
        deletable: true,
        source: 'local'
      });
      this.inputsByRow.clear();
      this.diff.clear();
      this.undoStack = [];
      this.redoStack = [];
      this.isReplayingHistory = false;
      this.invalidCells.clear();
      this.revisionMap.clear();
      this.invalidValueCache.clear();
      this.rowHeaderContainer = null;
      this.tableContainer = null;
      this.gridRoot = null;
      this.gridHead = null;
      this.gridBody = null;
      this.detailFormContainer = null;
      this.virtualStart = 0;
      this.virtualEnd = 0;
      this.pendingFocus = null;
      this.pendingEdit = null;
      this.pasteFlashTimer = null;
      this.multiChoicePicker = null;
      this.multilineEditor = null;
      this.needsFilterReapply = false;
      this.sortState = { fieldCode: '', direction: '' };
      this.editingCell = null;
      this.columnVisibilityDraft = new Set();
      this.columnDraftAllFieldCodes = [];
      this.columnVisibilityList = null;
      this.viewOnlyNoticeShown = false;
      this.selection = null;
      this.armedCell = null;
      this.navigating = false;
      this.dragSelecting = false;
      if (document.body) {
        document.body.style.overflow = this.bodyOverflowBackup || '';
      }
      this.bodyOverflowBackup = '';
      if (this.previousFocus && document.contains(this.previousFocus)) {
        const target = this.previousFocus;
        setTimeout(() => {
          try {
            target.focus({ preventScroll: true });
          } catch (_e) { /* noop */ }
        }, 0);
      }
      this.previousFocus = null;
      if (this.requireReload) {
        setTimeout(() => {
          try {
            if (typeof window.kintone?.app?.getId === 'function') {
              window.location.reload();
            } else {
              window.location.reload();
            }
          } catch (_e) {
            window.location.reload();
          }
        }, 50);
      }
      this.requireReload = false;
    }

    showLoading(text) {
      if (!this.surface) return;
      if (!this.loadingEl) {
        const loader = document.createElement('div');
        loader.className = 'pb-overlay__loading';
        this.loadingEl = loader;
        this.surface.appendChild(loader);
      }
      this.loadingEl.textContent = text;
      this.loadingEl.classList.add('is-active');
    }

    hideLoading() {
      if (this.loadingEl) {
        this.loadingEl.classList.remove('is-active');
      }
    }

    notify(message) {
      if (!this.toastHost) return;
      const toast = document.createElement('div');
      toast.className = 'pb-overlay__toast';
      toast.textContent = message;
      this.toastHost.appendChild(toast);
      requestAnimationFrame(() => {
        toast.classList.add('is-visible');
      });
      const remove = () => {
        toast.classList.remove('is-visible');
        setTimeout(() => toast.remove(), 250);
      };
      let timer = setTimeout(remove, 2200);
      toast.addEventListener('mouseenter', () => {
        clearTimeout(timer);
      });
      toast.addEventListener('mouseleave', () => {
        timer = setTimeout(remove, 800);
      });
    }

    clearInvalidStateForRecord(recordId) {
      const prefix = `${recordId}:`;
      const toDelete = [];
      this.invalidCells.forEach((key) => {
        if (key.startsWith(prefix)) toDelete.push(key);
      });
      toDelete.forEach((key) => {
        this.invalidCells.delete(key);
        this.invalidValueCache.delete(key);
      });
    }

    refreshRowFromRemote(record) {
      const latest = this.transformRecord(record);
      if (!latest.id) return;
      let existing = this.rowMap.get(latest.id);
      if (!existing) {
        existing = latest;
        this.rows.push(existing);
        const newIndex = this.rows.length - 1;
        this.rowMap.set(latest.id, existing);
        this.rowIndexMap.set(latest.id, newIndex);
      } else {
        existing.original = latest.original;
        existing.values = { ...latest.values };
        existing.revision = latest.revision;
        const rowIndex = this.rowIndexMap.has(latest.id)
          ? this.rowIndexMap.get(latest.id)
          : this.rows.findIndex((r) => r.id === latest.id);
        if (rowIndex !== undefined && rowIndex >= 0) {
          this.rowIndexMap.set(latest.id, rowIndex);
        }
      }
      if (latest.revision !== undefined) {
        this.revisionMap.set(latest.id, latest.revision);
      }
      const diffEntry = this.diff.get(latest.id) || {};
      this.fields.forEach((field) => {
        const input = this.findInput(latest.id, field.code);
        const key = `${latest.id}:${field.code}`;
        this.invalidCells.delete(key);
        this.invalidValueCache.delete(key);
        if (!input) return;
        input.dataset.originalValue = this.formatCellDisplayValue(field, existing.original[field.code]);
        if (!diffEntry[field.code]) {
          input.value = this.formatCellDisplayValue(field, existing.values[field.code]);
        }
        this.applyCellVisualState(input, existing, field.code);
      });
      if (this.hasActiveFilters()) {
        this.recomputeFilteredRowIds();
      }
      this.updateVirtualRows(true);
    }

    reapplyDiffForRecord(recordId) {
      const entry = this.diff.get(recordId);
      if (!entry) return;
      const row = this.rowMap.get(recordId);
      if (!row) return;
      const pairs = Object.entries(entry);
      pairs.forEach(([fieldCode, info]) => {
        const input = this.findInput(recordId, fieldCode);
        if (!input) return;
        const field = this.fieldMap.get(fieldCode);
        if (this.isSubtableField(field)) {
          row.values[fieldCode] = this.cloneFieldValue(field, info.value);
          this.applyCellVisualState(input, row, fieldCode);
          return;
        }
        input.dataset.originalValue = this.formatCellDisplayValue(field, row.original[fieldCode]);
        input.value = this.formatCellDisplayValue(field, info.value ?? '');
        this.onInputChanged(input);
      });
    }

    async handleConflict(batch) {
      const ids = Array.from(new Set(batch.map((entry) => entry.id).filter(Boolean))).map(String);
      if (!ids.length) return 'fail';
      const fieldCodes = this.getRefetchFieldCodes();
      const response = await this.postFn('EXCEL_GET_RECORDS_BY_IDS', {
        appId: this.appId,
        ids,
        fields: fieldCodes,
        __pbTrigger: 'save_refetch'
      });
      if (!response?.ok) {
        return 'fail';
      }
      const records = Array.isArray(response.records) ? response.records : [];
      if (!records.length) return 'fail';
      records.forEach((record) => {
        this.refreshRowFromRemote(record);
      });
      ids.forEach((id) => {
        this.clearInvalidStateForRecord(id);
        this.reapplyDiffForRecord(id);
      });
      if (!this.diff.size) {
        return 'cleared';
      }
      return 'retry';
    }
  }

  function ensureOverlayControllerReady() {
    if (overlayController) return true;
    if (!isSupportedAppContextPage()) return false;
    const overlayPostToPage = (type, payload) => postToPage(type, payload, { feature: 'overlay' });
    overlayController = new ExcelOverlayController(overlayPostToPage);
    return true;
  }

  function attachOverlayShortcutListener() {
    if (overlayShortcutListenerAttached) return;
    document.addEventListener('keydown', (event) => {
      if (!overlayController || overlayController.isOpen) return;
      const key = String(event.key || '').toLowerCase();
      if (key !== 'e' || !event.shiftKey || (!event.ctrlKey && !event.metaKey)) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      void (async () => {
        const result = await openOverlayByCurrentPage('shortcut');
        if (!result?.ok && result?.message) {
          showOverlayLaunchNotice(result.message);
        }
      })();
    }, true);
    overlayShortcutListenerAttached = true;
  }

  // App-only features are initialized only inside supported app contexts.
  function initAppOnlyFeatures() {
    if (appOnlyFeaturesInitialized) return true;
    if (!isSupportedAppContextPage()) return false;
    attachDevContextCapture();
    startRecentRecordWatcher();
    if (!ensureOverlayControllerReady()) return false;
    attachOverlayShortcutListener();
    appOnlyFeaturesInitialized = true;
    return true;
  }

  function resolveOverlayLaunchContext(rawUrl) {
    const detailContext = parseDetailOverlayContext(rawUrl);
    if (detailContext?.recordId) {
      return {
        pageType: 'detail',
        runtimeMode: OVERLAY_RUNTIME_MODE_DETAIL_SINGLE_ROW,
        detailRecordId: detailContext.recordId,
        detailAppId: detailContext.appId,
        detailSourceUrl: detailContext.href || String(rawUrl || location.href)
      };
    }
    const listContext = parseListOverlayContext(rawUrl);
    if (listContext?.appId) {
      return {
        pageType: 'list',
        runtimeMode: OVERLAY_RUNTIME_MODE_LIST,
        detailRecordId: '',
        detailAppId: '',
        detailSourceUrl: String(rawUrl || location.href)
      };
    }
    return {
      pageType: 'unsupported',
      runtimeMode: null,
      detailRecordId: '',
      detailAppId: '',
      detailSourceUrl: String(rawUrl || location.href)
    };
  }

  async function getOverlayLaunchState() {
    const context = resolveOverlayLaunchContext(location.href);
    if (context.pageType === 'unsupported') {
      return {
        ok: true,
        pageType: 'unsupported',
        canEditOverlay: false,
        canSaveOverlay: false
      };
    }
    if (!(await waitForAppContextAndInit()) || !overlayController) {
      return {
        ok: true,
        reason: 'app_context_not_ready',
        pageType: context.pageType,
        canEditOverlay: false,
        canSaveOverlay: false
      };
    }
    await overlayController.loadOverlayMode();
    return {
      ok: true,
      pageType: context.pageType,
      canEditOverlay: overlayController.canEditOverlay(),
      canSaveOverlay: overlayController.canSaveOverlay()
    };
  }

  let overlayLaunchNoticeTimer = null;
  function showOverlayLaunchNotice(message) {
    const text = String(message || '').trim();
    if (!text) return;
    let node = document.getElementById('pb-overlay-launch-notice');
    if (!node) {
      node = document.createElement('div');
      node.id = 'pb-overlay-launch-notice';
      node.style.position = 'fixed';
      node.style.right = '24px';
      node.style.bottom = '24px';
      node.style.zIndex = '2147483647';
      node.style.padding = '8px 12px';
      node.style.borderRadius = '8px';
      node.style.border = '1px solid #d0d7e2';
      node.style.background = '#ffffff';
      node.style.color = '#2f3a4a';
      node.style.fontSize = '12px';
      node.style.boxShadow = '0 8px 24px rgba(15, 23, 42, 0.14)';
      document.body.appendChild(node);
    }
    node.textContent = text;
    node.style.display = 'block';
    if (overlayLaunchNoticeTimer) clearTimeout(overlayLaunchNoticeTimer);
    overlayLaunchNoticeTimer = setTimeout(() => {
      if (node) node.style.display = 'none';
    }, 2400);
  }

  async function openOverlayByCurrentPage(source = 'unknown') {
    const context = resolveOverlayLaunchContext(location.href);
    if (context.pageType === 'unsupported') {
      const uiLanguage = await resolveOverlayUiLanguage();
      const language = uiLanguage?.language || DEFAULT_OVERLAY_LANGUAGE;
      return {
        ok: false,
        reason: 'unsupported_page',
        source,
        pageType: context.pageType,
        message: resolveText(language, 'overlayUnsupportedPage')
      };
    }
    if (!(await waitForAppContextAndInit()) || !overlayController) {
      return { ok: false, reason: 'app_context_not_ready', source, pageType: context.pageType };
    }
    await overlayController.open({
      runtimeMode: context.runtimeMode,
      detailRecordId: context.detailRecordId,
      detailAppId: context.detailAppId,
      detailSourceUrl: context.detailSourceUrl
    });
    return {
      ok: overlayController.isOpen,
      reason: overlayController.isOpen ? 'opened' : 'open_failed',
      source,
      pageType: context.pageType,
      runtimeMode: context.runtimeMode,
      canEditOverlay: overlayController.canEditOverlay(),
      canSaveOverlay: overlayController.canSaveOverlay()
    };
  }

  spaLifecycleReady = true;
  handleSpaLifecycle('boot_ready', location.href);
  if (shouldRetryAppOnlyInitialization()) {
    void waitForAppContextAndInit();
  }

})();
