// サイドパネル: ウォッチリスト行のホバー操作（固定切替/名前変更/削除）
import { buildChromeStub } from './helpers/chrome-stub.mjs';

export async function run({ browser, origin, check }) {
  const ctx = await browser.newContext({ viewport: { width: 400, height: 760 } });
  await ctx.addInitScript(buildChromeStub());
  const page = await ctx.newPage();
  await page.goto(`${origin}/sidepanel.html`);
  await page.waitForTimeout(1200);

  // 1. ホバーで操作ボタンが現れる
  const row = page.locator('.entry', { hasText: '本日の製造指示' }).first();
  await row.hover();
  await page.waitForTimeout(250);
  const visible = await row.locator('.entry-actions').evaluate((el) => getComputedStyle(el).opacity === '1');
  check('sidepanel: hover reveals entry actions', visible);

  // 2. 名前変更ダイアログ
  await row.locator('.entry-action-btn[aria-label*="名前"], .entry-action-btn[aria-label*="Rename"]').first().click();
  await page.waitForTimeout(400);
  check('sidepanel: rename dialog opened', await page.locator('.panel-dialog').count() === 1);
  await page.locator('.panel-dialog__input').fill('本日の製造指示（更新）');
  await page.locator('.panel-dialog__btn--primary').click();
  await page.waitForTimeout(500);
  check('sidepanel: label renamed', await page.locator('.entry-title', { hasText: '本日の製造指示（更新）' }).count() === 1);

  // 3. 削除（キャンセル→確定）
  const row2 = page.locator('.entry', { hasText: '不良報告' }).first();
  await row2.hover();
  await row2.locator('.entry-action-btn--danger').click();
  await page.waitForTimeout(400);
  check('sidepanel: delete dialog opened', await page.locator('.panel-dialog').count() === 1);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  check('sidepanel: Escape cancels delete',
    await page.locator('.panel-dialog').count() === 0
    && await page.locator('.entry', { hasText: '不良報告' }).count() === 1);
  await row2.hover();
  await row2.locator('.entry-action-btn--danger').click();
  await page.waitForTimeout(400);
  await page.locator('.panel-dialog__btn--danger').click();
  await page.waitForTimeout(500);
  check('sidepanel: confirm deletes entry', await page.locator('.entry', { hasText: '不良報告' }).count() === 0);

  // 4. star で固定セクションへ移動
  const row3 = page.locator('#favCategories .entry', { hasText: '本日の製造指示（更新）' }).first();
  await row3.hover();
  await row3.locator('.entry-action-btn').first().click();
  await page.waitForTimeout(400);
  check('sidepanel: star moves entry to pinned list',
    await page.locator('#pinnedWatchList .entry', { hasText: '本日の製造指示（更新）' }).count() === 1);

  await ctx.close();
}
