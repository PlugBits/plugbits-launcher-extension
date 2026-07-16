// resolveFieldDefaultValue（新規行の初期値プレフィル）の純粋メソッド単体テスト。
// content.js から該当メソッドを文字列として切り出し、ブレース深度カウントで
// 本体を抽出してeval する(overlay-lookup-unit.test.mjsと同じ方式)。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractMethodAsFunction } from './helpers/extract-src.mjs';
import { checkEqual } from './helpers/assert.mjs';

const srcDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');
const src = fs.readFileSync(path.join(srcDir, 'content.js'), 'utf8');

export async function run({ check }) {
  const eq = (name, actual, expected) => checkEqual(check, `newrow-defaults-unit: ${name}`, actual, expected);

  // resolveFieldDefaultValue は this に依存しない純粋メソッドとして書かれているため、
  // bindなしでそのまま呼び出せる。
  const resolveFieldDefaultValue = extractMethodAsFunction(
    src,
    'resolveFieldDefaultValue\\(field, now, timezone\\)',
    'resolveFieldDefaultValue',
    'field, now, timezone'
  );

  const NOW = new Date('2026-07-16T05:00:00.789Z');

  // ==== 文字/数値/ドロップダウン/ラジオの defaultValue ====
  eq(
    'SINGLE_LINE_TEXT: 非空defaultValueをそのまま返す',
    resolveFieldDefaultValue({ code: '案件名', type: 'SINGLE_LINE_TEXT', defaultValue: 'AAA' }, NOW, 'Asia/Tokyo'),
    'AAA'
  );
  eq(
    'MULTI_LINE_TEXT: 非空defaultValueをそのまま返す',
    resolveFieldDefaultValue({ code: '備考', type: 'MULTI_LINE_TEXT', defaultValue: '複数行\nテキスト' }, NOW, 'Asia/Tokyo'),
    '複数行\nテキスト'
  );
  eq(
    'NUMBER: 非空defaultValueを文字列で返す',
    resolveFieldDefaultValue({ code: '数量', type: 'NUMBER', defaultValue: '10' }, NOW, 'Asia/Tokyo'),
    '10'
  );
  eq(
    'LINK: 非空defaultValueをそのまま返す',
    resolveFieldDefaultValue({ code: 'URL', type: 'LINK', defaultValue: 'https://example.com' }, NOW, 'Asia/Tokyo'),
    'https://example.com'
  );
  eq(
    'DROP_DOWN: 非空defaultValueをそのまま返す',
    resolveFieldDefaultValue({ code: 'ステータス', type: 'DROP_DOWN', defaultValue: '中' }, NOW, 'Asia/Tokyo'),
    '中'
  );
  eq(
    'RADIO_BUTTON: 非空defaultValueをそのまま返す',
    resolveFieldDefaultValue({ code: '優先度', type: 'RADIO_BUTTON', defaultValue: '高' }, NOW, 'Asia/Tokyo'),
    '高'
  );

  // ==== CHECK_BOX の配列 defaultValue、空配列→undefined ====
  eq(
    'CHECK_BOX: 非空配列defaultValueを文字列配列で返す',
    resolveFieldDefaultValue({ code: 'タグ', type: 'CHECK_BOX', defaultValue: ['a', 'b'] }, NOW, 'Asia/Tokyo'),
    ['a', 'b']
  );
  eq(
    'MULTI_SELECT: 非空配列defaultValueを文字列配列で返す',
    resolveFieldDefaultValue({ code: '種別', type: 'MULTI_SELECT', defaultValue: ['x'] }, NOW, 'Asia/Tokyo'),
    ['x']
  );
  eq(
    'CHECK_BOX: 空配列defaultValue -> undefined',
    resolveFieldDefaultValue({ code: 'タグ', type: 'CHECK_BOX', defaultValue: [] }, NOW, 'Asia/Tokyo'),
    undefined
  );
  eq(
    'CHECK_BOX: defaultValue未設定 -> undefined',
    resolveFieldDefaultValue({ code: 'タグ', type: 'CHECK_BOX' }, NOW, 'Asia/Tokyo'),
    undefined
  );

  // ==== defaultValue 空文字→undefined ====
  eq(
    'SINGLE_LINE_TEXT: 空文字defaultValue -> undefined（初期値なし扱い）',
    resolveFieldDefaultValue({ code: '案件名', type: 'SINGLE_LINE_TEXT', defaultValue: '' }, NOW, 'Asia/Tokyo'),
    undefined
  );
  eq(
    'NUMBER: defaultValue未設定(undefined) -> undefined',
    resolveFieldDefaultValue({ code: '数量', type: 'NUMBER' }, NOW, 'Asia/Tokyo'),
    undefined
  );

  // ==== DATE defaultNowValue（timezoneで日付が変わる時刻） ====
  // NOW = 2026-07-16T08:00:00Z -> Asia/Tokyo(+9) = 07-16 17:00 / Pacific/Honolulu(-10) = 07-15 22:00
  const NOW_DATE_BOUNDARY = new Date('2026-07-16T08:00:00Z');
  eq(
    'DATE defaultNowValue: Asia/Tokyoでは境界時刻がその日の日付になる',
    resolveFieldDefaultValue({ code: '予定日', type: 'DATE', defaultNowValue: true }, NOW_DATE_BOUNDARY, 'Asia/Tokyo'),
    '2026-07-16'
  );
  eq(
    'DATE defaultNowValue: Pacific/Honoluluでは同時刻が前日の日付になる（timezone依存の確認）',
    resolveFieldDefaultValue({ code: '予定日', type: 'DATE', defaultNowValue: true }, NOW_DATE_BOUNDARY, 'Pacific/Honolulu'),
    '2026-07-15'
  );
  eq(
    'DATE: defaultNowValueがfalseならdefaultValueを使う',
    resolveFieldDefaultValue({ code: '予定日', type: 'DATE', defaultNowValue: false, defaultValue: '2026-01-01' }, NOW_DATE_BOUNDARY, 'Asia/Tokyo'),
    '2026-01-01'
  );

  // ==== DATETIME defaultNowValue のUTC ISO形式（ミリ秒なし・Z終端） ====
  eq(
    'DATETIME defaultNowValue: ミリ秒切り捨て・Z終端のUTC ISO',
    resolveFieldDefaultValue({ code: '作成日時', type: 'DATETIME', defaultNowValue: true }, NOW, 'Asia/Tokyo'),
    '2026-07-16T05:00:00Z'
  );
  eq(
    'DATETIME: defaultNowValue無しはdefaultValueを使う',
    resolveFieldDefaultValue({ code: '作成日時', type: 'DATETIME', defaultValue: '2026-01-01T00:00:00Z' }, NOW, 'Asia/Tokyo'),
    '2026-01-01T00:00:00Z'
  );

  // ==== TIME defaultNowValue の 'HH:mm' ====
  eq(
    'TIME defaultNowValue: Asia/Tokyoでの現在時刻HH:mm',
    resolveFieldDefaultValue({ code: '開始時刻', type: 'TIME', defaultNowValue: true }, NOW, 'Asia/Tokyo'),
    '14:00' // 2026-07-16T05:00:00Z + 9h
  );
  eq(
    'TIME defaultNowValue: UTC深夜0時境界でも24:00にならない',
    resolveFieldDefaultValue({ code: '開始時刻', type: 'TIME', defaultNowValue: true }, new Date('2026-07-16T00:03:00Z'), 'UTC'),
    '00:03'
  );

  // ==== 除外型（FILE/USER_SELECT/lookupAuto など）→ undefined ====
  eq('SUBTABLE -> undefined', resolveFieldDefaultValue({ code: 'テーブル', type: 'SUBTABLE', defaultValue: 'x' }, NOW, 'Asia/Tokyo'), undefined);
  eq('FILE -> undefined', resolveFieldDefaultValue({ code: '添付', type: 'FILE' }, NOW, 'Asia/Tokyo'), undefined);
  eq('RICH_TEXT -> undefined', resolveFieldDefaultValue({ code: '説明', type: 'RICH_TEXT', defaultValue: '<p>x</p>' }, NOW, 'Asia/Tokyo'), undefined);
  eq('CALC -> undefined', resolveFieldDefaultValue({ code: '合計', type: 'CALC' }, NOW, 'Asia/Tokyo'), undefined);
  eq('USER_SELECT -> undefined', resolveFieldDefaultValue({ code: '担当', type: 'USER_SELECT' }, NOW, 'Asia/Tokyo'), undefined);
  eq('ORGANIZATION_SELECT -> undefined', resolveFieldDefaultValue({ code: '部署', type: 'ORGANIZATION_SELECT' }, NOW, 'Asia/Tokyo'), undefined);
  eq('GROUP_SELECT -> undefined', resolveFieldDefaultValue({ code: 'グループ', type: 'GROUP_SELECT' }, NOW, 'Asia/Tokyo'), undefined);
  eq('RECORD_NUMBER (システムフィールド) -> undefined', resolveFieldDefaultValue({ code: 'レコード番号', type: 'RECORD_NUMBER' }, NOW, 'Asia/Tokyo'), undefined);
  eq('CREATED_TIME (システムフィールド) -> undefined', resolveFieldDefaultValue({ code: '作成日時', type: 'CREATED_TIME' }, NOW, 'Asia/Tokyo'), undefined);
  eq(
    'lookupAuto: SINGLE_LINE_TEXTでdefaultValueがあってもコピー先なのでundefined',
    resolveFieldDefaultValue({ code: '商品名', type: 'SINGLE_LINE_TEXT', defaultValue: 'AAA', lookupAuto: true }, NOW, 'Asia/Tokyo'),
    undefined
  );
  eq('field自体がnull -> undefined', resolveFieldDefaultValue(null, NOW, 'Asia/Tokyo'), undefined);
  eq('field.codeが空 -> undefined', resolveFieldDefaultValue({ code: '', type: 'SINGLE_LINE_TEXT', defaultValue: 'A' }, NOW, 'Asia/Tokyo'), undefined);

  // ==== timezoneが不正な場合はローカルタイムにフォールバック（例外を投げない） ====
  eq(
    '不正なtimezoneでも例外を投げずDATEを返す',
    (() => {
      try {
        const v = resolveFieldDefaultValue({ code: '予定日', type: 'DATE', defaultNowValue: true }, NOW, 'Not/A/Real/Timezone');
        return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
      } catch (_e) {
        return false;
      }
    })(),
    true
  );
}
