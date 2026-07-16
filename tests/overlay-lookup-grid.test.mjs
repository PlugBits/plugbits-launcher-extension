// 案A（グリッドのルックアップキー編集）+ 案D（ルックアップ一括再取得）の E2E検証。
import { openOverlay, cell } from './helpers/overlay-page.mjs';

// ── フィールド定義: 商品(ルックアップキー) / 担当者(コピー先=lookupAuto) ────
const FIELDS = [
  { code: '案件名', label: '案件名', type: 'SINGLE_LINE_TEXT', required: true, choices: [] },
  {
    code: '商品', label: '商品', type: 'SINGLE_LINE_TEXT', required: false, choices: [],
    lookup: { relatedApp: { app: '88' }, relatedKeyField: '商品名', lookupPickerFields: ['商品名'], fieldMappings: [{ field: '担当者', relatedField: '担当' }] }
  },
  { code: '担当者', label: '担当者', type: 'SINGLE_LINE_TEXT', required: false, choices: [], lookupAuto: true }
];

// ── 表示中ページのレコード（3件。うち1件はキー空 = 再取得の対象外になるはず） ──
const RECORDS = [
  { $id: { value: '101' }, $revision: { value: '1' }, 案件名: { value: '案件A' }, 商品: { value: '商品001' }, 担当者: { value: '初期担当A' } },
  { $id: { value: '102' }, $revision: { value: '1' }, 案件名: { value: '案件B' }, 商品: { value: '' }, 担当者: { value: '' } },
  { $id: { value: '103' }, $revision: { value: '1' }, 案件名: { value: '案件C' }, 商品: { value: '商品003' }, 担当者: { value: '初期担当C' } }
];

const LOOKUP_CANDIDATES = [
  { 商品名: { value: '商品001' }, 担当: { value: '担当X' } },
  { 商品名: { value: '商品002' }, 担当: { value: '担当Y' } },
  { 商品名: { value: '商品003' }, 担当: { value: '担当Z' } }
];

function buildBridge() {
  return `
window.__putCalls = [];
window.__unknownMessageTypes = [];
// 1回目のEXCEL_PUT_RECORDSだけ失敗させたいときに index を仕込む（救済リトライ検証用）
window.__failPutOnce = null;
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
    // アプリ全体シーク取得と表示中ページ取得を両方このRECORDSでまかなう(件数が少ないため)
    return reply({ ok: true, records: RECORDS, totalCount: RECORDS.length });
  }
  if (type === 'EXCEL_EVALUATE_RECORD_ACL') {
    const ids = Array.isArray(d.payload?.ids) ? d.payload.ids : [];
    return reply({ ok: true, rights: ids.map((id) => ({ id, editable: true, deletable: true, viewable: true })) });
  }
  if (type === 'EXCEL_GET_LOOKUP_CANDIDATES') {
    const kw = String(d.payload?.keyword || '');
    const filtered = kw ? CANDIDATES.filter((r) => r['商品名'].value.includes(kw)) : CANDIDATES;
    return reply({ ok: true, result: { records: filtered, totalCount: filtered.length } });
  }
  if (type === 'EXCEL_PUT_RECORDS') {
    const records = Array.isArray(d.payload?.records) ? d.payload.records : [];
    window.__putCalls.push({ records, __pbTrigger: d.payload?.__pbTrigger });
    if (window.__failPutOnce !== null) {
      const errorDetails = {};
      errorDetails['records[' + window.__failPutOnce + '].商品.value'] = { messages: ['参照先で一致するレコードがありません。'] };
      window.__failPutOnce = null;
      return reply({ ok: false, errorCode: 'GAIA_IL19', error: 'lookup error', errorDetails });
    }
    return reply({ ok: true, result: { records: records.map(() => ({ revision: '2' })) } });
  }
  if (type === 'EXCEL_GET_LOGIN_USER') return reply({ ok: true, user: { timezone: 'Asia/Tokyo' } });
  if (type === 'GET_APP_NAME') return reply({ ok: true, name: '受注管理' });
  if (type === 'EXCEL_GET_VIEW_INFO') return reply({ ok: false });
  if (type === 'EXCEL_GET_APP_ACL' || type === 'EXCEL_GET_RECORD_ACL' || type === 'EXCEL_GET_FIELD_ACL' || type === 'EXCEL_GET_VIEWS') {
    return reply({ ok: true, result: {} });
  }
  window.__unknownMessageTypes.push(type);
  reply({ ok: false });
});`;
}

export async function run({ browser, check }) {
  const name = (n) => `overlay-lookup-grid: ${n}`;
  const { ctx, page } = await openOverlay({ browser, bridgeScript: buildBridge(), deviceScaleFactor: 2 });
  try {
    const overlayVisible = await page.locator('#pb-excel-overlay, .pb-overlay').count();
    check(name('overlay opened (root element present)'), overlayVisible > 0);
    if (!overlayVisible) return;

    // 商品セル(行1, 案件A)を取得。列順は fields配列順 = 案件名, 商品, 担当者
    const getCell = (rowIndex, fieldCode) => cell(page, rowIndex, fieldCode);
    const shohinCell0 = getCell(0, '商品');
    const tantoshaCell0 = getCell(0, '担当者');

    // data-editable は権限判定の結果(getCellPermissionInfo)をそのまま反映する。
    // input.readOnly 自体は編集モードに入るまでtrueのままなので、ここでは
    // 「編集可能と判定されているか」をdatasetで確認する
    check(name('lookup key cell (商品) is marked editable by permission gate'), await shohinCell0.evaluate((el) => el.dataset.editable === 'true'));
    check(name('lookupAuto cell (担当者) is not editable'), await tantoshaCell0.evaluate((el) => el.dataset.editable !== 'true'));

    // 編集開始 → タイプで候補が出る。
    // 備考: dblclickで直接開始する経路は、案件名セル→商品セルへのクリックによる
    // フォーカス移動時にblurの巻き込みで編集が即終了してしまうバグが以前あったが、
    // dblclick-blur.test.mjs で回帰修正済み。本テストは実際のExcel的な操作
    // (セル選択→ArrowRightで移動→そのまま入力=type-to-replace)の経路を検証する
    await getCell(0, '案件名').click();
    await page.waitForTimeout(150);
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(150);
    await shohinCell0.pressSequentially('商品00', { delay: 20 });
    await page.waitForTimeout(600);
    // ルックアップキャッシュ改修(Tier0)で、自アプリの表示中行(101=商品001, 103=商品003)から
    // 集計した「このアプリで使用中」の頻出候補も同じ .pb-newrec__lookup-item クラスで先頭に
    // 表示されるようになった(どちらも"商品00"にマッチするため2件混ざる)。参照先から取得した
    // 通常候補だけを数えたいので、頻出アイテム(--frequent)を除外して数える。
    // 頻出セクション自体の詳細な検証は lookup-cache-e2e.test.mjs 側で行う
    check(name('typing in key cell shows candidates'), await page.locator('.pb-overlay__lookup-anchor .pb-newrec__lookup-item:not(.pb-newrec__lookup-item--frequent)').count() === 3);

    // ↓↓で2番目の候補(商品002。元の値=商品001とは異なる)まで移動 → Enterで確定してdirtyになる
    await shohinCell0.press('ArrowDown');
    await page.waitForTimeout(100);
    await shohinCell0.press('ArrowDown');
    await page.waitForTimeout(100);
    const activeBefore = await page.locator('.pb-overlay__lookup-anchor .pb-newrec__lookup-item--active').count();
    check(name('ArrowDown highlights a candidate'), activeBefore === 1);
    const highlightedValue = await page.locator('.pb-overlay__lookup-anchor .pb-newrec__lookup-item--active .pb-newrec__lookup-item-main').textContent();
    check(name('highlighted candidate differs from the original 商品001 value'), highlightedValue !== '商品001');
    await shohinCell0.press('Enter');
    await page.waitForTimeout(300);
    check(name('Enter applies highlighted candidate to the cell'), (await shohinCell0.inputValue()) === highlightedValue);
    check(name('picker closes after Enter'), await page.locator('.pb-overlay__lookup-anchor .pb-newrec__lookup-item').count() === 0);
    const cellDirty = await shohinCell0.evaluate((el) => el.closest('.pb-overlay__cell')?.classList.contains('pb-overlay__cell--dirty'));
    check(name('cell becomes dirty after picking a candidate'), Boolean(cellDirty));
    check(name('cell is still in edit mode after Enter (grid nav did not steal it)'), await shohinCell0.evaluate((el) => !el.readOnly));

    // Esc は候補だけ閉じて編集は継続する（まだ編集中のセルでArrowDownを押すと再オープンする）
    await shohinCell0.press('ArrowDown');
    await page.waitForTimeout(500);
    check(name('picker reopened before Escape test'), await page.locator('.pb-overlay__lookup-anchor .pb-newrec__lookup-item').count() > 0);
    await shohinCell0.press('Escape');
    await page.waitForTimeout(150);
    check(name('Escape closes only the picker (grid overlay stays open)'), await page.locator('#pb-excel-overlay, .pb-overlay').count() > 0);
    check(name('Escape closes only the picker, not the cell edit'), await page.locator('.pb-overlay__lookup-anchor .pb-newrec__lookup-item').count() === 0
      && await shohinCell0.evaluate((el) => !el.readOnly).catch(() => false));
    await shohinCell0.press('Escape'); // 2回目のEscでセル編集自体を抜けてクリーンアップ
    await page.waitForTimeout(150);

    // 保存 → EXCEL_PUT_RECORDS にキー値が入る
    await page.evaluate(() => { window.__putCalls.length = 0; });
    const saveBtn = page.locator('.pb-overlay__btn--primary', { hasText: /保存|Save/ });
    await saveBtn.click();
    await page.waitForTimeout(500);
    const putCallsAfterSave = await page.evaluate(() => window.__putCalls);
    check(name('save sends EXCEL_PUT_RECORDS'), putCallsAfterSave.length > 0);
    const savedShohinValue = putCallsAfterSave[0]?.records?.[0]?.record?.['商品']?.value;
    check(name('saved payload contains the picked 商品 key value'), typeof savedShohinValue === 'string' && savedShohinValue.length > 0);

    await page.waitForTimeout(500); // reloadPage完了待ち

    // ── 案D: ルックアップ再取得ボタン（表示中スコープ） ──
    // ツールバー整理により列表示/再計算/ルックアップ再取得は「ツール ▾」メニューに
    // 集約されたため、まずメニューを開いてから項目をクリックする
    await page.evaluate(() => { window.__putCalls.length = 0; });
    const toolMenuToggle = page.locator('.pb-overlay__tool-menu-toggle');
    const lookupRefreshBtn = page.locator('.pb-overlay__tool-menu-item', { hasText: /ルックアップ再取得|Refresh lookups/ });
    await toolMenuToggle.click();
    await page.waitForTimeout(200);
    check(name('tool menu opens with lookup refresh item visible (app has key fields)'), await lookupRefreshBtn.isVisible());
    await lookupRefreshBtn.click();
    await page.waitForTimeout(300);
    // スコープ確認ダイアログ: 表示中ページを選ぶ
    const scopePageBtn = page.locator('.pb-overlay__confirm-btn, button', { hasText: /表示中の|This page/ });
    check(name('scope confirm dialog shown'), await scopePageBtn.count() > 0);
    await scopePageBtn.first().click();
    await page.waitForTimeout(800);
    const refreshPutCalls = await page.evaluate(() => window.__putCalls);
    check(name('lookup refresh sends EXCEL_PUT_RECORDS'), refreshPutCalls.length > 0);
    const refreshRecords = refreshPutCalls[0]?.records || [];
    check(name('lookup refresh trigger tag is lookup_refresh_click'), refreshPutCalls[0]?.__pbTrigger === 'lookup_refresh_click');
    check(name('lookup refresh payload count = 2 (key-empty record excluded)'), refreshRecords.length === 2);
    const rec101 = refreshRecords.find((r) => r.id === '101');
    check(
      name('lookup refresh payload shape is {id, record:{商品:{value:現在値}}}'),
      Boolean(rec101) && rec101.record && Object.keys(rec101.record).length === 1
        && typeof rec101.record['商品']?.value === 'string' && rec101.record['商品'].value.length > 0
    );
    const rec102Present = refreshRecords.some((r) => r.id === '102');
    check(name('key-empty record (102) is excluded from lookup refresh payload'), !rec102Present);

    await page.waitForTimeout(500);

    // ── 救済リトライ: 1バッチ目をerrorDetails付きで失敗させ、リトライPUTから該当indexが除外される ──
    await page.evaluate(() => {
      window.__putCalls.length = 0;
      window.__failPutOnce = 0; // 次のEXCEL_PUT_RECORDSはindex0のレコードだけエラーにする
    });
    // 前回のクリックでメニューは閉じているため再度開く
    await toolMenuToggle.click();
    await page.waitForTimeout(200);
    await lookupRefreshBtn.click();
    await page.waitForTimeout(300);
    const scopePageBtn2 = page.locator('.pb-overlay__confirm-btn, button', { hasText: /表示中の|This page/ });
    await scopePageBtn2.first().click();
    await page.waitForTimeout(1000);
    const retryPutCalls = await page.evaluate(() => window.__putCalls);
    check(name('rescue retry issues a second EXCEL_PUT_RECORDS call'), retryPutCalls.length === 2);
    if (retryPutCalls.length === 2) {
      const firstCallIds = retryPutCalls[0].records.map((r) => r.id);
      const retryCallIds = retryPutCalls[1].records.map((r) => r.id);
      check(name('first call included the record that will fail (101 at index 0)'), firstCallIds[0] === '101');
      check(name('retry call excludes the failed index (101) and keeps the rest'), !retryCallIds.includes('101') && retryCallIds.includes('103'));
    }
  } finally {
    await ctx.close();
  }
}
