// 貼り付けルックアップ照合（緑/警告＋サマリトースト）＋タイプ先行時のAPI削減のE2E検証。
import { openOverlay } from './helpers/overlay-page.mjs';

// ── フィールド定義 ──────────────────────────────────────────
// 商品: 参照先app88(3件・≤500件マスタ) - 貼り付け照合(緑/警告)のメインケース
// 型番: 参照先app77(3件・≤500件マスタ) - 実装1(タイプ先行時のAPI削減)専用。
//       商品と別アプリにすることでキャッシュを完全に独立させる
// 資材: 参照先app66(totalCount 1200・500件超マスタ) - exactValuesチャンク照合の検証
const FIELDS = [
  { code: '案件名', label: '案件名', type: 'SINGLE_LINE_TEXT', required: true, choices: [] },
  {
    code: '商品', label: '商品', type: 'SINGLE_LINE_TEXT', required: false, choices: [],
    lookup: { relatedApp: { app: '88' }, relatedKeyField: '商品名', lookupPickerFields: ['商品名'], fieldMappings: [] }
  },
  {
    code: '型番', label: '型番', type: 'SINGLE_LINE_TEXT', required: false, choices: [],
    lookup: { relatedApp: { app: '77' }, relatedKeyField: '型番', lookupPickerFields: ['型番'], fieldMappings: [] }
  },
  {
    code: '資材', label: '資材', type: 'SINGLE_LINE_TEXT', required: false, choices: [],
    lookup: { relatedApp: { app: '66' }, relatedKeyField: '資材名', lookupPickerFields: ['資材名'], fieldMappings: [] }
  }
];

const RECORDS = [
  { $id: { value: '201' }, $revision: { value: '1' }, 案件名: { value: '案件A' }, 商品: { value: '' }, 型番: { value: '' }, 資材: { value: '' } },
  { $id: { value: '202' }, $revision: { value: '1' }, 案件名: { value: '案件B' }, 商品: { value: '' }, 型番: { value: '' }, 資材: { value: '' } },
  { $id: { value: '203' }, $revision: { value: '1' }, 案件名: { value: '案件C' }, 商品: { value: '' }, 型番: { value: '' }, 資材: { value: '' } }
];

const PRODUCTS = [
  { 商品名: { value: '有効' } },
  { 商品名: { value: '予備A' } },
  { 商品名: { value: '予備B' } }
];
const MODELS = [
  { 型番: { value: '型番001' } },
  { 型番: { value: '型番002' } },
  { 型番: { value: '型番003' } }
];
// 資材アプリは500件超(totalCount 1200)。実在するのは'資材A'のみ('資材Z'は存在しない)
const MATERIAL_EXISTS = ['資材A'];

function buildBridge() {
  return `
window.__lookupCalls = [];
window.__putCalls = [];
const RECORDS = ${JSON.stringify(RECORDS)};
const PRODUCTS = ${JSON.stringify(PRODUCTS)};
const MODELS = ${JSON.stringify(MODELS)};
const MATERIAL_EXISTS = ${JSON.stringify(MATERIAL_EXISTS)};
window.addEventListener('message', (ev) => {
  const d = ev.data || {};
  if (!d || d.__kfav__ !== true || !d.id || d.replyTo) return;
  const reply = (extra) => window.postMessage({ __kfav__: true, replyTo: d.id, ...extra }, location.origin);
  const type = d.type;
  if (type === 'EXCEL_GET_APP_CONTEXT') {
    return reply({ ok: true, appId: '12', appName: '受注管理', query: '', timezone: 'Asia/Tokyo' });
  }
  if (type === 'EXCEL_GET_FIELDS_META') {
    return reply({ ok: true, fieldsMeta: ${JSON.stringify(FIELDS)} });
  }
  if (type === 'EXCEL_GET_RECORDS') {
    return reply({ ok: true, records: RECORDS, totalCount: RECORDS.length });
  }
  if (type === 'EXCEL_EVALUATE_RECORD_ACL') {
    const ids = Array.isArray(d.payload?.ids) ? d.payload.ids : [];
    return reply({ ok: true, rights: ids.map((id) => ({ id, editable: true, deletable: true, viewable: true })) });
  }
  if (type === 'EXCEL_GET_LOOKUP_CANDIDATES') {
    const appId = String(d.payload?.relatedAppId || '');
    const keyword = String(d.payload?.keyword || '');
    const exactValues = Array.isArray(d.payload?.exactValues) ? d.payload.exactValues : null;
    window.__lookupCalls.push({ appId, keyword, exactValues });
    if (appId === '66') {
      if (exactValues) {
        const hits = MATERIAL_EXISTS.filter((v) => exactValues.includes(v));
        return reply({ ok: true, result: { records: hits.map((v) => ({ 資材名: { value: v } })), totalCount: hits.length } });
      }
      // ベース取得(キーワードなし): 500件返すが総数1200(=不完全) → exactValues経路に回るはず
      const filler = Array.from({ length: 500 }, (_, i) => ({ 資材名: { value: 'filler' + i } }));
      return reply({ ok: true, result: { records: filler, totalCount: 1200 } });
    }
    const SET = appId === '88' ? PRODUCTS : (appId === '77' ? MODELS : []);
    const keyFieldName = appId === '88' ? '商品名' : '型番';
    const filtered = keyword ? SET.filter((r) => r[keyFieldName].value.includes(keyword)) : SET;
    return reply({ ok: true, result: { records: filtered, totalCount: filtered.length } });
  }
  if (type === 'EXCEL_PUT_RECORDS') {
    const records = Array.isArray(d.payload?.records) ? d.payload.records : [];
    window.__putCalls.push({ records, __pbTrigger: d.payload?.__pbTrigger });
    return reply({ ok: true, result: { records: records.map(() => ({ revision: '2' })) } });
  }
  if (type === 'EXCEL_GET_LOGIN_USER') return reply({ ok: true, user: { timezone: 'Asia/Tokyo' } });
  if (type === 'GET_APP_NAME') return reply({ ok: true, name: '受注管理' });
  if (type === 'EXCEL_GET_VIEW_INFO') return reply({ ok: false });
  if (type === 'EXCEL_GET_APP_ACL' || type === 'EXCEL_GET_RECORD_ACL' || type === 'EXCEL_GET_FIELD_ACL' || type === 'EXCEL_GET_VIEWS') {
    return reply({ ok: true, result: {} });
  }
  reply({ ok: false });
});`;
}

export async function run({ browser, check }) {
  const name = (n) => `paste-verify-e2e: ${n}`;
  const { ctx, page } = await openOverlay({ browser, bridgeScript: buildBridge(), deviceScaleFactor: 2 });
  try {
    const overlayVisible = await page.locator('#pb-excel-overlay, .pb-overlay').count();
    check(name('overlay opened (root element present)'), overlayVisible > 0);
    if (!overlayVisible) return;

    const getCell = (rowIndex, fieldCode) => page.locator(`.pb-overlay__cell input[data-field-code="${fieldCode}"][data-row-index="${rowIndex}"]`);
    const lookupCalls = () => page.evaluate(() => window.__lookupCalls);
    const cellClasses = async (rowIndex, fieldCode) => getCell(rowIndex, fieldCode).evaluate((el) => Array.from(el.closest('.pb-overlay__cell')?.classList || []));
    const toastTexts = () => page.locator('.pb-overlay__toast').allTextContents();

    // clipboardData経由の合成pasteイベントをフォーカス中のinputへ直接dispatchする。
    // navigator.clipboard.readText()はブラウザの許可ダイアログに阻まれるため、
    // 実際のExcel貼り付け(inputへの'paste'イベント)を直接模擬する
    async function pasteAt(rowIndex, fieldCode, text) {
      await getCell(rowIndex, fieldCode).evaluate((el, pasteText) => {
        el.focus();
        const dt = new DataTransfer();
        dt.setData('text', pasteText);
        const event = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
        el.dispatchEvent(event);
      }, text);
    }

    // ── ① ≤500件マスタ(商品): 3セルへ縦方向で「有効/有効/無効」を貼り付け ──
    await pasteAt(0, '商品', '有効\n有効\n無効');
    await page.waitForTimeout(600);

    check(name('row0(有効): --lookup-ok が付く'), (await cellClasses(0, '商品')).includes('pb-overlay__cell--lookup-ok'));
    check(name('row1(有効): --lookup-ok が付く'), (await cellClasses(1, '商品')).includes('pb-overlay__cell--lookup-warn') === false
      && (await cellClasses(1, '商品')).includes('pb-overlay__cell--lookup-ok'));
    check(name('row2(無効): --lookup-warn が付く'), (await cellClasses(2, '商品')).includes('pb-overlay__cell--lookup-warn'));
    check(name('row2(無効): --error(invalidCells)は付かない(保存はブロックしない)'), !(await cellClasses(2, '商品')).includes('pb-overlay__cell--error'));

    const productCallsAfterPaste = (await lookupCalls()).filter((c) => c.appId === '88');
    check(name('商品(≤500件マスタ)への貼り付け照合はAPI呼び出し合計1回(ベース取得のみ)'), productCallsAfterPaste.length === 1);
    check(name('そのベース取得はexactValues無し(全件ローカル化できたため)'), productCallsAfterPaste[0]?.exactValues === null);

    const toasts0 = await toastTexts();
    check(name('サマリトーストに「2 件一致、1 件は…」が出る'), toasts0.some((t) => t.includes('2 件一致') && t.includes('1 件は')));

    // row2のtitleもwarnヒントに変わっているか
    const row2Title = await getCell(2, '商品').getAttribute('title');
    check(name('warnセルのtitleがlookupPasteWarnHintになる'), row2Title === '参照先に一致する値が見つかりません。保存時にエラーになる可能性があります');

    // ── ② warnセルを手で編集 ──
    // [全経路化タスクでの挙動変更] 以前はセル編集で貼り付け照合マークが消えたまま
    // 放置されていたが、今回の実装で「手打ちで入力してセル編集を終える」経路にも
    // 非同期照合がかかるようになった。そのため:
    //   a. 入力直後(コミット前): onInputChangedが古いマークを即クリアする(従来どおり)
    //   b. 編集終了(Escapeでexit)後: 新しい値(手動入力値=実在しない)を再照合し、
    //      --lookup-warnが再度付く(これが新しい正しい挙動)
    await getCell(2, '商品').click();
    await page.waitForTimeout(120);
    await getCell(2, '商品').press('Enter');
    await page.waitForTimeout(120);
    await getCell(2, '商品').fill('手動入力値');
    await page.waitForTimeout(150);
    check(name('手で編集した直後(コミット前)は--lookup-warnが消える'), !(await cellClasses(2, '商品')).includes('pb-overlay__cell--lookup-warn'));
    await getCell(2, '商品').press('Escape');
    await page.waitForTimeout(300);
    check(name('手打ち確定後は再照合され、実在しない値なので--lookup-warnが再度付く(新規: 手打ち確定も照合対象)'), (await cellClasses(2, '商品')).includes('pb-overlay__cell--lookup-warn'));

    // ── ③ 同じセルへ再度「無効」を貼り付けてwarnを再現(キャッシュ済みなのでAPIは増えない) ──
    await pasteAt(2, '商品', '無効');
    await page.waitForTimeout(600);
    check(name('再貼り付けで--lookup-warnが再度付く'), (await cellClasses(2, '商品')).includes('pb-overlay__cell--lookup-warn'));
    const productCallsAfterRepaste = (await lookupCalls()).filter((c) => c.appId === '88');
    check(name('再貼り付けはTier1キャッシュを使うのでAPI回数は増えない(合計1回のまま)'), productCallsAfterRepaste.length === 1);

    // ── ④ warnセルがあっても保存はブロックされない(EXCEL_PUT_RECORDSが飛ぶ) ──
    await page.evaluate(() => { window.__putCalls.length = 0; });
    const saveBtn = page.locator('.pb-overlay__btn--primary', { hasText: /保存|Save/ });
    await saveBtn.click();
    await page.waitForTimeout(600);
    const putCalls = await page.evaluate(() => window.__putCalls);
    check(name('warnセルが残っていても保存クリックでEXCEL_PUT_RECORDSが飛ぶ(ブロックされない)'), putCalls.length > 0);
    await page.waitForTimeout(600); // reloadPage/refetch完了待ち

    // ── ⑤ >500件マスタ(資材, totalCount 1200): 貼り付け→exactValues付き呼び出しが飛ぶ ──
    await pasteAt(0, '資材', '資材A\n資材Z');
    await page.waitForTimeout(700);
    const materialCalls = (await lookupCalls()).filter((c) => c.appId === '66');
    check(name('資材(>500件マスタ)への貼り付けはベース取得+exactValuesの計2回'), materialCalls.length === 2);
    check(name('1回目はexactValues無し(ベース取得)'), materialCalls[0]?.exactValues === null);
    check(name('2回目はexactValues付き(in句照合)で貼り付けた2値を含む'), Array.isArray(materialCalls[1]?.exactValues)
      && materialCalls[1].exactValues.includes('資材A') && materialCalls[1].exactValues.includes('資材Z'));
    check(name('資材row0(資材A・実在): --lookup-ok'), (await cellClasses(0, '資材')).includes('pb-overlay__cell--lookup-ok'));
    check(name('資材row1(資材Z・存在しない): --lookup-warn'), (await cellClasses(1, '資材')).includes('pb-overlay__cell--lookup-warn'));

    // ── ⑥ 実装1: 新しい参照先アプリ(型番)のセルでいきなりタイプ → API合計1回、続けても増えない ──
    await page.evaluate(() => { window.__lookupCalls.length = 0; });
    await getCell(0, '案件名').click();
    await page.waitForTimeout(120);
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(120);
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(120);
    await getCell(0, '型番').pressSequentially('型番0', { delay: 20 });
    await page.waitForTimeout(600);
    const modelCallsAfterFirstChar = (await lookupCalls()).filter((c) => c.appId === '77');
    check(name('型番セルへタイプ先行(ピッカー未オープン)で候補が絞り込まれて表示される'), await page.locator('.pb-overlay__lookup-anchor .pb-newrec__lookup-item:not(.pb-newrec__lookup-item--frequent)').count() > 0);
    check(name('実装1: ベース取得1回のみでAPI消費(プレフィックスごとに増えない)'), modelCallsAfterFirstChar.length === 1);
    await getCell(0, '型番').pressSequentially('0', { delay: 20 });
    await page.waitForTimeout(400);
    const modelCallsAfterSecondChar = (await lookupCalls()).filter((c) => c.appId === '77');
    check(name('実装1: さらに1文字足してもAPI回数は増えない'), modelCallsAfterSecondChar.length === 1);

    await getCell(0, '型番').press('Escape');
    await page.waitForTimeout(150);
    await getCell(0, '型番').press('Escape');
    await page.waitForTimeout(150);
  } finally {
    await ctx.close();
  }
}
