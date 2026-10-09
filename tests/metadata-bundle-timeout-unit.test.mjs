// sendRuntimeMessageWithTimeout() の単体テスト。
// chrome.runtime.sendMessage はService Worker側がsendResponseを呼ばない場合
// (MV3でSWが処理中に落ちる等)、呼び出し側のPromiseが無期限に解決されない。
// content.js から該当メソッドを文字列として切り出し、「一切返事をしない
// sendMessage」をchrome-stub風に用意して、タイムアウトで必ず解決することを確認する。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractBraceBlock } from './helpers/extract-src.mjs';
import { checkEqual } from './helpers/assert.mjs';

const srcDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');
const src = fs.readFileSync(path.join(srcDir, 'content.js'), 'utf8');

function extractFunctionSource(signaturePattern) {
  const sigIdx = src.search(signaturePattern);
  if (sigIdx === -1) throw new Error(`signature not found: ${signaturePattern}`);
  const braceIdx = src.indexOf('{', sigIdx);
  if (braceIdx === -1) throw new Error(`opening brace not found for: ${signaturePattern}`);
  return src.slice(sigIdx, braceIdx) + extractBraceBlock(src, braceIdx);
}

export async function run({ check }) {
  const eq = (name, actual, expected) => checkEqual(check, `metadata-bundle-timeout-unit: ${name}`, actual, expected);

  const bodySrc = extractFunctionSource(
    /\n {4}async sendRuntimeMessageWithTimeout\(message, timeoutMs = 10000\) \{/
  ).replace(/^\n {4}async sendRuntimeMessageWithTimeout/, '');
  const fnSrc = `(async function sendRuntimeMessageWithTimeout${bodySrc})`;
  // eslint-disable-next-line no-eval
  const sendRuntimeMessageWithTimeout = eval(fnSrc);

  // --- ケース1: chrome-stub式の「一切返事をしないsendMessage」(SWがsendResponseを
  //     呼ばずに落ちた状態を模す) -> クライアント側の時間切れで必ず{ok:false}に解決する ---
  const realChrome = globalThis.chrome;
  globalThis.chrome = {
    runtime: {
      sendMessage: () => new Promise(() => { /* 永遠に解決しない */ })
    }
  };
  try {
    const t0 = Date.now();
    const res = await sendRuntimeMessageWithTimeout({ type: 'PB_GET_METADATA_BUNDLE' }, 50);
    const elapsed = Date.now() - t0;
    eq('応答なしsendMessage: ok=false', res?.ok, false);
    eq('応答なしsendMessage: error=Timeout', res?.error, 'Timeout');
    check('metadata-bundle-timeout-unit: 応答なしsendMessage: 指定timeoutMs付近で解決する(150ms未満)', elapsed < 150);
  } finally {
    globalThis.chrome = realChrome;
  }

  // --- ケース2: 通常どおり素早く応答が返るケース -> タイムアウトに引っかからず
  //     そのままの応答を返す(回帰: 正常系を壊していないことの確認) ---
  globalThis.chrome = {
    runtime: {
      sendMessage: () => Promise.resolve({ ok: true, bundle: { app: { name: 'demo' } } })
    }
  };
  try {
    const res = await sendRuntimeMessageWithTimeout({ type: 'PB_GET_METADATA_BUNDLE' }, 50);
    eq('即応答sendMessage: ok=true', res?.ok, true);
    eq('即応答sendMessage: bundle.app.name', res?.bundle?.app?.name, 'demo');
  } finally {
    globalThis.chrome = realChrome;
  }

  // --- ケース3: sendMessage自体が例外を投げる(拡張コンテキスト無効化等) ->
  //     例外を握り消してok:falseで解決する(呼び出し元が未処理rejectで落ちない) ---
  globalThis.chrome = {
    runtime: {
      sendMessage: () => { throw new Error('Extension context invalidated.'); }
    }
  };
  try {
    const res = await sendRuntimeMessageWithTimeout({ type: 'PB_GET_METADATA_BUNDLE' }, 50);
    eq('sendMessage例外: ok=false', res?.ok, false);
  } finally {
    globalThis.chrome = realChrome;
  }
}
