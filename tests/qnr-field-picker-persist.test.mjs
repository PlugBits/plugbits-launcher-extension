// Quick New Record (QNR): QUICK_NEW_FIELDS_KEY に既存の専用設定がある状態で
// モーダルを新規に開いたときの挙動。
// - 開いた瞬間からプリセットではなく専用設定の項目/順序が使われる
// - 設定に入っていない必須フィールド(種別)は、従来のプリセット未収録時と同じく
//   表示も必須チェックもされない(保存ブロックされない)
import { openQnrContext, ORIGIN } from './helpers/overlay-page.mjs';

const APP_KEY = `${ORIGIN}::12`;

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
  if (d.type === 'GET_APP_NAME') return reply({ ok: true, name: '受注管理' });
  if (d.type === 'EXCEL_POST_RECORDS') { window.__postCount += 1; return reply({ ok: true, result: { ids: ['1'], revisions: ['1'] } }); }
  reply({ ok: false });
});`;
}

export async function run({ browser, check }) {
  const name = (n) => `qnr-field-picker-persist: ${n}`;
  const { ctx, page } = await openQnrContext({ browser, bridgeScript: buildBridge(), viewport: { width: 1000, height: 900 }, deviceScaleFactor: 2 });
  try {
    // content.js 読み込み後・モーダルを開く前に、専用設定を事前投入する
    // (必須フィールド「種別」を含めない点に注目: プリセット未収録時と同じ扱いになるはず)
    await page.evaluate(({ key, appKey }) => {
      return window.chrome.storage.local.set({
        [key]: { [appKey]: { fields: ['受注日', '案件名'], updatedAt: Date.now() } }
      });
    }, { key: 'kfavQuickNewFields', appKey: APP_KEY });

    await page.keyboard.press('Shift+Alt+KeyN');
    await page.waitForTimeout(900);

    check(name('modal opened'), await page.locator('.pb-newrec__layer').count() === 1);
    check(name('custom label shown from the start'), await page.locator('.pb-newrec__fields-custom-label').isVisible());
    check(name('preset select hidden from the start'), !(await page.locator('.pb-newrec__preset-select').isVisible()));

    const labels = (await page.locator('.pb-newrec__body .pb-newrec__label').allTextContents()).map((t) => t.trim());
    check(name('only the 2 configured fields shown, in configured order (受注日,案件名)'),
      labels.length === 2 && labels[0].startsWith('受注日') && labels[1].startsWith('案件名'));

    // 必須フィールド「種別」は設定に入っていないので表示されず、保存もブロックされない
    // (Excel Overlay のプリセット未収録時と同じ既存挙動)。
    // 「保存して次へ」を使い、リロードを伴わずに結果を確認する
    await page.locator('.pb-newrec__field-row', { hasText: '案件名' }).locator('input').fill('テスト案件');
    await page.getByRole('button', { name: '保存して次へ' }).click();
    await page.waitForTimeout(500);
    check(name('required field not in config does not block save'), await page.evaluate(() => window.__postCount) === 1);
    check(name('no required-field error rows shown'), await page.locator('.pb-newrec__field-row--error').count() === 0);
    check(name('modal still open (keepOpen)'), await page.locator('.pb-newrec__layer').count() === 1);
  } finally {
    await ctx.close();
  }
}
