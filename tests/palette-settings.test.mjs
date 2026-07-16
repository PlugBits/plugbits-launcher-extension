// コマンドパレット: 拡張機能設定ジャンプコマンド + フィールド一覧コピーのアプリID行の検証。
// tests/palette.test.mjs と同じ「content-command-palette.js の @@BODY_START以降を、
// スタブと共に素のページで評価する」方式。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const srcDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');
const paletteSrc = fs.readFileSync(path.join(srcDir, 'content-command-palette.js'), 'utf8');
const marker = '// @@BODY_START\n';
const body = paletteSrc.slice(paletteSrc.indexOf(marker) + marker.length);

function buildHarness() {
  return `
(function(){
  const DEFAULT_OVERLAY_LANGUAGE = 'ja';
  window.__lang = 'ja';
  // 実物のja文言に近い形で解決する（設定コマンドの検索確認のため一部だけ実文言）
  const JA = {
    cpCmdOpenExtSettings: 'PlugBits拡張機能の設定を開く',
    cpFieldListAppIdLabel: 'アプリID',
    cpToastCopiedFields: (n) => n + '件のフィールドをコピーしました'
  };
  function resolveText(lang, key, ...args) {
    const v = JA[key];
    if (typeof v === 'function') return v(...args);
    return v || (lang + ':' + key);
  }
  async function resolveOverlayUiLanguage() { return { language: window.__lang }; }
  const postToPage = async (type, payload) => {
    if (type === 'CP_GET_CONTEXT') return { ok: true, result: { appId: '123', recordId: null, query: '' } };
    if (type === 'CP_GET_FIELDS') return { ok: true, result: { fields: [
      { code: '案件名', label: '案件名', type: 'SINGLE_LINE_TEXT' },
      { code: '数量', label: '数量', type: 'NUMBER' }
    ] } };
    return { ok: false };
  };
  window.__sentMessages = [];
  window.chrome = { runtime: { sendMessage: async (msg) => {
    window.__sentMessages.push(msg);
    if (msg && msg.type === 'CP_GET_SHORTCUTS') return { ok: true, shortcuts: [] };
    return { ok: true };
  } } };
  window.__copied = [];
  ${body}
  window.__cp = { palette: commandPalette };
})();
`;
}

export async function run({ browser, check }) {
  const page = await browser.newPage();
  try {
    await page.setContent('<!doctype html><html><body><p>host</p></body></html>');
    await page.evaluate(() => {
      // cpCopyText は navigator.clipboard を使うため書き込みを記録するスパイに差し替える
      Object.defineProperty(navigator, 'clipboard', {
        value: { writeText: async (t) => { window.__copied.push(t); } },
        configurable: true
      });
    });
    await page.evaluate(buildHarness());

    await page.evaluate(() => window.__cp.palette.open());
    await page.waitForTimeout(200);

    // 「設定」で検索して新コマンドがヒットする
    await page.evaluate(() => {
      const input = document.querySelector('.pb-cp__search-input');
      input.value = '設定';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await page.waitForTimeout(150);
    const hit = await page.evaluate(() => {
      const items = Array.from(document.querySelectorAll('.pb-cp__item'));
      return items.some((el) => el.textContent.includes('PlugBits拡張機能の設定を開く'));
    });
    check('palette-settings: 「設定」で拡張設定コマンドがヒットする', hit);

    // 英語系キーワードでもヒットする
    await page.evaluate(() => {
      const input = document.querySelector('.pb-cp__search-input');
      input.value = 'options';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await page.waitForTimeout(150);
    check('palette-settings: "options" でもヒットする', await page.evaluate(() => {
      const items = Array.from(document.querySelectorAll('.pb-cp__item'));
      return items.some((el) => el.textContent.includes('PlugBits拡張機能の設定を開く'));
    }));

    // 実行すると PB_OPEN_OPTIONS_PAGE がservice workerへ飛ぶ
    await page.evaluate(() => {
      const items = Array.from(document.querySelectorAll('.pb-cp__item'));
      const target = items.find((el) => el.textContent.includes('PlugBits拡張機能の設定を開く'));
      target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      target.click();
    });
    await page.waitForTimeout(200);
    const sent = await page.evaluate(() => window.__sentMessages.map((m) => m?.type));
    check('palette-settings: 実行で PB_OPEN_OPTIONS_PAGE を送信', sent.includes('PB_OPEN_OPTIONS_PAGE'));

    // フィールド一覧コピー: 先頭行にアプリID、以降は従来のTSV
    await page.evaluate(() => window.__cp.palette.copyFieldCodes({ appId: '123' }));
    await page.waitForTimeout(200);
    const copied = await page.evaluate(() => window.__copied[window.__copied.length - 1] || '');
    const lines = copied.split('\n');
    check('palette-settings: copyFieldCodes 1行目がアプリID行', lines[0] === 'アプリID\t123');
    check(
      'palette-settings: copyFieldCodes 2行目以降は従来のTSV',
      lines[1] === '案件名\t案件名\tSINGLE_LINE_TEXT' && lines[2] === '数量\t数量\tNUMBER'
    );
    check('palette-settings: copyFieldCodes 行数 = ヘッダ1 + フィールド2', lines.length === 3);
  } finally {
    await page.close();
  }
}
