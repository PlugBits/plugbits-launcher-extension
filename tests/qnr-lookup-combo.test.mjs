// Quick New Record (QNR): ルックアップ コンボボックス化の検証
// - app 88 (250件): 全件ローカルモード（初回1リクエスト、以後の絞り込みはAPIゼロ）
// - app 99 (1200件): サーバー検索モード（タイプアヘッド + 無限スクロール）
import { openQnr } from './helpers/overlay-page.mjs';

const FIELDS = [
  { code: '案件名', label: '案件名', type: 'SINGLE_LINE_TEXT', required: true, choices: [] },
  { code: '商品', label: '商品', type: 'SINGLE_LINE_TEXT', required: false, choices: [],
    lookup: { relatedApp: { app: '88' }, relatedKeyField: '商品名', lookupPickerFields: ['商品名'], fieldMappings: [] } },
  { code: '顧客名', label: '顧客名', type: 'SINGLE_LINE_TEXT', required: false, choices: [],
    lookup: { relatedApp: { app: '99' }, relatedKeyField: '会社名', lookupPickerFields: ['会社名', '担当'], fieldMappings: [{ field: '担当者', relatedField: '担当' }] } },
  { code: '担当者', label: '担当者', type: 'SINGLE_LINE_TEXT', required: false, choices: [], lookupAuto: true }
];

function buildBridge() {
  return `
window.__lookupCalls = { '88': 0, '99': 0 };
const SMALL = Array.from({ length: 250 }, (_, i) => ({ '商品名': { value: '商品' + String(i + 1).padStart(3, '0') } }));
const BIG = Array.from({ length: 1200 }, (_, i) => {
  const n = i + 1;
  const name = n === 1150 ? '特殊商事株式会社' : ('株式会社テスト' + String(n).padStart(4, '0'));
  return { '会社名': { value: name }, '担当': { value: '担当' + n } };
});
window.addEventListener('message', (ev) => {
  const d = ev.data || {};
  if (!d || d.__kfav__ !== true || !d.id || d.replyTo) return;
  const reply = (extra) => window.postMessage({ __kfav__: true, replyTo: d.id, ...extra }, location.origin);
  if (d.type === 'EXCEL_GET_FIELDS_META') return reply({ ok: true, fieldsMeta: ${JSON.stringify(FIELDS)} });
  if (d.type === 'EXCEL_GET_LOGIN_USER') return reply({ ok: true, user: { timezone: 'Asia/Tokyo' } });
  if (d.type === 'GET_APP_NAME') return reply({ ok: true, name: '受注管理' });
  if (d.type === 'EXCEL_GET_LOOKUP_CANDIDATES') {
    const appId = String(d.payload?.relatedAppId || '');
    window.__lookupCalls[appId] = (window.__lookupCalls[appId] || 0) + 1;
    const source = appId === '88' ? SMALL : BIG;
    const keyF = appId === '88' ? '商品名' : '会社名';
    const kw = String(d.payload?.keyword || '');
    const offset = Number(d.payload?.offset) || 0;
    const limit = Number(d.payload?.limit) || 500;
    const filtered = kw ? source.filter((r) => r[keyF].value.includes(kw)) : source;
    return reply({ ok: true, result: { records: filtered.slice(offset, offset + limit), totalCount: filtered.length } });
  }
  reply({ ok: false });
});`;
}

export async function run({ browser, check }) {
  const name = (n) => `qnr-lookup-combo: ${n}`;
  const { ctx, page } = await openQnr({ browser, bridgeScript: buildBridge(), viewport: { width: 1000, height: 900 }, deviceScaleFactor: 2 });
  try {
    const smallRow = page.locator('.pb-newrec__field-row', { hasText: '商品' });
    const bigRow = page.locator('.pb-newrec__field-row', { hasText: '顧客名' });
    const autoRow = page.locator('.pb-newrec__field-row--lookup-auto');
    const calls = () => page.evaluate(() => window.__lookupCalls);

    // ── 全件ローカルモード（250件）──
    await smallRow.locator('.pb-newrec__lookup-btn').click();
    await page.waitForTimeout(500);
    check(name('local: all 250 shown at once'), await page.locator('.pb-newrec__lookup-item').count() === 250);
    check(name('local: no count line (complete)'), (await page.locator('.pb-newrec__lookup-count').textContent()) === '');
    const callsAfterOpen = (await calls())['88'];
    // タイプアヘッド絞り込み → API増えない
    await smallRow.locator('input').first().pressSequentially('商品24', { delay: 30 });
    await page.waitForTimeout(600);
    check(name('local: instant filter to 10 items'), await page.locator('.pb-newrec__lookup-item').count() === 10);
    check(name('local: zero extra API calls'), (await calls())['88'] === callsAfterOpen);
    // 完全一致インジケータ
    await smallRow.locator('input').first().fill('商品240');
    await page.waitForTimeout(600);
    check(name('local: match indicator'), (await page.locator('.pb-newrec__lookup-indicator').textContent()).includes('一致しています'));
    await smallRow.locator('input').first().fill('存在しない商品');
    await page.waitForTimeout(600);
    check(name('local: no-match indicator'), (await page.locator('.pb-newrec__lookup-indicator').textContent()).includes('見つかりません'));
    await smallRow.locator('input').first().fill('');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    check(name('esc closes dropdown only (modal stays)'), await page.locator('.pb-newrec__layer').count() === 1
      && await page.locator('.pb-newrec__lookup-picker').count() === 0);

    // ── サーバー検索モード（1200件）──
    await bigRow.locator('.pb-newrec__lookup-btn').click();
    await page.waitForTimeout(600);
    check(name('server: first 500 shown'), await page.locator('.pb-newrec__lookup-item').count() === 500);
    check(name('server: count line'), (await page.locator('.pb-newrec__lookup-count').textContent()).includes('1200'));
    // 無限スクロール
    await page.locator('.pb-newrec__lookup-list').evaluate((el) => { el.scrollTop = el.scrollHeight; });
    await page.waitForTimeout(700);
    check(name('server: infinite scroll appends'), await page.locator('.pb-newrec__lookup-item').count() === 1000);
    // タイプアヘッドで1150件目に到達
    await bigRow.locator('input').first().pressSequentially('特殊', { delay: 40 });
    await page.waitForTimeout(800);
    check(name('server: typeahead reaches record #1150'), await page.locator('.pb-newrec__lookup-item').count() === 1
      && (await page.locator('.pb-newrec__lookup-item-main').first().textContent()).includes('特殊商事'));
    // 完全一致まで打ち切るとインジケータ✓ + コピー先が埋まる
    await bigRow.locator('input').first().fill('特殊商事株式会社');
    await page.waitForTimeout(800);
    check(name('server: exact match indicator'), (await page.locator('.pb-newrec__lookup-indicator').textContent()).includes('一致しています'));
    check(name('server: mapped filled on exact match'), (await autoRow.locator('input').inputValue()) === '担当1150');
    // 候補クリックで確定
    await page.locator('.pb-newrec__lookup-item').first().click();
    await page.waitForTimeout(300);
    check(name('server: pick closes picker'), await page.locator('.pb-newrec__lookup-picker').count() === 0);
  } finally {
    await ctx.close();
  }
}
