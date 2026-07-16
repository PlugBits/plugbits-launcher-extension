// 案A（グリッドのルックアップキー編集）+ 案D（ルックアップ一括再取得）で追加された
// 純粋メソッドの単体テスト。content.js から該当メソッドを文字列として切り出し、
// ブレース深度カウントで本体を抽出してeval する。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractMethodAsFunction } from './helpers/extract-src.mjs';
import { checkEqual } from './helpers/assert.mjs';

const srcDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');
const src = fs.readFileSync(path.join(srcDir, 'content.js'), 'utf8');

export async function run({ check }) {
  const eq = (name, actual, expected) => checkEqual(check, `overlay-lookup-unit: ${name}`, actual, expected);

  // ---- getLookupKeyMeta(field) ----
  const getLookupKeyMeta = extractMethodAsFunction(src, 'getLookupKeyMeta\\(field\\)', 'getLookupKeyMeta', 'field');

  // ---- getFieldPermissionInfo(recordId, field, options = \\{\\}) ----
  const getFieldPermissionInfoFn = extractMethodAsFunction(
    src,
    'getFieldPermissionInfo\\(recordId, field, options = \\{\\}\\)',
    'getFieldPermissionInfo',
    'recordId, field, options = {}'
  );

  // ---- buildLookupRefreshTargets(records, keyCodes) ----
  const buildLookupRefreshTargets = extractMethodAsFunction(
    src,
    'buildLookupRefreshTargets\\(records, keyCodes\\)',
    'buildLookupRefreshTargets',
    'records, keyCodes'
  );

  // ---- parseFailedRecordIndices(errorDetails) ----
  const parseFailedRecordIndices = extractMethodAsFunction(
    src,
    'parseFailedRecordIndices\\(errorDetails\\)',
    'parseFailedRecordIndices',
    'errorDetails'
  );

  // getFieldPermissionInfo は this.permissionService / this.getCellPermissionInfo /
  // this.getLookupKeyMeta を参照する。抽出した実装同士は独立に評価しているため、
  // getLookupKeyMeta は「本物の抽出実装」をスタブとして渡す(フェイク実装にしない)
  const getFieldPermissionInfo = getFieldPermissionInfoFn.bind({
    permissionService: {
      isSystemField: () => false,
      isFieldTypeEditable: () => true
    },
    getCellPermissionInfo: () => ({ editable: true, reason: null }),
    getLookupKeyMeta
  });

  // ==== getFieldPermissionInfo ====
  eq(
    'lookupAuto field -> readonly(lookup_readonly)',
    getFieldPermissionInfo('1', { code: '担当者', type: 'SINGLE_LINE_TEXT', lookupAuto: true }),
    { editable: false, reason: 'lookup_readonly' }
  );
  eq(
    'lookupAuto with lingering lookup:{keyField} -> still readonly (lookupAuto判定を先に行う)',
    getFieldPermissionInfo('1', {
      code: '担当者',
      type: 'SINGLE_LINE_TEXT',
      lookupAuto: true,
      lookup: { keyField: '商品' }
    }),
    { editable: false, reason: 'lookup_readonly' }
  );
  eq(
    'key field (relatedApp + relatedKeyField あり) -> フォールスルーでeditable',
    getFieldPermissionInfo('1', {
      code: '商品',
      type: 'SINGLE_LINE_TEXT',
      lookup: { relatedApp: { app: '88' }, relatedKeyField: '商品名' }
    }),
    { editable: true, reason: null }
  );
  eq(
    'key field NUMBER type も同様に拾う',
    getFieldPermissionInfo('1', {
      code: '数量キー',
      type: 'NUMBER',
      lookup: { relatedApp: '88', relatedKeyField: '商品コード' }
    }),
    { editable: true, reason: null }
  );
  eq(
    'lookup:{keyField}のみ(relatedApp/relatedKeyFieldなし) -> readonly',
    getFieldPermissionInfo('1', {
      code: '担当者',
      type: 'SINGLE_LINE_TEXT',
      lookup: { keyField: '商品' }
    }),
    { editable: false, reason: 'lookup_readonly' }
  );
  eq(
    "type 'LOOKUP' でメタなし -> readonly",
    getFieldPermissionInfo('1', { code: '謎フィールド', type: 'LOOKUP' }),
    { editable: false, reason: 'lookup_readonly' }
  );
  eq(
    'ルックアップと無関係な通常フィールドは通常どおりフォールスルー',
    getFieldPermissionInfo('1', { code: '案件名', type: 'SINGLE_LINE_TEXT' }),
    { editable: true, reason: null }
  );

  // ==== buildLookupRefreshTargets ====
  eq(
    '空キーのフィールドは除外し、値ありのキーだけ record に詰める',
    buildLookupRefreshTargets(
      [{ id: '1', values: { 商品: '商品A', 顧客: '' } }],
      ['商品', '顧客']
    ),
    [{ id: '1', record: { 商品: { value: '商品A' } } }]
  );
  eq(
    '全キー空のレコードは除外される',
    buildLookupRefreshTargets(
      [{ id: '1', values: { 商品: '', 顧客: '  ' } }, { id: '2', values: { 商品: '商品B' } }],
      ['商品', '顧客']
    ),
    [{ id: '2', record: { 商品: { value: '商品B' } } }]
  );
  eq(
    '複数キー同時に値ありなら両方詰める',
    buildLookupRefreshTargets(
      [{ id: '3', values: { 商品: '商品C', 顧客: '顧客X' } }],
      ['商品', '顧客']
    ),
    [{ id: '3', record: { 商品: { value: '商品C' }, 顧客: { value: '顧客X' } } }]
  );
  eq(
    'keyCodesが空なら常に空配列',
    buildLookupRefreshTargets([{ id: '1', values: { 商品: '商品A' } }], []),
    []
  );
  eq(
    'idが空のレコードは除外',
    buildLookupRefreshTargets([{ id: '', values: { 商品: '商品A' } }], ['商品']),
    []
  );

  // ==== parseFailedRecordIndices ====
  eq(
    "'records[3].商品.value' 形式のキーから [3] を返す",
    parseFailedRecordIndices({ 'records[3].商品.value': { messages: ['重複しています。'] } }),
    [3]
  );
  eq(
    '複数・重複・無関係キー混在 -> 一意にソートされたindex配列',
    parseFailedRecordIndices({
      'records[5].商品.value': { messages: ['x'] },
      'records[2].商品.value': { messages: ['y'] },
      'records[5].顧客.value': { messages: ['z'] },
      'properties.案件名': { messages: ['not a record index'] }
    }),
    [2, 5]
  );
  eq('errorDetailsがnull/オブジェクトでない場合は空配列', parseFailedRecordIndices(null), []);
  eq('一致するキーが1つもなければ空配列', parseFailedRecordIndices({ 'foo.bar': { messages: ['x'] } }), []);
}
