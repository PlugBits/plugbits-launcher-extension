// chrome.* API のテスト用スタブ。
// 実際の chrome.storage と同様、get/set は必ずディープコピーを返す
// （参照共有があると launcher の鮮度ガードが誤検知する）。
export function buildChromeStub({ empty = false } = {}) {
  return `
(() => {
  const listeners = { add: () => {}, remove: () => {}, addListener: () => {}, removeListener: () => {}, hasListener: () => false };
  const EMPTY = ${empty};
  const store = EMPTY ? { uiLanguage: 'ja', kintoneFavorites: [], kfavShortcuts: [], kfavPins: [], kfavWatchlistCountCache: {} } : ({
    uiLanguage: 'ja',
    kintoneFavorites: [
      { id: 'f1', label: '未処理の受注', url: 'https://demo.kintone.com/k/12/?view=100', host: 'https://demo.kintone.com', appId: '12', viewIdOrName: '100', pinned: true, order: 0, icon: 'clipboard', iconColor: 'blue', category: '生産' },
      { id: 'f2', label: '本日の製造指示', url: 'https://demo.kintone.com/k/13/?view=101', host: 'https://demo.kintone.com', appId: '13', viewIdOrName: '101', pinned: false, order: 1, icon: 'calendar', iconColor: 'green', category: '生産' },
      { id: 'f3', label: '不良報告（今週）', url: 'https://demo.kintone.com/k/14/?view=102', host: 'https://demo.kintone.com', appId: '14', viewIdOrName: '102', pinned: false, order: 2, icon: 'package', iconColor: 'orange', category: '品質' }
    ],
    kfavShortcuts: [
      { id: 's1', label: 'QB入力', host: 'https://demo.kintone.com', appId: '12', type: 'view', viewIdOrName: '100' },
      { id: 's2', label: '出荷一覧', host: 'https://demo.kintone.com', appId: '13', type: 'view', viewIdOrName: '101' },
      { id: 's3', label: '新規レコード', host: 'https://demo.kintone.com', appId: '12', type: 'create' }
    ],
    kfavPins: [
      { id: 'p1', label: '重要顧客A 対応履歴', host: 'https://demo.kintone.com', appId: '20', recordId: '1042', note: '毎週フォロー', pinnedAt: 1750000000000 }
    ],
    kfavWatchlistCountCache: {
      f1: { count: 12, updatedAt: Date.now() - 120000 },
      f2: { count: 3, updatedAt: Date.now() - 120000 },
      f3: { count: 0, updatedAt: Date.now() - 120000 }
    }
  });
  const clone = (v) => (v === undefined ? v : JSON.parse(JSON.stringify(v)));
  const area = {
    get: (keys) => {
      let result = {};
      if (keys == null) result = clone(store);
      else if (typeof keys === 'string') { if (keys in store) result[keys] = clone(store[keys]); }
      else if (Array.isArray(keys)) keys.forEach((k) => { if (k in store) result[k] = clone(store[k]); });
      else Object.entries(keys).forEach(([k, dflt]) => { result[k] = k in store ? clone(store[k]) : dflt; });
      return Promise.resolve(result);
    },
    set: (obj) => { Object.assign(store, clone(obj)); return Promise.resolve(); },
    remove: (keys) => { (Array.isArray(keys) ? keys : [keys]).forEach((k) => delete store[k]); return Promise.resolve(); }
  };
  window.chrome = {
    storage: { sync: area, local: area, session: area, onChanged: listeners },
    runtime: {
      sendMessage: (msg) => {
        if (msg && msg.type === 'CP_GET_SHORTCUTS') return Promise.resolve({ ok: true, shortcuts: store.kfavShortcuts });
        return Promise.resolve({ ok: false });
      },
      getURL: (p) => p,
      onMessage: listeners,
      lastError: null,
      id: 'stub'
    },
    tabs: { query: () => Promise.resolve([]), sendMessage: () => Promise.resolve({ ok: false }), onActivated: listeners, onUpdated: listeners, create: () => Promise.resolve({}) },
    permissions: { contains: () => Promise.resolve(true), request: () => Promise.resolve(true), onAdded: listeners, onRemoved: listeners },
    windows: { onFocusChanged: { ...listeners, WINDOW_ID_NONE: -1 } },
    alarms: { create: () => {}, clear: () => Promise.resolve(true), onAlarm: listeners },
    i18n: { getUILanguage: () => 'ja' }
  };
})();
`;
}
