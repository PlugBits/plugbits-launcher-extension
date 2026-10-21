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
  ['options-pro-actions', './options-pro-actions.test.mjs'],
  ['options-api-usage', './options-api-usage.test.mjs'],
  ['api-usage-tracking', './api-usage-tracking.test.mjs'],
  // 3.3.0: 利用者アンケート A（onInstalled適格化・設定画面バナー・パレット行・manifest不変の確認）
  ['survey-eligibility', './survey-eligibility.test.mjs'],
  ['survey-options-band', './survey-options-band.test.mjs'],
  ['survey-palette-row', './survey-palette-row.test.mjs'],
  ['survey-kintone-toast', './survey-kintone-toast.test.mjs'],
  ['survey-manifest', './survey-manifest.test.mjs'],
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
  ['qnr-field-picker-flow', './qnr-field-picker-flow.test.mjs'],
  ['qnr-field-picker-persist', './qnr-field-picker-persist.test.mjs'],
  // 単体（content.js/page-bridge.jsから関数・メソッドを抽出して検証する系）
  ['overlay-lookup-unit', './overlay-lookup-unit.test.mjs'],
  ['lookup-cache-unit', './lookup-cache-unit.test.mjs'],
  ['newrow-defaults-unit', './newrow-defaults-unit.test.mjs'],
  ['paste-verify-unit', './paste-verify-unit.test.mjs'],
  ['overlay-quality-unit', './overlay-quality-unit.test.mjs'],
  // sendRuntimeMessageWithTimeout(3.2.0診断版b): SWが応答しないchrome.runtime.sendMessage
  // でもクライアント側の時間切れで必ず解決することの単体テスト
  ['metadata-bundle-timeout-unit', './metadata-bundle-timeout-unit.test.mjs'],
  ['query-split-unit', './query-split-unit.test.mjs'],
  ['view-column-sync-unit', './view-column-sync-unit.test.mjs'],
  // ビュー列連動 E2E（chrome-stub + fake bridge + chrome.runtime.sendMessage
  // のPB_GET_METADATA_BUNDLE応答で実際のビュー列連動を再現する系）
  ['view-column-sync-e2e', './view-column-sync-e2e.test.mjs'],
  ['view-default-preset-unit', './view-default-preset-unit.test.mjs'],
  ['view-default-preset-e2e', './view-default-preset-e2e.test.mjs'],
  ['overlay-open-timing-e2e', './overlay-open-timing-e2e.test.mjs'],
  ['view-sync-after-trial-e2e', './view-sync-after-trial-e2e.test.mjs'],
  // 3.3.0: サブテーブル編集モーダルへのExcel範囲貼り付け + 引用符囲みセル(改行入り)のTSV解析
  ['parse-clipboard-matrix-unit', './parse-clipboard-matrix-unit.test.mjs'],
  ['subtable-paste-e2e', './subtable-paste-e2e.test.mjs'],
  // サブテーブルセルのダブルクリックでopenSubtableEditorが3重発火していたバグの回帰テスト
  ['subtable-dblclick-e2e', './subtable-dblclick-e2e.test.mjs'],
  // サブテーブル編集モーダルのキャンセル/×/Escが閉じない・Escがoverlay全体を閉じるバグの回帰テスト
  ['subtable-modal-close-e2e', './subtable-modal-close-e2e.test.mjs'],
  // 3.4.0: サブテーブル編集モーダルをメイングリッドの選択UIのように振る舞わせる
  // (選択/アクティブ/編集中・行番号列・矢印/Tab/Enter/F2/Esc/Delete/Ctrl+C/V/Ctrl+Enter)
  ['subtable-grid-e2e', './subtable-grid-e2e.test.mjs'],
  // 3.4.0: メイングリッド(一覧)のCtrl+Cもサブテーブルと同じExcel互換TSV(改行・タブ・"を
  // 含むセルを"…"で囲む)になったことの確認(クォートなしのプレーン範囲・クォート往復・無料モード)
  ['grid-copy-tsv-e2e', './grid-copy-tsv-e2e.test.mjs'],
  // 3.4.1: メイングリッドのフィルハンドル(ソース行数の倍数でない範囲への書き過ぎ/書き漏らし・
  // 表示整形経由での値破損のバグ修正・Excelの上方向周期順・Esc中断・Undo1回まとめ)
  ['grid-fill-e2e', './grid-fill-e2e.test.mjs'],
  // 3.4.0: サブテーブル編集モーダル専用のUndo/Redo(メイングリッドのthis.undoStack/
  // this.redoStackとは別物。Ctrl+Z/Ctrl+Y/Ctrl+Shift+Z・フッターボタン・編集中は
  // ネイティブ入力へ任せる・IME無視・モーダルを開いている間は本体のUndo/Redoに触れない)
  ['subtable-undo-e2e', './subtable-undo-e2e.test.mjs']
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
