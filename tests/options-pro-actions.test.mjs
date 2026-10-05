// 設定画面: Pro ライセンス欄のアクション導線
//   - 「14日間無料で試す」は外部サイトへ遷移せず、ページ内のトライアルカードを
//     表示・フォーカスするだけで、既存の /trial 導線をそのまま使う
//   - 「購入 ¥1,980（買い切り）」は Stripe Payment Link を新規タブで開く
//   - 「詳しく」は plugbits.app の価格セクションを新規タブで開く
import { buildChromeStub } from './helpers/chrome-stub.mjs';

export async function run({ browser, origin, check }) {
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 500 } });
  await ctx.addInitScript(buildChromeStub());

  let trialCalled = false;
  const now = Date.now();
  await ctx.route('**/trial', (route) => {
    trialCalled = true;
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        key: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
        email: 'jiro@example.com',
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

  // 無料状態: 3つのアクションが揃っている
  check('pro-actions: trial cta visible for free users',
    await page.locator('#pro_trial_cta_btn:not([hidden])').count() === 1);
  check('pro-actions: buy button visible for free users',
    await page.locator('#pro_buy_btn:not([hidden])').count() === 1);
  check('pro-actions: learn more link visible for free users',
    await page.locator('#pro_learn_more_link:not([hidden])').count() === 1);

  // プロライセンス購入ボタンは plugbits.app を経由せず Stripe Payment Link を直接開く
  check('pro-actions: buy button links directly to the Stripe Payment Link',
    await page.locator('#pro_buy_btn').getAttribute('href') === 'https://buy.stripe.com/eVq9AV8U72ky64M6R78so03');
  check('pro-actions: buy button opens in a new tab',
    await page.locator('#pro_buy_btn').getAttribute('target') === '_blank');

  // 「詳しく」は価格セクション付きの plugbits.app を新規タブで開く
  check('pro-actions: learn more link points at plugbits.app pricing',
    await page.locator('#pro_learn_more_link').getAttribute('href') === 'https://plugbits.app/pro.html?from=ext#pricing');
  check('pro-actions: learn more link opens in a new tab',
    await page.locator('#pro_learn_more_link').getAttribute('target') === '_blank');

  // 要素がビューポート内に見えているかどうかを判定するヘルパー
  // （このPlaywrightビルドには isIntersectingViewport が無いため自前で判定する）
  const isInViewport = async (selector) => page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return r.top < window.innerHeight && r.bottom > 0 && r.width > 0 && r.height > 0;
  }, selector);

  // トライアルカードは初期状態では非表示ではない（CTAの導線先として存在する）が、
  // ビューポート外にあることを確認してから、CTAクリックでスクロール＋フォーカスされることを見る
  check('pro-actions: trial card starts out of view below the fold',
    !(await isInViewport('#pro_trial_card')));

  await page.click('#pro_trial_cta_btn');
  await page.waitForTimeout(500);

  check('pro-actions: trial CTA click reveals the inline trial card',
    await isInViewport('#pro_trial_card'));
  check('pro-actions: trial CTA click focuses the email input',
    await page.evaluate(() => document.activeElement?.id) === 'pro_trial_email');
  check('pro-actions: trial CTA did not navigate away from the options page',
    page.url().includes('/options.html'));

  // そのままトライアル開始まで進められる（＝CTAは既存の /trial 導線を潰していない）
  await page.fill('#pro_trial_email', 'jiro@example.com');
  await page.click('#pro_trial_start');
  await page.waitForTimeout(800);

  check('pro-actions: trial CTA flow still calls the existing /trial endpoint', trialCalled);
  check('pro-actions: trial started via the CTA activates Pro',
    (await page.locator('#pro_status_label').textContent()).includes('トライアル中'));

  // トライアル中は「14日間無料で試す」CTAは不要になる一方、購入導線は引き続き見せる
  check('pro-actions: trial cta hidden once a trial is active',
    await page.locator('#pro_trial_cta_btn[hidden]').count() === 1);
  check('pro-actions: buy button still visible during an active trial',
    await page.locator('#pro_buy_btn:not([hidden])').count() === 1);

  await ctx.close();
}
