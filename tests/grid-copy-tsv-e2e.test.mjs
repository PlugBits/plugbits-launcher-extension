// 3.4.0: メイングリッド(一覧)のCtrl+Cが「サブテーブル編集モーダルと同じExcel互換のTSV」
// (ExcelOverlayController.matrixToTsv。改行・タブ・" を含むセルは "…" で囲み、内部の"は""へ
// エスケープする)を出すようになったことのE2E検証。detail-form(フォームレイアウト)側の
// getFormClipboardLinesFromSelection は今回意図的に変更していないため対象外。
//
// フィールド設計上の注意: MULTI_LINE_TEXT は一覧セルではformatCellDisplayValue→
// formatMultiLinePreview() を経由し、改行は' / '結合へ潰されてから表示される(一覧プレビュー
// 専用の仕様で、matrixToTsvの改行クォート対象にはそもそも載らない)。改行入りセルでの
// Excel互換クォートを確認するには、subtable-grid-e2e.test.mjsの無料セクションが
// タブ文字をSINGLE_LINE_TEXTへ直接仕込んだのと同じ手法で、ブリッジ経由のレコード注入で
// SINGLE_LINE_TEXTへ直接改行を仕込む(通常のkintone入力UIでは作れない値だが、実データで
// 起こり得る形)。
import { openOverlay, cell as mainCell } from './helpers/overlay-page.mjs';
import { extractMethodAsFunction } from './helpers/extract-src.mjs';
import { checkEqual } from './helpers/assert.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const srcDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');
const contentJsSrc = fs.readFileSync(path.join(srcDir, 'content.js'), 'utf8');

// 列順: 案件名(0・プレーン/row1は"を含む) / 備考(1・row0は改行を含む) / 数量(2・NUMBER/プレーン) /
// 担当(3・プレーン)。チェック1は列0-2(2x3)、チェック2は列2-3(プレーンのみの2x2)、
// チェック3は列0単体(改行なしのクォート往復)で使う
const FIELDS = [
  { code: '案件名', label: '案件名', type: 'SINGLE_LINE_TEXT', required: false, choices: [] },
  { code: '備考', label: '備考', type: 'SINGLE_LINE_TEXT', required: false, choices: [] },
  { code: '数量', label: '数量', type: 'NUMBER', required: false, choices: [] },
  { code: '担当', label: '担当', type: 'SINGLE_LINE_TEXT', required: false, choices: [] }
];

const RECORDS = [
  { $id: { value: '301' }, $revision: { value: '1' }, 案件名: { value: '案件A' }, 備考: { value: '1行目\n2行目' }, 数量: { value: '10' }, 担当: { value: '田中' } },
  { $id: { value: '302' }, $revision: { value: '1' }, 案件名: { value: '5" パイプ' }, 備考: { value: 'メモB' }, 数量: { value: '20' }, 担当: { value: '鈴木' } },
  // 貼り付け先(空の行)
  { $id: { value: '303' }, $revision: { value: '1' }, 案件名: { value: '' }, 備考: { value: '' }, 数量: { value: '' }, 担当: { value: '' } },
  { $id: { value: '304' }, $revision: { value: '1' }, 案件名: { value: '' }, 備考: { value: '' }, 数量: { value: '' }, 担当: { value: '' } }
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
// 簡易スタブ(writeText/readTextが同じメモリを共有する)。subtable-grid-e2e.test.mjsと同じ方式
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

// mousedown(開始セル) → mouseenter(終了セル) → documentへmouseup、でドラッグ範囲選択する。
// 主グリッドのセル選択はinput要素自身にmousedown/mouseenterリスナが付いている
// (handleCellMouseDown/handleCellHover)ため、サブテーブルのセルdivドラッグと同じ手順で動く
async function dragSelect(page, startLocator, endLocator) {
  await startLocator.dispatchEvent('mousedown', { button: 0 });
  await endLocator.dispatchEvent('mouseenter');
  await page.evaluate(() => document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })));
  await page.waitForTimeout(80);
}

export async function run({ browser, check }) {
  const name = (n) => `grid-copy-tsv-e2e: ${n}`;
  const eq = (n, actual, expected) => checkEqual(check, name(n), actual, expected);

  const parseClipboardMatrix = extractMethodAsFunction(
    contentJsSrc,
    'parseClipboardMatrix\\(text\\)',
    'parseClipboardMatrix',
    'text'
  );

  const bridgeScript = buildBridge();
  const { ctx, page } = await openOverlay({ browser, bridgeScript });
  let copiedCheck1 = '';
  try {
    check(name('overlay opened'), (await page.locator('#pb-excel-overlay, .pb-overlay').count()) > 0);
    await installClipboardStub(page);

    const c = (rowIndex, fieldCode) => mainCell(page, rowIndex, fieldCode);

    // ── (1) 2行x3列(案件名/備考/数量)の範囲選択 → Ctrl+C でExcel互換TSVになる ──────
    await dragSelect(page, c(0, '案件名'), c(1, '数量'));
    await page.keyboard.press('Control+c');
    await page.waitForTimeout(80);
    copiedCheck1 = await page.evaluate(() => navigator.clipboard.__get());
    const expected1 = '案件A\t"1行目\n2行目"\t10\n"5"" パイプ"\tメモB\t20';
    check(name('(1) 改行セル(備考row0)は"…"で囲まれる・"セル(案件名row1)は""でエスケープされる・プレーンセルと数値は無囲み'),
      copiedCheck1 === expected1);

    // ── (2) 2行x2列(数量/担当)はどちらもプレーンなので引用符が一切つかない(従来どおり) ──
    await dragSelect(page, c(0, '数量'), c(1, '担当'));
    await page.keyboard.press('Control+c');
    await page.waitForTimeout(80);
    const copiedCheck2 = await page.evaluate(() => navigator.clipboard.__get());
    check(name('(2) プレーンセルのみの範囲は引用符なし(従来の単純TSVと同じ見た目)'),
      copiedCheck2 === '10\t田中\n20\t鈴木');

    // ── (3a) 往復: "セルを含む列(案件名)をコピー→別の空行へCtrl+Vで貼り付け→元の値と一致 ──
    // (3b)で改行セルの往復も確認するが、こちらはDOM上の<input type="text">へ直接
    // .value を代入する実装(applyPastedValue)がブラウザの仕様で改行を取り除いてしまうため
    // (HTML仕様のvalue sanitization algorithm。単一行<input>は生の\nを保持できない。実機で
    // 確認済み: el.value = 'a\nb' → el.value は 'ab' になる)、DOM往復では検証しない。
    // "の往復はこの制約を受けないため、実際のCtrl+C/Ctrl+Vで検証する
    await dragSelect(page, c(0, '案件名'), c(1, '案件名'));
    await page.keyboard.press('Control+c');
    await page.waitForTimeout(80);
    const copiedCheck3a = await page.evaluate(() => navigator.clipboard.__get());
    check(name('(3a) "セルを含む単列コピーのTSVも期待どおり(5" パイプ→"5"" パイプ"にエスケープ)'),
      copiedCheck3a === '案件A\n"5"" パイプ"');

    await c(2, '案件名').click();
    await page.waitForTimeout(80);
    await page.keyboard.press('Control+v');
    await page.waitForTimeout(150);
    check(name('(3a) 貼り付け先1行目(row2・案件名)が元のプレーン値"案件A"になる'),
      (await c(2, '案件名').inputValue()) === '案件A');
    check(name('(3a) 貼り付け先2行目(row3・案件名)が元の"入り値"5\\" パイプ"になる(クォート往復が一致)'),
      (await c(3, '案件名').inputValue()) === '5" パイプ');

    // ── (3b) 改行セルの往復はmatrixToTsv→parseClipboardMatrixの関数レベルで確認する ──
    // copiedCheck1(実際にCtrl+Cで出力された文字列。備考row0="1行目\n2行目"が"…"で
    // 囲まれて入っている)をparseClipboardMatrixへそのまま渡し、元の行列(改行・"エスケープとも
    // 復元される)に戻ることを確認する。matrixToTsvとparseClipboardMatrixが正しく対になっている
    // ことの直接証明になる
    const parsed = parseClipboardMatrix(copiedCheck1);
    eq('(3b) 改行セル往復: rowCount/colCount', [parsed.rowCount, parsed.colCount], [2, 3]);
    eq('(3b) 改行セル往復: 行列が元の値(改行・"エスケープとも)に一致',
      parsed.matrix,
      [['案件A', '1行目\n2行目', '10'], ['5" パイプ', 'メモB', '20']]);
  } finally {
    await ctx.close();
  }

  // ================================================================
  // 無料/view-onlyユーザー(Pro未契約)でもメイングリッドのCtrl+Cは同じExcel互換TSVを出す
  // (コピーは読み取り専用操作なのでcanMutateOverlay等のPro制限を受けない)
  // ================================================================
  {
    const freeName = (n) => `grid-copy-tsv-e2e[free]: ${n}`;
    const { ctx: freeCtx, page: freePage } = await openOverlay({ browser, bridgeScript, pro: false });
    try {
      check(freeName('overlay opened(無料でも閲覧はできる)'), (await freePage.locator('#pb-excel-overlay, .pb-overlay').count()) > 0);
      await installClipboardStub(freePage);

      const fc = (rowIndex, fieldCode) => mainCell(freePage, rowIndex, fieldCode);
      await dragSelect(freePage, fc(0, '案件名'), fc(1, '数量'));
      await freePage.keyboard.press('Control+c');
      await freePage.waitForTimeout(80);
      const freeCopied = await freePage.evaluate(() => navigator.clipboard.__get());
      check(freeName('(4) 無料ユーザーでもCtrl+Cは同じExcel互換のクォート付きTSVを出す'),
        freeCopied === '案件A\t"1行目\n2行目"\t10\n"5"" パイプ"\tメモB\t20');
    } finally {
      await freeCtx.close();
    }
  }
}
