// ルックアップ候補の3階層化(Tier0頻出/Tier1タブキャッシュ/Tier2 like検索)で追加した
// 純関数の単体テスト。content.js から該当関数/メソッドを文字列として切り出し、
// ブレース深度カウントで本体を抽出してeval する(overlay-lookup-unit.test.mjsと同じ方式)。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractTopLevelFunction, extractMethodAsFunction } from './helpers/extract-src.mjs';
import { checkEqual } from './helpers/assert.mjs';

const srcDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');
const src = fs.readFileSync(path.join(srcDir, 'content.js'), 'utf8');

export async function run({ check }) {
  const eq = (name, actual, expected) => checkEqual(check, `lookup-cache-unit: ${name}`, actual, expected);

  // ---- lookupCacheGet(map, key, now) / lookupCacheSet(map, key, entry, maxSize) ----
  const lookupCacheGet = extractTopLevelFunction(src, 'lookupCacheGet\\(map, key, now\\)', {
    constDeps: [/const LOOKUP_CACHE_TTL_MS = [^\n]+/]
  });
  const lookupCacheSet = extractTopLevelFunction(src, 'lookupCacheSet\\(map, key, entry, maxSize\\)');

  // ---- lookupFrequencyFromMap(valueMap) ----
  const lookupFrequencyFromMap = extractMethodAsFunction(
    src,
    'lookupFrequencyFromMap\\(valueMap\\)',
    'lookupFrequencyFromMap',
    'valueMap'
  );

  // ---- accumulateLookupFrequency(rows) ----
  // getLookupKeyFieldCodes は「集計対象のフィールドコード一覧を返す」という契約だけが
  // 重要で、その中身(fieldMap走査+getLookupKeyMeta)は overlay-lookup-unit.test.mjs で
  // 別途検証済みのため、ここではスタブでよい
  const accumulateLookupFrequencyFn = extractMethodAsFunction(
    src,
    'accumulateLookupFrequency\\(rows\\)',
    'accumulateLookupFrequency',
    'rows'
  );

  // ==== lookupCacheGet ====
  {
    const map = new Map([['k', { records: [1], totalCount: 1, fetchedAt: 1000 }]]);
    eq('hit: 有効期限内なら中身を返す', lookupCacheGet(map, 'k', 1000 + 60_000), { records: [1], totalCount: 1, fetchedAt: 1000 });
    eq('hit後もエントリは残る(削除しない)', map.has('k'), true);
  }
  {
    const map = new Map([['k', { records: [], totalCount: 0, fetchedAt: 1000 }]]);
    const TTL = 10 * 60 * 1000;
    eq('境界: ちょうどTTL経過は期限切れ扱い(>=)', lookupCacheGet(map, 'k', 1000 + TTL), null);
    eq('期限切れエントリはmapから削除される', map.has('k'), false);
  }
  {
    const map = new Map([['k', { records: [], totalCount: 0, fetchedAt: 1000 }]]);
    const TTL = 10 * 60 * 1000;
    eq('境界: TTL-1msはまだ有効', lookupCacheGet(map, 'k', 1000 + TTL - 1) !== null, true);
  }
  {
    const map = new Map();
    eq('missキーはnull', lookupCacheGet(map, 'nope', 999999), null);
  }

  // ==== lookupCacheSet ====
  {
    const map = new Map();
    lookupCacheSet(map, 'a', { v: 1 }, 3);
    lookupCacheSet(map, 'b', { v: 2 }, 3);
    eq('上限未満なら両方残る', Array.from(map.keys()), ['a', 'b']);
  }
  {
    const map = new Map();
    lookupCacheSet(map, 'a', { v: 1 }, 2);
    lookupCacheSet(map, 'b', { v: 2 }, 2);
    lookupCacheSet(map, 'c', { v: 3 }, 2);
    eq('上限超過で最古(a)が追い出される', Array.from(map.keys()), ['b', 'c']);
  }
  {
    const map = new Map();
    lookupCacheSet(map, 'a', { v: 1 }, 2);
    lookupCacheSet(map, 'b', { v: 2 }, 2);
    lookupCacheSet(map, 'a', { v: 99 }, 2); // 既存キーの上書き = 最新扱いになるはず
    lookupCacheSet(map, 'c', { v: 3 }, 2); // 上限超過 → 最古(この時点でb)が追い出される
    eq('上書きしたキー(a)は最新扱いで生き残る', Array.from(map.keys()), ['a', 'c']);
    eq('上書きは値も更新される', map.get('a'), { v: 99 });
  }

  // ==== lookupFrequencyFromMap ====
  {
    const valueMap = new Map([
      ['101', '商品A'],
      ['102', '商品B'],
      ['103', '商品A'],
      ['104', '商品C'],
      ['105', '商品B']
    ]);
    eq(
      'count降順→value昇順でソートされる',
      lookupFrequencyFromMap(valueMap),
      [{ value: '商品A', count: 2 }, { value: '商品B', count: 2 }, { value: '商品C', count: 1 }]
    );
  }
  eq('空Mapは空配列', lookupFrequencyFromMap(new Map()), []);
  {
    const valueMap = new Map([['1', 'X'], ['2', 'X'], ['3', 'X']]);
    eq('全件同一値なら1エントリにcount集約される', lookupFrequencyFromMap(valueMap), [{ value: 'X', count: 3 }]);
  }

  // ==== accumulateLookupFrequency ====
  function makeFakeController(codes) {
    return {
      appId: '12',
      _lookupFrequentAppId: '12',
      lookupFrequentStore: new Map(),
      getLookupKeyFieldCodes: () => codes,
      accumulateLookupFrequency: accumulateLookupFrequencyFn
    };
  }

  {
    const ctrl = makeFakeController(['商品']);
    ctrl.accumulateLookupFrequency([
      { id: '101', original: { 商品: '商品A' } },
      { id: '102', original: { 商品: '商品B' } },
      { id: '103', original: { 商品: '' } }, // 空値
      { id: '104', original: { 商品: '   ' } } // 空白のみも空値扱い
    ]);
    eq(
      '空値・空白のみの値は除外される',
      Array.from(ctrl.lookupFrequentStore.get('商品').entries()),
      [['101', '商品A'], ['102', '商品B']]
    );
  }
  {
    const ctrl = makeFakeController(['商品']);
    const rows = [
      { id: '101', original: { 商品: '商品A' } },
      { id: '102', original: { 商品: '商品B' } }
    ];
    ctrl.accumulateLookupFrequency(rows);
    ctrl.accumulateLookupFrequency(rows); // ページ再読込などで同じ行をもう一度渡す
    eq('recordId重複で二重カウントしない(Mapサイズが増えない)', ctrl.lookupFrequentStore.get('商品').size, 2);
    eq(
      '二重カウントされていないことを頻度計算でも確認',
      lookupFrequencyFromMap(ctrl.lookupFrequentStore.get('商品')),
      [{ value: '商品A', count: 1 }, { value: '商品B', count: 1 }]
    );
  }
  {
    const ctrl = makeFakeController(['商品', '顧客']);
    ctrl.accumulateLookupFrequency([
      { id: '1', original: { 商品: '商品A', 顧客: '顧客X' } }
    ]);
    eq('複数のルックアップキー項目をそれぞれ独立に集計する',
      [ctrl.lookupFrequentStore.get('商品').get('1'), ctrl.lookupFrequentStore.get('顧客').get('1')],
      ['商品A', '顧客X']
    );
  }
  {
    const ctrl = makeFakeController(['商品']);
    ctrl.accumulateLookupFrequency([{ id: '1', original: { 商品: '商品A' } }]);
    ctrl.appId = '99'; // アプリ切り替え
    ctrl.accumulateLookupFrequency([{ id: '1', original: { 商品: '別アプリの値' } }]);
    eq('appIdが変わったら集計がリセットされる(前アプリの値が残らない)',
      Array.from(ctrl.lookupFrequentStore.get('商品').entries()),
      [['1', '別アプリの値']]
    );
  }
  {
    const ctrl = makeFakeController(['商品']);
    ctrl.accumulateLookupFrequency([{ id: '', original: { 商品: '商品A' } }]);
    eq('idが空の行は集計に含めない', ctrl.lookupFrequentStore.get('商品').size, 0);
  }
  {
    const ctrl = makeFakeController([]);
    ctrl.accumulateLookupFrequency([{ id: '1', original: { 商品: '商品A' } }]);
    eq('ルックアップキー項目が無いアプリではストアに何も積まない', ctrl.lookupFrequentStore.size, 0);
  }
}
