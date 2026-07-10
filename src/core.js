'use strict';

const FAVORITES_KEY = 'kintoneFavorites';
const SCHEDULE_KEY = 'kfavSchedule';
const PIN_KEY = 'kfavPins';
const SHORTCUT_KEY = 'kfavShortcuts';
const SHORTCUT_VISIBLE_KEY = 'kfavShortcutsVisible';
const RECORD_PIN_VISIBLE_KEY = 'kfavRecordPinsVisible';
const RECENT_KEY = 'kfavRecentRecords';
const APP_NAME_CACHE_KEY = 'kfavAppNameCache';
const MAX_RECENT_RECORDS = 10;
const APP_NAME_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_SHORTCUT_INITIAL_LENGTH = 2;

function normalizeShortcutInitial(value) {
  if (value == null) return '';
  const str = String(value).trim();
  if (!str) return '';
  return Array.from(str).slice(0, MAX_SHORTCUT_INITIAL_LENGTH).join('');
}

export function createId() {
  if (globalThis.crypto?.randomUUID) {
    try { return globalThis.crypto.randomUUID(); } catch (_) { /* fall back */ }
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export async function loadFavorites() {
  const stored = await chrome.storage.sync.get(FAVORITES_KEY);
  return stored[FAVORITES_KEY] || [];
}

export async function saveFavorites(items) {
  await chrome.storage.sync.set({ [FAVORITES_KEY]: items });
}

export function sortFavorites(items) {
  return [...items].sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || (a.order ?? 0) - (b.order ?? 0));
}

export async function loadScheduleConfig() {
  const stored = await chrome.storage.sync.get(SCHEDULE_KEY);
  const raw = stored[SCHEDULE_KEY];
  if (!raw) return [];
  if (Array.isArray(raw)) {
    return raw
      .filter((item) => item && typeof item === 'object')
      .map((item) => ({ id: item.id || createId(), ...item }));
  }
  if (raw && typeof raw === 'object') {
    const entry = { id: raw.id || createId(), ...raw };
    return [entry];
  }
  return [];
}

export async function saveScheduleConfig(configs) {
  await chrome.storage.sync.set({ [SCHEDULE_KEY]: configs });
}

export function originPatternFor(origin) {
  if (!origin) return null;
  return origin.endsWith('/') ? `${origin}*` : `${origin}/*`;
}

export async function hasHostPermission(origin) {
  const pattern = originPatternFor(origin);
  if (!pattern) return false;
  return await chrome.permissions.contains({ origins: [pattern] });
}

export async function ensureHostPermission(origin) {
  const pattern = originPatternFor(origin);
  if (!pattern) return false;
  if (await chrome.permissions.contains({ origins: [pattern] })) return true;
  return await chrome.permissions.request({ origins: [pattern] });
}

export async function sendRunInKintone(host, forward) {
  if (!host) throw new Error('host is required');
  if (!forward?.type) throw new Error('forward.type is required');
  return await chrome.runtime.sendMessage({
    type: 'RUN_IN_KINTONE',
    host,
    forward
  });
}

export async function sendCountBulk(host, items, options = {}) {
  const trigger = String(options?.trigger || '').trim();
  const source = String(options?.source || '').trim();
  const payload = { items };
  if (trigger) payload.__pbTrigger = trigger;
  if (source) payload.__pbSource = source;
  return await sendRunInKintone(host, { type: 'COUNT_BULK', payload });
}

export async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

export function isKintoneUrl(url) {
  try {
    const hostname = new URL(url).hostname;
    return /\.kintone(?:-dev)?\.com$/.test(hostname) || /\.cybozu\.com$/.test(hostname);
  } catch (_e) {
    return false;
  }
}

export function parseKintoneUrl(u) {
  try {
    const url = new URL(u);
    const match = url.pathname.match(/\/k\/(\d+)(?:\/|$)/);
    const appId = match ? match[1] : '';
    const viewParam = url.searchParams.get('view') || '';
    const host = url.origin;
    let recordId = '';
    if (url.hash) {
      const hash = url.hash;
      const recMatch = hash.match(/record=(\d+)/);
      if (recMatch) recordId = recMatch[1];
    }
    return {
      host,
      appId,
      viewId: viewParam,
      viewIdOrName: viewParam,
      recordId,
      url: url.href
    };
  } catch (_e) {
    return {};
  }
}

export async function loadPinnedRecords() {
  const stored = await chrome.storage.sync.get(PIN_KEY);
  const raw = stored[PIN_KEY];
  if (!raw) return [];
  if (Array.isArray(raw)) {
    return raw
      .filter((item) => item && typeof item === 'object')
      .map((item) => ({ id: item.id || createId(), ...item }));
  }
  if (raw && typeof raw === 'object') {
    return [{ id: raw.id || createId(), ...raw }];
  }
  return [];
}

export async function savePinnedRecords(entries) {
  await chrome.storage.sync.set({ [PIN_KEY]: entries });
}

const SHORTCUT_TYPES = ['appTop', 'view', 'create'];
const SHORTCUT_ICON_OPTIONS = [
  'clipboard', 'file-text', 'package', 'box', 'truck', 'factory', 'wrench', 'calendar',
  'list-checks', 'search', 'chart-bar', 'receipt', 'users', 'settings', 'bookmark', 'star'
];
const DEFAULT_SHORTCUT_ICON = 'file-text';
const SHORTCUT_ICON_COLOR_OPTIONS = ['gray', 'blue', 'green', 'orange', 'red', 'purple'];
const DEFAULT_SHORTCUT_ICON_COLOR = 'gray';

function normalizeShortcutIcon(value) {
  const name = value == null ? '' : String(value).trim();
  return SHORTCUT_ICON_OPTIONS.includes(name) ? name : DEFAULT_SHORTCUT_ICON;
}

function normalizeShortcutIconColor(value) {
  const color = value == null ? '' : String(value).trim().toLowerCase();
  return SHORTCUT_ICON_COLOR_OPTIONS.includes(color) ? color : DEFAULT_SHORTCUT_ICON_COLOR;
}

function normalizeShortcutEntry(item, fallbackOrder) {
  if (!item || typeof item !== 'object') {
    return null;
  }
  const orderValue = typeof item.order === 'number' ? item.order : fallbackOrder;
  const type = SHORTCUT_TYPES.includes(item.type) ? item.type : 'appTop';
  const appIdRaw = item.appId == null ? '' : String(item.appId).trim();
  const viewRaw = item.viewIdOrName == null ? '' : String(item.viewIdOrName).trim();
  const labelRaw = item.label == null ? '' : String(item.label);
  const initialRaw = normalizeShortcutInitial(item.initial);
  const iconRaw = normalizeShortcutIcon(item.icon);
  const iconColorRaw = normalizeShortcutIconColor(item.iconColor);
  return {
    id: item.id || createId(),
    type,
    host: typeof item.host === 'string' ? item.host : '',
    appId: appIdRaw,
    viewIdOrName: viewRaw,
    label: labelRaw,
    initial: initialRaw,
    icon: iconRaw,
    iconColor: iconColorRaw,
    order: orderValue
  };
}

export async function loadShortcuts() {
  const stored = await chrome.storage.sync.get(SHORTCUT_KEY);
  const raw = stored[SHORTCUT_KEY];
  if (!raw) return [];
  const list = Array.isArray(raw) ? raw : [raw];
  return list
    .map((item, index) => normalizeShortcutEntry(item, index))
    .filter((entry) => entry);
}

export async function saveShortcuts(entries) {
  const payload = (entries || []).map((item, index) => ({
    id: item.id || createId(),
    type: SHORTCUT_TYPES.includes(item.type) ? item.type : 'appTop',
    host: typeof item.host === 'string' ? item.host : '',
    appId: item.appId == null ? '' : String(item.appId).trim(),
    viewIdOrName: item.viewIdOrName == null ? '' : String(item.viewIdOrName).trim(),
    label: item.label == null ? '' : String(item.label),
    initial: normalizeShortcutInitial(item.initial),
    icon: normalizeShortcutIcon(item.icon),
    iconColor: normalizeShortcutIconColor(item.iconColor),
    order: typeof item.order === 'number' ? item.order : index
  }));
  await chrome.storage.sync.set({ [SHORTCUT_KEY]: payload });
}

export function sortShortcuts(entries) {
  return [...(entries || [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

export async function loadShortcutVisibility() {
  const stored = await chrome.storage.sync.get(SHORTCUT_VISIBLE_KEY);
  const flag = stored[SHORTCUT_VISIBLE_KEY];
  if (typeof flag === 'boolean') return flag;
  return true;
}

export async function saveShortcutVisibility(visible) {
  await chrome.storage.sync.set({ [SHORTCUT_VISIBLE_KEY]: Boolean(visible) });
}

export async function loadRecordPinVisibility() {
  const stored = await chrome.storage.sync.get(RECORD_PIN_VISIBLE_KEY);
  const flag = stored[RECORD_PIN_VISIBLE_KEY];
  if (typeof flag === 'boolean') return flag;
  return true;
}

export async function saveRecordPinVisibility(visible) {
  await chrome.storage.sync.set({ [RECORD_PIN_VISIBLE_KEY]: Boolean(visible) });
}

function normalizeRecentRecord(item) {
  if (!item || typeof item !== 'object') return null;
  const host = item.host == null ? '' : String(item.host).trim().replace(/\/$/, '');
  const appId = item.appId == null ? '' : String(item.appId).trim();
  const recordId = item.recordId == null ? '' : String(item.recordId).trim();
  if (!host || !appId || !recordId) return null;
  const id = `${host}|${appId}|${recordId}`;
  const appName = item.appName == null ? '' : String(item.appName).trim();
  const url = item.url == null ? '' : String(item.url).trim();
  const fallbackUrl = `${host}/k/${encodeURIComponent(appId)}/show#record=${encodeURIComponent(recordId)}`;
  const tsCandidates = [item.visitedAt, item.lastSeenAt, item.updatedAt];
  let visitedAt = 0;
  for (const value of tsCandidates) {
    const num = Number(value);
    if (Number.isFinite(num) && num > 0) {
      visitedAt = num;
      break;
    }
  }
  if (!visitedAt) visitedAt = Date.now();
  return {
    id,
    host,
    appId,
    recordId,
    appName,
    url: url || fallbackUrl,
    visitedAt
  };
}

export function normalizeRecentRecords(list) {
  const source = Array.isArray(list) ? list : list ? [list] : [];
  return source
    .map((item) => normalizeRecentRecord(item))
    .filter(Boolean)
    .sort((a, b) => (b.visitedAt || b.lastSeenAt || 0) - (a.visitedAt || a.lastSeenAt || 0))
    .slice(0, MAX_RECENT_RECORDS);
}

export async function loadRecentRecords() {
  const stored = await chrome.storage.sync.get(RECENT_KEY);
  return normalizeRecentRecords(stored[RECENT_KEY]);
}

export async function saveRecentRecords(list) {
  await chrome.storage.sync.set({ [RECENT_KEY]: normalizeRecentRecords(list) });
}

export async function upsertRecentRecord(item) {
  const normalized = normalizeRecentRecord(item);
  if (!normalized) return await loadRecentRecords();
  const current = await loadRecentRecords();
  const next = [normalized, ...current];
  await saveRecentRecords(next);
  return normalizeRecentRecords(next);
}

function normalizeHostForCache(host) {
  const raw = String(host || '').trim();
  if (!raw) return '';
  try {
    const url = new URL(raw);
    return url.origin.toLowerCase().replace(/\/$/, '');
  } catch (_err) {
    return raw.toLowerCase().replace(/\/$/, '');
  }
}

function normalizeSingleHostAppNameCache(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const out = {};
  Object.entries(source).forEach(([appIdKey, value]) => {
    const appId = String(appIdKey || '').trim();
    if (!appId) return;
    if (typeof value === 'string') {
      const name = value.trim();
      if (name) out[appId] = name;
      return;
    }
    if (value && typeof value === 'object') {
      const name = String(value.name || '').trim();
      if (name) out[appId] = name;
    }
  });
  return out;
}

function normalizeAppNameMapPayload(raw) {
  if (!raw || typeof raw !== 'object') {
    return { savedAt: 0, map: {} };
  }
  let savedAt = Number(raw.savedAt);
  if (!Number.isFinite(savedAt) || savedAt < 0) savedAt = 0;
  let mapSource = raw.map;
  if (!mapSource || typeof mapSource !== 'object') {
    mapSource = raw;
    if (!savedAt) {
      const fetchedAtCandidates = Object.values(raw)
        .map((value) => Number(value?.fetchedAt))
        .filter((value) => Number.isFinite(value) && value > 0);
      savedAt = fetchedAtCandidates.length ? Math.max(...fetchedAtCandidates) : 0;
    }
  }
  const map = normalizeSingleHostAppNameCache(mapSource);
  return { savedAt, map };
}

export function getAppNameCacheKey(host) {
  const safeHost = normalizeHostForCache(host);
  return `${APP_NAME_CACHE_KEY}::${safeHost}`;
}

export async function loadAppNameCache(host) {
  const { map, savedAt } = await loadAppNameMap(host);
  return Object.fromEntries(
    Object.entries(map).map(([appId, name]) => [appId, { name, fetchedAt: savedAt }])
  );
}

export async function saveAppNameCache(host, cacheObj) {
  const normalized = normalizeSingleHostAppNameCache(cacheObj);
  await saveAppNameMap(host, normalized);
}

export async function loadAppNameMap(host) {
  const safeHost = normalizeHostForCache(host);
  if (!safeHost) return { savedAt: 0, map: {}, fresh: false };
  const key = getAppNameCacheKey(safeHost);
  const stored = await chrome.storage.local.get(key);
  const payload = normalizeAppNameMapPayload(stored[key]);
  const fresh = payload.savedAt > 0
    && (Date.now() - payload.savedAt) < APP_NAME_CACHE_TTL_MS
    && Object.keys(payload.map).length > 0;
  return { savedAt: payload.savedAt, map: payload.map, fresh };
}

export async function saveAppNameMap(host, map) {
  const safeHost = normalizeHostForCache(host);
  if (!safeHost) return;
  const key = getAppNameCacheKey(safeHost);
  const payload = {
    savedAt: Date.now(),
    map: normalizeSingleHostAppNameCache(map)
  };
  await chrome.storage.local.set({ [key]: payload });
}

export async function clearAppNameMap(host) {
  const safeHost = normalizeHostForCache(host);
  if (!safeHost) return false;
  const key = getAppNameCacheKey(safeHost);
  try {
    await chrome.storage.local.remove(key);
    return true;
  } catch (_err) {
    return false;
  }
}

export async function getCachedAppName(host, appId) {
  const safeAppId = String(appId || '').trim();
  if (!safeAppId) return null;
  const { fresh, map } = await loadAppNameMap(host);
  if (!fresh) return null;
  return String(map[safeAppId] || '').trim() || null;
}

export async function setCachedAppName(host, appId, name) {
  const safeAppId = String(appId || '').trim();
  const safeName = String(name || '').trim();
  if (!safeAppId || !safeName) return;
  const { map } = await loadAppNameMap(host);
  map[safeAppId] = safeName;
  await saveAppNameMap(host, map);
}

export async function pickMissingAppIds(host, appIds) {
  const { fresh, map } = await loadAppNameMap(host);
  const unique = Array.from(new Set((appIds || []).map((id) => String(id || '').trim()).filter(Boolean)));
  if (!fresh) return unique;
  return unique.filter((appId) => !String(map[appId] || '').trim());
}

export async function getAppName(host, appId) {
  const safeHost = normalizeHostForCache(host);
  const safeAppId = String(appId || '').trim();
  if (!safeHost || !safeAppId) return '';
  const { map } = await loadAppNameMap(safeHost);
  return String(map[safeAppId] || '').trim();
}
