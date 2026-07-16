// E2Eテストランナー
//   npm test              … 全テスト実行
//   node tests/run-all.mjs sidepanel … 名前でフィルタ
//
// Chromium はローカルの playwright インストールを使う。パスを固定したい場合は
// PB_TEST_CHROMIUM=/path/to/chromium を指定する。
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { startStaticServer } from './helpers/server.mjs';

const testsDir = path.dirname(fileURLToPath(import.meta.url));
const srcDir = path.join(testsDir, '..', 'src');

const SUITES = [
  ['sidepanel', './sidepanel.test.mjs'],
  ['palette', './palette.test.mjs'],
  ['palette-settings', './palette-settings.test.mjs'],
  ['trial', './trial.test.mjs'],
  ['options-api-usage', './options-api-usage.test.mjs'],
  ['api-usage-tracking', './api-usage-tracking.test.mjs'],
  // Excel Overlay E2E（chrome-stub + fake bridge + Proライセンス投入でフル起動する系）
  ['overlay-lookup-grid', './overlay-lookup-grid.test.mjs'],
  ['lookup-cache-e2e', './lookup-cache-e2e.test.mjs'],
  ['dblclick-blur', './dblclick-blur.test.mjs'],
  ['newrow-defaults-e2e', './newrow-defaults-e2e.test.mjs'],
  ['toolbar-menu', './toolbar-menu.test.mjs'],
  ['grid-kbd-hostile', './grid-kbd-hostile.test.mjs'],
  ['picker-layout', './picker-layout.test.mjs'],
  ['paste-verify-e2e', './paste-verify-e2e.test.mjs'],
  ['verify-all-paths', './verify-all-paths.test.mjs'],
  ['type-replace-firstchar', './type-replace-firstchar.test.mjs'],
  // Quick New Record (QNR) E2E（chrome-stub + fake bridge、content.js注入）
  ['qnr-lookup-combo', './qnr-lookup-combo.test.mjs'],
  ['qnr-lookup-kbd', './qnr-lookup-kbd.test.mjs'],
  ['qnr-modal-flow', './qnr-modal-flow.test.mjs'],
  // 単体（content.js/page-bridge.jsから関数・メソッドを抽出して検証する系）
  ['overlay-lookup-unit', './overlay-lookup-unit.test.mjs'],
  ['lookup-cache-unit', './lookup-cache-unit.test.mjs'],
  ['newrow-defaults-unit', './newrow-defaults-unit.test.mjs'],
  ['paste-verify-unit', './paste-verify-unit.test.mjs'],
  ['overlay-quality-unit', './overlay-quality-unit.test.mjs']
];

const filter = process.argv[2];
const results = [];
const check = (name, cond) => {
  results.push({ name, pass: Boolean(cond) });
  console.log(`${cond ? 'PASS' : 'FAIL'}: ${name}`);
};

const server = await startStaticServer(srcDir);
const browser = await chromium.launch({
  executablePath: process.env.PB_TEST_CHROMIUM || undefined
});

try {
  for (const [name, file] of SUITES) {
    if (filter && !name.includes(filter)) continue;
    console.log(`\n── ${name} ──`);
    const mod = await import(file);
    try {
      await mod.run({ browser, origin: server.origin, check });
    } catch (err) {
      check(`${name}: suite crashed (${String(err?.message || err).slice(0, 120)})`, false);
    }
  }
} finally {
  await browser.close();
  await server.close();
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) process.exit(1);
