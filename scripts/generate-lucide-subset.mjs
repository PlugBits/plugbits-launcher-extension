// vendor/lucide.umd.js（全1,800+アイコン・数百KB）から、実際に使用している
// アイコンだけを抽出した vendor/lucide-subset.js を生成する。
// アイコンを追加したら USED_ICONS に足してこのスクリプトを再実行すること。
//
//   node scripts/generate-lucide-subset.mjs

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const rootDir = process.cwd();
const vendorDir = path.join(rootDir, 'src', 'vendor');

// kebab-case で列挙（UI固定アイコン + ICON_OPTIONS のユーザー選択アイコン）
const USED_ICONS = [
  // UI chrome
  'table-2', 'filter', 'settings', 'x', 'chevron-down', 'chevron-right',
  'plus', 'refresh-cw', 'pin', 'star', 'star-off', 'pencil', 'trash-2',
  'grip-vertical', 'keyboard', 'triangle-alert', 'search', 'history', 'bookmark',
  // ICON_OPTIONS（ウォッチリスト/ショートカットのユーザー選択）
  'clipboard', 'file-text', 'package', 'box', 'truck', 'factory', 'wrench',
  'calendar', 'list-checks', 'chart-bar', 'receipt', 'users'
];

function toPascal(kebab) {
  return kebab.split('-').map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join('');
}

// フルUMDをNodeで評価してアイコンノード（[tag, attrs, children][]）を採取する
const umdSource = fs.readFileSync(path.join(vendorDir, 'lucide.umd.js'), 'utf8');
const context = { window: {}, document: undefined, navigator: undefined };
vm.createContext(context);
vm.runInContext(umdSource, context);
const fullLucide = context.window.lucide || context.lucide;
if (!fullLucide?.icons) {
  console.error('[lucide-subset] failed to evaluate lucide.umd.js');
  process.exit(1);
}

function nodeToSvgString([tag, attrs, children]) {
  const attrStr = Object.entries(attrs || {})
    .map(([k, v]) => ` ${k}="${String(v)}"`)
    .join('');
  const kids = Array.isArray(children) ? children.map(nodeToSvgString).join('') : '';
  return kids ? `<${tag}${attrStr}>${kids}</${tag}>` : `<${tag}${attrStr}/>`;
}

const entries = [];
const missing = [];
for (const kebab of USED_ICONS) {
  const pascal = toPascal(kebab);
  const iconNode = fullLucide.icons[pascal] || fullLucide.icons[kebab];
  if (!Array.isArray(iconNode)) {
    missing.push(kebab);
    continue;
  }
  const inner = iconNode.map(nodeToSvgString).join('');
  entries.push({ kebab, pascal, inner, klass: `lucide lucide-${kebab}` });
}
if (missing.length) {
  console.error('[lucide-subset] icons not found in UMD:', missing.join(', '));
  process.exit(1);
}

const data = entries
  .map((e) => `  [${JSON.stringify(e.kebab)}, ${JSON.stringify(e.pascal)}, ${JSON.stringify(e.klass)}, ${JSON.stringify(e.inner)}]`)
  .join(',\n');

const output = `// ★★★ 自動生成ファイル。直接編集しないでください ★★★
// 生成元: scripts/generate-lucide-subset.mjs（ソース: vendor/lucide.umd.js）
// アイコンを追加する場合は生成スクリプトの USED_ICONS に追記して再実行すること。
(function (global) {
  'use strict';
  const DATA = [
${data}
  ];
  const icons = {};
  DATA.forEach(([kebab, pascal, klass, inner]) => {
    const icon = {
      toSvg(attrs = {}) {
        const width = attrs.width ?? 24;
        const height = attrs.height ?? 24;
        return '<svg xmlns="http://www.w3.org/2000/svg" width="' + width + '" height="' + height + '"'
          + ' viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"'
          + ' stroke-linecap="round" stroke-linejoin="round" class="' + klass + '">' + inner + '</svg>';
      }
    };
    icons[kebab] = icon;
    icons[pascal] = icon;
  });
  global.lucide = { icons };
})(typeof window !== 'undefined' ? window : globalThis);
`;

const outPath = path.join(vendorDir, 'lucide-subset.js');
fs.writeFileSync(outPath, output, 'utf8');
const kb = (s) => `${(Buffer.byteLength(s) / 1024).toFixed(1)}KB`;
console.log(`[lucide-subset] wrote ${outPath}`);
console.log(`[lucide-subset] ${entries.length} icons, ${kb(output)} (full UMD: ${kb(umdSource)})`);
