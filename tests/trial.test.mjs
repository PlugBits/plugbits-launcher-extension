// 設定画面: 14日トライアルの開始フロー（/trial はモック）
import { buildChromeStub } from './helpers/chrome-stub.mjs';

export async function run({ browser, origin, check }) {
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 950 } });
  await ctx.addInitScript(buildChromeStub());

  const now = Date.now();
  await ctx.route('**/trial', (route) => {
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        key: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
        email: 'taro@example.com',
        kind: 'trial',
        status: 'active',
        expiry: new Date(now + 14 * 86400000).toISOString(),
        trial_verified: false,
        trial_verify_deadline: new Date(now + 48 * 3600000).toISOString()
      })
    });
  });

  const page = await ctx.newPage();
  await page.goto(`${origin}/options.html#pro-license`);
  await page.waitForTimeout(1300);

  check('trial: card visible before start', await page.locator('#pro_trial_card:not([hidden])').count() === 1);

  await page.fill('#pro_trial_email', 'not-an-email');
  await page.click('#pro_trial_start');
  await page.waitForTimeout(300);
  check('trial: invalid email rejected',
    (await page.locator('#pro_trial_msg').textContent()).includes('有効なメールアドレス'));

  await page.fill('#pro_trial_email', 'taro@example.com');
  await page.click('#pro_trial_start');
  await page.waitForTimeout(800);
  check('trial: status shows trial active',
    (await page.locator('#pro_status_label').textContent()).includes('トライアル中'));
  const sub = await page.locator('#pro_status_sub').textContent();
  check('trial: sub shows days left + verify pending', sub.includes('残り 14 日') && sub.includes('メール確認'));
  check('trial: card hidden after start', await page.locator('#pro_trial_card[hidden]').count() === 1);
  check('trial: key input filled', (await page.inputValue('#pro_license_key_input')).startsWith('aaaaaaaa'));

  await ctx.close();
}
