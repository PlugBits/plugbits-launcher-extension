// サブテーブル編集モーダル内専用のUndo/Redo(3.4.0)のE2E検証。
// 対象: openSubtableEditor内のeditorUndoStack/editorRedoStack(メイングリッドの
// this.undoStack/this.redoStackとは完全に別物)・Ctrl+Z/Ctrl+Y/Ctrl+Shift+Z・
// フッターのUndo/Redoボタン・モーダルを開いている間はメイングリッドのUndo/Redoを
// 一切動かさないこと。
import { openOverlay, cell as mainGridCell } from './helpers/overlay-page.mjs';

const FIELDS = [
  { code: '案件名', label: '案件名', type: 'SINGLE_LINE_TEXT', required: false, choices: [] },
  {
    code: '明細', label: '明細', type: 'SUBTABLE', required: false, choices: [],
    subtable: { fields: [
      { code: '品目', label: '品目', type: 'SINGLE_LINE_TEXT', required: false, choices: [] },
      { code: '数量', label: '数量', type: 'NUMBER', required: false, choices: [] }
    ] }
  }
];

function item(id, 品目, 数量) {
  return { id: String(id), value: { 品目: { value: 品目 }, 数量: { value: 数量 } } };
}

function buildRecords() {
  return [
    {
      $id: { value: '301' }, $revision: { value: '1' },
      案件名: { value: '案件A' },
      明細: { value: [item('1', 'A', '1'), item('2', 'B', '2'), item('3', 'C', '3'), item('4', 'D', '4')] }
    }
  ];
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
  const name = (n) => `subtable-undo-e2e: ${n}`;
  const { ctx, page } = await openOverlay({ browser, bridgeScript: buildBridge(FIELDS, buildRecords()) });
  try {
    await installClipboardStub(page);

    const subtableRow = (idx) => page.locator('.pb-subtable__body .pb-subtable__row').nth(idx);
    const subtableRowCount = () => page.locator('.pb-subtable__body .pb-subtable__row').count();
    const subtableCellEl = (rowIdx, colIdx) => subtableRow(rowIdx).locator(`.pb-subtable__cell[data-col-index="${colIdx}"]`);
    const subtableControl = (rowIdx, colIdx) => subtableCellEl(rowIdx, colIdx).locator('input');
    const rownumCell = (rowIdx) => subtableRow(rowIdx).locator('.pb-subtable__rownum');
    const hasClass = async (locator, cls) => Boolean(await locator.evaluate((el, c) => el.classList.contains(c), cls));
    const mainCell = (rowIndex, fieldCode) => mainGridCell(page, rowIndex, fieldCode);
    const undoBtn = () => page.locator('.pb-overlay__subtable-foot [data-subtable-action="undo"]');
    const redoBtn = () => page.locator('.pb-overlay__subtable-foot [data-subtable-action="redo"]');
    const clickCellSelect = async (r, c) => {
      await subtableCellEl(r, c).dispatchEvent('mousedown', { button: 0 });
      await page.evaluate(() => document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })));
    };
    const openModal = async () => {
      await mainCell(0, '明細').click();
      await page.waitForTimeout(300);
    };
    const closeModalViaEscape = async () => {
      await page.keyboard.press('Escape');
      await page.waitForTimeout(150);
    };

    // ================================================================
    // (1) セル編集commit: F2+タイプ+Enterの1操作が1ステップ。Ctrl+Z/Ctrl+Y/
    //     Ctrl+Shift+Zの3通りすべてと、ボタンのenable/disable・クリック動作を確認
    // ================================================================
    await openModal();
    check(name('(1) 前提: Undoボタンは最初disabled'), await undoBtn().isDisabled());
    check(name('(1) 前提: Redoボタンは最初disabled'), await redoBtn().isDisabled());

    await subtableControl(0, 0).click();
    await page.waitForTimeout(80);
    await page.keyboard.press('F2');
    await page.keyboard.press('Control+a');
    await page.keyboard.type('EDITED');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(100);
    check(name('(1) 編集commitで値がEDITEDになる'), (await subtableControl(0, 0).inputValue()) === 'EDITED');
    check(name('(1) commit後、Undoボタンがenabledになる'), !(await undoBtn().isDisabled()));
    check(name('(1) commit後もRedoボタンはdisabledのまま'), await redoBtn().isDisabled());

    await page.keyboard.press('Control+z');
    await page.waitForTimeout(100);
    check(name('(1) Ctrl+Zで元の値Aに戻る'), (await subtableControl(0, 0).inputValue()) === 'A');
    check(name('(1) Undo後、Undoボタンがdisabledになる(ステップを使い切った)'), await undoBtn().isDisabled());
    check(name('(1) Undo後、Redoボタンがenabledになる'), !(await redoBtn().isDisabled()));

    await page.keyboard.press('Control+y');
    await page.waitForTimeout(100);
    check(name('(1) Ctrl+YでEDITEDに戻る(再適用)'), (await subtableControl(0, 0).inputValue()) === 'EDITED');
    check(name('(1) Redo後、Redoボタンはdisabledに戻る'), await redoBtn().isDisabled());
    check(name('(1) Redo後、Undoボタンはenabledに戻る'), !(await undoBtn().isDisabled()));

    // Undoボタンをクリックでも同じ効果(キーボードだけでなくボタン自体も動く)
    await undoBtn().click();
    await page.waitForTimeout(100);
    check(name('(1) Undoボタンのクリックでも元の値Aに戻る'), (await subtableControl(0, 0).inputValue()) === 'A');
    await redoBtn().click();
    await page.waitForTimeout(100);
    check(name('(1) Redoボタンのクリックで再度EDITEDになる'), (await subtableControl(0, 0).inputValue()) === 'EDITED');

    // Ctrl+Shift+Zでもredoできる(別名ショートカット)
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(100);
    check(name('(1) 前提: もう一度Ctrl+Zで戻す'), (await subtableControl(0, 0).inputValue()) === 'A');
    await page.keyboard.press('Control+Shift+z');
    await page.waitForTimeout(100);
    check(name('(1) Ctrl+Shift+ZでもEDITEDに戻る(Redoの別名)'), (await subtableControl(0, 0).inputValue()) === 'EDITED');

    // ── (1b) 新しい操作をするとRedoスタックがクリアされる ──
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(100);
    check(name('(1b) 前提: Undoでまた値がAに戻る'), (await subtableControl(0, 0).inputValue()) === 'A');
    check(name('(1b) 前提: Redoボタンはenabled(EDITEDへ戻せる)'), !(await redoBtn().isDisabled()));

    await subtableControl(1, 0).click();
    await page.waitForTimeout(80);
    await page.keyboard.press('F2');
    await page.keyboard.press('Control+a');
    await page.keyboard.type('NEWOP');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(100);
    check(name('(1b) 新しい操作後、Redoボタンはdisabledになる(スタックがクリアされた)'), await redoBtn().isDisabled());
    await page.keyboard.press('Control+y');
    await page.waitForTimeout(100);
    check(name('(1b) クリア後のCtrl+Yは何もしない((0,0)はAのまま)'), (await subtableControl(0, 0).inputValue()) === 'A');

    await closeModalViaEscape();

    // ================================================================
    // (2) 貼り付け(Ctrl+V): 通常の範囲貼り付けと、行が自動追加されるケースの両方
    // ================================================================
    await openModal();
    await clickCellSelect(0, 0);
    await page.evaluate(() => navigator.clipboard.__set('PX\tPY'));
    await page.keyboard.press('Control+v');
    await page.waitForTimeout(150);
    check(name('(2) Ctrl+Vで(0,0)がPXになる'), (await subtableControl(0, 0).inputValue()) === 'PX');
    check(name('(2) Ctrl+Vで(0,1)がPYになる'), (await subtableControl(0, 1).inputValue()) === 'PY');
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(150);
    check(name('(2) Undoで(0,0)が元のAに戻る'), (await subtableControl(0, 0).inputValue()) === 'A');
    check(name('(2) Undoで(0,1)が元の1に戻る'), (await subtableControl(0, 1).inputValue()) === '1');
    await page.keyboard.press('Control+y');
    await page.waitForTimeout(150);
    check(name('(2) Redoで(0,0)がPXに戻る'), (await subtableControl(0, 0).inputValue()) === 'PX');
    check(name('(2) Redoで(0,1)がPYに戻る'), (await subtableControl(0, 1).inputValue()) === 'PY');

    // 行末を越える貼り付け(自動で行が1行追加される)も、追加された行を含めてUndoで戻る
    const rowsBeforeAutoAdd = await subtableRowCount();
    await clickCellSelect(rowsBeforeAutoAdd - 1, 0);
    await page.evaluate(() => navigator.clipboard.__set('X1\tX2\nY1\tY2'));
    await page.keyboard.press('Control+v');
    await page.waitForTimeout(150);
    check(name('(2b) 貼り付けで行が1行自動追加される'), (await subtableRowCount()) === rowsBeforeAutoAdd + 1);
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(150);
    check(name('(2b) Undoで追加された行も消え、元の行数に戻る'), (await subtableRowCount()) === rowsBeforeAutoAdd);
    check(name('(2b) Undoで最終行の品目も元のDに戻る'), (await subtableControl(rowsBeforeAutoAdd - 1, 0).inputValue()) === 'D');
    await page.keyboard.press('Control+y');
    await page.waitForTimeout(150);
    check(name('(2b) Redoで行が再び1行増える'), (await subtableRowCount()) === rowsBeforeAutoAdd + 1);

    await closeModalViaEscape();

    // ================================================================
    // (3) Delete/Backspaceでの範囲クリア
    // ================================================================
    await openModal();
    await clickCellSelect(0, 0);
    await subtableCellEl(1, 1).dispatchEvent('mousedown', { button: 0, shiftKey: true });
    await page.waitForTimeout(80);
    await page.keyboard.press('Delete');
    await page.waitForTimeout(150);
    check(name('(3) Deleteで(0,0)が空になる'), (await subtableControl(0, 0).inputValue()) === '');
    check(name('(3) Deleteで(1,1)も空になる'), (await subtableControl(1, 1).inputValue()) === '');
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(150);
    check(name('(3) Undoで(0,0)がAに戻る'), (await subtableControl(0, 0).inputValue()) === 'A');
    check(name('(3) Undoで(1,1)が2に戻る'), (await subtableControl(1, 1).inputValue()) === '2');
    await page.keyboard.press('Control+y');
    await page.waitForTimeout(150);
    check(name('(3) Redoで再び(0,0)が空になる'), (await subtableControl(0, 0).inputValue()) === '');
    await closeModalViaEscape();

    // ================================================================
    // (4) Ctrl+Enter: 編集中の値を選択範囲へ一括適用(編集commit+fillの1ステップ)
    // ================================================================
    await openModal();
    await clickCellSelect(0, 0);
    await subtableCellEl(2, 0).dispatchEvent('mousedown', { button: 0, shiftKey: true });
    await page.waitForTimeout(80);
    await page.keyboard.press('F2');
    await page.keyboard.press('Control+a');
    await page.keyboard.type('FILLED');
    await page.keyboard.press('Control+Enter');
    await page.waitForTimeout(150);
    check(name('(4) Ctrl+Enterで(0,0)-(2,0)すべてFILLEDになる'),
      (await Promise.all([0, 1, 2].map((r) => subtableControl(r, 0).inputValue()))).every((v) => v === 'FILLED'));
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(150);
    check(name('(4) Undoで1回でA/B/Cに戻る(編集+fillが1ステップ)'),
      (await Promise.all([0, 1, 2].map((r) => subtableControl(r, 0).inputValue()))).join(',') === 'A,B,C');
    await page.keyboard.press('Control+y');
    await page.waitForTimeout(150);
    check(name('(4) Redoで再び全部FILLEDになる'),
      (await Promise.all([0, 1, 2].map((r) => subtableControl(r, 0).inputValue()))).every((v) => v === 'FILLED'));
    await closeModalViaEscape();

    // ================================================================
    // (5) フィルハンドルのドラッグ
    // ================================================================
    await openModal();
    const fillHandle = page.locator('.pb-overlay__subtable-panel .pb-overlay__fill-handle');
    await clickCellSelect(0, 0);
    {
      const hbox = await fillHandle.boundingBox();
      await page.mouse.move(hbox.x + hbox.width / 2, hbox.y + hbox.height / 2);
      await page.mouse.down();
      const tbox = await subtableCellEl(2, 0).boundingBox();
      await page.mouse.move(tbox.x + tbox.width / 2, tbox.y + tbox.height / 2, { steps: 6 });
      await page.mouse.up();
    }
    await page.waitForTimeout(150);
    check(name('(5) フィルドラッグで(1,0)がAになる'), (await subtableControl(1, 0).inputValue()) === 'A');
    check(name('(5) フィルドラッグで(2,0)もAになる'), (await subtableControl(2, 0).inputValue()) === 'A');
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(150);
    check(name('(5) Undoで(1,0)がBに戻る'), (await subtableControl(1, 0).inputValue()) === 'B');
    check(name('(5) Undoで(2,0)がCに戻る'), (await subtableControl(2, 0).inputValue()) === 'C');
    await page.keyboard.press('Control+y');
    await page.waitForTimeout(150);
    check(name('(5) Redoで再び(1,0)(2,0)がAになる'),
      (await subtableControl(1, 0).inputValue()) === 'A' && (await subtableControl(2, 0).inputValue()) === 'A');
    await closeModalViaEscape();

    // ================================================================
    // (6) 行追加(＋ 行追加ボタン)
    // ================================================================
    await openModal();
    const rowsBeforeAdd = await subtableRowCount();
    await page.locator('[data-subtable-action="add"]').click();
    await page.waitForTimeout(100);
    check(name('(6) 行追加で1行増える'), (await subtableRowCount()) === rowsBeforeAdd + 1);
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(100);
    check(name('(6) Undoで行数が元に戻る'), (await subtableRowCount()) === rowsBeforeAdd);
    await page.keyboard.press('Control+y');
    await page.waitForTimeout(100);
    check(name('(6) Redoで再び1行増える'), (await subtableRowCount()) === rowsBeforeAdd + 1);
    await closeModalViaEscape();

    // ================================================================
    // (7) 行削除(行番号列からのDelete+確認) → Undoでid継続・Saveで正しいpayload
    // ================================================================
    await openModal();
    const rowsBeforeRowDelete = await subtableRowCount();
    await rownumCell(1).dispatchEvent('mousedown', { button: 0 }); // row index1 = id'2'/品目B
    await page.waitForTimeout(80);
    await page.keyboard.press('Delete');
    await page.waitForTimeout(150);
    await page.locator('.pb-overlay__confirm-actions button', { hasText: /削除|Delete/ }).click();
    await page.waitForTimeout(150);
    check(name('(7) 確認後、行が1行減る'), (await subtableRowCount()) === rowsBeforeRowDelete - 1);
    check(name('(7) 削除後、row1の品目はもうBではない'), (await subtableControl(1, 0).inputValue()) !== 'B');

    await page.keyboard.press('Control+z');
    await page.waitForTimeout(150);
    check(name('(7) Undoで行数が元に戻る'), (await subtableRowCount()) === rowsBeforeRowDelete);
    check(name('(7) Undoで削除された行の品目Bが元のindex(1)に戻る'), (await subtableControl(1, 0).inputValue()) === 'B');
    check(name('(7) Undoで削除された行の数量2も戻る'), (await subtableControl(1, 1).inputValue()) === '2');

    // Save後、再度開いても復元された行(id継続・内容そのまま)が残っている(=保存payloadに
    // 誤った削除が入っていない証拠。currentRow.values[field.code]に書き込まれる配列が
    // 実際の保存payloadの元になるため、保存後の再読み込みでそのまま確認できる)
    await page.locator('[data-subtable-action="save"]').click();
    await page.waitForTimeout(200);
    check(name('(7) 保存後モーダルが閉じる'), (await page.locator('.pb-overlay__subtable-panel').count()) === 0);
    await openModal();
    check(name('(7) 保存後に再度開くと行数は元のまま(4行)'), (await subtableRowCount()) === rowsBeforeRowDelete);
    check(name('(7) 保存後に再度開くとrow1の品目はBのまま(誤った削除が保存されていない)'),
      (await subtableControl(1, 0).inputValue()) === 'B');
    check(name('(7) 保存後に再度開くとrow1の数量も2のまま'), (await subtableControl(1, 1).inputValue()) === '2');
    await closeModalViaEscape();

    // ================================================================
    // (8) 行削除(行ごとの削除ボタン)
    // ================================================================
    await openModal();
    const rowsBeforeBtnDelete = await subtableRowCount();
    const row0ItemBefore = await subtableControl(0, 0).inputValue();
    await subtableRow(0).locator('.pb-subtable__remove').click();
    await page.waitForTimeout(150);
    check(name('(8) 削除ボタンで1行減る'), (await subtableRowCount()) === rowsBeforeBtnDelete - 1);
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(150);
    check(name('(8) Undoで行数が元に戻る'), (await subtableRowCount()) === rowsBeforeBtnDelete);
    check(name('(8) Undoで削除された行の内容も元に戻る'), (await subtableControl(0, 0).inputValue()) === row0ItemBefore);
    await closeModalViaEscape();

    // ================================================================
    // (9) セル編集中のCtrl+Zはネイティブ入力に任せ、モーダルUndoは起動しない
    // ================================================================
    await openModal();
    // まず1つ確定済みの操作を積んでおく(モーダルUndoが誤って起動したら検知できるように)
    await subtableControl(0, 0).click();
    await page.waitForTimeout(80);
    await page.keyboard.press('F2');
    await page.keyboard.press('Control+a');
    await page.keyboard.type('KNOWN');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(100);
    check(name('(9) 前提: (0,0)がKNOWNになっている'), (await subtableControl(0, 0).inputValue()) === 'KNOWN');
    check(name('(9) 前提: Undoボタンがenabled(1ステップ積まれている)'), !(await undoBtn().isDisabled()));

    // 別のセル(1,0)を編集中にCtrl+Zを押す→モーダルUndoが起動していれば(0,0)のKNOWNが
    // 巻き戻ってしまうはずだが、起動しないので(0,0)はKNOWNのまま
    await subtableControl(1, 0).click();
    await page.waitForTimeout(80);
    await page.keyboard.press('F2');
    await page.waitForTimeout(80);
    check(name('(9) 前提: (1,0)が編集中になる'), await hasClass(subtableCellEl(1, 0), 'pb-overlay__subtable-cell--editing'));
    await page.keyboard.type('DRAFT');
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(150);
    check(name('(9) 編集中にCtrl+Zを押しても(0,0)のKNOWNは巻き戻らない(モーダルUndoが起動していない)'),
      (await subtableControl(0, 0).inputValue()) === 'KNOWN');
    check(name('(9) 編集中にCtrl+Zを押してもUndoボタンのenabled状態は変わらない(スタックが減っていない)'),
      !(await undoBtn().isDisabled()));
    // 編集状態を抜ける(Escで取り消し、モーダルは開いたまま)
    await page.keyboard.press('Escape');
    await page.waitForTimeout(100);
    check(name('(9) Escで(1,0)の編集を抜けてもモーダルは開いたまま'), (await page.locator('.pb-overlay__subtable-panel').count()) === 1);

    // ================================================================
    // (10) IME変換中(isComposing)のCtrl+Zは無視される
    // ================================================================
    await subtableControl(0, 0).evaluate((el) => {
      const event = new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true });
      try { Object.defineProperty(event, 'isComposing', { value: true }); } catch (_e) { /* noop */ }
      el.dispatchEvent(event);
    });
    await page.waitForTimeout(100);
    check(name('(10) IME変換中のCtrl+Zは無視され、(0,0)はKNOWNのまま'), (await subtableControl(0, 0).inputValue()) === 'KNOWN');
    check(name('(10) IME変換中のCtrl+Zは無視され、Undoボタンもenabledのまま'), !(await undoBtn().isDisabled()));

    await closeModalViaEscape();

    // ================================================================
    // (11) モーダルを開いている間、メイングリッド本体のUndo/Redoスタックには
    //      一切触れない(モーダルを閉じた後もメイングリッドのUndoは正しく動く)
    // ================================================================
    await mainCell(0, '案件名').click();
    await page.waitForTimeout(80);
    await page.keyboard.press('F2');
    await page.keyboard.press('Control+a');
    await page.keyboard.type('MAINEDIT');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(100);
    check(name('(11) 前提: メイングリッドの案件名がMAINEDITになる'), (await mainCell(0, '案件名').inputValue()) === 'MAINEDIT');

    await openModal();
    // モーダル内で何回かCtrl+Z/Ctrl+Yを押す(スタックが空でもno-op・何か操作してからでも)
    await page.keyboard.press('Control+z');
    await page.keyboard.press('Control+z');
    await subtableControl(0, 0).click();
    await page.keyboard.press('F2');
    await page.keyboard.press('Control+a');
    await page.keyboard.type('TEMP');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Control+z');
    await page.keyboard.press('Control+y');
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(100);
    // キャンセルで閉じる(保存しない)
    await page.locator('[data-subtable-action="cancel"]').click();
    await page.waitForTimeout(200);
    check(name('(11) キャンセルでモーダルが閉じる'), (await page.locator('.pb-overlay__subtable-panel').count()) === 0);

    await mainCell(0, '案件名').click();
    await page.waitForTimeout(80);
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(100);
    check(name('(11) モーダルを閉じた後、メイングリッドのCtrl+Zで案件名が元の案件Aに戻る(モーダルのCtrl+Zで本体のスタックが壊れていない)'),
      (await mainCell(0, '案件名').inputValue()) === '案件A');
  } finally {
    await ctx.close();
  }

  // ================================================================
  // (12) 無料/view-onlyモード: 書き込み系はno-opなのでUndoステップは一切積まれない
  // ================================================================
  {
    const freeName = (n) => `subtable-undo-e2e[free]: ${n}`;
    const { ctx: freeCtx, page: freePage } = await openOverlay({
      browser, bridgeScript: buildBridge(FIELDS, buildRecords()), pro: false
    });
    try {
      await installClipboardStub(freePage);
      const fRow = (idx) => freePage.locator('.pb-subtable__body .pb-subtable__row').nth(idx);
      const fCell = (r, c) => fRow(r).locator(`.pb-subtable__cell[data-col-index="${c}"]`);
      const fControl = (r, c) => fCell(r, c).locator('input');
      const fUndoBtn = () => freePage.locator('.pb-overlay__subtable-foot [data-subtable-action="undo"]');

      await mainGridCell(freePage, 0, '明細').click();
      await freePage.waitForTimeout(300);
      check(freeName('(1) 無料ユーザーでもモーダルが開く'), (await freePage.locator('.pb-overlay__subtable-panel').count()) === 1);
      check(freeName('(2) Undoボタンは最初からdisabled'), await fUndoBtn().isDisabled());

      const before = await fControl(0, 0).inputValue();
      await fCell(0, 0).dispatchEvent('mousedown', { button: 0 });
      await freePage.evaluate(() => document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })));
      await freePage.evaluate(() => navigator.clipboard.__set('ZZZ\t999'));
      await freePage.keyboard.press('Control+v');
      await freePage.waitForTimeout(150);
      check(freeName('(3) 無料モードのCtrl+Vはno-op(値が変わらない)'), (await fControl(0, 0).inputValue()) === before);
      check(freeName('(4) no-opの貼り付けはUndoステップを積まない(Undoボタンは依然disabled)'), await fUndoBtn().isDisabled());

      await freePage.keyboard.press('Control+z');
      await freePage.waitForTimeout(100);
      check(freeName('(5) 積まれていないのでCtrl+Zも何も起こさない'), (await fControl(0, 0).inputValue()) === before);
    } finally {
      await freeCtx.close();
    }
  }
}
