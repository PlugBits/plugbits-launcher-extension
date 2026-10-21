// サブテーブル編集モーダルへのExcel範囲貼り付け(3.3.0)のE2E検証。
// + 引用符囲みセル(改行入り)のTSV解析をメイングリッドの貼り付けでも使う回帰確認。
import { openOverlay } from './helpers/overlay-page.mjs';

// ── フィールド定義 ──────────────────────────────────────────
// 明細(SUBTABLE)の列: 品目(text)/数量(number)/優先度(単一選択=RADIO_BUTTON)/
// タグ(複数選択=CHECK_BOX)/単価(ルックアップの自動転記先=常に編集不可)/メモ(複数行テキスト=modal-edit)
const FIELDS = [
  { code: '案件名', label: '案件名', type: 'SINGLE_LINE_TEXT', required: false, choices: [] },
  { code: '備考', label: '備考', type: 'MULTI_LINE_TEXT', required: false, choices: [] },
  {
    code: '明細', label: '明細', type: 'SUBTABLE', required: false, choices: [],
    subtable: { fields: [
      { code: '品目', label: '品目', type: 'SINGLE_LINE_TEXT', required: false, choices: [] },
      { code: '数量', label: '数量', type: 'NUMBER', required: false, choices: [] },
      { code: '優先度', label: '優先度', type: 'RADIO_BUTTON', required: false, choices: ['高', '中', '低'] },
      { code: 'タグ', label: 'タグ', type: 'CHECK_BOX', required: false, choices: ['a', 'b', 'c'] },
      { code: '単価', label: '単価', type: 'SINGLE_LINE_TEXT', required: false, choices: [], lookupAuto: true },
      { code: 'メモ', label: 'メモ', type: 'MULTI_LINE_TEXT', required: false, choices: [] }
    ] }
  }
];

function subtableItem(id, 品目, 数量, 優先度, タグ, 単価, メモ) {
  return {
    id: String(id),
    value: {
      品目: { value: 品目 },
      数量: { value: 数量 },
      優先度: { value: 優先度 },
      タグ: { value: タグ },
      単価: { value: 単価 },
      メモ: { value: メモ }
    }
  };
}

const RECORDS = [
  {
    $id: { value: '301' }, $revision: { value: '1' },
    案件名: { value: '案件A' }, 備考: { value: '' },
    明細: {
      value: [
        subtableItem('1', 'A', '1', '高', ['a'], '100', 'old1'),
        subtableItem('2', 'B', '2', '中', ['b'], '200', 'old2')
      ]
    }
  },
  {
    // 閉域(編集不可)レコード: view-only貼り付けブロックの検証用
    $id: { value: '302' }, $revision: { value: '1' },
    案件名: { value: '案件B(閉域)' }, 備考: { value: '' },
    明細: { value: [subtableItem('9', 'Z', '9', '高', ['a'], '900', 'zzz')] }
  }
];

function buildBridge() {
  return `
window.__putCalls = [];
const RECORDS = ${JSON.stringify(RECORDS)};
// 保存成功後、一覧モードは必ずEXCEL_GET_RECORDSで再読込する(refreshListRowsAfterSave)。
// 静的なRECORDSをそのまま返すと保存内容が消えて見えてしまうため、PUTの内容を
// CURRENT_RECORDSへ反映してから返す(簡易インメモリDBとして振る舞わせる)
let CURRENT_RECORDS = JSON.parse(JSON.stringify(RECORDS));
window.addEventListener('message', (ev) => {
  const d = ev.data || {};
  if (!d || d.__kfav__ !== true || !d.id || d.replyTo) return;
  const reply = (extra) => window.postMessage({ __kfav__: true, replyTo: d.id, ...extra }, location.origin);
  const type = d.type;
  if (type === 'EXCEL_GET_APP_CONTEXT') return reply({ ok: true, appId: '12', appName: '受注管理', query: '', timezone: 'Asia/Tokyo' });
  if (type === 'EXCEL_GET_FIELDS_META') return reply({ ok: true, fieldsMeta: ${JSON.stringify(FIELDS)} });
  if (type === 'EXCEL_GET_RECORDS') return reply({ ok: true, records: CURRENT_RECORDS, totalCount: CURRENT_RECORDS.length });
  if (type === 'EXCEL_EVALUATE_RECORD_ACL') {
    const ids = Array.isArray(d.payload?.ids) ? d.payload.ids : [];
    return reply({ ok: true, rights: ids.map((id) => ({ id, editable: id !== '302', deletable: id !== '302', viewable: true })) });
  }
  if (type === 'EXCEL_PUT_RECORDS') {
    const records = Array.isArray(d.payload?.records) ? d.payload.records : [];
    window.__putCalls.push({ records, __pbTrigger: d.payload?.__pbTrigger });
    records.forEach((entry) => {
      const target = CURRENT_RECORDS.find((r) => String(r.$id?.value) === String(entry.id));
      if (target && entry.record) {
        Object.keys(entry.record).forEach((fieldCode) => { target[fieldCode] = entry.record[fieldCode]; });
      }
    });
    return reply({ ok: true, result: { records: records.map(() => ({ revision: '2' })) } });
  }
  if (type === 'EXCEL_GET_LOGIN_USER') return reply({ ok: true, user: { timezone: 'Asia/Tokyo' } });
  if (type === 'GET_APP_NAME') return reply({ ok: true, name: '受注管理' });
  if (type === 'EXCEL_GET_APP_ACL' || type === 'EXCEL_GET_RECORD_ACL' || type === 'EXCEL_GET_FIELD_ACL' || type === 'EXCEL_GET_VIEWS') return reply({ ok: true, result: {} });
  reply({ ok: false });
});`;
}

export async function run({ browser, check }) {
  const name = (n) => `subtable-paste-e2e: ${n}`;
  const { ctx, page } = await openOverlay({ browser, bridgeScript: buildBridge(), deviceScaleFactor: 2 });
  try {
    check(name('overlay opened'), (await page.locator('#pb-excel-overlay, .pb-overlay').count()) > 0);

    const mainCell = (rowIndex, fieldCode) => page.locator(`.pb-overlay__cell input[data-field-code="${fieldCode}"][data-row-index="${rowIndex}"]`);
    const subtableRow = (idx) => page.locator('.pb-subtable__body .pb-subtable__row').nth(idx);
    const subtableRowCount = () => page.locator('.pb-subtable__body .pb-subtable__row').count();
    // 3.4.0: 左端に行番号列が増えたため、列はnth位置ではなくdata-col-index属性で選ぶ
    // (行番号セルにはdata-col-indexが付かないので、この属性セレクタだけでデータ列に絞れる)
    const subtableControl = (rowIdx, colIdx) => subtableRow(rowIdx).locator(`.pb-subtable__cell[data-col-index="${colIdx}"]`).locator('input, select, button.pb-overlay__subtable-choice-trigger');
    const toastTexts = () => page.locator('.pb-overlay__toast').allTextContents();

    // clipboardData経由の合成pasteイベントを対象要素へ直接dispatchする
    // (paste-verify-e2e.test.mjsと同じ方式。navigator.clipboard.readText()は
    // ブラウザの許可ダイアログに阻まれるため実際のpasteイベントを模擬する)
    async function pasteInto(locator, text) {
      await locator.evaluate((el, pasteText) => {
        el.focus();
        const dt = new DataTransfer();
        dt.setData('text', pasteText);
        const event = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
        el.dispatchEvent(event);
      }, text);
    }

    // ── モーダルを開く(案件A/record301) ──────────────────────────
    await mainCell(0, '明細').click();
    await page.waitForTimeout(300);
    check(name('(1) モーダルが開く(貼り付け前)'), (await page.locator('.pb-overlay__subtable-panel').count()) === 1);
    check(name('(1) 開いた時点で2行'), (await subtableRowCount()) === 2);

    // ── (2) 3x3貼り付け: 品目/数量/優先度(列0-2)へ3行分。既存2行+新規1行に拡張される ──
    await pasteInto(subtableControl(0, 0), 'X1\t10\t高\nX2\t20\t中\nX3\t30\t低');
    await page.waitForTimeout(300);
    check(name('(2) 3x3貼り付けで行が3行に増える(行追加と同じ既定値で拡張)'), (await subtableRowCount()) === 3);
    check(name('(2) row0 品目=X1'), (await subtableControl(0, 0).inputValue()) === 'X1');
    check(name('(2) row0 数量=10'), (await subtableControl(0, 1).inputValue()) === '10');
    check(name('(2) row0 優先度=高'), (await subtableControl(0, 2).inputValue()) === '高');
    check(name('(2) row1 品目=X2'), (await subtableControl(1, 0).inputValue()) === 'X2');
    check(name('(2) row2(新規) 品目=X3'), (await subtableControl(2, 0).inputValue()) === 'X3');
    check(name('(2) row2(新規) 優先度=低'), (await subtableControl(2, 2).inputValue()) === '低');
    // 貼り付け範囲外の列(タグ)は新規行でも「＋行追加」と同じ既定値(空)のまま
    const row2TagText = await subtableControl(2, 3).textContent();
    check(name('(2) row2(新規) タグは既定値(未選択=空)のまま'), (row2TagText || '').trim() === '');

    // ── (3) 非対応列(単価=ルックアップ自動転記先)を含む貼り付け: タグ(列3)+単価(列4)の2列×1行 ──
    //     タグは選択肢'c'に一致するので適用、単価は自動転記(常に編集不可)なので飛ばす
    await pasteInto(subtableControl(0, 3), 'c\t999');
    await page.waitForTimeout(300);
    check(name('(3) タグ(一致する選択肢)は適用される'), (await subtableControl(0, 3).textContent())?.trim() === 'c');
    check(name('(3) 単価(ルックアップ自動転記=非対応列)は変更されない(100のまま)'), (await subtableControl(0, 4).inputValue()) === '100');
    {
      const texts = await toastTexts();
      const joined = texts.join(' | ');
      check(
        name('(3) 非対応列スキップのトーストが出る(1件貼り付け・1件スキップ)'),
        /1\s*件を貼り付けました\(1\s*件は貼り付けできない列のため飛ばしました\)/.test(joined)
      );
    }

    // ── (4) 単一選択の不一致スキップ + 複数選択の一致適用(優先度列2+タグ列3・row1) ──
    await pasteInto(subtableControl(1, 2), '超高\ta,b');
    await page.waitForTimeout(300);
    check(name('(4) 優先度(選択肢に不一致)は変更されない(中のまま)'), (await subtableControl(1, 2).inputValue()) === '中');
    check(name('(4) タグ(カンマ区切りの複数一致)は適用される(a, b)'), (await subtableControl(1, 3).textContent())?.trim() === 'a, b');

    // ── (5) 引用符で囲まれた改行入りの1セルをメモ(複数行テキスト=modal-edit)列へ ──
    await pasteInto(subtableControl(0, 5), '"line1\nline2"');
    await page.waitForTimeout(300);
    check(name('(5) メモのプレビューに2行とも反映される(改行が保たれている)'), (await subtableControl(0, 5).inputValue()) === 'line1 / line2');

    // ── 保存してdiff/payloadに反映されることを確認 ──────────────────
    const saveSubtableBtn = page.locator('.pb-overlay__subtable-foot [data-subtable-action="save"]');
    await saveSubtableBtn.click();
    await page.waitForTimeout(300);
    check(name('保存でモーダルが閉じる'), (await page.locator('.pb-overlay__subtable-panel').count()) === 0);

    const saveBtn = page.locator('.pb-overlay__btn--primary', { hasText: /保存|Save/ });
    await page.evaluate(() => { window.__putCalls.length = 0; });
    await saveBtn.click();
    await page.waitForTimeout(600);
    const putCalls = await page.evaluate(() => window.__putCalls);
    check(name('保存でEXCEL_PUT_RECORDSが送られる'), putCalls.length > 0);
    const rec = putCalls[0]?.records?.find((r) => String(r.id) === '301');
    const meisai = rec?.record?.['明細']?.value;
    check(name('保存されたpayloadの明細は3行'), Array.isArray(meisai) && meisai.length === 3);
    check(
      name('row2(新規追加行)がidなしで新規行として送られる'),
      Boolean(meisai && meisai[2] && !meisai[2].id)
    );
    check(
      name('メモの改行(\\n)がpayloadにそのまま残っている(引用符解析の回帰確認)'),
      meisai?.[0]?.value?.メモ?.value === 'line1\nline2'
    );
    check(
      name('単価(ルックアップ自動転記)はスキップされたので元の100のまま送られる'),
      meisai?.[0]?.value?.単価?.value === '100'
    );
    check(
      name('row1のタグはa,b貼り付け後の値で送られる'),
      JSON.stringify(meisai?.[1]?.value?.タグ?.value) === JSON.stringify(['a', 'b'])
    );

    // ============================================================
    // (6) 500行超の確認(確認ダイアログ→キャンセルで何も変わらない)
    // ============================================================
    await mainCell(1, '明細').click();
    await page.waitForTimeout(300);
    check(name('(6) record302(閉域)用に開いた別モーダル: 1行'), (await subtableRowCount()) === 1);
    const hugeText = Array.from({ length: 501 }, (_, i) => `v${i}`).join('\n');
    await pasteInto(subtableControl(0, 0), hugeText);
    await page.waitForTimeout(300);
    check(
      name('(6) view-onlyレコードへの複数セル貼り付けはnotifyViewOnlyBlockedのみ(値は変わらない)'),
      (await subtableControl(0, 0).inputValue()) === 'Z'
    );
    {
      const texts = await toastTexts();
      check(name('(6) view-onlyブロックのトースト(notifyViewOnlyBlocked)が出る'), texts.some((t) => /Pro/i.test(t)));
    }
    // このモーダルを閉じる(編集不可なのでキャンセルのみ)
    await page.locator('.pb-overlay__subtable-close').click();
    await page.waitForTimeout(200);

    // ============================================================
    // (7) 500行超の確認を、編集可能レコード(301)側で実際に発生させる
    // ============================================================
    await mainCell(0, '明細').click();
    await page.waitForTimeout(300);
    const rowsBefore = await subtableRowCount();
    await pasteInto(subtableControl(0, 0), hugeText);
    await page.waitForTimeout(300);
    check(name('(7) 500行超になる貼り付けで確認ダイアログが出る'), (await page.locator('.pb-overlay__confirm-layer').count()) === 1);
    const cancelConfirmBtn = page.locator('.pb-overlay__confirm-actions button', { hasText: /キャンセル|Cancel/ });
    await cancelConfirmBtn.click();
    await page.waitForTimeout(200);
    check(name('(7) キャンセルで確認ダイアログが閉じる'), (await page.locator('.pb-overlay__confirm-layer').count()) === 0);
    check(name('(7) キャンセルで行数は変わらない'), (await subtableRowCount()) === rowsBefore);
    check(name('(7) キャンセルで既存の値も変わらない(X1のまま)'), (await subtableControl(0, 0).inputValue()) === 'X1');

    // ── (8) モーダルの「キャンセル」ボタンは貼り付けを含む編集を丸ごと破棄する ──
    await pasteInto(subtableControl(1, 0), 'DISCARD_ME\n');
    await page.waitForTimeout(200);
    check(name('(8) 破棄前: row1品目がDISCARD_MEに変わっている'), (await subtableControl(1, 0).inputValue()) === 'DISCARD_ME');
    const cancelModalBtn = page.locator('.pb-overlay__subtable-foot [data-subtable-action="cancel"]');
    await cancelModalBtn.click();
    await page.waitForTimeout(300);
    check(name('(8) モーダルのキャンセルで閉じる'), (await page.locator('.pb-overlay__subtable-panel').count()) === 0);
    await mainCell(0, '明細').click();
    await page.waitForTimeout(300);
    check(name('(8) 再度開くと保存済みの値のまま(DISCARD_MEは残っていない)'), (await subtableControl(1, 0).inputValue()) === 'X2');
    await page.locator('.pb-overlay__subtable-close').click();
    await page.waitForTimeout(200);

    // ============================================================
    // (9) メイングリッド本体: 引用符囲みの改行入り1セルの貼り付け(備考列)
    //     旧実装(改行で単純split)では「"gridline1」「gridline2"」の2行として誤認し、
    //     row0だけでなくrow1(別レコード)にまで値が溢れてしまっていた回帰の確認。
    //     備考はメイングリッド上は<input type="text">(複数行編集は別モーダル)なので
    //     改行文字そのものはブラウザのinput.value代入で失われる(既存の挙動・本機能の
    //     対象外)が、1セルとして扱われ他行に溢れないことがparseClipboardMatrixの
    //     引用符対応の要点
    // ============================================================
    await pasteInto(mainCell(0, '備考'), '"gridline1\ngridline2"');
    await page.waitForTimeout(300);
    check(
      name('(9) 引用符内の改行で2行に分裂せず、1セル分の値が備考(row0)に入る'),
      (await mainCell(0, '備考').inputValue()) === 'gridline1gridline2'
    );
    check(
      name('(9) 引用符内の改行がrow1(別レコード)の備考へ溢れない(回帰確認)'),
      (await mainCell(1, '備考').inputValue()) === ''
    );
    await page.evaluate(() => { window.__putCalls.length = 0; });
    await saveBtn.click();
    await page.waitForTimeout(600);
    const putCalls2 = await page.evaluate(() => window.__putCalls);
    const rec2 = putCalls2[0]?.records?.find((r) => String(r.id) === '301');
    check(
      name('(9) 保存payloadにも1セル分の値がそのまま残る(他行を汚染しない)'),
      rec2?.record?.['備考']?.value === 'gridline1gridline2'
    );
    check(
      name('(9) record302のpayloadは送られない(変更なし)'),
      !putCalls2[0]?.records?.some((r) => String(r.id) === '302')
    );
  } finally {
    await ctx.close();
  }
}
