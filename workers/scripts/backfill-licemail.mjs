#!/usr/bin/env node
// licemail_{email} インデックス(2026-10-21導入・POST /recover用)の手動バックフィル用スクリプト。
//
// このスクリプトは KV に何も書き込まない(読むのも書くのもしない)。入力のJSONダンプを
// 読んで、「書くべき licemail_ インデックスの一覧」を wrangler kv bulk put 用のJSONとして
// 出力するだけ。実際の反映は人間が確認してから、オケオの承認を得た後に別途 wrangler で行う。
//
// 使い方(すべて手作業・オケオの承認後に実行する):
//   1. 本番のライセンスレコードをダンプする(キー名だけ list → 1件ずつ get して組む。
//      例:
//        wrangler kv key list --binding=LICENSES --prefix=lic_ > keys.json
//        node -e '...' で keys.json の各 name を get して {name, value} の配列を作る
//      → dump.json は [{ "name": "lic_<uuid>", "value": "<JSON文字列のレコード>" }, ...] の形。
//      value は env.LICENSES.get() が返す生のJSON文字列(レコードそのもの)をそのまま入れる。
//   2. このスクリプトを実行する:
//        node workers/scripts/backfill-licemail.mjs dump.json out.json
//   3. out.json の内容を人間が確認する(件数だけ。メールアドレス・キーの内容は見ない/出力しない)。
//   4. 問題なければ bulk put で反映する:
//        wrangler kv bulk put out.json --binding=LICENSES
//
// 対象: lic_ 始まりのレコードのうち、kind !== 'trial'(トライアルは対象外)・
// status が active または past_due(refunded/canceled等は除く)・メールアドレスが有効なもの。
// 同じメールに複数の有効なキーがある場合は1つのindexにまとめる(配列・重複排除)。
// メール正規化は index.js の normalizeTrialEmail と同じロジックをここにコピーしている
// (このスクリプトを KV アクセス無しの純粋な変換ツールに保つため、index.js は直接importしない)。

import { readFileSync, writeFileSync } from 'node:fs';

const LIC_PREFIX = 'lic_';

// index.js の normalizeTrialEmail と同じ内容(小文字化 + ローカル部の+エイリアス除去)。
function normalizeTrialEmail(raw) {
  const s = String(raw || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) return null;
  const at = s.lastIndexOf('@');
  const local = s.slice(0, at).split('+')[0];
  const domain = s.slice(at + 1);
  if (!local) return null;
  return `${local}@${domain}`;
}

function main() {
  const [, , inputPath, outputPathArg] = process.argv;
  if (!inputPath) {
    console.error('使い方: node backfill-licemail.mjs <dump.json> [out.json]');
    process.exit(1);
  }
  // メールアドレス・キーを標準出力に出さないため、出力先は常にファイルにする(既定 out.json)
  const outputPath = outputPathArg || 'out.json';

  const dump = JSON.parse(readFileSync(inputPath, 'utf8'));
  if (!Array.isArray(dump)) {
    console.error('入力は {name, value} の配列である必要があります');
    process.exit(1);
  }

  // normalizedEmail → licenseKey[](重複排除)
  const byEmail = new Map();
  let skippedInvalid = 0;
  let skippedTrial = 0;
  let skippedStatus = 0;
  let matched = 0;

  for (const item of dump) {
    const name = item?.name || '';
    if (!name.startsWith(LIC_PREFIX)) continue;
    const licenseKey = name.slice(LIC_PREFIX.length);

    let record;
    try {
      record = JSON.parse(item.value);
    } catch (_err) {
      skippedInvalid += 1;
      continue; // 壊れたレコードは無視(反映対象から外れるだけで安全側)
    }

    if (record.kind === 'trial') {
      skippedTrial += 1;
      continue;
    }
    const status = record.status || 'active';
    if (status !== 'active' && status !== 'past_due') {
      skippedStatus += 1;
      continue;
    }

    const normalized = normalizeTrialEmail(record.email);
    if (!normalized) {
      skippedInvalid += 1;
      continue;
    }

    const keys = byEmail.get(normalized) || [];
    if (!keys.includes(licenseKey)) keys.push(licenseKey);
    byEmail.set(normalized, keys);
    matched += 1;
  }

  const out = [...byEmail.entries()].map(([normalized, keys]) => ({
    key: `licemail_${normalized}`,
    value: JSON.stringify(keys)
  }));

  const outJson = JSON.stringify(out, null, 2);
  writeFileSync(outputPath, outJson);
  // 標準出力には件数だけを出す(メールアドレス・ライセンスキーは一切出さない)
  console.log(
    `入力${dump.length}件中 対象${matched}件・index ${out.length}件 → ${outputPath} に書き出しました`
    + `(除外: trial=${skippedTrial} / status不一致=${skippedStatus} / 無効=${skippedInvalid})。`
    + `まだKVには反映していません。確認後に手動でbulk putしてください`
  );
}

main();
