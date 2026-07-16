// 貼り付けルックアップ照合（verifyLookupValuesExist）とpage-bridgeのexactValues
// クエリ組み立て（buildLookupCandidatesQuery/escapeKintoneQueryLiteral）の単体テスト。
// content.js / page-bridge.js から該当関数を文字列として切り出し、ブレース深度
// カウントで本体を抽出してeval する(lookup-cache-unit.test.mjsと同じ方式)。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractFunctionSource, extractConstLine } from './helpers/extract-src.mjs';
import { checkEqual } from './helpers/assert.mjs';

const srcDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');
const contentSrc = fs.readFileSync(path.join(srcDir, 'content.js'), 'utf8');
const bridgeSrc = fs.readFileSync(path.join(srcDir, 'page-bridge.js'), 'utf8');

// ---- content.js: verifyLookupValuesExist + その依存(lookupCacheGet/getLookupDisplayValue/定数) ----
// 依存関数を全部同じevalスコープに詰め込み、lookupFullCacheはテストから直接
// seedできるよう返却オブジェクトに含める(実装1と同じ「ベースキャッシュ」の考え方を
// そのままテストで再現するため)
function buildVerifyLookupValuesExist() {
  const ttlConst = extractConstLine(contentSrc, /const LOOKUP_CACHE_TTL_MS = [^\n]+/);
  const baseLimitConst = extractConstLine(contentSrc, /const LOOKUP_BASE_FETCH_LIMIT = [^\n]+/);
  const lookupCacheGetSrc = extractFunctionSource(contentSrc, /\n {2}function lookupCacheGet\(map, key, now\)\s\{/).replace(/^\n/, '');
  const getDisplayValueSrc = extractFunctionSource(contentSrc, /\n {2}function getLookupDisplayValue\(record, fieldCode\)\s\{/).replace(/^\n/, '');
  const verifySrc = extractFunctionSource(
    contentSrc,
    /\n {2}async function verifyLookupValuesExist\(\{ relatedAppId, relatedKeyField, values, postFn \}\)\s\{/
  ).replace(/^\n/, '');
  const factoryBody = `
    ${ttlConst}
    const lookupFullCache = new Map();
    ${baseLimitConst}
    ${lookupCacheGetSrc}
    ${getDisplayValueSrc}
    ${verifySrc}
    return { verifyLookupValuesExist, lookupFullCache };
  `;
  // eslint-disable-next-line no-eval
  return eval(`(function () { ${factoryBody} })()`);
}

// ---- page-bridge.js: buildLookupCandidatesQuery + escapeKintoneQueryLiteral ----
function buildQueryHelpers() {
  const escapeSrc = extractFunctionSource(bridgeSrc, /\n {2}function escapeKintoneQueryLiteral\(value\)\s\{/).replace(/^\n/, '');
  const buildSrc = extractFunctionSource(
    bridgeSrc,
    /\n {2}function buildLookupCandidatesQuery\(\{ keyword, keyField, exactValues, conditionOp, sort, limit, offset \}\)\s\{/
  ).replace(/^\n/, '');
  const factoryBody = `
    ${escapeSrc}
    ${buildSrc}
    return { escapeKintoneQueryLiteral, buildLookupCandidatesQuery };
  `;
  // eslint-disable-next-line no-eval
  return eval(`(function () { ${factoryBody} })()`);
}

export async function run({ check }) {
  const eq = (name, actual, expected) => checkEqual(check, `paste-verify-unit: ${name}`, actual, expected);

  // ============================================================
  // verifyLookupValuesExist
  // ============================================================

  // ---- 完全キャッシュでのローカル照合(API 0回) ----
  {
    const { verifyLookupValuesExist, lookupFullCache } = buildVerifyLookupValuesExist();
    lookupFullCache.set('88:商品名', {
      records: [
        { 商品名: { value: '商品001' } },
        { 商品名: { value: '商品002' } }
      ],
      totalCount: 2,
      fetchedAt: Date.now()
    });
    let postCalls = 0;
    const postFn = async () => { postCalls += 1; return { ok: true, result: { records: [], totalCount: 0 } }; };
    const result = await verifyLookupValuesExist({
      relatedAppId: '88',
      relatedKeyField: '商品名',
      values: ['商品001', '商品999'],
      postFn
    });
    eq('完全キャッシュ命中時はAPIを叩かない', postCalls, 0);
    eq('キャッシュにある値はtrue', result.get('商品001'), true);
    eq('キャッシュに無い値はfalse', result.get('商品999'), false);
  }

  // ---- ベース未キャッシュ・500件以下 → 1回フェッチしてローカル照合(かつキャッシュに残る) ----
  {
    const { verifyLookupValuesExist, lookupFullCache } = buildVerifyLookupValuesExist();
    let postCalls = 0;
    const postFn = async (type, payload) => {
      postCalls += 1;
      eq('ベース取得はkeyword=""・limit=500', { keyword: payload.keyword, limit: payload.limit }, { keyword: '', limit: 500 });
      return {
        ok: true,
        result: {
          records: [{ 商品名: { value: 'A' } }, { 商品名: { value: 'B' } }],
          totalCount: 2
        }
      };
    };
    const result = await verifyLookupValuesExist({ relatedAppId: '1', relatedKeyField: '商品名', values: ['A', 'C'], postFn });
    eq('未キャッシュ・500件以下はベース取得1回のみ', postCalls, 1);
    eq('ローカル一致(A)', result.get('A'), true);
    eq('ローカル不一致(C)', result.get('C'), false);
    eq('ベース取得結果はlookupFullCacheに残る(次回以降のAPI節約に使い回せる)', lookupFullCache.has('1:商品名'), true);
  }

  // ---- 51値 → exactValuesで50件ずつ2チャンク(500件超のケース) ----
  {
    const { verifyLookupValuesExist } = buildVerifyLookupValuesExist();
    const chunkSizes = [];
    const postFn = async (type, payload) => {
      if (!payload.keyword && !payload.exactValues) {
        // ベース取得: totalCountを501にして「500件超=不完全」を強制する
        return { ok: true, result: { records: new Array(500).fill(0).map((_, i) => ({ 商品名: { value: `X${i}` } })), totalCount: 501 } };
      }
      chunkSizes.push(payload.exactValues.length);
      // 各チャンクの先頭の値だけ「存在する」ことにして返す
      const hit = payload.exactValues[0];
      return { ok: true, result: { records: [{ 商品名: { value: hit } }], totalCount: 1 } };
    };
    const values = Array.from({ length: 51 }, (_, i) => `V${i}`);
    const result = await verifyLookupValuesExist({ relatedAppId: '2', relatedKeyField: '商品名', values, postFn });
    eq('51値は50件ずつ2チャンクに分かれる', chunkSizes, [50, 1]);
    eq('各チャンクの先頭値はtrue', [result.get('V0'), result.get('V50')], [true, true]);
    eq('チャンクに返らなかった値はfalseのまま', result.get('V1'), false);
  }

  // ---- "を含む値のエスケープ(exactValuesとして渡る値そのものは素の文字列。
  //      クエリ文字列への埋め込みはpage-bridge側の責務なのでここではpostFnへ渡る
  //      exactValuesの中身が元の値のまま(勝手にエスケープしていない)ことを確認する ----
  {
    const { verifyLookupValuesExist } = buildVerifyLookupValuesExist();
    let sentExactValues = null;
    const postFn = async (type, payload) => {
      if (!payload.exactValues) {
        return { ok: true, result: { records: new Array(500).fill(0).map((_, i) => ({ 商品名: { value: `pad${i}` } })), totalCount: 501 } };
      }
      sentExactValues = payload.exactValues;
      return { ok: true, result: { records: [], totalCount: 0 } };
    };
    await verifyLookupValuesExist({ relatedAppId: '3', relatedKeyField: '商品名', values: ['A"B'], postFn });
    eq('"を含む値はエスケープせず生のままpostFnへ渡る(エスケープはpage-bridge側の責務)', sentExactValues, ['A"B']);
  }

  // ---- 失敗時はnull(呼び出し側は何もマークしない) ----
  {
    const { verifyLookupValuesExist } = buildVerifyLookupValuesExist();
    const postFn = async () => ({ ok: false, error: 'boom' });
    const result = await verifyLookupValuesExist({ relatedAppId: '4', relatedKeyField: '商品名', values: ['A'], postFn });
    eq('フェッチ失敗時はnull', result, null);
  }
  {
    const { verifyLookupValuesExist } = buildVerifyLookupValuesExist();
    const postFn = async () => { throw new Error('network down'); };
    const result = await verifyLookupValuesExist({ relatedAppId: '5', relatedKeyField: '商品名', values: ['A'], postFn });
    eq('postFnが例外を投げてもnull(誤警告を出さない)', result, null);
  }

  // ---- 空values配列は空Map(APIを叩かない) ----
  {
    const { verifyLookupValuesExist } = buildVerifyLookupValuesExist();
    let postCalls = 0;
    const postFn = async () => { postCalls += 1; return { ok: true, result: { records: [], totalCount: 0 } }; };
    const result = await verifyLookupValuesExist({ relatedAppId: '6', relatedKeyField: '商品名', values: ['', '   '], postFn });
    eq('空文字のみのvaluesはAPIを叩かず空Map', [postCalls, result.size], [0, 0]);
  }

  // ============================================================
  // page-bridge: buildLookupCandidatesQuery / escapeKintoneQueryLiteral
  // ============================================================
  {
    const { buildLookupCandidatesQuery, escapeKintoneQueryLiteral } = buildQueryHelpers();

    eq(
      'exactValues指定時はin句を組み立てる',
      buildLookupCandidatesQuery({ keyField: '商品名', exactValues: ['有効', '無効'], sort: '', limit: 500, offset: 0 }),
      '商品名 in ("有効","無効") limit 500'
    );

    eq(
      'exactValues + sort/offset付き',
      buildLookupCandidatesQuery({ keyField: 'k', exactValues: ['a'], sort: 'k asc', limit: 50, offset: 10 }),
      'k in ("a") order by k asc limit 50 offset 10'
    );

    eq(
      '"を含む値はin句内で\\"にエスケープされる',
      buildLookupCandidatesQuery({ keyField: '商品名', exactValues: ['A"B'], sort: '', limit: 500, offset: 0 }),
      '商品名 in ("A\\"B") limit 500'
    );

    eq(
      'バックスラッシュは"より先にエスケープされる(2重エスケープにならない)',
      escapeKintoneQueryLiteral('a\\"b'),
      'a\\\\\\"b'
    );

    eq(
      'exactValues未指定時は従来どおりkeyword+conditionOpのlike/=フィルタ',
      buildLookupCandidatesQuery({ keyword: '商品', keyField: '商品名', conditionOp: 'like', sort: '', limit: 500, offset: 0 }),
      '商品名 like "商品" limit 500'
    );

    eq(
      'keyword内の"もエスケープされる(like条件)',
      buildLookupCandidatesQuery({ keyword: 'A"B', keyField: 'k', conditionOp: 'like', sort: '', limit: 500, offset: 0 }),
      'k like "A\\"B" limit 500'
    );

    eq(
      'exactValuesが空配列ならkeyword経路にフォールバックする(呼び出し側契約の確認)',
      buildLookupCandidatesQuery({ keyword: '', keyField: 'k', exactValues: [], conditionOp: 'like', sort: '', limit: 500, offset: 0 }),
      'limit 500'
    );
  }
}
