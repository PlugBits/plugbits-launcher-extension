// parseClipboardMatrix(Excel/Google Sheetsのコピー範囲をTSVとして解析する関数)の単体テスト。
// 3.3.0: 引用符囲みセル(改行/タブ/""エスケープを含む)対応のためTSVパーサとして
// 書き直した分の回帰確認。content.jsから該当メソッドを文字列として切り出し、
// ブレース深度カウントで本体を抽出してevalする(newrow-defaults-unit.test.mjsと同じ方式)。
// thisに依存しない純粋メソッドとして書かれているためbindなしでそのまま呼び出せる。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractMethodAsFunction } from './helpers/extract-src.mjs';
import { checkEqual } from './helpers/assert.mjs';

const srcDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');
const src = fs.readFileSync(path.join(srcDir, 'content.js'), 'utf8');

export async function run({ check }) {
  const eq = (name, actual, expected) => checkEqual(check, `parse-clipboard-matrix-unit: ${name}`, actual, expected);

  const parseClipboardMatrix = extractMethodAsFunction(
    src,
    'parseClipboardMatrix\\(text\\)',
    'parseClipboardMatrix',
    'text'
  );

  // ---- 通常のタブ/改行区切りの格子(引用符なし) ----
  {
    const result = parseClipboardMatrix('a\tb\nc\td');
    eq('plain grid: matrix', result.matrix, [['a', 'b'], ['c', 'd']]);
    eq('plain grid: rowCount/colCount', [result.rowCount, result.colCount], [2, 2]);
  }

  // ---- 引用符で囲まれたセル内の改行はリテラルの改行として取り込む ----
  {
    const result = parseClipboardMatrix('x\t"line1\nline2"\ty');
    eq('quoted newline: 1行3列になる(セル内改行で行が増えない)', [result.rowCount, result.colCount], [1, 3]);
    eq('quoted newline: 中のセルに改行がそのまま入る', result.matrix[0], ['x', 'line1\nline2', 'y']);
  }

  // ---- 引用符で囲まれたセル内のタブはリテラルのタブとして取り込む ----
  {
    const result = parseClipboardMatrix('a\t"b\tc"\td');
    eq('quoted tab: 1行3列になる(セル内タブで列が増えない)', [result.rowCount, result.colCount], [1, 3]);
    eq('quoted tab: 中のセルにタブがそのまま入る', result.matrix[0], ['a', 'b\tc', 'd']);
  }

  // ---- ""は1個の"にアンエスケープされる ----
  {
    const result = parseClipboardMatrix('"he said ""hi"""\tb');
    eq('escaped quote: ""→"にアンエスケープ', result.matrix[0], ['he said "hi"', 'b']);
  }

  // ---- 末尾の改行は1つだけ落とす(従来どおりの挙動) ----
  {
    const result = parseClipboardMatrix('a\tb\n');
    eq('trailing newline: 末尾の空行を1つ落として1行2列のまま', result.matrix, [['a', 'b']]);
    eq('trailing newline: rowCount/colCount', [result.rowCount, result.colCount], [1, 2]);
  }
  {
    // 末尾に空行が複数あるときは1つだけ落とす(2つ目は本当の空行として残る)
    const result = parseClipboardMatrix('a\n\n');
    eq('trailing newline x2: 1つだけ落とす', result.matrix, [['a'], ['']]);
  }

  // ---- CRLF/CRはLFに正規化してから解析する ----
  {
    const result = parseClipboardMatrix('a\tb\r\nc\td');
    eq('CRLF: LF正規化後に通常どおり2行2列', result.matrix, [['a', 'b'], ['c', 'd']]);
  }
  {
    const result = parseClipboardMatrix('a\tb\rc\td');
    eq('CR単独もLF正規化される', result.matrix, [['a', 'b'], ['c', 'd']]);
  }

  // ---- 引用符で始まっていないフィールド中の"はリテラル文字として扱う ----
  {
    const result = parseClipboardMatrix('ab"cd\tef');
    eq('unquoted mid-field quote: "はリテラルのまま残る', result.matrix[0], ['ab"cd', 'ef']);
  }

  // ---- 空文字列/空行だけの入力 ----
  {
    const result = parseClipboardMatrix('');
    eq('空文字列はrowCount/colCountとも0', [result.rowCount, result.colCount, result.matrix], [0, 0, []]);
  }
}
