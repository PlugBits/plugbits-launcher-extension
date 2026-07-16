// Quick New Record (QNR) モーダルの基本フロー検証: 必須エラー、サーバーエラー
// (フィールド単位)、保存して次へ、破棄確認、Ctrl+Enter保存のキー配線。
import { openQnr } from './helpers/overlay-page.mjs';

const FIELDS = [
  { code: '案件名', label: '案件名', type: 'SINGLE_LINE_TEXT', required: true, choices: [] },
  { code: '種別', label: '種別', type: 'DROP_DOWN', required: true, choices: ['新規', '継続', '保守'] },
  { code: '受注日', label: '受注日', type: 'DATE', required: false, choices: [], defaultNowValue: true },
  { code: '数量', label: '数量', type: 'NUMBER', required: false, choices: [] },
  { code: '詳細', label: '詳細', type: 'MULTI_LINE_TEXT', required: false, choices: [] }
];

function buildBridge() {
  return `
window.__postCount = 0;
window.addEventListener('message', (ev) => {
  const d = ev.data || {};
  if (!d || d.__kfav__ !== true || !d.id || d.replyTo) return;
  const reply = (extra) => window.postMessage({ __kfav__: true, replyTo: d.id, ...extra }, location.origin);
  if (d.type === 'EXCEL_GET_FIELDS_META') return reply({ ok: true, fieldsMeta: ${JSON.stringify(FIELDS)} });
  if (d.type === 'EXCEL_GET_LOGIN_USER') return reply({ ok: true, user: { timezone: 'Asia/Tokyo' } });
  if (d.type === 'GET_APP_NAME') return reply({ ok: true, name: '受注管理（顧客サポートパック）' });
  if (d.type === 'EXCEL_POST_RECORDS') {
    window.__postCount += 1;
    const qty = d.payload?.records?.[0]?.['数量']?.value;
    if (qty === '999') {
      return reply({ ok: false, error: '入力内容が正しくありません。', errorDetails: { 'records[0].数量.value': { messages: ['最大値は100です。'] } } });
    }
    return reply({ ok: true, result: { ids: ['1'], revisions: ['1'] } });
  }
  reply({ ok: false });
});`;
}

export async function run({ browser, check }) {
  const name = (n) => `qnr-modal-flow: ${n}`;
  const { ctx, page } = await openQnr({ browser, bridgeScript: buildBridge(), viewport: { width: 1000, height: 760 }, deviceScaleFactor: 2 });
  try {
    // 1. アプリ名表示 + 3ボタン
    check(name('app name shown'), (await page.locator('.pb-newrec__app').textContent().catch(() => '')).includes('受注管理'));
    check(name('save-next button exists'), await page.getByRole('button', { name: '保存して次へ' }).count() === 1);

    // 2. 必須エラー: 空のまま保存
    await page.getByRole('button', { name: '保存', exact: true }).click();
    await page.waitForTimeout(400);
    check(name('required error rows = 2'), await page.locator('.pb-newrec__field-row--error').count() === 2);
    check(name('no POST fired'), await page.evaluate(() => window.__postCount) === 0);

    // 3. サーバーエラー: 数量999でフィールド単位エラー
    await page.locator('.pb-newrec__field-row', { hasText: '案件名' }).locator('input').fill('テスト案件');
    await page.locator('.pb-newrec__field-row', { hasText: '種別' }).locator('select').selectOption('新規');
    await page.locator('.pb-newrec__field-row', { hasText: '数量' }).locator('input').fill('999');
    await page.getByRole('button', { name: '保存', exact: true }).click();
    await page.waitForTimeout(500);
    check(name('server field error shown'), (await page.locator('.pb-newrec__field-error').allTextContents()).join(' ').includes('最大値は100です'));

    // 4. 保存して次へ: フォームがリセットされモーダルは開いたまま
    await page.locator('.pb-newrec__field-row', { hasText: '数量' }).locator('input').fill('5');
    await page.getByRole('button', { name: '保存して次へ' }).click();
    await page.waitForTimeout(600);
    check(name('modal still open'), await page.locator('.pb-newrec__layer').count() === 1);
    check(name('form reset (案件名 empty)'), (await page.locator('.pb-newrec__field-row', { hasText: '案件名' }).locator('input').inputValue()) === '');
    check(name('POST fired twice'), await page.evaluate(() => window.__postCount) === 2);

    // 5. 破棄確認: 入力してからEsc
    await page.locator('.pb-newrec__field-row', { hasText: '案件名' }).locator('input').fill('途中入力');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    check(name('discard confirm shown'), await page.locator('.pb-overlay__confirm-layer').count() === 1);
    // キャンセル → モーダル維持、入力も残る
    await page.getByRole('button', { name: 'キャンセル' }).last().click();
    await page.waitForTimeout(200);
    check(name('modal kept after cancel'), await page.locator('.pb-newrec__layer').count() === 1);
    check(name('input preserved'), (await page.locator('.pb-newrec__field-row', { hasText: '案件名' }).locator('input').inputValue()) === '途中入力');
    // もう一度Esc → 破棄して閉じる（保存済みがあるためリロードが走る）
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    await page.getByRole('button', { name: '破棄して閉じる' }).click();
    // 保存済みがあるため一覧リロードが走る（期待どおり）→ ロード完了を待つ
    await page.waitForLoadState('load');
    await page.waitForTimeout(300);
    check(name('modal closed (page reloaded)'), await page.locator('.pb-newrec__layer').count() === 0);

    // 6. Ctrl+Enter保存（リロード後なのでcontent.jsを再注入して再オープン。
    //    空のまま → 必須エラーで止まる=配線確認）
    await page.addScriptTag({ url: 'https://demo.cybozu.com/content.js' });
    await page.waitForTimeout(400);
    await page.keyboard.press('Shift+Alt+KeyN');
    await page.waitForTimeout(800);
    await page.keyboard.press('Control+Enter');
    await page.waitForTimeout(300);
    check(name('Ctrl+Enter wired (required error)'), await page.locator('.pb-newrec__field-row--error').count() === 2);
  } finally {
    await ctx.close();
  }
}
