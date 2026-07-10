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
      toastViewOnlyBlocked: "Pro 版のみ",
      overlayProOnly: "Pro 版のみ",
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
      overlayUnsupportedPage: "この画面では Excel Overlay を利用できません。一覧/詳細画面で利用できます。",
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
      modeViewOnly: "Standard",
      toastNoChanges: "No changes",
      toastInvalidCells: "Fix errors before saving",
      toastRequiredMissing: "Please fill required fields",
      toastViewOnlyBlocked: "Pro plan only",
      overlayProOnly: "Pro plan only",
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
      overlayUnsupportedPage: "Excel Overlay is only available on list/detail pages.",
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

  // @@INCLUDE: content-overlay-controller.js

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

  // ── Command Palette ──────────────────────────────────────────────────────

  const APP_CATALOG_REFRESH_KEYWORDS = ['refresh', 'reload', 'cache', 'キャッシュ', '更新', 'アプリ一覧'];

  // content.js is a classic content script (not an ES module), so it cannot import
  // core.js's buildKintoneUrl. This is a local copy scoped to the current tenant
  // (host defaults to location.origin) for the command palette's own app/record links.
  function buildCurrentTenantUrl(appId, options = {}) {
    const normalizedAppId = String(appId || '').trim();
    if (!normalizedAppId) return '';
    const encodedAppId = encodeURIComponent(normalizedAppId);
    const recordId = String(options.recordId || '').trim();
    if (recordId) {
      const encodedRecordId = encodeURIComponent(recordId);
      if (options.mode === 'edit') return `${location.origin}/k/${encodedAppId}/edit?record=${encodedRecordId}`;
      if (options.mode === 'print') return `${location.origin}/k/${encodedAppId}/print?record=${encodedRecordId}`;
      return `${location.origin}/k/${encodedAppId}/show#record=${encodedRecordId}`;
    }
    const base = `${location.origin}/k/${encodedAppId}/`;
    const viewId = String(options.viewId || '').trim();
    if (viewId) return `${base}?view=${encodeURIComponent(viewId)}`;
    return base;
  }

  const CP_COMMANDS = [
    // ─ App search ─
    {
      id: 'start-app-search',
      label: 'App検索を開始',
      icon: '⌕',
      category: 'app',
      badge: 'search',
      keywords: ['search', 'app', 'apps', 'アプリ', '検索'],
      keepOpen: true,
      action(_ctx, palette) {
        palette.startAppSearch();
      }
    },
    // ─ Nav ─
    {
      id: 'open-app-top',
      label: 'アプリトップへ',
      icon: '⌂',
      category: 'nav',
      badge: 'top',
      keywords: ['app', 'top', 'アプリ', 'トップ', 'cd'],
      requiresApp: true,
      action(ctx) { window.location.href = buildCurrentTenantUrl(ctx.appId); }
    },
    {
      id: 'open-portal',
      label: 'ポータルへ',
      icon: '⌂',
      category: 'nav',
      badge: 'portal',
      keywords: ['portal', 'ポータル', 'home', 'トップ'],
      action() { window.location.href = `${location.origin}/k/`; }
    },
    // ─ List: view / graph ─
    {
      id: 'switch-view',
      label: 'ビューを切り替え',
      icon: '▤',
      category: 'list',
      badge: 'view',
      keywords: ['view', 'switch', 'ビュー', '切替', '一覧'],
      requiresApp: true,
      keepOpen: true,
      action(ctx, palette) { palette.startSubPicker('view'); }
    },
    {
      id: 'open-graph-view',
      label: 'グラフビューへ',
      icon: '▲',
      category: 'list',
      badge: 'graph',
      keywords: ['graph', 'chart', 'グラフ', 'レポート', 'report'],
      requiresApp: true,
      keepOpen: true,
      action(ctx, palette) { palette.startSubPicker('graph'); }
    },
    // ─ Record detail ─
    {
      id: 'duplicate-record',
      label: 'レコードを複製',
      icon: '⧉',
      category: 'record',
      badge: 'dup',
      keywords: ['duplicate', 'copy', 'reuse', '複製', '再利用'],
      requiresRecord: true,
      action(ctx) { window.location.href = buildCurrentTenantUrl(ctx.appId, { recordId: ctx.recordId, mode: 'edit' }); }
    },
    {
      id: 'copy-record-link',
      label: 'レコードリンクをコピー',
      icon: 'L',
      category: 'record',
      badge: 'link',
      keywords: ['link', 'url', 'リンク', 'コピー', 'copy'],
      requiresRecord: true,
      action(ctx) {
        navigator.clipboard.writeText(buildCurrentTenantUrl(ctx.appId, { recordId: ctx.recordId }));
      }
    },
    {
      id: 'open-print-preview',
      label: '印刷プレビューへ',
      icon: 'P',
      category: 'record',
      badge: 'print',
      keywords: ['print', '印刷', 'プレビュー', 'preview'],
      requiresRecord: true,
      action(ctx) { window.location.href = buildCurrentTenantUrl(ctx.appId, { recordId: ctx.recordId, mode: 'print' }); }
    },
    // ─ Admin: navigation ─
    {
      id: 'open-form-settings',
      label: 'フォーム設定を開く',
      icon: '⚙',
      category: 'admin',
      badge: 'form',
      keywords: ['form', 'フォーム', '設定', 'admin'],
      requiresApp: true,
      action(ctx) { window.location.href = `/k/admin/app/flow?app=${ctx.appId}#section=form`; }
    },
    {
      id: 'open-process-settings',
      label: 'プロセス管理設定を開く',
      icon: '⚙',
      category: 'admin',
      badge: 'status',
      keywords: ['process', 'status', 'プロセス', '管理', 'workflow'],
      requiresApp: true,
      action(ctx) { window.location.href = `/k/admin/app/status?app=${ctx.appId}`; }
    },
    {
      id: 'open-api-token-settings',
      label: 'APIトークン設定を開く',
      icon: '⚙',
      category: 'admin',
      badge: 'apitoken',
      keywords: ['api', 'token', 'apitoken', 'トークン'],
      requiresApp: true,
      action(ctx) { window.location.href = `/k/admin/app/apitoken?app=${ctx.appId}`; }
    },
    {
      id: 'open-list-settings',
      label: '一覧設定を開く',
      icon: '⚙',
      category: 'admin',
      badge: 'view',
      keywords: ['list', 'view', '一覧', 'ビュー', '設定'],
      requiresApp: true,
      action(ctx) { window.location.href = `/k/admin/app/flow?app=${ctx.appId}#section=view`; }
    },
    {
      id: 'open-notification-settings',
      label: '通知条件を開く',
      icon: '⚙',
      category: 'admin',
      badge: 'notify',
      keywords: ['notification', 'notify', '通知', '条件', 'reminder'],
      requiresApp: true,
      keepOpen: true,
      action(ctx, palette) { palette.startSubPicker('notification'); }
    },
    {
      id: 'open-acl-settings',
      label: 'アクセス権を開く',
      icon: '⚙',
      category: 'admin',
      badge: 'acl',
      keywords: ['acl', 'access', 'permission', 'アクセス権', '権限'],
      requiresApp: true,
      keepOpen: true,
      action(ctx, palette) { palette.startSubPicker('acl'); }
    },
    {
      id: 'open-customize-settings',
      label: 'JS・CSSカスタマイズを開く',
      icon: '⚙',
      category: 'admin',
      badge: 'custom',
      keywords: ['customize', 'js', 'css', 'カスタマイズ', 'javascript'],
      requiresApp: true,
      action(ctx) { window.location.href = `/k/admin/app/customize?app=${ctx.appId}`; }
    },
    {
      id: 'open-plugin-settings',
      label: 'プラグイン設定を開く',
      icon: '⚙',
      category: 'admin',
      badge: 'plugin',
      keywords: ['plugin', 'プラグイン', '設定'],
      requiresApp: true,
      action(ctx) { window.location.href = `/k/admin/app/${ctx.appId}/plugin/#/`; }
    },
    {
      id: 'open-deploy',
      label: '運用環境へ反映',
      icon: '⚙',
      category: 'admin',
      badge: 'deploy',
      keywords: ['deploy', '反映', '運用', '公開', 'release'],
      requiresApp: true,
      action(ctx) { window.location.href = `/k/admin/preview/${ctx.appId}/`; }
    },
    // ─ Developer: clipboard ─
    {
      id: 'copy-app-id',
      label: 'App IDをコピー',
      icon: '#',
      category: 'dev',
      badge: 'appid',
      keywords: ['app', 'id', 'appid', 'copy'],
      requiresApp: true,
      action(ctx) {
        navigator.clipboard.writeText(String(ctx.appId));
      }
    },
    {
      id: 'copy-record-id',
      label: 'Record IDをコピー',
      icon: '#',
      category: 'dev',
      badge: 'recid',
      keywords: ['record', 'id', 'recid', 'recordid', 'copy'],
      requiresRecord: true,
      action(ctx) {
        navigator.clipboard.writeText(String(ctx.recordId));
      }
    },
    {
      id: 'copy-query',
      label: 'クエリ条件をコピー',
      icon: 'Q',
      category: 'dev',
      badge: 'query',
      keywords: ['query', 'クエリ', 'condition', '条件', 'copy'],
      requiresApp: true,
      action(ctx) {
        navigator.clipboard.writeText(ctx.query || '');
      }
    },
    {
      id: 'copy-field-codes',
      label: 'フィールドコード一覧をコピー',
      icon: '{}',
      category: 'dev',
      badge: 'fields',
      keywords: ['field', 'code', 'fields', 'copy'],
      requiresApp: true,
      isAsync: true,
      async action(ctx, palette) {
        await palette.copyFieldCodes(ctx);
      }
    },
    {
      id: 'copy-form-definition',
      label: 'フォーム定義をJSONで取得',
      icon: 'F',
      category: 'dev',
      badge: 'json',
      keywords: ['form', 'definition', 'json', 'フォーム', '定義', 'schema'],
      requiresApp: true,
      isAsync: true,
      async action(ctx, palette) {
        await palette.copyFormDefinition(ctx);
      }
    },
    // ─ Help ─
    {
      id: 'show-shortcut-help',
      label: 'ショートカットキー一覧を表示',
      icon: '?',
      category: 'help',
      badge: 'help',
      keywords: ['help', 'shortcut', 'ヘルプ', 'ショートカット', '一覧'],
      action() {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: '?', bubbles: true, cancelable: true }));
      }
    },
  ];

  class CommandPalette {
    constructor(postFn) {
      this.postFn = postFn;
      this.backdropEl = null;
      this.inputEl = null;
      this.listEl = null;
      this.footerEl = null;
      this.isOpen = false;
      this.ctx = { appId: null, recordId: null, query: '' };
      this.filtered = [];
      this.activeIndex = 0;
      this.appCatalog = [];
      this.appCatalogHost = '';
      this.appCatalogLoading = false;
      this.appCatalogLoaded = false;
      this.appSearchMode = false;
      this.shortcutCommands = [];
      this.shortcutBarEl = null;
      this.subPickerKind = null;
      this.viewPickerItems = [];
      this.viewPickerLoadedAppId = '';
      this.reportItems = [];
      this.reportItemsLoadedAppId = '';
      this.staticSubItems = [];
    }

    async fetchContext() {
      try {
        const res = await this.postFn('CP_GET_CONTEXT', {});
        if (res?.ok) this.ctx = { ...this.ctx, ...res.result };
      } catch (_) { /* ignore */ }
    }

    async fetchShortcutCommands() {
      try {
        const res = await chrome.runtime.sendMessage({ type: 'CP_GET_SHORTCUTS' });
        if (!res?.ok) { this.shortcutCommands = []; return; }
        const list = Array.isArray(res.shortcuts) ? res.shortcuts : [];
        this.shortcutCommands = list.slice(0, 9).map((entry, i) => ({
          id: `shortcut-${i}`,
          label: (entry.label || '').trim() || `ショートカット ${i + 1}`,
          icon: String(i + 1),
          category: 'shortcut',
          badge: `[${i + 1}]`,
          keywords: ['shortcut', 'ショートカット', String(i + 1)],
          _url: (() => {
            const host = String(entry.host || '').replace(/\/$/, '');
            const appId = String(entry.appId || '').trim();
            const type = entry.type || 'appTop';
            if (!host || !appId) return '';
            if (type === 'create') return `${host}/k/${encodeURIComponent(appId)}/edit`;
            const base = `${host}/k/${encodeURIComponent(appId)}/`;
            if (type === 'view') {
              const view = String(entry.viewIdOrName || '').trim();
              if (view) return `${base}?view=${encodeURIComponent(view)}`;
            }
            return base;
          })(),
          action(ctx, palette) {
            const url = this._url;
            if (!url) return;
            window.open(url, '_blank', 'noopener,noreferrer');
          }
        }));
      } catch (_) {
        this.shortcutCommands = [];
      }
    }

    async copyFieldCodes(ctx) {
      try {
        const res = await this.postFn('CP_GET_FIELDS', { appId: ctx.appId });
        if (!res?.ok) return;
        const fields = Array.isArray(res.result?.fields) ? res.result.fields : [];
        const text = fields.map((f) => `${f.code}\t${f.label || ''}\t${f.type || ''}`).join('\n');
        await navigator.clipboard.writeText(text);
      } catch (_) { /* ignore */ }
    }

    async copyFormDefinition(ctx) {
      try {
        const res = await this.postFn('CP_GET_FORM_DEFINITION', { appId: ctx.appId });
        if (!res?.ok) return;
        const properties = res.result?.properties || {};
        await navigator.clipboard.writeText(JSON.stringify(properties, null, 2));
      } catch (_) { /* ignore */ }
    }

    buildAclItems(ctx) {
      const appId = ctx.appId;
      return [
        { id: 'acl-app', label: 'アプリのアクセス権', icon: '⚙', badge: 'app', action: () => { window.location.href = `/k/admin/app/acl/app?app=${appId}`; } },
        { id: 'acl-record', label: 'レコードのアクセス権', icon: '⚙', badge: 'record', action: () => { window.location.href = `/k/admin/app/acl/record?app=${appId}`; } },
        { id: 'acl-field', label: 'フィールドのアクセス権', icon: '⚙', badge: 'field', action: () => { window.location.href = `/k/admin/app/acl/field?app=${appId}`; } }
      ];
    }

    buildNotificationItems(ctx) {
      const appId = ctx.appId;
      return [
        { id: 'notify-app', label: '全般通知', icon: '⚙', badge: 'app', action: () => { window.location.href = `/k/admin/app/notification?app=${appId}&trigger=app`; } },
        { id: 'notify-record', label: 'レコード単位の通知', icon: '⚙', badge: 'record', action: () => { window.location.href = `/k/admin/app/notification?app=${appId}&trigger=record`; } },
        { id: 'notify-reminder', label: 'リマインダー通知', icon: '⚙', badge: 'reminder', action: () => { window.location.href = `/k/admin/app/notification?app=${appId}&trigger=reminder`; } }
      ];
    }

    async startSubPicker(kind) {
      this.subPickerKind = kind;
      const PLACEHOLDERS = {
        view: 'ビュー名を検索...',
        graph: 'グラフ名を検索...',
        acl: '種類を選択...',
        notification: '種類を選択...'
      };
      if (this.inputEl) {
        this.inputEl.value = '';
        this.inputEl.placeholder = PLACEHOLDERS[kind] || '検索...';
        this.inputEl.focus();
      }
      if (kind === 'acl') { this.staticSubItems = this.buildAclItems(this.ctx); this.filter(''); return; }
      if (kind === 'notification') { this.staticSubItems = this.buildNotificationItems(this.ctx); this.filter(''); return; }
      this.filter('');
      if (kind === 'view') await this.loadViewPickerItems();
      if (kind === 'graph') await this.loadReportItems();
    }

    async loadViewPickerItems() {
      const appId = this.ctx.appId;
      if (!appId) { this.viewPickerItems = []; return; }
      if (this.viewPickerLoadedAppId === appId && this.viewPickerItems.length) {
        if (this.isOpen && this.subPickerKind === 'view') this.filter(this.inputEl?.value || '');
        return;
      }
      try {
        const res = await this.postFn('META_GET_VIEWS', { appId, source: 'command_palette' });
        if (!res?.ok) { this.viewPickerItems = []; return; }
        const views = res.views && typeof res.views === 'object' ? res.views : {};
        this.viewPickerItems = Object.values(views)
          .map((v) => ({
            id: `view-${v.id}`,
            label: v.name || `view-${v.id}`,
            icon: '▤',
            badge: v.type || '',
            action: () => {
              window.location.href = buildCurrentTenantUrl(appId, { viewId: v.id });
            }
          }))
          .sort((a, b) => String(a.label).localeCompare(String(b.label), 'ja'));
        this.viewPickerLoadedAppId = appId;
      } catch (_) {
        this.viewPickerItems = [];
      } finally {
        if (this.isOpen && this.subPickerKind === 'view') this.filter(this.inputEl?.value || '');
      }
    }

    async loadReportItems() {
      const appId = this.ctx.appId;
      if (!appId) { this.reportItems = []; return; }
      if (this.reportItemsLoadedAppId === appId && this.reportItems.length) {
        if (this.isOpen && this.subPickerKind === 'graph') this.filter(this.inputEl?.value || '');
        return;
      }
      try {
        const res = await this.postFn('CP_GET_REPORTS', { appId });
        if (!res?.ok) { this.reportItems = []; return; }
        const reports = Array.isArray(res.result?.reports) ? res.result.reports : [];
        this.reportItems = reports
          .map((r) => {
            const reportId = r?.id != null ? String(r.id) : '';
            return {
              id: `report-${reportId || r?.name || ''}`,
              label: r?.name || `report-${reportId}`,
              icon: '▲',
              badge: r?.chartType || 'graph',
              action: () => {
                window.location.href = reportId
                  ? `${location.origin}/k/${appId}/report?report=${reportId}`
                  : `${location.origin}/k/${appId}/report`;
              }
            };
          })
          .sort((a, b) => String(a.label).localeCompare(String(b.label), 'ja'));
        this.reportItemsLoadedAppId = appId;
      } catch (_) {
        this.reportItems = [];
      } finally {
        if (this.isOpen && this.subPickerKind === 'graph') this.filter(this.inputEl?.value || '');
      }
    }

    normalizeHost(host) {
      const raw = String(host || '').trim();
      if (!raw) return '';
      try {
        return new URL(raw).origin.replace(/\/$/, '').toLowerCase();
      } catch (_) {
        return raw.replace(/\/$/, '').toLowerCase();
      }
    }

    async loadAppCatalog(forceRefresh = false) {
      const host = this.normalizeHost(location.origin || '');
      if (!host) return;
      if (!forceRefresh && (this.appCatalogLoading || (this.appCatalogLoaded && this.appCatalogHost === host))) return;
      this.appCatalogLoading = true;
      this.appCatalogHost = host;
      try {
        const res = await chrome.runtime.sendMessage({
          type: 'GET_APP_SEARCH_CATALOG',
          payload: { host, forceRefresh }
        });
        const map = res?.map && typeof res.map === 'object' ? res.map : {};
        this.appCatalog = Object.entries(map)
          .map(([appIdRaw, nameRaw]) => {
            const appId = String(appIdRaw || '').trim();
            const name = String(nameRaw || '').trim();
            if (!/^\d+$/.test(appId) || !name) return null;
            return {
              id: `app-search-${host}-${appId}`,
              label: name,
              icon: '⌕',
              category: 'app',
              badge: `app:${appId}`,
              appId,
              host,
              searchText: `${name}\n${appId}`.toLowerCase(),
              action: async (_ctx, _palette, options = {}) => {
                const url = `${host}/k/${encodeURIComponent(appId)}/`;
                if (options.newTab) {
                  try {
                    const res = await chrome.runtime.sendMessage({
                      type: 'PB_OPEN_APP_SEARCH_TAB',
                      payload: { url }
                    });
                    if (res?.ok) return;
                  } catch (_) {
                    // Fall back to browser default when the service worker is unavailable.
                  }
                  window.open(url, '_blank');
                  return;
                }
                window.location.href = url;
              }
            };
          })
          .filter(Boolean)
          .sort((a, b) => {
            const byName = String(a.label || '').localeCompare(String(b.label || ''), 'ja');
            if (byName !== 0) return byName;
            return String(a.appId || '').localeCompare(String(b.appId || ''), 'ja');
          });
        this.appCatalogLoaded = true;
        if (this.isOpen) this.filter(this.inputEl?.value || '');
      } catch (_) {
        this.appCatalog = [];
        this.appCatalogLoaded = true;
      } finally {
        this.appCatalogLoading = false;
      }
    }

    buildAppCatalogRefreshItem() {
      return {
        id: 'refresh-app-catalog-inline',
        label: 'アプリ一覧キャッシュを更新',
        icon: '⟳',
        badge: 'refresh',
        keepOpen: true,
        action: async (_ctx, palette) => { await palette.refreshAppCatalog(); }
      };
    }

    searchApps(query, limit = 8) {
      const q = String(query || '').trim().toLowerCase();
      if (!q) return [];
      const prefix = [];
      const partial = [];
      this.appCatalog.forEach((app) => {
        const label = String(app.label || '').toLowerCase();
        const appId = String(app.appId || '').toLowerCase();
        if (label.startsWith(q) || appId.startsWith(q)) {
          prefix.push(app);
          return;
        }
        if (app.searchText.includes(q)) {
          partial.push(app);
        }
      });
      return [...prefix, ...partial].slice(0, limit);
    }

    startAppSearch() {
      this.appSearchMode = true;
      if (this.inputEl) {
        this.inputEl.value = '';
        this.inputEl.placeholder = 'App名またはApp IDを検索...';
        this.inputEl.focus();
      }
      this.loadAppCatalog();
      this.filter('');
    }

    async refreshAppCatalog() {
      if (this.inputEl) this.inputEl.placeholder = 'アプリ一覧を更新しています...';
      this.appCatalogLoaded = false;
      await this.loadAppCatalog(true);
      if (this.inputEl) {
        this.inputEl.placeholder = this.appSearchMode ? 'App名またはApp IDを検索...' : 'コマンドを検索...';
      }
      if (this.appSearchMode) this.filter(this.inputEl?.value || '');
    }

    mount() {
      const backdrop = document.createElement('div');
      backdrop.id = 'pb-command-palette-backdrop';
      backdrop.addEventListener('mousedown', (e) => {
        if (e.target === backdrop) this.close();
      });

      const panel = document.createElement('div');
      panel.id = 'pb-command-palette';

      const searchWrap = document.createElement('div');
      searchWrap.className = 'pb-cp__search-wrap';

      const icon = document.createElement('span');
      icon.className = 'pb-cp__search-icon';
      icon.textContent = '⌕';

      const input = document.createElement('input');
      input.className = 'pb-cp__search-input';
      input.type = 'text';
      input.placeholder = 'コマンドを検索...';
      input.autocomplete = 'off';
      input.spellcheck = false;
      input.addEventListener('input', () => this.filter(input.value));
      input.addEventListener('keydown', (e) => {
        e.stopPropagation();
        this.handleKey(e);
      });
      this.inputEl = input;

      searchWrap.append(icon, input);

      const list = document.createElement('div');
      list.className = 'pb-cp__list';
      this.listEl = list;

      const footer = document.createElement('div');
      footer.className = 'pb-cp__footer';
      footer.innerHTML = '<span><kbd>↑↓</kbd> 移動</span><span><kbd>Enter</kbd> 実行</span><span><kbd>Esc</kbd> 閉じる</span>';
      this.footerEl = footer;

      const shortcutBar = document.createElement('div');
      shortcutBar.className = 'pb-cp__shortcut-bar';
      this.shortcutBarEl = shortcutBar;

      const style = document.createElement('style');
      style.textContent = `
        #pb-command-palette-backdrop{position:fixed!important;inset:0!important;background:rgba(0,0,0,.4)!important;z-index:2147483647!important;display:none!important;align-items:flex-start!important;justify-content:center!important;padding-top:12vh!important}
        #pb-command-palette-backdrop[style*="flex"]{display:flex!important}
        #pb-command-palette{width:560px!important;max-width:calc(100vw - 32px)!important;background:#fff!important;border-radius:12px!important;box-shadow:0 24px 64px rgba(0,0,0,.25),0 4px 16px rgba(0,0,0,.12)!important;overflow:hidden!important;display:flex!important;flex-direction:column!important;max-height:72vh!important;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif!important;font-size:14px!important;line-height:1.5!important;color:#374151!important}
        #pb-command-palette *{box-sizing:border-box!important;margin:0!important;padding:0!important}
        #pb-command-palette .pb-cp__search-wrap{display:flex!important;align-items:center!important;padding:0 14px!important;border-bottom:1px solid #e5e7eb!important;gap:10px!important;flex-shrink:0!important}
        #pb-command-palette .pb-cp__search-icon{color:#9ca3af!important;font-size:20px!important;flex-shrink:0!important;line-height:1!important}
        #pb-command-palette .pb-cp__search-input{flex:1!important;border:none!important;outline:none!important;height:48px!important;font-size:15px!important;color:#111827!important;background:transparent!important;font-family:inherit!important;box-shadow:none!important;width:auto!important}
        #pb-command-palette .pb-cp__search-input::placeholder{color:#9ca3af!important}
        #pb-command-palette .pb-cp__list{overflow-y:auto!important;padding:6px 0!important;flex:1!important;min-height:0!important}
        #pb-command-palette .pb-cp__group-label{padding:10px 16px 4px!important;font-size:10px!important;font-weight:700!important;color:#9ca3af!important;letter-spacing:.1em!important;text-transform:uppercase!important;display:block!important}
        #pb-command-palette .pb-cp__item{display:flex!important;align-items:center!important;gap:10px!important;padding:8px 14px!important;cursor:pointer!important;font-size:13px!important;color:#374151!important;background:transparent!important;width:100%!important}
        #pb-command-palette .pb-cp__item:hover,#pb-command-palette .pb-cp__item--active{background:#eff6ff!important;color:#1d4ed8!important}
        #pb-command-palette .pb-cp__item-icon{width:28px!important;height:28px!important;display:flex!important;align-items:center!important;justify-content:center!important;background:#f3f4f6!important;border-radius:6px!important;font-size:13px!important;flex-shrink:0!important;color:#6b7280!important}
        #pb-command-palette .pb-cp__item--active .pb-cp__item-icon{background:#dbeafe!important;color:#1d4ed8!important}
        #pb-command-palette .pb-cp__item-text{flex:1!important;min-width:0!important;display:flex!important;flex-direction:column!important;gap:1px!important}
        #pb-command-palette .pb-cp__item-label{white-space:nowrap!important;overflow:hidden!important;text-overflow:ellipsis!important}
        #pb-command-palette .pb-cp__item-sub{font-size:11px!important;color:#9ca3af!important;white-space:nowrap!important;overflow:hidden!important;text-overflow:ellipsis!important}
        #pb-command-palette .pb-cp__item--active .pb-cp__item-sub{color:#60a5fa!important}
        #pb-command-palette .pb-cp__item-badge{font-size:10px!important;padding:2px 8px!important;border-radius:9999px!important;background:#f3f4f6!important;color:#6b7280!important;font-weight:600!important;font-family:ui-monospace,monospace!important;flex-shrink:0!important;white-space:nowrap!important;letter-spacing:.02em!important}
        #pb-command-palette .pb-cp__item--active .pb-cp__item-badge{background:#dbeafe!important;color:#3b82f6!important}
        #pb-command-palette .pb-cp__empty{padding:32px 16px!important;text-align:center!important;color:#9ca3af!important;font-size:13px!important;display:block!important}
        #pb-command-palette .pb-cp__shortcut-bar{border-top:1px solid #e5e7eb!important;padding:8px 12px!important;display:flex!important;gap:6px!important;flex-wrap:wrap!important;flex-shrink:0!important;background:#fafafa!important}
        #pb-command-palette .pb-cp__shortcut-bar:empty{display:none!important}
        #pb-command-palette .pb-cp__sc-btn{display:flex!important;align-items:center!important;gap:5px!important;padding:4px 8px!important;border-radius:6px!important;border:1px solid #e5e7eb!important;background:#fff!important;cursor:pointer!important;font-size:12px!important;color:#374151!important;font-family:inherit!important;max-width:100px!important;transition:background .1s,border-color .1s!important}
        #pb-command-palette .pb-cp__sc-btn:hover{background:#eff6ff!important;border-color:#bfdbfe!important;color:#1d4ed8!important}
        #pb-command-palette .pb-cp__sc-btn-num{font-size:10px!important;font-weight:700!important;background:#f3f4f6!important;border-radius:3px!important;padding:0 4px!important;color:#9ca3af!important;font-family:ui-monospace,monospace!important;flex-shrink:0!important}
        #pb-command-palette .pb-cp__sc-btn:hover .pb-cp__sc-btn-num{background:#dbeafe!important;color:#3b82f6!important}
        #pb-command-palette .pb-cp__sc-btn-label{white-space:nowrap!important;overflow:hidden!important;text-overflow:ellipsis!important}
        #pb-command-palette .pb-cp__footer{border-top:1px solid #f3f4f6!important;padding:8px 16px!important;display:flex!important;gap:16px!important;font-size:11px!important;color:#9ca3af!important;flex-shrink:0!important}
        #pb-command-palette .pb-cp__footer kbd{display:inline-block!important;background:#f3f4f6!important;border:1px solid #e5e7eb!important;border-radius:4px!important;padding:1px 5px!important;font-size:10px!important;color:#6b7280!important;font-family:inherit!important}
      `;

      panel.append(searchWrap, list, shortcutBar, footer);
      backdrop.append(style, panel);
      document.body.appendChild(backdrop);
      this.backdropEl = backdrop;
    }

    renderShortcutBar() {
      if (!this.shortcutBarEl) return;
      this.shortcutBarEl.innerHTML = '';
      this.shortcutCommands.forEach((cmd, i) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'pb-cp__sc-btn';
        btn.title = cmd.label;

        const num = document.createElement('span');
        num.className = 'pb-cp__sc-btn-num';
        num.textContent = String(i + 1);

        const label = document.createElement('span');
        label.className = 'pb-cp__sc-btn-label';
        label.textContent = cmd.label;

        btn.append(num, label);
        btn.addEventListener('mousedown', (e) => {
          e.preventDefault();
          cmd.action(this.ctx, this);
          this.close();
        });
        this.shortcutBarEl.appendChild(btn);
      });
    }

    filter(query) {
      const q = String(query || '').trim().toLowerCase();
      if (this.appSearchMode) {
        this.filtered = this.searchApps(q);
        if (q && APP_CATALOG_REFRESH_KEYWORDS.some((k) => k.includes(q))) {
          this.filtered = [this.buildAppCatalogRefreshItem(), ...this.filtered];
        }
        this.activeIndex = 0;
        this.renderFooter();
        this.renderList();
        return;
      }
      if (this.subPickerKind) {
        let scoped;
        if (this.subPickerKind === 'view') scoped = this.viewPickerItems;
        else if (this.subPickerKind === 'graph') scoped = this.reportItems;
        else scoped = this.staticSubItems;
        this.filtered = q ? scoped.filter((v) => String(v.label).toLowerCase().includes(q)) : scoped;
        this.activeIndex = 0;
        this.renderFooter();
        this.renderList();
        return;
      }
      const allCmds = [...CP_COMMANDS, ...this.shortcutCommands];
      const cmds = allCmds.filter((cmd) => {
        if (cmd.requiresApp && !this.ctx.appId) return false;
        if (cmd.requiresRecord && !this.ctx.recordId) return false;
        if (!q) return true;
        if (cmd.label.toLowerCase().includes(q)) return true;
        return (cmd.keywords || []).some((k) => k.toLowerCase().includes(q));
      });
      this.filtered = cmds;
      this.activeIndex = 0;
      this.renderFooter();
      this.renderList();
    }

    renderFooter() {
      if (!this.footerEl) return;
      if (this.appSearchMode) {
        this.footerEl.innerHTML = '<span><kbd>↑↓</kbd> 移動</span><span><kbd>Enter</kbd> 開く</span><span><kbd>Shift</kbd>+<kbd>Enter</kbd> 新規タブ</span><span><kbd>Esc</kbd> 閉じる</span>';
      } else if (this.subPickerKind) {
        this.footerEl.innerHTML = '<span><kbd>↑↓</kbd> 移動</span><span><kbd>Enter</kbd> 開く</span><span><kbd>Esc</kbd> 閉じる</span>';
      } else {
        this.footerEl.innerHTML = '<span><kbd>↑↓</kbd> 移動</span><span><kbd>Enter</kbd> 実行</span><span><kbd>Esc</kbd> 閉じる</span>';
      }
    }

    renderList() {
      if (!this.listEl) return;
      this.listEl.innerHTML = '';
      if (!this.filtered.length) {
        const empty = document.createElement('div');
        empty.className = 'pb-cp__empty';
        if (this.appSearchMode) {
          const q = String(this.inputEl?.value || '').trim();
          empty.textContent = this.appCatalogLoading
            ? 'App一覧を読み込んでいます...'
            : (q ? '該当するAppが見つかりません' : 'App名またはApp IDを入力してください');
        } else if (this.subPickerKind) {
          const emptyText = {
            view: 'ビューが見つかりません',
            graph: 'グラフビューが見つかりません',
            acl: '項目が見つかりません',
            notification: '項目が見つかりません'
          };
          empty.textContent = emptyText[this.subPickerKind] || '該当する項目が見つかりません';
        } else {
          empty.textContent = '該当するコマンドが見つかりません';
        }
        this.listEl.appendChild(empty);
        return;
      }
      const CATEGORY_LABELS = {
        shortcut: 'SHORTCUTS', admin: 'ADMIN', dev: 'DEV', app: 'APP',
        nav: 'NAV', list: 'LIST', record: 'RECORD', help: 'HELP'
      };
      let lastCategory = null;
      this.filtered.forEach((cmd, i) => {
        if (cmd.category && cmd.category !== lastCategory) {
          const grp = document.createElement('div');
          grp.className = 'pb-cp__group-label';
          grp.textContent = CATEGORY_LABELS[cmd.category] || cmd.category.toUpperCase();
          this.listEl.appendChild(grp);
          lastCategory = cmd.category;
        }

        const item = document.createElement('div');
        item.className = 'pb-cp__item' + (i === this.activeIndex ? ' pb-cp__item--active' : '');

        const icon = document.createElement('span');
        icon.className = 'pb-cp__item-icon';
        icon.textContent = cmd.icon || '›';

        const text = document.createElement('span');
        text.className = 'pb-cp__item-text';

        const label = document.createElement('span');
        label.className = 'pb-cp__item-label';
        label.textContent = cmd.label;
        text.appendChild(label);

        if (cmd.category === 'app' && cmd.appId) {
          const sub = document.createElement('span');
          sub.className = 'pb-cp__item-sub';
          sub.textContent = cmd.host || location.origin || '';
          text.appendChild(sub);
        }

        const badge = document.createElement('span');
        badge.className = 'pb-cp__item-badge';
        badge.textContent = cmd.badge || '';

        item.append(icon, text, badge);
        item.addEventListener('mousedown', (e) => {
          e.preventDefault();
          this.execute(i);
        });
        item.addEventListener('mousemove', () => {
          if (this.activeIndex !== i) {
            this.activeIndex = i;
            this.renderList();
          }
        });
        this.listEl.appendChild(item);
      });
      const activeEl = this.listEl.querySelector('.pb-cp__item--active');
      if (activeEl) activeEl.scrollIntoView({ block: 'nearest' });
    }

    handleKey(e) {
      if (e.key === 'Escape') { this.close(); return; }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        this.activeIndex = Math.min(this.activeIndex + 1, this.filtered.length - 1);
        this.renderList();
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        this.activeIndex = Math.max(this.activeIndex - 1, 0);
        this.renderList();
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        this.execute(this.activeIndex, { newTab: this.appSearchMode && e.shiftKey });
        return;
      }
    }

    execute(index, options = {}) {
      const cmd = this.filtered[index];
      if (!cmd) return;
      if (!cmd.keepOpen) this.close();
      if (cmd.isAsync) {
        cmd.action(this.ctx, this, options);
      } else {
        cmd.action(this.ctx, this, options);
      }
    }

    async open() {
      if (!this.backdropEl) this.mount();
      await Promise.all([this.fetchContext(), this.fetchShortcutCommands()]);
      this.backdropEl.style.display = 'flex';
      this.isOpen = true;
      this.appSearchMode = false;
      this.subPickerKind = null;
      this.renderShortcutBar();
      this.filter('');
      if (this.inputEl) {
        this.inputEl.value = '';
        this.inputEl.placeholder = 'コマンドを検索...';
        this.inputEl.focus();
      }
    }

    close() {
      if (this.backdropEl) this.backdropEl.style.display = 'none';
      this.isOpen = false;
    }

    toggle() {
      if (this.isOpen) this.close(); else this.open();
    }
  }

  const commandPalette = new CommandPalette(postToPage);

  document.addEventListener('keydown', (e) => {
    if (e.key === '/' && (e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey) {
      e.preventDefault();
      commandPalette.toggle();
      return;
    }
  }, true);

  // ── End Command Palette ──────────────────────────────────────────────────

  // ── Lookup Picker (shared by overlay modal and QuickNewRecordModal) ───────

  function buildNewRecordLookupPicker(anchorEl, relatedAppId, relatedKeyField, pickerFields, mappings, fieldInputMap, keyInput, postFn, language) {
    document.querySelectorAll('.pb-newrec__lookup-picker').forEach((el) => el.remove());
    if (!relatedAppId) return;

    const picker = document.createElement('div');
    picker.className = 'pb-newrec__lookup-picker';

    const searchWrap = document.createElement('div');
    searchWrap.className = 'pb-newrec__lookup-search';
    const searchInput = document.createElement('input');
    searchInput.type = 'text';
    searchInput.className = 'pb-newrec__lookup-search-input';
    searchInput.placeholder = '検索...';
    searchWrap.appendChild(searchInput);

    const list = document.createElement('div');
    list.className = 'pb-newrec__lookup-list';
    const loadingEl = document.createElement('div');
    loadingEl.className = 'pb-newrec__lookup-status';
    loadingEl.textContent = resolveText(language, 'quickNewLoading');
    list.appendChild(loadingEl);

    picker.appendChild(searchWrap);
    picker.appendChild(list);
    anchorEl.appendChild(picker);

    let allRecords = [];

    function getDisplayValue(record, fieldCode) {
      const v = record[fieldCode];
      if (!v) return '';
      const val = v.value;
      if (Array.isArray(val)) return val.map((item) => (typeof item === 'object' ? item.value || '' : String(item))).join(', ');
      return String(val ?? '');
    }

    function renderList(records) {
      list.innerHTML = '';
      if (!records.length) {
        const empty = document.createElement('div');
        empty.className = 'pb-newrec__lookup-status';
        empty.textContent = 'レコードがありません';
        list.appendChild(empty);
        return;
      }
      records.forEach((record) => {
        const item = document.createElement('div');
        item.className = 'pb-newrec__lookup-item';
        const mainVal = getDisplayValue(record, relatedKeyField);
        const main = document.createElement('div');
        main.className = 'pb-newrec__lookup-item-main';
        main.textContent = mainVal;
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
          keyInput.value = mainVal;
          const entry = fieldInputMap.get(keyInput.closest('[data-field-code]')?.dataset.fieldCode || '');
          mappings.forEach((m) => {
            const autoEntry = fieldInputMap.get(m.field);
            if (autoEntry?.setValue) autoEntry.setValue(getDisplayValue(record, m.relatedField));
          });
          picker.remove();
        });
        list.appendChild(item);
      });
    }

    searchInput.addEventListener('input', () => {
      const q = searchInput.value.toLowerCase();
      if (!q) { renderList(allRecords); return; }
      const filtered = allRecords.filter((record) => {
        const checkFields = pickerFields.length ? pickerFields : [relatedKeyField];
        return checkFields.some((f) => getDisplayValue(record, f).toLowerCase().includes(q));
      });
      renderList(filtered);
    });

    document.addEventListener('mousedown', function onOutside(e) {
      if (!picker.contains(e.target) && e.target !== anchorEl) {
        picker.remove();
        document.removeEventListener('mousedown', onOutside, true);
      }
    }, true);

    void (async () => {
      try {
        const resp = await postFn('EXCEL_GET_LOOKUP_CANDIDATES', {
          relatedAppId,
          sort: ''
        });
        allRecords = Array.isArray(resp?.result?.records) ? resp.result.records.map((r) => r.fields || r) : [];
        renderList(allRecords);
        searchInput.focus();
      } catch (err) {
        list.innerHTML = '';
        const errEl = document.createElement('div');
        errEl.className = 'pb-newrec__lookup-status';
        errEl.textContent = '取得に失敗しました';
        list.appendChild(errEl);
      }
    })();
  }

  // ── Quick New Record Modal ───────────────────────────────────────────────

  const NON_EDITABLE_QNR_TYPES = new Set([
    'RECORD_NUMBER', 'CREATED_TIME', 'UPDATED_TIME', 'CREATOR', 'MODIFIER',
    'STATUS', 'STATUS_ASSIGNEE', 'CALC', 'REFERENCE_TABLE', 'RICH_TEXT',
    'SUBTABLE', 'FILE'
  ]);

  class QuickNewRecordModal {
    constructor(postFn) {
      this.postFn = postFn;
      this.el = null;
      this.kintoneTimezone = _browserTz;
    }

    isVisible() { return Boolean(this.el); }

    close() {
      if (this.el) { this.el.remove(); this.el = null; }
    }

    async open() {
      if (this.el) { this.close(); return; }
      const listCtx = parseListOverlayContext(location.href);
      if (!listCtx?.appId) return;
      const appId = listCtx.appId;
      const listUrl = listCtx.href;

      ensureOverlayCss();
      const { language } = await resolveOverlayUiLanguage();
      const t = (key) => resolveText(language, key);
      try {
        const userRes = await this.postFn('EXCEL_GET_LOGIN_USER');
        const timezone = String(userRes?.user?.timezone || '').trim();
        if (timezone) this.kintoneTimezone = timezone;
      } catch (_err) {
        this.kintoneTimezone = _browserTz;
      }

      // Loading backdrop
      const layer = this._buildLayer();
      const panel = document.createElement('div');
      panel.className = 'pb-newrec__panel';
      const loadingEl = document.createElement('div');
      loadingEl.className = 'pb-newrec__body';
      loadingEl.style.alignItems = 'center';
      loadingEl.style.justifyContent = 'center';
      loadingEl.style.minHeight = '80px';
      loadingEl.textContent = t('quickNewLoading');
      panel.appendChild(loadingEl);
      layer.appendChild(panel);
      document.body.appendChild(layer);
      this.el = layer;

      try {
        // Load fields
        const fieldsRes = await this.postFn('EXCEL_GET_FIELDS_META', { appId });
        const allFieldsMeta = (fieldsRes?.ok && Array.isArray(fieldsRes.fieldsMeta))
          ? fieldsRes.fieldsMeta
          : [];
        const allFieldsMap = new Map(allFieldsMeta.map((f) => [f.code, f]));

        // Load layout presets
        const appKey = `${String(location.origin || '').trim()}::${appId}`;
        let presets = [];
        let activePresetId = '';
        try {
          const stored = await chrome.storage.local.get(OVERLAY_LAYOUT_PRESETS_KEY);
          const presetsMap = stored?.[OVERLAY_LAYOUT_PRESETS_KEY];
          const state = presetsMap && typeof presetsMap === 'object' ? presetsMap[appKey] : null;
          presets = Array.isArray(state?.presets) ? state.presets : [];
          activePresetId = String(state?.activePresetId || '').trim();
        } catch (_err) { /* use defaults */ }

        if (!presets.length) {
          // fallback: show all editable fields
          const fallback = allFieldsMeta.filter((f) => !NON_EDITABLE_QNR_TYPES.has(String(f.type || '').toUpperCase()) && !f.lookupAuto);
          presets = [{ id: 'default', name: t('layoutPresetDefault'), columnOrder: fallback.map((f) => f.code), visibleColumns: fallback.map((f) => f.code) }];
          activePresetId = 'default';
        }

        // Rebuild panel
        panel.innerHTML = '';
        this._buildContent(panel, appId, language, allFieldsMap, presets, activePresetId, listUrl);
      } catch (err) {
        console.error('[kintone-excel-overlay] quick new record load failed', err);
        this.close();
      }
    }

    _buildLayer() {
      const layer = document.createElement('div');
      layer.className = 'pb-newrec__layer pb-newrec__layer--standalone';
      layer.addEventListener('mousedown', (e) => { if (e.target === layer) this.close(); });
      return layer;
    }

    _getFieldsForPreset(preset, allFieldsMap) {
      const visible = new Set(Array.isArray(preset.visibleColumns) ? preset.visibleColumns : []);
      const order = Array.isArray(preset.columnOrder) ? preset.columnOrder : [];
      const codes = order.filter((c) => visible.size === 0 || visible.has(c));

      const isLookupKey = (f) => !f.lookupAuto && (String(f.type || '').toUpperCase() === 'LOOKUP' || Boolean(f.lookup));

      // Build set of auto-fill destinations so we can inject them after their LOOKUP
      const lookupAutoSet = new Set();
      allFieldsMap.forEach((f) => {
        if (isLookupKey(f) && Array.isArray(f.lookup?.fieldMappings)) {
          f.lookup.fieldMappings.forEach((m) => { if (m.field) lookupAutoSet.add(m.field); });
        }
      });

      const result = [];
      const added = new Set();
      codes.forEach((code) => {
        const f = allFieldsMap.get(code);
        if (!f) return;
        const type = String(f.type || '').toUpperCase();
        if (NON_EDITABLE_QNR_TYPES.has(type)) return;
        if (lookupAutoSet.has(f.code)) return;
        if (f.lookupAuto) return;
        if (added.has(f.code)) return;
        result.push(f);
        added.add(f.code);
        if (isLookupKey(f) && Array.isArray(f.lookup?.fieldMappings)) {
          f.lookup.fieldMappings.forEach((m) => {
            const autoField = allFieldsMap.get(m.field);
            if (autoField && !added.has(m.field)) {
              result.push({ ...autoField, _isLookupAuto: true, _lookupSourceCode: f.code });
              added.add(m.field);
            }
          });
        }
      });
      return result;
    }

    _buildContent(panel, appId, language, allFieldsMap, presets, activePresetId, listUrl) {
      const t = (key) => resolveText(language, key);

      // Header
      const head = document.createElement('div');
      head.className = 'pb-newrec__head';
      const title = document.createElement('div');
      title.className = 'pb-newrec__title';
      title.textContent = t('newRecordTitle');
      const closeBtn = document.createElement('button');
      closeBtn.type = 'button';
      closeBtn.className = 'pb-newrec__close';
      closeBtn.textContent = '×';
      closeBtn.setAttribute('aria-label', t('newRecordCancel'));
      closeBtn.addEventListener('click', () => this.close());
      head.appendChild(title);
      head.appendChild(closeBtn);

      // Preset selector
      const presetRow = document.createElement('div');
      presetRow.className = 'pb-newrec__preset-row';
      const presetLabelEl = document.createElement('label');
      presetLabelEl.className = 'pb-newrec__preset-label';
      presetLabelEl.textContent = t('quickNewPresetLabel');
      const presetSelect = document.createElement('select');
      presetSelect.className = 'pb-newrec__select pb-newrec__preset-select';
      presets.forEach((p) => {
        const opt = document.createElement('option');
        opt.value = p.id;
        opt.textContent = p.name || p.id;
        opt.selected = p.id === activePresetId;
        presetSelect.appendChild(opt);
      });
      presetRow.appendChild(presetLabelEl);
      presetRow.appendChild(presetSelect);

      // Body (form fields)
      const body = document.createElement('div');
      body.className = 'pb-newrec__body';

      // Footer
      const foot = document.createElement('div');
      foot.className = 'pb-newrec__foot';
      const cancelBtn = document.createElement('button');
      cancelBtn.type = 'button';
      cancelBtn.className = 'pb-overlay__btn';
      cancelBtn.textContent = t('newRecordCancel');
      cancelBtn.addEventListener('click', () => this.close());
      const saveBtn = document.createElement('button');
      saveBtn.type = 'button';
      saveBtn.className = 'pb-overlay__btn pb-overlay__btn--primary';
      saveBtn.textContent = t('newRecordSave');
      foot.appendChild(cancelBtn);
      foot.appendChild(saveBtn);

      let fieldInputMap = new Map();
      const renderBody = (presetId) => {
        body.innerHTML = '';
        fieldInputMap = new Map();
        const preset = presets.find((p) => p.id === presetId) || presets[0];
        const fields = this._getFieldsForPreset(preset, allFieldsMap);
        if (!fields.length) {
          const empty = document.createElement('div');
          empty.className = 'pb-newrec__empty';
          empty.textContent = t('quickNewNoFields');
          body.appendChild(empty);
          return;
        }
        fields.forEach((field) => {
          const row = document.createElement('div');
          row.className = 'pb-newrec__field-row';
          const labelEl = document.createElement('label');
          labelEl.className = 'pb-newrec__label';
          const labelText = document.createElement('span');
          labelText.textContent = field.label || field.code;
          if (field.required) {
            const req = document.createElement('span');
            req.className = 'pb-newrec__required';
            req.textContent = ' *';
            labelText.appendChild(req);
          }
          labelEl.appendChild(labelText);
          const controlWrap = document.createElement('div');
          controlWrap.className = 'pb-newrec__control';
          const type = String(field.type || '').toUpperCase();
          let getValue;
          let setValue;

          if (field._isLookupAuto) {
            const input = document.createElement('input');
            input.type = 'text';
            input.className = 'pb-newrec__input pb-newrec__input--lookup-auto';
            input.readOnly = true;
            input.placeholder = '—';
            controlWrap.appendChild(input);
            getValue = () => input.value;
            setValue = (v) => { input.value = v; };
            row.classList.add('pb-newrec__field-row--lookup-auto');
          } else if (type === 'LOOKUP' || (!field._isLookupAuto && field.lookup)) {
            const wrap = document.createElement('div');
            wrap.className = 'pb-newrec__lookup-wrap';
            const input = document.createElement('input');
            input.type = 'text';
            input.className = 'pb-newrec__input';
            input.readOnly = true;
            const searchBtn = document.createElement('button');
            searchBtn.type = 'button';
            searchBtn.className = 'pb-newrec__lookup-btn';
            searchBtn.textContent = '🔍';
            wrap.appendChild(input);
            wrap.appendChild(searchBtn);
            controlWrap.appendChild(wrap);
            getValue = () => input.value;
            setValue = (v) => { input.value = v; };
            const lookupInfo = field.lookup || {};
            const relatedAppId = String(
              lookupInfo.relatedApp?.app || lookupInfo.relatedApp?.code || lookupInfo.relatedApp || ''
            ).trim();
            const relatedKeyField = String(lookupInfo.relatedKeyField || lookupInfo.keyField || '').trim();
            const pickerFields = Array.isArray(lookupInfo.lookupPickerFields) ? lookupInfo.lookupPickerFields : [];
            const mappings = Array.isArray(lookupInfo.fieldMappings) ? lookupInfo.fieldMappings : [];
            searchBtn.addEventListener('click', () => {
              buildNewRecordLookupPicker(wrap, relatedAppId, relatedKeyField, pickerFields, mappings, fieldInputMap, input, this.postFn, language);
            });
          } else if (type === 'MULTI_LINE_TEXT') {
            const ta = document.createElement('textarea');
            ta.className = 'pb-newrec__textarea';
            ta.rows = 3;
            controlWrap.appendChild(ta);
            getValue = () => ta.value;
            setValue = (v) => { ta.value = String(v ?? ''); };
          } else if (type === 'DROP_DOWN' || type === 'RADIO_BUTTON') {
            const sel = document.createElement('select');
            sel.className = 'pb-newrec__select';
            const empty = document.createElement('option');
            empty.value = '';
            empty.textContent = '';
            sel.appendChild(empty);
            (Array.isArray(field.choices) ? field.choices : []).forEach((c) => {
              const opt = document.createElement('option');
              opt.value = String(c || '');
              opt.textContent = String(c || '');
              sel.appendChild(opt);
            });
            controlWrap.appendChild(sel);
            getValue = () => sel.value;
            setValue = (v) => { sel.value = String(v ?? ''); };
          } else if (type === 'CHECK_BOX' || type === 'MULTI_SELECT') {
            const checkWrap = document.createElement('div');
            checkWrap.className = 'pb-newrec__checkgroup';
            const checkboxes = [];
            (Array.isArray(field.choices) ? field.choices : []).forEach((c) => {
              const item = document.createElement('label');
              item.className = 'pb-newrec__check-item';
              const cb = document.createElement('input');
              cb.type = 'checkbox';
              cb.value = String(c || '');
              checkboxes.push(cb);
              item.appendChild(cb);
              item.appendChild(document.createTextNode(String(c || '')));
              checkWrap.appendChild(item);
            });
            controlWrap.appendChild(checkWrap);
            getValue = () => checkboxes.filter((cb) => cb.checked).map((cb) => cb.value);
            setValue = (v) => {
              const selected = new Set((Array.isArray(v) ? v : [v]).map((item) => String(item ?? '')));
              checkboxes.forEach((cb) => { cb.checked = selected.has(cb.value); });
            };
          } else if (type === 'DATE') {
            const wrap = document.createElement('div');
            wrap.className = 'pb-newrec__date-wrap';
            const input = document.createElement('input');
            input.type = 'text';
            input.className = 'pb-newrec__input';
            input.placeholder = 't · +3 · end · end+1 · first · mon';
            input.addEventListener('focus', () => { if (input.value) input.select(); });
            input.addEventListener('keydown', (e) => {
              if (e.key === 'Enter' || e.key === 'Tab') {
                const smart = smartDateToYMD(input.value);
                if (smart) { input.value = smart; input.select(); }
                if (e.key === 'Enter') e.preventDefault();
              }
            });
            const pickerLabel = document.createElement('label');
            pickerLabel.className = 'pb-newrec__date-btn';
            pickerLabel.textContent = '▾';
            const nativePicker = document.createElement('input');
            nativePicker.type = 'date';
            nativePicker.className = 'pb-overlay__date-pick-native';
            nativePicker.tabIndex = -1;
            pickerLabel.appendChild(nativePicker);
            pickerLabel.addEventListener('mousedown', (e) => { e.stopPropagation(); nativePicker.value = input.value || ''; });
            nativePicker.addEventListener('mousedown', (e) => e.stopPropagation());
            nativePicker.addEventListener('change', () => { if (nativePicker.value) input.value = nativePicker.value; });
            wrap.appendChild(input);
            wrap.appendChild(pickerLabel);
            controlWrap.appendChild(wrap);
            getValue = () => { const smart = smartDateToYMD(input.value); return smart || input.value || ''; };
            setValue = (v) => { input.value = String(v ?? ''); };
          } else if (type === 'DATETIME') {
            const wrap = document.createElement('div');
            wrap.className = 'pb-newrec__date-wrap';
            const input = document.createElement('input');
            input.type = 'text';
            input.className = 'pb-newrec__input';
            input.placeholder = 'now · t · +1d · +2h · +30m';
            input.addEventListener('focus', () => { if (input.value) input.select(); });
            input.addEventListener('keydown', (e) => {
              if (e.key === 'Enter' || e.key === 'Tab') {
                const utc = smartDateTimeToUtc(input.value, this.kintoneTimezone);
                if (utc) input.value = utcToLocalDisplay(utc, this.kintoneTimezone);
                if (e.key === 'Enter') e.preventDefault();
              }
            });
            const pickerLabel = document.createElement('label');
            pickerLabel.className = 'pb-newrec__date-btn';
            pickerLabel.textContent = '▾';
            const nativePicker = document.createElement('input');
            nativePicker.type = 'datetime-local';
            nativePicker.className = 'pb-overlay__date-pick-native';
            nativePicker.tabIndex = -1;
            pickerLabel.appendChild(nativePicker);
            pickerLabel.addEventListener('mousedown', (e) => { e.stopPropagation(); nativePicker.value = input.value ? input.value.replace(' ', 'T') : ''; });
            nativePicker.addEventListener('mousedown', (e) => e.stopPropagation());
            nativePicker.addEventListener('change', () => { if (nativePicker.value) input.value = nativePicker.value.replace('T', ' '); });
            wrap.appendChild(input);
            wrap.appendChild(pickerLabel);
            controlWrap.appendChild(wrap);
            getValue = () => { const utc = smartDateTimeToUtc(input.value, this.kintoneTimezone); return utc || input.value || ''; };
            setValue = (v) => { input.value = String(v ?? ''); };
          } else {
            const input = document.createElement('input');
            input.type = 'text';
            input.className = 'pb-newrec__input';
            if (type === 'NUMBER') input.inputMode = 'decimal';
            if (type === 'LINK') input.inputMode = 'url';
            controlWrap.appendChild(input);
            getValue = () => input.value;
            setValue = (v) => { input.value = String(v ?? ''); };
          }

          if (!field._isLookupAuto && hasFieldDefaultValue(field) && typeof setValue === 'function') {
            setValue(normalizeFieldDefaultValue(field, this.kintoneTimezone));
          }
          fieldInputMap.set(field.code, { field, getValue, setValue });
          row.appendChild(labelEl);
          row.appendChild(controlWrap);
          body.appendChild(row);
        });
      };

      renderBody(activePresetId || (presets[0]?.id || ''));

      presetSelect.addEventListener('change', () => renderBody(presetSelect.value));

      saveBtn.addEventListener('click', () => {
        void this._submit(appId, language, fieldInputMap, saveBtn, cancelBtn, listUrl);
      });

      panel.appendChild(head);
      panel.appendChild(presetRow);
      panel.appendChild(body);
      panel.appendChild(foot);

      requestAnimationFrame(() => {
        const first = panel.querySelector('input:not([type="date"]):not([type="datetime-local"]), textarea, select:not(.pb-newrec__preset-select)');
        if (first) first.focus();
      });
    }

    async _submit(appId, language, fieldInputMap, saveBtn, cancelBtn, listUrl) {
      const t = (key) => resolveText(language, key);
      const record = {};
      let hasRequiredMissing = false;

      fieldInputMap.forEach(({ field, getValue }) => {
        const raw = getValue();
        const type = String(field.type || '').toUpperCase();
        let value;
        if (type === 'CHECK_BOX' || type === 'MULTI_SELECT') {
          value = Array.isArray(raw) ? raw : [];
        } else {
          value = String(raw ?? '');
        }
        if (field.required) {
          const isEmpty = Array.isArray(value) ? value.length === 0 : value === '';
          if (isEmpty) hasRequiredMissing = true;
        }
        record[field.code] = { value };
      });

      if (hasRequiredMissing) {
        this._showNotice(t('newRecordRequiredMissing'));
        return;
      }

      saveBtn.disabled = true;
      cancelBtn.disabled = true;
      saveBtn.textContent = t('newRecordSaving');

      try {
        const response = await this.postFn('EXCEL_POST_RECORDS', {
          appId,
          records: [record],
          __pbTrigger: 'quick_new_record'
        });
        if (!response?.ok) throw new Error(response?.error || 'create failed');
        this.close();
        window.location.href = listUrl;
      } catch (err) {
        console.error('[kintone-excel-overlay] quick new record failed', err);
        this._showNotice(t('toastNewRecordFailed'));
        saveBtn.disabled = false;
        cancelBtn.disabled = false;
        saveBtn.textContent = t('newRecordSave');
      }
    }

    _showNotice(message) {
      showOverlayLaunchNotice(message);
    }
  }

  const quickNewRecord = new QuickNewRecordModal(postToPage);

  document.addEventListener('keydown', (e) => {
    if (e.code !== 'KeyN') return;
    if (!e.shiftKey || !e.altKey || e.ctrlKey || e.metaKey) return;
    if (!parseListOverlayContext(location.href)) return;
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    if (quickNewRecord.isVisible()) {
      quickNewRecord.close();
    } else {
      void quickNewRecord.open();
    }
  }, true);

  // ── End Quick New Record Modal ───────────────────────────────────────────

  spaLifecycleReady = true;
  handleSpaLifecycle('boot_ready', location.href);
  if (shouldRetryAppOnlyInitialization()) {
    void waitForAppContextAndInit();
  }

})();
