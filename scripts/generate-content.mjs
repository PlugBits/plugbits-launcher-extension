// generate-content.mjs
// src/content.js は content.template.js + src/content-*.js から生成される
// 完全なファイルです。生成後の content.js は npm run build 時にビルドを
// 経由せず src から直接読み込む(chrome://extensions の「パッケージ化されて
// いない拡張機能を読み込む」を src ディレクトリに向ける)開発フローでも
// そのまま動作します。
//
// ExcelOverlayController / CommandPalette / QuickNewRecordModal を編集する
// 場合は対応する src/content-*.js を編集し、このスクリプトを実行して
// src/content.js を再生成してください。

import fs from 'fs';
import path from 'path';

const rootDir = process.cwd();
const srcDir = path.join(rootDir, 'src');

const TEMPLATE_FILE = 'content.template.js';
const OUTPUT_FILE = 'content.js';
const INCLUDE_FILES = [
  'content-overlay-controller.js',
  'content-command-palette.js',
  'content-quick-new-record-modal.js'
];

const GENERATED_HEADER = `// ★★★ このファイルは自動生成されています。直接編集しないでください ★★★
// 生成元: src/content.template.js + ${INCLUDE_FILES.join(', ')}
// 編集する場合はテンプレート/各パートファイルを編集し、
// \`npm run generate-content\` を実行してこのファイルを再生成してください。
`;

function bodyOf(includePath) {
  const bodyMarker = '// @@BODY_START\n';
  const source = fs.readFileSync(includePath, 'utf8');
  const idx = source.indexOf(bodyMarker);
  if (idx === -1) {
    throw new Error(`${includePath} is missing the "${bodyMarker.trim()}" marker`);
  }
  return source.slice(idx + bodyMarker.length).replace(/\n$/, '');
}

export function generateContent() {
  const templatePath = path.join(srcDir, TEMPLATE_FILE);
  let content = fs.readFileSync(templatePath, 'utf8');
  const hasBom = content.charCodeAt(0) === 0xFEFF;
  if (hasBom) content = content.slice(1);

  for (const include of INCLUDE_FILES) {
    const includePath = path.join(srcDir, include);
    const escaped = include.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const markerLine = new RegExp(`^[ \\t]*// @@INCLUDE: ${escaped}[ \\t]*$`, 'm');
    if (!markerLine.test(content)) {
      throw new Error(`${TEMPLATE_FILE} is missing the "// @@INCLUDE: ${include}" include marker`);
    }
    content = content.replace(markerLine, bodyOf(includePath));
  }

  const outputPath = path.join(srcDir, OUTPUT_FILE);
  const bom = hasBom ? '﻿' : '';
  fs.writeFileSync(outputPath, bom + GENERATED_HEADER + content, 'utf8');
  console.log('[generate-content] wrote', outputPath, `(${content.split('\n').length} lines + header)`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  generateContent();
}
