// 3.3.0: 利用者アンケート A ── コマンドパレット最下部の案内行。
// tests/palette.test.mjs / palette-settings.test.mjs と同じ「content-command-palette.js の
// @@BODY_START以降を、スタブと共に素のページで評価する」方式。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const srcDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');
const paletteSrc = fs.readFileSync(path.join(srcDir, 'content-command-palette.js'), 'utf8');
const marker = '// @@BODY_START\n';
const body = paletteSrc.slice(paletteSrc.indexOf(marker) + marker.length);

const SURVEY_TEXT_JA = '3つだけ教えてください（アンケート・1分）';
const SURVEY_TEXT_EN = '3 quick questions (survey, 1 min)';

function buildHarness({ surveyState, version = '3.3.0', lang = 'ja' } = {}) {
  return `
(function(){
  const SURVEY_A_KEY = 'kfavSurveyA';
  const DEFAULT_OVERLAY_LANGUAGE = 'ja';
  window.__lang = ${JSON.stringify(lang)};
  const JA = { surveyPaletteRow: ${JSON.stringify(SURVEY_TEXT_JA)} };
  const EN = { surveyPaletteRow: ${JSON.stringify(SURVEY_TEXT_EN)} };
  function resolveText(lang, key) {
    const dict = lang === 'en' ? EN : JA;
    return dict[key] || (lang + ':' + key);
  }
  async function resolveOverlayUiLanguage() { return { language: window.__lang }; }
  const postToPage = async (type) => {
    if (type === 'CP_GET_CONTEXT') return { ok: true, result: { appId: null, recordId: null, query: '' } };
    return { ok: false };
  };

  // chrome.storage.local は単純なメモリストアで模擬する
  const __store = {};
  ${surveyState !== undefined ? `__store[SURVEY_A_KEY] = ${JSON.stringify(surveyState)};` : ''}
  window.__store = __store;
  window.chrome = {
    runtime: {
      sendMessage: async (msg) => {
        if (msg && msg.type === 'CP_GET_SHORTCUTS') return { ok: true, shortcuts: [] };
        return { ok: false };
      },
      getManifest: () => ({ version: ${JSON.stringify(version)} })
    },
    storage: {
      local: {
        get: (key) => Promise.resolve(
          Object.prototype.hasOwnProperty.call(__store, key) ? { [key]: JSON.parse(JSON.stringify(__store[key])) } : {}
        ),
        set: (obj) => { Object.assign(__store, JSON.parse(JSON.stringify(obj))); return Promise.resolve(); }
      }
    }
  };
  window.__opened = [];
  window.open = (url, target, feats) => { window.__opened.push({ url, target, feats }); return null; };

  ${body}
  window.__cp = { palette: commandPalette };
})();
`;
}

async function openPalette(page, opts) {
  await page.setContent('<!doctype html><html><body><p>host</p></body></html>');
  await page.evaluate(buildHarness(opts));
  await page.evaluate(() => window.__cp.palette.open());
  await page.waitForTimeout(200);
}

function itemTexts(items) {
  return items.map((t) => t.trim());
}

export async function run({ browser, check }) {
  const now = Date.now();
  const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;

  // 1) 対象(eligibleAt過去・7日以内・未done) & 検索語が空 → 最後の行に出る。先頭(既定選択)は奪わない
  {
    const page = await browser.newPage();
    try {
      await openPalette(page, { surveyState: { eligibleAt: now - 1000, bandDismissed: false, done: false } });
      const items = await page.evaluate(() => Array.from(document.querySelectorAll('.pb-cp__item')).map((el) => el.textContent));
      const texts = itemTexts(items);
      check('survey-row: 対象ユーザーの空クエリで行が追加される', texts.some((t) => t.includes('3つだけ教えてください')));
      check('survey-row: 行は一覧の最後にある', texts[texts.length - 1].includes('3つだけ教えてください'));
      const activeIsFirst = await page.evaluate(() => {
        const items = Array.from(document.querySelectorAll('.pb-cp__item'));
        return items[0]?.classList.contains('pb-cp__item--active') && !items[0].textContent.includes('3つだけ教えてください');
      });
      check('survey-row: 既定選択(先頭)は通常コマンドのまま', activeIsFirst);
      const lastIsActive = await page.evaluate(() => {
        const items = Array.from(document.querySelectorAll('.pb-cp__item'));
        return items[items.length - 1]?.classList.contains('pb-cp__item--active');
      });
      check('survey-row: アンケート行は既定で選択されていない', !lastIsActive);
    } finally {
      await page.close();
    }
  }

  // 2) 検索語を入れると、アンケート行は消える(通常コマンドにのみヒットする)
  {
    const page = await browser.newPage();
    try {
      await openPalette(page, { surveyState: { eligibleAt: now - 1000, bandDismissed: false, done: false } });
      await page.evaluate(() => {
        const input = document.querySelector('.pb-cp__search-input');
        input.value = 'ヘルプ';
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
      await page.waitForTimeout(150);
      const texts = itemTexts(await page.evaluate(() =>
        Array.from(document.querySelectorAll('.pb-cp__item')).map((el) => el.textContent)));
      check('survey-row: 検索語があると行は出ない', !texts.some((t) => t.includes('3つだけ教えてください')));
    } finally {
      await page.close();
    }
  }

  // 3) done:true → 空クエリでも出ない
  {
    const page = await browser.newPage();
    try {
      await openPalette(page, { surveyState: { eligibleAt: now - 1000, bandDismissed: false, done: true } });
      const texts = itemTexts(await page.evaluate(() =>
        Array.from(document.querySelectorAll('.pb-cp__item')).map((el) => el.textContent)));
      check('survey-row: done済みなら出ない', !texts.some((t) => t.includes('3つだけ教えてください')));
    } finally {
      await page.close();
    }
  }

  // 4) 7日の期限切れ → 出ない
  {
    const page = await browser.newPage();
    try {
      await openPalette(page, { surveyState: { eligibleAt: now - (sevenDaysMs + 60000), bandDismissed: false, done: false } });
      const texts = itemTexts(await page.evaluate(() =>
        Array.from(document.querySelectorAll('.pb-cp__item')).map((el) => el.textContent)));
      check('survey-row: 7日を過ぎると出ない', !texts.some((t) => t.includes('3つだけ教えてください')));
    } finally {
      await page.close();
    }
  }

  // 5) eligibleAt がまだ未来 → 出ない
  {
    const page = await browser.newPage();
    try {
      await openPalette(page, { surveyState: { eligibleAt: now + 60000, bandDismissed: false, done: false } });
      const texts = itemTexts(await page.evaluate(() =>
        Array.from(document.querySelectorAll('.pb-cp__item')).map((el) => el.textContent)));
      check('survey-row: eligibleAtが未来だと出ない', !texts.some((t) => t.includes('3つだけ教えてください')));
    } finally {
      await page.close();
    }
  }

  // 6) 状態キーが無い(対象外ユーザー) → 出ない
  {
    const page = await browser.newPage();
    try {
      await openPalette(page, {});
      const texts = itemTexts(await page.evaluate(() =>
        Array.from(document.querySelectorAll('.pb-cp__item')).map((el) => el.textContent)));
      check('survey-row: 状態キーが無いと出ない', !texts.some((t) => t.includes('3つだけ教えてください')));
    } finally {
      await page.close();
    }
  }

  // 7) クリックで新規タブ(window.open)が開き、バージョン・言語がプリフィルされ、done=trueが保存される
  {
    const page = await browser.newPage();
    try {
      await openPalette(page, { surveyState: { eligibleAt: now - 1000, bandDismissed: false, done: false }, version: '3.3.0', lang: 'ja' });
      await page.evaluate(() => {
        const items = Array.from(document.querySelectorAll('.pb-cp__item'));
        const target = items.find((el) => el.textContent.includes('3つだけ教えてください'));
        target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        target.click();
      });
      await page.waitForTimeout(200);
      const opened = await page.evaluate(() => window.__opened);
      check('survey-row: クリックで新規タブを1回開く', opened.length === 1);
      const url = opened[0]?.url || '';
      check('survey-row: URLベース', url.startsWith(
        'https://docs.google.com/forms/d/e/1FAIpQLSdVQboVqyIhnqa_EgwthxUzkOmbLgld9tg2c04AcxUVBR8ROw/viewform'));
      check('survey-row: バージョンがプリフィルされる', url.includes('entry.1032001690=3.3.0'));
      check('survey-row: 言語=jaがプリフィルされる', url.includes('entry.1077819437=ja'));

      const saved = await page.evaluate(() => window.__store['kfavSurveyA']);
      check('survey-row: クリックでdone=trueが保存される', saved?.done === true);

      // パレットを閉じて開き直すと、もう出ない(done済み)
      await page.evaluate(() => { window.__cp.palette.close(); });
      await page.evaluate(() => window.__cp.palette.open());
      await page.waitForTimeout(200);
      const textsAfter = itemTexts(await page.evaluate(() =>
        Array.from(document.querySelectorAll('.pb-cp__item')).map((el) => el.textContent)));
      check('survey-row: 回答後は再度開いても出ない', !textsAfter.some((t) => t.includes('3つだけ教えてください')));
    } finally {
      await page.close();
    }
  }

  // 8) Enterキーで選択しても同様に実行される
  {
    const page = await browser.newPage();
    try {
      await openPalette(page, { surveyState: { eligibleAt: now - 1000, bandDismissed: false, done: false }, version: '3.3.0', lang: 'en' });
      // ArrowUp で一覧の末尾(アンケート行)まで移動してからEnter
      const count = await page.evaluate(() => document.querySelectorAll('.pb-cp__item').length);
      for (let i = 0; i < count - 1; i++) {
        await page.evaluate(() => {
          document.querySelector('.pb-cp__search-input').dispatchEvent(
            new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
        });
      }
      const activeIsLast = await page.evaluate(() => {
        const items = Array.from(document.querySelectorAll('.pb-cp__item'));
        return items[items.length - 1]?.classList.contains('pb-cp__item--active');
      });
      check('survey-row: ArrowDownで末尾(アンケート行)まで移動できる', activeIsLast);

      await page.evaluate(() => {
        document.querySelector('.pb-cp__search-input').dispatchEvent(
          new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
      });
      await page.waitForTimeout(200);
      const opened = await page.evaluate(() => window.__opened);
      check('survey-row: Enterで新規タブを開く', opened.length === 1);
      const url = opened[0]?.url || '';
      check('survey-row: Enter実行時も言語=enがプリフィルされる', url.includes('entry.1077819437=en'));
    } finally {
      await page.close();
    }
  }
}
