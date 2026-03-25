// service_worker.js
// 目的：サイドパネル/コンテキストメニュー連携を提供する（WatchList 件数バッジ自動更新は無効化）
import {
  createId,
  isKintoneUrl,
  parseKintoneUrl,
  loadShortcuts,
  loadAppNameMap,
  saveShortcuts,
  upsertRecentRecord,
  saveAppNameMap,
  clearAppNameMap
} from './core.js';

function disableLegacyWatchlistBadgeRefresh() {
  chrome.alarms?.clear?.('kfav-badge-refresh').catch?.(() => {});
}

// MV3 起動時セットアップ
chrome.runtime.onInstalled.addListener(() => {
  disableLegacyWatchlistBadgeRefresh();
 // Edge/Chrome: サイドパネルを有効化 & アイコンクリックで開く挙動を設定
  try {
    if (chrome.sidePanel) {
      if (chrome.sidePanel.setOptions) {
        chrome.sidePanel.setOptions({ path: 'sidepanel.html', enabled: true });
      }
      if (chrome.sidePanel.setPanelBehavior) {
        chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
      }
    }
  } catch (e) {
    // 起動時/導入時に自動でタブを作成しない
  }

  setupContextMenus();
  migrateShortcutsFillIconFieldsOnce().catch(() => {});
});

// 起動時に自動でコネクタタブを作成しない
chrome.runtime.onStartup?.addListener(() => {
  disableLegacyWatchlistBadgeRefresh();
  setupContextMenus();
});
chrome.runtime.onStartup?.addListener(() => {
  disableLegacyWatchlistBadgeRefresh();
  migrateShortcutsFillIconFieldsOnce().catch(() => {});
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (!changes || !Object.prototype.hasOwnProperty.call(changes, UI_LANGUAGE_KEY)) return;
  setupContextMenus().catch((error) => {
    console.error('[kfav] failed to rebuild context menus on language change', error);
  });
});
chrome.permissions?.onAdded?.addListener((permissions) => {
  handleOptionalHostPermissionChange(permissions, 'granted').catch((error) => {
    console.error('[kfav] host permission add handling failed', error);
  });
});
chrome.permissions?.onRemoved?.addListener((permissions) => {
  handleOptionalHostPermissionChange(permissions, 'removed').catch((error) => {
    console.error('[kfav] host permission removal handling failed', error);
  });
});

const PIN_MENU_ID = 'kfav-pin-record';
const FAVORITE_PARENT_ID = 'kfav-favorite-parent';
const FAVORITE_MENU_APP = 'kfav-favorite-app';
const FAVORITE_MENU_VIEW = 'kfav-favorite-view';
const FAVORITES_KEY = 'kintoneFavorites';
const WATCHLIST_LIMIT_KEY = 'pb_watchlist_limit';
const DEFAULT_WATCHLIST_LIMIT = 3;
const MAX_WATCHLIST_LIMIT = 5;
const WATCHLIST_LIMIT_VALUES = [DEFAULT_WATCHLIST_LIMIT, MAX_WATCHLIST_LIMIT];
const DEFAULT_WATCHLIST_ICON = 'file-text';
const DEFAULT_WATCHLIST_ICON_COLOR = 'gray';
const DEFAULT_WATCHLIST_CATEGORY = '';
const WATCHLIST_CTX_UNSUPPORTED_PAGE_MESSAGE = 'このページからはウォッチリストを追加できません。アプリの一覧ビューで実行してください。';
const SHORTCUT_PARENT_ID = 'kfav-shortcut-parent';
const SHORTCUT_MENU_APP = 'kfav-shortcut-app';
const SHORTCUT_MENU_VIEW = 'kfav-shortcut-view';
const SHORTCUT_MENU_CREATE = 'kfav-shortcut-create';
const DEV_PARENT_MENU_ID = 'kf-dev-root';
const DEV_COPY_QUERY_MENU_ID = 'kf-dev-copy-query';
const DEV_COPY_FIELDS_LIST_MENU_ID = 'kf-dev-copy-fields-list';
const DEV_COPY_APP_ID_MENU_ID = 'kf-dev-copy-app-id';
const DEV_COPY_VIEW_ID_MENU_ID = 'kf-dev-copy-view-id';
const PRO_INSTALL_TYPE_MESSAGE_ID = 'PB_GET_INSTALL_TYPE';
const UI_LANGUAGE_KEY = 'uiLanguage';
const UI_LANGUAGE_VALUES = new Set(['auto', 'ja', 'en']);
const latestPageContextByTab = new Map();
const CACHE_INVALIDATED_MESSAGE = 'CACHE_INVALIDATED';
const PERMISSION_UPDATED_MESSAGE = 'PERMISSION_UPDATED';
const HOST_PERMISSION_GRANTED_MESSAGE = 'HOST_PERMISSION_GRANTED';
const HOST_PERMISSION_REMOVED_MESSAGE = 'HOST_PERMISSION_REMOVED';

function normalizeWatchlistLimit(raw) {
  const value = Number(raw);
  if (WATCHLIST_LIMIT_VALUES.includes(value)) return value;
  return DEFAULT_WATCHLIST_LIMIT;
}

async function loadWatchlistLimit() {
  try {
    const stored = await chrome.storage.local.get(WATCHLIST_LIMIT_KEY);
    const raw = stored?.[WATCHLIST_LIMIT_KEY];
    const normalized = normalizeWatchlistLimit(raw);
    if (raw !== normalized) {
      await chrome.storage.local.set({ [WATCHLIST_LIMIT_KEY]: normalized });
    }
    return normalized;
  } catch (_err) {
    return DEFAULT_WATCHLIST_LIMIT;
  }
}

const MENU_MESSAGES = {
  ja: {
    menu_pin_record: 'このレコードをピン留め',
    menu_favorite_parent: 'ウォッチリストに追加',
    menu_favorite_app: 'アプリトップ',
    menu_favorite_view: 'ビューを追加',
    menu_shortcut_parent: 'ショートカットに追加',
    menu_shortcut_app: 'アプリトップ',
    menu_shortcut_view: 'ビューを開く',
    menu_shortcut_create: 'レコード新規',
    menu_dev_root: '開発者ツール',
    menu_copy_query: '絞り込みクエリをコピー',
    menu_copy_fields: 'フィールド一覧をコピー',
    menu_copy_app_id: 'appId をコピー',
    menu_copy_view_id: 'viewId をコピー'
  },
  en: {
    menu_pin_record: 'Pin this record',
    menu_favorite_parent: 'Add to watchlist',
    menu_favorite_app: 'App top',
    menu_favorite_view: 'Add view',
    menu_shortcut_parent: 'Add to shortcuts',
    menu_shortcut_app: 'App top',
    menu_shortcut_view: 'Open view',
    menu_shortcut_create: 'New record',
    menu_dev_root: 'Development Tools',
    menu_copy_query: 'Copy Filter Query',
    menu_copy_fields: 'Copy Field List',
    menu_copy_app_id: 'Copy appId',
    menu_copy_view_id: 'Copy viewId'
  }
};

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type !== PRO_INSTALL_TYPE_MESSAGE_ID) return;
  (async () => {
    try {
      if (chrome.management?.getSelf) {
        const info = await chrome.management.getSelf();
        sendResponse({
          ok: true,
          installType: String(info?.installType || ''),
          source: 'management'
        });
        return;
      }
      const manifest = chrome.runtime?.getManifest?.() || {};
      const fallbackDevelopment = !Object.prototype.hasOwnProperty.call(manifest, 'update_url');
      sendResponse({
        ok: false,
        reason: 'management_api_unavailable',
        fallbackDevelopment
      });
    } catch (error) {
      const manifest = chrome.runtime?.getManifest?.() || {};
      const fallbackDevelopment = !Object.prototype.hasOwnProperty.call(manifest, 'update_url');
      sendResponse({
        ok: false,
        reason: String(error?.message || error || 'management_get_self_failed'),
        fallbackDevelopment
      });
    }
  })();
  return true;
});

function normalizeUiLanguage(raw) {
  const value = String(raw || '').trim().toLowerCase();
  if (value === 'ja' || value.startsWith('ja-')) return 'ja';
  return 'en';
}

function extractHostOriginsFromPermissions(permissions) {
  const origins = Array.isArray(permissions?.origins) ? permissions.origins : [];
  return Array.from(new Set(
    origins
      .map((origin) => normalizeHostOrigin(origin))
      .filter(Boolean)
  ));
}

async function broadcastRuntimeMessage(message) {
  if (!message || typeof message !== 'object') return;
  try {
    await chrome.runtime.sendMessage(message);
  } catch (_err) {
    // Ignore when no extension page is currently listening.
  }
}

function normalizeUiLanguageSetting(raw) {
  const value = String(raw || '').trim().toLowerCase();
  if (UI_LANGUAGE_VALUES.has(value)) return value;
  return 'auto';
}

async function resolveUiLanguage() {
  let setting = 'auto';
  try {
    const data = await chrome.storage.local.get(UI_LANGUAGE_KEY);
    setting = normalizeUiLanguageSetting(data?.[UI_LANGUAGE_KEY]);
  } catch (_err) {
    setting = 'auto';
  }
  if (setting === 'ja' || setting === 'en') return setting;
  try {
    const browserLang = navigator.language || (Array.isArray(navigator.languages) ? navigator.languages[0] : '');
    return normalizeUiLanguage(browserLang);
  } catch (_err) {
    return 'ja';
  }
}

function tMenu(lang, key) {
  return MENU_MESSAGES[lang]?.[key]
    ?? MENU_MESSAGES.ja?.[key]
    ?? key;
}

async function getActiveTabForDevAction(fallbackTab) {
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tabs?.[0]?.id) return tabs[0];
  } catch (_err) {
    // ignore
  }
  return fallbackTab || null;
}

async function fetchFieldsListFromMainWorld(tabId) {
  const injected = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func: () => {
      try {
        const sdk = window.kintone;
        if (!sdk || !sdk.app || !sdk.api) {
          return { ok: false, reason: 'not_kintone_page', url: location.href };
        }
        const appId = typeof sdk.app.getId === 'function' ? sdk.app.getId() : '';
        if (!appId) {
          return { ok: false, reason: 'app_id_not_found', url: location.href };
        }
        return sdk.api(
          sdk.api.url('/k/v1/app/form/fields', true),
          'GET',
          { app: appId }
        ).then((resp) => {
          const properties = resp && resp.properties ? resp.properties : {};
          if (!properties || typeof properties !== 'object' || !Object.keys(properties).length) {
            return { ok: false, reason: 'empty_properties', appId: String(appId || ''), url: location.href };
          }

          const rows = [];
          Object.keys(properties).forEach((code) => {
            const field = properties[code] || {};
            const type = String(field.type || '');
            if (type === 'SUBTABLE') {
              const subFields = field.fields && typeof field.fields === 'object' ? field.fields : {};
              Object.keys(subFields).forEach((subCode) => {
                const sub = subFields[subCode] || {};
                rows.push({
                  scope: 'サブテーブル',
                  parentTableCode: code,
                  parentTableLabel: String(field.label || ''),
                  code: String(subCode || ''),
                  label: String(sub.label || ''),
                  type: String(sub.type || '')
                });
              });
              return;
            }

            rows.push({
              scope: '通常',
              parentTableCode: '',
              parentTableLabel: '',
              code: String(code || ''),
              label: String(field.label || ''),
              type: type
            });
          });

          if (!rows.length) {
            return { ok: false, reason: 'empty_properties', appId: String(appId || ''), url: location.href };
          }

          rows.sort((a, b) => {
            const aScope = a.scope === '通常' ? 0 : 1;
            const bScope = b.scope === '通常' ? 0 : 1;
            if (aScope !== bScope) return aScope - bScope;
            const parentCmp = String(a.parentTableCode || '').localeCompare(String(b.parentTableCode || ''), 'ja');
            if (parentCmp !== 0) return parentCmp;
            return String(a.code || '').localeCompare(String(b.code || ''), 'ja');
          });

          const lines = [];
          lines.push('所属\t親テーブルコード\t親テーブル名\tフィールドコード\tフィールド名\tフィールドタイプ');
          rows.forEach((row) => {
            lines.push([
              row.scope,
              row.parentTableCode,
              row.parentTableLabel,
              row.code,
              row.label,
              row.type
            ].join('\t'));
          });

          return {
            ok: true,
            appId: String(appId || ''),
            url: location.href,
            rowCount: rows.length,
            text: lines.join('\n')
          };
        }).catch((error) => ({
          ok: false,
          reason: 'form_fields_fetch_failed',
          appId: String(appId || ''),
          url: location.href,
          detail: String(error && error.message || error)
        }));
      } catch (error) {
        return {
          ok: false,
          reason: 'unexpected_error',
          url: location.href,
          detail: String(error && error.message || error)
        };
      }
    }
  });
  return injected?.[0]?.result || { ok: false, reason: 'unexpected_error' };
}

async function copyTextViaInjectedScript(tabId, text) {
  try {
    const injected = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'ISOLATED',
      func: async (value) => {
        const textValue = String(value || '');
        if (!textValue) return { ok: false, reason: 'empty_text' };
        try {
          if (navigator?.clipboard?.writeText) {
            await navigator.clipboard.writeText(textValue);
            return { ok: true };
          }
        } catch (_err) {
          // fallback below
        }
        try {
          const ta = document.createElement('textarea');
          ta.value = textValue;
          ta.setAttribute('readonly', 'readonly');
          ta.style.position = 'fixed';
          ta.style.left = '-9999px';
          ta.style.top = '-9999px';
          document.body.appendChild(ta);
          ta.select();
          ta.setSelectionRange(0, ta.value.length);
          const ok = document.execCommand('copy');
          ta.remove();
          return ok ? { ok: true } : { ok: false, reason: 'clipboard_failed' };
        } catch (_err) {
          return { ok: false, reason: 'clipboard_failed' };
        }
      },
      args: [text]
    });
    return injected?.[0]?.result || { ok: false, reason: 'copy_fallback_failed' };
  } catch (error) {
    return { ok: false, reason: 'copy_fallback_failed', detail: String(error?.message || error) };
  }
}

async function fetchAppOrViewIdFromMainWorld(tabId, mode) {
  const injected = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func: async (targetMode) => {
      try {
        if (!window.kintone || !kintone.app) {
          return { ok: false, reason: 'not_kintone_page', value: '', url: location.href };
        }
        if (targetMode === 'appId') {
          const appId = typeof kintone.app.getId === 'function' ? kintone.app.getId() : '';
          if (!appId) {
            return { ok: false, reason: 'app_id_not_found', value: '', url: location.href };
          }
          return { ok: true, value: String(appId), url: location.href };
        }

        if (targetMode === 'viewId' || targetMode === 'view') {
          try {
            if (typeof kintone.app.getView === 'function') {
              const view = await Promise.resolve(kintone.app.getView());
              const id = view && view.id != null ? String(view.id).trim() : '';
              if (id) {
                return { ok: true, value: id, source: 'getView', url: location.href };
              }
            }
          } catch (_err) {
            // continue to URL fallback
          }

          try {
            const url = new URL(location.href);
            const viewParam = String(url.searchParams.get('view') || '').trim();
            if (viewParam) {
              return { ok: true, value: viewParam, source: 'url', url: location.href };
            }
          } catch (_err) {
            // ignore
          }

          return { ok: false, reason: 'view_id_not_available', value: '', source: 'none', url: location.href };
        }
        return { ok: false, reason: 'invalid_mode', value: '', url: location.href };
      } catch (error) {
        return {
          ok: false,
          reason: 'unexpected_error',
          value: '',
          url: location.href,
          detail: String(error?.message || error)
        };
      }
    },
    args: [mode]
  });
  return injected?.[0]?.result || { ok: false, reason: 'unexpected_error', value: '' };
}

async function copyDevTextToActiveTab(tabId, text, label) {
  let copied = null;
  try {
    copied = await chrome.tabs.sendMessage(tabId, {
      type: 'DEV_COPY_TEXT',
      text: String(text || ''),
      label
    });
  } catch (sendError) {
    copied = {
      ok: false,
      reason: 'receiving_end_does_not_exist',
      detail: String(sendError?.message || sendError)
    };
  }
  if (copied?.ok) return copied;
  const fallback = await copyTextViaInjectedScript(tabId, String(text || ''));
  if (fallback?.ok) return fallback;
  return { ok: false, reason: copied?.reason || fallback?.reason || 'copy_failed' };
}

const ENABLE_DEV_MENU = false; // 開発者向けメニューを有効化する場合は true に変更

async function setupContextMenus() {
  if (!chrome.contextMenus?.create) return;
  const lang = await resolveUiLanguage();
  const patterns = [
    'https://*.kintone.com/*',
    'https://*.kintone-dev.com/*',
    'https://*.cybozu.com/k/*'
  ];
  try {
    await chrome.contextMenus.removeAll();
  } catch (_err) {
    // ignore
  }
  try {
    chrome.contextMenus.create({
      id: PIN_MENU_ID,
      title: tMenu(lang, 'menu_pin_record'),
      contexts: ['page', 'frame'],
      documentUrlPatterns: patterns
    });
    chrome.contextMenus.create({
      id: FAVORITE_PARENT_ID,
      title: tMenu(lang, 'menu_favorite_parent'),
      contexts: ['page', 'frame'],
      documentUrlPatterns: patterns
    });
    chrome.contextMenus.create({
      id: FAVORITE_MENU_APP,
      parentId: FAVORITE_PARENT_ID,
      title: tMenu(lang, 'menu_favorite_app'),
      contexts: ['page', 'frame'],
      documentUrlPatterns: patterns
    });
    chrome.contextMenus.create({
      id: FAVORITE_MENU_VIEW,
      parentId: FAVORITE_PARENT_ID,
      title: tMenu(lang, 'menu_favorite_view'),
      contexts: ['page', 'frame'],
      documentUrlPatterns: patterns
    });
    chrome.contextMenus.create({
      id: SHORTCUT_PARENT_ID,
      title: tMenu(lang, 'menu_shortcut_parent'),
      contexts: ['page', 'frame'],
      documentUrlPatterns: patterns
    });
    chrome.contextMenus.create({
      id: SHORTCUT_MENU_APP,
      parentId: SHORTCUT_PARENT_ID,
      title: tMenu(lang, 'menu_shortcut_app'),
      contexts: ['page', 'frame'],
      documentUrlPatterns: patterns
    });
    chrome.contextMenus.create({
      id: SHORTCUT_MENU_VIEW,
      parentId: SHORTCUT_PARENT_ID,
      title: tMenu(lang, 'menu_shortcut_view'),
      contexts: ['page', 'frame'],
      documentUrlPatterns: patterns
    });
    chrome.contextMenus.create({
      id: SHORTCUT_MENU_CREATE,
      parentId: SHORTCUT_PARENT_ID,
      title: tMenu(lang, 'menu_shortcut_create'),
      contexts: ['page', 'frame'],
      documentUrlPatterns: patterns
    });

    if (ENABLE_DEV_MENU) {
      chrome.contextMenus.create({
        id: DEV_PARENT_MENU_ID,
        title: tMenu(lang, 'menu_dev_root'),
        contexts: ['all'],
        documentUrlPatterns: patterns
      });
      chrome.contextMenus.create({
        id: DEV_COPY_QUERY_MENU_ID,
        parentId: DEV_PARENT_MENU_ID,
        title: tMenu(lang, 'menu_copy_query'),
        contexts: ['all'],
        documentUrlPatterns: patterns
      });
      chrome.contextMenus.create({
        id: DEV_COPY_FIELDS_LIST_MENU_ID,
        parentId: DEV_PARENT_MENU_ID,
        title: tMenu(lang, 'menu_copy_fields'),
        contexts: ['all'],
        documentUrlPatterns: patterns
      });
      chrome.contextMenus.create({
        id: DEV_COPY_APP_ID_MENU_ID,
        parentId: DEV_PARENT_MENU_ID,
        title: tMenu(lang, 'menu_copy_app_id'),
        contexts: ['all'],
        documentUrlPatterns: patterns
      });
      chrome.contextMenus.create({
        id: DEV_COPY_VIEW_ID_MENU_ID,
        parentId: DEV_PARENT_MENU_ID,
        title: tMenu(lang, 'menu_copy_view_id'),
        contexts: ['all'],
        documentUrlPatterns: patterns
      });
    }
  } catch (_err) {
    // ignore
  }
}

chrome.contextMenus?.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === DEV_COPY_QUERY_MENU_ID) {
    try {
      const activeTab = await getActiveTabForDevAction(tab);
      if (!activeTab?.id) {
        console.debug('[kfav][DEV] no tab for context menu click');
        return;
      }
      const res = await chrome.tabs.sendMessage(activeTab.id, { type: 'DEV_COPY_QUERY' });
      if (!res?.ok) {
        console.debug('[kfav][DEV] copy failed', { type: 'DEV_COPY_QUERY', reason: res?.reason || res?.error || 'unknown' });
      } else {
        console.debug('[kfav][DEV] copied', { type: 'DEV_COPY_QUERY', value: res?.value || '' });
      }
    } catch (error) {
      console.error('[kfav][DEV] context menu action failed', error);
    }
    return;
  }
  if (info.menuItemId === DEV_COPY_FIELDS_LIST_MENU_ID) {
    try {
      const activeTab = await getActiveTabForDevAction(tab);
      if (!activeTab?.id) {
        console.debug('[kfav][DEV] no tab for fields list copy');
        return;
      }
      const tabId = activeTab.id;
      const tabUrl = activeTab.url || '';
      console.log('[kfav][DEV] copy fields start', { tabId, url: tabUrl });

      const fetched = await fetchFieldsListFromMainWorld(tabId);
      console.log('[kfav][DEV] copy fields fetched', {
        ok: Boolean(fetched?.ok),
        appId: fetched?.appId || '',
        url: fetched?.url || tabUrl,
        rowCount: Number(fetched?.rowCount || 0)
      });
      if (!fetched?.ok || !fetched?.text) {
        console.warn('[kfav][DEV] copy fields failed', {
          reason: fetched?.reason || 'unknown',
          tabId,
          url: fetched?.url || tabUrl
        });
        return;
      }
      let copied = null;
      try {
        copied = await chrome.tabs.sendMessage(tabId, {
          type: 'DEV_COPY_TEXT',
          text: fetched.text,
          label: 'fields-list'
        });
      } catch (sendError) {
        copied = {
          ok: false,
          reason: 'receiving_end_does_not_exist',
          detail: String(sendError?.message || sendError)
        };
      }
      if (!copied?.ok) {
        const fallback = await copyTextViaInjectedScript(tabId, fetched.text);
        if (!fallback?.ok) {
          console.warn('[kfav][DEV] copy fields failed', {
            reason: copied?.reason || fallback?.reason || 'unknown',
            tabId,
            url: fetched?.url || tabUrl
          });
          return;
        }
      }
      console.log('[kfav][DEV] copied fields list', {
        tabId,
        url: fetched?.url || tabUrl
      });
    } catch (error) {
      console.warn('[kfav][DEV] copy fields failed', {
        reason: String(error?.message || error),
        tabId: tab?.id || null,
        url: tab?.url || ''
      });
    }
    return;
  }
  if (info.menuItemId === DEV_COPY_APP_ID_MENU_ID) {
    try {
      const activeTab = await getActiveTabForDevAction(tab);
      if (!activeTab?.id) {
        console.warn('[kfav][DEV] copy appId failed', { reason: 'no_active_tab' });
        return;
      }
      const result = await fetchAppOrViewIdFromMainWorld(activeTab.id, 'appId');
      if (!result?.ok || !String(result?.value || '').trim()) {
        console.warn('[kfav][DEV] copy appId failed', {
          reason: result?.reason || 'app_id_not_found',
          tabId: activeTab.id,
          url: result?.url || activeTab.url || ''
        });
        return;
      }
      const copied = await copyDevTextToActiveTab(activeTab.id, String(result.value), 'appId');
      if (!copied?.ok) {
        console.warn('[kfav][DEV] copy appId failed', {
          reason: copied?.reason || 'clipboard_failed',
          tabId: activeTab.id,
          url: result?.url || activeTab.url || ''
        });
        return;
      }
      console.log('[kfav][DEV] copied appId');
    } catch (error) {
      console.warn('[kfav][DEV] copy appId failed', { reason: String(error?.message || error) });
    }
    return;
  }
  if (info.menuItemId === DEV_COPY_VIEW_ID_MENU_ID) {
    try {
      const activeTab = await getActiveTabForDevAction(tab);
      if (!activeTab?.id) {
        console.warn('[kfav][DEV] copy viewId failed', { reason: 'no_active_tab' });
        return;
      }
      const result = await fetchAppOrViewIdFromMainWorld(activeTab.id, 'view');
      if (!result?.ok) {
        console.warn('[kfav][DEV] copy viewId failed', {
          reason: result?.reason || 'not_kintone_page',
          tabId: activeTab.id,
          href: result?.url || activeTab.url || ''
        });
        return;
      }
      const value = String(result?.value || '').trim();
      if (!value) {
        console.warn('[kfav][DEV] copy viewId failed', {
          reason: 'view_id_not_found',
          tabId: activeTab.id,
          href: result?.url || activeTab.url || ''
        });
        return;
      }
      const copied = await copyDevTextToActiveTab(activeTab.id, value, 'viewId');
      if (!copied?.ok) {
        console.warn('[kfav][DEV] copy viewId failed', {
          reason: copied?.reason || 'clipboard_failed',
          tabId: activeTab.id,
          href: result?.url || activeTab.url || ''
        });
        return;
      }
      console.log('[kfav][DEV] copied viewId', { value, source: result?.source || 'unknown' });
    } catch (error) {
      console.warn('[kfav][DEV] copy viewId failed', {
        reason: String(error?.message || error),
        href: tab?.url || ''
      });
    }
    return;
  }
  if (info.menuItemId === FAVORITE_MENU_APP || info.menuItemId === FAVORITE_MENU_VIEW) {
    await handleFavoriteContextMenu(info.menuItemId, info, tab);
    return;
  }
  if (info.menuItemId === PIN_MENU_ID) {
    const pageUrl = info.pageUrl || tab?.url || '';
    const { host, appId, recordId } = parseKintoneUrl(pageUrl);
    if (!host || !appId || !recordId) return;
    const stored = await chrome.storage.sync.get('kfavPins');
    const raw = stored.kfavPins;
    const entries = Array.isArray(raw) ? raw : raw ? [raw] : [];
    if (entries.some((entry) => entry?.host === host && entry?.appId === appId && entry?.recordId === recordId)) {
      flashBadge(tab?.id, '!', '#e74c3c');
      return;
    }
    const label = (tab?.title || '').replace(/\s+-\s+kintone.*/i, '').trim();
    entries.push({
      id: createId(),
      label,
      host,
      appId,
      recordId,
      titleField: '',
      note: ''
    });
    await chrome.storage.sync.set({ kfavPins: entries });
    flashBadge(tab?.id, '✓', '#2ecc71');
    return;
  }
  if (info.menuItemId === SHORTCUT_MENU_APP || info.menuItemId === SHORTCUT_MENU_VIEW || info.menuItemId === SHORTCUT_MENU_CREATE) {
    await handleShortcutContextMenu(info.menuItemId, info, tab);
  }
});

function flashBadge(tabId, text, color) {
  if (!tabId) return;
  try {
    if (color) chrome.action.setBadgeBackgroundColor({ tabId, color });
    chrome.action.setBadgeText({ tabId, text });
    setTimeout(() => {
      chrome.action.setBadgeText({ tabId, text: '' }).catch(() => {});
    }, 1200);
  } catch (_e) {
    // ignore
  }
}

const DEFAULT_SHORTCUT_ICON = 'file-text';
const DEFAULT_SHORTCUT_ICON_COLOR = 'gray';
const SHORTCUT_ICON_MIGRATION_KEY = 'kfavShortcutsIconMigratedV1';

function toShortcutArray(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.slice();
  if (raw && typeof raw === 'object') return [raw];
  return [];
}

async function migrateShortcutsFillIconFieldsOnce() {
  try {
    const mark = await chrome.storage.local.get(SHORTCUT_ICON_MIGRATION_KEY);
    if (mark?.[SHORTCUT_ICON_MIGRATION_KEY]) return;
  } catch (_err) {
    // ignore
  }

  const stored = await chrome.storage.sync.get('kfavShortcuts');
  const list = toShortcutArray(stored.kfavShortcuts);
  if (list.length) {
    const normalized = await loadShortcuts();
    await saveShortcuts(normalized);
  }

  try {
    await chrome.storage.local.set({ [SHORTCUT_ICON_MIGRATION_KEY]: true });
  } catch (_err) {
    // ignore
  }
}

function favoriteUrlOf(host, appId, viewIdOrName) {
  const appKey = String(appId || '').trim();
  const base = `${host}/k/${appKey}/`;
  if (viewIdOrName) {
    return `${base}?view=${encodeURIComponent(String(viewIdOrName))}`;
  }
  return base;
}

function shortenLogValue(value, max = 240) {
  const text = String(value == null ? '' : value);
  if (text.length <= max) return text;
  return `${text.slice(0, max)}...`;
}

function logCtxAdd(message) {
  console.log(`[PB] ${message}`);
}

function warnCtxAdd(message) {
  console.warn(`[PB] ${message}`);
}

function errorCtxAdd(message, error) {
  const errMsg = String(error?.message || error || '');
  const stack = String(error?.stack || '').replace(/\s+/g, ' ').trim();
  console.error(`[PB] ${message} stack=${shortenLogValue(stack, 500)}`, errMsg);
}

function isWatchlistAddableAppListPage(urlValue) {
  try {
    const url = new URL(String(urlValue || ''));
    return /^\/k\/\d+\/?$/.test(String(url.pathname || ''));
  } catch (_err) {
    return false;
  }
}

function resolveWatchlistTargetFromUrl(menuId, info, tab) {
  const tabUrl = String(tab?.url || '').trim();
  const pageUrl = String(info?.pageUrl || '').trim();
  const frameUrl = String(info?.frameUrl || '').trim();
  const candidates = [tabUrl, pageUrl, frameUrl].filter(Boolean);
  const firstKintoneUrl = candidates.find((value) => isKintoneUrl(value));
  if (!firstKintoneUrl) {
    return {
      ok: false,
      reason: 'kintone_url_not_found',
      message: WATCHLIST_CTX_UNSUPPORTED_PAGE_MESSAGE
    };
  }
  if (!isWatchlistAddableAppListPage(firstKintoneUrl)) {
    return {
      ok: false,
      reason: 'unsupported_page',
      message: WATCHLIST_CTX_UNSUPPORTED_PAGE_MESSAGE,
      pageUrl: firstKintoneUrl
    };
  }
  const parsed = parseKintoneUrl(firstKintoneUrl);
  const host = String(parsed?.host || '').trim();
  const appId = String(parsed?.appId || '').trim();
  const parsedViewId = String(parsed?.viewId || parsed?.viewIdOrName || '').trim();
  if (!host || !appId) {
    return {
      ok: false,
      reason: 'missing_host_or_app',
      message: 'Watchlist追加失敗: appIdを解決できません'
    };
  }
  return {
    ok: true,
    menuId: String(menuId || '').trim(),
    host,
    appId,
    viewIdOrName: parsedViewId,
    pageUrl: firstKintoneUrl,
    tabUrl,
    rawPageUrl: pageUrl,
    rawFrameUrl: frameUrl
  };
}

function buildWatchlistItem({
  host,
  appId,
  viewId,
  viewName = '',
  query,
  label = '',
  order = 0
}) {
  const resolvedViewId = String(viewId || '').trim();
  const queryRaw = query;
  const resolvedQuery = String(queryRaw == null ? '' : queryRaw).trim();
  const resolvedHost = String(host || '').trim();
  const resolvedAppId = String(appId || '').trim();
  const hasResolvableQuery = queryRaw != null && resolvedQuery !== '-';
  if (!resolvedHost || !resolvedAppId || !hasResolvableQuery) {
    return { ok: false, reason: 'required_fields_missing' };
  }
  const canonicalUrl = favoriteUrlOf(resolvedHost, resolvedAppId, resolvedViewId);
  if (!canonicalUrl) return { ok: false, reason: 'url_build_failed' };
  const resolvedLabel = String(label || '').trim() || `App ${resolvedAppId}`;
  return {
    ok: true,
    item: {
      id: createId(),
      label: resolvedLabel,
      title: resolvedLabel,
      url: canonicalUrl,
      host: resolvedHost,
      appId: resolvedAppId,
      viewId: resolvedViewId,
      viewIdOrName: resolvedViewId,
      viewName: String(viewName || '').trim(),
      query: resolvedQuery,
      queryRepairRequired: false,
      icon: DEFAULT_WATCHLIST_ICON,
      iconColor: DEFAULT_WATCHLIST_ICON_COLOR,
      category: DEFAULT_WATCHLIST_CATEGORY,
      order,
      pinned: false
    }
  };
}

async function saveWatchlistItem(list, item, limit) {
  const source = Array.isArray(list) ? list.slice() : [];
  const max = Number(limit) > 0 ? Number(limit) : DEFAULT_WATCHLIST_LIMIT;
  if (source.length >= max) {
    return { ok: false, reason: 'limit_reached' };
  }
  if (source.some((entry) => String(entry?.url || '') === String(item?.url || ''))) {
    return { ok: false, reason: 'duplicate_url' };
  }
  source.push(item);
  source.forEach((entry, index) => {
    if (typeof entry.order !== 'number') entry.order = index;
  });
  await saveFavoriteList(source);
  return { ok: true, list: source };
}

function extractQueryParamFromUrl(urlValue) {
  try {
    const url = new URL(String(urlValue || ''));
    return String(url.searchParams.get('query') || '').trim();
  } catch (_err) {
    return '';
  }
}

function extractViewFilterFromViews(viewsObj, viewIdOrName) {
  if (!viewsObj || typeof viewsObj !== 'object') {
    return { matched: false, query: '', viewId: '', viewName: '', reason: 'missing_views' };
  }
  const entries = Object.entries(viewsObj);
  if (!entries.length) {
    return {
      matched: true,
      query: '',
      viewId: '',
      viewName: 'All Records',
      reason: 'all_records_virtual'
    };
  }

  const target = String(viewIdOrName || '').trim();
  if (target) {
    const byId = entries.find(([, view]) => String(view?.id || '').trim() === target);
    if (byId) {
      const queryRaw = byId[1]?.filterCond;
      return {
        matched: true,
        query: queryRaw == null ? null : String(queryRaw).trim(),
        viewName: String(byId[0] || '').trim(),
        viewId: String(byId[1]?.id || '').trim(),
        reason: 'matched_view_id'
      };
    }
    const byName = entries.find(([name]) => String(name || '').trim() === target);
    if (byName) {
      const queryRaw = byName[1]?.filterCond;
      return {
        matched: true,
        query: queryRaw == null ? null : String(queryRaw).trim(),
        viewName: String(byName[0] || '').trim(),
        viewId: String(byName[1]?.id || '').trim(),
        reason: 'matched_view_name'
      };
    }
    return { matched: false, query: '', viewId: '', viewName: '', reason: 'view_not_found' };
  }

  const indexed = entries
    .map(([name, view], idx) => ({
      name: String(name || '').trim(),
      view: view || {},
      idx,
      order: Number(view?.index)
    }))
    .sort((a, b) => {
      const aOrder = Number.isFinite(a.order) ? a.order : Number.POSITIVE_INFINITY;
      const bOrder = Number.isFinite(b.order) ? b.order : Number.POSITIVE_INFINITY;
      if (aOrder !== bOrder) return aOrder - bOrder;
      return a.idx - b.idx;
    });
  const picked = indexed[0];
  const queryRaw = picked?.view?.filterCond;
  return {
    matched: true,
    query: queryRaw == null ? null : String(queryRaw).trim(),
    viewName: String(picked?.name || '').trim(),
    viewId: String(picked?.view?.id || '').trim(),
    reason: 'default_view'
  };
}

async function resolveWatchlistQueryForRegistration({
  host,
  appId,
  viewIdOrName,
  pageUrl,
  tabId
}) {
  const viewKey = String(viewIdOrName || '').trim();
  const appKey = String(appId || '').trim();
  if (!host || !appKey) return { ok: false, query: '', viewId: '', viewName: '', reason: 'missing_host_or_app' };
  try {
    logCtxAdd(`CTX_ADD resolve views start appId=${appKey} viewHint=${viewKey || '-'} tabId=${tabId || '-'}`);
    const forward = {
      type: 'LIST_VIEWS',
      payload: {
        appId: appKey,
        __pbTrigger: 'watchlist_register',
        __pbSource: 'context_menu'
      }
    };
    let response = null;
    try {
      if (tabId) {
        response = await runForwardOnTab(tabId, host, forward);
      } else {
        throw new Error('tabId_missing_for_primary');
      }
    } catch (directErr) {
      warnCtxAdd(`CTX_ADD resolve views direct_tab_failed reason=${shortenLogValue(String(directErr?.message || directErr))}`);
      response = await runForwardOnHost(host, forward);
    }
    if (!response?.ok || !response?.views || typeof response.views !== 'object') {
      return { ok: false, query: '', viewId: '', viewName: '', reason: String(response?.error || 'LIST_VIEWS failed') };
    }
    const resolved = extractViewFilterFromViews(response.views, viewKey);
    const finalQuery = String(resolved?.query || '').trim();
    if (!resolved.matched) {
      return { ok: false, query: '', viewId: '', viewName: '', reason: resolved.reason || 'view_not_found' };
    }
    if (resolved.reason === 'default_view' || resolved.reason === 'all_records_virtual') {
      logCtxAdd(`CTX_ADD resolved default viewId=${resolved.viewId || '-'}`);
    }
    if (finalQuery === '-') {
      return { ok: false, query: '', viewId: resolved.viewId, viewName: resolved.viewName || '', reason: 'query_not_found' };
    }
    logCtxAdd(`CTX_ADD resolved query=${shortenLogValue(finalQuery || '(empty)', 180)}`);
    return { ok: true, query: finalQuery, viewId: resolved.viewId, viewName: resolved.viewName || '' };
  } catch (error) {
    return { ok: false, query: '', viewId: '', viewName: '', reason: String(error?.message || error || 'view_resolve_failed') };
  }
}

async function loadFavoriteList() {
  const stored = await chrome.storage.sync.get(FAVORITES_KEY);
  const raw = stored[FAVORITES_KEY];
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.slice();
  if (raw && typeof raw === 'object') return [raw];
  return [];
}

async function saveFavoriteList(list) {
  await chrome.storage.sync.set({ [FAVORITES_KEY]: list });
}

async function handleFavoriteContextMenu(menuId, info, tab) {
  const pageUrl = String(info?.pageUrl || '').trim();
  const tabUrl = String(tab?.url || '').trim();
  logCtxAdd(`CTX_ADD start menuId=${menuId} pageUrl=${shortenLogValue(pageUrl)} tabUrl=${shortenLogValue(tabUrl)}`);
  try {
    const target = resolveWatchlistTargetFromUrl(menuId, info, tab);
    if (!target.ok) {
      warnCtxAdd(`CTX_ADD save blocked reason=${target.reason} message=${target.message || '-'}`);
      flashBadge(tab?.id, '!', '#e67e22');
      return;
    }
    logCtxAdd(`CTX_ADD parsed host/appId/viewId=${target.host}/${target.appId}/${target.viewIdOrName || '-'}`);

    const watchlistLimit = await loadWatchlistLimit();
    const list = await loadFavoriteList();
    if (list.length >= watchlistLimit) {
      warnCtxAdd(`CTX_ADD save blocked reason=limit_reached limit=${watchlistLimit}`);
      flashBadge(tab?.id, '!', '#e67e22');
      return;
    }

    const resolvedQuery = await resolveWatchlistQueryForRegistration({
      host: target.host,
      appId: target.appId,
      viewIdOrName: target.viewIdOrName,
      pageUrl: target.pageUrl,
      tabId: tab?.id
    });
    if (!resolvedQuery.ok) {
      warnCtxAdd(`CTX_ADD save blocked reason=${resolvedQuery.reason || 'query_resolve_failed'}`);
      flashBadge(tab?.id, '!', '#e74c3c');
      return;
    }

    const labelFromTab = String(tab?.title || '').replace(/\s+-\s+kintone.*/i, '').trim();
    const built = buildWatchlistItem({
      host: target.host,
      appId: target.appId,
      viewId: resolvedQuery.viewId,
      viewName: resolvedQuery.viewName || '',
      query: resolvedQuery.query,
      label: labelFromTab || `App ${target.appId}`,
      order: list.length
    });
    if (!built.ok || !built.item) {
      warnCtxAdd(`CTX_ADD save blocked reason=${built.reason || 'build_failed'}`);
      flashBadge(tab?.id, '!', '#e74c3c');
      return;
    }

    const saved = await saveWatchlistItem(list, built.item, watchlistLimit);
    if (!saved.ok) {
      warnCtxAdd(`CTX_ADD save blocked reason=${saved.reason || 'save_failed'}`);
      flashBadge(tab?.id, '!', '#e67e22');
      return;
    }
    logCtxAdd(`CTX_ADD save success id=${built.item.id}`);
    try {
      await chrome.runtime.sendMessage({ type: 'WARMUP_CONNECTOR', host: target.host });
    } catch (_err) {
      // ignore
    }
    flashBadge(tab?.id, '+', '#f1c40f');
  } catch (error) {
    errorCtxAdd(`CTX_ADD error message=${shortenLogValue(String(error?.message || error || 'unknown'))}`, error);
    flashBadge(tab?.id, '!', '#e74c3c');
  }
}

function shortcutDefaultLabel(type, appId, viewIdOrName) {
  if (type === 'view') {
    return viewIdOrName ? `ビュー ${viewIdOrName}` : `アプリ ${appId}`;
  }
  if (type === 'create') return 'レコード新規';
  return `アプリ ${appId}`;
}

async function handleShortcutContextMenu(menuId, info, tab) {
  const type = menuId === SHORTCUT_MENU_VIEW
    ? 'view'
    : menuId === SHORTCUT_MENU_CREATE
      ? 'create'
      : 'appTop';
  const pageUrl = info.pageUrl || tab?.url || '';
  const { host, appId, viewIdOrName } = parseKintoneUrl(pageUrl);
  if (!host || !appId) {
    flashBadge(tab?.id, '!', '#e74c3c');
    return;
  }
  if (type === 'view' && !viewIdOrName) {
    flashBadge(tab?.id, '!', '#e67e22');
    return;
  }
  const list = await loadShortcuts();
  const appIdStr = String(appId || '').trim();
  const normalizedView = type === 'view' ? String(viewIdOrName || '') : '';
  const duplicate = list.some((item) => {
    if (!item) return false;
    const sameType = item.type === type;
    const sameHost = item.host === host;
    const sameApp = String(item.appId || '').trim() === appIdStr;
    const sameView = String(item.viewIdOrName || '') === normalizedView;
    return sameType && sameHost && sameApp && sameView;
  });
  if (duplicate) {
    flashBadge(tab?.id, '!', '#e67e22');
    return;
  }
  const title = (tab?.title || '').replace(/\s+-\s+kintone.*/i, '').trim();
  const label = title || shortcutDefaultLabel(type, appIdStr, normalizedView);
  list.push({
    id: createId(),
    type,
    host,
    appId: appIdStr,
    viewIdOrName: normalizedView,
    label,
    initial: '',
    icon: DEFAULT_SHORTCUT_ICON,
    iconColor: DEFAULT_SHORTCUT_ICON_COLOR,
    order: list.length
  });
  await saveShortcuts(list);
  flashBadge(tab?.id, '+', '#2980b9');
}

async function listKintoneTabsByHost(host) {
  const tabs = await chrome.tabs.query({ url: [`${host}/*`] });
  return tabs;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function normalizeHostOrigin(host) {
  const raw = String(host || '').trim();
  if (!raw) return '';
  try {
    return new URL(raw).origin.replace(/\/$/, '').toLowerCase();
  } catch (_err) {
    return raw.replace(/\/$/, '').toLowerCase();
  }
}

const READY_CHECK_INTERVAL_MS = 400;
const READY_CHECK_SHORT_ATTEMPTS = 5;
const SIGN_IN_REQUIRED_MESSAGE = 'kintoneにサインインしてから再実行してください';
const APPS_MAP_PAGE_LIMIT = 100;
const APPS_MAP_MAX_PAGES = 200;
const PB_METADATA_CACHE_VERSION = 1;
const PB_METADATA_CACHE_PREFIX = 'pb:meta:v1:';
const PB_METADATA_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const metadataMemoryCache = new Map();
const PB_TEMP_DEBUG = true; // temporary debug for metadata bootstrap investigation

function normalizeMetadataDebugMeta(options = {}) {
  return {
    trigger: String(options?.trigger || 'unknown').trim().toLowerCase() || 'unknown',
    source: String(options?.source || 'service_worker').trim() || 'service_worker',
    logGroup: String(options?.logGroup || 'bootstrap').trim().toLowerCase() || 'bootstrap'
  };
}

function pbDebugLog(message, extra) {
  if (!PB_TEMP_DEBUG) return;
  if (extra === undefined) {
    console.debug(message);
  } else {
    console.debug(message, extra);
  }
}

function normalizeMetadataAppId(appId) {
  const value = String(appId || '').trim();
  return /^\d+$/.test(value) ? value : '';
}

function metadataCacheKey(host, appId) {
  const safeHost = normalizeHostOrigin(host);
  const safeAppId = normalizeMetadataAppId(appId);
  if (!safeHost || !safeAppId) return '';
  return `${PB_METADATA_CACHE_PREFIX}${safeHost}:${safeAppId}`;
}

function cloneMetadataBundle(bundle) {
  if (!bundle || typeof bundle !== 'object') return null;
  try {
    if (globalThis.structuredClone) return globalThis.structuredClone(bundle);
  } catch (_err) {
    // fallback below
  }
  try {
    return JSON.parse(JSON.stringify(bundle));
  } catch (_err) {
    return null;
  }
}

function normalizeMetadataBundle(raw, host, appId) {
  if (!raw || typeof raw !== 'object') return null;
  const safeHost = normalizeHostOrigin(host || raw.host);
  const safeAppId = normalizeMetadataAppId(appId || raw.appId);
  if (!safeHost || !safeAppId) return null;
  const fetchedAt = Number(raw.fetchedAt);
  const expiresAt = Number(raw.expiresAt);
  const bundle = {
    version: PB_METADATA_CACHE_VERSION,
    host: safeHost,
    appId: safeAppId,
    fetchedAt: Number.isFinite(fetchedAt) && fetchedAt > 0 ? Math.floor(fetchedAt) : 0,
    expiresAt: Number.isFinite(expiresAt) && expiresAt > 0 ? Math.floor(expiresAt) : 0
  };
  if (raw.app && typeof raw.app === 'object') {
    bundle.app = {
      name: String(raw.app.name || '').trim(),
      raw: raw.app.raw && typeof raw.app.raw === 'object' ? raw.app.raw : undefined
    };
  }
  if (raw.views && typeof raw.views === 'object') {
    bundle.views = {
      raw: raw.views.raw && typeof raw.views.raw === 'object' ? raw.views.raw : undefined
    };
  }
  if (raw.fields && typeof raw.fields === 'object') {
    bundle.fields = {
      normalized: Array.isArray(raw.fields.normalized) ? raw.fields.normalized : undefined,
      raw: raw.fields.raw && typeof raw.fields.raw === 'object' ? raw.fields.raw : undefined
    };
  }
  return bundle;
}

function isMetadataFresh(bundle) {
  if (!bundle || typeof bundle !== 'object') return false;
  if (Number(bundle.version) !== PB_METADATA_CACHE_VERSION) return false;
  return Number(bundle.expiresAt || 0) > Date.now();
}

function hasMetadataPiece(bundle, pieceName) {
  if (!bundle || typeof bundle !== 'object') return false;
  if (pieceName === 'app') return Boolean(String(bundle?.app?.name || '').trim());
  if (pieceName === 'views') return Boolean(bundle?.views?.raw && typeof bundle.views.raw === 'object');
  if (pieceName === 'fields') return Array.isArray(bundle?.fields?.normalized) && bundle.fields.normalized.length > 0;
  return false;
}

function normalizeMetadataNeedFlags(options = {}) {
  return {
    needApp: Boolean(options?.needApp),
    needViews: Boolean(options?.needViews),
    needFields: Boolean(options?.needFields),
    forceAppRefresh: Boolean(options?.forceAppRefresh),
    forceViewsRefresh: Boolean(options?.forceViewsRefresh),
    forceFieldsRefresh: Boolean(options?.forceFieldsRefresh)
  };
}

function hasRequiredMetadata(bundle, needFlags) {
  if (!bundle || typeof bundle !== 'object') return false;
  if (needFlags.needApp && !hasMetadataPiece(bundle, 'app')) return false;
  if (needFlags.needViews && !hasMetadataPiece(bundle, 'views')) return false;
  if (needFlags.needFields && !hasMetadataPiece(bundle, 'fields')) return false;
  return true;
}

function shouldFetchMetadataPiece(bundle, isFresh, needFlags, pieceName) {
  const needKey = `need${pieceName.charAt(0).toUpperCase()}${pieceName.slice(1)}`;
  if (!needFlags[needKey]) return false;
  const forceKey = `force${pieceName.charAt(0).toUpperCase()}${pieceName.slice(1)}Refresh`;
  if (needFlags[forceKey]) return true;
  if (!bundle) return true;
  if (!isFresh) return true;
  return !hasMetadataPiece(bundle, pieceName);
}

async function readMetadataBundle(host, appId) {
  const key = metadataCacheKey(host, appId);
  if (!key) return null;
  const inMemory = metadataMemoryCache.get(key);
  if (inMemory) return cloneMetadataBundle(inMemory);
  try {
    const stored = await chrome.storage.local.get(key);
    const normalized = normalizeMetadataBundle(stored?.[key], host, appId);
    if (!normalized) return null;
    metadataMemoryCache.set(key, normalized);
    return cloneMetadataBundle(normalized);
  } catch (_err) {
    return null;
  }
}

async function getCachedMetadataBundle(host, appId, options = {}) {
  const safeHost = normalizeHostOrigin(host);
  const safeAppId = normalizeMetadataAppId(appId);
  if (!safeHost || !safeAppId) {
    return { ok: false, error: 'host/appId required', bundle: null, fresh: false };
  }
  const needFlags = normalizeMetadataNeedFlags(options);
  const bundle = await readMetadataBundle(safeHost, safeAppId);
  const fresh = isMetadataFresh(bundle);
  const hasRequired = hasRequiredMetadata(bundle, needFlags);
  const ok = fresh && hasRequired;
  return {
    ok,
    host: safeHost,
    appId: safeAppId,
    bundle,
    fresh
  };
}

async function writeMetadataBundle(bundle) {
  const normalized = normalizeMetadataBundle(bundle, bundle?.host, bundle?.appId);
  if (!normalized) return null;
  const key = metadataCacheKey(normalized.host, normalized.appId);
  if (!key) return null;
  metadataMemoryCache.set(key, normalized);
  try {
    await chrome.storage.local.set({ [key]: normalized });
  } catch (_err) {
    // ignore storage write failures
  }
  return cloneMetadataBundle(normalized);
}

async function clearMetadataBundle(host, appId) {
  const key = metadataCacheKey(host, appId);
  if (!key) return false;
  metadataMemoryCache.delete(key);
  try {
    await chrome.storage.local.remove(key);
  } catch (_err) {
    // ignore
  }
  return true;
}

async function clearAllMetadataBundles() {
  metadataMemoryCache.clear();
  let removed = 0;
  try {
    const all = await chrome.storage.local.get(null);
    const keys = Object.keys(all || {}).filter((key) => key.startsWith(PB_METADATA_CACHE_PREFIX));
    if (keys.length) {
      await chrome.storage.local.remove(keys);
      removed = keys.length;
    }
  } catch (_err) {
    // ignore
  }
  return removed;
}

async function clearMetadataBundlesByHost(host) {
  const safeHost = normalizeHostOrigin(host);
  if (!safeHost) return 0;
  const removedKeys = new Set();
  const prefix = `${PB_METADATA_CACHE_PREFIX}${safeHost}:`;
  try {
    for (const key of Array.from(metadataMemoryCache.keys())) {
      if (key.startsWith(prefix)) {
        metadataMemoryCache.delete(key);
        removedKeys.add(key);
      }
    }
    const all = await chrome.storage.local.get(null);
    const keys = Object.keys(all || {}).filter((key) => key.startsWith(prefix));
    if (keys.length) {
      await chrome.storage.local.remove(keys);
      keys.forEach((key) => removedKeys.add(key));
    }
  } catch (_err) {
    // ignore
  }
  return removedKeys.size;
}

async function fetchAppNamesByIds(host, appIds) {
  const safeHost = normalizeHostOrigin(host);
  const uniqueIds = Array.from(new Set((appIds || []).map((id) => String(id || '').trim()).filter((id) => /^\d+$/.test(id))));
  if (!safeHost || !uniqueIds.length) return {};
  let cachedMap = {};
  try {
    const cached = await loadAppNameMap(safeHost);
    cachedMap = cached?.map && typeof cached.map === 'object' ? cached.map : {};
  } catch (_err) {
    cachedMap = {};
  }
  const out = {};
  uniqueIds.forEach((appId) => {
    const name = String(cachedMap?.[appId] || '').trim();
    if (name) out[appId] = name;
  });
  const missingIds = uniqueIds.filter((appId) => !String(out[appId] || '').trim());
  if (!missingIds.length) {
    return out;
  }
  const fetched = await fetchAppsMapByAppIds(safeHost, missingIds);
  if (Object.keys(fetched).length) {
    await saveAppNameMap(safeHost, { ...cachedMap, ...fetched });
    Object.assign(out, fetched);
  }
  return out;
}

async function invalidateHostCaches(host, reason = 'permission_changed') {
  const safeHost = normalizeHostOrigin(host);
  if (!safeHost) return null;
  const appNameCacheCleared = await clearAppNameMap(safeHost);
  const metadataRemoved = await clearMetadataBundlesByHost(safeHost);
  return {
    host: safeHost,
    reason: String(reason || 'permission_changed'),
    categories: [
      'app_list_cache',
      'app_metadata_cache',
      'recent_record_name_resolution_cache',
      'bootstrap_cache',
      'app_search_source_cache'
    ],
    cleared: {
      appListCache: Boolean(appNameCacheCleared),
      metadataBundleCount: metadataRemoved,
      recentNameResolutionCache: Boolean(appNameCacheCleared),
      bootstrapCache: metadataRemoved,
      appSearchSourceCache: true
    }
  };
}

async function handleOptionalHostPermissionChange(permissions, reason = 'granted') {
  const hosts = extractHostOriginsFromPermissions(permissions);
  if (!hosts.length) return;
  const invalidations = [];
  for (const host of hosts) {
    const result = await invalidateHostCaches(host, reason);
    if (result) invalidations.push(result);
  }
  if (!invalidations.length) return;
  const payload = {
    reason,
    hosts: invalidations.map((item) => item.host),
    invalidations
  };
  await broadcastRuntimeMessage({ type: CACHE_INVALIDATED_MESSAGE, payload });
  await broadcastRuntimeMessage({ type: PERMISSION_UPDATED_MESSAGE, payload });
  if (reason === 'granted') {
    await broadcastRuntimeMessage({ type: HOST_PERMISSION_GRANTED_MESSAGE, payload });
  } else if (reason === 'removed') {
    await broadcastRuntimeMessage({ type: HOST_PERMISSION_REMOVED_MESSAGE, payload });
  }
}

async function fetchMetadataAppPiece(host, appId, options = {}) {
  const debugMeta = normalizeMetadataDebugMeta(options);
  const res = await runForwardOnHost(host, {
    type: 'META_GET_APP',
    payload: { appId, trigger: debugMeta.trigger, source: debugMeta.source }
  });
  if (res?.ok && res?.app && typeof res.app === 'object') {
    return {
      name: String(res.app.name || '').trim(),
      raw: res.app.raw && typeof res.app.raw === 'object' ? res.app.raw : undefined
    };
  }
  throw new Error(String(res?.error || 'meta_app_fetch_failed'));
}

async function fetchMetadataViewsPiece(host, appId, options = {}) {
  const debugMeta = normalizeMetadataDebugMeta(options);
  const res = await runForwardOnHost(host, {
    type: 'META_GET_VIEWS',
    payload: { appId, trigger: debugMeta.trigger, source: debugMeta.source }
  });
  if (res?.ok && res?.views && typeof res.views === 'object') {
    return {
      raw: res.views
    };
  }
  throw new Error(String(res?.error || 'meta_views_fetch_failed'));
}

async function fetchMetadataFieldsPiece(host, appId, options = {}) {
  const debugMeta = normalizeMetadataDebugMeta(options);
  const res = await runForwardOnHost(host, {
    type: 'META_GET_FIELDS',
    payload: { appId, trigger: debugMeta.trigger, source: debugMeta.source }
  });
  if (res?.ok && res?.fields && typeof res.fields === 'object') {
    return {
      normalized: Array.isArray(res.fields.normalized) ? res.fields.normalized : [],
      raw: res.fields.raw && typeof res.fields.raw === 'object' ? res.fields.raw : undefined
    };
  }
  throw new Error(String(res?.error || 'meta_fields_fetch_failed'));
}

async function getMetadataBundle(host, appId, options = {}) {
  const safeHost = normalizeHostOrigin(host);
  const safeAppId = normalizeMetadataAppId(appId);
  if (!safeHost || !safeAppId) {
    return { ok: false, error: 'host/appId required', bundle: null };
  }
  const needFlags = normalizeMetadataNeedFlags(options);
  const debugMeta = normalizeMetadataDebugMeta(options);
  const cached = await readMetadataBundle(safeHost, safeAppId);
  const fresh = isMetadataFresh(cached);
  const nextBundle = normalizeMetadataBundle(cached, safeHost, safeAppId) || {
    version: PB_METADATA_CACHE_VERSION,
    host: safeHost,
    appId: safeAppId,
    fetchedAt: 0,
    expiresAt: 0
  };

  const errors = {};
  let updated = false;

  if (shouldFetchMetadataPiece(nextBundle, fresh, needFlags, 'app')) {
    pbDebugLog(`[PB][${debugMeta.logGroup}] endpoint=/k/v1/app.json trigger=${debugMeta.trigger} cache=miss`);
    try {
      nextBundle.app = await fetchMetadataAppPiece(safeHost, safeAppId, debugMeta);
      updated = true;
    } catch (error) {
      errors.app = String(error?.message || error);
    }
  } else if (needFlags.needApp && hasMetadataPiece(nextBundle, 'app')) {
    pbDebugLog(`[PB][${debugMeta.logGroup}] endpoint=/k/v1/app.json trigger=${debugMeta.trigger} cache=hit`);
  }
  if (shouldFetchMetadataPiece(nextBundle, fresh, needFlags, 'views')) {
    pbDebugLog(`[PB][${debugMeta.logGroup}] endpoint=/k/v1/app/views.json trigger=${debugMeta.trigger} cache=miss`);
    try {
      nextBundle.views = await fetchMetadataViewsPiece(safeHost, safeAppId, debugMeta);
      updated = true;
    } catch (error) {
      errors.views = String(error?.message || error);
    }
  } else if (needFlags.needViews && hasMetadataPiece(nextBundle, 'views')) {
    pbDebugLog(`[PB][${debugMeta.logGroup}] endpoint=/k/v1/app/views.json trigger=${debugMeta.trigger} cache=hit`);
  }
  if (shouldFetchMetadataPiece(nextBundle, fresh, needFlags, 'fields')) {
    pbDebugLog(`[PB][${debugMeta.logGroup}] endpoint=/k/v1/app/form/fields.json trigger=${debugMeta.trigger} cache=miss`);
    try {
      nextBundle.fields = await fetchMetadataFieldsPiece(safeHost, safeAppId, debugMeta);
      updated = true;
    } catch (error) {
      errors.fields = String(error?.message || error);
    }
  } else if (needFlags.needFields && hasMetadataPiece(nextBundle, 'fields')) {
    pbDebugLog(`[PB][${debugMeta.logGroup}] endpoint=/k/v1/app/form/fields.json trigger=${debugMeta.trigger} cache=hit`);
  }

  if (updated) {
    const now = Date.now();
    nextBundle.version = PB_METADATA_CACHE_VERSION;
    nextBundle.host = safeHost;
    nextBundle.appId = safeAppId;
    nextBundle.fetchedAt = now;
    nextBundle.expiresAt = now + PB_METADATA_CACHE_TTL_MS;
    await writeMetadataBundle(nextBundle);
  } else if (cached) {
    metadataMemoryCache.set(metadataCacheKey(safeHost, safeAppId), normalizeMetadataBundle(cached, safeHost, safeAppId));
  }

  const finalBundle = await readMetadataBundle(safeHost, safeAppId) || normalizeMetadataBundle(nextBundle, safeHost, safeAppId);
  const hasRequired = hasRequiredMetadata(finalBundle, needFlags);
  const ok = hasRequired || (!needFlags.needApp && !needFlags.needViews && !needFlags.needFields);
  return {
    ok,
    host: safeHost,
    appId: safeAppId,
    bundle: finalBundle,
    cacheHit: fresh && !updated,
    errors
  };
}

async function checkKintoneReady(tabId) {
  if (!tabId) return false;
  try {
    const res = await chrome.tabs.sendMessage(tabId, { type: 'CHECK_KINTONE_READY' });
    return !!res?.ok && !!res.ready;
  } catch (_err) {
    return false;
  }
}

async function prepareConnectorTab(tabId, attempts) {
  if (!tabId) return false;
  const max = attempts ?? READY_CHECK_SHORT_ATTEMPTS;
  for (let i = 0; i < max; i++) {
    const injected = await ensureInjection(tabId);
    if (injected && (await checkKintoneReady(tabId))) {
      return true;
    }
    await sleep(READY_CHECK_INTERVAL_MS);
  }
  return false;
}

async function ensureInjection(tabId) {
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
    const bridgeSrc = chrome.runtime.getURL('page-bridge.js');
    await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: (src) => {
        if (!document.getElementById('__kfav_bridge')) {
          const s = document.createElement('script');
          s.id = '__kfav_bridge';
          s.src = src;
          (document.head || document.documentElement).appendChild(s);
        }
      },
      args: [bridgeSrc]
    });
    return true;
  } catch (e) {
    return false;
  }
}

async function ensureConnectorTab(host) {
  if (!host) return null;
  const existing = await listKintoneTabsByHost(host);
  for (const tab of existing) {
    if (!tab?.id) continue;
    const ready = await prepareConnectorTab(tab.id, READY_CHECK_SHORT_ATTEMPTS);
    if (ready) return tab;
  }
  if (!existing.length) {
    throw new Error('No open kintone tab found for this host');
  }
  throw new Error(SIGN_IN_REQUIRED_MESSAGE);
}

async function runForwardOnHost(host, forward) {
  const safeHost = normalizeHostOrigin(host);
  if (!safeHost) throw new Error('host required');
  const tab = await ensureConnectorTab(safeHost);
  if (!tab) throw new Error('no tab');
  await ensureInjection(tab.id);
  return await chrome.tabs.sendMessage(tab.id, forward);
}

async function runForwardOnTab(tabId, host, forward) {
  const normalizedTabId = Number(tabId);
  if (!Number.isInteger(normalizedTabId) || normalizedTabId <= 0) {
    throw new Error('tabId required');
  }
  const safeHost = normalizeHostOrigin(host);
  if (!safeHost) throw new Error('host required');
  const tab = await chrome.tabs.get(normalizedTabId);
  const tabHost = normalizeHostOrigin(tab?.url || '');
  if (tabHost && tabHost !== safeHost) {
    throw new Error(`tab host mismatch: expected ${safeHost}, got ${tabHost}`);
  }
  const ready = await prepareConnectorTab(normalizedTabId, READY_CHECK_SHORT_ATTEMPTS);
  if (!ready) {
    throw new Error('connector_not_ready');
  }
  return await chrome.tabs.sendMessage(normalizedTabId, forward);
}

async function fetchAppsMap(host) {
  const safeHost = normalizeHostOrigin(host);
  if (!safeHost) throw new Error('host required');
  const out = {};
  let offset = 0;
  for (let page = 0; page < APPS_MAP_MAX_PAGES; page++) {
    const url = `${safeHost}/k/v1/apps.json?limit=${APPS_MAP_PAGE_LIMIT}&offset=${offset}`;
    const resp = await fetch(url, {
      method: 'GET',
      credentials: 'include',
      headers: {
        Accept: 'application/json',
        'X-Requested-With': 'XMLHttpRequest'
      }
    });
    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      console.debug('[kfav] apps.json failed', { url, status: resp.status, text: String(text).slice(0, 300) });
      throw new Error(`apps.json failed (${resp.status})`);
    }
    const json = await resp.json();
    const apps = Array.isArray(json?.apps) ? json.apps : [];
    apps.forEach((item) => {
      const appId = String(item?.appId || item?.id || '').trim();
      const name = String(item?.name || '').trim();
      if (!appId || !name) return;
      out[appId] = name;
    });
    if (apps.length < APPS_MAP_PAGE_LIMIT) break;
    offset += apps.length;
  }
  return out;
}

async function fetchAppsMapByAppIds(host, appIds) {
  const safeHost = normalizeHostOrigin(host);
  const uniqueIds = Array.from(new Set((appIds || []).map((id) => String(id || '').trim()).filter((id) => /^\d+$/.test(id))));
  const out = {};
  if (!safeHost || !uniqueIds.length) return out;
  for (const appId of uniqueIds) {
    try {
      const cached = await getMetadataBundle(safeHost, appId, {
        needApp: true,
        trigger: 'panel_open',
        source: 'apps_map_fallback',
        logGroup: 'bootstrap'
      });
      const cachedName = String(cached?.bundle?.app?.name || '').trim();
      if (cached?.ok && cachedName) {
        out[appId] = cachedName;
        continue;
      }
    } catch (_err) {
      // fallback to direct fetch below
    }
    const url = `${safeHost}/k/v1/app.json?id=${encodeURIComponent(appId)}`;
    try {
      const resp = await fetch(url, {
        method: 'GET',
        credentials: 'include',
        headers: {
          Accept: 'application/json',
          'X-Requested-With': 'XMLHttpRequest'
        }
      });
      if (!resp.ok) {
        const text = await resp.text().catch(() => '');
        console.debug('[kfav] app.json fallback failed', { url, status: resp.status, text: String(text).slice(0, 300) });
        continue;
      }
      const data = await resp.json();
      const name = String(data?.name || data?.app?.name || '').trim();
      if (name) {
        out[appId] = name;
        const cached = await readMetadataBundle(safeHost, appId);
        const now = Date.now();
        const next = {
          ...(cached || {}),
          version: PB_METADATA_CACHE_VERSION,
          host: safeHost,
          appId: String(appId),
          fetchedAt: now,
          expiresAt: now + PB_METADATA_CACHE_TTL_MS,
          app: {
            name,
            raw: data && typeof data === 'object' ? data : undefined
          }
        };
        await writeMetadataBundle(next);
      }
    } catch (error) {
      console.debug('[kfav] app.json fallback error', { appId, error: String(error?.message || error) });
    }
  }
  return out;
}

// ===== UIから「kintoneで実行して結果を返して」の汎用エンドポイント =====
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    if (msg?.type === 'PAGE_CONTEXT_UPDATED') {
      const tabId = sender?.tab?.id;
      if (tabId) {
        latestPageContextByTab.set(tabId, {
          href: String(msg?.payload?.href || sender?.tab?.url || ''),
          timestamp: Number(msg?.payload?.timestamp || Date.now()),
          trigger: String(msg?.payload?.trigger || 'unknown')
        });
      }
      sendResponse({ ok: true });
      return;
    }

    if (msg?.type === 'WARMUP_CONNECTOR') {
      const safeHost = normalizeHostOrigin(msg.host);
      if (!safeHost) { sendResponse({ ok: false, error: 'host required' }); return; }
      try {
        await ensureConnectorTab(safeHost);
        sendResponse({ ok: true });
      } catch (e) {
        sendResponse({ ok: false, error: String(e) });
      }
      return;
    }

    if (msg?.type === 'RECENT_UPSERT') {
      try {
        const list = await upsertRecentRecord(msg.payload || {});
        sendResponse({ ok: true, size: Array.isArray(list) ? list.length : 0 });
      } catch (e) {
        sendResponse({ ok: false, error: String(e) });
      }
      return;
    }

    if (msg?.type === 'GET_APPS_MAP') {
      const safeHost = normalizeHostOrigin(msg?.payload?.host || msg?.host);
      const appIds = Array.isArray(msg?.payload?.appIds)
        ? msg.payload.appIds
        : (Array.isArray(msg?.appIds) ? msg.appIds : []);
      if (!safeHost) {
        sendResponse({ ok: false, error: 'host required' });
        return;
      }
      try {
        const map = await fetchAppsMap(safeHost);
        await saveAppNameMap(safeHost, map);
        console.debug('[kfav] apps map loaded', { host: safeHost, size: Object.keys(map).length });
        sendResponse({ ok: true, host: safeHost, map });
      } catch (error) {
        console.debug('[kfav] apps map load failed', { host: safeHost, error: String(error?.message || error) });
        const fallbackMap = await fetchAppsMapByAppIds(safeHost, appIds);
        if (Object.keys(fallbackMap).length) {
          let existingMap = {};
          try {
            const cached = await loadAppNameMap(safeHost);
            existingMap = cached?.map && typeof cached.map === 'object' ? cached.map : {};
          } catch (_err) {
            existingMap = {};
          }
          await saveAppNameMap(safeHost, { ...existingMap, ...fallbackMap });
          console.debug('[kfav] apps map fallback loaded', { host: safeHost, size: Object.keys(fallbackMap).length });
          sendResponse({ ok: true, host: safeHost, map: fallbackMap, fallback: true });
          return;
        }
        sendResponse({ ok: false, host: safeHost, error: String(error?.message || error), map: {} });
      }
      return;
    }

    if (msg?.type === 'GET_APP_NAMES_BY_IDS') {
      const payload = msg?.payload && typeof msg.payload === 'object' ? msg.payload : msg;
      const safeHost = normalizeHostOrigin(payload?.host || payload?.origin || payload?.url || '');
      const appIds = Array.isArray(payload?.appIds) ? payload.appIds : [];
      if (!safeHost) {
        sendResponse({ ok: false, error: 'host required', host: '', map: {} });
        return;
      }
      try {
        const map = await fetchAppNamesByIds(safeHost, appIds);
        sendResponse({ ok: true, host: safeHost, map });
      } catch (error) {
        sendResponse({ ok: false, host: safeHost, error: String(error?.message || error), map: {} });
      }
      return;
    }

    if (msg?.type === 'PB_GET_METADATA_BUNDLE') {
      const payload = msg?.payload && typeof msg.payload === 'object' ? msg.payload : msg;
      const safeHost = normalizeHostOrigin(payload?.host || payload?.origin || payload?.url || '');
      const safeAppId = normalizeMetadataAppId(payload?.appId);
      if (!safeHost || !safeAppId) {
        sendResponse({ ok: false, error: 'host/appId required', bundle: null });
        return;
      }
      try {
        const res = await getMetadataBundle(safeHost, safeAppId, payload);
        sendResponse(res);
      } catch (error) {
        sendResponse({ ok: false, host: safeHost, appId: safeAppId, error: String(error?.message || error), bundle: null });
      }
      return;
    }

    if (msg?.type === 'PB_GET_CACHED_METADATA_BUNDLE') {
      const payload = msg?.payload && typeof msg.payload === 'object' ? msg.payload : msg;
      const safeHost = normalizeHostOrigin(payload?.host || payload?.origin || payload?.url || '');
      const safeAppId = normalizeMetadataAppId(payload?.appId);
      if (!safeHost || !safeAppId) {
        sendResponse({ ok: false, error: 'host/appId required', bundle: null, fresh: false });
        return;
      }
      try {
        const res = await getCachedMetadataBundle(safeHost, safeAppId, payload);
        sendResponse(res);
      } catch (error) {
        sendResponse({ ok: false, host: safeHost, appId: safeAppId, error: String(error?.message || error), bundle: null, fresh: false });
      }
      return;
    }

    if (msg?.type === 'PB_CLEAR_METADATA_CACHE') {
      const payload = msg?.payload && typeof msg.payload === 'object' ? msg.payload : msg;
      const safeHost = normalizeHostOrigin(payload?.host || payload?.origin || payload?.url || '');
      const safeAppId = normalizeMetadataAppId(payload?.appId);
      if (!safeHost || !safeAppId) {
        sendResponse({ ok: false, error: 'host/appId required' });
        return;
      }
      const removed = await clearMetadataBundle(safeHost, safeAppId);
      sendResponse({ ok: Boolean(removed), host: safeHost, appId: safeAppId });
      return;
    }

    if (msg?.type === 'PB_CLEAR_METADATA_CACHE_ALL') {
      const removed = await clearAllMetadataBundles();
      sendResponse({ ok: true, removed });
      return;
    }

    if (msg?.type !== 'RUN_IN_KINTONE') return;
    const safeHost = normalizeHostOrigin(msg.host);
    const { forward } = msg; // forward: { type: 'LIST_FIELDS' | 'LIST_SCHEDULE' | 'LIST_VIEWS' | ... , payload: {...} }
    if (!safeHost || !forward?.type) { sendResponse({ ok:false, error:'bad request' }); return; }
    try {
      const res = await runForwardOnHost(safeHost, forward);
      sendResponse(res || { ok:false, error:'no response' });
    } catch (e) {
      sendResponse({ ok:false, error:String(e) });
    }
  })();
  return true;
});

// ブラウザ起動時も念のため再設定（MV3はSWが落ちるため）
chrome.runtime.onStartup?.addListener(() => {
  try {
    if (chrome.sidePanel) {
      chrome.sidePanel.setOptions?.({ path: 'sidepanel.html', enabled: true });
      chrome.sidePanel.setPanelBehavior?.({ openPanelOnActionClick: true });
    }
  } catch {}
});

// 拡張アイコンクリック → サイドパネルを開く（非対応ならサイドパネルの内容を新規タブで開く）
chrome.action.onClicked.addListener(async (tab) => {
  if (chrome.sidePanel?.open) {
    try {
      // タブ単位のパス指定（Chrome 114）
      if (chrome.sidePanel.setOptions && tab?.id) {
        await chrome.sidePanel.setOptions({ tabId: tab.id, path: 'sidepanel.html', enabled: true });
      }
      await chrome.sidePanel.open({ tabId: tab?.id });
      return;
    } catch (e) {
      // フォールバックに進む
    }
  }
  // 自動で拡張ページのタブを作成しない
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    if (msg?.type !== 'SWITCH_SIDE_PANEL') return;
    const path = msg.path || 'sidepanel.html';
    const tabId = msg.tabId || sender?.tab?.id;
    try {
      if (chrome.sidePanel?.setOptions) {
        await chrome.sidePanel.setOptions({ tabId, path, enabled: true });
        await chrome.sidePanel.open?.({ tabId });
        sendResponse({ ok: true });
      } else {
        sendResponse({ ok: false, error: 'sidePanel API is not available' });
      }
    } catch (e) {
      sendResponse({ ok: false, error: String(e) });
    }
  })();
  return true;
});






