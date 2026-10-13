// 3.3.0: 利用者アンケート A ── kintoneページ本体(content.js側)のトースト。
// tests/qnr-modal-flow.test.mjs などと同じ「chrome-stub投入 → demo.cybozu.com に
// content.js を route で配信 → addScriptTag で注入」方式で、実際に生成された
// src/content.js をそのまま検証する(src/content-command-palette.js のみを
// 抽出する survey-palette-row.test.mjs とは別方式)。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildChromeStub } from './helpers/chrome-stub.mjs';

const srcDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');
const contentJs = fs.readFileSync(path.join(srcDir, 'content.js'), 'utf8');
const contentTemplateJs = fs.readFileSync(path.join(srcDir, 'content.template.js'), 'utf8');

const ORIGIN = 'https://demo.cybozu.com';
const SURVEY_KEY = 'kfavSurveyA';
const TOAST_DELAY_WAIT_MS = 2200; // SURVEY_A_TOAST_DELAY_MS(1.5s) + バッファ

// 第2のaddInitScriptでbuildChromeStub()が作ったwindow.chromeを上書き拡張する。
// Node側のクロージャは持ち込めないため、キー名は文字列リテラルで書く。
function patchInitScript(args) {
  if (args.uiLanguage !== undefined) {
    window.chrome.storage.local.set({ uiLanguage: args.uiLanguage });
  }
  if (args.surveyState !== undefined) {
    window.chrome.storage.local.set({ kfavSurveyA: args.surveyState });
  }
  window.chrome.runtime.getManifest = () => ({ version: args.version || '3.3.0' });
  window.__opened = [];
  window.open = (url, target, feats) => {
    window.__opened.push({ url, target, feats });
    return null;
  };
}

async function setupPage(browser, opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.addInitScript(buildChromeStub({ empty: true }));
  await ctx.addInitScript(patchInitScript, opts);
  await ctx.route(`${ORIGIN}/**`, (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/content.js')) {
      return route.fulfill({ contentType: 'text/javascript; charset=utf-8', body: contentJs });
    }
    if (url.pathname.endsWith('/page-bridge.js')) {
      return route.fulfill({ contentType: 'text/javascript; charset=utf-8', body: '/* noop in this suite */' });
    }
    return route.fulfill({ contentType: 'text/html; charset=utf-8', body: '<!doctype html><body style="background:#e8ecf2"></body>' });
  });

  const page = await ctx.newPage();
  // appId付きのkintone一覧URL（manifestのcontent_scripts matchesに合致するホスト）
  await page.goto(`${ORIGIN}/k/12/?view=20`);
  await page.addScriptTag({ url: `${ORIGIN}/content.js` });
  await page.waitForTimeout(TOAST_DELAY_WAIT_MS);
  return { ctx, page };
}

function todayKey(offsetDays = 0) {
  const d = new Date(Date.now() + offsetDays * 86400000);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

export async function run({ browser, check }) {
  const now = Date.now();
  const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;

  // 1) 対象(eligibleAt過去・7日以内・未done・未dismiss) → トーストが出る(日本語)
  {
    const { ctx, page } = await setupPage(browser, {
      surveyState: { eligibleAt: now - 1000, bandDismissed: false, done: false },
      uiLanguage: 'ja',
      version: '3.3.0'
    });
    try {
      check('toast: 対象ユーザーに表示される', await page.locator('#pb-survey-toast').count() === 1);
      check('toast: 日本語タイトル(バナーと同じ文言)',
        (await page.locator('#pb-survey-toast .pb-st__title').textContent() || '').includes('3 つだけ教えてください'));
      check('toast: 日本語の注記(バナーと同じ文言)',
        (await page.locator('#pb-survey-toast .pb-st__note').textContent() || '').includes('今後の改善にだけ使います'));
      check('toast: 「回答する」ボタンの文言',
        (await page.locator('#pb-survey-toast .pb-st__answer').textContent() || '').trim() === '回答する');
      check('toast: ✕ボタンのaria-label',
        await page.locator('#pb-survey-toast .pb-st__close[aria-label="閉じる"]').count() === 1);

      // 表示と同時にtoastLastShownDateが今日の日付で保存される
      const saved = await page.evaluate((key) => window.chrome.storage.local.get(key), SURVEY_KEY);
      check('toast: 表示時にtoastLastShownDateが保存される', saved?.[SURVEY_KEY]?.toastLastShownDate === todayKey());

      // クイックランチャー(pb-quick-dock)も同じページに出ている(appId付き一覧ページ)
      const dockCount = await page.locator('#pb-quick-dock').count();
      check('toast: クイックランチャーも同時に存在する(位置計算の前提)', dockCount === 1);
      if (dockCount === 1) {
        const toastBottom = await page.evaluate(() => parseFloat(getComputedStyle(document.getElementById('pb-survey-toast')).bottom) || 0);
        check('toast: クイックランチャーの分だけ下端が既定の24pxより高い位置に押し上げられる', toastBottom > 24);
      }
    } finally {
      await ctx.close();
    }
  }

  // 2) eligibleAtがまだ未来 → 出ない
  {
    const { ctx, page } = await setupPage(browser, {
      surveyState: { eligibleAt: now + 60000, bandDismissed: false, done: false }
    });
    try {
      check('toast: eligibleAtが未来だと出ない', await page.locator('#pb-survey-toast').count() === 0);
    } finally {
      await ctx.close();
    }
  }

  // 3) 7日の期限切れ → 出ない
  {
    const { ctx, page } = await setupPage(browser, {
      surveyState: { eligibleAt: now - (sevenDaysMs + 60000), bandDismissed: false, done: false }
    });
    try {
      check('toast: 7日を過ぎると出ない', await page.locator('#pb-survey-toast').count() === 0);
    } finally {
      await ctx.close();
    }
  }

  // 4) done:true → 出ない
  {
    const { ctx, page } = await setupPage(browser, {
      surveyState: { eligibleAt: now - 1000, bandDismissed: false, done: true }
    });
    try {
      check('toast: done済みなら出ない', await page.locator('#pb-survey-toast').count() === 0);
    } finally {
      await ctx.close();
    }
  }

  // 5) toastDismissed:true → 出ない(bandDismissedとは別管理)
  {
    const { ctx, page } = await setupPage(browser, {
      surveyState: { eligibleAt: now - 1000, bandDismissed: false, done: false, toastDismissed: true }
    });
    try {
      check('toast: toastDismissed済みなら出ない', await page.locator('#pb-survey-toast').count() === 0);
    } finally {
      await ctx.close();
    }
  }

  // 6) 1日1回: toastLastShownDateが今日なら(=同日2回目の読み込み相当) 出ない
  {
    const { ctx, page } = await setupPage(browser, {
      surveyState: { eligibleAt: now - 1000, bandDismissed: false, done: false, toastLastShownDate: todayKey() }
    });
    try {
      check('toast: 同日2回目は出ない', await page.locator('#pb-survey-toast').count() === 0);
    } finally {
      await ctx.close();
    }
  }

  // 6b) toastLastShownDateが前日 → 出る(日付が変わったので再度出る)
  {
    const { ctx, page } = await setupPage(browser, {
      surveyState: { eligibleAt: now - 1000, bandDismissed: false, done: false, toastLastShownDate: todayKey(-1) }
    });
    try {
      check('toast: toastLastShownDateが前日なら出る', await page.locator('#pb-survey-toast').count() === 1);
    } finally {
      await ctx.close();
    }
  }

  // 7) ✕ を押すとtoastDismissed=trueが保存され、トーストが消える(doneは変えない)
  {
    const { ctx, page } = await setupPage(browser, {
      surveyState: { eligibleAt: now - 1000, bandDismissed: false, done: false }
    });
    try {
      check('toast: ✕を押す前は表示されている', await page.locator('#pb-survey-toast').count() === 1);
      await page.click('#pb-survey-toast .pb-st__close');
      await page.waitForTimeout(200);
      check('toast: ✕クリックで消える', await page.locator('#pb-survey-toast').count() === 0);
      const saved = await page.evaluate((key) => window.chrome.storage.local.get(key), SURVEY_KEY);
      check('toast: ✕クリックでtoastDismissed=trueが保存される', saved?.[SURVEY_KEY]?.toastDismissed === true);
      check('toast: ✕クリックはdoneを変えない', saved?.[SURVEY_KEY]?.done === false);
    } finally {
      await ctx.close();
    }
  }

  // 8) 「回答する」を押すと新規タブでフォームが開き(バージョン・言語プリフィル)、
  //    done=trueが保存され、トーストも消える
  {
    const { ctx, page } = await setupPage(browser, {
      surveyState: { eligibleAt: now - 1000, bandDismissed: false, done: false },
      uiLanguage: 'ja',
      version: '3.3.0'
    });
    try {
      await page.click('#pb-survey-toast .pb-st__answer');
      await page.waitForTimeout(200);
      const opened = await page.evaluate(() => window.__opened);
      check('toast: 「回答する」で新規タブを1回開く', opened.length === 1);
      const url = opened[0]?.url || '';
      check('toast: フォームURLのベース',
        url.startsWith('https://docs.google.com/forms/d/e/1FAIpQLSdVQboVqyIhnqa_EgwthxUzkOmbLgld9tg2c04AcxUVBR8ROw/viewform'));
      check('toast: バージョンがプリフィルされる', url.includes('entry.1032001690=3.3.0'));
      check('toast: 言語=jaがプリフィルされる', url.includes('entry.1077819437=ja'));
      check('toast: 新規タブで開く(_blank)', opened[0]?.target === '_blank');

      const saved = await page.evaluate((key) => window.chrome.storage.local.get(key), SURVEY_KEY);
      check('toast: 「回答する」でdone=trueが保存される', saved?.[SURVEY_KEY]?.done === true);
      check('toast: 「回答する」を押すとトーストは消える', await page.locator('#pb-survey-toast').count() === 0);
    } finally {
      await ctx.close();
    }
  }

  // 9) 言語設定がenのときは英語文言・URLもen
  {
    const { ctx, page } = await setupPage(browser, {
      surveyState: { eligibleAt: now - 1000, bandDismissed: false, done: false },
      uiLanguage: 'en',
      version: '3.3.0'
    });
    try {
      check('toast: en設定時の英語タイトル',
        (await page.locator('#pb-survey-toast .pb-st__title').textContent() || '').includes('3 quick questions'));
      check('toast: en設定時の「Answer」ボタン',
        (await page.locator('#pb-survey-toast .pb-st__answer').textContent() || '').trim() === 'Answer');
      check('toast: en設定時の✕のaria-label',
        await page.locator('#pb-survey-toast .pb-st__close[aria-label="Close"]').count() === 1);
      await page.click('#pb-survey-toast .pb-st__answer');
      await page.waitForTimeout(200);
      const opened = await page.evaluate(() => window.__opened);
      const url = opened[0]?.url || '';
      check('toast: 言語=enがプリフィルされる', url.includes('entry.1077819437=en'));
    } finally {
      await ctx.close();
    }
  }

  // 10) 静的チェック: トースト機能のコードはkintone側のDOMを一切querySelector/
  //     getElementById していない(自前要素の生成・参照のみ)。
  //     content.template.js上のこの区間を抜き出して確認する(content.jsにも
  //     そのままインクルードされる)。
  {
    const startMarker = '// ── 3.3.0 利用者アンケート A: kintoneページ本体のトースト';
    const endMarker = 'spaLifecycleReady = true;';
    const startIdx = contentTemplateJs.indexOf(startMarker);
    const endIdx = contentTemplateJs.indexOf(endMarker, startIdx);
    check('toast-dom: トーストのコード区間が見つかる', startIdx !== -1 && endIdx !== -1 && endIdx > startIdx);
    const toastSection = contentTemplateJs.slice(startIdx, endIdx);
    check('toast-dom: querySelectorを使っていない', !toastSection.includes('querySelector'));
    check('toast-dom: getElementByIdを使っていない', !toastSection.includes('getElementById'));
    // 生成後のcontent.jsにも同じ区間がそのまま含まれていることの確認
    check('toast-dom: content.jsにもトーストのコードが含まれる', contentJs.includes(startMarker));
  }
}
