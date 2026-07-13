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
  ['trial', './trial.test.mjs']
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
