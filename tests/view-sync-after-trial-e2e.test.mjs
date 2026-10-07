// 「ビュー列連動が14日間トライアル開始後に効かなくなる」という実機報告の
// 再現・回帰テスト(v3.2.0 ビュー列連動の追加修正)。
//
// 調査の結論:
//  - Pro/トライアル状態そのものは isListMode()/listFieldScopeMode/
//    getListScopeBaseFields/resolveViewSyncColumns のどこにも影響しない
//    (overlayMode は canEditOverlay 系の編集可否だけに使われる)。
//    「Freeでは動く・Proでは壊れる」という観測は実際にはPro/トライアルとは
//    無関係で、以下2つの既存バグの合わせ技が原因だった:
//
//  1. content-overlay-controller.js の persistColumnPref (幅調整だけを
//     保存するはずの経路): 列ダイアログを開いた状態(columnOrderDraftは
//     「現在の表示順」=ビュー列連動中ならビューの表示順[B,A])でリサイズだけ
//     行うと、columnOrder を order(=[B,A])から組み立て直してしまい、
//     [B, A, C, D] のように「フォーム順ではない」default プリセットが
//     保存される。columnsCustomized フラグ自体は false のまま保たれるので、
//     直後の表示は壊れない(フラグだけでビュー列連動を判定するため無害に見える)。
//
//  2. options.js の normalizeOverlayLayoutPreset (設定画面のレイアウト一覧
//     からの書き込み: 有効化/名前変更/削除などすべてこれを経由する):
//     columnsCustomized を読み込み時に引き継がずに落としていた。
//
//  2つが重なると: (1)でスクランブルされた columnOrder を持つ default
//  プリセットが、(2)でフラグを失った状態でタブリロード後に再読込され、
//  content.js 側の移行ヒューリスティック(「全ベース列・フォーム順のまま」
//  なら未カスタマイズ)が「フォーム順と食い違う」と誤判定し、
//  columnsCustomized=true に書き換えてしまう。結果、ビュー列連動が
//  永久に効かなくなる(列ダイアログの明示リセットでしか直らない)。
//
// 本ファイルは (a) Pro/トライアル単体は無害であることの回帰テスト、
// (b) 2つの根本原因それぞれの単体確認、(c) 合わせ技のフルチェーン再現
// (修正後は壊れないことの確認)を行う。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractFunctionSource } from './helpers/extract-src.mjs';

// normalizeOverlayLayoutPresets(raw) は同じファイル内の normalizeOverlayLayoutPreset
// を呼び出すため、extractTopLevelFunction単体だと参照が解決できない。
// 両方のソースを同じスコープでevalして依存関係込みで取り出す
function extractOptionsOverlayLayoutNormalizers(text) {
  const presetSrc = extractFunctionSource(text, /\nfunction normalizeOverlayLayoutPreset\(rawPreset, index = 0\)\s\{/);
  const presetsSrc = extractFunctionSource(text, /\nfunction normalizeOverlayLayoutPresets\(raw\)\s\{/);
  // eslint-disable-next-line no-eval
  return eval(`(function () {
    ${presetSrc}
    ${presetsSrc}
    return { normalizeOverlayLayoutPreset, normalizeOverlayLayoutPresets };
  })()`);
}

const srcDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');
const read = (name) => fs.readFileSync(path.join(srcDir, name), 'utf8');
const contentJs = read('content.js');
const overlayCss = read('overlay.css');
const permissionServiceJs = read('permission-service.js');
const proServiceJs = read('pro-service.js');
const optionsJs = read('options.js');

const ORIGIN = 'https://demo.cybozu.com';
const APP_ID = '12';
const VIEW_ID = '20';
const LAYOUT_KEY = 'kfavOverlayLayoutPresets';
const APP_KEY = `${ORIGIN}::${APP_ID}`;

// フォーム順: A, B, C, D, ステータス(STATUS型=オーバーレイ非対応)
const FIELDS_META = [
  { code: 'A', label: 'A', type: 'SINGLE_LINE_TEXT', required: false, choices: [] },
  { code: 'B', label: 'B', type: 'SINGLE_LINE_TEXT', required: false, choices: [] },
  { code: 'C', label: 'C', type: 'NUMBER', required: false, choices: [] },
  { code: 'D', label: 'D', type: 'SINGLE_LINE_TEXT', required: false, choices: [] },
  { code: 'ステータス', label: 'ステータス', type: 'STATUS', required: false, choices: [] }
];
// ビューの表示列: B, A の順
const VIEWS_RAW = {
  'ビュー20': { id: VIEW_ID, index: '0', filterCond: '', sort: '', fields: ['B', 'A', 'ステータス'] }
};
const RECORDS = [
  { $id: { value: '1' }, $revision: { value: '1' }, A: { value: 'a1' }, B: { value: 'b1' }, C: { value: '1' }, D: { value: 'd1' } }
];

function buildBridgeScript() {
  return `
const RECORDS = ${JSON.stringify(RECORDS)};
window.addEventListener('message', (ev) => {
  const d = ev.data || {};
  if (!d || d.__kfav__ !== true || !d.id || d.replyTo) return;
  const reply = (extra) => window.postMessage({ __kfav__: true, replyTo: d.id, ...extra }, location.origin);
  const type = d.type;
  if (type === 'EXCEL_GET_APP_CONTEXT') return reply({ ok: true, appId: '${APP_ID}', appName: 'ビュー列連動テストアプリ', query: '', timezone: 'Asia/Tokyo' });
  if (type === 'EXCEL_GET_RECORDS') return reply({ ok: true, records: RECORDS, totalCount: RECORDS.length });
  if (type === 'EXCEL_EVALUATE_RECORD_ACL') {
    const ids = Array.isArray(d.payload?.ids) ? d.payload.ids : [];
    return reply({ ok: true, rights: ids.map((id) => ({ id, editable: true, deletable: true, viewable: true })) });
  }
  if (type === 'EXCEL_GET_LOGIN_USER') return reply({ ok: true, user: { timezone: 'Asia/Tokyo' } });
  if (type === 'GET_APP_NAME') return reply({ ok: true, name: 'ビュー列連動テストアプリ' });
  reply({ ok: false });
});`;
}

// chrome.storage のシード値(licensePayload / layoutPayload)を差し込んだ状態で
// 新しいブラウザコンテキスト(=実機でタブを新規に開く/リロードするのに相当)を
// 開き、Grid Edit オーバーレイを起動する
async function openOverlay({ browser, seed = {} }) {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  await ctx.addInitScript((seedPayload) => {
    (() => {
      const store = { uiLanguage: 'ja', kintoneFavorites: [], kfavShortcuts: [], kfavPins: [], kfavWatchlistCountCache: {} };
      if (seedPayload) Object.assign(store, seedPayload);
      const listeners = { add: () => {}, remove: () => {}, addListener: () => {}, removeListener: () => {}, hasListener: () => false };
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
        runtime: { sendMessage: () => Promise.resolve({ ok: false }), getURL: (p) => p, onMessage: listeners, lastError: null, id: 'stub' },
        tabs: { query: () => Promise.resolve([]), sendMessage: () => Promise.resolve({ ok: false }), onActivated: listeners, onUpdated: listeners, create: () => Promise.resolve({}) },
        permissions: { contains: () => Promise.resolve(true), request: () => Promise.resolve(true), onAdded: listeners, onRemoved: listeners },
        windows: { onFocusChanged: { ...listeners, WINDOW_ID_NONE: -1 } },
        alarms: { create: () => {}, clear: () => Promise.resolve(true), onAlarm: listeners },
        i18n: { getUILanguage: () => 'ja' }
      };
    })();
  }, seed);
  await ctx.addInitScript(({ viewsRaw, fieldsMeta }) => {
    window.chrome.runtime.sendMessage = (msg) => {
      if (msg && msg.type === 'PB_GET_METADATA_BUNDLE') {
        return Promise.resolve({ ok: true, bundle: { app: { name: 'ビュー列連動テストアプリ' }, views: { raw: viewsRaw }, fields: { normalized: fieldsMeta } } });
      }
      if (msg && msg.type === 'CP_GET_SHORTCUTS') return Promise.resolve({ ok: true, shortcuts: [] });
      return Promise.resolve({ ok: false });
    };
  }, { viewsRaw: VIEWS_RAW, fieldsMeta: FIELDS_META });

  const bridgeScript = buildBridgeScript();
  await ctx.route(`${ORIGIN}/**`, (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/content.js')) return route.fulfill({ contentType: 'text/javascript; charset=utf-8', body: contentJs });
    if (url.pathname.endsWith('/permission-service.js')) return route.fulfill({ contentType: 'text/javascript; charset=utf-8', body: permissionServiceJs });
    if (url.pathname.endsWith('/pro-service.js')) return route.fulfill({ contentType: 'text/javascript; charset=utf-8', body: proServiceJs });
    if (url.pathname.endsWith('overlay.css')) return route.fulfill({ contentType: 'text/css; charset=utf-8', body: overlayCss });
    if (url.pathname.endsWith('/page-bridge.js')) return route.fulfill({ contentType: 'text/javascript; charset=utf-8', body: bridgeScript });
    return route.fulfill({ contentType: 'text/html; charset=utf-8', body: '<!doctype html><body style="background:#e8ecf2"></body>' });
  });

  const page = await ctx.newPage();
  await page.goto(`${ORIGIN}/k/${APP_ID}/?view=${VIEW_ID}`);
  await page.addScriptTag({ url: `${ORIGIN}/permission-service.js` });
  await page.addScriptTag({ url: `${ORIGIN}/pro-service.js` });
  await page.addScriptTag({ url: `${ORIGIN}/content.js` });
  await page.waitForTimeout(400);
  await page.keyboard.press('Control+Shift+KeyE');
  await page.waitForTimeout(1200);
  return { ctx, page };
}

async function visibleColumnCodes(page) {
  return (await page.locator('.pb-overlay__col-label').allTextContents()).map((t) => t.trim());
}

async function readLayoutState(page) {
  const stored = await page.evaluate((key) => window.chrome.storage.local.get(key), LAYOUT_KEY);
  const map = stored?.[LAYOUT_KEY] || {};
  return map[APP_KEY] || null;
}

async function readActivePreset(page) {
  const state = await readLayoutState(page);
  if (!state) return null;
  return state.presets?.find((p) => p.id === state.activePresetId) || null;
}

async function openColumnDialog(page) {
  await page.locator('.pb-overlay__tool-menu-toggle').click();
  await page.waitForTimeout(150);
  await page.locator('.pb-overlay__tool-menu-item', { hasText: /列順|Columns/ }).click();
  await page.waitForTimeout(250);
}

async function closeOverlay(page) {
  const closeBtn = page.locator('.pb-overlay__toolbar-secondary button', { hasText: /閉じる|Close/ });
  if (await closeBtn.count()) {
    await closeBtn.click();
    await page.waitForTimeout(300);
  }
}

export async function run({ browser, check }) {
  const name = (n) => `view-sync-after-trial-e2e: ${n}`;

  // ── 1. フレッシュインストール + 14日間トライアル(Pro)が既に有効な状態で
  //       初めてオーバーレイを開く → ビュー列連動は Pro/Free に関係なく効く ──
  {
    const { ctx, page } = await openOverlay({
      browser,
      seed: {
        pbLicenseKey: 'TRIAL-KEY',
        pbLicenseCache: {
          status: 'active',
          kind: 'trial',
          email: 'owner@example.com',
          expiry: new Date(Date.now() + 14 * 86400000).toISOString(),
          trial_verified: false,
          cachedAt: Date.now()
        }
      }
    });
    try {
      check(name('overlay opened on a fresh install with an active trial'), (await page.locator('.pb-overlay').count()) > 0);
      const cols = await visibleColumnCodes(page);
      check(`${name('fresh install + active Pro trial -> initial columns still follow the view [B, A]')} (got ${JSON.stringify(cols)})`,
        JSON.stringify(cols) === JSON.stringify(['B', 'A']));
      const active = await readActivePreset(page);
      check(name('fresh default preset starts columnsCustomized=false even with Pro trial active'), active?.columnsCustomized === false);

      // ── 2. Pro + 列ダイアログから明示的に保存 → カスタマイズ済みになり
      //       ビューを無視する。その後「リセット」でビュー列連動に復帰する ──
      await openColumnDialog(page);
      await page.locator('.pb-overlay__column-visibility-item', { hasText: /^B$/ }).locator('input[type="checkbox"]').uncheck();
      await page.locator('.pb-overlay__column-visibility-item', { hasText: /^C$/ }).locator('input[type="checkbox"]').check();
      await page.waitForTimeout(100);
      await page.locator('.pb-overlay__column-panel-foot .pb-overlay__btn--primary', { hasText: /列順を保存|Save/ }).click();
      await page.waitForTimeout(300);

      const colsAfterSave = await visibleColumnCodes(page);
      check(`${name('Pro trial + explicit column save ignores the view [A, C]')} (got ${JSON.stringify(colsAfterSave)})`,
        JSON.stringify(colsAfterSave) === JSON.stringify(['A', 'C']));

      await openColumnDialog(page);
      await page.locator('.pb-overlay__column-panel-foot button', { hasText: /リセット|Reset/ }).click();
      await page.waitForTimeout(300);

      const colsAfterReset = await visibleColumnCodes(page);
      check(`${name('Pro trial + column dialog reset restores view sync [B, A]')} (got ${JSON.stringify(colsAfterReset)})`,
        JSON.stringify(colsAfterReset) === JSON.stringify(['B', 'A']));
      const activeAfterReset = await readActivePreset(page);
      check(name('Pro trial + reset clears columnsCustomized back to false'), activeAfterReset?.columnsCustomized === false);
    } finally {
      await ctx.close();
    }
  }

  // ── 3. 根本原因1: 列ダイアログを開いた状態(ビュー列連動中=表示順[B,A])で
  //       幅だけリサイズしても、保存される columnOrder はフォーム順
  //       [A,B,C,D]のまま(ビューの表示順でスクランブルされない) ──
  {
    const { ctx, page } = await openOverlay({ browser, seed: {} });
    try {
      const cols = await visibleColumnCodes(page);
      check(`${name('[root cause 1] initial view-synced columns before resize')} (got ${JSON.stringify(cols)})`,
        JSON.stringify(cols) === JSON.stringify(['B', 'A']));

      await openColumnDialog(page);
      const resizer = page.locator('.pb-overlay__column-chip[data-code="B"] .pb-overlay__column-chip-resizer');
      const box = await resizer.boundingBox();
      if (box) {
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.mouse.down();
        await page.mouse.move(box.x + box.width / 2 + 40, box.y + box.height / 2, { steps: 5 });
        await page.mouse.up();
        await page.waitForTimeout(150);
      }
      check(name('[root cause 1] resize drag happened (resizer handle was found)'), Boolean(box));
      await page.locator('.pb-overlay__column-close').click();
      await page.waitForTimeout(200);

      const active = await readActivePreset(page);
      check(`${name('[root cause 1] width-only resize-while-dialog-open keeps columnOrder in form order [A,B,C,D]')} (got ${JSON.stringify(active?.columnOrder)})`,
        JSON.stringify(active?.columnOrder) === JSON.stringify(['A', 'B', 'C', 'D']));
      check(name('[root cause 1] width-only change still keeps columnsCustomized=false'), active?.columnsCustomized === false);
    } finally {
      await ctx.close();
    }
  }

  // ── 4. 根本原因2: options.js の normalizeOverlayLayoutPreset/Presets は
  //       columnsCustomized を落とさずに引き継ぐ(設定画面のレイアウト一覧
  //       から保存しても、ビュー列連動に使われるフラグが消えない) ──
  {
    const { normalizeOverlayLayoutPreset, normalizeOverlayLayoutPresets } = extractOptionsOverlayLayoutNormalizers(optionsJs);

    const untouchedDefault = {
      id: 'default', name: '標準', scope: 'list',
      visibleColumns: ['A', 'B', 'C', 'D'], columnOrder: ['A', 'B', 'C', 'D'], columnWidths: {},
      columnsCustomized: false
    };
    const normalizedFalse = normalizeOverlayLayoutPreset(untouchedDefault, 0);
    check(name('[root cause 2] options.js preset normalize preserves columnsCustomized=false'),
      normalizedFalse.columnsCustomized === false);

    const customized = { ...untouchedDefault, columnsCustomized: true, visibleColumns: ['A', 'C'], columnOrder: ['A', 'C'] };
    const normalizedTrue = normalizeOverlayLayoutPreset(customized, 0);
    check(name('[root cause 2] options.js preset normalize preserves columnsCustomized=true'),
      normalizedTrue.columnsCustomized === true);

    // レイアウト一覧(複数app分)丸ごとの正規化(設定画面の読み込み/再保存の
    // 実体)でも落ちない
    const rawMap = {
      [APP_KEY]: {
        host: ORIGIN, appId: APP_ID, appName: 'test', activePresetId: 'default',
        presets: [untouchedDefault], updatedAt: Date.now()
      }
    };
    const normalizedMap = normalizeOverlayLayoutPresets(rawMap);
    check(name('[root cause 2] options.js map normalize preserves columnsCustomized across the whole presets map'),
      normalizedMap[APP_KEY]?.presets?.[0]?.columnsCustomized === false);
  }

  // ── 5. フルチェーン再現(修正前は壊れていた経路): 列ダイアログを開いた
  //       状態での幅調整(根本原因1) → 設定画面のレイアウト一覧からの保存を
  //       経由した書き込み(根本原因2)を踏んでも、新しいタブで開いたときに
  //       ビュー列連動が効き続ける ──
  {
    const { ctx, page } = await openOverlay({ browser, seed: {} });
    let scrambleCandidateState = null;
    try {
      await openColumnDialog(page);
      const resizer = page.locator('.pb-overlay__column-chip[data-code="B"] .pb-overlay__column-chip-resizer');
      const box = await resizer.boundingBox();
      if (box) {
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.mouse.down();
        await page.mouse.move(box.x + box.width / 2 + 40, box.y + box.height / 2, { steps: 5 });
        await page.mouse.up();
        await page.waitForTimeout(150);
      }
      await page.locator('.pb-overlay__column-close').click();
      await page.waitForTimeout(200);
      scrambleCandidateState = await readLayoutState(page);
    } finally {
      await ctx.close();
    }

    // options.js の書き込み経路(設定画面のレイアウト一覧からの保存)を通した
    // 状態を作る。この場合は根本原因2の修正でフラグが保たれるはずなので、
    // 根本原因1のスクランブルが仮に残っていても壊れない、の二段構えになる
    const { normalizeOverlayLayoutPresets } = extractOptionsOverlayLayoutNormalizers(optionsJs);
    const throughOptionsJs = normalizeOverlayLayoutPresets({ [APP_KEY]: scrambleCandidateState });

    const { ctx: ctx2, page: page2 } = await openOverlay({
      browser,
      seed: { [LAYOUT_KEY]: throughOptionsJs }
    });
    try {
      const cols = await visibleColumnCodes(page2);
      check(`${name('[full chain] resize-while-dialog-open + options.js write-through, reopened in a new tab, still view-synced [B, A]')} (got ${JSON.stringify(cols)})`,
        JSON.stringify(cols) === JSON.stringify(['B', 'A']));
      const active = await readActivePreset(page2);
      check(name('[full chain] columnsCustomized stays false after the full round trip'), active?.columnsCustomized === false);
    } finally {
      await ctx2.close();
    }
  }
}
