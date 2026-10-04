// 「ビュー列連動」(Excel Overlay の初期表示列をkintoneビューの表示列に合わせる,
// v3.2.0)の E2E テスト。
//
// 既存の tests/helpers/overlay-page.mjs はビュー列連動を再現できない
// (chrome.runtime.sendMessage の PB_GET_METADATA_BUNDLE が常に {ok:false} を
// 返すスタブのため、resolveViewInfoFromMetadata が常にnullになり、安全だが
// 列連動非対応の旧EXCEL_GET_VIEW_INFOフォールバックにしか乗らない)。
// そのため本テストは PB_GET_METADATA_BUNDLE に実データ(views.raw / fields.normalized)
// で応答する専用コンテキストを用意し、実際のビュー列連動の挙動を
// 起動〜列ダイアログ操作〜再起動まで通しで確認する。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildChromeStub } from './helpers/chrome-stub.mjs';
import { ORIGIN, cell } from './helpers/overlay-page.mjs';

const srcDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');
const read = (name) => fs.readFileSync(path.join(srcDir, name), 'utf8');
const contentJs = read('content.js');
const overlayCss = read('overlay.css');
const permissionServiceJs = read('permission-service.js');
const proServiceJs = read('pro-service.js');

const APP_ID = '12';
const VIEW_ID = '20';
const LAYOUT_KEY = 'kfavOverlayLayoutPresets';

// フォーム順: A, B, C, D, ステータス(STATUS型=オーバーレイ非対応・候補から除外)
const FIELDS_META = [
  { code: 'A', label: 'A', type: 'SINGLE_LINE_TEXT', required: false, choices: [] },
  { code: 'B', label: 'B', type: 'SINGLE_LINE_TEXT', required: false, choices: [] },
  { code: 'C', label: 'C', type: 'NUMBER', required: false, choices: [] },
  { code: 'D', label: 'D', type: 'SINGLE_LINE_TEXT', required: false, choices: [] },
  { code: 'ステータス', label: 'ステータス', type: 'STATUS', required: false, choices: [] }
];
// ビューの表示列: B, A, ステータス(非対応) の順。B,Aのみが採用され、
// ステータスは除外、C/Dはビュー外なので非表示(だが列ダイアログでは選択可能)
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

async function openViewSyncOverlay({ browser }) {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  await ctx.addInitScript(buildChromeStub({ empty: true }));
  await ctx.addInitScript(() => {
    window.chrome.storage.local.set({
      pbLicenseKey: 'TEST-KEY',
      pbLicenseCache: { status: 'active', cachedAt: Date.now() }
    });
  });
  // metadataBundle 経由のビュー列連動(resolveViewInfoFromMetadata)を再現する
  // ため、PB_GET_METADATA_BUNDLE に実データで応答するよう sendMessage を上書きする
  await ctx.addInitScript(({ viewsRaw, fieldsMeta }) => {
    window.chrome.runtime.sendMessage = (msg) => {
      if (msg && msg.type === 'PB_GET_METADATA_BUNDLE') {
        return Promise.resolve({
          ok: true,
          bundle: {
            app: { name: 'ビュー列連動テストアプリ' },
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
  await page.goto(`${ORIGIN}/k/${APP_ID}/?view=${VIEW_ID}`);
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

async function visibleColumnCodes(page) {
  return page.locator('.pb-overlay__col-label').allTextContents();
}

async function readLayoutState(page) {
  const stored = await page.evaluate((key) => window.chrome.storage.local.get(key), LAYOUT_KEY);
  const map = stored?.[LAYOUT_KEY] || {};
  return map[`${ORIGIN}::${APP_ID}`] || null;
}

async function openColumnDialog(page) {
  await page.locator('.pb-overlay__tool-menu-toggle').click();
  await page.waitForTimeout(150);
  await page.locator('.pb-overlay__tool-menu-item', { hasText: /列順|Columns/ }).click();
  await page.waitForTimeout(250);
}

export async function run({ browser, check }) {
  const name = (n) => `view-column-sync-e2e: ${n}`;
  const { ctx, page } = await openViewSyncOverlay({ browser });
  try {
    check(name('overlay opened'), (await page.locator('.pb-overlay').count()) > 0);

    // ── 1. 初回起動: 未カスタマイズdefault + ビュー列あり → ビューの列・順序(B,A)
    //       を採用し、ステータス(非対応)は除外、C/Dはビュー外なので非表示 ──
    const initialCols = (await visibleColumnCodes(page)).map((t) => t.trim());
    check(`${name('initial columns follow view order [B, A]')} (got ${JSON.stringify(initialCols)})`,
      JSON.stringify(initialCols) === JSON.stringify(['B', 'A']));
    check(name('field C (outside the view) is not rendered as a cell'), (await cell(page, 0, 'C').count()) === 0);
    check(name('field D (outside the view) is not rendered as a cell'), (await cell(page, 0, 'D').count()) === 0);

    let state = await readLayoutState(page);
    let active = state?.presets?.find((p) => p.id === state.activePresetId);
    check(name('fresh default preset starts columnsCustomized=false'), active?.columnsCustomized === false);

    // 列ダイアログ: 非表示のC/Dも選択可能(未チェック)のまま一覧に出ている
    await openColumnDialog(page);
    const cCheckbox = page.locator('.pb-overlay__column-visibility-item', { hasText: /^C$/ }).locator('input[type="checkbox"]');
    const dCheckbox = page.locator('.pb-overlay__column-visibility-item', { hasText: /^D$/ }).locator('input[type="checkbox"]');
    check(name('column dialog lists hidden field C as an available-but-unchecked checkbox'),
      (await cCheckbox.count()) === 1 && !(await cCheckbox.isChecked()));
    check(name('column dialog lists hidden field D as an available-but-unchecked checkbox'),
      (await dCheckbox.count()) === 1 && !(await dCheckbox.isChecked()));
    const bCheckbox = page.locator('.pb-overlay__column-visibility-item', { hasText: /^B$/ }).locator('input[type="checkbox"]');
    check(name('column dialog shows view-synced field B as checked'), await bCheckbox.isChecked());

    // ── 2. 幅だけの変更(リサイズ)は columnsCustomized を true にしない ──
    const resizer = page.locator('.pb-overlay__column-chip[data-code="B"] .pb-overlay__column-chip-resizer');
    const box = await resizer.boundingBox();
    if (box) {
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2, { steps: 5 });
      await page.mouse.up();
      await page.waitForTimeout(150);
    }
    check(name('resize drag happened (resizer handle was found)'), Boolean(box));
    // Saveは押さず、×で閉じる(幅変更はresizerのmouseupで即保存される仕様)
    await page.locator('.pb-overlay__column-close').click();
    await page.waitForTimeout(200);

    state = await readLayoutState(page);
    active = state?.presets?.find((p) => p.id === state.activePresetId);
    check(name('width-only resize keeps columnsCustomized=false'), active?.columnsCustomized === false);
    check(name('width-only resize still persisted a custom width for B'),
      Number(active?.columnWidths?.B) > 0 && Number(active.columnWidths.B) !== 160);

    // 閉じて再度開いても、幅だけの変更ならビュー列連動が続く(B,Aのまま)
    await closeOverlay(page);
    await reopenOverlay(page);
    const colsAfterResize = (await visibleColumnCodes(page)).map((t) => t.trim());
    check(`${name('after reopen, width-only change still shows view-synced columns [B, A]')} (got ${JSON.stringify(colsAfterResize)})`,
      JSON.stringify(colsAfterResize) === JSON.stringify(['B', 'A']));

    // ── 3. 列ダイアログから明示的に列を編集して保存 → columnsCustomized=true、
    //       以後はビューを無視してプリセットの保存内容が勝つ ──
    await openColumnDialog(page);
    await page.locator('.pb-overlay__column-visibility-item', { hasText: /^B$/ }).locator('input[type="checkbox"]').uncheck();
    await page.locator('.pb-overlay__column-visibility-item', { hasText: /^C$/ }).locator('input[type="checkbox"]').check();
    await page.waitForTimeout(100);
    await page.locator('.pb-overlay__column-panel-foot .pb-overlay__btn--primary', { hasText: /列順を保存|Save/ }).click();
    await page.waitForTimeout(300);

    const colsAfterEdit = (await visibleColumnCodes(page)).map((t) => t.trim());
    check(`${name('explicit column edit shows [A, C], ignoring the view order')} (got ${JSON.stringify(colsAfterEdit)})`,
      JSON.stringify(colsAfterEdit) === JSON.stringify(['A', 'C']));

    state = await readLayoutState(page);
    active = state?.presets?.find((p) => p.id === state.activePresetId);
    check(name('explicit column dialog save sets columnsCustomized=true'), active?.columnsCustomized === true);

    // 再起動しても、カスタマイズ済みプリセットはビューに関係なく保存内容を維持する
    await closeOverlay(page);
    await reopenOverlay(page);
    const colsAfterReopen = (await visibleColumnCodes(page)).map((t) => t.trim());
    check(`${name('after reopen, customized preset still wins over the view [A, C]')} (got ${JSON.stringify(colsAfterReopen)})`,
      JSON.stringify(colsAfterReopen) === JSON.stringify(['A', 'C']));

    // ── 4. リセット → columnsCustomized=false に戻り、ビュー列連動が再び効く ──
    await openColumnDialog(page);
    await page.locator('.pb-overlay__column-panel-foot button', { hasText: /リセット|Reset/ }).click();
    await page.waitForTimeout(300);

    const colsAfterReset = (await visibleColumnCodes(page)).map((t) => t.trim());
    check(`${name('reset restores view-synced columns [B, A]')} (got ${JSON.stringify(colsAfterReset)})`,
      JSON.stringify(colsAfterReset) === JSON.stringify(['B', 'A']));
    state = await readLayoutState(page);
    active = state?.presets?.find((p) => p.id === state.activePresetId);
    check(name('reset clears columnsCustomized back to false'), active?.columnsCustomized === false);
  } finally {
    await ctx.close();
  }
}
