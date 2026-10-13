// Quick New Record (QNR): 「項目を選ぶ」(Quick New専用の項目設定)の検証。
// - 設定なし: 従来どおり Excel Overlay のレイアウトプリセットから表示
// - 保存: 選んだ項目の順序/表示がフォームに反映され、QUICK_NEW_FIELDS_KEY に永続化される
// - 0件選択: 保存をブロックし「1つ以上選んでください」を表示
// - リセット: 「Excel Overlay の列に戻す」で専用設定を削除し、プリセット表示に戻る
// - Esc: パネルだけを閉じ、モーダル自体は閉じない
import { openQnr } from './helpers/overlay-page.mjs';

const APP_KEY = 'https://demo.cybozu.com::12';

const FIELDS = [
  { code: '案件名', label: '案件名', type: 'SINGLE_LINE_TEXT', required: true, choices: [] },
  { code: '種別', label: '種別', type: 'DROP_DOWN', required: true, choices: ['新規', '継続', '保守'] },
  { code: '受注日', label: '受注日', type: 'DATE', required: false, choices: [], defaultNowValue: true },
  { code: '数量', label: '数量', type: 'NUMBER', required: false, choices: [] },
  { code: '詳細', label: '詳細', type: 'MULTI_LINE_TEXT', required: false, choices: [] }
];

function buildBridge() {
  return `
window.addEventListener('message', (ev) => {
  const d = ev.data || {};
  if (!d || d.__kfav__ !== true || !d.id || d.replyTo) return;
  const reply = (extra) => window.postMessage({ __kfav__: true, replyTo: d.id, ...extra }, location.origin);
  if (d.type === 'EXCEL_GET_FIELDS_META') return reply({ ok: true, fieldsMeta: ${JSON.stringify(FIELDS)} });
  if (d.type === 'EXCEL_GET_LOGIN_USER') return reply({ ok: true, user: { timezone: 'Asia/Tokyo' } });
  if (d.type === 'GET_APP_NAME') return reply({ ok: true, name: '受注管理' });
  if (d.type === 'EXCEL_POST_RECORDS') return reply({ ok: true, result: { ids: ['1'], revisions: ['1'] } });
  reply({ ok: false });
});`;
}

export async function run({ browser, check }) {
  const name = (n) => `qnr-field-picker-flow: ${n}`;
  const { ctx, page } = await openQnr({ browser, bridgeScript: buildBridge(), viewport: { width: 1000, height: 900 }, deviceScaleFactor: 2 });
  try {
    const pickBtn = page.getByRole('button', { name: '項目を選ぶ' });
    const picker = page.locator('.pb-newrec__fields-picker');
    const pickerFoot = page.locator('.pb-newrec__fields-picker-foot');
    const pickerSave = pickerFoot.getByRole('button', { name: '保存', exact: true });
    const pickerCancel = pickerFoot.getByRole('button', { name: 'キャンセル', exact: true });
    const pickerReset = page.getByRole('button', { name: 'Excel Overlay の列に戻す' });
    const bodyLabels = () => page.locator('.pb-newrec__body .pb-newrec__label').allTextContents();

    // ── 1. 設定なし: 従来どおりプリセット表示 ──
    check(name('no config: preset select visible'), await page.locator('.pb-newrec__preset-select').isVisible());
    check(name('no config: custom label hidden'), !(await page.locator('.pb-newrec__fields-custom-label').isVisible()));
    const initialLabels = (await bodyLabels()).map((t) => t.trim());
    check(name('no config: all 5 fields shown in form order'),
      initialLabels.length === 5
      && initialLabels[0].startsWith('案件名')
      && initialLabels[1].startsWith('種別')
      && initialLabels[2].startsWith('受注日')
      && initialLabels[3].startsWith('数量')
      && initialLabels[4].startsWith('詳細'));
    check(name('pick button visible'), await pickBtn.isVisible());

    // ── 2. パネルを開く: 現在表示中の5項目が全てチェック済みで並ぶ ──
    await pickBtn.click();
    await page.waitForTimeout(200);
    check(name('picker opens'), await picker.count() === 1);
    const rows = page.locator('.pb-newrec__fields-picker-row');
    check(name('picker: 5 rows'), await rows.count() === 5);
    const checkedCountInitial = await page.locator('.pb-newrec__fields-picker-row input[type="checkbox"]:checked').count();
    check(name('picker: all 5 checked initially'), checkedCountInitial === 5);
    check(name('picker: reset button hidden (no config yet)'), !(await pickerReset.isVisible()));

    // ── 3. 「詳細」を外し、「数量」を1つ上へ(受注日の上に) → 保存 ──
    await rows.nth(4).locator('input[type="checkbox"]').uncheck(); // 詳細
    await rows.nth(3).getByRole('button', { name: '上へ' }).click(); // 数量 を上へ
    await page.waitForTimeout(200);
    await pickerSave.click();
    await page.waitForTimeout(300);

    check(name('save: picker closes'), await picker.count() === 0);
    check(name('save: custom label shown'), await page.locator('.pb-newrec__fields-custom-label').isVisible());
    check(name('save: preset select hidden'), !(await page.locator('.pb-newrec__preset-select').isVisible()));
    const labelsAfterSave = (await bodyLabels()).map((t) => t.trim());
    check(name('save: 4 fields in new order (案件名,種別,数量,受注日)'),
      labelsAfterSave.length === 4
      && labelsAfterSave[0].startsWith('案件名')
      && labelsAfterSave[1].startsWith('種別')
      && labelsAfterSave[2].startsWith('数量')
      && labelsAfterSave[3].startsWith('受注日'));

    const stored = await page.evaluate(() => window.chrome.storage.local.get('kfavQuickNewFields'));
    const entry = stored?.kfavQuickNewFields?.[APP_KEY];
    check(name('save: persisted to storage with correct order'),
      Boolean(entry) && Array.isArray(entry.fields) && entry.fields.join(',') === '案件名,種別,数量,受注日');

    // ── 4. 0件選択はブロックされる ──
    await pickBtn.click();
    await page.waitForTimeout(200);
    check(name('reopen: reset button visible (custom config exists)'), await pickerReset.isVisible());
    const checkboxes = page.locator('.pb-newrec__fields-picker-row input[type="checkbox"]');
    const cbCount = await checkboxes.count();
    for (let i = 0; i < cbCount; i++) {
      if (await checkboxes.nth(i).isChecked()) await checkboxes.nth(i).uncheck();
    }
    await pickerSave.click();
    await page.waitForTimeout(200);
    check(name('zero-selected: notice shown'), (await page.locator('.pb-newrec__fields-picker-notice').textContent()) === '1つ以上選んでください');
    check(name('zero-selected: panel stays open'), await picker.count() === 1);
    const labelsUnchanged = (await bodyLabels()).map((t) => t.trim());
    check(name('zero-selected: form unchanged (still 4 fields)'), labelsUnchanged.length === 4);

    // キャンセルで閉じる(保存はしていないので設定は変わらない)
    await pickerCancel.click();
    await page.waitForTimeout(200);
    check(name('cancel: panel closes'), await picker.count() === 0);
    check(name('cancel: custom label still shown'), await page.locator('.pb-newrec__fields-custom-label').isVisible());

    // ── 5. リセット: Excel Overlay の列に戻す ──
    await pickBtn.click();
    await page.waitForTimeout(200);
    await pickerReset.click();
    await page.waitForTimeout(300);
    check(name('reset: picker closes'), await picker.count() === 0);
    check(name('reset: preset select visible again'), await page.locator('.pb-newrec__preset-select').isVisible());
    check(name('reset: custom label hidden again'), !(await page.locator('.pb-newrec__fields-custom-label').isVisible()));
    const labelsAfterReset = (await bodyLabels()).map((t) => t.trim());
    check(name('reset: back to original 5 fields in original order'),
      labelsAfterReset.length === 5
      && labelsAfterReset[0].startsWith('案件名')
      && labelsAfterReset[1].startsWith('種別')
      && labelsAfterReset[2].startsWith('受注日')
      && labelsAfterReset[3].startsWith('数量')
      && labelsAfterReset[4].startsWith('詳細'));
    const storedAfterReset = await page.evaluate(() => window.chrome.storage.local.get('kfavQuickNewFields'));
    check(name('reset: removed from storage'), !storedAfterReset?.kfavQuickNewFields?.[APP_KEY]);

    // ── 6. Esc はパネルだけを閉じる(モーダルは閉じない) ──
    await pickBtn.click();
    await page.waitForTimeout(200);
    check(name('esc-test: picker open'), await picker.count() === 1);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    check(name('esc: picker closes'), await picker.count() === 0);
    check(name('esc: modal stays open'), await page.locator('.pb-newrec__layer').count() === 1);
  } finally {
    await ctx.close();
  }
}
