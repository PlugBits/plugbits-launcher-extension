// 次版: isSupportedAppContextPage() / hasAppContextUrlHint() の単体テスト。
//
// 背景: hasAppContextDomHint()(kintone内部のgaia系CSSクラスや
// [data-app-id]/[data-view-id]属性をdocument.querySelectorで読む予備判定)を撤去した。
// PlugBitsは「kintoneの内部DOMに依存しない」と約束しており、このDOM読み取りはその
// 約束と食い違っていたため。撤去にあたり、URL判定(hasAppContextUrlHint)だけでは
// 拾えなかった「ゲストスペース内アプリ」のURL形式(/k/guest/<spaceId>/<appId>/...)を
// 新たにURL判定へ追加して補っている(通常スペースの/k/<appId>/...と同じ構造。
// kintone REST APIのベースURLが /k/v1/... と /k/guest/<spaceId>/v1/... に分かれるのと同じ)。
//
// ここでは content.js から該当する関数群をまとめて文字列として切り出し、
// document/window/location/chromeをスタブした上でevalして、URLの型ごとに
// isSupportedAppContextPage()がtrue/falseになることを表形式で確認する。
// あわせて、hasAppContextDomHint という名前の関数がcontent.js上から消えている
// こと(撤去の回帰確認)、およびisSupportedAppContextPage()の実行中に
// document.querySelector が一度も呼ばれない(kintone内部DOMを読んでいない)ことも確認する。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const srcDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');
const src = fs.readFileSync(path.join(srcDir, 'content.js'), 'utf8');

function extractBlock(startMarker, endMarker) {
  const startIdx = src.indexOf(startMarker);
  if (startIdx === -1) throw new Error(`start marker not found: ${startMarker}`);
  const endIdx = src.indexOf(endMarker, startIdx);
  if (endIdx === -1) throw new Error(`end marker not found: ${endMarker}`);
  return src.slice(startIdx, endIdx);
}

// isKintoneLikeHost 〜 isSupportedAppContextPage までをまとめて取り出す
// (関数同士が互いを参照しあっているため、ひとかたまりのブロックとして展開する)
const block = extractBlock(
  '  function isKintoneLikeHost(hostname) {',
  '\n  // Keep host-level features alive on supported kintone hosts.'
);

function buildSandbox({ hostname = 'demo.cybozu.com', href, kintoneApp } = {}) {
  const querySelectorCalls = [];
  const documentStub = {
    body: {},
    documentElement: {},
    querySelector(sel) {
      querySelectorCalls.push(sel);
      return null;
    }
  };
  const locationStub = { href: href || `https://${hostname}/` };
  const windowStub = {
    kintone: kintoneApp ? { app: kintoneApp } : undefined
  };
  const consoleStub = { debug() {}, log() {}, warn() {}, error() {} };

  // eslint-disable-next-line no-new-func
  const factory = new Function(
    'window',
    'document',
    'location',
    'console',
    `${block}
    return {
      isSupportedHostPage,
      isSupportedAppContextPage,
      hasAppContextUrlHint,
      hasAppContextApiHint,
      getKintoneAppPageType,
      hasAppContextDomHint: typeof hasAppContextDomHint === 'undefined' ? undefined : hasAppContextDomHint
    };`
  );
  const api = factory(windowStub, documentStub, locationStub, consoleStub);
  return { api, querySelectorCalls };
}

export async function run({ check }) {
  // 回帰確認: hasAppContextDomHint は content.js から完全に消えている
  check('app-context-hint: hasAppContextDomHint is no longer defined',
    !/function\s+hasAppContextDomHint/.test(src));
  check('app-context-hint: gaia系CSSクラスの読み取りが残っていない',
    !/gaia-argoui-app-index-toolbar|recordlist-gaia|record-gaia/.test(src));
  check('app-context-hint: [data-app-id]/[data-view-id] の読み取りが残っていない(content.js全体)',
    !/\[data-app-id\], \[data-view-id\]/.test(src));

  const { api } = buildSandbox();
  check('app-context-hint: hasAppContextDomHint reference removed from the extracted block too',
    api.hasAppContextDomHint === undefined);

  // URLの型ごとの判定表(通常スペース / ゲストスペース)
  const APP_ID = '12';
  const SPACE_ID = '5';
  const RECORD_ID = '3';
  const rows = [
    // [説明, href, 期待値]
    ['通常: 一覧 /k/<appId>/', `https://demo.cybozu.com/k/${APP_ID}/`, true],
    ['通常: 詳細 /k/<appId>/show#record=', `https://demo.cybozu.com/k/${APP_ID}/show#record=${RECORD_ID}`, true],
    ['通常: 編集 /k/<appId>/edit?record=', `https://demo.cybozu.com/k/${APP_ID}/edit?record=${RECORD_ID}`, true],
    ['通常: 追加 /k/<appId>/create', `https://demo.cybozu.com/k/${APP_ID}/create`, true],
    ['通常: ビュー指定 /k/<appId>/?view=', `https://demo.cybozu.com/k/${APP_ID}/?view=20`, true],
    ['通常: モバイル風ハッシュ #/k/<appId>/', `https://demo.cybozu.com/k/#/k/${APP_ID}/`, true],
    ['ゲストスペース: 一覧 /k/guest/<spaceId>/<appId>/', `https://demo.cybozu.com/k/guest/${SPACE_ID}/${APP_ID}/`, true],
    ['ゲストスペース: 詳細 /k/guest/<spaceId>/<appId>/show#record=', `https://demo.cybozu.com/k/guest/${SPACE_ID}/${APP_ID}/show#record=${RECORD_ID}`, true],
    ['ゲストスペース: 編集 /k/guest/<spaceId>/<appId>/edit?record=', `https://demo.cybozu.com/k/guest/${SPACE_ID}/${APP_ID}/edit?record=${RECORD_ID}`, true],
    ['ゲストスペース: 追加 /k/guest/<spaceId>/<appId>/create', `https://demo.cybozu.com/k/guest/${SPACE_ID}/${APP_ID}/create`, true],
    ['ゲストスペース: モバイル風ハッシュ #/k/guest/<spaceId>/<appId>/', `https://demo.cybozu.com/k/#/k/guest/${SPACE_ID}/${APP_ID}/`, true],
    ['ポータル(アプリではない) /k/', 'https://demo.cybozu.com/k/', false],
    ['スペースのスレッド(アプリではない) #/space/.../thread/...', 'https://demo.cybozu.com/k/#/space/5/thread/9', false],
    ['Garoon /g/ 配下', 'https://demo.cybozu.com/g/', false]
  ];

  for (const [label, href, expected] of rows) {
    const { api: rowApi, querySelectorCalls } = buildSandbox({ href });
    const actual = rowApi.isSupportedAppContextPage();
    check(`app-context-hint: ${label} → ${expected}`, actual === expected);
    check(`app-context-hint: ${label} does not read kintone's internal DOM`,
      querySelectorCalls.length === 0);
  }

  // kintone.app APIが未初期化(=undefined)でも、ゲストスペースのURLなら
  // DOMを読まずにURL判定だけでtrueになること(hasAppContextDomHintが
  // 唯一救えていた「API未初期化×URL判定漏れ」のケースが、URL判定の拡張で
  // 解消していることの確認)
  {
    const { api: guestApi, querySelectorCalls } = buildSandbox({
      href: `https://demo.cybozu.com/k/guest/${SPACE_ID}/${APP_ID}/`,
      kintoneApp: undefined
    });
    check('app-context-hint: ゲストスペースURL・kintone.app未初期化でもtrue(URL判定のみで解決)',
      guestApi.isSupportedAppContextPage() === true);
    check('app-context-hint: ゲストスペースURL・kintone.app未初期化でもDOMは読まない',
      querySelectorCalls.length === 0);
  }

  // kintone.app.getId() が利用可能で値を返すケース(API経由のフォールバック)は引き続き効く
  {
    const { api: apiFallback, querySelectorCalls } = buildSandbox({
      href: `https://demo.cybozu.com/k/`, // URL単体では判定不可(ポータル相当)
      kintoneApp: { getId: () => APP_ID }
    });
    check('app-context-hint: URL判定が効かなくてもkintone.app.getId()があればtrue',
      apiFallback.isSupportedAppContextPage() === true);
    check('app-context-hint: kintone.app.getId()経由でもDOMは読まない',
      querySelectorCalls.length === 0);
  }

  // ホスト自体がkintoneでない場合はURL判定に関わらずfalse
  {
    const { api: offHost } = buildSandbox({ href: `https://example.com/k/${APP_ID}/` });
    check('app-context-hint: kintone以外のホストは常にfalse', offHost.isSupportedAppContextPage() === false);
  }
}
