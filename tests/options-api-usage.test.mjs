// 設定画面: API使用状況の「統計をリセット」と「キャッシュを更新」
import { buildChromeStub } from './helpers/chrome-stub.mjs';

export async function run({ browser, origin, check }) {
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 900 } });
  await ctx.addInitScript(buildChromeStub());
  // 統計データのシードと、キャッシュクリアメッセージへの応答を追加
  await ctx.addInitScript(`(() => {
    const today = new Date();
    const key = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0');
    chrome.storage.local.set({
      apiUsageDaily: { [key]: { watchlist: { count: 42, success: 40, error: 2 } } }
    });
    const original = chrome.runtime.sendMessage;
    chrome.runtime.sendMessage = (msg) => {
      if (msg && msg.type === 'PB_CLEAR_METADATA_CACHE_ALL') {
        return Promise.resolve({ ok: true, removed: 7 });
      }
      return original(msg);
    };
  })();`);

  const page = await ctx.newPage();
  page.on('dialog', (dialog) => dialog.accept());
  await page.goto(`${origin}/options.html#api-usage`);
  await page.waitForTimeout(1200);

  check('api-usage: seeded stats rendered',
    (await page.locator('#api_usage_today_total').textContent()).trim() === '42');

  await page.click('#api_usage_reset');
  await page.waitForTimeout(400);
  check('api-usage: reset clears displayed stats',
    (await page.locator('#api_usage_today_total').textContent()).trim() === '0');
  const storedAfter = await page.evaluate(() => chrome.storage.local.get(['apiUsageDaily', 'apiUsageAdminBreakdownDaily']));
  check('api-usage: reset removes storage keys',
    storedAfter.apiUsageDaily === undefined && storedAfter.apiUsageAdminBreakdownDaily === undefined);

  await page.click('#metadata_cache_clear');
  await page.waitForTimeout(400);
  const status = (await page.locator('#metadata_cache_status').textContent()).trim();
  check('api-usage: cache clear shows removed count', status.includes('7'));

  await ctx.close();
}
