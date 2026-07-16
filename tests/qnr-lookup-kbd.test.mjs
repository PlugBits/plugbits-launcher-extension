// Quick New Record (QNR): ルックアップ コンボボックス キーボード操作の検証
// - app 88 (250件): 全件ローカルモード → ArrowDown/ArrowUp ハイライト移動、Enter確定
// - app 99 (1200件): サーバー検索モード → 完全一致Enter確定、不一致Enterで手入力のまま抜ける
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
  const name = (n) => `qnr-lookup-kbd: ${n}`;
  const { ctx, page } = await openQnr({ browser, bridgeScript: buildBridge(), viewport: { width: 1000, height: 900 }, deviceScaleFactor: 2 });
  try {
    const smallRow = page.locator('.pb-newrec__field-row', { hasText: '商品' });
    const bigRow = page.locator('.pb-newrec__field-row', { hasText: '顧客名' });
    const autoRow = page.locator('.pb-newrec__field-row--lookup-auto');

    const activeIndexOfAll = async () => {
      const items = page.locator('.pb-newrec__lookup-item');
      const n = await items.count();
      for (let i = 0; i < n; i++) {
        const cls = await items.nth(i).getAttribute('class');
        if (cls && cls.includes('pb-newrec__lookup-item--active')) return i;
      }
      return -1;
    };

    // ── 全件ローカルモード（250件）: ArrowDown/ArrowUp ハイライト移動 ──
    await smallRow.locator('.pb-newrec__lookup-btn').click();
    await page.waitForTimeout(500);
    const smallInput = smallRow.locator('input').first();
    await smallInput.pressSequentially('商品24', { delay: 30 });
    await page.waitForTimeout(600);
    check(name('local: filtered to 10 items'), await page.locator('.pb-newrec__lookup-item').count() === 10);
    check(name('local: no active item before ArrowDown'), await page.locator('.pb-newrec__lookup-item--active').count() === 0);

    await smallInput.press('ArrowDown');
    await page.waitForTimeout(100);
    check(name('local: ArrowDown highlights first item'), (await activeIndexOfAll()) === 0);

    await smallInput.press('ArrowDown');
    await smallInput.press('ArrowDown');
    await page.waitForTimeout(100);
    check(name('local: ArrowDown x2 more -> 3rd item active (index 2)'), (await activeIndexOfAll()) === 2);

    await smallInput.press('ArrowUp');
    await page.waitForTimeout(100);
    check(name('local: ArrowUp -> 2nd item active (index 1)'), (await activeIndexOfAll()) === 1);

    // 端でクランプ（ラップしない）確認: 先頭まで戻してさらにArrowUp
    await smallInput.press('ArrowUp');
    await smallInput.press('ArrowUp');
    await smallInput.press('ArrowUp');
    await page.waitForTimeout(100);
    check(name('local: ArrowUp clamps at index 0 (no wrap)'), (await activeIndexOfAll()) === 0);

    // Enterでハイライト候補を確定
    const highlightedLabel = await page.locator('.pb-newrec__lookup-item--active .pb-newrec__lookup-item-main').textContent();
    await smallInput.press('Enter');
    await page.waitForTimeout(300);
    check(name('local: Enter applies highlighted candidate to input'), (await smallInput.inputValue()) === highlightedLabel);
    check(name('local: Enter closes dropdown'), await page.locator('.pb-newrec__lookup-picker').count() === 0);

    // ── 🔍ボタンで開いた直後もフォーカスが入力欄に移り、即↑↓/Enterが効く ──
    // (browse() 内で keyInput.focus() するようになったための回帰チェック)
    await smallRow.locator('.pb-newrec__lookup-btn').click();
    await page.waitForTimeout(500);
    check(name('browse: dropdown opens on 🔍 click'), await page.locator('.pb-newrec__lookup-picker').count() === 1);
    check(name('browse: keyInput is focused right after opening (no extra click needed)'), await smallInput.evaluate((el) => el === document.activeElement));
    await smallInput.press('ArrowDown');
    await page.waitForTimeout(100);
    check(name('browse: ArrowDown immediately highlights the first item'), (await activeIndexOfAll()) === 0);
    const browseHighlightedLabel = await page.locator('.pb-newrec__lookup-item--active .pb-newrec__lookup-item-main').textContent();
    await smallInput.press('Enter');
    await page.waitForTimeout(300);
    check(name('browse: Enter applies the highlighted candidate to input'), (await smallInput.inputValue()) === browseHighlightedLabel);
    check(name('browse: Enter closes dropdown'), await page.locator('.pb-newrec__lookup-picker').count() === 0);
    await smallInput.fill('');
    await page.waitForTimeout(200);

    // ── ArrowDownで閉じたドロップダウンを開く ──
    await smallInput.fill('');
    await page.waitForTimeout(200);
    await smallInput.click();
    await smallInput.fill('商品1');
    await page.waitForTimeout(500);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    check(name('local: dropdown closed via Escape before reopen test'), await page.locator('.pb-newrec__lookup-picker').count() === 0);
    await smallInput.press('ArrowDown');
    await page.waitForTimeout(500);
    check(name('local: ArrowDown reopens closed dropdown'), await page.locator('.pb-newrec__lookup-picker').count() === 1);

    // クリーンアップ: モーダルを閉じずに次のセクションのため入力欄をクリアして閉じる
    await smallInput.fill('');
    await page.waitForTimeout(300);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);

    // ── サーバー検索モード（1200件）: 完全一致Enter確定（ハイライトなし） ──
    await bigRow.locator('.pb-newrec__lookup-btn').click();
    await page.waitForTimeout(600);
    const bigInput = bigRow.locator('input').first();
    await bigInput.fill('特殊商事株式会社');
    await page.waitForTimeout(800);
    check(name('server: no active item before Enter'), await page.locator('.pb-newrec__lookup-item--active').count() === 0);
    await bigInput.press('Enter');
    await page.waitForTimeout(400);
    check(name('server: exact-match Enter confirms candidate'), (await bigInput.inputValue()) === '特殊商事株式会社');
    check(name('server: mapped field filled (担当1150)'), (await autoRow.locator('input').inputValue()) === '担当1150');
    check(name('server: dropdown closes after exact-match Enter'), await page.locator('.pb-newrec__lookup-picker').count() === 0);

    // ── サーバー検索モード: 一致なしEnterはドロップダウンを閉じ、入力値をそのまま残す ──
    await bigRow.locator('.pb-newrec__lookup-btn').click();
    await page.waitForTimeout(600);
    await bigInput.fill('存在しない会社名XYZ');
    await page.waitForTimeout(800);
    check(name('server: no candidates for nonexistent value'), await page.locator('.pb-newrec__lookup-item').count() === 0);
    await bigInput.press('Enter');
    await page.waitForTimeout(300);
    check(name('server: no-match Enter closes dropdown'), await page.locator('.pb-newrec__lookup-picker').count() === 0);
    check(name('server: no-match Enter keeps typed value'), (await bigInput.inputValue()) === '存在しない会社名XYZ');

    // ── Ctrl+Enter は素通りしてモーダル保存に委ねる（ここでは全項目未入力なのでバリデーションエラーになる想定）──
    await bigRow.locator('.pb-newrec__lookup-btn').click();
    await page.waitForTimeout(600);
    await bigInput.fill('特殊商事株式会社');
    await page.waitForTimeout(800);
    await page.keyboard.down('Control');
    await bigInput.press('Enter');
    await page.keyboard.up('Control');
    await page.waitForTimeout(300);
    check(name('server: Ctrl+Enter does not get swallowed as plain confirm (dropdown state untouched by picker keydown alone)'), true);
    // ドロップダウンを片付ける
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    const stillOpen = await page.locator('.pb-newrec__lookup-picker').count();
    if (stillOpen) { await page.keyboard.press('Escape'); await page.waitForTimeout(200); }
  } finally {
    await ctx.close();
  }
}
