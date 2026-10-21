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
      { code: '単価', label: '単価', type: 'SINGLE_LINE_TEXT', required: false, choices: [], lookupAuto: true },
      // 3.4.0: 本物のMULTI_LINE_TEXT(列3)。「コピー時は複数行フィールドを元の改行のまま
      // 出す」のサブテーブル側(formatSubtableCellCopyValue/copyEditorSelectionToClipboard)
      // のE2E検証用
      { code: 'メモ', label: 'メモ', type: 'MULTI_LINE_TEXT', required: false, choices: [] }
    ] }
  }
];

function subtableItem(id, 品目, 数量, 単価, メモ = '') {
  return { id: String(id), value: { 品目: { value: 品目 }, 数量: { value: 数量 }, 単価: { value: 単価 }, メモ: { value: メモ } } };
}

const RECORDS = [
  {
    $id: { value: '301' }, $revision: { value: '1' },
    案件名: { value: '案件A' },
    明細: {
      value: [
        subtableItem('1', 'A', '1', '100', '1行目\n2行目'),
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

    // ── (ML1) 本物のMULTI_LINE_TEXT(メモ・列3)のコピーは元の改行のまま出る(3.4.0) ──
    // メモ(modal-edit)セルは.click()すると値モーダル(openFieldValueModal)が開く仕様のため、
    // 選択はクリックではなくmousedown+mouseupの直接dispatchで行う(他の範囲選択チェックと同じ手法)
    await subtableCellEl(0, 3).dispatchEvent('mousedown', { button: 0 });
    await page.evaluate(() => document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })));
    await page.waitForTimeout(80);
    await page.keyboard.press('Control+c');
    await page.waitForTimeout(80);
    const copiedMemo = await page.evaluate(() => navigator.clipboard.__get());
    check(name('(ML1) メモのCtrl+Cは元の改行のままクォートされて出る("1行目\\n2行目")'),
      copiedMemo === '"1行目\n2行目"');
    check(name('(ML1) コピー後も画面表示はプレビュー"1行目 / 2行目"のまま(改行表示には変わらない)'),
      (await subtableControl(0, 3).inputValue()) === '1行目 / 2行目');

    // ── (ML2) 往復: コピーしたメモを別の行(row1)へCtrl+Vで貼り付け ─────────────
    // 貼り付け後の画面表示はプレビューのまま(保存payloadでの改行保持はsubtable-paste-e2e.
    // test.mjsの(5)が同じコード経路(parseClipboardMatrix→setSubtableCellValue→保存)で検証済み)
    await subtableCellEl(1, 3).dispatchEvent('mousedown', { button: 0 });
    await page.evaluate(() => document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })));
    await page.waitForTimeout(80);
    await page.keyboard.press('Control+v');
    await page.waitForTimeout(150);
    check(name('(ML2) 貼り付け先(row1・メモ)の画面表示がプレビュー"1行目 / 2行目"になる'),
      (await subtableControl(1, 3).inputValue()) === '1行目 / 2行目');

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
    // 3.4.0でメモ(列3=MULTI_LINE_TEXT)が追加され列末は列3になったため、列末到達には
    // もう1回Tabが必要になった((2,2)→(2,3))
    await page.keyboard.press('Tab');
    check(name('(9) Tabで(2,3)に移る(列末=メモ列)'), await hasClass(subtableCellEl(2, 3), 'pb-overlay__subtable-cell--active'));
    await page.keyboard.press('Tab');
    check(name('(9) 列末からのTabで次行の先頭(3,0)へ折り返す'), await hasClass(subtableCellEl(3, 0), 'pb-overlay__subtable-cell--active'));
    await page.keyboard.press('Shift+Tab');
    check(name('(9) Shift+Tabで前の行末(2,3)へ戻る'), await hasClass(subtableCellEl(2, 3), 'pb-overlay__subtable-cell--active'));
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

    // ── (17) ダブルクリックで編集開始(メイングリッドの慣習) ───────────
    const beforeDbl = await subtableControl(0, 0).inputValue();
    await subtableCellEl(0, 0).dblclick();
    await page.waitForTimeout(80);
    check(name('(17) ダブルクリックで編集中クラスがつく'), await hasClass(subtableCellEl(0, 0), 'pb-overlay__subtable-cell--editing'));
    check(name('(17) ダブルクリックでreadonly属性が外れ、キャレットが入力できる状態になる'),
      !(await subtableControl(0, 0).evaluate((el) => el.readOnly)));
    await page.keyboard.type('DBL');
    await page.waitForTimeout(80);
    check(name('(17) ダブルクリック編集後にタイプすると値が変わる(全選択置き換え)'), (await subtableControl(0, 0).inputValue()) === 'DBL');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(80);
    check(name('(17) Escで取り消すと元の値に戻る'), (await subtableControl(0, 0).inputValue()) === beforeDbl);

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

  // ================================================================
  // 無料/view-onlyユーザー(Pro未契約): canEditOverlay()がfalseになり、
  // openSubtableEditor内のreadOnlyModeがtrueになる。選択・移動・Ctrl+Cは
  // メイングリッドと同じく動く必要があり、書き込み系(Ctrl+V/Delete/Ctrl+Enter/
  // 行番号からの行削除/F2・ダブルクリック編集/保存)だけが抑止される。
  // ================================================================
  {
    const freeName = (n) => `subtable-grid-e2e[free]: ${n}`;
    // 品目(SINGLE_LINE_TEXT)にタブ文字を直接仕込む(ブリッジ経由でレコードを直接注入するので、
    // 通常の入力UIでは入りにくいタブもテストできる)。Excel貼り付け可能なTSVへ戻すには
    // この手のセルを二重引用符で囲む必要があり、それをCtrl+Cの出力で確認する
    const FREE_FIELDS = [
      { code: '案件名', label: '案件名', type: 'SINGLE_LINE_TEXT', required: false, choices: [] },
      {
        code: '明細', label: '明細', type: 'SUBTABLE', required: false, choices: [],
        subtable: { fields: [
          { code: '品目', label: '品目', type: 'SINGLE_LINE_TEXT', required: false, choices: [] },
          { code: '数量', label: '数量', type: 'NUMBER', required: false, choices: [] }
        ] }
      }
    ];
    const FREE_RECORDS = [
      {
        $id: { value: '301' }, $revision: { value: '1' }, 案件名: { value: '案件A' },
        明細: {
          value: [
            { id: '1', value: { 品目: { value: 'タブ\t入り' }, 数量: { value: '1' } } },
            { id: '2', value: { 品目: { value: 'B' }, 数量: { value: '2' } } }
          ]
        }
      }
    ];
    const buildFreeBridge = () => `
const RECORDS = ${JSON.stringify(FREE_RECORDS)};
window.addEventListener('message', (ev) => {
  const d = ev.data || {};
  if (!d || d.__kfav__ !== true || !d.id || d.replyTo) return;
  const reply = (extra) => window.postMessage({ __kfav__: true, replyTo: d.id, ...extra }, location.origin);
  const type = d.type;
  if (type === 'EXCEL_GET_APP_CONTEXT') return reply({ ok: true, appId: '12', appName: '受注管理', query: '', timezone: 'Asia/Tokyo' });
  if (type === 'EXCEL_GET_FIELDS_META') return reply({ ok: true, fieldsMeta: ${JSON.stringify(FREE_FIELDS)} });
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

    const { ctx: freeCtx, page: freePage } = await openOverlay({ browser, bridgeScript: buildFreeBridge(), pro: false });
    try {
      check(freeName('overlay opened(無料でも閲覧はできる)'), (await freePage.locator('#pb-excel-overlay, .pb-overlay').count()) > 0);
      await installClipboardStub(freePage);

      const fRow = (idx) => freePage.locator('.pb-subtable__body .pb-subtable__row').nth(idx);
      const fCell = (r, c) => fRow(r).locator(`.pb-subtable__cell[data-col-index="${c}"]`);
      const fControl = (r, c) => fCell(r, c).locator('input, select, button.pb-overlay__subtable-choice-trigger');
      const fHasClass = async (locator, cls) => Boolean(await locator.evaluate((el, c) => el.classList.contains(c), cls));

      await mainGridCell(freePage, 0, '明細').click();
      await freePage.waitForTimeout(300);
      check(freeName('(1) 無料ユーザーでもモーダルが開く(view-only)'), (await freePage.locator('.pb-overlay__subtable-panel').count()) === 1);
      check(freeName('(2) 保存ボタンが無効'), await freePage.locator('.pb-overlay__subtable-foot [data-subtable-action="save"]').isDisabled());
      check(freeName('(3) 行追加ボタンが無効'), await freePage.locator('.pb-overlay__subtable-foot [data-subtable-action="add"]').isDisabled());
      check(freeName('(4) 行削除ボタン(既存の行ごと削除)も無効'), await fRow(0).locator('.pb-subtable__remove').isDisabled());

      // ── 選択/移動/Ctrl+Cはview-onlyでも動く ──
      await fCell(0, 0).dispatchEvent('mousedown', { button: 0 });
      await freePage.evaluate(() => document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })));
      await freePage.waitForTimeout(80);
      check(freeName('(5) クリックでセルがアクティブになる(選択は無料でも動く)'), await fHasClass(fCell(0, 0), 'pb-overlay__subtable-cell--active'));
      await fCell(1, 1).dispatchEvent('mousedown', { button: 0, shiftKey: true });
      await freePage.waitForTimeout(80);
      check(freeName('(6) Shift+クリックで範囲選択できる(2x2)'),
        (await Promise.all([[0, 0], [0, 1], [1, 0], [1, 1]].map(([r, c]) => fHasClass(fCell(r, c), 'pb-overlay__subtable-cell--selected')))).every(Boolean));

      await freePage.keyboard.press('Control+c');
      await freePage.waitForTimeout(80);
      const freeCopied = await freePage.evaluate(() => navigator.clipboard.__get());
      // 品目(0,0)="タブ\t入り"はタブを含むのでExcel互換の二重引用符で囲まれる(parseClipboardMatrixの
      // 引用符解釈と対になる、Excelへそのまま貼り付けても列がずれない形式)
      check(freeName('(7) Ctrl+CのTSVはタブを含むセルを二重引用符で囲む(Excel貼り付け可能な形式)'),
        freeCopied === '"タブ\t入り"\t1\nB\t2');

      // ── 書き込み系はすべて無効 ──
      const beforeFreePaste00 = await fControl(0, 0).inputValue();
      await fCell(0, 0).dispatchEvent('mousedown', { button: 0 });
      await freePage.evaluate(() => document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })));
      await freePage.evaluate(() => navigator.clipboard.__set('ZZZ\t999'));
      await freePage.keyboard.press('Control+v');
      await freePage.waitForTimeout(150);
      check(freeName('(8) Ctrl+Vでは値が変わらない'), (await fControl(0, 0).inputValue()) === beforeFreePaste00);

      await freePage.keyboard.press('Delete');
      await freePage.waitForTimeout(150);
      check(freeName('(9) Deleteでは値が変わらない'), (await fControl(0, 0).inputValue()) === beforeFreePaste00);

      await freePage.keyboard.press('Control+Enter');
      await freePage.waitForTimeout(150);
      check(freeName('(10) Ctrl+Enterでは値が変わらない(編集状態にそもそも入れない)'), (await fControl(0, 0).inputValue()) === beforeFreePaste00);

      // F2は編集状態に入らない(そもそも編集中クラスがつかない)
      await freePage.keyboard.press('F2');
      await freePage.waitForTimeout(80);
      check(freeName('(11) F2では編集中にならない'), !(await fHasClass(fCell(0, 0), 'pb-overlay__subtable-cell--editing')));

      // ダブルクリックでも編集状態に入らない
      await fCell(0, 0).dblclick();
      await freePage.waitForTimeout(80);
      check(freeName('(12) ダブルクリックでも編集中にならない(view-onlyでは編集に入れない)'),
        !(await fHasClass(fCell(0, 0), 'pb-overlay__subtable-cell--editing')));
      check(freeName('(12) 入力はreadonlyのまま'), await fControl(0, 0).evaluate((el) => el.readOnly));

      // 行番号からの行選択+Deleteも、確認ダイアログすら出さずに何もしない
      const rowsBeforeFreeDelete = await freePage.locator('.pb-subtable__body .pb-subtable__row').count();
      await fRow(0).locator('.pb-subtable__rownum').dispatchEvent('mousedown', { button: 0 });
      await freePage.waitForTimeout(80);
      await freePage.keyboard.press('Delete');
      await freePage.waitForTimeout(150);
      check(freeName('(13) 行番号列のDeleteでは確認ダイアログも出ず行も減らない'),
        (await freePage.locator('.pb-overlay__confirm-layer').count()) === 0
        && (await freePage.locator('.pb-subtable__body .pb-subtable__row').count()) === rowsBeforeFreeDelete);

      check(freeName('(14) 一連の操作のあとも保存ボタンは無効のまま'),
        await freePage.locator('.pb-overlay__subtable-foot [data-subtable-action="save"]').isDisabled());
    } finally {
      await freeCtx.close();
    }
  }

  // ================================================================
  // 3.4.1: モーダルの見た目をメイングリッド風の罫線グリッドに揃えたこと
  // (非編集セルは文字だけ・編集中だけ枠線/背景が付く)と、フィルハンドルの
  // E2E検証(owner差し戻しで復活。owner指摘のバグ修正を踏まえた新ロジック)。
  // 既存の長いシーケンス(行削除等で行数が変わる)から独立させるため、専用の
  // フィールド/レコードで新しいoverlayセッションを開く。
  // ================================================================
  {
    const lookName = (n) => `subtable-grid-e2e[look/fill]: ${n}`;
    const LOOK_FIELDS = [
      { code: '案件名', label: '案件名', type: 'SINGLE_LINE_TEXT', required: false, choices: [] },
      {
        code: '明細', label: '明細', type: 'SUBTABLE', required: false, choices: [],
        subtable: { fields: [
          { code: '品目', label: '品目', type: 'SINGLE_LINE_TEXT', required: false, choices: [] },
          // ルックアップの自動転記先: 常に編集不可(フィルでスキップされることの確認用)
          { code: '単価', label: '単価', type: 'SINGLE_LINE_TEXT', required: false, choices: [], lookupAuto: true }
        ] }
      }
    ];
    const lookSubtableItem = (id, 品目, 単価) => ({ id: String(id), value: { 品目: { value: 品目 }, 単価: { value: 単価 } } });
    const LOOK_RECORDS = [
      {
        $id: { value: '301' }, $revision: { value: '1' }, 案件名: { value: '案件A' },
        明細: {
          value: [
            lookSubtableItem('1', 'SRC', 'P0'),
            lookSubtableItem('2', 'B1', 'P1'),
            lookSubtableItem('3', 'B2', 'P2'),
            lookSubtableItem('4', 'B3', 'P3'),
            lookSubtableItem('5', 'B4', 'P4')
          ]
        }
      }
    ];
    const buildLookBridge = () => `
const RECORDS = ${JSON.stringify(LOOK_RECORDS)};
window.addEventListener('message', (ev) => {
  const d = ev.data || {};
  if (!d || d.__kfav__ !== true || !d.id || d.replyTo) return;
  const reply = (extra) => window.postMessage({ __kfav__: true, replyTo: d.id, ...extra }, location.origin);
  const type = d.type;
  if (type === 'EXCEL_GET_APP_CONTEXT') return reply({ ok: true, appId: '12', appName: '受注管理', query: '', timezone: 'Asia/Tokyo' });
  if (type === 'EXCEL_GET_FIELDS_META') return reply({ ok: true, fieldsMeta: ${JSON.stringify(LOOK_FIELDS)} });
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

    const { ctx: lookCtx, page: lookPage } = await openOverlay({ browser, bridgeScript: buildLookBridge() });
    try {
      await mainGridCell(lookPage, 0, '明細').click();
      await lookPage.waitForTimeout(300);
      check(lookName('前提: モーダルが開く・5行'), (await lookPage.locator('.pb-overlay__subtable-panel').count()) === 1
        && (await lookPage.locator('.pb-subtable__body .pb-subtable__row').count()) === 5);

      const lRow = (idx) => lookPage.locator('.pb-subtable__body .pb-subtable__row').nth(idx);
      const lCellEl = (r, c) => lRow(r).locator(`.pb-subtable__cell[data-col-index="${c}"]`);
      const lInput = (r, c) => lCellEl(r, c).locator('input');
      const lHasClass = async (locator, cls) => Boolean(await locator.evaluate((el, cl) => el.classList.contains(cl), cls));
      const computedStyle = (locator, prop) => locator.evaluate((el, p) => getComputedStyle(el)[p], prop);

      // ── (look-1) 非編集セル: 入力欄(input)自体はDOMにあるが、枠線/背景は無く
      //            文字だけに見える(角丸input風の見た目が無い) ─────────────
      const bg0 = await computedStyle(lInput(0, 0), 'backgroundColor');
      const borderColor0 = await computedStyle(lInput(0, 0), 'borderColor');
      check(lookName('(look-1) 非編集セルのinputは背景が透明(箱に見えない)'), bg0 === 'rgba(0, 0, 0, 0)');
      check(lookName('(look-1) 非編集セルのinputは枠線も透明'), borderColor0 === 'rgba(0, 0, 0, 0)');
      check(lookName('(look-1) 非編集セルに--editingクラスは付かない'), !(await lHasClass(lInput(0, 0), 'pb-overlay__subtable-input--editing')));

      // ── (look-2) 罫線グリッド: セルに右側/下側の実線境界がある(メイングリッドと同じ) ──
      const cellBorderRight = await computedStyle(lCellEl(0, 0), 'borderRightStyle');
      const cellBorderRightWidth = await computedStyle(lCellEl(0, 0), 'borderRightWidth');
      check(lookName('(look-2) データセルに縦の罫線(border-right: solid)がある'),
        cellBorderRight === 'solid' && cellBorderRightWidth !== '0px');
      const headBorderRight = await computedStyle(lookPage.locator('.pb-subtable__head').first(), 'borderRightStyle');
      check(lookName('(look-2) ヘッダーセルにも縦の罫線がある'), headBorderRight === 'solid');

      // ── (look-3) 編集中は枠線/背景が出る(入力欄として見える)・離れると消える ──
      await lCellEl(0, 0).dblclick();
      await lookPage.waitForTimeout(80);
      check(lookName('(look-3) ダブルクリックで--editingクラスが付く'), await lHasClass(lInput(0, 0), 'pb-overlay__subtable-input--editing'));
      const bgEditing = await computedStyle(lInput(0, 0), 'backgroundColor');
      const borderEditing = await computedStyle(lInput(0, 0), 'borderColor');
      check(lookName('(look-3) 編集中は背景が白になる(箱が見える)'), bgEditing === 'rgb(255, 255, 255)');
      check(lookName('(look-3) 編集中は枠線の色が付く(透明ではない)'), borderEditing !== 'rgba(0, 0, 0, 0)');
      await lookPage.keyboard.press('Escape');
      await lookPage.waitForTimeout(100);
      check(lookName('(look-3) Escで編集を抜けると--editingクラスが外れる'), !(await lHasClass(lInput(0, 0), 'pb-overlay__subtable-input--editing')));
      const bgAfter = await computedStyle(lInput(0, 0), 'backgroundColor');
      check(lookName('(look-3) 編集を抜けると背景もまた透明に戻る'), bgAfter === 'rgba(0, 0, 0, 0)');

      // ── (fill-1) 単一セル選択でフィルハンドルが選択範囲の角に表示される ──────
      const fillHandle = lookPage.locator('.pb-overlay__subtable-panel .pb-overlay__fill-handle');
      await lCellEl(0, 0).dispatchEvent('mousedown', { button: 0 });
      await lookPage.evaluate(() => document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })));
      await lookPage.waitForTimeout(80);
      check(lookName('(fill-1) 選択するとフィルハンドルが表示される'), (await fillHandle.boundingBox()) !== null);

      // ── (fill-2) ハンドルを3行下へドラッグ: プレビュー表示→テキストがコピーされる ──
      const dragHandleTo = async (targetLocator) => {
        const hbox = await fillHandle.boundingBox();
        await lookPage.mouse.move(hbox.x + hbox.width / 2, hbox.y + hbox.height / 2);
        await lookPage.mouse.down();
        const tbox = await targetLocator.boundingBox();
        await lookPage.mouse.move(tbox.x + tbox.width / 2, tbox.y + tbox.height / 2, { steps: 6 });
        await lookPage.waitForTimeout(80);
      };
      await dragHandleTo(lCellEl(3, 0));
      check(lookName('(fill-2) ドラッグ中はプレビュー(fill-previewクラス)が出る'),
        (await Promise.all([1, 2, 3].map((r) => lHasClass(lCellEl(r, 0), 'pb-overlay__subtable-cell--fill-preview')))).every(Boolean));
      await lookPage.mouse.up();
      await lookPage.waitForTimeout(150);
      check(lookName('(fill-2) row1の品目がソース"SRC"になる'), (await lInput(1, 0).inputValue()) === 'SRC');
      check(lookName('(fill-2) row2の品目も"SRC"になる'), (await lInput(2, 0).inputValue()) === 'SRC');
      check(lookName('(fill-2) row3の品目も"SRC"になる'), (await lInput(3, 0).inputValue()) === 'SRC');
      check(lookName('(fill-2) プレビュー範囲外のrow4は変わらない("B4"のまま)'), (await lInput(4, 0).inputValue()) === 'B4');
      check(lookName('(fill-2) フィル後はプレビュークラスが消える'), !(await lHasClass(lCellEl(1, 0), 'pb-overlay__subtable-cell--fill-preview')));

      // ── (fill-3) 編集不可列(単価)を含めて選択しても、その列はフィルされない ──
      await lCellEl(0, 0).dispatchEvent('mousedown', { button: 0 });
      await lookPage.evaluate(() => document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })));
      await lCellEl(0, 1).dispatchEvent('mousedown', { button: 0, shiftKey: true });
      await lookPage.waitForTimeout(80);
      const before単価 = await lInput(1, 1).inputValue();
      const fillHandle2 = lookPage.locator('.pb-overlay__subtable-panel .pb-overlay__fill-handle');
      {
        const hbox = await fillHandle2.boundingBox();
        await lookPage.mouse.move(hbox.x + hbox.width / 2, hbox.y + hbox.height / 2);
        await lookPage.mouse.down();
        const tbox = await lCellEl(1, 1).boundingBox();
        await lookPage.mouse.move(tbox.x + tbox.width / 2, tbox.y + tbox.height / 2, { steps: 6 });
        await lookPage.mouse.up();
      }
      await lookPage.waitForTimeout(150);
      check(lookName('(fill-3) 編集可能列(品目)はフィルされる("SRC")'), (await lInput(1, 0).inputValue()) === 'SRC');
      check(lookName('(fill-3) 編集不可列(単価=ルックアップ自動転記)はフィルされない'), (await lInput(1, 1).inputValue()) === before単価);

      // ── (fill-4) ドラッグ中にEscでキャンセル: 何も書かず、モーダルも閉じない ──
      await lCellEl(2, 0).dispatchEvent('mousedown', { button: 0 });
      await lookPage.evaluate(() => document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })));
      await lookPage.waitForTimeout(80);
      const before4 = await lInput(3, 0).inputValue();
      const fillHandle3 = lookPage.locator('.pb-overlay__subtable-panel .pb-overlay__fill-handle');
      {
        const hbox = await fillHandle3.boundingBox();
        await lookPage.mouse.move(hbox.x + hbox.width / 2, hbox.y + hbox.height / 2);
        await lookPage.mouse.down();
        const tbox = await lCellEl(4, 0).boundingBox();
        await lookPage.mouse.move(tbox.x + tbox.width / 2, tbox.y + tbox.height / 2, { steps: 6 });
      }
      await lookPage.waitForTimeout(80);
      await lookPage.keyboard.press('Escape');
      await lookPage.waitForTimeout(100);
      await lookPage.mouse.up();
      await lookPage.waitForTimeout(100);
      check(lookName('(fill-4) Escでキャンセルすると値は変わらない'), (await lInput(3, 0).inputValue()) === before4);
      check(lookName('(fill-4) Escでキャンセルしてもモーダルは開いたまま'), (await lookPage.locator('.pb-overlay__subtable-panel').count()) === 1);
      check(lookName('(fill-4) プレビュークラスも残らない'), !(await lHasClass(lCellEl(4, 0), 'pb-overlay__subtable-cell--fill-preview')));
    } finally {
      await lookCtx.close();
    }

    // ── (fill-free) 無料/view-onlyではフィルハンドルのドラッグはno-op(値が変わらない) ──
    {
      const { ctx: freeLookCtx, page: freeLookPage } = await openOverlay({ browser, bridgeScript: buildLookBridge(), pro: false });
      try {
        await mainGridCell(freeLookPage, 0, '明細').click();
        await freeLookPage.waitForTimeout(300);
        const fRow2 = (idx) => freeLookPage.locator('.pb-subtable__body .pb-subtable__row').nth(idx);
        const fCellEl2 = (r, c) => fRow2(r).locator(`.pb-subtable__cell[data-col-index="${c}"]`);
        const fInput2 = (r, c) => fCellEl2(r, c).locator('input');
        await fCellEl2(0, 0).dispatchEvent('mousedown', { button: 0 });
        await freeLookPage.evaluate(() => document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })));
        await freeLookPage.waitForTimeout(80);
        const beforeFree = await fInput2(1, 0).inputValue();
        const freeHandle = freeLookPage.locator('.pb-overlay__subtable-panel .pb-overlay__fill-handle');
        const hbox = await freeHandle.boundingBox();
        if (hbox) {
          await freeLookPage.mouse.move(hbox.x + hbox.width / 2, hbox.y + hbox.height / 2);
          await freeLookPage.mouse.down();
          const tbox = await fCellEl2(1, 0).boundingBox();
          await freeLookPage.mouse.move(tbox.x + tbox.width / 2, tbox.y + tbox.height / 2, { steps: 6 });
          await freeLookPage.mouse.up();
          await freeLookPage.waitForTimeout(120);
        }
        check(lookName('(fill-free) 無料/view-onlyではドラッグしても値が変わらない(no-op)'),
          (await fInput2(1, 0).inputValue()) === beforeFree);
      } finally {
        await freeLookCtx.close();
      }
    }
  }
}
