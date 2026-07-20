// ビュークエリの条件/order by分割の単体テスト。
// バグ回帰: 絞り込み条件が空でクエリが order by から始まるビュー
// （プロセス管理アプリの組み込みビュー等）で、order by句を絞り込み条件として
// 扱ってしまい「作業者 in (LOGINUSER()) and (order by レコード番号 desc)」という
// 不正クエリ（CB_VA01: クエリ記法が間違っています）を組み立てていた。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractMethodAsFunction, extractFunctionSource } from './helpers/extract-src.mjs';

const srcDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');
const contentJs = fs.readFileSync(path.join(srcDir, 'content.js'), 'utf8');
const pageBridgeJs = fs.readFileSync(path.join(srcDir, 'page-bridge.js'), 'utf8');

export async function run({ check }) {
  // ── controller側: splitOverlayQueryParts / combineOverlayQuery / resolveViewInfoFromMetadata ──
  const splitOverlayQueryParts = extractMethodAsFunction(contentJs, 'splitOverlayQueryParts\\(query\\)', 'splitOverlayQueryParts', 'query');
  const combineOverlayQuery = extractMethodAsFunction(contentJs, 'combineOverlayQuery\\(base, extra\\)', 'combineOverlayQuery', 'base, extra');

  const eq = (name, actual, expected) => {
    const ok = JSON.stringify(actual) === JSON.stringify(expected);
    check(`query-split: ${name}${ok ? '' : ` (got ${JSON.stringify(actual)})`}`, ok);
  };

  // 核心: 先頭が order by のクエリ（絞り込み条件なし）
  eq('leading order by -> empty filter',
    splitOverlayQueryParts('order by レコード番号 desc'),
    { filter: '', trailing: 'order by レコード番号 desc' });

  // 通常形（条件 + order by）
  eq('condition + order by',
    splitOverlayQueryParts('作業者 in (LOGINUSER()) order by レコード番号 desc'),
    { filter: '作業者 in (LOGINUSER())', trailing: 'order by レコード番号 desc' });

  // 先頭が limit / offset
  eq('leading limit',
    splitOverlayQueryParts('limit 100 offset 0'),
    { filter: '', trailing: 'limit 100 offset 0' });

  // 条件のみ / 空
  eq('condition only',
    splitOverlayQueryParts('ステータス = "完了"'),
    { filter: 'ステータス = "完了"', trailing: '' });
  eq('empty', splitOverlayQueryParts(''), { filter: '', trailing: '' });

  // フィールド名に order を含んでも誤爆しない（"order" 単体は境界にならない）
  eq('field name containing order-like word survives',
    splitOverlayQueryParts('order_no = "1" order by order_no asc'),
    { filter: 'order_no = "1"', trailing: 'order by order_no asc' });

  // ── バグ再現シナリオ: resolveViewInfoFromMetadata をスタブthisで実行 ──
  // ビュー: filterCond='作業者 in (LOGINUSER())'、ページ側クエリ='order by レコード番号 desc'
  const resolveViewInfoFromMetadata = extractMethodAsFunction(
    contentJs, 'resolveViewInfoFromMetadata\\(viewsObj, options = \\{\\}\\)', 'resolveViewInfoFromMetadata', 'viewsObj, options = {}');
  const hasOverlayOrderClause = extractMethodAsFunction(contentJs, 'hasOverlayOrderClause\\(query\\)', 'hasOverlayOrderClause', 'query');
  const pickViewFromViews = extractMethodAsFunction(contentJs, "pickViewFromViews\\(viewsObj, preferredViewId = ''\\)", 'pickViewFromViews', "viewsObj, preferredViewId = ''");
  const isAllRecordsViewName = extractMethodAsFunction(contentJs, 'isAllRecordsViewName\\(value\\)', 'isAllRecordsViewName', 'value');
  const isAllRecordsViewId = extractMethodAsFunction(contentJs, 'isAllRecordsViewId\\(value\\)', 'isAllRecordsViewId', 'value');
  const extractViewFieldOrder = extractMethodAsFunction(contentJs, 'extractViewFieldOrder\\(view\\)', 'extractViewFieldOrder', 'view');
  const stub = {
    splitOverlayQueryParts,
    combineOverlayQuery,
    hasOverlayOrderClause,
    isAllRecordsViewName,
    isAllRecordsViewId,
    extractViewFieldOrder,
    getCurrentViewName: () => '未処理',
    createAllRecordsViewInfo: () => { throw new Error('unexpected all-records path'); }
  };
  stub.pickViewFromViews = pickViewFromViews.bind(stub);
  const info = resolveViewInfoFromMetadata.call(stub, {
    未処理: { id: '20', filterCond: '作業者 in (LOGINUSER())', sort: 'レコード番号 desc', columns: [] }
  }, { currentQuery: 'order by レコード番号 desc', viewId: '20' });
  check('query-split: process-view repro does NOT wrap order by in and(...)',
    !String(info?.query || '').includes('and (order by'));
  check(`query-split: process-view repro composes valid query (got: ${info?.query})`,
    info?.query === '作業者 in (LOGINUSER()) order by レコード番号 desc');

  // ── ビュー特定フォールバックの回帰（実アプリで確認したデータをそのまま使用） ──
  // アプリトップ(/k/94/): URLに?view=なし・getViewName()はundefined・
  // ページクエリは表示中ビュー(Records, index=0, 条件なし)を正確に反映。
  // ビュー一覧APIのキー順先頭は「（作業者が自分）」(index=1, 作業者 in (LOGINUSER()))。
  // 旧実装はキー順先頭に誤フォールバックし、作業者絞り込みが混入していた。
  const REAL_VIEWS = {
    '（作業者が自分）': { id: '6386068', index: '1', filterCond: '作業者 in (LOGINUSER())', sort: 'レコード番号 desc', columns: [] },
    Records: { id: '6385273', index: '0', filterCond: '', sort: 'レコード番号 desc', columns: [] }
  };
  const appTopStub = {
    splitOverlayQueryParts,
    combineOverlayQuery,
    hasOverlayOrderClause,
    isAllRecordsViewName,
    isAllRecordsViewId,
    extractViewFieldOrder,
    getCurrentViewName: () => '',
    createAllRecordsViewInfo: (q) => ({ query: String(q || '').trim(), fieldOrder: [], viewId: '', viewName: 'all_records' })
  };
  appTopStub.pickViewFromViews = pickViewFromViews.bind(appTopStub);

  // ケースA: 表示中ビュー(index最小=Records)とページクエリが整合 → Recordsを採用
  const appTop = resolveViewInfoFromMetadata.call(appTopStub, REAL_VIEWS,
    { currentQuery: 'order by レコード番号 desc limit 60 offset 0', viewId: '' });
  check(`view-fallback: app top does NOT inherit assignee filter (got: ${appTop?.query})`,
    !String(appTop?.query || '').includes('LOGINUSER'));
  check('view-fallback: app top picks the min-index view (Records)',
    appTop?.viewId === '6385273');

  // ケースB: ページクエリの条件部が index最小ビューのfilterCondと不一致
  // （kintoneが別ビューを表示している等）→ 推測を捨ててページクエリをそのまま使う
  const mismatch = resolveViewInfoFromMetadata.call(appTopStub, REAL_VIEWS,
    { currentQuery: '作業者 in (LOGINUSER()) order by レコード番号 desc', viewId: '' });
  check(`view-fallback: mismatch falls back to page query as-is (got: ${mismatch?.query})`,
    mismatch?.query === '作業者 in (LOGINUSER()) order by レコード番号 desc' && mismatch?.viewName === 'all_records');

  // ケースC: ?view=ID で（作業者が自分）を明示表示 → 従来どおりID特定で絞り込み維持
  const byId = resolveViewInfoFromMetadata.call(appTopStub, REAL_VIEWS,
    { currentQuery: '作業者 in (LOGINUSER()) order by レコード番号 desc limit 60 offset 0', viewId: '6386068' });
  check(`view-fallback: explicit ?view=ID keeps assignee filter without duplication (got: ${byId?.query})`,
    byId?.query === '作業者 in (LOGINUSER()) order by レコード番号 desc limit 60 offset 0');

  // combineOverlayQuery: 同一条件は二重に and しない
  eq('combine: identical conditions are not duplicated',
    combineOverlayQuery('作業者 in (LOGINUSER())', '作業者 in (LOGINUSER())'),
    '作業者 in (LOGINUSER())');
  eq('combine: different conditions are ANDed',
    combineOverlayQuery('A = "1"', 'B = "2"'),
    'A = "1" and (B = "2")');

  // ── page-bridge側: splitQueryParts（同じ修正の同一挙動） ──
  const bridgeSplitSrc = extractFunctionSource(pageBridgeJs, /\n {2}function splitQueryParts\(query\)\s\{/);
  // eslint-disable-next-line no-eval
  const splitQueryParts = eval(`(${bridgeSplitSrc.replace(/^\n {2}function splitQueryParts/, 'function splitQueryParts')})`);
  eq('bridge: leading order by -> empty filter',
    splitQueryParts('order by レコード番号 desc'),
    { filter: '', trailing: 'order by レコード番号 desc' });
  eq('bridge: condition + order by',
    splitQueryParts('ステータス = "処理中" order by 更新日時 desc limit 40'),
    { filter: 'ステータス = "処理中"', trailing: 'order by 更新日時 desc limit 40' });
}
