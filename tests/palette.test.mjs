// コマンドパレット: i18n・ARIA・フォーカストラップ・チートシート
// content-command-palette.js の @@BODY_START 以降を、テンプレートが提供する
// 依存（resolveText等）のスタブと共に素のページで評価して検証する。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const srcDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');

function buildHarness() {
  const paletteSrc = fs.readFileSync(path.join(srcDir, 'content-command-palette.js'), 'utf8');
  const marker = '// @@BODY_START\n';
  const body = paletteSrc.slice(paletteSrc.indexOf(marker) + marker.length);
  return `
(function(){
  const DEFAULT_OVERLAY_LANGUAGE = 'ja';
  window.__lang = 'ja';
  function resolveText(lang, key) { return lang + ':' + key; }
  async function resolveOverlayUiLanguage() { return { language: window.__lang }; }
  const postToPage = async () => ({ ok: false });
  window.chrome = { runtime: { sendMessage: async (msg) => {
    if (msg && msg.type === 'CP_GET_SHORTCUTS') return { ok: true, shortcuts: [
      { label: 'QB入力', host: 'https://x.kintone.com', appId: '1', type: 'appTop' },
      { label: '出荷一覧', host: 'https://x.kintone.com', appId: '2', type: 'appTop' }
    ] };
    return { ok: false };
  } } };
  ${body}
  window.__cp = {
    palette: commandPalette,
    toggleCheatsheet: cpToggleCheatsheet,
    isCheatsheetOpen: () => {
      const el = document.getElementById('pb-cp-cheatsheet');
      return Boolean(el) && getComputedStyle(el).display !== 'none';
    }
  };
})();
`;
}

export async function run({ browser, check }) {
  const page = await browser.newPage();
  await page.setContent('<!doctype html><html><body><p>host</p></body></html>');
  await page.evaluate(buildHarness());

  await page.evaluate(() => window.__cp.palette.open());
  await page.waitForTimeout(100);
  const ph = await page.evaluate(() => document.querySelector('.pb-cp__search-input')?.placeholder);
  check(`palette: ja placeholder resolved (${ph})`, ph === 'ja:cpPhCommand');

  const aria = await page.evaluate(() => {
    const panel = document.getElementById('pb-command-palette');
    const list = document.getElementById('pb-cp-list');
    const input = document.querySelector('.pb-cp__search-input');
    return {
      dialog: panel?.getAttribute('role'),
      modal: panel?.getAttribute('aria-modal'),
      listbox: list?.getAttribute('role'),
      hasOption: Boolean(list?.querySelector('[role="option"]')),
      activedesc: input?.getAttribute('aria-activedescendant')
    };
  });
  check('palette: role=dialog aria-modal', aria.dialog === 'dialog' && aria.modal === 'true');
  check('palette: listbox with options', aria.listbox === 'listbox' && aria.hasOption);
  check('palette: aria-activedescendant set', Boolean(aria.activedesc));

  await page.evaluate(() => document.querySelector('.pb-cp__search-input')?.focus());
  await page.keyboard.press('Tab');
  let cls = await page.evaluate(() => document.activeElement?.className || '');
  check('palette: Tab moves to shortcut button', cls.includes('pb-cp__sc-btn'));
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  cls = await page.evaluate(() => document.activeElement?.className || '');
  check('palette: Tab wraps back to input', cls.includes('pb-cp__search-input'));

  await page.keyboard.press('Tab');
  await page.keyboard.press('Escape');
  check('palette: Esc closes from sc-button focus', !(await page.evaluate(() => window.__cp.palette.isOpen)));

  await page.evaluate(() => { window.__lang = 'en'; });
  await page.evaluate(() => window.__cp.palette.open());
  await page.waitForTimeout(100);
  const phEn = await page.evaluate(() => document.querySelector('.pb-cp__search-input')?.placeholder);
  check('palette: en placeholder after language switch', phEn === 'en:cpPhCommand');
  await page.evaluate(() => window.__cp.palette.close());

  await page.evaluate(() => window.__cp.toggleCheatsheet(true));
  const csTitle = await page.evaluate(() => document.querySelector('.pb-cs__title')?.textContent);
  check('cheatsheet: rebuilt in en', csTitle === 'en:csTitle');
  const csFocus = await page.evaluate(() => document.activeElement?.className || '');
  check('cheatsheet: focuses close button', csFocus.includes('pb-cs__close'));
  await page.keyboard.press('Escape');
  check('cheatsheet: closes on Esc', !(await page.evaluate(() => window.__cp.isCheatsheetOpen())));

  // 開閉の全経路
  await page.evaluate(() => window.__cp.toggleCheatsheet(true));
  await page.mouse.move(5, 5);
  await page.mouse.down();
  await page.mouse.up();
  check('cheatsheet: backdrop click closes', !(await page.evaluate(() => window.__cp.isCheatsheetOpen())));
  await page.keyboard.press('?');
  check("cheatsheet: '?' key opens", await page.evaluate(() => window.__cp.isCheatsheetOpen()));
  await page.evaluate(() => document.querySelector('#pb-cp-cheatsheet .pb-cs__close')?.click());
  check('cheatsheet: close button closes', !(await page.evaluate(() => window.__cp.isCheatsheetOpen())));

  await page.close();
}
