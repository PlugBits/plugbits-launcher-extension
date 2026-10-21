// サブテーブルセルのダブルクリックで「開く」処理が多重発火しないことのE2E回帰テスト。
//
// 旧バグ: サブテーブル列のセルはreadOnlyなinputで、クリックごとに
// handleChoiceInputClick→openSubtableEditorが呼ばれる(=単一クリックで即モーダルが開く仕様)。
// ダブルクリックはネイティブに
//   mousedown(detail=1) → click(detail=1) → mousedown(detail=2) → click(detail=2) → dblclick
// の順でイベントが発火し、
//   (a) click(detail=1) → handleChoiceInputClick → openSubtableEditor
//   (b) mousedown(detail=2) → handleCellMouseDown の event.detail>=2 分岐 → enterEditMode
//       → (サブテーブルは直接編集不可なので) openSubtableEditor
//   (c) click(detail=2) → handleChoiceInputClick → openSubtableEditor
// の計3回openSubtableEditorが呼ばれ、閉じる処理(closeSubtableEditor)が追いつかないまま
// それぞれが非同期に完成して .pb-overlay__subtable-layer を3枚重ねて追加していた。
//
// 修正: openSubtableEditor内で、同じ(rowIndex, colIndex)に対して既に開いている/開き中の
// 場合は即returnするガードを追加(content-overlay-controller.js)。
import { openOverlay, cell } from './helpers/overlay-page.mjs';

const FIELDS = [
  { code: '案件名', label: '案件名', type: 'SINGLE_LINE_TEXT', required: false, choices: [] },
  {
    code: '明細', label: '明細', type: 'SUBTABLE', required: false, choices: [],
    subtable: { fields: [
      { code: '品目', label: '品目', type: 'SINGLE_LINE_TEXT', required: false, choices: [] }
    ] }
  }
];

function subtableItem(id, 品目) {
  return { id: String(id), value: { 品目: { value: 品目 } } };
}

const RECORDS = [
  {
    $id: { value: '301' }, $revision: { value: '1' },
    案件名: { value: '案件A' },
    明細: { value: [subtableItem('1', 'A'), subtableItem('2', 'B')] }
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

// .pb-overlay__subtable-layer がDOMに追加された回数を数える = openSubtableEditorの
// 「開く」処理(await越しの本体)が実際に完了して描画まで進んだ回数。
// (多重発火時でも、ガードで弾かれた呼び出しはlayerを作らないため0回扱いになる)
async function armSubtableOpenCounter(page) {
  await page.evaluate(() => {
    window.__pbSubtableOpenCount = 0;
    if (window.__pbSubtableOpenObserver) window.__pbSubtableOpenObserver.disconnect();
    const root = document.querySelector('.pb-overlay') || document.body;
    const mo = new MutationObserver((mutations) => {
      for (const m of mutations) {
        for (const node of m.addedNodes) {
          if (node.nodeType === 1 && node.classList && node.classList.contains('pb-overlay__subtable-layer')) {
            window.__pbSubtableOpenCount += 1;
          }
        }
      }
    });
    mo.observe(root, { childList: true, subtree: true });
    window.__pbSubtableOpenObserver = mo;
  });
}

const openCount = (page) => page.evaluate(() => window.__pbSubtableOpenCount);

export async function run({ browser, check }) {
  const name = (n) => `subtable-dblclick-e2e: ${n}`;
  const { ctx, page } = await openOverlay({ browser, bridgeScript: buildBridge() });
  try {
    check(name('overlay opened'), (await page.locator('#pb-excel-overlay, .pb-overlay').count()) > 0);

    // ── (1) ダブルクリック: 開く処理は1回だけ・モーダルパネルも1枚だけ ──
    await armSubtableOpenCounter(page);
    await cell(page, 0, '明細').dblclick();
    await page.waitForTimeout(500);

    check(name('(1) dblclick: openSubtableEditor の描画完了は1回だけ'), (await openCount(page)) === 1);
    check(name('(1) dblclick: モーダルパネルは1枚だけ存在する'),
      (await page.locator('.pb-overlay__subtable-panel').count()) === 1);
    check(name('(1) dblclick: 明細行は2行のまま正しく表示される'),
      (await page.locator('.pb-subtable__body .pb-subtable__row').count()) === 2);

    await page.locator('.pb-overlay__subtable-close').click();
    await page.waitForTimeout(300);
    check(name('(1) 閉じるボタンでモーダルが閉じる'), (await page.locator('.pb-overlay__subtable-panel').count()) === 0);

    // ── (2) 回帰: 単一クリックの挙動は変わらず1回だけ開く ──
    await armSubtableOpenCounter(page);
    await cell(page, 0, '明細').click();
    await page.waitForTimeout(400);
    check(name('(2) 単一クリック: openSubtableEditor の描画完了は1回だけ(回帰)'), (await openCount(page)) === 1);
    check(name('(2) 単一クリック: モーダルパネルは1枚だけ存在する(回帰)'),
      (await page.locator('.pb-overlay__subtable-panel').count()) === 1);

    await page.locator('.pb-overlay__subtable-close').click();
    await page.waitForTimeout(300);

    // ── (3) 回帰: Enterキーでも1回だけ開く(enterEditMode経由のキーボード操作は変えていない) ──
    await armSubtableOpenCounter(page);
    await cell(page, 0, '明細').focus();
    await page.waitForTimeout(150);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(400);
    check(name('(3) Enterキー: openSubtableEditor の描画完了は1回だけ(回帰)'), (await openCount(page)) === 1);
    check(name('(3) Enterキー: モーダルパネルは1枚だけ存在する(回帰)'),
      (await page.locator('.pb-overlay__subtable-panel').count()) === 1);
  } finally {
    await ctx.close();
  }
}
