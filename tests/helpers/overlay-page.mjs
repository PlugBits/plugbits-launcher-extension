// Excel Overlay / Quick New Record (QNR) の E2E テスト共通ボイラープレート。
// 「chrome-stub投入 → src/ の各ファイルを route で demo.cybozu.com に偽装配信
// → manifest.json と同じ順序でスクリプトタグ注入 → 起動キーを送る」までを担う。
// page-bridge.js の応答内容(fields/records/各種メッセージハンドラ)はテストごとに
// 固有性が高いため、ここでは配信・注入・起動だけを行い、bridgeScript の中身は
// 呼び出し側(各テストファイル)が組み立てて渡す。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildChromeStub } from './chrome-stub.mjs';

const srcDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'src');
const read = (name) => fs.readFileSync(path.join(srcDir, name), 'utf8');
const contentJs = read('content.js');
const overlayCss = read('overlay.css');
const permissionServiceJs = read('permission-service.js');
const proServiceJs = read('pro-service.js');

export const ORIGIN = 'https://demo.cybozu.com';

async function routeSrcFiles(ctx, bridgeScript, { withPro }) {
  await ctx.route(`${ORIGIN}/**`, (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/content.js')) return route.fulfill({ contentType: 'text/javascript; charset=utf-8', body: contentJs });
    if (withPro && url.pathname.endsWith('/permission-service.js')) return route.fulfill({ contentType: 'text/javascript; charset=utf-8', body: permissionServiceJs });
    if (withPro && url.pathname.endsWith('/pro-service.js')) return route.fulfill({ contentType: 'text/javascript; charset=utf-8', body: proServiceJs });
    if (url.pathname.endsWith('overlay.css')) return route.fulfill({ contentType: 'text/css; charset=utf-8', body: overlayCss });
    if (url.pathname.endsWith('/page-bridge.js')) return route.fulfill({ contentType: 'text/javascript; charset=utf-8', body: bridgeScript });
    return route.fulfill({ contentType: 'text/html; charset=utf-8', body: '<!doctype html><body style="background:#e8ecf2"></body>' });
  });
}

// Excel Overlay(グリッド編集)系のテスト用コンテキストを開く。
// Standardモードでは一覧のセル編集ができないため、pro-service.jsが有効entitlement
// として扱うProライセンスキャッシュ(24h以内のcachedAt・status:'active')を事前投入し、
// manifest.jsonのcontent_scriptsと同じ順序でpermission-service.js/pro-service.js/
// content.jsを読み込む。
// pro: false で呼ぶと pbLicenseKey/pbLicenseCache を一切投入しない(= 無料/Standardモード。
// pro-service.jsのevaluateProductionEntitlementはキー無しなら{enabled:false,source:'no_key'}を
// 同期的に返すのでネットワークは叩かれない)。無料ユーザーでのview-only挙動を検証するテスト用
export async function openOverlayContext({ browser, bridgeScript, viewport = { width: 1400, height: 900 }, deviceScaleFactor, url, pro = true }) {
  const ctx = await browser.newContext({ viewport, ...(deviceScaleFactor ? { deviceScaleFactor } : {}) });
  await ctx.addInitScript(buildChromeStub({ empty: true }));
  if (pro) {
    await ctx.addInitScript(() => {
      window.chrome.storage.local.set({
        pbLicenseKey: 'TEST-KEY',
        pbLicenseCache: { status: 'active', cachedAt: Date.now() }
      });
    });
  }
  await routeSrcFiles(ctx, bridgeScript, { withPro: true });

  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e?.message || e).slice(0, 200)));

  await page.goto(url || `${ORIGIN}/k/12/?view=20`);
  await page.addScriptTag({ url: `${ORIGIN}/permission-service.js` });
  await page.addScriptTag({ url: `${ORIGIN}/pro-service.js` });
  await page.addScriptTag({ url: `${ORIGIN}/content.js` });
  await page.waitForTimeout(400);

  return { ctx, page, errors };
}

// detail-single-row(フォームレイアウト)用: /k/<app>/show#record=<id> を開いてから
// Ctrl+Shift+E で起動する。runtimeMode=detail-single-row になり、
// overlayLayoutMode は自動的に 'form' になる(isDetailFormLayoutMode()がtrue)。
export async function openDetailFormOverlay({ browser, bridgeScript, appId = '12', recordId = '301', viewport, deviceScaleFactor }) {
  const url = `${ORIGIN}/k/${appId}/show#record=${recordId}`;
  const result = await openOverlayContext({ browser, bridgeScript, viewport, deviceScaleFactor, url });
  await result.page.keyboard.press('Control+Shift+KeyE');
  await result.page.waitForTimeout(1200);
  return result;
}

// openOverlayContext に続けて Ctrl+Shift+E で Excel Overlay グリッドを起動する
export async function openOverlay(opts) {
  const result = await openOverlayContext(opts);
  await result.page.keyboard.press('Control+Shift+KeyE');
  await result.page.waitForTimeout(1200);
  return result;
}

// Quick New Record (QNR)系のテスト用コンテキストを開く。QNRはStandardモードでも
// 使えるためProライセンスもpermission-service.js/pro-service.jsも不要(content.jsのみ)
export async function openQnrContext({ browser, bridgeScript, viewport = { width: 1000, height: 900 }, deviceScaleFactor }) {
  const ctx = await browser.newContext({ viewport, ...(deviceScaleFactor ? { deviceScaleFactor } : {}) });
  await ctx.addInitScript(buildChromeStub({ empty: true }));
  await routeSrcFiles(ctx, bridgeScript, { withPro: false });

  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e?.message || e).slice(0, 200)));

  await page.goto(`${ORIGIN}/k/12/?view=20`);
  await page.addScriptTag({ url: `${ORIGIN}/content.js` });
  await page.waitForTimeout(400);

  return { ctx, page, errors };
}

// openQnrContext に続けて Shift+Alt+N で Quick New モーダルを起動する
export async function openQnr(opts) {
  const result = await openQnrContext(opts);
  await result.page.keyboard.press('Shift+Alt+KeyN');
  await result.page.waitForTimeout(900);
  return result;
}

// Excel Overlay グリッドのセルinputロケータ
export function cell(page, rowIndex, fieldCode) {
  return page.locator(`.pb-overlay__cell input[data-field-code="${fieldCode}"][data-row-index="${rowIndex}"]`);
}
