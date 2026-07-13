// API使用統計の入り口: page-bridge が発行する usage イベントを
// content.js が拾って chrome.storage.local の apiUsageDaily に積むまでを検証する。
// content.js は kintone 系ホストでのみ動くため、demo.cybozu.com をルーティングで模す。
// イベント形式は page-bridge.js の emitApiUsage() と同一。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildChromeStub } from './helpers/chrome-stub.mjs';

const srcDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');

export async function run({ browser, check }) {
  const ctx = await browser.newContext({ viewport: { width: 900, height: 600 } });
  await ctx.addInitScript(buildChromeStub({ empty: true }));

  const contentJs = fs.readFileSync(path.join(srcDir, 'content.js'), 'utf8');
  await ctx.route('https://demo.cybozu.com/**', (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/content.js') {
      return route.fulfill({ contentType: 'text/javascript', body: contentJs });
    }
    if (url.pathname === '/page-bridge.js') {
      return route.fulfill({ contentType: 'text/javascript', body: '/* bridge stub */' });
    }
    return route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><body><div id="body"></div></body></html>' });
  });

  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (err) => errors.push(String(err?.message || err)));
  await page.goto('https://demo.cybozu.com/k/12/');
  await page.addScriptTag({ url: 'https://demo.cybozu.com/content.js' });
  await page.waitForTimeout(500);

  const emit = (payload) => page.evaluate((p) => {
    window.postMessage({ ['__kfav_api_usage__']: true, payload: p }, location.origin);
  }, payload);

  // page-bridge の emitApiUsage と同じ形のイベントを発行
  await emit({ feature: 'watchlist', endpoint: '/k/v1/records.json', ok: true, sent: true, requestCount: 3 });
  await emit({ feature: 'overlay_file_upload', endpoint: '/k/v1/file.json', ok: true, sent: true, requestCount: 1 });
  await emit({ feature: 'lookup_candidates', endpoint: '/k/v1/records.json', ok: false, sent: true, requestCount: 1 });
  await emit({ feature: 'command_palette', endpoint: '/k/v1/records.json', ok: true, sent: true, requestCount: 1 });
  await emit({ feature: 'totally_unknown_feature', endpoint: '/k/v1/records.json', ok: true, sent: true, requestCount: 1 });
  await emit({ feature: 'watchlist', endpoint: 'https://evil.example/api', ok: true, sent: true, requestCount: 9 });

  // フラッシュ遅延（1200ms）を待つ
  await page.waitForTimeout(1800);

  const daily = await page.evaluate(async () => {
    const stored = await chrome.storage.local.get('apiUsageDaily');
    return stored.apiUsageDaily || null;
  });

  check('tracking: apiUsageDaily written', Boolean(daily));

  const dateKeys = daily ? Object.keys(daily) : [];
  const today = dateKeys[0] ? daily[dateKeys[0]] : {};
  check('tracking: single local-date bucket', dateKeys.length === 1 && /^\d{4}-\d{2}-\d{2}$/.test(dateKeys[0] || ''));

  check('tracking: watchlist counted as watchlist_bulk (requestCount=3)',
    today.watchlist_bulk?.count === 3 && today.watchlist_bulk?.success === 3);
  check('tracking: overlay_file_upload counted',
    today.overlay_file_upload?.count === 1 && today.overlay_file_upload?.success === 1);
  check('tracking: lookup_candidates error counted',
    today.lookup_candidates?.count === 1 && today.lookup_candidates?.error === 1);
  check('tracking: command_palette counted',
    today.command_palette?.count === 1);
  check('tracking: unknown feature dropped (no other bucket)',
    today.other === undefined);
  const total = Object.values(today).reduce((sum, stat) => sum + (stat?.count || 0), 0);
  check('tracking: non-/k/v1 endpoint dropped (total=6)', total === 6);

  await ctx.close();
}
