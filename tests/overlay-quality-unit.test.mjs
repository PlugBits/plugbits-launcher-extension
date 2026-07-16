// validate() の NUMBER 正規化と collectSaveErrorTargets() の単体テスト。
// content.js から該当関数を文字列として切り出し、ブレース深度カウントで
// 本体を抽出してeval する。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractBraceBlock } from './helpers/extract-src.mjs';
import { checkEqual } from './helpers/assert.mjs';

const srcDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');
const src = fs.readFileSync(path.join(srcDir, 'content.js'), 'utf8');

// このスイートのみ、シグネチャ直後が必ずしも "{" ではない箇所を想定して
// indexOf ベースで開き括弧位置を探す(overlay-lookup-unit.test.mjs等の
// extractFunctionSource とは微妙に異なる抽出方式。元ハーネスのまま維持)
function extractFunctionSource(signaturePattern) {
  const sigIdx = src.search(signaturePattern);
  if (sigIdx === -1) throw new Error(`signature not found: ${signaturePattern}`);
  const braceIdx = src.indexOf('{', sigIdx);
  if (braceIdx === -1) throw new Error(`opening brace not found for: ${signaturePattern}`);
  return src.slice(sigIdx, braceIdx) + extractBraceBlock(src, braceIdx);
}

export async function run({ check }) {
  const eq = (name, actual, expected) => checkEqual(check, `overlay-quality-unit: ${name}`, actual, expected);

  // ---- qnrNormalizeNumberText ----
  const qnrSrc = extractFunctionSource(/function qnrNormalizeNumberText\(raw\)\s*\{/);

  // ---- validate(value, field) { ... } (クラスメソッド本体を関数式として包む) ----
  const validateBodySrc = extractFunctionSource(/\n {4}validate\(value, field\) \{/).replace(
    /^\n {4}validate\(value, field\)/,
    ''
  );
  const validateFnSrc = `(function validate(value, field) ${validateBodySrc})`;

  // ---- collectSaveErrorTargets(batch, errorDetails) { ... } ----
  const collectBodySrc = extractFunctionSource(/\n {4}collectSaveErrorTargets\(batch, errorDetails\) \{/).replace(
    /^\n {4}collectSaveErrorTargets\(batch, errorDetails\)/,
    ''
  );
  const collectFnSrc = `(function collectSaveErrorTargets(batch, errorDetails) ${collectBodySrc})`;

  // validate() が参照する外部シンボルのスタブ(direct evalのクロージャに含める)
  // eslint-disable-next-line no-unused-vars
  const smartDateToYMD = () => null;
  // eslint-disable-next-line no-unused-vars
  const smartDateTimeToUtc = () => null;

  // qnrNormalizeNumberText を評価してスコープに用意(このスイートでは直接は
  // 使わないが、元ハーネスに倣い抽出可能であることを確認する)
  // eslint-disable-next-line no-eval, no-unused-vars
  const qnrNormalizeNumberText = eval(`(${qnrSrc.replace(/^function/, 'function')})`);

  // eslint-disable-next-line no-eval
  const validateFn = eval(validateFnSrc);
  const validate = validateFn.bind({ kintoneTimezone: 'Asia/Tokyo' });

  // eslint-disable-next-line no-eval
  const collectSaveErrorTargets = eval(collectFnSrc);

  // ---- Task 2: validate() NUMBER 正規化 ----
  eq(
    "validate('１，０００', {type:'NUMBER'})",
    validate('１，０００', { type: 'NUMBER' }),
    { ok: true, value: '1000' }
  );
  eq(
    "validate('1,234.5', {type:'NUMBER'})",
    validate('1,234.5', { type: 'NUMBER' }),
    { ok: true, value: '1234.5' }
  );
  eq(
    "validate('abc', {type:'NUMBER'}).ok",
    validate('abc', { type: 'NUMBER' }).ok,
    false
  );
  eq(
    "validate('', {type:'NUMBER'})",
    validate('', { type: 'NUMBER' }),
    { ok: true, value: '' }
  );

  // ---- Task 3: collectSaveErrorTargets() ----
  eq(
    'collectSaveErrorTargets: PUT batch (entry.id)',
    collectSaveErrorTargets(
      [{ id: '10' }, { id: '11' }],
      { 'records[1].数量.value': { messages: ['最大値は100です。'] } }
    ),
    [{ recordId: '11', fieldCode: '数量', message: '最大値は100です。' }]
  );
  eq(
    'collectSaveErrorTargets: POST batch (entry.tempId)',
    collectSaveErrorTargets(
      [{ tempId: 'NEW:1' }],
      { 'records[0].案件名.value': { messages: ['必須です。'] } }
    ),
    [{ recordId: 'NEW:1', fieldCode: '案件名', message: '必須です。' }]
  );
  eq(
    'collectSaveErrorTargets: unparsable key -> []',
    collectSaveErrorTargets(
      [{ id: '10' }],
      { 'foo.bar': { messages: ['x'] } }
    ),
    []
  );
}
