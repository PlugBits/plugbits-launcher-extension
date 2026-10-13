// open()〜fetchData()の各段(ステージ)境界でのタイミング計測ログ
// (`[PB][diag] overlay-open stage=...`)のE2Eテスト(v3.3.0診断版)。
//
// 確認すること:
//  - デフォルト(localStorage.pbDiagが無い状態)では一切ログが出ない
//    (診断ログは常にOFFで配布され、ユーザーがlocalStorage.pbDiag=1を
//    自分でセットした時だけ出る、という既存の[PB][diag]の作法どおり)
//  - localStorage.pbDiag='1' をセットした状態で起動すると、open()〜
//    fetchData()の各段のステージ行が「+経過ms(前ステージからのms)」付きで
//    時系列順に出て、最後に全ステージをまとめたsummary行が1本出る
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildChromeStub } from './helpers/chrome-stub.mjs';
import { ORIGIN } from './helpers/overlay-page.mjs';

const srcDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');
const read = (name) => fs.readFileSync(path.join(srcDir, name), 'utf8');
const contentJs = read('content.js');
const overlayCss = read('overlay.css');
const permissionServiceJs = read('permission-service.js');
const proServiceJs = read('pro-service.js');

const APP_ID = '12';
const VIEW_ID = '20';

const FIELDS_META = [
  { code: 'A', label: 'A', type: 'SINGLE_LINE_TEXT', required: false, choices: [] },
  { code: 'B', label: 'B', type: 'SINGLE_LINE_TEXT', required: false, choices: [] }
];
const VIEWS_RAW = {
  'ビュー20': { id: VIEW_ID, index: '0', filterCond: '', sort: '', fields: ['A', 'B'] }
};
const RECORDS = [
  { $id: { value: '1' }, $revision: { value: '1' }, A: { value: 'a1' }, B: { value: 'b1' } }
];

// open()〜fetchData()で記録されるはずのステージ名(時系列順)
const EXPECTED_STAGES = [
  'load_overlay_mode',
  'ensure_styles',
  'load_language',
  'mount_shell',
  'app_context',
  'metadata_bundle',
  'view_info',
  'fields_meta',
  'layout_state',
  'permissions',
  'records',
  'fetch_data',
  'render_grid'
];

function buildBridgeScript() {
  return `
const RECORDS = ${JSON.stringify(RECORDS)};
window.addEventListener('message', (ev) => {
  const d = ev.data || {};
  if (!d || d.__kfav__ !== true || !d.id || d.replyTo) return;
  const reply = (extra) => window.postMessage({ __kfav__: true, replyTo: d.id, ...extra }, location.origin);
  const type = d.type;
  if (type === 'EXCEL_GET_APP_CONTEXT') return reply({ ok: true, appId: '${APP_ID}', appName: '診断ログテストアプリ', query: '', timezone: 'Asia/Tokyo' });
  if (type === 'EXCEL_GET_RECORDS') return reply({ ok: true, records: RECORDS, totalCount: RECORDS.length });
  if (type === 'EXCEL_EVALUATE_RECORD_ACL') {
    const ids = Array.isArray(d.payload?.ids) ? d.payload.ids : [];
    return reply({ ok: true, rights: ids.map((id) => ({ id, editable: true, deletable: true, viewable: true })) });
  }
  if (type === 'EXCEL_GET_LOGIN_USER') return reply({ ok: true, user: { timezone: 'Asia/Tokyo' } });
  if (type === 'GET_APP_NAME') return reply({ ok: true, name: '診断ログテストアプリ' });
  reply({ ok: false });
});`;
}

async function openDiagOverlay({ browser, enableDiag }) {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  await ctx.addInitScript(buildChromeStub({ empty: true }));
  await ctx.addInitScript(() => {
    window.chrome.storage.local.set({
      pbLicenseKey: 'TEST-KEY',
      pbLicenseCache: { status: 'active', cachedAt: Date.now() }
    });
  });
  if (enableDiag) {
    // diagLog()は呼ばれた時点でlocalStorage.pbDiagを見るので、open()実行前
    // (スクリプト注入前)にセットしておけば十分
    await ctx.addInitScript(() => {
      try { window.localStorage.setItem('pbDiag', '1'); } catch (_err) { /* ignore */ }
    });
  }
  await ctx.addInitScript(({ viewsRaw, fieldsMeta }) => {
    window.chrome.runtime.sendMessage = (msg) => {
      if (msg && msg.type === 'PB_GET_METADATA_BUNDLE') {
        return Promise.resolve({
          ok: true,
          bundle: {
            app: { name: '診断ログテストアプリ' },
            views: { raw: viewsRaw },
            fields: { normalized: fieldsMeta }
          }
        });
      }
      if (msg && msg.type === 'CP_GET_SHORTCUTS') return Promise.resolve({ ok: true, shortcuts: [] });
      return Promise.resolve({ ok: false });
    };
  }, { viewsRaw: VIEWS_RAW, fieldsMeta: FIELDS_META });

  const bridgeScript = buildBridgeScript();
  await ctx.route(`${ORIGIN}/**`, (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/content.js')) return route.fulfill({ contentType: 'text/javascript; charset=utf-8', body: contentJs });
    if (url.pathname.endsWith('/permission-service.js')) return route.fulfill({ contentType: 'text/javascript; charset=utf-8', body: permissionServiceJs });
    if (url.pathname.endsWith('/pro-service.js')) return route.fulfill({ contentType: 'text/javascript; charset=utf-8', body: proServiceJs });
    if (url.pathname.endsWith('overlay.css')) return route.fulfill({ contentType: 'text/css; charset=utf-8', body: overlayCss });
    if (url.pathname.endsWith('/page-bridge.js')) return route.fulfill({ contentType: 'text/javascript; charset=utf-8', body: bridgeScript });
    return route.fulfill({ contentType: 'text/html; charset=utf-8', body: '<!doctype html><body style="background:#e8ecf2"></body>' });
  });

  const page = await ctx.newPage();
  const consoleLines = [];
  page.on('console', (msg) => consoleLines.push(msg.text()));
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e?.message || e).slice(0, 200)));
  await page.goto(`${ORIGIN}/k/${APP_ID}/?view=${VIEW_ID}`);
  await page.addScriptTag({ url: `${ORIGIN}/permission-service.js` });
  await page.addScriptTag({ url: `${ORIGIN}/pro-service.js` });
  await page.addScriptTag({ url: `${ORIGIN}/content.js` });
  await page.waitForTimeout(400);
  await page.keyboard.press('Control+Shift+KeyE');
  await page.waitForTimeout(1200);
  return { ctx, page, consoleLines, errors };
}

export async function run({ browser, check }) {
  const name = (n) => `overlay-open-timing-e2e: ${n}`;

  // ── 1. デフォルト(pbDiag未設定): [PB][diag]の出力は一切出ない ──
  {
    const { ctx, page, consoleLines } = await openDiagOverlay({ browser, enableDiag: false });
    try {
      check(name('default (no pbDiag): overlay still opens normally'), (await page.locator('.pb-overlay').count()) > 0);
      const diagLines = consoleLines.filter((l) => l.includes('[PB][diag] overlay-open'));
      check(`${name('default (no pbDiag): zero overlay-open diag lines emitted')} (got ${diagLines.length})`,
        diagLines.length === 0);
    } finally {
      await ctx.close();
    }
  }

  // ── 2. localStorage.pbDiag='1': 各ステージ行+summary行が出る ──
  {
    const { ctx, page, consoleLines } = await openDiagOverlay({ browser, enableDiag: true });
    try {
      check(name('pbDiag=1: overlay opens normally'), (await page.locator('.pb-overlay').count()) > 0);

      const stageLinePattern = /^\[PB\]\[diag\] overlay-open stage=(\S+) \+(\d+)ms \((\d+)ms\)$/;
      const stageLines = consoleLines
        .map((l) => l.match(stageLinePattern))
        .filter(Boolean);
      const summaryLines = consoleLines.filter((l) => l.startsWith('[PB][diag] overlay-open summary '));

      check(`${name('pbDiag=1: emits exactly one stage line per expected stage, in order')} (got ${JSON.stringify(stageLines.map((m) => m[1]))})`,
        JSON.stringify(stageLines.map((m) => m[1])) === JSON.stringify(EXPECTED_STAGES));

      // 各行のms値は数値で、+経過msは単調非減少(ステージは時系列に積まれる)
      let prevCumulative = -1;
      let monotonic = true;
      stageLines.forEach((m) => {
        const cumulative = Number(m[2]);
        if (!Number.isFinite(cumulative) || cumulative < prevCumulative) monotonic = false;
        prevCumulative = cumulative;
      });
      check(name('pbDiag=1: cumulative +Xms is monotonically non-decreasing across stages'), monotonic);

      check(`${name('pbDiag=1: exactly one summary line')} (got ${summaryLines.length})`, summaryLines.length === 1);
      if (summaryLines.length) {
        const summary = summaryLines[0];
        check(name('pbDiag=1: summary line has a total=<ms>ms field'), /total=\d+ms/.test(summary));
        const allStagesInSummary = EXPECTED_STAGES.every((stage) => summary.includes(`${stage}=+`));
        check(`${name('pbDiag=1: summary line mentions every stage')} (got ${JSON.stringify(summary)})`, allStagesInSummary);
      }
    } finally {
      await ctx.close();
    }
  }
}
