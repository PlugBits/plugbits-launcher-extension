// handleInputBlur 修正の回帰テスト。
// バグ: セルAにフォーカスがある状態でセルBをダブルクリックすると、
// enterEditMode(B) 直後に届くAのblurがBの編集セッションを巻き込んで即終了させていた
// （handleInputBlurがblur元のinputとeditingCellの一致を確認していなかった）。
import { openOverlay, cell } from './helpers/overlay-page.mjs';

const FIELDS = [
  { code: '案件名', label: '案件名', type: 'SINGLE_LINE_TEXT', required: true, choices: [] },
  { code: '数量', label: '数量', type: 'NUMBER', required: false, choices: [] },
  {
    code: '商品', label: '商品', type: 'SINGLE_LINE_TEXT', required: false, choices: [],
    lookup: { relatedApp: { app: '88' }, relatedKeyField: '商品名', lookupPickerFields: ['商品名'], fieldMappings: [] }
  }
];

const RECORDS = [
  { $id: { value: '101' }, $revision: { value: '1' }, 案件名: { value: '案件A' }, 数量: { value: '5' }, 商品: { value: '商品001' } },
  { $id: { value: '102' }, $revision: { value: '1' }, 案件名: { value: '案件B' }, 数量: { value: '2' }, 商品: { value: '商品002' } }
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
  if (type === 'EXCEL_GET_LOOKUP_CANDIDATES') return reply({ ok: true, result: { records: [{ 商品名: { value: '商品001' } }, { 商品名: { value: '商品002' } }], totalCount: 2 } });
  if (type === 'EXCEL_GET_LOGIN_USER') return reply({ ok: true, user: { timezone: 'Asia/Tokyo' } });
  if (type === 'GET_APP_NAME') return reply({ ok: true, name: '受注管理' });
  if (type === 'EXCEL_GET_APP_ACL' || type === 'EXCEL_GET_RECORD_ACL' || type === 'EXCEL_GET_FIELD_ACL' || type === 'EXCEL_GET_VIEWS') return reply({ ok: true, result: {} });
  reply({ ok: false });
});`;
}

export async function run({ browser, check }) {
  const name = (n) => `dblclick-blur: ${n}`;
  const { ctx, page } = await openOverlay({ browser, bridgeScript: buildBridge() });
  try {
    check(name('overlay opened'), (await page.locator('#pb-excel-overlay, .pb-overlay').count()) > 0);

    const getCell = (rowIndex, fieldCode) => cell(page, rowIndex, fieldCode);

    // ── ケース1: 別セル(案件名)にフォーカス → 数量セルをダブルクリックで直接編集開始 ──
    await getCell(0, '案件名').click();
    await page.waitForTimeout(200);
    await getCell(0, '数量').dblclick();
    await page.waitForTimeout(300);
    check(name('case1: dblclick on another cell starts edit mode (not killed by old cell blur)'),
      await getCell(0, '数量').evaluate((el) => !el.readOnly));
    // そのままタイプできる
    await page.keyboard.type('7');
    await page.waitForTimeout(200);
    check(name('case1: typing works in the dblclick-started edit'), (await getCell(0, '数量').inputValue()).includes('7'));
    await page.keyboard.press('Escape');
    await page.waitForTimeout(150);

    // ── ケース2: 別「行」のセルにフォーカス → ルックアップキーセルをダブルクリック ──
    await getCell(1, '案件名').click();
    await page.waitForTimeout(200);
    await getCell(0, '商品').dblclick();
    await page.waitForTimeout(300);
    check(name('case2: dblclick on lookup key cell (different row) starts edit mode'),
      await getCell(0, '商品').evaluate((el) => !el.readOnly));
    // ルックアップ候補もタイプで開く
    await page.keyboard.type('商品');
    await page.waitForTimeout(700);
    check(name('case2: candidates open while editing after dblclick'),
      (await page.locator('.pb-overlay__lookup-anchor .pb-newrec__lookup-item').count()) > 0);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(150);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(150);

    // ── ケース3(回帰): 編集終了そのものは壊れていないこと。編集中に別セルをクリック → 編集は終了する ──
    await getCell(0, '数量').dblclick();
    await page.waitForTimeout(300);
    check(name('case3: edit mode started'), await getCell(0, '数量').evaluate((el) => !el.readOnly));
    await getCell(1, '案件名').click();
    await page.waitForTimeout(300);
    check(name('case3: clicking another cell still ends the previous edit'),
      await getCell(0, '数量').evaluate((el) => el.readOnly));
  } finally {
    await ctx.close();
  }
}
