// content.js / page-bridge.js から関数・メソッドの実装本体を文字列として切り出し、
// eval してテスト対象の純関数として取り出すための共通ユーティリティ(単体テスト系で使用)。
// ブレース深度カウントでシグネチャ直後の "{" に対応する "}" を探す方式。

export function extractBraceBlock(text, startBraceIdx) {
  let depth = 0;
  for (let i = startBraceIdx; i < text.length; i++) {
    const ch = text[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return text.slice(startBraceIdx, i + 1);
    }
  }
  throw new Error('unbalanced braces');
}

// signaturePattern は末尾が "\s\{" (シグネチャ直後の開き括弧) で終わる正規表現。
// 一部メソッドはシグネチャ自体に "{}" を含む(例: options = {})ため、
// 単純な indexOf('{', sigIdx) では引数側の "{" を誤って拾ってしまう。
// match() で一致した全文の長さから、本体の開き括弧の位置を直接求める。
export function extractFunctionSource(text, signaturePattern) {
  const match = signaturePattern.exec(text);
  if (!match) throw new Error(`signature not found: ${signaturePattern}`);
  const sigIdx = match.index;
  const braceIdx = sigIdx + match[0].length - 1;
  return text.slice(sigIdx, braceIdx) + extractBraceBlock(text, braceIdx);
}

export function extractConstLine(text, pattern) {
  const m = pattern.exec(text);
  if (!m) throw new Error(`const not found: ${pattern}`);
  return m[0];
}

// クラスメソッド(4スペースインデント)を独立関数として取り出す
export function extractMethodAsFunction(text, signature, name, params) {
  const bodySrc = extractFunctionSource(text, new RegExp(`\\n {4}${signature}\\s\\{`)).replace(
    new RegExp(`^\\n {4}${signature}`),
    ''
  );
  // eslint-disable-next-line no-eval
  return eval(`(function ${name}(${params}) ${bodySrc})`);
}

// モジュールスコープの関数宣言(2スペースインデント)を取り出す。constDepsで
// 参照する同スコープの定数宣言を一緒にevalしてクロージャに含める
export function extractTopLevelFunction(text, signature, { indent = 2, constDeps = [] } = {}) {
  const bodySrc = extractFunctionSource(text, new RegExp(`\\n {${indent}}function ${signature}\\s\\{`)).replace(
    new RegExp(`^\\n {${indent}}function `),
    ''
  );
  const constLines = constDeps.map((pattern) => extractConstLine(text, pattern));
  // eslint-disable-next-line no-eval
  return eval(`(function () { ${constLines.join('\n')}\n return function ${bodySrc}; })()`);
}
