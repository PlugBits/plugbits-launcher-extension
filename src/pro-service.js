// pro-service.js
// Centralized Pro access evaluation for Overlay features.
(function registerProService(globalScope) {
  if (typeof globalScope.createProService === 'function') return;

  const DEVELOPER_OVERRIDE_KEY = 'pbDeveloperProOverride';
  const INSTALL_TYPE_CACHE_TTL_MS = 30 * 1000;
  const DEVELOPER_OVERRIDE_AT_KEY = 'pbDeveloperProOverrideAt';
  const DEVELOPER_OVERRIDE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

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
    return {
      value: '',
      source: 'none',
      reason: '',
      expiresAt: 0
    };
  }

  function createProService() {
    let installTypeCache = createInstallTypeCache();
    let debug = false;

    function debugLog(message, payload) {
      if (!debug) return;
      try {
        console.debug(`[pro-service] ${message}`, payload || {});
      } catch (_err) {
        // noop
      }
    }

    function setDebug(value) {
      debug = Boolean(value);
    }

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
          // タイムスタンプ欠落時は自動補修（手動でキーを直接セットした場合の救済）
          await chrome.storage.local.set({ [DEVELOPER_OVERRIDE_AT_KEY]: Date.now() });
          return true;
        }

        const alive = (Date.now() - enabledAt) < DEVELOPER_OVERRIDE_TTL_MS;
        if (!alive) {
          await chrome.storage.local.remove([
            DEVELOPER_OVERRIDE_KEY,
            DEVELOPER_OVERRIDE_AT_KEY
          ]);
          return false;
        }

        return true;
      } catch (_err) {
        return false;
      }
    }

    async function setDeveloperOverride(value) {
      if (Boolean(value)) {
        await chrome.storage.local.set({
          [DEVELOPER_OVERRIDE_KEY]: true,
          [DEVELOPER_OVERRIDE_AT_KEY]: Date.now()
        });
        return;
      }

      await chrome.storage.local.remove([
        DEVELOPER_OVERRIDE_KEY,
        DEVELOPER_OVERRIDE_AT_KEY
      ]);
    }

    function getFallbackDevelopmentGuess() {
      try {
        const manifest = chrome.runtime?.getManifest?.() || {};
        // In unpacked/dev builds update_url is usually absent.
        return !Object.prototype.hasOwnProperty.call(manifest, 'update_url');
      } catch (_err) {
        return false;
      }
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
      return {
        ok: Boolean(next.value),
        installType: next.value,
        source: next.source,
        reason: next.reason
      };
    }

    async function evaluateProductionEntitlement(_options = {}) {
      // Future: replace with Cloudflare + OTP entitlement lookup.
      return {
        enabled: false,
        source: 'stub',
        reason: 'not_implemented'
      };
    }

    async function getProAccessState(options = {}) {
      const featureName = String(options?.featureName || '').trim() || 'default';
      const allowDevelopmentInstall = toBoolean(options?.allowDevelopmentInstall, false);
      const developerOverride = await getDeveloperOverride();
      if (developerOverride) {
        const state = {
          enabled: true,
          reason: 'developer_override',
          featureName,
          developerOverride: true,
          installType: '',
          source: 'local_override'
        };
        debugLog('getProAccessState', state);
        return state;
      }

      const installTypeInfo = await fetchInstallType();
      if (allowDevelopmentInstall && installTypeInfo.installType === 'development') {
        const state = {
          enabled: true,
          reason: 'development_install',
          featureName,
          developerOverride: false,
          installType: 'development',
          source: installTypeInfo.source || 'management'
        };
        debugLog('getProAccessState', state);
        return state;
      }

      const entitlement = await evaluateProductionEntitlement(options);
      if (entitlement?.enabled) {
        const state = {
          enabled: true,
          reason: 'entitled',
          featureName,
          developerOverride: false,
          installType: installTypeInfo.installType || '',
          source: entitlement.source || 'entitlement'
        };
        debugLog('getProAccessState', state);
        return state;
      }

      if (!allowDevelopmentInstall && installTypeInfo.installType === 'development') {
        const state = {
          enabled: false,
          reason: 'development_requires_override',
          featureName,
          developerOverride: false,
          installType: 'development',
          source: installTypeInfo.source || 'management'
        };
        debugLog('getProAccessState', state);
        return state;
      }

      const state = {
        enabled: false,
        reason: installTypeInfo.reason || entitlement?.reason || 'not_entitled',
        featureName,
        developerOverride: false,
        installType: installTypeInfo.installType || '',
        source: 'none'
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
      evaluateProductionEntitlement
    };
  }

  globalScope.createProService = createProService;
})(globalThis);
