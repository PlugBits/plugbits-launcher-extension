// ドラッグ中(範囲選択/フィルハンドル)の自動スクロール(3.4.0)のE2E検証。
// 対象: 一覧(メイングリッド・仮想化あり)とサブテーブル編集モーダル(仮想化なし)の両方。
// ポインターをスクロール領域の端の外へ出して保持すると、DragAutoscroller(content-overlay-
// controller.js冒頭の共通ヘルパー)がrequestAnimationFrameで毎フレームスクロールを進め、
// その都度(マウスが動かなくても)選択範囲/フィル範囲の終端セルを再計算することを確認する。
// mouseup後はスクロールが止まり、rAFがリークしないこと(scrollTopが増え続けないこと)も見る。
import { openOverlay, openOverlayContext, cell as mainCell } from './helpers/overlay-page.mjs';

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
  const VIEWPORT_H = 900; // helpers/overlay-page.mjs の既定 viewport 高さ
  const centerOf = async (locator) => {
    const b = await locator.boundingBox();
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  };

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
      // 3.4.0(自動スクロール頑丈化): buttons===0でドラッグを終える対策を入れたため、
      // 以降はdispatchEvent('mousedown')ではなくpage.mouse.down()(実際にボタンを押した
      // 状態を保つ)でドラッグを開始する
      const p0 = await centerOf(c(0));
      await page.mouse.move(p0.x, p0.y);
      await page.mouse.down();
      await page.mouse.move(box.left + box.width / 2, box.bottom + 15);
      await page.waitForTimeout(3000);

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
      await page.waitForTimeout(3000);

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
      // 3.4.0: buttons===0終了対策のため実際のmouse.down()でドラッグを開始する
      const p0 = await centerOf(c('C0'));
      await page.mouse.move(p0.x, p0.y);
      await page.mouse.down();
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
      // 3.4.0: buttons===0終了対策のため実際のmouse.down()でドラッグを開始する
      const p0 = await centerOf(subtableCellEl(0, 0));
      await page.mouse.move(p0.x, p0.y);
      await page.mouse.down();
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

  // ================================================================
  // (6)〜(9) 画面外まで引いた場合(10/22 オケオ実機の指摘「画面外までドラッグしてもスクロールしない」)。
  //   実機に近づけるため mouse.down でボタンを押したまま、ポインターをオーバーレイ/モーダルの外・
  //   さらにビューポート(ブラウザの表示域)の外まで出し、そこで止めたままスクロールが続くことを見る。
  //   ポインターを動かさなくても続くこと(t1 < t2)・終端が伸びること・mouseup で止まることを確かめる
  // ================================================================

  // (6) 一覧: 範囲選択でビューポートの下の外 → 下へスクロールが続く → そのまま上の外へ → 上へ戻る
  {
    const { ctx, page } = await openOverlay({ browser, bridgeScript: buildBridge(N_FIELDS, numRecords(120)) });
    try {
      const SCROLL = '.pb-overlay__cell-scroll';
      const cellSelected = async (r) => {
        const loc = page.locator(`.pb-overlay__cell input[data-field-code="N"][data-row-index="${r}"]`);
        if ((await loc.count()) === 0) return false;
        return loc.evaluate((el) => el.parentElement.classList.contains('pb-overlay__cell--selected'));
      };
      const initialMax = await maxRenderedRow(page, 'N');
      const target = initialMax + 10;
      const box = await getScrollBox(page, SCROLL);
      const p = await centerOf(mainCell(page, 0, 'N'));
      await page.mouse.move(p.x, p.y);
      await page.mouse.down();
      await page.mouse.move(box.left + box.width / 2, VIEWPORT_H + 150, { steps: 5 });
      await page.waitForTimeout(600);
      const t1 = await getScroll(page, SCROLL);
      await page.waitForTimeout(900);
      const t2 = await getScroll(page, SCROLL);
      check(name('(6) 一覧: ビューポートの下の外で止めたままscrollTopが増え続ける'), t1.top > 0 && t2.top > t1.top);
      check(name('(6) 一覧: 画面外で止めたまま終端行(target)まで選択が伸びる'), await cellSelected(target));

      await page.mouse.move(box.left + box.width / 2, -150, { steps: 5 });
      await page.waitForTimeout(800);
      const t3 = await getScroll(page, SCROLL);
      check(name('(6) 一覧: ビューポートの上の外へ出すとscrollTopが減る'), t3.top < t2.top);

      await page.mouse.up();
      await page.waitForTimeout(150);
      const afterUp = await getScroll(page, SCROLL);
      await page.waitForTimeout(300);
      const afterWait = await getScroll(page, SCROLL);
      check(name('(6) 一覧: 画面外でmouseupした後はscrollTopが変わらない'), afterUp.top === afterWait.top);
    } finally { await ctx.close(); }
  }

  // (7) 一覧: フィルハンドルでビューポートの下の外(横もビューポートの左の外)→ スクロールが続き、確定で値が入る
  {
    const { ctx, page } = await openOverlay({ browser, bridgeScript: buildBridge(N_FIELDS, numRecords(120)) });
    try {
      const SCROLL = '.pb-overlay__cell-scroll';
      const p0 = await centerOf(mainCell(page, 0, 'N'));
      await page.mouse.click(p0.x, p0.y);
      await page.waitForTimeout(80);
      const initialMax = await maxRenderedRow(page, 'N');
      const target = initialMax + 8;
      const h = await centerOf(page.locator('.pb-overlay__fill-handle'));
      await page.mouse.move(h.x, h.y);
      await page.mouse.down();
      await page.mouse.move(-60, VIEWPORT_H + 150, { steps: 5 });
      await page.waitForTimeout(600);
      const t1 = await getScroll(page, SCROLL);
      await page.waitForTimeout(900);
      const t2 = await getScroll(page, SCROLL);
      check(name('(7) 一覧フィル: 画面外(左下)で止めたままscrollTopが増え続ける'), t1.top > 0 && t2.top > t1.top);
      await page.mouse.up();
      await page.waitForTimeout(150);
      const afterUp = await getScroll(page, SCROLL);
      const targetValue = await mainCell(page, target, 'N').inputValue();
      check(name('(7) 一覧フィル: 画面外でmouseup→終端行(target)にソース値"0"が入る'), targetValue === '0');
      await page.waitForTimeout(300);
      const afterWait = await getScroll(page, SCROLL);
      check(name('(7) 一覧フィル: mouseup後はscrollTopが変わらない'), afterUp.top === afterWait.top);
    } finally { await ctx.close(); }
  }

  // (8) モーダル: 範囲選択でモーダルの外・ビューポートの下の外 → スクロールが続き最終行まで伸びる
  // (9) モーダル: フィルハンドルでも同様
  for (const mode of ['select', 'fill']) {
    const tag = mode === 'select' ? '(8) モーダル選択' : '(9) モーダルフィル';
    const SUBTABLE_ROW_COUNT = 60;
    const { ctx, page } = await openOverlay({ browser, bridgeScript: buildSubtableBridge(buildSubtableRecords(SUBTABLE_ROW_COUNT)) });
    try {
      const SCROLL = '.pb-subtable-wrap';
      await mainCell(page, 0, '明細').click();
      await page.waitForTimeout(300);
      const subtableCellEl = (rowIdx, colIdx) => page.locator('.pb-subtable__body .pb-subtable__row').nth(rowIdx).locator(`.pb-subtable__cell[data-col-index="${colIdx}"]`);
      const box = await getScrollBox(page, SCROLL);
      const p0 = await centerOf(subtableCellEl(0, 0));
      if (mode === 'select') {
        await page.mouse.move(p0.x, p0.y);
        await page.mouse.down();
      } else {
        await page.mouse.click(p0.x, p0.y);
        await page.waitForTimeout(80);
        const h = await centerOf(page.locator('.pb-subtable-wrap .pb-overlay__fill-handle'));
        await page.mouse.move(h.x, h.y);
        await page.mouse.down();
      }
      await page.mouse.move(box.left + box.width / 2, VIEWPORT_H + 150, { steps: 5 });
      await page.waitForTimeout(600);
      const t1 = await getScroll(page, SCROLL);
      await page.waitForTimeout(900);
      const t2 = await getScroll(page, SCROLL);
      check(name(`${tag}: モーダルの外・ビューポートの下の外で止めたままscrollTopが増え続ける`), t1.top > 0 && (t2.top > t1.top || t2.top >= (await page.evaluate((s) => { const el = document.querySelector(s); return el.scrollHeight - el.clientHeight; }, SCROLL)) - 1));
      await page.waitForTimeout(1500);
      if (mode === 'select') {
        const sel = await subtableCellEl(SUBTABLE_ROW_COUNT - 1, 0).evaluate((el) => el.classList.contains('pb-overlay__subtable-cell--selected'));
        check(name(`${tag}: 最終行まで選択が伸びる`), sel);
      }
      await page.mouse.up();
      await page.waitForTimeout(150);
      const afterUp = await getScroll(page, SCROLL);
      if (mode === 'fill') {
        const firstText = await subtableCellEl(0, 0).locator('input').inputValue();
        const lastText = await subtableCellEl(SUBTABLE_ROW_COUNT - 1, 0).locator('input').inputValue();
        check(name(`${tag}: 画面外でmouseup→最終行に先頭行と同じ値(S0)が入る`), firstText === 'S0' && lastText === 'S0');
      }
      await page.waitForTimeout(300);
      const afterWait = await getScroll(page, SCROLL);
      check(name(`${tag}: mouseup後はscrollTopが変わらない`), afterUp.top === afterWait.top);
    } finally { await ctx.close(); }
  }

  // ================================================================
  // (10) 実ページに似せた敵対的な土台(10/22 オケオ実機の指摘を受けた頑丈化)。
  //   実機のkintoneページはbodyが長くスクロールしていることがあり、content scriptは
  //   isolated worldで動く(ページ側のイベントハンドラとは独立)。ここではe2eの偽ページでも
  //   それに近い状況を作る: bodyの高さを4000pxにしてwindow.scrollTo(0,1500)で実際にページを
  //   スクロールさせておき、さらにbodyにmousemoveのbubbleリスナーを付けてstopPropagationする
  //   (documentまでbubbleが届かない=既存のdocument mousemove監視だけでは拾えない状態)。
  //   window captureでのmousemove/pointermove監視(項目3)が効いていれば、この状態でも
  //   一覧の範囲選択・フィルが画面外まで引いて止めたままスクロールを続けられるはず
  // ================================================================
  {
    const { ctx, page } = await openOverlayContext({ browser, bridgeScript: buildBridge(N_FIELDS, numRecords(120)) });
    try {
      await page.evaluate(() => {
        document.body.style.height = '4000px';
        window.scrollTo(0, 1500);
        document.body.addEventListener('mousemove', (e) => { e.stopPropagation(); }, false);
      });
      await page.keyboard.press('Control+Shift+KeyE');
      await page.waitForTimeout(1200);

      const SCROLL = '.pb-overlay__cell-scroll';
      const cellSelected = async (r) => {
        const loc = page.locator(`.pb-overlay__cell input[data-field-code="N"][data-row-index="${r}"]`);
        if ((await loc.count()) === 0) return false;
        return loc.evaluate((el) => el.parentElement.classList.contains('pb-overlay__cell--selected'));
      };
      const initialMax = await maxRenderedRow(page, 'N');
      const target = initialMax + 10;
      const box = await getScrollBox(page, SCROLL);
      const p0 = await centerOf(mainCell(page, 0, 'N'));
      await page.mouse.move(p0.x, p0.y);
      await page.mouse.down();
      await page.mouse.move(box.left + box.width / 2, VIEWPORT_H + 150, { steps: 5 });
      await page.waitForTimeout(600);
      const t1 = await getScroll(page, SCROLL);
      await page.waitForTimeout(900);
      const t2 = await getScroll(page, SCROLL);
      check(name('(10) 敵対的な土台: bodyのmousemoveがstopPropagationでもホールド中にscrollTopが増え続ける'), t1.top > 0 && t2.top > t1.top);
      check(name('(10) 敵対的な土台: 画面外で止めたまま終端行(target)まで選択が伸びる'), await cellSelected(target));
      await page.mouse.up();
      await page.waitForTimeout(150);
      const afterUp = await getScroll(page, SCROLL);
      await page.waitForTimeout(300);
      const afterWait = await getScroll(page, SCROLL);
      check(name('(10) 敵対的な土台: mouseup後はscrollTopが変わらない'), afterUp.top === afterWait.top);
    } finally { await ctx.close(); }
  }

  // (10続き) フィルハンドルでも同様に、敵対的な土台(body mousemove stopPropagation)で
  // 画面外まで引いて止めたままスクロールが続き、確定で値が入ること
  {
    const { ctx, page } = await openOverlayContext({ browser, bridgeScript: buildBridge(N_FIELDS, numRecords(120)) });
    try {
      await page.evaluate(() => {
        document.body.style.height = '4000px';
        window.scrollTo(0, 1500);
        document.body.addEventListener('mousemove', (e) => { e.stopPropagation(); }, false);
      });
      await page.keyboard.press('Control+Shift+KeyE');
      await page.waitForTimeout(1200);

      const SCROLL = '.pb-overlay__cell-scroll';
      const p0 = await centerOf(mainCell(page, 0, 'N'));
      await page.mouse.click(p0.x, p0.y);
      await page.waitForTimeout(80);
      const initialMax = await maxRenderedRow(page, 'N');
      const target = initialMax + 8;
      const h = await centerOf(page.locator('.pb-overlay__fill-handle'));
      await page.mouse.move(h.x, h.y);
      await page.mouse.down();
      const box = await getScrollBox(page, SCROLL);
      await page.mouse.move(box.left + box.width / 2, VIEWPORT_H + 150, { steps: 5 });
      await page.waitForTimeout(600);
      const t1 = await getScroll(page, SCROLL);
      await page.waitForTimeout(900);
      const t2 = await getScroll(page, SCROLL);
      check(name('(10) 敵対的な土台・フィル: ホールド中にscrollTopが増え続ける'), t1.top > 0 && t2.top > t1.top);
      await page.mouse.up();
      await page.waitForTimeout(150);
      const targetValue = await mainCell(page, target, 'N').inputValue();
      check(name('(10) 敵対的な土台・フィル: 画面外でmouseup→終端行(target)にソース値"0"が入る'), targetValue === '0');
    } finally { await ctx.close(); }
  }

  // ================================================================
  // (11) スクロール要素の下端が表示域より下にある状態(10/22 オケオ実機の核心的な指摘:
  //   「見えている矩形」で端判定しないと、実際の画面の一番下にポインターを置いても
  //   端の28px以内に入らず自動スクロールが起動しない)。.pb-overlay__cell-scrollの高さを
  //   (viewport高さ+300px)まで強制的に伸ばして表示域からはみ出させ、ポインターを画面の
  //   一番下(innerHeight-2)で止めたまま、スクロールが進むことを確認する
  // ================================================================
  {
    const { ctx, page } = await openOverlay({ browser, bridgeScript: buildBridge(N_FIELDS, numRecords(120)) });
    try {
      const SCROLL = '.pb-overlay__cell-scroll';
      await page.evaluate((sel) => {
        const el = document.querySelector(sel);
        el.style.height = `${window.innerHeight + 300}px`;
      }, SCROLL);

      const box = await getScrollBox(page, SCROLL);
      const p0 = await centerOf(mainCell(page, 0, 'N'));
      await page.mouse.move(p0.x, p0.y);
      await page.mouse.down();
      const bottomX = box.left + box.width / 2;
      await page.mouse.move(bottomX, VIEWPORT_H - 2, { steps: 5 });
      await page.waitForTimeout(600);
      const t1 = await getScroll(page, SCROLL);
      await page.waitForTimeout(900);
      const t2 = await getScroll(page, SCROLL);
      check(name('(11) スクロール要素が表示域より下にはみ出していてもホールド中にscrollTopが増え続ける'), t1.top > 0 && t2.top > t1.top);
      await page.mouse.up();
      await page.waitForTimeout(150);
      const afterUp = await getScroll(page, SCROLL);
      await page.waitForTimeout(300);
      const afterWait = await getScroll(page, SCROLL);
      check(name('(11) mouseup後はscrollTopが変わらない'), afterUp.top === afterWait.top);
    } finally { await ctx.close(); }
  }

  // ================================================================
  // (13) 診断ログ: localStorage.pbDiag='1' の時だけconsoleに
  //   `[PB][diag] autoscroll start …` と `stop reason=mouseup …` が出ること
  //   (既定ではpbDiag未設定なので出ない=ストア版と同じ静かな既定動作であることも併せて見る)
  // ================================================================
  {
    const { ctx, page } = await openOverlayContext({ browser, bridgeScript: buildBridge(N_FIELDS, numRecords(120)) });
    try {
      await page.evaluate(() => { try { window.localStorage.setItem('pbDiag', '1'); } catch (_e) { /* noop */ } });
      // build=3.4.0-as2 の1回ログはattachEvents()(一覧を開く処理)の中で出るため、
      // 起動キー(Ctrl+Shift+E)を押す前にconsoleリスナーを付けておく
      const logs = [];
      page.on('console', (msg) => { logs.push(msg.text()); });

      await page.keyboard.press('Control+Shift+KeyE');
      await page.waitForTimeout(1200);

      const p0 = await centerOf(mainCell(page, 0, 'N'));
      await page.mouse.move(p0.x, p0.y);
      await page.mouse.down();
      const box = await getScrollBox(page, '.pb-overlay__cell-scroll');
      await page.mouse.move(box.left + box.width / 2, box.bottom + 15);
      await page.waitForTimeout(400);
      await page.mouse.up();
      await page.waitForTimeout(150);

      check(name('(13) 診断ログ: autoscroll startが出る'), logs.some((l) => l.includes('[PB][diag] autoscroll start') && l.includes('kind=grid-select')));
      // window captureのmouseup(より早い捕捉フェーズ)がdocument captureより先に届くため、
      // 通常のmouseupでも reason=window-mouseup として記録される(mouseupも許容する)
      check(name('(13) 診断ログ: stop reason=mouseup系が出る'), logs.some((l) => l.includes('[PB][diag] autoscroll stop') && /reason=(window-)?mouseup\b/.test(l)));
      check(name('(13) 診断ログ: build版表記が出る'), logs.some((l) => l.includes('[PB][diag] autoscroll build=3.4.0-as2')));
    } finally { await ctx.close(); }
  }

  // (13続き) pbDiag未設定(既定)ではconsoleに何も出ないこと(ストア版の既定動作確認)
  {
    const { ctx, page } = await openOverlay({ browser, bridgeScript: buildBridge(N_FIELDS, numRecords(120)) });
    try {
      const logs = [];
      page.on('console', (msg) => { logs.push(msg.text()); });
      const p0 = await centerOf(mainCell(page, 0, 'N'));
      await page.mouse.move(p0.x, p0.y);
      await page.mouse.down();
      const box = await getScrollBox(page, '.pb-overlay__cell-scroll');
      await page.mouse.move(box.left + box.width / 2, box.bottom + 15);
      await page.waitForTimeout(400);
      await page.mouse.up();
      await page.waitForTimeout(150);
      check(name('(13) pbDiag未設定では[PB][diag]ログが出ない'), !logs.some((l) => l.includes('[PB][diag] autoscroll')));
    } finally { await ctx.close(); }
  }
}
