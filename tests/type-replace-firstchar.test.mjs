// type-to-replace の「1文字目が消える」バグの回帰テスト。
// 原因: enterEditMode(selectAll=true)が予約するrAFの全選択が、type-to-replaceが
// セットした1文字目の後に発火して選択し、2文字目が上書きしてしまうレース。
// 再現手順: 1文字タイプ → rAFが確実に発火するまで待つ → 2文字目をタイプ。
import { openOverlay } from './helpers/overlay-page.mjs';

const FIELDS = [
  { code: '案件名', label: '案件名', type: 'SINGLE_LINE_TEXT', required: true, choices: [] },
  { code: '数量', label: '数量', type: 'NUMBER', required: false, choices: [] },
  { code: '納期', label: '納期', type: 'DATE', required: false, choices: [] }
];

const RECORDS = [
  { $id: { value: '101' }, $revision: { value: '1' }, 案件名: { value: '既存の案件名' }, 数量: { value: '5' }, 納期: { value: '2026-07-01' } }
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

export async function run({ browser, check }) {
  const name = (n) => `type-replace-firstchar: ${n}`;
  const { ctx, page } = await openOverlay({ browser, bridgeScript: buildBridge() });
  try {
    check(name('overlay opened'), (await page.locator('#pb-excel-overlay, .pb-overlay').count()) > 0);

    const getCell = (fieldCode) => page.locator(`.pb-overlay__cell input[data-field-code="${fieldCode}"][data-row-index="0"]`);

    // ── ケース1(核心): セル選択 → 1文字タイプ → rAF発火待ち(100ms) → 2文字目 ──
    // 修正前: rAFの全選択が1文字目を選択し、2文字目が上書き → 'B' になる
    await getCell('案件名').click();
    await page.waitForTimeout(200);
    await page.keyboard.press('A');
    await page.waitForTimeout(100); // rAF(全選択)が確実に発火する間を置く
    await page.keyboard.press('B');
    await page.waitForTimeout(100);
    await page.keyboard.press('C');
    await page.waitForTimeout(150);
    check(name('case1: first char survives slow typing (A→wait→B→wait→C = "ABC")'),
      (await getCell('案件名').inputValue()) === 'ABC');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(150);

    // ── ケース2: 速いタイプ(間隔なし)でも全文字残る ──
    await getCell('案件名').click();
    await page.waitForTimeout(200);
    await page.keyboard.type('XYZ');
    await page.waitForTimeout(200);
    check(name('case2: fast typing keeps all chars ("XYZ")'), (await getCell('案件名').inputValue()) === 'XYZ');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(150);

    // ── ケース3: NUMBER列でも同様 ──
    await getCell('数量').click();
    await page.waitForTimeout(200);
    await page.keyboard.press('1');
    await page.waitForTimeout(100);
    await page.keyboard.press('2');
    await page.waitForTimeout(150);
    check(name('case3: NUMBER cell keeps first digit ("12")'), (await getCell('数量').inputValue()) === '12');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(150);

    // ── ケース4(既存挙動の維持): ダブルクリック編集は既存内容が全選択され、タイプで置換される ──
    await getCell('案件名').dblclick();
    await page.waitForTimeout(300); // rAFの全選択が走るのを待つ
    await page.keyboard.type('置換後');
    await page.waitForTimeout(150);
    check(name('case4: dblclick still selects existing content (typing replaces all)'),
      (await getCell('案件名').inputValue()) === '置換後');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(150);
  } finally {
    await ctx.close();
  }
}
