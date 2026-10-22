// 設定画面: Pro ライセンス欄のキー入力欄の下にある「キーを紛失した方はこちら」リンク
//   - ライセンスキー入力欄の直後(同じセクション内)に置かれている
//   - plugbits.app のキー再送フォーム(#recover)を新規タブで開くだけで、拡張からAPIは叩かない
//   - 日本語・英語どちらのUIでも文言が切り替わり、リンク先は同じURL
import { buildChromeStub } from './helpers/chrome-stub.mjs';

export async function run({ browser, origin, check }) {
  // 日本語UI(デフォルト)
  {
    const ctx = await browser.newContext({ viewport: { width: 1100, height: 700 } });
    await ctx.addInitScript(buildChromeStub());
    const page = await ctx.newPage();
    await page.goto(`${origin}/options.html#pro-license`);
    await page.waitForTimeout(1300);

    const link = page.locator('#pro_key_recover_link');
    check('recover-link(ja): exists exactly once', await link.count() === 1);
    check('recover-link(ja): href points at plugbits.app pro recover anchor',
      await link.getAttribute('href') === 'https://plugbits.app/pro.html#recover');
    check('recover-link(ja): opens in a new tab',
      await link.getAttribute('target') === '_blank');
    check('recover-link(ja): has rel=noopener noreferrer',
      await link.getAttribute('rel') === 'noopener noreferrer');
    check('recover-link(ja): label text',
      (await link.textContent()).trim() === 'キーを紛失した方はこちら');

    // キー入力欄の下にあること(DOM順でキー入力行より後に続く)
    const isAfterKeyInput = await page.evaluate(() => {
      const keyRow = document.getElementById('pro_key_section');
      const link = document.getElementById('pro_key_recover_link');
      if (!keyRow || !link) return false;
      const pos = keyRow.compareDocumentPosition(link);
      return Boolean(pos & Node.DOCUMENT_POSITION_FOLLOWING);
    });
    check('recover-link(ja): located below the license key input row', isAfterKeyInput);

    // キー入力欄とリンクの縦位置関係(見た目上も下にある)
    const geometryOk = await page.evaluate(() => {
      const input = document.getElementById('pro_license_key_input');
      const link = document.getElementById('pro_key_recover_link');
      if (!input || !link) return false;
      const inputRect = input.getBoundingClientRect();
      const linkRect = link.getBoundingClientRect();
      return linkRect.top >= inputRect.top;
    });
    check('recover-link(ja): visually below the key input', geometryOk);

    await ctx.close();
  }

  // 英語UI
  {
    const ctx = await browser.newContext({ viewport: { width: 1100, height: 700 } });
    await ctx.addInitScript(buildChromeStub());
    await ctx.addInitScript(() => {
      window.chrome.storage.local.set({ uiLanguage: 'en' });
    });
    const page = await ctx.newPage();
    await page.goto(`${origin}/options.html#pro-license`);
    await page.waitForTimeout(1300);

    const link = page.locator('#pro_key_recover_link');
    check('recover-link(en): exists exactly once', await link.count() === 1);
    check('recover-link(en): href is the same plugbits.app pro recover anchor',
      await link.getAttribute('href') === 'https://plugbits.app/pro.html#recover');
    check('recover-link(en): opens in a new tab',
      await link.getAttribute('target') === '_blank');
    check('recover-link(en): label text',
      (await link.textContent()).trim() === 'Lost your key?');

    await ctx.close();
  }
}
