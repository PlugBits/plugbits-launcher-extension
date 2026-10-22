// ドラッグ中(範囲選択/フィルハンドル)の自動スクロール(3.4.0)のE2E検証。
// 対象: 一覧(メイングリッド・仮想化あり)とサブテーブル編集モーダル(仮想化なし)の両方。
// ポインターをスクロール領域の端の外へ出して保持すると、DragAutoscroller(content-overlay-
// controller.js冒頭の共通ヘルパー)がrequestAnimationFrameで毎フレームスクロールを進め、
// その都度(マウスが動かなくても)選択範囲/フィル範囲の終端セルを再計算することを確認する。
// mouseup後はスクロールが止まり、rAFがリークしないこと(scrollTopが増え続けないこと)も見る。
import { openOverlay, cell as mainCell } from './helpers/overlay-page.mjs';

function numRecords(count) {
  return Array.from({ length: count }, (_, i) => ({
    $id: { value: String(i + 1) }, $revision: { value: '1' },
    N: { value: String(i) }
  }));
}

const N_FIELDS = [
  { code: 'N', label: 'N', type: 'NUMBER', required: false, choices: [] }
];

// 横方向の自動スクロール確認用: 列数を増やして合計幅をビューポートより広くする
// (この環境のヘッドレスChromiumはrAFの実測が60fpsより遅いことがあるため、必要スクロール量を
// 抑えて待ち時間に対して十分な余裕を持たせる)
const WIDE_FIELD_COUNT = 10;
const WIDE_FIELDS = Array.from({ length: WIDE_FIELD_COUNT }, (_, i) => (
  { code: `C${i}`, label: `C${i}`, type: 'SINGLE_LINE_TEXT', required: false, choices: [] }
));
function wideRecord() {
  const value = {};
  WIDE_FIELDS.forEach((f, i) => { value[f.code] = { value: `v${i}` }; });
  return { $id: { value: '1' }, $revision: { value: '1' }, ...value };
}

function buildBridge(fields, records) {
  return `
const RECORDS = ${JSON.stringify(records)};
window.addEventListener('message', (ev) => {
  const d = ev.data || {};
  if (!d || d.__kfav__ !== true || !d.id || d.replyTo) return;
  const reply = (extra) => window.postMessage({ __kfav__: true, replyTo: d.id, ...extra }, location.origin);
  const type = d.type;
  if (type === 'EXCEL_GET_APP_CONTEXT') return reply({ ok: true, appId: '12', appName: '受注管理', query: '', timezone: 'Asia/Tokyo' });
  if (type === 'EXCEL_GET_FIELDS_META') return reply({ ok: true, fieldsMeta: ${JSON.stringify(fields)} });
  if (type === 'EXCEL_GET_RECORDS') return reply({ ok: true, records: RECORDS, totalCount: RECORDS.length });
  if (type === 'EXCEL_EVALUATE_RECORD_ACL') {
    const ids = Array.isArray(d.payload?.ids) ? d.payload.ids : [];
    return reply({ ok: true, rights: ids.map((id) => ({ id, editable: true, deletable: true, viewable: true })) });
  }
  if (type === 'EXCEL_GET_LOGIN_USER') return reply({ ok: true, user: { timezone: 'Asia/Tokyo' } });
  if (type === 'GET_APP_NAME') return reply({ ok: true, name: '受注管理' });
  if (type === 'EXCEL_GET_APP_ACL' || type === 'EXCEL_GET_RECORD_ACL' || type === 'EXCEL_GET_FIELD_ACL' || type === 'EXCEL_GET_VIEWS') return reply({ ok: true, result: {} });
  reply({ ok: false });
});`;
}

const SUBTABLE_FIELDS = [
  { code: '案件名', label: '案件名', type: 'SINGLE_LINE_TEXT', required: false, choices: [] },
  {
    code: '明細', label: '明細', type: 'SUBTABLE', required: false, choices: [],
    subtable: { fields: [
      { code: '品目', label: '品目', type: 'SINGLE_LINE_TEXT', required: false, choices: [] },
      { code: '数量', label: '数量', type: 'NUMBER', required: false, choices: [] }
    ] }
  }
];

function buildSubtableRecords(rowCount) {
  const items = Array.from({ length: rowCount }, (_, i) => (
    { id: String(i + 1), value: { 品目: { value: `S${i}` }, 数量: { value: String(i) } } }
  ));
  return [{
    $id: { value: '301' }, $revision: { value: '1' },
    案件名: { value: '案件A' },
    明細: { value: items }
  }];
}

function buildSubtableBridge(records) {
  return `
const RECORDS = ${JSON.stringify(records)};
window.addEventListener('message', (ev) => {
  const d = ev.data || {};
  if (!d || d.__kfav__ !== true || !d.id || d.replyTo) return;
  const reply = (extra) => window.postMessage({ __kfav__: true, replyTo: d.id, ...extra }, location.origin);
  const type = d.type;
  if (type === 'EXCEL_GET_APP_CONTEXT') return reply({ ok: true, appId: '12', appName: '受注管理', query: '', timezone: 'Asia/Tokyo' });
  if (type === 'EXCEL_GET_FIELDS_META') return reply({ ok: true, fieldsMeta: ${JSON.stringify(SUBTABLE_FIELDS)} });
  if (type === 'EXCEL_GET_RECORDS') return reply({ ok: true, records: RECORDS, totalCount: RECORDS.length });
  if (type === 'EXCEL_EVALUATE_RECORD_ACL') {
    const ids = Array.isArray(d.payload?.ids) ? d.payload.ids : [];
    return reply({ ok: true, rights: ids.map((id) => ({ id, editable: true, deletable: true, viewable: true })) });
  }
  if (type === 'EXCEL_GET_LOGIN_USER') return reply({ ok: true, user: { timezone: 'Asia/Tokyo' } });
  if (type === 'GET_APP_NAME') return reply({ ok: true, name: '受注管理' });
  if (type === 'EXCEL_GET_APP_ACL' || type === 'EXCEL_GET_RECORD_ACL' || type === 'EXCEL_GET_FIELD_ACL' || type === 'EXCEL_GET_VIEWS') return reply({ ok: true, result: {} });
  reply({ ok: false });
});`;
}

async function getScrollBox(page, selector) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    const r = el.getBoundingClientRect();
    return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
  }, selector);
}

async function getScroll(page, selector) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    return { top: el.scrollTop, left: el.scrollLeft };
  }, selector);
}

// 現在DOMにレンダリングされている行(仮想化で間引かれていない範囲)の最大row-indexを返す。
// ビューポート高さに依存せず「まだレンダリングされていない行」を動的に選べるようにする
async function maxRenderedRow(page, fieldCode) {
  return page.evaluate((code) => {
    const inputs = document.querySelectorAll(`.pb-overlay__cell input[data-field-code="${code}"]`);
    let max = -1;
    inputs.forEach((el) => {
      const r = Number(el.dataset.rowIndex);
      if (Number.isFinite(r) && r > max) max = r;
    });
    return max;
  }, fieldCode);
}

export async function run({ browser, check }) {
  const name = (n) => `drag-autoscroll-e2e: ${n}`;

  // ================================================================
  // (1) 一覧: 範囲選択ドラッグを下端の外へ出して保持→縦方向に自動スクロールする。
  //     終端行が最初に見えていた行より先まで伸びる・mouseup後は止まる
  // ================================================================
  {
    const { ctx, page } = await openOverlay({ browser, bridgeScript: buildBridge(N_FIELDS, numRecords(120)) });
    try {
      const c = (r) => mainCell(page, r, 'N');
      const cellExists = (r) => page.locator(`.pb-overlay__cell input[data-field-code="N"][data-row-index="${r}"]`).count();
      const cellSelected = async (r) => {
        const loc = page.locator(`.pb-overlay__cell input[data-field-code="N"][data-row-index="${r}"]`);
        if ((await loc.count()) === 0) return false;
        return loc.evaluate((el) => el.parentElement.classList.contains('pb-overlay__cell--selected'));
      };

      const initialMax = await maxRenderedRow(page, 'N');
      const target = initialMax + 10;
      check(name('(1) 前提: 終端行(target)はまだレンダリングされていない(仮想化)'), (await cellExists(target)) === 0);

      const box = await getScrollBox(page, '.pb-overlay__cell-scroll');
      await c(0).dispatchEvent('mousedown', { button: 0 });
      await page.mouse.move(box.left + box.width / 2, box.bottom + 15);
      await page.waitForTimeout(1500);

      const scrollAfterHold = await getScroll(page, '.pb-overlay__cell-scroll');
      check(name('(1) ホールド中にscrollTopが増える'), scrollAfterHold.top > 0);
      check(name('(1) 終端行(target)が選択範囲に伸びている(最初に見えていた行より先)'), await cellSelected(target));

      await page.mouse.up();
      await page.waitForTimeout(150);
      const afterUp = await getScroll(page, '.pb-overlay__cell-scroll');
      await page.waitForTimeout(250);
      const afterWait = await getScroll(page, '.pb-overlay__cell-scroll');
      check(name('(1) mouseup後はscrollTopが増え続けない'), afterUp.top === afterWait.top);
    } finally { await ctx.close(); }
  }

  // ================================================================
  // (2) 一覧: フィルハンドルのドラッグでも同様に下端の外へ出すと自動スクロールする
  // ================================================================
  {
    const { ctx, page } = await openOverlay({ browser, bridgeScript: buildBridge(N_FIELDS, numRecords(120)) });
    try {
      const c = (r) => mainCell(page, r, 'N');
      await c(0).dispatchEvent('mousedown', { button: 0 });
      await page.evaluate(() => document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })));
      await page.waitForTimeout(80);

      const initialMax = await maxRenderedRow(page, 'N');
      const target = initialMax + 8;

      const handle = page.locator('.pb-overlay__fill-handle');
      const hbox = await handle.boundingBox();
      await page.mouse.move(hbox.x + hbox.width / 2, hbox.y + hbox.height / 2);
      await page.mouse.down();

      const box = await getScrollBox(page, '.pb-overlay__cell-scroll');
      await page.mouse.move(box.left + box.width / 2, box.bottom + 15);
      await page.waitForTimeout(1500);

      const scrollAfterHold = await getScroll(page, '.pb-overlay__cell-scroll');
      check(name('(2) フィルドラッグのホールド中にscrollTopが増える'), scrollAfterHold.top > 0);

      await page.mouse.up();
      await page.waitForTimeout(150);
      const afterUp = await getScroll(page, '.pb-overlay__cell-scroll');
      // フィル確定後、最初に見えていなかった行(target)がソース値"0"になっている(自動スクロール
      // で伸びたプレビュー範囲がそのまま書き込まれたことの確認)
      const targetValue = await mainCell(page, target, 'N').inputValue();
      check(name('(2) フィル確定で終端行(target)がソース値"0"になる(自動スクロールで範囲が伸びていた)'), targetValue === '0');
      await page.waitForTimeout(250);
      const afterWait = await getScroll(page, '.pb-overlay__cell-scroll');
      check(name('(2) mouseup後はscrollTopが増え続けない'), afterUp.top === afterWait.top);
    } finally { await ctx.close(); }
  }

  // ================================================================
  // (3) 一覧: 横方向。列数の多い一覧で右端の外へ出すと自動スクロールする
  // ================================================================
  {
    const { ctx, page } = await openOverlay({ browser, bridgeScript: buildBridge(WIDE_FIELDS, [wideRecord()]) });
    try {
      const c = (code) => mainCell(page, 0, code);
      const cellSelected = async (code) => {
        const loc = page.locator(`.pb-overlay__cell input[data-field-code="${code}"][data-row-index="0"]`);
        return loc.evaluate((el) => el.parentElement.classList.contains('pb-overlay__cell--selected'));
      };

      const box = await getScrollBox(page, '.pb-overlay__cell-scroll');
      await c('C0').dispatchEvent('mousedown', { button: 0 });
      await page.mouse.move(box.right + 15, box.top + box.height / 2);
      await page.waitForTimeout(1500);

      const scrollAfterHold = await getScroll(page, '.pb-overlay__cell-scroll');
      check(name('(3) 横方向: ホールド中にscrollLeftが増える'), scrollAfterHold.left > 0);
      check(name('(3) 横方向: 最終列が選択範囲に伸びている'), await cellSelected(`C${WIDE_FIELD_COUNT - 1}`));

      await page.mouse.up();
      await page.waitForTimeout(150);
      const afterUp = await getScroll(page, '.pb-overlay__cell-scroll');
      await page.waitForTimeout(250);
      const afterWait = await getScroll(page, '.pb-overlay__cell-scroll');
      check(name('(3) mouseup後はscrollLeftが増え続けない'), afterUp.left === afterWait.left);
    } finally { await ctx.close(); }
  }

  // ================================================================
  // (4) サブテーブル編集モーダル: 範囲選択ドラッグでパネル内スクロール領域の下端の外へ
  //     出して保持→自動スクロールする。mouseup後は止まる
  // ================================================================
  {
    const SUBTABLE_ROW_COUNT = 40;
    const { ctx, page } = await openOverlay({ browser, bridgeScript: buildSubtableBridge(buildSubtableRecords(SUBTABLE_ROW_COUNT)) });
    try {
      await mainCell(page, 0, '明細').click();
      await page.waitForTimeout(300);

      const subtableRow = (idx) => page.locator('.pb-subtable__body .pb-subtable__row').nth(idx);
      const subtableCellEl = (rowIdx, colIdx) => subtableRow(rowIdx).locator(`.pb-subtable__cell[data-col-index="${colIdx}"]`);
      const hasClass = async (locator, cls) => Boolean(await locator.evaluate((el, c) => el.classList.contains(c), cls));
      const lastRow = SUBTABLE_ROW_COUNT - 1;

      const box = await getScrollBox(page, '.pb-subtable-wrap');
      await subtableCellEl(0, 0).dispatchEvent('mousedown', { button: 0 });
      await page.mouse.move(box.left + box.width / 2, box.bottom + 15);
      await page.waitForTimeout(1800);

      const scrollAfterHold = await getScroll(page, '.pb-subtable-wrap');
      check(name('(4) モーダル: ホールド中にscrollTopが増える'), scrollAfterHold.top > 0);
      check(name('(4) モーダル: 終端行(最終行)が選択範囲に伸びている'), await hasClass(subtableCellEl(lastRow, 0), 'pb-overlay__subtable-cell--selected'));

      await page.mouse.up();
      await page.waitForTimeout(150);
      const afterUp = await getScroll(page, '.pb-subtable-wrap');
      await page.waitForTimeout(250);
      const afterWait = await getScroll(page, '.pb-subtable-wrap');
      check(name('(4) モーダル: mouseup後はscrollTopが増え続けない'), afterUp.top === afterWait.top);
    } finally { await ctx.close(); }
  }

  // ================================================================
  // (5) ①の確認: モーダルの見出し欄にUndo/Redoがあり、フッターには無いこと
  // ================================================================
  {
    const { ctx, page } = await openOverlay({ browser, bridgeScript: buildSubtableBridge(buildSubtableRecords(4)) });
    try {
      await mainCell(page, 0, '明細').click();
      await page.waitForTimeout(300);
      check(name('(5) 見出し欄にUndoボタンがある'), (await page.locator('.pb-overlay__subtable-head [data-subtable-action="undo"]').count()) === 1);
      check(name('(5) 見出し欄にRedoボタンがある'), (await page.locator('.pb-overlay__subtable-head [data-subtable-action="redo"]').count()) === 1);
      check(name('(5) フッターにはUndoボタンが無い'), (await page.locator('.pb-overlay__subtable-foot [data-subtable-action="undo"]').count()) === 0);
      check(name('(5) フッターにはRedoボタンが無い'), (await page.locator('.pb-overlay__subtable-foot [data-subtable-action="redo"]').count()) === 0);
    } finally { await ctx.close(); }
  }
}
