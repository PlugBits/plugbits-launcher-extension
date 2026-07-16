// content.js
// 1) page-bridge.js  2) popup/background  window.postMessage
//
// これは content.js の生成テンプレートです。ExcelOverlayController /
// CommandPalette / QuickNewRecordModal を編集するときは、対応する
// src/content-*.js を編集してから `npm run generate-content` を実行し、
// src/content.js を再生成してください(src/content.js は直接編集しないでください
// — 次にgenerate-contentを実行すると上書きされます)。
// それ以外のロジック(このファイルの本体部分)を編集する場合はこのファイルを
// 直接編集し、同じく `npm run generate-content` を実行してください。
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
    'overlay_file_upload',
    'lookup_candidates',
    'command_palette',
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

  function smartDateToYMD(raw) {
    const s = String(raw || '').trim().toLowerCase();
    if (!s) return null;
    // 末尾に誤って "t" を追加した場合 ("2026-05-23t" など) → 有効な日付なら剥ぎ取って返す
    if (s.length > 1 && s.endsWith('t')) {
      const candidate = s.slice(0, -1);
      if (/^\d{4}-\d{2}-\d{2}$/.test(candidate)) return candidate;
    }
    const today = new Date();
    const ymd = (d) => {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      return `${y}-${m}-${dd}`;
    };
    const shift = (d, n) => { const r = new Date(d); r.setDate(r.getDate() + n); return r; };

    // today / yesterday / tomorrow
    if (s === 't' || s === 'today') return ymd(today);
    if (s === 'yesterday') return ymd(shift(today, -1));
    if (s === 'tomorrow') return ymd(shift(today, 1));

    // relative days: +N / -N
    const plusMatch = s.match(/^\+(\d+)$/);
    if (plusMatch) return ymd(shift(today, Number(plusMatch[1])));
    const minusMatch = s.match(/^-(\d+)$/);
    if (minusMatch) return ymd(shift(today, -Number(minusMatch[1])));

    // end of month: end / end+N / end-N  (N = months offset)
    const endMatch = s.match(/^end([+-]\d+)?$/);
    if (endMatch) {
      const mo = endMatch[1] ? Number(endMatch[1]) : 0;
      return ymd(new Date(today.getFullYear(), today.getMonth() + mo + 1, 0));
    }

    // first of month: first / first+N / first-N  (N = months offset)
    const firstMatch = s.match(/^first([+-]\d+)?$/);
    if (firstMatch) {
      const mo = firstMatch[1] ? Number(firstMatch[1]) : 0;
      return ymd(new Date(today.getFullYear(), today.getMonth() + mo, 1));
    }

    // weekdays: 今週ベース  mon / tue+1(来週火) / fri-1(先週金)
    const WEEKDAYS = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
    const wdMatch = s.match(/^(sun|mon|tue|wed|thu|fri|sat)([+-]\d+)?$/);
    if (wdMatch) {
      const baseDiff = WEEKDAYS[wdMatch[1]] - today.getDay(); // 今週の該当曜日（負=過去）
      const weekOffset = wdMatch[2] ? Number(wdMatch[2]) : 0;
      return ymd(shift(today, baseDiff + weekOffset * 7));
    }

    // YYYYMMDD (8桁数字) → YYYY-MM-DD
    const compactMatch = s.match(/^(\d{4})(\d{2})(\d{2})$/);
    if (compactMatch) {
      const [, y, m, d] = compactMatch;
      const mn = Number(m), dn = Number(d);
      if (mn >= 1 && mn <= 12 && dn >= 1 && dn <= 31) return `${y}-${m}-${d}`;
    }

    return null;
  }

  // YYYY-MM-DD HH:mm 表示用（UTC ISO → ローカル時刻）
  const _browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone;

  function utcToLocalDisplay(utcStr, tz) {
    if (!utcStr) return '';
    const d = new Date(utcStr);
    if (isNaN(d.getTime())) return String(utcStr);
    const parts = new Intl.DateTimeFormat('ja-JP', {
      timeZone: tz || _browserTz,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false
    }).formatToParts(d);
    const get = (type) => parts.find((p) => p.type === type)?.value || '00';
    return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}`;
  }

  // "YYYY-MM-DD HH:mm" 等のkintoneタイムゾーン入力 → UTC ISO（null = 解釈不能）
  function smartDateTimeToUtc(raw, tz) {
    let s = String(raw || '').trim().toLowerCase();
    if (!s) return null;
    // 末尾に誤って "t" を追加した場合 ("2026-05-23 00:00t" など) → 剥ぎ取って再試行
    if (s.length > 1 && s.endsWith('t')) s = s.slice(0, -1).trim();

    const now = new Date();
    const toIso = (d) => isNaN(d.getTime()) ? null : d.toISOString();
    const shift = (d, ms) => new Date(d.getTime() + ms);

    if (s === 'now') return toIso(now);
    if (s === 't' || s === 'today') {
      return toIso(new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0));
    }

    // +Nd / -Nd (days)
    const dayMatch = s.match(/^([+-])(\d+)d?$/);
    if (dayMatch) {
      const n = (dayMatch[1] === '+' ? 1 : -1) * Number(dayMatch[2]);
      return toIso(shift(now, n * 86400000));
    }

    // +Nh / -Nh (hours)
    const hourMatch = s.match(/^([+-])(\d+)h$/);
    if (hourMatch) {
      const n = (hourMatch[1] === '+' ? 1 : -1) * Number(hourMatch[2]);
      return toIso(shift(now, n * 3600000));
    }

    // +Nm / -Nm (minutes)
    const minMatch = s.match(/^([+-])(\d+)m$/);
    if (minMatch) {
      const n = (minMatch[1] === '+' ? 1 : -1) * Number(minMatch[2]);
      return toIso(shift(now, n * 60000));
    }

    // "YYYY-MM-DD HH:mm" or "YYYY-MM-DDTHH:mm" → kintoneのタイムゾーンとして解釈してUTC変換
    const dtMatch = s.match(/^(\d{4})-(\d{2})-(\d{2})[t\s](\d{2}):(\d{2})$/);
    if (dtMatch) {
      const [, yr, mo, dy, hr, mn] = dtMatch.map(Number);
      if (tz) {
        // tz指定がある場合: ローカル時刻をそのタイムゾーンのものとしてUTC変換
        const approx = new Date(Date.UTC(yr, mo - 1, dy, hr, mn, 0));
        const tzParts = new Intl.DateTimeFormat('en-CA', {
          timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
          hour: '2-digit', minute: '2-digit', hour12: false
        }).formatToParts(approx);
        const g = (type) => Number(tzParts.find((p) => p.type === type)?.value || '0');
        const tzLocal = new Date(Date.UTC(g('year'), g('month') - 1, g('day'), g('hour'), g('minute')));
        return toIso(new Date(Date.UTC(yr, mo - 1, dy, hr, mn) + (approx - tzLocal)));
      }
      return toIso(new Date(yr, mo - 1, dy, hr, mn, 0, 0));
    }

    return null;
  }

  function normalizeFieldDefaultValue(field, timezone = '') {
    if (!field || typeof field !== 'object') return undefined;
    const type = String(field.type || '').toUpperCase();
    const hasDefaultNow = field.defaultNowValue === true || String(field.defaultNowValue || '').toLowerCase() === 'true';
    if (hasDefaultNow) {
      if (type === 'DATE') return smartDateToYMD('today') || '';
      if (type === 'DATETIME') return utcToLocalDisplay(new Date().toISOString(), timezone || _browserTz);
      if (type === 'TIME') {
        const now = new Date();
        return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
      }
    }
    if (field.defaultValue === undefined) return undefined;
    const value = field.defaultValue;
    if (type === 'CHECK_BOX' || type === 'MULTI_SELECT') {
      if (Array.isArray(value)) return value.map((item) => String(item ?? '')).filter(Boolean);
      const text = String(value ?? '').trim();
      return text ? [text] : [];
    }
    if (Array.isArray(value)) return value.length ? String(value[0] ?? '') : '';
    return value === undefined || value === null ? '' : String(value);
  }

  function hasFieldDefaultValue(field) {
    if (!field || typeof field !== 'object') return false;
    if (field.defaultNowValue === true || String(field.defaultNowValue || '').toLowerCase() === 'true') return true;
    return field.defaultValue !== undefined;
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
    const timeoutMs = (Number(meta?.timeout) > 0) ? Number(meta.timeout) : 10000;
    const p = new Promise((resolve) => {
      pending.set(id, { resolve });
      setTimeout(() => {
        if (pending.has(id)) {
          pending.delete(id);
          resolve({ ok: false, error: 'Timeout' });
        }
      }, timeoutMs);
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
        if (msg?.type === 'PB_SHOW_SHORTCUT_CHEATSHEET') {
          try {
            cpToggleCheatsheet(true);
            sendResponse({ ok: true });
          } catch (e) {
            sendResponse({ ok: false, error: String(e?.message || e) });
          }
          return;
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
      modeViewOnly: "Standard（閲覧）",
      modeViewOnlyHint: "閲覧モードです。クリックで Pro の詳細を表示",
      toastViewOnlyAction: "Proの詳細",
      upsellTitle: "一覧の一括編集は Pro の機能です",
      upsellSubtitle: "詳細画面での単票編集は無料でお使いいただけます。一覧でのセル編集・コピー&貼り付け・一括保存は Pro で解放されます。",
      upsellFreeTitle: "Free",
      upsellProTitle: "Pro",
      upsellFree1: "一覧・詳細のスプレッドシート表示",
      upsellFree2: "検索・フィルタ・列レイアウト",
      upsellFree3: "詳細画面の単票編集・クイック新規レコード",
      upsellPro1: "一覧でのセル編集・一括保存",
      upsellPro2: "コピー & 貼り付け・フィルハンドル",
      upsellPro3: "行の追加・削除・元に戻す/やり直し",
      upsellPrice: "¥980/月 ・ いつでも解約できます",
      upsellCtaTrial: "14日間無料で試す",
      upsellCtaDetail: "Proの詳細を見る",
      upsellCtaLicense: "ライセンスキーを入力",
      upsellClose: "閉じる",
      toastNoChanges: "変更はありません",
      toastInvalidCells: "エラーを解消してから保存してください",
      toastRequiredMissing: "必須項目を入力してください",
      toastViewOnlyBlocked: "Pro 版のみ",
      overlayProOnly: "Pro 版のみ",
      overlayStandardReadonly: "Standardでは閲覧のみ利用できます",
      lookupAutoReadonly: "LOOKUPにより自動入力されるため編集できません",
      lookupKeyHint: "ルックアップのキーを直接入力できます（↓キーで候補を表示）。値は保存時にkintoneが照合します",
      toastSaveSuccess: "保存しました",
      toastSaveFailed: "保存に失敗しました",
      confirmClose: "未保存の変更があります。閉じますか？",
      confirmOk: "OK",
      confirmCancel: "キャンセル",
      confirmDelete: "削除",
      confirmCloseAction: "閉じる",
      confirmPageMoveUnsaved: "未保存の変更があります。ページを移動しますか？",
      newRecordLookupManualPh: "直接入力 または 🔍 で選択",
      newRecordLookupPickTitle: "候補から選択",
      quickNewLookupEmpty: "レコードがありません",
      quickNewLookupError: "取得に失敗しました",
      quickNewLookupCount: (shown, total) => `全 ${total} 件中 ${shown} 件を表示（入力で絞り込み・スクロールで追加読み込み）`,
      quickNewLookupMatch: "✓ 候補と一致しています",
      quickNewLookupNoMatch: "一致する候補が見つかりません（このままでは保存できません）",
      lookupFrequentHeader: "このアプリで使用中",
      lookupFrequentCount: (count) => `${count} 回使用`,
      lookupCacheAgeJustNow: "たった今取得",
      lookupCacheAge: (minutes) => `${minutes} 分前に取得`,
      lookupCacheReload: "再読込",
      newRecordSaveNext: "保存して次へ",
      newRecordSavedNext: "保存しました。続けて入力できます",
      newRecordRequiredField: "必須項目です",
      newRecordDiscardConfirm: "入力内容が保存されていません。破棄して閉じますか？",
      newRecordDiscardAction: "破棄して閉じる",
      btnRecalc: "再計算",
      titleRecalc: "レコードを再保存して、計算フィールドを最新の計算式で更新します",
      recalcScopeMessage: "レコードを再保存して、計算フィールドを最新の状態に更新します。範囲を選択してください。\n\n・値は変更しませんが「保存」として扱われるため、更新日時・更新者が変わります\n・プロセス管理や通知の設定によっては、それらが動作する場合があります",
      recalcScopePage: (count) => `表示中の ${count} 件`,
      recalcScopeAll: "アプリ全体",
      recalcFetchingIds: "対象レコードを確認しています…",
      recalcConfirmAll: (count, requests) => `アプリ全体の ${count} 件を再保存します（API 約 ${requests} 回）。よろしいですか？\n\n※編集権限のないレコードを含む一部は更新できない場合があります`,
      recalcConfirmAction: "再計算する",
      recalcProgress: (done, total) => `再計算中… ${done} / ${total} 件`,
      recalcDone: (count) => `${count} 件を再計算しました`,
      recalcPartial: (okCount, ngCount) => `${okCount} 件を再計算しました（${ngCount} 件は更新できませんでした）`,
      recalcFailed: "再計算に失敗しました",
      recalcNoTargets: "再計算できるレコードがありません",
      btnLookupRefresh: "ルックアップ再取得",
      titleLookupRefresh: "ルックアップのキーを現在の値で再保存して、参照先からコピーされる値を最新化します",
      lookupRefreshScopeMessage: "ルックアップのキーを現在の値のまま再保存して、参照先からコピーされる値（コピー先フィールド）を最新化します。範囲を選択してください。\n\n・「保存」として扱われるため、更新日時・更新者が変わります\n・参照先でキーが見つからない／重複するレコードはエラーになり、そのバッチは失敗として集計されます\n・キーが空のレコードは対象外です",
      lookupRefreshScopePage: (count) => `表示中の ${count} 件`,
      lookupRefreshScopeAll: "アプリ全体",
      lookupRefreshFetchingIds: "対象レコードを収集中…",
      lookupRefreshConfirmAll: (count, requests) => `アプリ全体の ${count} 件を再取得します（約 ${requests} リクエスト）。実行しますか？`,
      lookupRefreshConfirmAction: "実行",
      lookupRefreshProgress: (done, total) => `ルックアップ再取得中… ${done}/${total}`,
      lookupRefreshDone: (count) => `${count} 件のルックアップを再取得しました`,
      lookupRefreshPartial: (done, failed) => `${done} 件を再取得、${failed} 件は失敗しました（参照先での照合エラー等）`,
      lookupRefreshFailed: "ルックアップ再取得に失敗しました",
      lookupRefreshNoTargets: "再取得できるルックアップがありません",
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
      // 「ツール ▾」トグルボタン。低頻度の管理系操作（列表示/再計算/
      // ルックアップ再取得）をここに集約する
      btnToolMenu: "ツール ▾",
      titleToolMenu: "列表示・再計算・ルックアップ再取得",
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
      overlayUnsupportedPage: "この画面では Excel Overlay を利用できません。一覧/詳細画面で利用できます。",
      overlayDisabledBySetting: "Excel Overlay は設定で無効になっています。設定画面の「スプレッドシート」から有効化できます。",
      dockOverlay: "Excel Overlay を開く (Ctrl+Shift+E)",
      dockQuickNew: "クイック新規レコード (Shift+Alt+N)",
      dockPalette: "コマンドパレット (Ctrl+/)",
      dockHelp: "キーボードショートカット一覧 (?)",
      dockQuickNewUnsupported: "クイック新規レコードは一覧画面で利用できます。",
      dockHide: "クイックランチャーを非表示（設定の「全般」から再表示できます）",
      dockHiddenNotice: "クイックランチャーを非表示にしました。設定画面の「全般」から再表示できます。",
      cpDialogLabel: "コマンドパレット",
      cpCmdAppSearch: "App検索を開始",
      cpCmdAppTop: "アプリトップへ",
      cpCmdPortal: "ポータルへ",
      cpCmdSwitchView: "ビューを切り替え",
      cpCmdGraphView: "グラフビューへ",
      cpCmdDuplicateRecord: "レコードを複製",
      cpCmdCopyRecordLink: "レコードリンクをコピー",
      cpCmdPrintPreview: "印刷プレビューへ",
      cpCmdFormSettings: "フォーム設定を開く",
      cpCmdProcessSettings: "プロセス管理設定を開く",
      cpCmdApiTokenSettings: "APIトークン設定を開く",
      cpCmdListSettings: "一覧設定を開く",
      cpCmdNotificationSettings: "通知条件を開く",
      cpCmdAclSettings: "アクセス権を開く",
      cpCmdCustomizeSettings: "JS・CSSカスタマイズを開く",
      cpCmdPluginSettings: "プラグイン設定を開く",
      cpCmdDeploy: "運用環境へ反映",
      cpCmdCopyAppId: "App IDをコピー",
      cpCmdCopyRecordId: "Record IDをコピー",
      cpCmdCopyQuery: "クエリ条件をコピー",
      cpCmdCopyFieldCodes: "フィールドコード一覧をコピー",
      cpCmdCopyFormDefinition: "フォーム定義をJSONで取得",
      cpCmdShowHelp: "ショートカットキー一覧を表示",
      cpCmdRefreshCatalog: "アプリ一覧キャッシュを更新",
      cpAclApp: "アプリのアクセス権",
      cpAclRecord: "レコードのアクセス権",
      cpAclField: "フィールドのアクセス権",
      cpNotifyApp: "全般通知",
      cpNotifyRecord: "レコード単位の通知",
      cpNotifyReminder: "リマインダー通知",
      cpPhCommand: "コマンドを検索...",
      cpPhAppSearch: "App名またはApp IDを検索...",
      cpPhRefreshing: "アプリ一覧を更新しています...",
      cpPhView: "ビュー名を検索...",
      cpPhGraph: "グラフ名を検索...",
      cpPhKind: "種類を選択...",
      cpPhDefault: "検索...",
      cpEmptyAppLoading: "App一覧を読み込んでいます...",
      cpEmptyAppNoMatch: "該当するAppが見つかりません",
      cpEmptyAppPrompt: "App名またはApp IDを入力してください",
      cpEmptyView: "ビューが見つかりません",
      cpEmptyGraph: "グラフビューが見つかりません",
      cpEmptyItems: "項目が見つかりません",
      cpEmptyGeneric: "該当する項目が見つかりません",
      cpEmptyCommand: "該当するコマンドが見つかりません",
      cpFooterMove: "移動",
      cpFooterRun: "実行",
      cpFooterOpen: "開く",
      cpFooterNewTab: "新規タブ",
      cpFooterClose: "閉じる",
      cpFooterShortcuts: "ショートカット",
      cpShortcutDefault: "ショートカット",
      cpToastCopied: "コピーしました",
      cpToastCopyFailed: "コピーに失敗しました",
      cpToastCopiedRecordLink: "レコードリンクをコピーしました",
      cpToastCopiedAppId: "App IDをコピーしました",
      cpToastCopiedRecordId: "Record IDをコピーしました",
      cpToastCopiedQuery: "クエリ条件をコピーしました",
      cpToastCopiedFields: (count) => `フィールドコード ${count}件をコピーしました`,
      cpToastCopiedForm: "フォーム定義(JSON)をコピーしました",
      cpToastFieldsFailed: "フィールド情報の取得に失敗しました",
      cpToastFormFailed: "フォーム定義の取得に失敗しました",
      csTitle: "キーボードショートカット",
      csClose: "閉じる",
      csSecGeneral: "全般",
      csSecPalette: "コマンドパレット",
      csSecOverlay: "Excel Overlay",
      csOpenPalette: "コマンドパレットを開く",
      csOpenOverlay: "Excel Overlay を開く",
      csQuickNew: "クイック新規レコード（一覧画面）",
      csShowThis: "このショートカット一覧を表示",
      csMove: "項目を移動",
      csRun: "実行 / 開く",
      csAppNewTab: "App検索: 新規タブで開く",
      csNumShortcut: "番号ショートカットを実行",
      csCloseDesc: "閉じる",
      csCellMove: "セル移動 / 範囲選択（Shift併用）",
      csConfirmMove: "確定して下 / 上へ",
      csTabMove: "右 / 左へ",
      csEditStart: "編集開始・ピッカーを開く",
      csTypeKeys: "文字入力",
      csTypeReplace: "選択セルの内容を置き換えて編集開始",
      csDeleteClear: "選択範囲をクリア",
      csCopyPaste: "コピー / 貼り付け",
      csUndoRedo: "元に戻す / やり直し",
      csSave: "保存",
      csEscDesc: "パネル / Overlay を閉じる",
      csSecDate: "日付セルのコマンド入力（Overlay / クイック新規）",
      csDateToday: "今日（yesterday / tomorrow も可）",
      csDateRelative: "N日後 / N日前（例: +3, -7）",
      csDateCompact: "8桁で日付入力（例: 20260713）",
      csDateMonth: "月末 / 月初（end+1 で来月末、first-1 で先月初）",
      csDateWeekday: "今週の曜日（mon+1 で来週月曜、fri-1 で先週金曜）",
      csDateTime: "日時セル: 現在時刻 / N日・N時間・N分後（-も可）",
      btnNewRecord: "＋ 新規",
      newRecordTitle: "新規レコード作成",
      newRecordSave: "保存",
      newRecordCancel: "キャンセル",
      newRecordSaving: "保存中...",
      toastNewRecordSaved: "レコードを作成しました",
      toastNewRecordFailed: "レコードの作成に失敗しました",
      newRecordRequiredMissing: "必須項目を入力してください",
      quickNewPresetLabel: "レイアウト",
      quickNewNoFields: "表示するフィールドがありません",
      quickNewLoading: "読み込み中..."
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
      modeViewOnly: "Standard (view only)",
      modeViewOnlyHint: "View-only mode. Click for Pro details",
      toastViewOnlyAction: "See Pro",
      upsellTitle: "Bulk editing in list view is a Pro feature",
      upsellSubtitle: "Editing a single record from its detail page is free. Cell editing, copy & paste, and bulk saving in list view unlock with Pro.",
      upsellFreeTitle: "Free",
      upsellProTitle: "Pro",
      upsellFree1: "Spreadsheet view for lists and records",
      upsellFree2: "Search, filters, and column layouts",
      upsellFree3: "Single-record editing and quick new record",
      upsellPro1: "Cell editing and bulk save in list view",
      upsellPro2: "Copy & paste and fill handle",
      upsellPro3: "Add/delete rows and undo/redo",
      upsellPrice: "¥980/month — cancel anytime",
      upsellCtaTrial: "Start 14-day free trial",
      upsellCtaDetail: "Learn more about Pro",
      upsellCtaLicense: "Enter license key",
      upsellClose: "Close",
      toastNoChanges: "No changes",
      toastInvalidCells: "Fix errors before saving",
      toastRequiredMissing: "Please fill required fields",
      toastViewOnlyBlocked: "Pro plan only",
      overlayProOnly: "Pro plan only",
      overlayStandardReadonly: "Editing is disabled in Standard mode",
      lookupAutoReadonly: "This field is auto-populated by LOOKUP and cannot be edited",
      lookupKeyHint: "Type the lookup key directly (press ↓ for suggestions). kintone validates the value on save.",
      toastSaveSuccess: "Changes saved",
      toastSaveFailed: "Failed to save changes",
      confirmClose: "You have unsaved changes. Close anyway?",
      confirmOk: "OK",
      confirmCancel: "Cancel",
      confirmDelete: "Delete",
      confirmCloseAction: "Close",
      confirmPageMoveUnsaved: "You have unsaved changes. Move to another page?",
      newRecordLookupManualPh: "Type directly or pick with 🔍",
      newRecordLookupPickTitle: "Pick from candidates",
      quickNewLookupEmpty: "No records",
      quickNewLookupError: "Failed to load candidates",
      quickNewLookupCount: (shown, total) => `Showing ${shown} of ${total} (type to narrow down, scroll to load more)`,
      quickNewLookupMatch: "✓ Matches a candidate",
      quickNewLookupNoMatch: "No matching candidate (saving will fail)",
      lookupFrequentHeader: "Used in this app",
      lookupFrequentCount: (count) => `Used ${count} times`,
      lookupCacheAgeJustNow: "Fetched just now",
      lookupCacheAge: (minutes) => `Fetched ${minutes} min ago`,
      lookupCacheReload: "Reload",
      newRecordSaveNext: "Save & next",
      newRecordSavedNext: "Saved. Ready for the next record.",
      newRecordRequiredField: "This field is required",
      newRecordDiscardConfirm: "Your input has not been saved. Discard and close?",
      newRecordDiscardAction: "Discard & close",
      btnRecalc: "Recalculate",
      titleRecalc: "Re-save records so calculated fields reflect the latest formulas",
      recalcScopeMessage: "Re-save records to refresh their calculated fields. Choose the scope.\n\n- No values are changed, but this counts as a save: updated time and updater will change\n- Process management or notifications may be triggered depending on the app settings",
      recalcScopePage: (count) => `Visible ${count} records`,
      recalcScopeAll: "Entire app",
      recalcFetchingIds: "Collecting target records…",
      recalcConfirmAll: (count, requests) => `Re-save all ${count} records in this app (about ${requests} API requests). Continue?\n\nNote: batches containing records you cannot edit may fail to update.`,
      recalcConfirmAction: "Recalculate",
      recalcProgress: (done, total) => `Recalculating… ${done} / ${total}`,
      recalcDone: (count) => `Recalculated ${count} records`,
      recalcPartial: (okCount, ngCount) => `Recalculated ${okCount} records (${ngCount} could not be updated)`,
      recalcFailed: "Failed to recalculate",
      recalcNoTargets: "No records available to recalculate",
      btnLookupRefresh: "Refresh lookups",
      titleLookupRefresh: "Re-save lookup keys with their current values to refresh copied fields from the source app",
      lookupRefreshScopeMessage: "Re-save lookup keys with their current values to refresh the fields copied from the source app. Choose the scope.\n\n- This counts as a save: updated time and updater will change\n- Records whose key is missing or ambiguous in the source app will error, and that batch is counted as failed\n- Records with an empty key are excluded",
      lookupRefreshScopePage: (count) => `This page (${count})`,
      lookupRefreshScopeAll: "Entire app",
      lookupRefreshFetchingIds: "Collecting target records…",
      lookupRefreshConfirmAll: (count, requests) => `Refresh lookups for all ${count} records in this app (about ${requests} requests). Continue?`,
      lookupRefreshConfirmAction: "Run",
      lookupRefreshProgress: (done, total) => `Refreshing lookups… ${done}/${total}`,
      lookupRefreshDone: (count) => `Refreshed ${count} lookups`,
      lookupRefreshPartial: (done, failed) => `Refreshed ${done} records (${failed} failed, e.g. source lookup mismatch)`,
      lookupRefreshFailed: "Failed to refresh lookups",
      lookupRefreshNoTargets: "No lookups available to refresh",
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
      // "Tools ▾" toggle button. Groups low-frequency admin actions
      // (columns, recalculate, refresh lookups) under one menu
      btnToolMenu: "Tools ▾",
      titleToolMenu: "Columns, recalculate, refresh lookups",
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
      overlayUnsupportedPage: "Excel Overlay is only available on list/detail pages.",
      overlayDisabledBySetting: "Excel Overlay is turned off in settings. Enable it from the Spreadsheet section of the options page.",
      dockOverlay: "Open Excel Overlay (Ctrl+Shift+E)",
      dockQuickNew: "Quick new record (Shift+Alt+N)",
      dockPalette: "Command palette (Ctrl+/)",
      dockHelp: "Keyboard shortcuts (?)",
      dockQuickNewUnsupported: "Quick new record is available on list pages.",
      dockHide: "Hide the quick launcher (re-enable it from the General settings)",
      dockHiddenNotice: "Quick launcher hidden. You can re-enable it from the General section of the options page.",
      cpDialogLabel: "Command palette",
      cpCmdAppSearch: "Search apps",
      cpCmdAppTop: "Go to app top",
      cpCmdPortal: "Go to portal",
      cpCmdSwitchView: "Switch view",
      cpCmdGraphView: "Open graph view",
      cpCmdDuplicateRecord: "Duplicate record",
      cpCmdCopyRecordLink: "Copy record link",
      cpCmdPrintPreview: "Open print preview",
      cpCmdFormSettings: "Open form settings",
      cpCmdProcessSettings: "Open process management",
      cpCmdApiTokenSettings: "Open API token settings",
      cpCmdListSettings: "Open view settings",
      cpCmdNotificationSettings: "Open notification settings",
      cpCmdAclSettings: "Open permissions",
      cpCmdCustomizeSettings: "Open JS/CSS customization",
      cpCmdPluginSettings: "Open plugin settings",
      cpCmdDeploy: "Deploy to production",
      cpCmdCopyAppId: "Copy app ID",
      cpCmdCopyRecordId: "Copy record ID",
      cpCmdCopyQuery: "Copy query condition",
      cpCmdCopyFieldCodes: "Copy field codes",
      cpCmdCopyFormDefinition: "Copy form definition as JSON",
      cpCmdShowHelp: "Show keyboard shortcuts",
      cpCmdRefreshCatalog: "Refresh app catalog cache",
      cpAclApp: "App permissions",
      cpAclRecord: "Record permissions",
      cpAclField: "Field permissions",
      cpNotifyApp: "General notifications",
      cpNotifyRecord: "Per-record notifications",
      cpNotifyReminder: "Reminder notifications",
      cpPhCommand: "Search commands...",
      cpPhAppSearch: "Search by app name or ID...",
      cpPhRefreshing: "Refreshing app catalog...",
      cpPhView: "Search views...",
      cpPhGraph: "Search graphs...",
      cpPhKind: "Select a type...",
      cpPhDefault: "Search...",
      cpEmptyAppLoading: "Loading app catalog...",
      cpEmptyAppNoMatch: "No matching apps",
      cpEmptyAppPrompt: "Type an app name or ID",
      cpEmptyView: "No views found",
      cpEmptyGraph: "No graph views found",
      cpEmptyItems: "No items found",
      cpEmptyGeneric: "No matching items",
      cpEmptyCommand: "No matching commands",
      cpFooterMove: "Move",
      cpFooterRun: "Run",
      cpFooterOpen: "Open",
      cpFooterNewTab: "New tab",
      cpFooterClose: "Close",
      cpFooterShortcuts: "Shortcuts",
      cpShortcutDefault: "Shortcut",
      cpToastCopied: "Copied",
      cpToastCopyFailed: "Copy failed",
      cpToastCopiedRecordLink: "Record link copied",
      cpToastCopiedAppId: "App ID copied",
      cpToastCopiedRecordId: "Record ID copied",
      cpToastCopiedQuery: "Query condition copied",
      cpToastCopiedFields: (count) => `Copied ${count} field codes`,
      cpToastCopiedForm: "Form definition (JSON) copied",
      cpToastFieldsFailed: "Failed to fetch field info",
      cpToastFormFailed: "Failed to fetch form definition",
      csTitle: "Keyboard shortcuts",
      csClose: "Close",
      csSecGeneral: "General",
      csSecPalette: "Command palette",
      csSecOverlay: "Excel Overlay",
      csOpenPalette: "Open the command palette",
      csOpenOverlay: "Open Excel Overlay",
      csQuickNew: "Quick new record (list pages)",
      csShowThis: "Show this shortcut list",
      csMove: "Move between items",
      csRun: "Run / open",
      csAppNewTab: "App search: open in a new tab",
      csNumShortcut: "Run a numbered shortcut",
      csCloseDesc: "Close",
      csCellMove: "Move cell / extend selection (with Shift)",
      csConfirmMove: "Confirm and move down / up",
      csTabMove: "Move right / left",
      csEditStart: "Start editing / open picker",
      csTypeKeys: "Type",
      csTypeReplace: "Replace the selected cell and start editing",
      csDeleteClear: "Clear the selected range",
      csCopyPaste: "Copy / paste",
      csUndoRedo: "Undo / redo",
      csSave: "Save",
      csEscDesc: "Close panel / overlay",
      csSecDate: "Date cell commands (Overlay / Quick New)",
      csDateToday: "Today (also yesterday / tomorrow)",
      csDateRelative: "N days ahead / ago (e.g. +3, -7)",
      csDateCompact: "8-digit date (e.g. 20260713)",
      csDateMonth: "End / first of month (end+1 = next month, first-1 = last month)",
      csDateWeekday: "Weekday this week (mon+1 = next Monday, fri-1 = last Friday)",
      csDateTime: "Datetime cells: now / N days, hours, minutes from now (- works too)",
      btnNewRecord: "+ New",
      newRecordTitle: "Create New Record",
      newRecordSave: "Save",
      newRecordCancel: "Cancel",
      newRecordSaving: "Saving...",
      toastNewRecordSaved: "Record created",
      toastNewRecordFailed: "Failed to create record",
      newRecordRequiredMissing: "Please fill in all required fields",
      quickNewPresetLabel: "Layout",
      quickNewNoFields: "No fields to display",
      quickNewLoading: "Loading..."
    }
  };

  const overlayConfig = {
    limit: 100,
    allowedTypes: new Set([
      'SINGLE_LINE_TEXT',
      'MULTI_LINE_TEXT',
      'NUMBER',
      'DATE',
      'DATETIME',
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
  const OVERLAY_LAYOUT_LEGACY_MIGRATED_KEY = 'kfavOverlayLayoutLegacyMigrated';
  const SUBTABLE_WIDTH_PREF_STORAGE_KEY = 'kfavExcelSubtableWidths';
  const EXCEL_OVERLAY_MODE_STANDARD = 'standard';
  const EXCEL_OVERLAY_MODE_PRO = 'pro';
  const DEFAULT_EXCEL_OVERLAY_MODE = EXCEL_OVERLAY_MODE_STANDARD;
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

  function ensureOverlayCss() {
    if (overlayCssLoaded) return;
    overlayCssLoaded = true;
    const href = chrome.runtime.getURL('overlay.css');
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    link.dataset.pbOverlay = 'true';
    document.head.appendChild(link);
  }

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

  // @@INCLUDE: content-overlay-controller.js

  function ensureOverlayControllerReady() {
    if (overlayController) return true;
    if (!isSupportedAppContextPage()) return false;
    const overlayPostToPage = (type, payload, meta = {}) => postToPage(type, payload, { feature: 'overlay', ...meta });
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

  // ── Quick launcher dock ────────────────────────────────────────────────────
  // 主要機能(Overlay / Quick New / パレット)がキーボード限定で発見できない
  // 問題への対策として、対応ページの右下に小さな起動ドックを表示する。
  // kintone DOMには依存せず body 直下に置く。設定(pbPageDockDisabled)でOFF可。
  const PAGE_DOCK_DISABLED_KEY = 'pbPageDockDisabled';
  let pageDockEl = null;
  let pageDockStorageListenerAttached = false;

  const PAGE_DOCK_ICONS = {
    overlay: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 3v18"/></svg>',
    quickNew: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>',
    palette: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 17l6-6-6-6M12 19h8"/></svg>',
    help: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3"/><path d="M12 17h.01"/></svg>',
    close: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>'
  };

  async function isPageDockDisabled() {
    try {
      const stored = await chrome.storage.sync.get(PAGE_DOCK_DISABLED_KEY);
      return Boolean(stored?.[PAGE_DOCK_DISABLED_KEY]);
    } catch (_) {
      return false;
    }
  }

  function removePageDock() {
    if (pageDockEl) {
      pageDockEl.remove();
      pageDockEl = null;
    }
  }

  function createPageDockButton(iconHtml, label, onClick) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'pb-dock__btn';
    btn.title = label;
    btn.setAttribute('aria-label', label);
    btn.innerHTML = iconHtml;
    btn.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      onClick();
    });
    return btn;
  }

  async function mountPageDock() {
    if (pageDockEl && document.body.contains(pageDockEl)) return;
    const uiLanguage = await resolveOverlayUiLanguage();
    const language = uiLanguage?.language || DEFAULT_OVERLAY_LANGUAGE;

    const dock = document.createElement('div');
    dock.id = 'pb-quick-dock';

    const style = document.createElement('style');
    style.textContent = `
      #pb-quick-dock{position:fixed;right:18px;bottom:18px;z-index:2147483000;display:flex;align-items:center;gap:2px;padding:4px;border-radius:999px;background:rgba(255,255,255,.94);border:1px solid rgba(15,23,42,.14);box-shadow:0 8px 24px rgba(15,23,42,.18);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}
      #pb-quick-dock .pb-dock__btn{width:30px;height:30px;border:none;border-radius:999px;background:transparent;color:#475569;display:inline-flex;align-items:center;justify-content:center;cursor:pointer;padding:0;line-height:0}
      #pb-quick-dock .pb-dock__btn:hover{background:#eff4ff;color:#2563eb}
      #pb-quick-dock .pb-dock__btn:focus-visible{outline:2px solid #2563eb;outline-offset:1px}
      #pb-quick-dock .pb-dock__brand{width:22px;height:22px;border-radius:999px;margin:0 2px 0 4px;background:linear-gradient(135deg,#3b82f6,#1d4ed8);color:#fff;display:inline-flex;align-items:center;justify-content:center;flex:0 0 auto}
      #pb-quick-dock .pb-dock__hide{width:20px;height:20px;color:#94a3b8;opacity:0;transition:opacity .12s ease;margin-left:1px}
      #pb-quick-dock:hover .pb-dock__hide,#pb-quick-dock:focus-within .pb-dock__hide{opacity:1}
      #pb-quick-dock .pb-dock__hide:hover{background:rgba(220,38,38,.10);color:#dc2626}
      @media (prefers-reduced-motion: reduce){
        #pb-quick-dock .pb-dock__hide{transition:none}
      }
      @media (prefers-color-scheme: dark){
        #pb-quick-dock{background:rgba(22,30,44,.94);border-color:rgba(148,163,184,.28);box-shadow:0 8px 24px rgba(0,0,0,.5)}
        #pb-quick-dock .pb-dock__btn{color:#9fb0c7}
        #pb-quick-dock .pb-dock__btn:hover{background:rgba(124,177,255,.16);color:#7cb1ff}
        #pb-quick-dock .pb-dock__hide{color:#7b8aa0}
        #pb-quick-dock .pb-dock__hide:hover{background:rgba(248,113,113,.14);color:#f87171}
      }
    `;

    const brand = document.createElement('span');
    brand.className = 'pb-dock__brand';
    brand.setAttribute('aria-hidden', 'true');
    brand.innerHTML = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2L4 14h6l-1 8 9-12h-6l1-8z"/></svg>';

    const overlayBtn = createPageDockButton(PAGE_DOCK_ICONS.overlay, resolveText(language, 'dockOverlay'), () => {
      void (async () => {
        const result = await openOverlayByCurrentPage('dock');
        if (!result?.ok && result?.message) showOverlayLaunchNotice(result.message);
      })();
    });

    const quickNewBtn = createPageDockButton(PAGE_DOCK_ICONS.quickNew, resolveText(language, 'dockQuickNew'), () => {
      if (!parseListOverlayContext(location.href)) {
        showOverlayLaunchNotice(resolveText(language, 'dockQuickNewUnsupported'));
        return;
      }
      if (!quickNewRecord.isVisible()) void quickNewRecord.open();
    });

    const paletteBtn = createPageDockButton(PAGE_DOCK_ICONS.palette, resolveText(language, 'dockPalette'), () => {
      void commandPalette.open();
    });

    const helpBtn = createPageDockButton(PAGE_DOCK_ICONS.help, resolveText(language, 'dockHelp'), () => {
      cpToggleCheatsheet(true);
    });

    // ページ要素と位置が干渉するケース向けに、その場で非表示にできる
    // （設定に永続化されるので全タブから消える。再表示は設定の「全般」から）
    const hideBtn = createPageDockButton(PAGE_DOCK_ICONS.close, resolveText(language, 'dockHide'), () => {
      removePageDock();
      showOverlayLaunchNotice(resolveText(language, 'dockHiddenNotice'));
      try {
        void chrome.storage.sync.set({ [PAGE_DOCK_DISABLED_KEY]: true });
      } catch (_) { /* ignore */ }
    });
    hideBtn.classList.add('pb-dock__hide');

    dock.append(style, brand, overlayBtn, quickNewBtn, paletteBtn, helpBtn, hideBtn);
    (document.body || document.documentElement).appendChild(dock);
    pageDockEl = dock;
  }

  function attachPageDockStorageListener() {
    if (pageDockStorageListenerAttached) return;
    try {
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'sync' || !Object.prototype.hasOwnProperty.call(changes, PAGE_DOCK_DISABLED_KEY)) return;
        const disabled = Boolean(changes[PAGE_DOCK_DISABLED_KEY].newValue);
        if (disabled) {
          removePageDock();
        } else if (isSupportedAppContextPage()) {
          void mountPageDock();
        }
      });
      pageDockStorageListenerAttached = true;
    } catch (_) { /* ignore */ }
  }

  async function initPageDock() {
    attachPageDockStorageListener();
    if (await isPageDockDisabled()) return;
    await mountPageDock();
  }

  // App-only features are initialized only inside supported app contexts.
  function initAppOnlyFeatures() {
    if (appOnlyFeaturesInitialized) return true;
    if (!isSupportedAppContextPage()) return false;
    attachDevContextCapture();
    startRecentRecordWatcher();
    if (!ensureOverlayControllerReady()) return false;
    attachOverlayShortcutListener();
    void initPageDock();
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
      node.style.bottom = '72px'; /* クイックドックと重ならない位置 */
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

  async function isOverlayDisabledBySetting() {
    try {
      const stored = await chrome.storage.sync.get('kfavExcelOverlayMode');
      return String(stored?.kfavExcelOverlayMode || '').toLowerCase() === 'off';
    } catch (_) {
      return false;
    }
  }

  async function openOverlayByCurrentPage(source = 'unknown') {
    if (await isOverlayDisabledBySetting()) {
      const uiLanguage = await resolveOverlayUiLanguage();
      const language = uiLanguage?.language || DEFAULT_OVERLAY_LANGUAGE;
      return {
        ok: false,
        reason: 'disabled_by_setting',
        source,
        pageType: 'disabled',
        message: resolveText(language, 'overlayDisabledBySetting')
      };
    }
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

  // @@INCLUDE: content-command-palette.js

  // ── Lookup Picker (shared by overlay modal and QuickNewRecordModal) ───────

  // ルックアップ候補のタブ内キャッシュ（Tier1）。
  // 参照先マスタは自アプリの保存では変化しないため、鮮度はTTLと手動再読込で担保する
  // （候補はあくまで入力補助で、真実は保存時のkintone照合。古くてもデータは壊れない）。
  // グリッドはセル編集のたびにピッカーのインスタンスを作り直す（factory呼び出し自体は
  // 使い捨て）ため、キャッシュはfactoryの外・モジュールスコープに置いて使い回す。
  const LOOKUP_CACHE_TTL_MS = 10 * 60 * 1000;
  const LOOKUP_KEYWORD_CACHE_MAX = 50; // キーワード結果LRUの上限
  const lookupFullCache = new Map();    // `${relatedAppId}:${relatedKeyField}` -> { records, totalCount, fetchedAt }
  const lookupKeywordCache = new Map(); // `${relatedAppId}:${relatedKeyField}:${keyword}` -> 同上（挿入順=LRU）

  // エントリがあり有効期限内なら返す。期限切れは削除してnull（呼び出し側が再フェッチする）
  function lookupCacheGet(map, key, now) {
    const entry = map.get(key);
    if (!entry) return null;
    if (now - entry.fetchedAt >= LOOKUP_CACHE_TTL_MS) {
      map.delete(key);
      return null;
    }
    return entry;
  }

  // 既存キーは delete→set で挿入順を最新化し(「最近使った」扱いにする)、
  // 上限を超えたら最古(Mapのイテレーション先頭)から追い出す
  function lookupCacheSet(map, key, entry, maxSize) {
    if (map.has(key)) map.delete(key);
    map.set(key, entry);
    while (map.size > maxSize) {
      const oldestKey = map.keys().next().value;
      map.delete(oldestKey);
    }
  }

  // ルックアップ候補コンボボックス。
  // - 初回に最大500件を1リクエストで取得。関連アプリが500件以下なら
  //   「全件ローカルモード」になり、以後の絞り込みはAPI消費ゼロで即時。
  // - 500件超は「サーバー検索モード」: キー項目のlike検索＋無限スクロールで
  //   全件に到達できる。
  // - 手打ち入力そのものが検索になり、完全一致の有無をインジケータで表示する。
  // - キーワードなし/appendなしの結果はタブ内キャッシュ(Tier1)を優先する。
  //   グリッドで同じ列を何セルも編集してもAPIは初回の1回だけで済む
  // - frequentProvider が渡されていれば、参照先フェッチとは無関係に
  //   「このアプリで使用中」の頻出候補(Tier0・APIゼロ)を先頭に出す
  function createNewRecordLookupPicker({ anchorEl, relatedAppId, relatedKeyField, pickerFields, mappings = [], fieldInputMap = new Map(), keyInput, postFn, language, frequentProvider }) {
    const t = (key, ...args) => resolveText(language, key, ...args);
    const LOCAL_FULL_LIMIT = 500;
    const cacheKey = `${relatedAppId}:${relatedKeyField}`;

    let picker = null;
    let indicatorEl = null;
    let countEl = null;
    let cacheLineEl = null;
    let frequentEl = null;
    let listEl = null;
    let records = [];
    let totalCount = 0;
    let currentKeyword = '';
    let loading = false;
    let requestSeq = 0;
    let fullLocal = false;
    let allLocalRecords = null;
    let outsideHandler = null;
    let searchTimer = null;
    let activeIndex = -1;
    let itemEls = [];        // 頻出＋通常を通し番号で並べたキーボードナビ用の配列
    let frequentItemEls = [];
    let frequentItemValues = [];
    let regularItemEls = [];
    let cacheServedAt = null; // 今表示中の内容がキャッシュ提供ならそのfetchedAt、直接フェッチならnull

    function getDisplayValue(record, fieldCode) {
      const v = record?.[fieldCode];
      if (!v) return '';
      const val = v.value;
      if (Array.isArray(val)) return val.map((item) => (typeof item === 'object' ? item.value || '' : String(item))).join(', ');
      return String(val ?? '');
    }

    function isOpen() {
      return Boolean(picker && picker.isConnected);
    }

    function close() {
      // 保留中のデバウンス検索もキャンセルする
      // （Escで閉じた直後に検索が発火して再オープンするのを防ぐ）
      if (searchTimer) {
        clearTimeout(searchTimer);
        searchTimer = null;
      }
      requestSeq += 1;
      if (picker) picker.remove();
      picker = null;
      if (outsideHandler) {
        document.removeEventListener('mousedown', outsideHandler, true);
        outsideHandler = null;
      }
    }

    function ensureOpen() {
      if (isOpen()) return;
      picker = document.createElement('div');
      picker.className = 'pb-newrec__lookup-picker';
      indicatorEl = document.createElement('div');
      indicatorEl.className = 'pb-newrec__lookup-indicator';
      countEl = document.createElement('div');
      countEl.className = 'pb-newrec__lookup-count';
      cacheLineEl = document.createElement('div');
      cacheLineEl.className = 'pb-newrec__lookup-cacheline';
      frequentEl = document.createElement('div');
      frequentEl.className = 'pb-newrec__lookup-frequent';
      listEl = document.createElement('div');
      listEl.className = 'pb-newrec__lookup-list';
      // サーバー検索モードでは末尾までスクロールしたら自動で追加読み込み
      listEl.addEventListener('scroll', () => {
        if (fullLocal || loading) return;
        if (records.length >= totalCount) return;
        if (listEl.scrollTop + listEl.clientHeight >= listEl.scrollHeight - 60) {
          void load({ keyword: currentKeyword, append: true });
        }
      });
      picker.appendChild(indicatorEl);
      picker.appendChild(countEl);
      picker.appendChild(cacheLineEl);
      picker.appendChild(frequentEl);
      picker.appendChild(listEl);
      // モーダルのEscハンドラから「ドロップダウンだけ閉じる」ために公開
      picker.__pbClose = close;
      anchorEl.appendChild(picker);
      outsideHandler = (e) => {
        if (picker && !picker.contains(e.target) && e.target !== keyInput && !anchorEl.contains(e.target)) {
          close();
        }
      };
      document.addEventListener('mousedown', outsideHandler, true);
    }

    function setStatus(message) {
      if (!listEl) return;
      listEl.innerHTML = '';
      const el = document.createElement('div');
      el.className = 'pb-newrec__lookup-status';
      el.textContent = message;
      listEl.appendChild(el);
      // 通常候補が消えるので、キーボードナビ用配列からも外しておく
      // （参照が残ったままだと頻出セクションとの通し番号がズレる）
      regularItemEls = [];
      rebuildItemEls();
    }

    // 頻出＋通常候補を「見えている順」に結合し直す。どちらかを再描画するたびに呼ぶ
    function rebuildItemEls() {
      itemEls = frequentItemEls.concat(regularItemEls);
    }

    function applyPick(record) {
      const mainVal = getDisplayValue(record, relatedKeyField);
      keyInput.value = mainVal;
      keyInput.dispatchEvent(new Event('change', { bubbles: true }));
      fillMappings(record);
      close();
    }

    // 頻出候補（Tier0）の確定。参照先のrecordを持たないのでfillMappingsは呼べない
    // （呼んでも呼び出し側は常にグリッド=mappings:[]なので元々空振りだが、
    // 「recordが無いのに埋めようとする」という誤解を招く呼び方は避ける）
    function applyFrequentPick(value) {
      keyInput.value = value;
      keyInput.dispatchEvent(new Event('change', { bubbles: true }));
      close();
    }

    function fillMappings(record) {
      mappings.forEach((m) => {
        const autoEntry = fieldInputMap.get(m.field);
        if (autoEntry?.setValue) autoEntry.setValue(record ? getDisplayValue(record, m.relatedField) : '');
      });
    }

    // 手打ち値（または任意の文字列）と完全一致する候補を返す。
    // 全件ローカルモードでは全件から、そうでなければ現在の絞り込み結果から探す
    function findExactMatch(typed) {
      if (!typed) return null;
      const source = fullLocal ? allLocalRecords : records;
      return (source || []).find((r) => getDisplayValue(r, relatedKeyField) === typed) || null;
    }

    // 手打ち値と候補の完全一致を表示し、一致すればコピー先の表示も埋める。
    // 部分入力中（候補が下に見えている状態）は警告を出さず、
    // 候補がゼロになった時だけ「一致なし」を警告する
    function updateIndicator() {
      if (!indicatorEl) return;
      const typed = String(keyInput.value || '').trim();
      if (!typed) {
        indicatorEl.textContent = '';
        indicatorEl.className = 'pb-newrec__lookup-indicator';
        return;
      }
      const exact = findExactMatch(typed);
      if (exact) {
        indicatorEl.textContent = t('quickNewLookupMatch');
        indicatorEl.className = 'pb-newrec__lookup-indicator pb-newrec__lookup-indicator--ok';
        fillMappings(exact);
      } else if (!records.length) {
        indicatorEl.textContent = t('quickNewLookupNoMatch');
        indicatorEl.className = 'pb-newrec__lookup-indicator pb-newrec__lookup-indicator--warn';
      } else {
        indicatorEl.textContent = '';
        indicatorEl.className = 'pb-newrec__lookup-indicator';
      }
    }

    // ハイライト移動: 現在のactiveIndexからdelta分だけ移動する（端でクランプ）。
    // 開いている間のArrow操作はカーソル移動を奪うのでkeydown側でpreventDefaultする
    function setActiveIndex(idx) {
      if (activeIndex >= 0 && itemEls[activeIndex]) {
        itemEls[activeIndex].classList.remove('pb-newrec__lookup-item--active');
      }
      activeIndex = idx;
      if (activeIndex >= 0 && itemEls[activeIndex]) {
        itemEls[activeIndex].classList.add('pb-newrec__lookup-item--active');
        itemEls[activeIndex].scrollIntoView({ block: 'nearest' });
      }
    }

    // 頻出セクションと通常候補をひとつながりの通し番号として移動する
    function moveActive(delta) {
      if (!itemEls.length) return;
      let idx = activeIndex + delta;
      if (idx < 0) idx = 0;
      if (idx > itemEls.length - 1) idx = itemEls.length - 1;
      setActiveIndex(idx);
    }

    // キャッシュ提供時のみ「◯分前に取得＋再読込」を出す（直接フェッチした結果は
    // 「今取得したばかり」なので表示不要）
    function renderCacheLine() {
      if (!cacheLineEl) return;
      cacheLineEl.innerHTML = '';
      if (cacheServedAt === null) {
        cacheLineEl.style.display = 'none';
        return;
      }
      cacheLineEl.style.display = '';
      const ageMinutes = Math.floor((Date.now() - cacheServedAt) / 60000);
      const ageText = document.createElement('span');
      ageText.textContent = ageMinutes < 1 ? t('lookupCacheAgeJustNow') : t('lookupCacheAge', ageMinutes);
      cacheLineEl.appendChild(ageText);
      const reloadBtn = document.createElement('button');
      reloadBtn.type = 'button';
      reloadBtn.className = 'pb-newrec__lookup-reload';
      reloadBtn.textContent = t('lookupCacheReload');
      reloadBtn.addEventListener('mousedown', (e) => {
        // mousedownでkeyInputのフォーカスが外れてoutsideHandlerに閉じられないよう防ぐ
        // （既存の候補アイテムのクリックと同じ作法）
        e.preventDefault();
        e.stopPropagation();
        void reloadFromServer();
      });
      cacheLineEl.appendChild(reloadBtn);
    }

    // 頻出セクション（Tier0）。参照先の取得状況とは無関係に、渡された関数から
    // 同期的に描画する（フェッチ中でも即座に見える必要があるため）
    function renderFrequentSection(keyword) {
      if (!frequentEl) return;
      frequentEl.innerHTML = '';
      frequentItemEls = [];
      frequentItemValues = [];
      if (!frequentProvider) {
        frequentEl.style.display = 'none';
        rebuildItemEls();
        return;
      }
      const q = String(keyword || '').toLowerCase();
      const all = frequentProvider() || [];
      const filtered = (q ? all.filter((it) => String(it.value).toLowerCase().includes(q)) : all).slice(0, 8);
      if (!filtered.length) {
        frequentEl.style.display = 'none';
        rebuildItemEls();
        return;
      }
      frequentEl.style.display = '';
      const header = document.createElement('div');
      header.className = 'pb-newrec__lookup-section';
      header.textContent = t('lookupFrequentHeader');
      frequentEl.appendChild(header);
      filtered.forEach((entry) => {
        const item = document.createElement('div');
        item.className = 'pb-newrec__lookup-item pb-newrec__lookup-item--frequent';
        const main = document.createElement('div');
        main.className = 'pb-newrec__lookup-item-main';
        main.textContent = entry.value;
        item.appendChild(main);
        const sub = document.createElement('div');
        sub.className = 'pb-newrec__lookup-item-sub';
        sub.textContent = t('lookupFrequentCount', entry.count);
        item.appendChild(sub);
        item.addEventListener('mousedown', (e) => {
          e.preventDefault();
          applyFrequentPick(entry.value);
        });
        frequentItemEls.push(item);
        frequentItemValues.push(entry.value);
        frequentEl.appendChild(item);
      });
      rebuildItemEls();
    }

    function renderList() {
      if (!listEl) return;
      listEl.innerHTML = '';
      activeIndex = -1;
      regularItemEls = [];
      countEl.textContent = totalCount > records.length
        ? t('quickNewLookupCount', records.length, totalCount)
        : '';
      renderCacheLine();
      updateIndicator();
      if (!records.length) {
        setStatus(t('quickNewLookupEmpty'));
        rebuildItemEls();
        return;
      }
      records.forEach((record, idx) => {
        const item = document.createElement('div');
        item.className = 'pb-newrec__lookup-item';
        const main = document.createElement('div');
        main.className = 'pb-newrec__lookup-item-main';
        main.textContent = getDisplayValue(record, relatedKeyField);
        item.appendChild(main);
        const subFields = pickerFields.filter((f) => f !== relatedKeyField);
        if (subFields.length) {
          const sub = document.createElement('div');
          sub.className = 'pb-newrec__lookup-item-sub';
          sub.textContent = subFields.map((f) => getDisplayValue(record, f)).filter(Boolean).join('　');
          item.appendChild(sub);
        }
        item.addEventListener('mousedown', (e) => {
          e.preventDefault();
          applyPick(record);
        });
        regularItemEls[idx] = item;
        listEl.appendChild(item);
      });
      rebuildItemEls();
    }

    function filterLocal(keyword) {
      const q = keyword.toLowerCase();
      if (!q) return allLocalRecords.slice();
      const checkFields = pickerFields.length ? pickerFields : [relatedKeyField];
      return allLocalRecords.filter((record) =>
        checkFields.some((f) => getDisplayValue(record, f).toLowerCase().includes(q)));
    }

    // 実行中の非同期フェッチ(あれば)を無効化する。フルローカル/キャッシュ命中など
    // 同期的に結果を確定できる分岐が割り込むときに呼ぶ。無効化された側のfinallyは
    // seq不一致で自然にスキップされるので、loadingもここで一緒に倒しておく
    // （放置すると次回以降ずっと if (loading) return; に塞がれてしまう）
    function invalidatePendingFetch() {
      requestSeq += 1;
      loading = false;
    }

    async function load({ keyword = '', append = false } = {}) {
      ensureOpen();
      // Tier0: 参照先の取得状況とは無関係に、開いた瞬間・キーワード変化のたびに
      // 同期的に描画する（フェッチ中でも即座に見せるため）
      renderFrequentSection(keyword);
      // 全件ローカルモード: API消費ゼロで即時絞り込み
      if (fullLocal) {
        invalidatePendingFetch();
        records = filterLocal(keyword);
        totalCount = records.length;
        currentKeyword = keyword;
        renderList();
        return;
      }
      // Tier1: キーワードなし/appendなしの結果はタブキャッシュを先に見る。
      // append(無限スクロール追加読み込み)はオフセット付き部分結果になり
      // 管理が複雑になるだけで益が薄いため対象外(常に素通しでフェッチする)
      if (!append) {
        const now = Date.now();
        const cached = keyword
          ? lookupCacheGet(lookupKeywordCache, `${cacheKey}:${keyword}`, now)
          : lookupCacheGet(lookupFullCache, cacheKey, now);
        if (cached) {
          invalidatePendingFetch();
          records = cached.records;
          totalCount = cached.totalCount;
          currentKeyword = keyword;
          cacheServedAt = cached.fetchedAt;
          if (!keyword && records.length >= totalCount) {
            fullLocal = true;
            allLocalRecords = records.slice();
          }
          renderList();
          return;
        }
      }
      if (loading) return;
      loading = true;
      const seq = ++requestSeq;
      if (!append) setStatus(t('quickNewLoading'));
      try {
        const resp = await postFn('EXCEL_GET_LOOKUP_CANDIDATES', {
          relatedAppId,
          sort: '',
          keyword,
          keyField: relatedKeyField,
          offset: append ? records.length : 0,
          limit: LOCAL_FULL_LIMIT
        });
        if (seq !== requestSeq || !isOpen()) return;
        if (!resp?.ok) throw new Error(resp?.error || 'lookup fetch failed');
        const fetched = Array.isArray(resp?.result?.records) ? resp.result.records.map((r) => r.fields || r) : [];
        records = append ? records.concat(fetched) : fetched;
        totalCount = Number(resp?.result?.totalCount || fetched.length);
        currentKeyword = keyword;
        if (!append) {
          // 直接フェッチした結果はキャッシュ提供ではないので取得時刻行は出さない
          cacheServedAt = null;
          const entry = { records, totalCount, fetchedAt: Date.now() };
          if (keyword) {
            lookupCacheSet(lookupKeywordCache, `${cacheKey}:${keyword}`, entry, LOOKUP_KEYWORD_CACHE_MAX);
          } else {
            lookupFullCache.set(cacheKey, entry);
          }
        }
        // 検索なしの初回取得で全件が収まった → 以後はローカルモード
        if (!keyword && !append && records.length >= totalCount) {
          fullLocal = true;
          allLocalRecords = records.slice();
        }
        renderList();
      } catch (err) {
        if (seq !== requestSeq || !isOpen()) return;
        setStatus(t('quickNewLookupError'));
      } finally {
        if (seq === requestSeq) loading = false;
      }
    }

    // 「再読込」: 該当キャッシュだけ破棄してload()をやり直す。フルローカル状態も
    // 一緒に捨てる(古いキャッシュ前提で組んだローカルスナップショットごと作り直すため)
    async function reloadFromServer() {
      if (currentKeyword) {
        lookupKeywordCache.delete(`${cacheKey}:${currentKeyword}`);
      } else {
        lookupFullCache.delete(cacheKey);
      }
      fullLocal = false;
      allLocalRecords = null;
      await load({ keyword: currentKeyword });
    }

    // 手打ち: 入力値で検索して候補を表示（デバウンス内蔵。
    // 全件ローカルモードは体感即時、サーバーモードはAPI節約のため300ms）
    function search(keyword) {
      if (searchTimer) clearTimeout(searchTimer);
      const delay = fullLocal ? 100 : 300;
      searchTimer = setTimeout(() => {
        searchTimer = null;
        void load({ keyword: String(keyword || '').trim() });
      }, delay);
    }

    // キーボード操作: ↑↓でハイライト移動、Enterで確定/離脱。
    // Ctrl/Meta付きEnterはモーダル側の保存ショートカットに譲るため触らない。
    // 名前付き関数にしておく（グリッドは仮想化でinputを使い回すため、
    // destroy()でこのリスナーだけ確実に外せるようにする必要がある）
    function handleKeyInputKeydown(e) {
      if (e.key === 'ArrowDown') {
        if (!isOpen()) {
          e.preventDefault();
          search(keyInput.value);
          return;
        }
        e.preventDefault();
        moveActive(1);
        return;
      }
      if (e.key === 'ArrowUp') {
        if (!isOpen()) return;
        e.preventDefault();
        moveActive(-1);
        return;
      }
      if (e.key === 'Enter') {
        if (e.ctrlKey || e.metaKey) return;
        if (!isOpen()) return;
        // IME変換確定のEnterでドロップダウンを閉じてしまわないようにする
        if (e.isComposing || e.keyCode === 229) return;
        e.preventDefault();
        e.stopPropagation();
        // ハイライトが頻出セクション内か通常候補内かで確定処理を分ける
        // （通し番号はfrequentItemEls→regularItemElsの順で並んでいる）
        if (activeIndex >= 0 && activeIndex < frequentItemEls.length) {
          applyFrequentPick(frequentItemValues[activeIndex]);
          return;
        }
        const regularIndex = activeIndex - frequentItemEls.length;
        const picked = regularIndex >= 0 && regularIndex < records.length
          ? records[regularIndex]
          : findExactMatch(String(keyInput.value || '').trim());
        if (picked) {
          applyPick(picked);
        } else {
          close();
        }
      }
    }
    keyInput.addEventListener('keydown', handleKeyInputKeydown);

    return {
      isOpen,
      close,
      // 🔍ボタン: 全候補ブラウズ（開いていれば閉じるトグル）
      browse() {
        if (isOpen() && !currentKeyword) { close(); return; }
        void load({ keyword: '' });
        // 🔍ボタンから開いた直後でも↑↓/Enterがすぐ効くように、
        // キーボード操作の受け口である入力欄へフォーカスを移す
        try { keyInput.focus(); } catch (_e) { /* noop */ }
      },
      search,
      // グリッド専用: keyInputのリスナーごと完全に片付ける。
      // QNRモーダルはinputごとDOMを破棄するので使わず、close()のみで足りる
      destroy() {
        close();
        keyInput.removeEventListener('keydown', handleKeyInputKeydown);
      }
    };
  }

  // @@INCLUDE: content-quick-new-record-modal.js

  spaLifecycleReady = true;
  handleSpaLifecycle('boot_ready', location.href);
  if (shouldRetryAppOnlyInitialization()) {
    void waitForAppContextAndInit();
  }

})();
