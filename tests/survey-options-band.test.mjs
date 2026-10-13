// 3.3.0: 利用者アンケート A ── 設定画面(options.html)最上部のバナー。
// chrome-stub + 追加の初期化スクリプトで kfavSurveyA の状態・chrome.runtime.getManifest・
// window.open を差し替えて検証する(options-pro-actions.test.mjs と同じ方式)。
import { buildChromeStub } from './helpers/chrome-stub.mjs';

const SURVEY_KEY = 'kfavSurveyA';

// 第2の addInitScript で buildChromeStub() が作った window.chrome を上書き拡張する。
// Playwright の addInitScript は登録順に(= 必ず buildChromeStub() の後に)実行される。
// 注意: この関数はソースをそのままページへ注入するだけで、Node側のクロージャ
// (モジュールスコープの定数)は一切持ち込めない。SURVEY_KEY は文字列リテラルで書く。
function patchInitScript(args) {
  if (args.uiLanguage !== undefined) {
    window.chrome.storage.local.set({ uiLanguage: args.uiLanguage });
  }
  if (args.surveyState !== undefined) {
    if (args.surveyState === null) {
      window.chrome.storage.local.remove('kfavSurveyA');
    } else {
      window.chrome.storage.local.set({ kfavSurveyA: args.surveyState });
    }
  }
  window.chrome.runtime.getManifest = () => ({ version: args.version });
  window.__opened = [];
  window.open = (url, target, feats) => {
    window.__opened.push({ url, target, feats });
    return null;
  };
}

async function setupPage(ctx, origin, opts) {
  await ctx.addInitScript(buildChromeStub());
  await ctx.addInitScript(patchInitScript, opts);
  const page = await ctx.newPage();
  await page.goto(`${origin}/options.html`);
  await page.waitForTimeout(600);
  return page;
}

export async function run({ browser, origin, check }) {
  const now = Date.now();

  // 1) kfavSurveyA が無い(初期状態) → バナーは出ない
  {
    const ctx = await browser.newContext();
    const page = await setupPage(ctx, origin, { surveyState: null, version: '3.3.0' });
    check('survey-band: キー無しでは非表示', await page.locator('#survey_a_band[hidden]').count() === 1);
    await ctx.close();
  }

  // 2) eligibleAt が未来 → まだ非表示
  {
    const ctx = await browser.newContext();
    const page = await setupPage(ctx, origin, {
      surveyState: { eligibleAt: now + 2 * 86400000, bandDismissed: false, done: false },
      version: '3.3.0'
    });
    check('survey-band: eligibleAt が未来なら非表示', await page.locator('#survey_a_band[hidden]').count() === 1);
    await ctx.close();
  }

  // 3) eligibleAt が過去・未dismiss・未done → 表示（日本語文言）
  {
    const ctx = await browser.newContext();
    const page = await setupPage(ctx, origin, {
      surveyState: { eligibleAt: now - 1000, bandDismissed: false, done: false },
      uiLanguage: 'ja',
      version: '3.3.0'
    });
    check('survey-band: eligibleAt 過去・未dismiss・未doneで表示', await page.locator('#survey_a_band:not([hidden])').count() === 1);
    check('survey-band: 日本語の文言',
      (await page.locator('#survey_a_band_title').textContent() || '').includes('3 つだけ教えてください'));
    check('survey-band: 「回答する」ボタンの文言',
      (await page.locator('#survey_a_band_answer').textContent() || '').trim() === '回答する');
    await ctx.close();
  }

  // 4) done:true → 非表示
  {
    const ctx = await browser.newContext();
    const page = await setupPage(ctx, origin, {
      surveyState: { eligibleAt: now - 1000, bandDismissed: false, done: true },
      version: '3.3.0'
    });
    check('survey-band: done済みなら非表示', await page.locator('#survey_a_band[hidden]').count() === 1);
    await ctx.close();
  }

  // 5) bandDismissed:true → 非表示
  {
    const ctx = await browser.newContext();
    const page = await setupPage(ctx, origin, {
      surveyState: { eligibleAt: now - 1000, bandDismissed: true, done: false },
      version: '3.3.0'
    });
    check('survey-band: ×済み(bandDismissed)なら非表示', await page.locator('#survey_a_band[hidden]').count() === 1);
    await ctx.close();
  }

  // 6) × を押すと非表示になり、bandDismissed=true が保存される(doneは変えない)
  {
    const ctx = await browser.newContext();
    const page = await setupPage(ctx, origin, {
      surveyState: { eligibleAt: now - 1000, bandDismissed: false, done: false },
      version: '3.3.0'
    });
    await page.click('#survey_a_band_close');
    await page.waitForTimeout(200);
    check('survey-band: ×クリックで非表示になる', await page.locator('#survey_a_band[hidden]').count() === 1);
    const saved = await page.evaluate((key) => window.chrome.storage.local.get(key), SURVEY_KEY);
    check('survey-band: ×クリックで bandDismissed=true が保存される', saved?.[SURVEY_KEY]?.bandDismissed === true);
    check('survey-band: ×クリックは done を変えない', saved?.[SURVEY_KEY]?.done === false);
    await ctx.close();
  }

  // 7) 「回答する」を押すと新規タブでフォームが開き、done=true が保存される(ja + version)
  {
    const ctx = await browser.newContext();
    const page = await setupPage(ctx, origin, {
      surveyState: { eligibleAt: now - 1000, bandDismissed: false, done: false },
      uiLanguage: 'ja',
      version: '3.3.0'
    });
    await page.click('#survey_a_band_answer');
    await page.waitForTimeout(300);
    const opened = await page.evaluate(() => window.__opened);
    check('survey-band: 「回答する」で新規タブを1回開く', opened.length === 1);
    const url = opened[0]?.url || '';
    check('survey-band: フォームURLのベース',
      url.startsWith('https://docs.google.com/forms/d/e/1FAIpQLSdVQboVqyIhnqa_EgwthxUzkOmbLgld9tg2c04AcxUVBR8ROw/viewform'));
    check('survey-band: バージョンがプリフィルされる', url.includes('entry.1032001690=3.3.0'));
    check('survey-band: 言語=ja がプリフィルされる', url.includes('entry.1077819437=ja'));
    check('survey-band: 新規タブで開く(_blank)', opened[0]?.target === '_blank');

    const saved = await page.evaluate((key) => window.chrome.storage.local.get(key), SURVEY_KEY);
    check('survey-band: 「回答する」で done=true が保存される', saved?.[SURVEY_KEY]?.done === true);

    check('survey-band: 回答後はバナーが消える', await page.locator('#survey_a_band[hidden]').count() === 1);
    await ctx.close();
  }

  // 8) 言語設定が en のときはフォームURLも en
  {
    const ctx = await browser.newContext();
    const page = await setupPage(ctx, origin, {
      surveyState: { eligibleAt: now - 1000, bandDismissed: false, done: false },
      uiLanguage: 'en',
      version: '3.3.0'
    });
    check('survey-band: en設定時の文言',
      (await page.locator('#survey_a_band_title').textContent() || '').includes('3 quick questions'));
    await page.click('#survey_a_band_answer');
    await page.waitForTimeout(300);
    const opened = await page.evaluate(() => window.__opened);
    const url = opened[0]?.url || '';
    check('survey-band: 言語=en がプリフィルされる', url.includes('entry.1077819437=en'));
    await ctx.close();
  }
}
