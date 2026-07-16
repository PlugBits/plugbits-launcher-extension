// 新規行の初期値プレフィル + サブテーブル空行POST の E2E検証。
import { openOverlay, cell } from './helpers/overlay-page.mjs';

// ── フィールド定義: 初期値ありの各型 + サブテーブル(必須列なし) ──────────
const FIELDS = [
  { code: '案件名', label: '案件名', type: 'SINGLE_LINE_TEXT', required: false, choices: [], defaultValue: 'AAA' },
  { code: '数量', label: '数量', type: 'NUMBER', required: false, choices: [], defaultValue: '10' },
  { code: '優先度', label: '優先度', type: 'RADIO_BUTTON', required: false, choices: ['高', '中', '低'], defaultValue: '高' },
  { code: 'タグ', label: 'タグ', type: 'CHECK_BOX', required: false, choices: ['a', 'b', 'c'], defaultValue: ['a'] },
  { code: '予定日', label: '予定日', type: 'DATE', required: false, choices: [], defaultNowValue: true },
  {
    code: '明細', label: '明細', type: 'SUBTABLE', required: false, choices: [],
    subtable: { fields: [
      { code: '品目', label: '品目', type: 'SINGLE_LINE_TEXT', required: false, choices: [] }
    ] }
  }
];

const RECORDS = [
  {
    $id: { value: '101' }, $revision: { value: '1' },
    案件名: { value: '既存案件' }, 数量: { value: '5' }, 優先度: { value: '中' },
    タグ: { value: ['b'] }, 予定日: { value: '2026-01-01' }, 明細: { value: [] }
  }
];

function buildBridge() {
  return `
window.__postCalls = [];
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
  if (type === 'EXCEL_POST_RECORDS') {
    const records = Array.isArray(d.payload?.records) ? d.payload.records : [];
    window.__postCalls.push({ records, __pbTrigger: d.payload?.__pbTrigger });
    return reply({ ok: true, result: { ids: records.map((_r, i) => String(200 + i)), revisions: records.map(() => '1') } });
  }
  if (type === 'EXCEL_GET_LOGIN_USER') return reply({ ok: true, user: { timezone: 'Asia/Tokyo' } });
  if (type === 'GET_APP_NAME') return reply({ ok: true, name: '受注管理' });
  if (type === 'EXCEL_GET_APP_ACL' || type === 'EXCEL_GET_RECORD_ACL' || type === 'EXCEL_GET_FIELD_ACL' || type === 'EXCEL_GET_VIEWS') return reply({ ok: true, result: {} });
  reply({ ok: false });
});`;
}

export async function run({ browser, check }) {
  const name = (n) => `newrow-defaults-e2e: ${n}`;
  const { ctx, page } = await openOverlay({ browser, bridgeScript: buildBridge(), deviceScaleFactor: 2 });
  try {
    check(name('overlay opened'), (await page.locator('#pb-excel-overlay, .pb-overlay').count()) > 0);

    const getCell = (rowIndex, fieldCode) => cell(page, rowIndex, fieldCode);
    const addRowBtn = page.locator('.pb-overlay__btn', { hasText: /行追加|Add row/ });
    const saveBtn = page.locator('.pb-overlay__btn--primary', { hasText: /保存|Save/ });

    // ── 1回目の行追加: 初期値プレフィルの表示確認 ───────────────────────────
    await addRowBtn.click();
    await page.waitForTimeout(300);
    check(name('add row: new row appended (2 rows total)'), (await page.locator('.pb-overlay__row').count()) === 2);

    check(name('prefill: 案件名 = AAA'), (await getCell(0, '案件名').inputValue()) === 'AAA');
    check(name('prefill: 数量 = 10'), (await getCell(0, '数量').inputValue()) === '10');
    check(name('prefill: 優先度(ラジオ) = 高'), (await getCell(0, '優先度').inputValue()) === '高');
    check(name('prefill: タグ(チェックボックス) = a'), (await getCell(0, 'タグ').inputValue()) === 'a');
    const todayCellValue = await getCell(0, '予定日').inputValue();
    check(name('prefill: 予定日(DATE defaultNowValue) は YYYY-MM-DD 形式'), /^\d{4}-\d{2}-\d{2}$/.test(todayCellValue));
    // Asia/Tokyoでの「今日」と一致すること（テスト実行時刻をtimezone変換して照合）
    const expectedToday = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit'
    }).format(new Date());
    check(name(`prefill: 予定日 = 実行時のAsia/Tokyoでの今日(${expectedToday})`), todayCellValue === expectedToday);

    // ── 数量だけ編集して保存 → POSTペイロードの検証 ────────────────────────
    await getCell(0, '数量').dblclick();
    await page.waitForTimeout(200);
    await page.keyboard.type('99');
    await page.waitForTimeout(150);
    check(name('数量セルが編集され99になる'), (await getCell(0, '数量').inputValue()) === '99');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(150);
    const dirty = await getCell(0, '数量').evaluate((el) => el.closest('.pb-overlay__cell')?.classList.contains('pb-overlay__cell--dirty'));
    check(name('数量セルはdirty(diffあり)'), Boolean(dirty));
    const meishaiDirty = await getCell(0, '案件名').evaluate((el) => el.closest('.pb-overlay__cell')?.classList.contains('pb-overlay__cell--dirty'));
    check(name('未編集の案件名セルはdirtyではない(初期値はdiffにしない)'), !meishaiDirty);

    await page.evaluate(() => { window.__postCalls.length = 0; });
    await saveBtn.click();
    await page.waitForTimeout(600);
    const postCalls1 = await page.evaluate(() => window.__postCalls);
    check(name('save sends EXCEL_POST_RECORDS'), postCalls1.length > 0);
    const rec1 = postCalls1[0]?.records?.[0];
    check(name('a. 編集した数量フィールドがpayloadに入っている(99)'), rec1?.['数量']?.value === '99');
    check(name('b. 未編集の案件名(初期値のみ)はpayloadに入っていない'), rec1?.['案件名'] === undefined);
    check(name('b. 未編集の優先度(初期値のみ)はpayloadに入っていない'), rec1?.['優先度'] === undefined);
    check(name('b. 未編集のタグ(初期値のみ)はpayloadに入っていない'), rec1?.['タグ'] === undefined);
    check(name('b. 未編集の予定日(初期値のみ)はpayloadに入っていない'), rec1?.['予定日'] === undefined);
    check(
      name('c. サブテーブル(明細)は空行1行 {value:[{value:{}}]} で入っている'),
      JSON.stringify(rec1?.['明細']) === JSON.stringify({ value: [{ value: {} }] })
    );

    await page.waitForTimeout(500); // 保存後のリロード完了待ち

    // ── 2行目追加: プレフィルされた文字フィールドの初期値を消して別フィールドを編集 ──
    await addRowBtn.click();
    await page.waitForTimeout(300);
    check(name('prefill(2行目): 案件名 = AAA'), (await getCell(0, '案件名').inputValue()) === 'AAA');

    await getCell(0, '案件名').dblclick();
    await page.waitForTimeout(200);
    await page.keyboard.press('Control+A');
    await page.keyboard.press('Delete');
    await page.waitForTimeout(150);
    check(name('案件名を消して空になる'), (await getCell(0, '案件名').inputValue()) === '');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(150);

    await getCell(0, '数量').dblclick();
    await page.waitForTimeout(200);
    await page.keyboard.type('42');
    await page.waitForTimeout(150);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(150);

    await page.evaluate(() => { window.__postCalls.length = 0; });
    await saveBtn.click();
    await page.waitForTimeout(600);
    const postCalls2 = await page.evaluate(() => window.__postCalls);
    check(name('2行目保存でEXCEL_POST_RECORDSが送られる'), postCalls2.length > 0);
    const rec2 = postCalls2[0]?.records?.[0];
    check(name("消した案件名フィールドが明示的に{value:''}で入っている"), rec2?.['案件名']?.value === '');
    check(name('編集した数量フィールドも入っている(42)'), rec2?.['数量']?.value === '42');
    check(name('未編集の優先度は引き続き入っていない'), rec2?.['優先度'] === undefined);
  } finally {
    await ctx.close();
  }
}
