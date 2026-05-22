// pro-service.js
// Centralized Pro access evaluation for Overlay features.
(function registerProService(globalScope) {
  if (typeof globalScope.createProService === 'function') return;

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

  function createProService() {
    let debug = false;

    function debugLog(message, payload) {
      if (!debug) return;
      try { console.debug(`[pro-service] ${message}`, payload || {}); } catch (_err) {}
    }

    function setDebug(value) { debug = Boolean(value); }

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
      const entitlement = await evaluateProductionEntitlement(options);
      const state = {
        enabled: Boolean(entitlement?.enabled),
        reason: entitlement?.enabled ? 'entitled' : (entitlement?.reason || 'not_entitled'),
        featureName,
        source: entitlement?.source || 'none',
        email: entitlement?.email,
        expiry: entitlement?.expiry,
        portalUrl: entitlement?.portalUrl
      };
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

    return {
      setDebug,
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
