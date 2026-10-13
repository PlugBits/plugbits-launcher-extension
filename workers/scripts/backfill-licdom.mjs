#!/usr/bin/env node
// licdom_{product}_{domain} インデックス(2026-10-13導入)の手動バックフィル用スクリプト。
//
// このスクリプトは KV に何も書き込まない(読むのも書くのもしない)。入力のJSONダンプを
// 読んで、「書くべき licdom_ インデックスの一覧」を wrangler kv bulk put 用のJSONとして
// 出力するだけ。実際の反映は人間が確認してから別途 wrangler で行う。
//
// 使い方(すべて手作業・オケオの承認後に実行する):
//   1. 本番のライセンスレコードをダンプする(キー名だけ list → 1件ずつ get して組む。
//      例:
//        wrangler kv key list --binding=LICENSES --prefix=lic_ > keys.json
//        node -e '...' で keys.json の各 name を get して {name, value} の配列を作る
//      → dump.json は [{ "name": "lic_<uuid>", "value": "<JSON文字列のレコード>" }, ...] の形。
//      value は env.LICENSES.get() が返す生のJSON文字列(レコードそのもの)をそのまま入れる。
//   2. このスクリプトを実行する:
//        node workers/scripts/backfill-licdom.mjs dump.json out.json
//   3. out.json の内容を人間が確認する(件数・ドメイン・productが想定通りか)。
//   4. 問題なければ bulk put で反映する:
//        wrangler kv bulk put out.json --binding=LICENSES
//
// 対象: kind:'kintone' の製品(PRODUCTS マップと同じ内容。index.js側が増えたらここも足す)、
// レコードが kind !== 'trial'(トライアルは対象外)・status === 'active'・domain が非空のもの。
// 同じ product+domain に複数の有効なキーがある場合は purchased_at が最新のものを優先する
// (古い方は licdom_ に上書きされず、インデックスとしては最新のキーだけが残る想定に合わせる)。

import { readFileSync, writeFileSync } from 'node:fs';

// index.js の PRODUCTS マップのうち kind:'kintone' のものだけ(2026-10-13時点)。
// index.js を直接importしないのは、このスクリプトをKVアクセス無しの純粋な変換ツールに
// 保つため(Workers側の実装変更に引きずられないようにする)。
const KINTONE_PRODUCTS = new Set([
  'kintone-gallery',
  'kintone-listkit',
  'kintone-rule-builder',
  'kintone-excel-report',
  'kintone-signage'
]);

const LIC_PREFIX = 'lic_';

function main() {
  const [, , inputPath, outputPath] = process.argv;
  if (!inputPath) {
    console.error('使い方: node backfill-licdom.mjs <dump.json> [out.json]');
    process.exit(1);
  }

  const dump = JSON.parse(readFileSync(inputPath, 'utf8'));
  if (!Array.isArray(dump)) {
    console.error('入力は {name, value} の配列である必要があります');
    process.exit(1);
  }

  // product_domain → { licenseKey, purchasedAtMs } の最新のものだけを残す
  const best = new Map();

  for (const item of dump) {
    const name = item?.name || '';
    if (!name.startsWith(LIC_PREFIX)) continue;
    const licenseKey = name.slice(LIC_PREFIX.length);

    let record;
    try {
      record = JSON.parse(item.value);
    } catch (_err) {
      continue; // 壊れたレコードは無視(反映対象から外れるだけで安全側)
    }

    const product = record?.product || 'grid-edit-pro';
    if (!KINTONE_PRODUCTS.has(product)) continue;
    if (record.kind === 'trial') continue;
    if ((record.status || 'active') !== 'active') continue;
    const domain = String(record.domain || '').trim();
    if (!domain) continue;

    const mapKey = `${product}_${domain}`;
    const purchasedAtMs = Date.parse(record.purchased_at || '') || 0;
    const existing = best.get(mapKey);
    if (!existing || purchasedAtMs >= existing.purchasedAtMs) {
      best.set(mapKey, { licenseKey, purchasedAtMs, product, domain });
    }
  }

  const out = [...best.entries()].map(([, v]) => ({
    key: `licdom_${v.product}_${v.domain}`,
    value: v.licenseKey
  }));

  const json = JSON.stringify(out, null, 2);
  if (outputPath) {
    writeFileSync(outputPath, json);
    console.error(`${out.length}件 → ${outputPath} に書き出しました(まだKVには反映していません。確認後に手動でbulk putしてください)`);
  } else {
    console.log(json);
  }
}

main();
