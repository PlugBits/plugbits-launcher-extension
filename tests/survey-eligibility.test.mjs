// 3.3.0: 利用者アンケート A ── service_worker.js の onInstalled 拡張部分(compareVersions /
// initializeSurveyAEligibility)を関数単位で切り出して純粋に検証する(ブラウザ不要の単体テスト)。
// 抽出方式は tests/helpers/extract-src.mjs のブレース深度カウントを流用する。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractFunctionSource, extractConstLine } from './helpers/extract-src.mjs';

const srcDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');
const source = fs.readFileSync(path.join(srcDir, 'service_worker.js'), 'utf8');

const constDepsSrc = [
  extractConstLine(source, /const SURVEY_A_KEY = [^\n]+/),
  extractConstLine(source, /const SURVEY_A_TARGET_VERSION = [^\n]+/),
  extractConstLine(source, /const SURVEY_A_INSTALL_DELAY_MS = [^\n]+/)
].join('\n');
const compareVersionsSrc = extractFunctionSource(source, /\nfunction compareVersions\(a, b\)\s\{/);
const initSrc = extractFunctionSource(source, /\nasync function initializeSurveyAEligibility\(details\)\s\{/);

// eslint-disable-next-line no-eval
const factory = eval(`(function(chrome, console) {
  ${constDepsSrc}
  ${compareVersionsSrc}
  return (${initSrc.trim()});
})`);

function makeChromeStub(initial) {
  const store = initial ? { ...initial } : {};
  return {
    stub: {
      storage: {
        local: {
          get: (key) => Promise.resolve(
            Object.prototype.hasOwnProperty.call(store, key) ? { [key]: JSON.parse(JSON.stringify(store[key])) } : {}
          ),
          set: (obj) => { Object.assign(store, JSON.parse(JSON.stringify(obj))); return Promise.resolve(); }
        }
      }
    },
    store
  };
}

const silentConsole = { error: () => {} };

export async function run({ check }) {
  // 新規インストール: 3日後からの eligibleAt を書く
  {
    const { stub, store } = makeChromeStub();
    const initializeSurveyAEligibility = factory(stub, silentConsole);
    const before = Date.now();
    await initializeSurveyAEligibility({ reason: 'install' });
    const after = Date.now();
    const state = store.kfavSurveyA;
    check('survey-eligibility: 新規インストールでキーが作られる', Boolean(state));
    check('survey-eligibility: 新規インストールは bandDismissed=false / done=false',
      state && state.bandDismissed === false && state.done === false);
    const expectedMin = before + 3 * 24 * 60 * 60 * 1000;
    const expectedMax = after + 3 * 24 * 60 * 60 * 1000;
    check('survey-eligibility: 新規インストールの eligibleAt は now+3日',
      state && state.eligibleAt >= expectedMin && state.eligibleAt <= expectedMax);
  }

  // 3.3.0未満からの更新: 即時 eligible
  {
    const { stub, store } = makeChromeStub();
    const initializeSurveyAEligibility = factory(stub, silentConsole);
    const before = Date.now();
    await initializeSurveyAEligibility({ reason: 'update', previousVersion: '3.2.1' });
    const after = Date.now();
    const state = store.kfavSurveyA;
    check('survey-eligibility: 3.2.1→3.3.0 の更新でキーが作られる', Boolean(state));
    check('survey-eligibility: 3.2.1→3.3.0 の eligibleAt は即時(now)',
      state && state.eligibleAt >= before && state.eligibleAt <= after);
  }

  // 3.3.0以降の更新(3.3.0→3.3.1)は対象外
  {
    const { stub, store } = makeChromeStub();
    const initializeSurveyAEligibility = factory(stub, silentConsole);
    await initializeSurveyAEligibility({ reason: 'update', previousVersion: '3.3.0' });
    check('survey-eligibility: 3.3.0→3.3.1 の更新ではキーを作らない', !store.kfavSurveyA);
  }

  // 数値比較であること(文字列比較だと 3.10.0 < 3.3.0 と誤判定する)
  {
    const { stub, store } = makeChromeStub();
    const initializeSurveyAEligibility = factory(stub, silentConsole);
    await initializeSurveyAEligibility({ reason: 'update', previousVersion: '3.10.0' });
    check('survey-eligibility: compareVersions は数値比較(3.10.0は3.3.0未満ではない)', !store.kfavSurveyA);
  }

  // 既にキーがある場合は reason='update'(対象版)でも作り直さない
  {
    const existing = { eligibleAt: 12345, bandDismissed: true, done: true };
    const { stub, store } = makeChromeStub({ kfavSurveyA: existing });
    const initializeSurveyAEligibility = factory(stub, silentConsole);
    await initializeSurveyAEligibility({ reason: 'update', previousVersion: '3.0.0' });
    check('survey-eligibility: 既存キーがあれば update でも上書きしない',
      JSON.stringify(store.kfavSurveyA) === JSON.stringify(existing));
  }

  // 既にキーがある場合は reason='install' でも作り直さない
  {
    const existing = { eligibleAt: 99999, bandDismissed: false, done: true };
    const { stub, store } = makeChromeStub({ kfavSurveyA: existing });
    const initializeSurveyAEligibility = factory(stub, silentConsole);
    await initializeSurveyAEligibility({ reason: 'install' });
    check('survey-eligibility: 既存キーがあれば install でも上書きしない',
      JSON.stringify(store.kfavSurveyA) === JSON.stringify(existing));
  }

  // previousVersion が無い update(異常系)は対象外
  {
    const { stub, store } = makeChromeStub();
    const initializeSurveyAEligibility = factory(stub, silentConsole);
    await initializeSurveyAEligibility({ reason: 'update' });
    check('survey-eligibility: previousVersion無しのupdateはキーを作らない', !store.kfavSurveyA);
  }

  // reason='chrome_update' など対象外のreasonは何もしない
  {
    const { stub, store } = makeChromeStub();
    const initializeSurveyAEligibility = factory(stub, silentConsole);
    await initializeSurveyAEligibility({ reason: 'chrome_update' });
    check('survey-eligibility: reasonがinstall/update以外ならキーを作らない', !store.kfavSurveyA);
  }
}
