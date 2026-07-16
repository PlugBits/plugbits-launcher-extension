// ルックアップ候補の3階層化（Tier0頻出 / Tier1タブキャッシュ / Tier2 like検索）のE2E検証。
import { openOverlay, cell } from './helpers/overlay-page.mjs';

// ── フィールド定義: 商品(ルックアップキー、関連アプリ88) ──
const FIELDS = [
  { code: '案件名', label: '案件名', type: 'SINGLE_LINE_TEXT', required: true, choices: [] },
  {
    code: '商品', label: '商品', type: 'SINGLE_LINE_TEXT', required: false, choices: [],
    lookup: { relatedApp: { app: '88' }, relatedKeyField: '商品名', lookupPickerFields: ['商品名'], fieldMappings: [] }
  }
];

// ── 表示中ページの3行。商品001が2件・商品002が1件 → 頻出は 商品001(2回) > 商品002(1回) の順 ──
const RECORDS = [
  { $id: { value: '301' }, $revision: { value: '1' }, 案件名: { value: '案件A' }, 商品: { value: '商品001' } },
  { $id: { value: '302' }, $revision: { value: '1' }, 案件名: { value: '案件B' }, 商品: { value: '商品001' } },
  { $id: { value: '303' }, $revision: { value: '1' }, 案件名: { value: '案件C' }, 商品: { value: '商品002' } }
];

// 参照先(app 88)の候補。3件のみ(全件ローカル化にはしない検証パターンではないため件数は重要でない)
const LOOKUP_CANDIDATES = [
  { 商品名: { value: '商品001' } },
  { 商品名: { value: '商品002' } },
  { 商品名: { value: '商品003' } }
];

function buildBridge() {
  return `
window.__lookupCalls = 0;
const RECORDS = ${JSON.stringify(RECORDS)};
const CANDIDATES = ${JSON.stringify(LOOKUP_CANDIDATES)};
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
    window.__lookupCalls += 1;
    const kw = String(d.payload?.keyword || '');
    const filtered = kw ? CANDIDATES.filter((r) => r['商品名'].value.includes(kw)) : CANDIDATES;
    return reply({ ok: true, result: { records: filtered, totalCount: filtered.length } });
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
  const name = (n) => `lookup-cache-e2e: ${n}`;
  const { ctx, page } = await openOverlay({ browser, bridgeScript: buildBridge(), deviceScaleFactor: 2 });
  try {
    const overlayVisible = await page.locator('#pb-excel-overlay, .pb-overlay').count();
    check(name('overlay opened (root element present)'), overlayVisible > 0);
    if (!overlayVisible) return;

    const getCell = (rowIndex, fieldCode) => cell(page, rowIndex, fieldCode);
    const anchor = () => page.locator('.pb-overlay__lookup-anchor');
    const regularItems = () => anchor().locator('.pb-newrec__lookup-item:not(.pb-newrec__lookup-item--frequent)');
    const frequentItems = () => anchor().locator('.pb-newrec__lookup-item--frequent');
    const lookupCalls = () => page.evaluate(() => window.__lookupCalls);

    // セルを編集状態にして、キーワードなしの「ブラウズ」状態を開く。
    // 隣の案件名セルをクリック→ArrowRightで移動する(overlay-lookup-grid.test.mjsと同じ理由)。
    // Enterで編集開始すると既存値が全選択された状態になる(Excel互換のselectAll)ので、
    // Backspaceで空にしてから'input'イベント経由でsearch('')→keyword-less loadに繋げる
    // (スペース1文字は type-to-replace の対象外として明示的に除外されているため使えない)
    async function openBrowseOnRow(rowIndex) {
      await getCell(rowIndex, '案件名').click();
      await page.waitForTimeout(120);
      await page.keyboard.press('ArrowRight');
      await page.waitForTimeout(120);
      await getCell(rowIndex, '商品').press('Enter');
      await page.waitForTimeout(150);
      await getCell(rowIndex, '商品').press('Backspace');
      await page.waitForTimeout(600);
    }

    // ── ① 1セル目: キーワードなしブラウズを開く。頻出(Tier0・APIゼロ)と通常候補が並ぶ ──
    await openBrowseOnRow(0);
    check(name('row0: regular candidates from related app shown (3)'), await regularItems().count() === 3);
    check(name('row0: frequent section shows both used values (2)'), await frequentItems().count() === 2);
    const freqTexts0 = await frequentItems().locator('.pb-newrec__lookup-item-main').allTextContents();
    check(name('row0: frequent values ordered by count desc (商品001x2 before 商品002x1)'), JSON.stringify(freqTexts0) === JSON.stringify(['商品001', '商品002']));
    const freqSub0 = await frequentItems().locator('.pb-newrec__lookup-item-sub').allTextContents();
    check(name('row0: frequent count label reflects usage (2回/1回)'), freqSub0[0].includes('2') && freqSub0[1].includes('1'));
    const callsAfterRow0 = await lookupCalls();
    check(name('row0: exactly 1 API call for the keyword-less fetch'), callsAfterRow0 === 1);

    // 後始末: Escapeでピッカーを閉じてから、セル編集そのものも抜ける
    await getCell(0, '商品').press('Escape');
    await page.waitForTimeout(150);
    await getCell(0, '商品').press('Escape');
    await page.waitForTimeout(150);

    // ── ② 2セル目(別の行・同じ列): 同じ条件でブラウズを開いてもAPIは増えない(Tier1キャッシュ) ──
    await openBrowseOnRow(2);
    check(name('row2: regular candidates shown from cache (3)'), await regularItems().count() === 3);
    check(name('row2: frequent section still shows both values (2)'), await frequentItems().count() === 2);
    const callsAfterRow2 = await lookupCalls();
    check(name('row2: API call count unchanged (served from Tier1 cache)'), callsAfterRow2 === callsAfterRow0);

    // ── ③ 頻出アイテムをクリック → セルに値が入りdirtyになる ──
    await frequentItems().first().click();
    await page.waitForTimeout(300);
    check(name('row2: clicking frequent item fills the cell value'), (await getCell(2, '商品').inputValue()) === '商品001');
    const row2Dirty = await getCell(2, '商品').evaluate((el) => el.closest('.pb-overlay__cell')?.classList.contains('pb-overlay__cell--dirty'));
    check(name('row2: cell becomes dirty after frequent pick'), Boolean(row2Dirty));
    check(name('row2: picker closes after frequent pick'), await anchor().locator('.pb-newrec__lookup-item').count() === 0);

    await getCell(2, '商品').press('Escape');
    await page.waitForTimeout(150);

    // ── ④ 別セル(3行目)で頻出アイテムへ↓キーで移動しEnterで確定できる ──
    await openBrowseOnRow(1);
    check(name('row1: frequent section shown before any ArrowDown'), await frequentItems().count() === 2);
    await getCell(1, '商品').press('ArrowDown');
    await page.waitForTimeout(100);
    const activeMain = await anchor().locator('.pb-newrec__lookup-item--active .pb-newrec__lookup-item-main').textContent();
    check(name('row1: ArrowDown highlights the first frequent item (商品001)'), activeMain === '商品001');
    await getCell(1, '商品').press('Enter');
    await page.waitForTimeout(300);
    check(name('row1: Enter on highlighted frequent item fills the cell'), (await getCell(1, '商品').inputValue()) === '商品001');
    check(name('row1: picker closes after Enter on frequent item'), await anchor().locator('.pb-newrec__lookup-item').count() === 0);
    const callsAfterRow1 = await lookupCalls();
    check(name('row1: still no extra API call (frequent picks never touch the API)'), callsAfterRow1 === callsAfterRow0);

    // ── ⑤ 「再読込」: キャッシュ提供中に出るリンクをクリックするとAPIが1回増え、表示が更新される ──
    // row1のセルはEnter確定後も編集状態が続く。値は"商品001"(直前のfrequent pick結果)に
    // なっているので、キーワードなしブラウズに戻すためもう一度空にしてから開き直す
    await getCell(1, '商品').fill('');
    await page.waitForTimeout(600);
    check(name('reload: cache line visible when candidates are served from cache'), await anchor().locator('.pb-newrec__lookup-cacheline').isVisible());
    const reloadBtn = anchor().locator('.pb-newrec__lookup-reload');
    check(name('reload: reload link visible'), await reloadBtn.count() === 1);
    await reloadBtn.click();
    await page.waitForTimeout(400);
    const callsAfterReload = await lookupCalls();
    check(name('reload: API call count increases by exactly 1'), callsAfterReload === callsAfterRow0 + 1);
    check(name('reload: candidates still render after refetch (3)'), await regularItems().count() === 3);

    await getCell(1, '商品').press('Escape');
    await page.waitForTimeout(150);
    await getCell(1, '商品').press('Escape');
    await page.waitForTimeout(150);
  } finally {
    await ctx.close();
  }
}
