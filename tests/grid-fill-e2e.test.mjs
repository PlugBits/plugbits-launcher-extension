// メイングリッド(一覧)のフィルハンドルのE2E検証(3.4.1・owner指摘で修正)。
//
// 修正前の2つのバグ:
// (1) commitFillDragがapplyPastedMatrixAt(「選択範囲がソースの整数倍のときだけタイル
//     展開する」貼り付け専用ロジック)を流用していたため、倍数でない範囲へドラッグすると
//     書き過ぎ/書き漏らしが起きる(例: 5行ソースを7行分ドラッグしてもソース行数=5行しか
//     書かない・5行ソースを3行分ドラッグするとソース行数=5行分書いてプレビュー外の2行まで
//     上書きする)。
// (2) buildFillMatrixがformatCellDisplayValue(画面表示用の整形)経由で値を複製していたため、
//     複数行テキストの改行が" / "結合に、CHECK_BOX/MULTI_SELECTの配列が", "結合文字列に
//     なってから再分割され、カンマを含む選択肢がちぎれる等の破損があった。
//
// 修正後はcomputeFillRowMapping(メイングリッド・サブテーブル編集モーダル共通の静的
// ヘルパー)でプレビュー範囲ぴったりの対応表を作り、生の値(deepClone(row.values[code]))を
// そのまま複製する。本ファイルはこの新ロジックの直接確認。
import { openOverlay, cell as mainCell } from './helpers/overlay-page.mjs';

function buildBridge(fields, records) {
  return `
window.__putCalls = [];
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
  if (type === 'EXCEL_PUT_RECORDS') {
    const records = Array.isArray(d.payload?.records) ? d.payload.records : [];
    window.__putCalls.push({ records, __pbTrigger: d.payload?.__pbTrigger });
    return reply({ ok: true, result: { records: records.map(() => ({ revision: '2' })) } });
  }
  if (type === 'EXCEL_GET_LOGIN_USER') return reply({ ok: true, user: { timezone: 'Asia/Tokyo' } });
  if (type === 'GET_APP_NAME') return reply({ ok: true, name: '受注管理' });
  if (type === 'EXCEL_GET_APP_ACL' || type === 'EXCEL_GET_RECORD_ACL' || type === 'EXCEL_GET_FIELD_ACL' || type === 'EXCEL_GET_VIEWS') return reply({ ok: true, result: {} });
  reply({ ok: false });
});`;
}

// mousedown(開始セル)→mouseenter(終了セル)→documentへmouseup、でドラッグ範囲選択する
// (grid-copy-tsv-e2e.test.mjsと同じ方式。MULTI_LINE_TEXT/DROP_DOWN等のセルは.click()だと
// 編集モーダル/ピッカーが開いてしまうため、選択だけしたい場合はこちらを使う)
async function dragSelect(page, startLocator, endLocator) {
  await startLocator.dispatchEvent('mousedown', { button: 0 });
  await endLocator.dispatchEvent('mouseenter');
  await page.evaluate(() => document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })));
  await page.waitForTimeout(80);
}

// フィルハンドル(選択範囲の右下に付く.pb-overlay__fill-handle)をmousedownし、
// targetLocatorの中心までmousemoveする(mouseupはまだ呼ばない=Escキャンセル用に途中で使う)
async function startFillDrag(page, targetLocator) {
  const handle = page.locator('.pb-overlay__fill-handle');
  const hbox = await handle.boundingBox();
  if (!hbox) throw new Error('fill handle not found (not shown for current selection?)');
  await page.mouse.move(hbox.x + hbox.width / 2, hbox.y + hbox.height / 2);
  await page.mouse.down();
  const tbox = await targetLocator.boundingBox();
  await page.mouse.move(tbox.x + tbox.width / 2, tbox.y + tbox.height / 2, { steps: 6 });
  await page.waitForTimeout(60);
}

async function dragFillTo(page, targetLocator) {
  await startFillDrag(page, targetLocator);
  await page.mouse.up();
  await page.waitForTimeout(150);
}

function numRecords(count) {
  return Array.from({ length: count }, (_, i) => ({
    $id: { value: String(i + 1) }, $revision: { value: '1' },
    N: { value: String(i) }
  }));
}

const N_FIELDS = [
  { code: 'N', label: 'N', type: 'NUMBER', required: false, choices: [] }
];

export async function run({ browser, check }) {
  const name = (n) => `grid-fill-e2e: ${n}`;

  // ── (1) 1セルのソースを3行下へドラッグ(最小ケース) ──────────────────
  {
    const { ctx, page } = await openOverlay({ browser, bridgeScript: buildBridge(N_FIELDS, numRecords(6)) });
    try {
      const c = (r) => mainCell(page, r, 'N');
      await dragSelect(page, c(0), c(0));
      await dragFillTo(page, c(3));
      check(name('(1) row1がソース値"0"になる'), (await c(1).inputValue()) === '0');
      check(name('(1) row2もソース値"0"になる'), (await c(2).inputValue()) === '0');
      check(name('(1) row3もソース値"0"になる'), (await c(3).inputValue()) === '0');
      check(name('(1) プレビュー範囲外のrow4は変わらない'), (await c(4).inputValue()) === '4');
    } finally { await ctx.close(); }
  }

  // ── (2) 5行ソースを5行下へ(ソース行数の整数倍。従来から動いていた正常系の回帰確認) ──
  {
    const { ctx, page } = await openOverlay({ browser, bridgeScript: buildBridge(N_FIELDS, numRecords(11)) });
    try {
      const c = (r) => mainCell(page, r, 'N');
      await dragSelect(page, c(0), c(4));
      await dragFillTo(page, c(9));
      for (let i = 5; i <= 9; i += 1) {
        check(name(`(2) row${i}がrow${i - 5}の値を複製する`), (await c(i).inputValue()) === String(i - 5));
      }
      check(name('(2) プレビュー範囲外のrow10は変わらない'), (await c(10).inputValue()) === '10');
    } finally { await ctx.close(); }
  }

  // ── (3) 5行ソースを7行下へ(非整数倍・多い方。旧実装はソース行数=5行しか書かず
  //        プレビュー末尾のrow10,11が変わらないバグがあった) ────────────────
  {
    const { ctx, page } = await openOverlay({ browser, bridgeScript: buildBridge(N_FIELDS, numRecords(13)) });
    try {
      const c = (r) => mainCell(page, r, 'N');
      await dragSelect(page, c(0), c(4));
      await dragFillTo(page, c(11));
      const expected = ['0', '1', '2', '3', '4', '0', '1']; // row5..11(5行周期で繰り返す)
      for (let i = 0; i < expected.length; i += 1) {
        check(name(`(3) row${5 + i}が周期的に埋まる(期待"${expected[i]}")`), (await c(5 + i).inputValue()) === expected[i]);
      }
      check(name('(3) プレビュー範囲外のrow12は変わらない'), (await c(12).inputValue()) === '12');
    } finally { await ctx.close(); }
  }

  // ── (4) 5行ソースを3行下へ(非整数倍・少ない方。旧実装はソース行数=5行分書いてしまい
  //        プレビュー外のrow8まで上書きするバグがあった) ────────────────────
  {
    const { ctx, page } = await openOverlay({ browser, bridgeScript: buildBridge(N_FIELDS, numRecords(9)) });
    try {
      const c = (r) => mainCell(page, r, 'N');
      await dragSelect(page, c(0), c(4));
      await dragFillTo(page, c(7));
      check(name('(4) row5はsrc row0の値"0"'), (await c(5).inputValue()) === '0');
      check(name('(4) row6はsrc row1の値"1"'), (await c(6).inputValue()) === '1');
      check(name('(4) row7はsrc row2の値"2"'), (await c(7).inputValue()) === '2');
      check(name('(4) プレビュー範囲外のrow8は変わらない(旧実装はここまで上書きしていた)'), (await c(8).inputValue()) === '8');
    } finally { await ctx.close(); }
  }

  // ── (5) 5行ソースを3行分「上」へドラッグ(Excelの連続順: ソースに隣接する行が
  //        ソース最終行を受け取り、離れるほど手前の行になる) ─────────────────
  {
    const { ctx, page } = await openOverlay({ browser, bridgeScript: buildBridge(N_FIELDS, numRecords(10)) });
    try {
      const c = (r) => mainCell(page, r, 'N');
      await dragSelect(page, c(5), c(9));
      await dragFillTo(page, c(2));
      check(name('(5) row4(ソースに隣接)はソース最終行row9="9"'), (await c(4).inputValue()) === '9');
      check(name('(5) row3はソース最終から2番目row8="8"'), (await c(3).inputValue()) === '8');
      check(name('(5) row2はソース最終から3番目row7="7"'), (await c(2).inputValue()) === '7');
      check(name('(5) プレビュー範囲外のrow1は変わらない'), (await c(1).inputValue()) === '1');
    } finally { await ctx.close(); }
  }

  // ── (6) 5行ソースを7行分「上」へドラッグ(非整数倍でも同じExcel順で周期的に) ──
  {
    const { ctx, page } = await openOverlay({ browser, bridgeScript: buildBridge(N_FIELDS, numRecords(12)) });
    try {
      const c = (r) => mainCell(page, r, 'N');
      await dragSelect(page, c(7), c(11));
      await dragFillTo(page, c(0));
      const expected = ['10', '11', '7', '8', '9', '10', '11']; // row0..6
      for (let i = 0; i < expected.length; i += 1) {
        check(name(`(6) row${i}が周期的に埋まる(期待"${expected[i]}")`), (await c(i).inputValue()) === expected[i]);
      }
      check(name('(6) ソース行(row7..11)自体は変わらない'),
        (await c(7).inputValue()) === '7' && (await c(11).inputValue()) === '11');
    } finally { await ctx.close(); }
  }

  // ── (7) DROP_DOWNのラベル・複数行テキストの改行・カンマを含むCHECK_BOXの配列が、
  //        表示整形(" / "結合・", "結合→再分割)を経由せず生の値のまま複製される ──
  {
    const fields = [
      { code: '優先度', label: '優先度', type: 'DROP_DOWN', required: false, choices: ['高', '中', '低'] },
      { code: 'タグ', label: 'タグ', type: 'CHECK_BOX', required: false, choices: ['A, Inc.', 'B', 'C'] },
      { code: '備考', label: '備考', type: 'MULTI_LINE_TEXT', required: false, choices: [] }
    ];
    const records = [
      { $id: { value: '1' }, $revision: { value: '1' }, 優先度: { value: '高' }, タグ: { value: ['A, Inc.'] }, 備考: { value: 'line1\nline2' } },
      { $id: { value: '2' }, $revision: { value: '1' }, 優先度: { value: '' }, タグ: { value: [] }, 備考: { value: '' } }
    ];
    const { ctx, page } = await openOverlay({ browser, bridgeScript: buildBridge(fields, records) });
    try {
      const c = (r, code) => mainCell(page, r, code);
      await dragSelect(page, c(0, '優先度'), c(0, '備考'));
      await dragFillTo(page, c(1, '備考'));
      check(name('(7) DROP_DOWNのラベルがそのまま複製される'), (await c(1, '優先度').inputValue()) === '高');
      check(name('(7) 備考の画面表示はプレビュー"line1 / line2"になる'), (await c(1, '備考').inputValue()) === 'line1 / line2');

      await page.evaluate(() => { window.__putCalls.length = 0; });
      const saveBtn = page.locator('.pb-overlay__btn--primary', { hasText: /保存|Save/ });
      await saveBtn.click();
      await page.waitForTimeout(300);
      const putCalls = await page.evaluate(() => window.__putCalls);
      const saved = putCalls[0]?.records?.find((r) => String(r.id) === '2');
      check(name('(7) 保存payloadの備考は実改行のまま("line1\\nline2")'), saved?.record?.備考?.value === 'line1\nline2');
      check(name('(7) 保存payloadのタグは配列のまま・カンマを含む選択肢も分割されない(["A, Inc."])'),
        JSON.stringify(saved?.record?.タグ?.value) === JSON.stringify(['A, Inc.']));
      check(name('(7) 保存payloadの優先度は"高"のまま'), saved?.record?.優先度?.value === '高');
    } finally { await ctx.close(); }
  }

  // ── (8) 編集不可列(ルックアップの自動転記先)はフィル範囲に含めてもスキップされる ──
  {
    const fields = [
      { code: '備考', label: '備考', type: 'SINGLE_LINE_TEXT', required: false, choices: [] },
      { code: '単価', label: '単価', type: 'SINGLE_LINE_TEXT', required: false, choices: [], lookupAuto: true }
    ];
    const records = [
      { $id: { value: '1' }, $revision: { value: '1' }, 備考: { value: 'SRC' }, 単価: { value: '9000' } },
      { $id: { value: '2' }, $revision: { value: '1' }, 備考: { value: '' }, 単価: { value: '9001' } }
    ];
    const { ctx, page } = await openOverlay({ browser, bridgeScript: buildBridge(fields, records) });
    try {
      const c = (r, code) => mainCell(page, r, code);
      await dragSelect(page, c(0, '備考'), c(0, '単価'));
      await dragFillTo(page, c(1, '単価'));
      check(name('(8) 編集可能列(備考)はフィルされる("SRC")'), (await c(1, '備考').inputValue()) === 'SRC');
      check(name('(8) 編集不可列(単価=ルックアップ自動転記)はフィルされない(9001のまま)'), (await c(1, '単価').inputValue()) === '9001');
    } finally { await ctx.close(); }
  }

  // ── (9) ドラッグ中のEscでキャンセルする(何も書かず、オーバーレイも閉じない) ──
  {
    const { ctx, page } = await openOverlay({ browser, bridgeScript: buildBridge(N_FIELDS, numRecords(4)) });
    try {
      const c = (r) => mainCell(page, r, 'N');
      await dragSelect(page, c(0), c(0));
      await startFillDrag(page, c(2));
      await page.keyboard.press('Escape');
      await page.waitForTimeout(100);
      await page.mouse.up();
      await page.waitForTimeout(100);
      check(name('(9) Escでキャンセルするとrow1は変わらない("1"のまま)'), (await c(1).inputValue()) === '1');
      check(name('(9) row2も変わらない("2"のまま)'), (await c(2).inputValue()) === '2');
      check(name('(9) オーバーレイは閉じない'), (await page.locator('#pb-excel-overlay, .pb-overlay').count()) > 0);
    } finally { await ctx.close(); }
  }

  // ── (10) フィルで埋めた複数セルをUndo1回でまとめて戻す ───────────────
  {
    const { ctx, page } = await openOverlay({ browser, bridgeScript: buildBridge(N_FIELDS, numRecords(5)) });
    try {
      const c = (r) => mainCell(page, r, 'N');
      await dragSelect(page, c(0), c(0));
      await dragFillTo(page, c(3));
      check(name('(10) フィル直後: row1,2,3が"0"になる'),
        (await c(1).inputValue()) === '0' && (await c(2).inputValue()) === '0' && (await c(3).inputValue()) === '0');
      const undoBtn = page.locator('.pb-overlay__btn', { hasText: /Undo/ });
      await undoBtn.click();
      await page.waitForTimeout(150);
      check(name('(10) Undo1回でrow1が元の"1"に戻る'), (await c(1).inputValue()) === '1');
      check(name('(10) 同じUndo1回でrow2も元の"2"に戻る'), (await c(2).inputValue()) === '2');
      check(name('(10) 同じUndo1回でrow3も元の"3"に戻る'), (await c(3).inputValue()) === '3');
    } finally { await ctx.close(); }
  }
}
