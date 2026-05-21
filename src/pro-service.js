// pro-service.js
// Centralized Pro access evaluation for Overlay features.
(function registerProService(globalScope) {
  if (typeof globalScope.createProService === 'function') return;

  const DEVELOPER_OVERRIDE_KEY = 'pbDeveloperProOverride';
  const DEVELOPER_OVERRIDE_AT_KEY = 'pbDeveloperProOverrideAt';
  const DEVELOPER_OVERRIDE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

  const INSTALL_TYPE_CACHE_TTL_MS = 30 * 1000;

  const LICENSE_KEY_STORAGE_KEY = 'pbLicenseKey';
  const LICENSE_CACHE_STORAGE_KEY = 'pbLicenseCache';
  const LICENSE_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
  const VERIFY_ENDPOINT = 'https://api.plugbits.app/verify';

  function toBoolean(value, fallback = false) {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value !== 0;
    if (typeof value === 'string') {
      const normalized = value.trim().toLowerCase();
      if (['1', 'true', 'yes', 'on', 'enabled'].includes(normalized)) return true;
      if (['0', 'false', 'no', 'off', 'disabled'].includes(normalized)) return false;
    }
    return fallback;
  }

  function createInstallTypeCache() {
    return { value: '', source: 'none', reason: '', expiresAt: 0 };
  }

  function createProService() {
    let installTypeCache = createInstallTypeCache();
    let debug = false;

    function debugLog(message, payload) {
      if (!debug) return;
      try { console.debug(`[pro-service] ${message}`, payload || {}); } catch (_err) {}
    }

    function setDebug(value) { debug = Boolean(value); }

    // ── Developer override ──────────────────────────────────────────────────

    async function getDeveloperOverride() {
      try {
        const stored = await chrome.storage.local.get([
          DEVELOPER_OVERRIDE_KEY,
          DEVELOPER_OVERRIDE_AT_KEY
        ]);
        const enabled = toBoolean(stored?.[DEVELOPER_OVERRIDE_KEY], false);
        const enabledAt = Number(stored?.[DEVELOPER_OVERRIDE_AT_KEY] || 0);
        if (!enabled) return false;
        if (!enabledAt) {
          await chrome.storage.local.set({ [DEVELOPER_OVERRIDE_AT_KEY]: Date.now() });
          return true;
        }
        const alive = (Date.now() - enabledAt) < DEVELOPER_OVERRIDE_TTL_MS;
        if (!alive) {
          await chrome.storage.local.remove([DEVELOPER_OVERRIDE_KEY, DEVELOPER_OVERRIDE_AT_KEY]);
          return false;
        }
        return true;
      } catch (_err) { return false; }
    }

    async function setDeveloperOverride(value) {
      if (Boolean(value)) {
        await chrome.storage.local.set({
          [DEVELOPER_OVERRIDE_KEY]: true,
          [DEVELOPER_OVERRIDE_AT_KEY]: Date.now()
        });
        return;
      }
      await chrome.storage.local.remove([DEVELOPER_OVERRIDE_KEY, DEVELOPER_OVERRIDE_AT_KEY]);
    }

    // ── Install type ────────────────────────────────────────────────────────

    function getFallbackDevelopmentGuess() {
      try {
        const manifest = chrome.runtime?.getManifest?.() || {};
        return !Object.prototype.hasOwnProperty.call(manifest, 'update_url');
      } catch (_err) { return false; }
    }

    async function fetchInstallType() {
      const now = Date.now();
      if (installTypeCache.expiresAt > now) {
        return {
          ok: Boolean(installTypeCache.value),
          installType: installTypeCache.value,
          source: installTypeCache.source,
          reason: installTypeCache.reason
        };
      }
      let next = createInstallTypeCache();
      if (!chrome?.runtime?.sendMessage) {
        next.reason = 'runtime_unavailable';
      } else {
        try {
          const response = await chrome.runtime.sendMessage({ type: 'PB_GET_INSTALL_TYPE' });
          if (response?.ok && response.installType) {
            next.value = String(response.installType);
            next.source = String(response.source || 'management');
            next.reason = '';
          } else {
            next.reason = String(response?.reason || 'install_type_unavailable');
            if (response?.fallbackDevelopment === true) {
              next.value = 'development';
              next.source = 'fallback';
            }
          }
        } catch (error) {
          next.reason = String(error?.message || error || 'install_type_request_failed');
        }
      }
      if (!next.value && getFallbackDevelopmentGuess()) {
        next.value = 'development';
        next.source = 'fallback';
        next.reason = next.reason || 'manifest_fallback';
      }
      next.expiresAt = now + INSTALL_TYPE_CACHE_TTL_MS;
      installTypeCache = next;
      return { ok: Boolean(next.value), installType: next.value, source: next.source, reason: next.reason };
    }

    // ── License key management ──────────────────────────────────────────────

    async function getLicenseKey() {
      try {
        const stored = await chrome.storage.local.get(LICENSE_KEY_STORAGE_KEY);
        return String(stored?.[LICENSE_KEY_STORAGE_KEY] || '').trim();
      } catch (_err) { return ''; }
    }

    async function setLicenseKey(key) {
      const trimmed = String(key || '').trim();
      if (trimmed) {
        await chrome.storage.local.set({ [LICENSE_KEY_STORAGE_KEY]: trimmed });
      } else {
        await chrome.storage.local.remove(LICENSE_KEY_STORAGE_KEY);
      }
      // キー変更時はキャッシュを破棄
      await chrome.storage.local.remove(LICENSE_CACHE_STORAGE_KEY);
    }

    async function clearLicense() {
      await chrome.storage.local.remove([LICENSE_KEY_STORAGE_KEY, LICENSE_CACHE_STORAGE_KEY]);
    }

    // ── License cache ───────────────────────────────────────────────────────

    async function getLicenseCache() {
      try {
        const stored = await chrome.storage.local.get(LICENSE_CACHE_STORAGE_KEY);
        const cache = stored?.[LICENSE_CACHE_STORAGE_KEY];
        if (!cache || typeof cache !== 'object') return null;
        return cache;
      } catch (_err) { return null; }
    }

    async function saveLicenseCache(result) {
      try {
        await chrome.storage.local.set({
          [LICENSE_CACHE_STORAGE_KEY]: { ...result, cachedAt: Date.now() }
        });
      } catch (_err) {}
    }

    // ── Remote verify ───────────────────────────────────────────────────────

    async function fetchVerify(licenseKey) {
      const url = `${VERIFY_ENDPOINT}?key=${encodeURIComponent(licenseKey)}`;
      const resp = await fetch(url, {
        method: 'GET',
        headers: { 'Accept': 'application/json' },
        signal: AbortSignal.timeout(8000)
      });
      if (!resp.ok) {
        const body = await resp.json().catch(() => ({}));
        return { ok: false, status: body?.status || 'error', reason: body?.reason || `http_${resp.status}` };
      }
      const body = await resp.json();
      return {
        ok: true,
        status: String(body?.status || ''),
        email: String(body?.email || ''),
        expiry: String(body?.expiry || ''),
        customerId: String(body?.stripe_customer_id || ''),
        portalUrl: String(body?.portal_url || '')
      };
    }

    // ── Production entitlement ──────────────────────────────────────────────

    async function evaluateProductionEntitlement(_options = {}) {
      const key = await getLicenseKey();
      if (!key) {
        return { enabled: false, source: 'no_key', reason: 'no_license_key' };
      }

      // 1. キャッシュ確認
      const cache = await getLicenseCache();
      if (cache && typeof cache.cachedAt === 'number') {
        const age = Date.now() - cache.cachedAt;
        if (age < LICENSE_CACHE_TTL_MS) {
          const enabled = cache.status === 'active';
          debugLog('evaluateProductionEntitlement (cache hit)', { enabled, age });
          return { enabled, source: 'cache', reason: enabled ? null : cache.status, email: cache.email, expiry: cache.expiry, portalUrl: cache.portalUrl };
        }
      }

      // 2. リモート検証
      try {
        const result = await fetchVerify(key);
        await saveLicenseCache(result);
        const enabled = result.status === 'active';
        debugLog('evaluateProductionEntitlement (remote)', result);
        return { enabled, source: 'remote', reason: enabled ? null : result.reason || result.status, email: result.email, expiry: result.expiry, portalUrl: result.portalUrl };
      } catch (err) {
        debugLog('evaluateProductionEntitlement (network error)', { err: String(err?.message || err) });
        // ネットワーク失敗時: 古いキャッシュが active なら猶予アクセス
        if (cache && cache.status === 'active') {
          return { enabled: true, source: 'cache_grace', reason: null, email: cache.email, expiry: cache.expiry, portalUrl: cache.portalUrl };
        }
        return { enabled: false, source: 'network_error', reason: String(err?.message || 'network_error') };
      }
    }

    // ── verifyLicense（UIから強制再検証用）──────────────────────────────────

    async function verifyLicense(key) {
      const trimmedKey = String(key || '').trim();
      if (!trimmedKey) return { ok: false, reason: 'no_key' };
      try {
        const result = await fetchVerify(trimmedKey);
        if (result.ok) {
          await setLicenseKey(trimmedKey);
          await saveLicenseCache(result);
        }
        return result;
      } catch (err) {
        return { ok: false, status: 'error', reason: String(err?.message || 'network_error') };
      }
    }

    // ── getProAccessState ───────────────────────────────────────────────────

    async function getProAccessState(options = {}) {
      const featureName = String(options?.featureName || '').trim() || 'default';
      const allowDevelopmentInstall = toBoolean(options?.allowDevelopmentInstall, false);

      const developerOverride = await getDeveloperOverride();
      if (developerOverride) {
        const state = { enabled: true, reason: 'developer_override', featureName, developerOverride: true, installType: '', source: 'local_override' };
        debugLog('getProAccessState', state);
        return state;
      }

      const installTypeInfo = await fetchInstallType();
      if (allowDevelopmentInstall && installTypeInfo.installType === 'development') {
        const state = { enabled: true, reason: 'development_install', featureName, developerOverride: false, installType: 'development', source: installTypeInfo.source || 'management' };
        debugLog('getProAccessState', state);
        return state;
      }

      const entitlement = await evaluateProductionEntitlement(options);
      if (entitlement?.enabled) {
        const state = { enabled: true, reason: 'entitled', featureName, developerOverride: false, installType: installTypeInfo.installType || '', source: entitlement.source || 'entitlement', email: entitlement.email, expiry: entitlement.expiry, portalUrl: entitlement.portalUrl };
        debugLog('getProAccessState', state);
        return state;
      }

      if (!allowDevelopmentInstall && installTypeInfo.installType === 'development') {
        const state = { enabled: false, reason: 'development_requires_override', featureName, developerOverride: false, installType: 'development', source: installTypeInfo.source || 'management' };
        debugLog('getProAccessState', state);
        return state;
      }

      const state = { enabled: false, reason: installTypeInfo.reason || entitlement?.reason || 'not_entitled', featureName, developerOverride: false, installType: installTypeInfo.installType || '', source: 'none' };
      debugLog('getProAccessState', state);
      return state;
    }

    async function isProEnabled(options = {}) {
      const state = await getProAccessState(options);
      return Boolean(state.enabled);
    }

    async function canUseProFeature(featureName, options = {}) {
      const state = await getProAccessState({ ...options, featureName });
      return Boolean(state.enabled);
    }

    function clearCaches() {
      installTypeCache = createInstallTypeCache();
    }

    return {
      setDebug,
      clearCaches,
      getDeveloperOverride,
      setDeveloperOverride,
      fetchInstallType,
      getProAccessState,
      isProEnabled,
      canUseProFeature,
      evaluateProductionEntitlement,
      getLicenseKey,
      setLicenseKey,
      clearLicense,
      verifyLicense
    };
  }

  globalScope.createProService = createProService;
})(globalThis);
