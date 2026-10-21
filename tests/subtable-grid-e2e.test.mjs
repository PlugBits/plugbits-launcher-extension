// サブテーブル編集モーダルの「メイングリッドの選択UIのように振る舞う」機能(3.4.0)のE2E検証。
// 対象: openSubtableEditor内のモーダルローカルな選択状態(editorSelection/editorActiveCell/
// editorEditingCell)・行番号列・キー操作(矢印/Tab/Enter/F2/Esc/Delete/Ctrl+C/V/Ctrl+Enter)。
// メイングリッドのthis.selection等とは完全に独立しているため、モーダルを閉じたあとに
// メイングリッド側の矢印移動が正しく動くこと(キー処理の横取りが残っていないこと)も確認する。
import { openOverlay, cell as mainGridCell } from './helpers/overlay-page.mjs';

const FIELDS = [
  { code: '案件名', label: '案件名', type: 'SINGLE_LINE_TEXT', required: false, choices: [] },
  {
    code: '明細', label: '明細', type: 'SUBTABLE', required: false, choices: [],
    subtable: { fields: [
      { code: '品目', label: '品目', type: 'SINGLE_LINE_TEXT', required: false, choices: [] },
      { code: '数量', label: '数量', type: 'NUMBER', required: false, choices: [] },
      // ルックアップの自動転記先: 常に編集不可(Delete時にスキップされることの確認用)
      { code: '単価', label: '単価', type: 'SINGLE_LINE_TEXT', required: false, choices: [], lookupAuto: true }
    ] }
  }
];

function subtableItem(id, 品目, 数量, 単価) {
  return { id: String(id), value: { 品目: { value: 品目 }, 数量: { value: 数量 }, 単価: { value: 単価 } } };
}

const RECORDS = [
  {
    $id: { value: '301' }, $revision: { value: '1' },
    案件名: { value: '案件A' },
    明細: {
      value: [
        subtableItem('1', 'A', '1', '100'),
        subtableItem('2', 'B', '2', '200'),
        subtableItem('3', 'C', '3', '300'),
        subtableItem('4', 'D', '4', '400')
      ]
    }
  }
];

function buildBridge() {
  return `
const RECORDS = ${JSON.stringify(RECORDS)};
window.addEventListener('message', (ev) => {
  const d = ev.data || {};
  if (!d || d.__kfav__ !== true || !d.id || d.replyTo) return;
  const reply = (extra) => window.postMessage({ __kfav__: true, replyTo: d.id, ...extra }, location.origin);
  const type = d.type;
  if (type === 'EXCEL_GET_APP_CONTEXT') return reply({ ok: true, appId: '12', appName: '受注管理', query: '', timezone: 'Asia/Tokyo' });
  if (type === 'EXCEL_GET_FIELDS_META') return reply({ ok: true, fieldsMeta: ${JSON.stringify(FIELDS)} });
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

// navigator.clipboard を実OSクリップボードやブラウザの許可ダイアログに頼らず検証するための
// 簡易スタブ(writeText/readTextが同じメモリを共有する)。
async function installClipboardStub(page) {
  await page.evaluate(() => {
    let store = '';
    const api = {
      writeText: (text) => { store = String(text); return Promise.resolve(); },
      readText: () => Promise.resolve(store),
      __get: () => store,
      __set: (text) => { store = text; }
    };
    try {
      Object.defineProperty(navigator, 'clipboard', { value: api, configurable: true });
    } catch (_e) {
      navigator.clipboard = api;
    }
  });
}

export async function run({ browser, check }) {
  const name = (n) => `subtable-grid-e2e: ${n}`;
  const { ctx, page } = await openOverlay({ browser, bridgeScript: buildBridge() });
  try {
    check(name('overlay opened'), (await page.locator('#pb-excel-overlay, .pb-overlay').count()) > 0);
    await installClipboardStub(page);

    const subtableRow = (idx) => page.locator('.pb-subtable__body .pb-subtable__row').nth(idx);
    const subtableRowCount = () => page.locator('.pb-subtable__body .pb-subtable__row').count();
    const subtableCellEl = (rowIdx, colIdx) => subtableRow(rowIdx).locator(`.pb-subtable__cell[data-col-index="${colIdx}"]`);
    const subtableControl = (rowIdx, colIdx) => subtableCellEl(rowIdx, colIdx).locator('input, select, button.pb-overlay__subtable-choice-trigger');
    const rownumCell = (rowIdx) => subtableRow(rowIdx).locator('.pb-subtable__rownum');
    const hasClass = async (locator, cls) => Boolean(await locator.evaluate((el, c) => el.classList.contains(c), cls));

    const mainCell = (rowIndex, fieldCode) => mainGridCell(page, rowIndex, fieldCode);

    // ── モーダルを開く ──────────────────────────────────────────
    await mainCell(0, '明細').click();
    await page.waitForTimeout(300);
    check(name('モーダルが開く'), (await page.locator('.pb-overlay__subtable-panel').count()) === 1);
    check(name('4行表示される'), (await subtableRowCount()) === 4);

    // ── (1) 開いた時点で先頭セルがアクティブ(編集中ではない) ──────────
    check(name('(1) 開いた時点で(0,0)がアクティブ'), await hasClass(subtableCellEl(0, 0), 'pb-overlay__subtable-cell--active'));
    check(name('(1) (0,0)は編集中ではない'), !(await hasClass(subtableCellEl(0, 0), 'pb-overlay__subtable-cell--editing')));

    // ── (2) クリックで単一セル選択(activeクラス) ──────────────────
    await subtableCellEl(1, 1).dispatchEvent('mousedown', { button: 0 });
    await page.evaluate(() => document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })));
    await page.waitForTimeout(80);
    check(name('(2) クリックした(1,1)がアクティブになる'), await hasClass(subtableCellEl(1, 1), 'pb-overlay__subtable-cell--active'));
    check(name('(2) 以前アクティブだった(0,0)はアクティブでなくなる'), !(await hasClass(subtableCellEl(0, 0), 'pb-overlay__subtable-cell--active')));

    // ── (3) ドラッグ(mousedown→mouseenter→mouseup)で範囲選択 ──────────
    await subtableCellEl(0, 0).dispatchEvent('mousedown', { button: 0 });
    await subtableCellEl(1, 1).dispatchEvent('mouseenter');
    await page.evaluate(() => document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })));
    await page.waitForTimeout(80);
    check(name('(3) ドラッグ範囲(0,0)-(1,1)の4マスすべてにselectedクラス'),
      (await Promise.all([[0, 0], [0, 1], [1, 0], [1, 1]].map(([r, c]) => hasClass(subtableCellEl(r, c), 'pb-overlay__subtable-cell--selected')))).every(Boolean));
    check(name('(3) 範囲外(2,0)にはselectedクラスがつかない'), !(await hasClass(subtableCellEl(2, 0), 'pb-overlay__subtable-cell--selected')));

    // ── (4) Shift+クリックで範囲拡張 ──────────────────────────────
    await subtableCellEl(0, 0).dispatchEvent('mousedown', { button: 0 });
    await page.evaluate(() => document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })));
    await subtableCellEl(2, 0).dispatchEvent('mousedown', { button: 0, shiftKey: true });
    await page.waitForTimeout(80);
    check(name('(4) Shift+クリックで(0,0)-(2,0)が選択される'),
      (await Promise.all([0, 1, 2].map((r) => hasClass(subtableCellEl(r, 0), 'pb-overlay__subtable-cell--selected')))).every(Boolean));
    check(name('(4) 列1(数量)は選択範囲に含まれない'), !(await hasClass(subtableCellEl(1, 1), 'pb-overlay__subtable-cell--selected')));

    // ── (5) Shift+矢印で範囲拡張 ──────────────────────────────────
    await subtableControl(0, 0).click();
    await page.waitForTimeout(80);
    check(name('(5) クリックで(0,0)が単一選択される'), await hasClass(subtableCellEl(0, 0), 'pb-overlay__subtable-cell--active'));
    await page.keyboard.press('Shift+ArrowDown');
    await page.keyboard.press('Shift+ArrowRight');
    await page.waitForTimeout(80);
    check(name('(5) Shift+矢印で(0,0)-(1,1)の4マスが選択される'),
      (await Promise.all([[0, 0], [0, 1], [1, 0], [1, 1]].map(([r, c]) => hasClass(subtableCellEl(r, c), 'pb-overlay__subtable-cell--selected')))).every(Boolean));
    check(name('(5) Shift+矢印後、アクティブセルは(1,1)に移る'), await hasClass(subtableCellEl(1, 1), 'pb-overlay__subtable-cell--active'));

    // ── (6) Ctrl+C: 選択範囲をTSVでコピー(整形済み表示値) ────────────
    await page.keyboard.press('Control+c');
    await page.waitForTimeout(80);
    const copied = await page.evaluate(() => navigator.clipboard.__get());
    check(name('(6) Ctrl+Cでクリップボードに2行x2列のTSVが入る'), copied === 'A\t1\nB\t2');

    // ── (7) Ctrl+V: 選択範囲の左上を開始位置として貼り付け ───────────
    await subtableControl(0, 0).click();
    await page.waitForTimeout(80);
    await page.evaluate(() => navigator.clipboard.__set('P9\t77'));
    await page.keyboard.press('Control+v');
    await page.waitForTimeout(150);
    check(name('(7) Ctrl+Vで品目(0,0)がP9になる'), (await subtableControl(0, 0).inputValue()) === 'P9');
    check(name('(7) Ctrl+Vで数量(0,1)が77になる'), (await subtableControl(0, 1).inputValue()) === '77');

    // ── (8) Delete: 選択範囲をクリア(編集不可の単価列はスキップされる) ─
    await subtableCellEl(0, 0).dispatchEvent('mousedown', { button: 0 });
    await page.evaluate(() => document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })));
    await subtableCellEl(0, 2).dispatchEvent('mousedown', { button: 0, shiftKey: true });
    await page.waitForTimeout(80);
    await page.keyboard.press('Delete');
    await page.waitForTimeout(150);
    check(name('(8) Deleteで品目(0,0)が空になる'), (await subtableControl(0, 0).inputValue()) === '');
    check(name('(8) Deleteで数量(0,1)が空になる'), (await subtableControl(0, 1).inputValue()) === '');
    check(name('(8) 単価(0,2・編集不可)はDeleteの影響を受けず100のまま'), (await subtableControl(0, 2).inputValue()) === '100');

    // ── (9) 矢印/Tab/Shift+Tab/Enterでの移動 ─────────────────────
    await subtableControl(1, 0).click();
    await page.waitForTimeout(80);
    check(name('(9) クリックで(1,0)がアクティブ'), await hasClass(subtableCellEl(1, 0), 'pb-overlay__subtable-cell--active'));
    await page.keyboard.press('ArrowRight');
    check(name('(9) ArrowRightで(1,1)に移る'), await hasClass(subtableCellEl(1, 1), 'pb-overlay__subtable-cell--active'));
    await page.keyboard.press('ArrowDown');
    check(name('(9) ArrowDownで(2,1)に移る'), await hasClass(subtableCellEl(2, 1), 'pb-overlay__subtable-cell--active'));
    await page.keyboard.press('Tab');
    check(name('(9) Tabで(2,2)に移る(右へ)'), await hasClass(subtableCellEl(2, 2), 'pb-overlay__subtable-cell--active'));
    await page.keyboard.press('Tab');
    check(name('(9) 列末からのTabで次行の先頭(3,0)へ折り返す'), await hasClass(subtableCellEl(3, 0), 'pb-overlay__subtable-cell--active'));
    await page.keyboard.press('Shift+Tab');
    check(name('(9) Shift+Tabで前の行末(2,2)へ戻る'), await hasClass(subtableCellEl(2, 2), 'pb-overlay__subtable-cell--active'));
    await subtableControl(0, 1).click();
    await page.waitForTimeout(80);
    await page.keyboard.press('Enter');
    check(name('(9) 編集中でないEnterで1行下(1,1)へ移る(編集には入らない)'), await hasClass(subtableCellEl(1, 1), 'pb-overlay__subtable-cell--active'));
    check(name('(9) Enter移動後も編集中にはならない'), !(await hasClass(subtableCellEl(1, 1), 'pb-overlay__subtable-cell--editing')));

    // ── (10) F2で編集開始 → Esc で取り消し(モーダルは開いたまま) ──────
    await subtableControl(0, 0).click();
    await page.waitForTimeout(80);
    const beforeF2 = await subtableControl(0, 0).inputValue();
    await page.keyboard.press('F2');
    await page.waitForTimeout(80);
    check(name('(10) F2で編集中クラスがつく'), await hasClass(subtableCellEl(0, 0), 'pb-overlay__subtable-cell--editing'));
    await page.keyboard.press('Control+a');
    await page.keyboard.type('REVERT_ME');
    await page.waitForTimeout(80);
    check(name('(10) 入力後、値が変わっている'), (await subtableControl(0, 0).inputValue()) === 'REVERT_ME');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(100);
    check(name('(10) Escで元の値に戻る'), (await subtableControl(0, 0).inputValue()) === beforeF2);
    check(name('(10) Esc(編集取り消し)後もモーダルは開いたまま'), (await page.locator('.pb-overlay__subtable-panel').count()) === 1);
    check(name('(10) Esc後、編集中クラスは外れる'), !(await hasClass(subtableCellEl(0, 0), 'pb-overlay__subtable-cell--editing')));

    // ── (11) 編集中でないセルでのEscはモーダルを閉じる(Overlay本体は残る) ─
    await subtableControl(0, 0).click();
    await page.waitForTimeout(80);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(150);
    check(name('(11) 編集中でないEscでモーダルが閉じる'), (await page.locator('.pb-overlay__subtable-panel').count()) === 0);
    check(name('(11) Overlay本体は開いたまま'), (await page.locator('#pb-excel-overlay, .pb-overlay').count()) > 0);

    // ── (12) Ctrl+Enter: 編集中の値を選択範囲内の編集可能セルへ一括適用 ──
    await mainCell(0, '明細').click();
    await page.waitForTimeout(300);
    await subtableCellEl(0, 0).dispatchEvent('mousedown', { button: 0 });
    await page.evaluate(() => document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })));
    await subtableCellEl(2, 0).dispatchEvent('mousedown', { button: 0, shiftKey: true });
    await page.waitForTimeout(80);
    check(name('(12) 範囲選択(0,0)-(2,0)ができている'),
      (await Promise.all([0, 1, 2].map((r) => hasClass(subtableCellEl(r, 0), 'pb-overlay__subtable-cell--selected')))).every(Boolean));
    await page.keyboard.press('F2');
    await page.keyboard.press('Control+a');
    await page.keyboard.type('FILLED');
    await page.keyboard.press('Control+Enter');
    await page.waitForTimeout(150);
    check(name('(12) Ctrl+Enterで(0,0)がFILLEDになる'), (await subtableControl(0, 0).inputValue()) === 'FILLED');
    check(name('(12) Ctrl+Enterで(1,0)もFILLEDになる'), (await subtableControl(1, 0).inputValue()) === 'FILLED');
    check(name('(12) Ctrl+Enterで(2,0)もFILLEDになる'), (await subtableControl(2, 0).inputValue()) === 'FILLED');
    check(name('(12) Ctrl+Enter後は編集中ではない'), !(await hasClass(subtableCellEl(0, 0), 'pb-overlay__subtable-cell--editing')));

    // ── (13) IME変換中のEnterは何もしない(isComposing) ───────────────
    await subtableControl(0, 0).click();
    await page.waitForTimeout(80);
    check(name('(13) 前提: (0,0)がアクティブ'), await hasClass(subtableCellEl(0, 0), 'pb-overlay__subtable-cell--active'));
    await subtableControl(0, 0).evaluate((el) => {
      const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
      try { Object.defineProperty(event, 'isComposing', { value: true }); } catch (_e) { /* noop */ }
      el.dispatchEvent(event);
    });
    await page.waitForTimeout(80);
    check(name('(13) IME変換中のEnterでは(0,0)がアクティブなまま(1行下へ移動しない)'), await hasClass(subtableCellEl(0, 0), 'pb-overlay__subtable-cell--active'));
    check(name('(13) (1,0)はアクティブにならない'), !(await hasClass(subtableCellEl(1, 0), 'pb-overlay__subtable-cell--active')));

    // ── (14) 行番号列: クリックで行選択・Shiftで複数行・Deleteで確認→削除 ─
    const rowsBeforeRowDelete = await subtableRowCount();
    await rownumCell(1).dispatchEvent('mousedown', { button: 0 });
    await page.waitForTimeout(80);
    check(name('(14) 行番号クリックで行1全体が選択される(品目列もselected)'), await hasClass(subtableCellEl(1, 0), 'pb-overlay__subtable-cell--selected'));
    await rownumCell(2).dispatchEvent('mousedown', { button: 0, shiftKey: true });
    await page.waitForTimeout(80);
    check(name('(14) Shiftで行1-2の2行が選択される(行2もselected)'), await hasClass(subtableCellEl(2, 1), 'pb-overlay__subtable-cell--selected'));
    check(name('(14) 行0は選択されない'), !(await hasClass(subtableCellEl(0, 0), 'pb-overlay__subtable-cell--selected')));
    const row1ItemBefore = await subtableControl(1, 0).inputValue();
    await page.keyboard.press('Delete');
    await page.waitForTimeout(150);
    check(name('(14) 行削除の確認ダイアログが出る'), (await page.locator('.pb-overlay__confirm-layer').count()) === 1);
    const confirmDialogText = await page.locator('.pb-overlay__confirm-message').textContent();
    check(name('(14) 確認文に選択行数(2)が入る'), /2/.test(confirmDialogText || ''));
    await page.locator('.pb-overlay__confirm-actions button', { hasText: /削除|Delete/ }).click();
    await page.waitForTimeout(200);
    check(name('(14) 確認後、行が2行減る'), (await subtableRowCount()) === rowsBeforeRowDelete - 2);
    check(name('(14) 削除された行の品目(旧row1)はもう存在しない(旧row3が新row1になる)'),
      (await subtableControl(1, 0).inputValue()) !== row1ItemBefore);

    // ── (15) 行の「削除」ボタン(既存機能)は引き続き動く ─────────────
    const rowsBeforeBtnDelete = await subtableRowCount();
    await subtableRow(0).locator('.pb-subtable__remove').click();
    await page.waitForTimeout(150);
    check(name('(15) 行の削除ボタンで1行減る'), (await subtableRowCount()) === rowsBeforeBtnDelete - 1);

    // ── (16) モーダルを閉じたあと、メイングリッド側の矢印移動が正しく動く ─
    await page.locator('.pb-overlay__subtable-close').click();
    await page.waitForTimeout(300);
    check(name('(16) モーダルが閉じている'), (await page.locator('.pb-overlay__subtable-panel').count()) === 0);
    await mainCell(0, '案件名').click();
    await page.waitForTimeout(100);
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(100);
    // メイングリッドのpb-overlay__cell--activeはinput自身ではなくその親要素(セルdiv)につく
    check(name('(16) メイングリッドで矢印移動すると明細セルがactiveになる(キー横取りが残っていない)'),
      Boolean(await mainCell(0, '明細').evaluate((el) => el.parentElement.classList.contains('pb-overlay__cell--active'))));
  } finally {
    await ctx.close();
  }
}
