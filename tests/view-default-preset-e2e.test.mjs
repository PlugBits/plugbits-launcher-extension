// 「ビューごとの既定レイアウトプリセット」(v3.3.0)のE2Eテスト。
//
// tests/view-column-sync-e2e.test.mjs と同じボイラープレート(chrome-stub +
// PB_GET_METADATA_BUNDLE実データ応答)を使う。アプリには2つのビュー
// (A: id=20, 表示列=B,A / B: id=21, 表示列=C,D)を用意し、ビューの切替は
// (このテスト環境にはkintoneのSPAルーティングが無いため)
// history.pushState で location.search の ?view= だけを変えて行う
// (chrome.storageのスタブはページ単位のinitScriptで初期化されるため、
// page.gotoによる本物のナビゲーションをすると毎回storageがリセットされてしまう。
// pushStateなら同じJS実行コンテキストのまま「別ビューを開いた」状態を再現できる)。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildChromeStub } from './helpers/chrome-stub.mjs';
import { ORIGIN } from './helpers/overlay-page.mjs';

const srcDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');
const read = (name) => fs.readFileSync(path.join(srcDir, name), 'utf8');
const contentJs = read('content.js');
const overlayCss = read('overlay.css');
const permissionServiceJs = read('permission-service.js');
const proServiceJs = read('pro-service.js');

const APP_ID = '12';
const VIEW_A_ID = '20';
const VIEW_B_ID = '21';
const LAYOUT_KEY = 'kfavOverlayLayoutPresets';

const FIELDS_META = [
  { code: 'A', label: 'A', type: 'SINGLE_LINE_TEXT', required: false, choices: [] },
  { code: 'B', label: 'B', type: 'SINGLE_LINE_TEXT', required: false, choices: [] },
  { code: 'C', label: 'C', type: 'NUMBER', required: false, choices: [] },
  { code: 'D', label: 'D', type: 'SINGLE_LINE_TEXT', required: false, choices: [] }
];
// ビューA: B,Aの順で表示。ビューB: C,Dの順で表示(どちらも絞り込み無し)
const VIEWS_RAW = {
  'ビューA': { id: VIEW_A_ID, index: '0', filterCond: '', sort: '', fields: ['B', 'A'] },
  'ビューB': { id: VIEW_B_ID, index: '1', filterCond: '', sort: '', fields: ['C', 'D'] }
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
  if (type === 'EXCEL_GET_APP_CONTEXT') return reply({ ok: true, appId: '${APP_ID}', appName: 'ビュー既定テストアプリ', query: '', timezone: 'Asia/Tokyo' });
  if (type === 'EXCEL_GET_RECORDS') return reply({ ok: true, records: RECORDS, totalCount: RECORDS.length });
  if (type === 'EXCEL_EVALUATE_RECORD_ACL') {
    const ids = Array.isArray(d.payload?.ids) ? d.payload.ids : [];
    return reply({ ok: true, rights: ids.map((id) => ({ id, editable: true, deletable: true, viewable: true })) });
  }
  if (type === 'EXCEL_GET_LOGIN_USER') return reply({ ok: true, user: { timezone: 'Asia/Tokyo' } });
  if (type === 'GET_APP_NAME') return reply({ ok: true, name: 'ビュー既定テストアプリ' });
  reply({ ok: false });
});`;
}

async function openViewDefaultOverlay({ browser }) {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  await ctx.addInitScript(buildChromeStub({ empty: true }));
  await ctx.addInitScript(() => {
    window.chrome.storage.local.set({
      pbLicenseKey: 'TEST-KEY',
      pbLicenseCache: { status: 'active', cachedAt: Date.now() }
    });
  });
  await ctx.addInitScript(({ viewsRaw, fieldsMeta }) => {
    window.chrome.runtime.sendMessage = (msg) => {
      if (msg && msg.type === 'PB_GET_METADATA_BUNDLE') {
        return Promise.resolve({
          ok: true,
          bundle: {
            app: { name: 'ビュー既定テストアプリ' },
            views: { raw: viewsRaw },
            fields: { normalized: fieldsMeta }
          }
        });
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
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e?.message || e).slice(0, 200)));
  await page.goto(`${ORIGIN}/k/${APP_ID}/?view=${VIEW_A_ID}`);
  await page.addScriptTag({ url: `${ORIGIN}/permission-service.js` });
  await page.addScriptTag({ url: `${ORIGIN}/pro-service.js` });
  await page.addScriptTag({ url: `${ORIGIN}/content.js` });
  await page.waitForTimeout(400);
  await page.keyboard.press('Control+Shift+KeyE');
  await page.waitForTimeout(1200);
  return { ctx, page, errors };
}

async function closeOverlay(page) {
  const closeBtn = page.locator('.pb-overlay__toolbar-secondary button', { hasText: /閉じる|Close/ });
  if (await closeBtn.count()) {
    await closeBtn.click();
    await page.waitForTimeout(300);
  }
}

async function reopenOverlay(page) {
  await page.keyboard.press('Control+Shift+KeyE');
  await page.waitForTimeout(1000);
}

// このテスト環境にkintoneのSPAルーティングは無いため、別ビューを開いた状態を
// history.pushStateでURLの?viewだけ変えて再現する(page.gotoの本物のナビゲーション
// はchrome.storageスタブをリセットしてしまうため使えない)
async function switchToView(page, viewId) {
  await closeOverlay(page);
  // page.evaluateに渡すコールバックはブラウザ側で評価されるため、Node側の
  // 外側スコープ(APP_ID等)を直接参照できない。引数として明示的に渡す
  await page.evaluate(({ appId, viewId: id }) => {
    window.history.pushState({}, '', `/k/${appId}/?view=${id}`);
  }, { appId: APP_ID, viewId });
  await reopenOverlay(page);
}

async function visibleColumnCodes(page) {
  return (await page.locator('.pb-overlay__col-label').allTextContents()).map((t) => t.trim());
}

async function readLayoutState(page) {
  const stored = await page.evaluate((key) => window.chrome.storage.local.get(key), LAYOUT_KEY);
  const map = stored?.[LAYOUT_KEY] || {};
  return map[`${ORIGIN}::${APP_ID}`] || null;
}

async function presetSelectValue(page) {
  return page.locator('.pb-overlay__preset-select').inputValue();
}

async function selectedOptionText(page) {
  return page.locator('.pb-overlay__preset-select option:checked').textContent();
}

async function openPresetMenu(page) {
  await page.locator('.pb-overlay__preset-menu-toggle').click();
  await page.waitForTimeout(150);
}

async function clickPresetMenuItem(page, pattern) {
  await openPresetMenu(page);
  await page.locator('.pb-overlay__preset-menu-item', { hasText: pattern }).click();
  await page.waitForTimeout(250);
}

async function openColumnDialog(page) {
  await page.locator('.pb-overlay__tool-menu-toggle').click();
  await page.waitForTimeout(150);
  await page.locator('.pb-overlay__tool-menu-item', { hasText: /列順|Columns/ }).click();
  await page.waitForTimeout(250);
}

export async function run({ browser, check }) {
  const name = (n) => `view-default-preset-e2e: ${n}`;
  const { ctx, page } = await openViewDefaultOverlay({ browser });
  try {
    check(name('overlay opened on view A'), (await page.locator('.pb-overlay').count()) > 0);
    // 複製/名前変更はwindow.prompt(ネイティブダイアログ)を使う。削除確認は
    // overlayConfirmによる独自DOMモーダルなので別途ボタンをクリックする
    page.on('dialog', (d) => d.accept());

    // ── 1. バックワード互換: マッピングが1件も無いアプリでは3.2.0までと同じ
    //       (実プリセット'default'がアクティブ。pseudo '__view__' は選ばれない)──
    let colsA = await visibleColumnCodes(page);
    check(`${name('no mappings yet: view A shows its view-synced columns [B, A]')} (got ${JSON.stringify(colsA)})`,
      JSON.stringify(colsA) === JSON.stringify(['B', 'A']));
    check(name('no mappings yet: real preset select value is the real "default" id, not the pseudo option'),
      (await presetSelectValue(page)) === 'default');

    let state = await readLayoutState(page);
    check(name('no mappings yet: viewDefaults is empty'),
      !state?.viewDefaults || Object.keys(state.viewDefaults).length === 0);

    // ── 2. 複製してから「このビューの既定にする」で実プリセットをマッピング ──
    await clickPresetMenuItem(page, /複製|Duplicate/);
    state = await readLayoutState(page);
    const duplicatedId = state?.activePresetId;
    check(name('duplicate created a second real preset and made it active'),
      Boolean(duplicatedId) && duplicatedId !== 'default' && state.presets.length === 2);

    await clickPresetMenuItem(page, /このビューの既定にする|Make default for this view/);
    state = await readLayoutState(page);
    check(name('"set as view default" mapped view A (id:20) to the duplicated preset'),
      state?.viewDefaults?.['id:20'] === duplicatedId);

    // 選択をいったん'default'へ戻し、永続化されたactivePresetIdを上書きする
    // (次に開いた時、マッピングがこれを覆して複製プリセットに戻ることを確認したい)
    await page.selectOption('.pb-overlay__preset-select', 'default');
    await page.waitForTimeout(200);
    state = await readLayoutState(page);
    check(name('switched active preset back to "default" before closing'), state?.activePresetId === 'default');

    await closeOverlay(page);
    await reopenOverlay(page);
    // 注: ビュー別既定の反映(applyViewDefaultPresetSelection)はそのセッション内の
    // this.overlayLayoutState.activePresetId だけを上書きし、ストレージ上の
    // 「このアプリの最後に選んだプリセット」欄は書き換えない(そうしないと、
    // 他のビューを見た後にマッピング無しのビューを開いた時の挙動が汚染される)。
    // そのため確認は読み込んだストレージ値ではなく、実際に描画されたセレクトの
    // 値で行う
    check(name('reopening view A: the per-view mapping wins over whatever was last active, reselects the duplicated preset'),
      (await presetSelectValue(page)) === duplicatedId);
    const selectedText = await selectedOptionText(page);
    check(`${name('reopening view A: the mapped option shows the star mark')} (got ${JSON.stringify(selectedText)})`,
      /^★/.test(selectedText || ''));

    // ── 3. ビューBに切り替え: このビュー専用の既定は無いが、アプリには
    //       (ビューA用の)既定が1件あるので「このビューの列」(pseudo)が自動選択される ──
    await switchToView(page, VIEW_B_ID);
    check(name('overlay reopened on view B'), (await page.locator('.pb-overlay').count()) > 0);
    const colsB = await visibleColumnCodes(page);
    check(`${name('view B (unmapped, but app has mappings) shows its own view-synced columns [C, D]')} (got ${JSON.stringify(colsB)})`,
      JSON.stringify(colsB) === JSON.stringify(['C', 'D']));
    check(name('view B auto-selects the pseudo "this view\'s columns" option'),
      (await presetSelectValue(page)) === '__view__');
    const selectedTextB = await selectedOptionText(page);
    check(`${name('view B pseudo option has no star (no explicit mapping for this view)')} (got ${JSON.stringify(selectedTextB)})`,
      !/^★/.test(selectedTextB || ''));

    // ── 4. pseudo選択中に列を編集(表示切替+保存)すると、疑似プリセットを
    //       書き換えるのではなく新しい実プリセットが作られてアクティブになる ──
    state = await readLayoutState(page);
    const presetCountBeforeEdit = state.presets.length;
    await openColumnDialog(page);
    await page.locator('.pb-overlay__column-visibility-item', { hasText: /^C$/ }).locator('input[type="checkbox"]').uncheck();
    await page.locator('.pb-overlay__column-visibility-item', { hasText: /^A$/ }).locator('input[type="checkbox"]').check();
    await page.waitForTimeout(100);
    await page.locator('.pb-overlay__column-panel-foot .pb-overlay__btn--primary', { hasText: /列順を保存|Save/ }).click();
    await page.waitForTimeout(300);

    state = await readLayoutState(page);
    check(name('editing columns while the pseudo preset was selected created a new real preset (count+1)'),
      state.presets.length === presetCountBeforeEdit + 1);
    const materializedId = state.activePresetId;
    check(name('the new preset is active and not the pseudo id'),
      Boolean(materializedId) && materializedId !== '__view__');
    const materialized = state.presets.find((p) => p.id === materializedId);
    check(name('the materialized preset is columnsCustomized=true (no longer view-synced)'),
      materialized?.columnsCustomized === true);
    const colsAfterEdit = await visibleColumnCodes(page);
    // 列ダイアログの並び順は「現在表示中の列はその並びのまま・新たに表示に
    // した列は末尾に追加」で確定する。表示中は[C,D]だったので、Cを隠して
    // Aを表示すると[D, A]になる
    check(`${name('columns reflect the edit [D, A] (C hidden, A newly shown and appended)')} (got ${JSON.stringify(colsAfterEdit)})`,
      JSON.stringify(colsAfterEdit) === JSON.stringify(['D', 'A']));
    check(name('view B is still unmapped (no persisted viewDefaults entry was created by this edit)'),
      !(state?.viewDefaults && 'id:21' in state.viewDefaults));

    // ── 5. プリセット削除は、それを指すビュー別既定(viewDefaults)も一緒に落とす ──
    await switchToView(page, VIEW_A_ID);
    state = await readLayoutState(page);
    check(name('back on view A, the mapping to the duplicated preset is still recorded in viewDefaults'),
      state.viewDefaults?.['id:20'] === duplicatedId);
    check(name('back on view A, the live session re-selected the mapped preset'),
      (await presetSelectValue(page)) === duplicatedId);

    // 削除はoverlayConfirmによる独自DOMモーダルの確認が入る(ネイティブdialogではない)
    await openPresetMenu(page);
    await page.locator('.pb-overlay__preset-menu-item', { hasText: /削除|Delete/ }).click();
    await page.waitForTimeout(150);
    await page.locator('.pb-overlay__confirm-actions button', { hasText: /削除|Delete/ }).click();
    await page.waitForTimeout(300);
    state = await readLayoutState(page);
    check(name('deleting the (active, mapped) preset removed it from presets[]'),
      !state.presets.some((p) => p.id === duplicatedId));
    check(name('deleting the mapped preset also dropped the viewDefaults entry pointing at it'),
      !(state?.viewDefaults && state.viewDefaults['id:20'] === duplicatedId));
  } finally {
    await ctx.close();
  }
}
