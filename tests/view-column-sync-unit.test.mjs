// 「ビュー列連動」(Excel Overlay の初期表示列をkintoneビューの表示列に
// 合わせる機能, v3.2.0)の単体テスト。
//
// 対象:
//  - resolvePresetColumnConfig / resolveViewSyncColumns:
//    リストモード・未カスタマイズ(columnsCustomized=false)・viewFieldOrder
//    が信頼できるソースから得られている場合のみビューの列+順序を採用し、
//    それ以外(カスタマイズ済み/非リスト/fallback)は従来の全列表示に戻る
//  - columnsCustomized の移行判定(isUntouchedBaseColumnConfig /
//    applyLayoutPresetCustomizedMigration): 旧保存データ(フラグ無し)の
//    default プリセットは「全ベース列・フォーム順のまま」なら未カスタマイズ、
//    それ以外(default含む)は常にカスタマイズ済み
//  - createDefaultLayoutPreset: legacyPref(旧列順プリファレンス)から復元した
//    場合は customized=true、まっさらな自動生成は customized=false
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractMethodAsFunction, extractFunctionSource } from './helpers/extract-src.mjs';
import { checkEqual } from './helpers/assert.mjs';

const srcDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');
const contentJs = fs.readFileSync(path.join(srcDir, 'content.js'), 'utf8');

// createDefaultLayoutPreset/normalizeLayoutPreset はクラス外の resolveText(...)
// を直接呼ぶため、extractMethodAsFunction では ReferenceError になる。
// このテストではプリセットの名称/ID文字列は検証対象外なので、ダミー文字列に
// 置き換えてから eval する専用抽出を使う。
function extractMethodWithTextStub(text, signature, name, params) {
  const bodySrc = extractFunctionSource(text, new RegExp(`\\n {4}${signature}\\s\\{`))
    .replace(new RegExp(`^\\n {4}${signature}`), '')
    .replace(/resolveText\([^)]*\)/g, '"__label__"');
  // eslint-disable-next-line no-eval
  return eval(`(function ${name}(${params}) ${bodySrc})`);
}

export async function run({ check }) {
  const eq = (name, actual, expected) => checkEqual(check, `view-column-sync: ${name}`, actual, expected);

  const getBaseFieldCodeList = extractMethodAsFunction(
    contentJs, 'getBaseFieldCodeList\\(baseFields\\)', 'getBaseFieldCodeList', 'baseFields');
  const resolveViewSyncColumns = extractMethodAsFunction(
    contentJs, 'resolveViewSyncColumns\\(preset, allowed\\)', 'resolveViewSyncColumns', 'preset, allowed');
  const resolvePresetColumnConfig = extractMethodAsFunction(
    contentJs, 'resolvePresetColumnConfig\\(baseFields, preset\\)', 'resolvePresetColumnConfig', 'baseFields, preset');
  const isUntouchedBaseColumnConfig = extractMethodAsFunction(
    contentJs, 'isUntouchedBaseColumnConfig\\(preset, baseCodes\\)', 'isUntouchedBaseColumnConfig', 'preset, baseCodes');
  const applyLayoutPresetCustomizedMigration = extractMethodAsFunction(
    contentJs, 'applyLayoutPresetCustomizedMigration\\(preset, baseCodes\\)', 'applyLayoutPresetCustomizedMigration', 'preset, baseCodes');

  const BASE_FIELDS = [
    { code: 'A', label: 'Aフィールド', type: 'SINGLE_LINE_TEXT' },
    { code: 'B', label: 'Bフィールド', type: 'SINGLE_LINE_TEXT' },
    { code: 'C', label: 'Cフィールド', type: 'NUMBER' },
    { code: 'D', label: 'Dフィールド', type: 'SINGLE_LINE_TEXT' }
  ];
  const BASE_CODES = ['A', 'B', 'C', 'D'];

  // resolvePresetColumnConfig / resolveViewSyncColumns が参照する this.* を
  // 用意する。isListMode/viewFieldOrderTrusted/viewFieldOrder をケースごとに
  // 書き換えるため、毎回新しい stub を作る
  function makeStub({ isListMode = true, viewFieldOrderTrusted = true, viewFieldOrder = [] } = {}) {
    const stub = {
      isListMode: () => isListMode,
      viewFieldOrderTrusted,
      viewFieldOrder,
      getBaseFieldCodeList
    };
    stub.resolveViewSyncColumns = resolveViewSyncColumns.bind(stub);
    return stub;
  }

  const defaultPreset = (overrides = {}) => ({
    id: 'default',
    visibleColumns: BASE_CODES.slice(),
    columnOrder: BASE_CODES.slice(),
    columnWidths: {},
    columnsCustomized: false,
    ...overrides
  });

  // ── 1. 未カスタマイズ default + ビュー列あり → ビューの列・順序を採用 ──
  {
    const stub = makeStub({ viewFieldOrder: ['B', 'A'] });
    const config = resolvePresetColumnConfig.call(stub, BASE_FIELDS, defaultPreset());
    eq('untouched default + view -> visibleColumns follows view order', config.visibleColumns, ['B', 'A']);
    eq('untouched default + view -> orderedCodes follows view order', config.orderedCodes, ['B', 'A']);
    check('view-column-sync: untouched default + view -> viewSynced=true', config.viewSynced === true);
  }

  // ── 2. カスタマイズ済みプリセット → プリセットの保存内容が勝つ(ビューは無視) ──
  {
    const stub = makeStub({ viewFieldOrder: ['B', 'A'] });
    const customized = defaultPreset({
      columnsCustomized: true,
      visibleColumns: ['D', 'C'],
      columnOrder: ['D', 'C']
    });
    const config = resolvePresetColumnConfig.call(stub, BASE_FIELDS, customized);
    eq('customized preset wins over view order', config.visibleColumns, ['D', 'C']);
    check('view-column-sync: customized preset -> viewSynced=false', config.viewSynced === false);
  }

  // ── 3. ビュー列に非対応/未知フィールドが含まれる → 除外されて残りだけ採用 ──
  {
    const stub = makeStub({ viewFieldOrder: ['B', 'ステータス', 'A'] });
    const config = resolvePresetColumnConfig.call(stub, BASE_FIELDS, defaultPreset());
    eq('non-allowed field in view is dropped, allowed ones kept in view order', config.visibleColumns, ['B', 'A']);
  }

  // ── 4. フォールバック/空ビュー → 全列(フォーム順)のまま ──
  {
    // 4a. viewFieldOrder が空(安全フォールバック/all_records相当)
    const stubEmpty = makeStub({ viewFieldOrder: [] });
    const configEmpty = resolvePresetColumnConfig.call(stubEmpty, BASE_FIELDS, defaultPreset());
    eq('empty viewFieldOrder -> all columns in form order', configEmpty.visibleColumns, BASE_CODES);
    check('view-column-sync: empty viewFieldOrder -> viewSynced=false', configEmpty.viewSynced === false);

    // 4b. viewFieldOrderTrusted=false(metadataBundle取得失敗で旧EXCEL_GET_VIEW_INFO
    //     にフォールバックした場合。guessed検証が無く誤ったビューを拾う可能性が
    //     あるため、非空でも信頼しない)
    const stubUntrusted = makeStub({ viewFieldOrderTrusted: false, viewFieldOrder: ['B', 'A'] });
    const configUntrusted = resolvePresetColumnConfig.call(stubUntrusted, BASE_FIELDS, defaultPreset());
    eq('untrusted viewFieldOrder (legacy fallback) -> all columns, view ignored', configUntrusted.visibleColumns, BASE_CODES);

    // 4c. フィルタ後に候補が0件(ビューの列が全てallowed外) -> 全列にフォールバック
    const stubAllDropped = makeStub({ viewFieldOrder: ['ステータス', '関連レコード'] });
    const configAllDropped = resolvePresetColumnConfig.call(stubAllDropped, BASE_FIELDS, defaultPreset());
    eq('view order fully filtered out -> falls back to all columns', configAllDropped.visibleColumns, BASE_CODES);

    // 4d. 詳細(単レコード)モードではビュー列連動を適用しない
    const stubDetail = makeStub({ isListMode: false, viewFieldOrder: ['B', 'A'] });
    const configDetail = resolvePresetColumnConfig.call(stubDetail, BASE_FIELDS, defaultPreset());
    eq('detail single-row mode -> view sync not applied', configDetail.visibleColumns, BASE_CODES);
  }

  // ── 5. 移行判定(columnsCustomizedフラグ無しの旧保存データ) ──
  {
    // 5a. default プリセットが全ベース列・フォーム順のまま -> 未カスタマイズ
    const untouchedDefault = { id: 'default', visibleColumns: BASE_CODES.slice(), columnOrder: BASE_CODES.slice() };
    check('migration: untouched default is not customized',
      isUntouchedBaseColumnConfig.call({}, untouchedDefault, BASE_CODES) === true);
    const migratedUntouched = applyLayoutPresetCustomizedMigration.call(
      { isUntouchedBaseColumnConfig: isUntouchedBaseColumnConfig.bind({}) }, untouchedDefault, BASE_CODES
    );
    check('migration: untouched default -> columnsCustomized=false', migratedUntouched.columnsCustomized === false);

    // 5b. default プリセットだが列が絞られている/順序が変わっている -> カスタマイズ済み
    const touchedDefaultSubset = { id: 'default', visibleColumns: ['A', 'B'], columnOrder: ['A', 'B'] };
    const migratedSubset = applyLayoutPresetCustomizedMigration.call(
      { isUntouchedBaseColumnConfig: isUntouchedBaseColumnConfig.bind({}) }, touchedDefaultSubset, BASE_CODES
    );
    check('migration: default with fewer columns -> columnsCustomized=true', migratedSubset.columnsCustomized === true);

    const touchedDefaultReordered = { id: 'default', visibleColumns: BASE_CODES.slice(), columnOrder: ['B', 'A', 'C', 'D'] };
    const migratedReordered = applyLayoutPresetCustomizedMigration.call(
      { isUntouchedBaseColumnConfig: isUntouchedBaseColumnConfig.bind({}) }, touchedDefaultReordered, BASE_CODES
    );
    check('migration: default with reordered columns -> columnsCustomized=true', migratedReordered.columnsCustomized === true);

    // 5c. default 以外(ユーザー作成プリセット)は内容が全列一致でも常にカスタマイズ済み
    const nonDefaultPreset = { id: 'preset_abc', visibleColumns: BASE_CODES.slice(), columnOrder: BASE_CODES.slice() };
    const migratedNonDefault = applyLayoutPresetCustomizedMigration.call(
      { isUntouchedBaseColumnConfig: isUntouchedBaseColumnConfig.bind({}) }, nonDefaultPreset, BASE_CODES
    );
    check('migration: non-default preset is always customized', migratedNonDefault.columnsCustomized === true);

    // 5d. すでに boolean の columnsCustomized を持つプリセットは移行処理で上書きしない
    const alreadyFlagged = { id: 'default', visibleColumns: ['A'], columnOrder: ['A'], columnsCustomized: false };
    const migratedAlready = applyLayoutPresetCustomizedMigration.call(
      { isUntouchedBaseColumnConfig: isUntouchedBaseColumnConfig.bind({}) }, alreadyFlagged, BASE_CODES
    );
    check('migration: existing boolean flag is preserved as-is', migratedAlready.columnsCustomized === false);
  }

  // ── 6. createDefaultLayoutPreset: legacyPrefの有無でcolumnsCustomizedが変わる ──
  {
    const normalizeLayoutPreset = extractMethodWithTextStub(
      contentJs, 'normalizeLayoutPreset\\(rawPreset, baseCodes, fallbackName, fallbackId = \'\'\\)',
      'normalizeLayoutPreset', "rawPreset, baseCodes, fallbackName, fallbackId = ''"
    );
    const createDefaultLayoutPreset = extractMethodWithTextStub(
      contentJs, "createDefaultLayoutPreset\\(baseFields, legacyPref = null, scope = 'list'\\)",
      'createDefaultLayoutPreset', "baseFields, legacyPref = null, scope = 'list'"
    );
    const presetStub = {
      language: 'ja',
      getBaseFieldCodeList,
      sanitizeLayoutPresetName: (value, fallback) => String(value || fallback || 'default'),
      createLayoutPresetId: () => 'preset_test'
    };
    presetStub.normalizeLayoutPreset = normalizeLayoutPreset.bind(presetStub);
    presetStub.createDefaultLayoutPreset = createDefaultLayoutPreset.bind(presetStub);

    const freshDefault = presetStub.createDefaultLayoutPreset(BASE_FIELDS, null, 'list');
    check('createDefaultLayoutPreset: fresh (no legacyPref) -> columnsCustomized=false',
      freshDefault.columnsCustomized === false);

    const fromLegacy = presetStub.createDefaultLayoutPreset(
      BASE_FIELDS, { order: ['D', 'C', 'B', 'A'], widths: {} }, 'list'
    );
    check('createDefaultLayoutPreset: restored from legacyPref -> columnsCustomized=true',
      fromLegacy.columnsCustomized === true);
    eq('createDefaultLayoutPreset: legacyPref order is preserved', fromLegacy.columnOrder, ['D', 'C', 'B', 'A']);

    // normalizeLayoutPreset: 保存済みの boolean フラグはそのまま維持する
    const normalizedTrue = presetStub.normalizeLayoutPreset(
      { id: 'default', visibleColumns: BASE_CODES, columnOrder: BASE_CODES, columnsCustomized: true },
      BASE_CODES, 'default', 'default'
    );
    check('normalizeLayoutPreset: preserves columnsCustomized=true from storage', normalizedTrue.columnsCustomized === true);
    const normalizedFalse = presetStub.normalizeLayoutPreset(
      { id: 'default', visibleColumns: BASE_CODES, columnOrder: BASE_CODES, columnsCustomized: false },
      BASE_CODES, 'default', 'default'
    );
    check('normalizeLayoutPreset: preserves columnsCustomized=false from storage', normalizedFalse.columnsCustomized === false);
    const normalizedMissing = presetStub.normalizeLayoutPreset(
      { id: 'default', visibleColumns: BASE_CODES, columnOrder: BASE_CODES },
      BASE_CODES, 'default', 'default'
    );
    check('normalizeLayoutPreset: missing flag -> undefined (left to migration step)',
      normalizedMissing.columnsCustomized === undefined);
  }

  // ── 7. width-only の持続化経路(persistColumnPref)はフラグを一切書き換えない
  //     ──(resizer drag / 自動幅調整からの呼び出しは columnOrderDraft をそのまま
  //     渡すだけで列・表示を変えないため、ここでフラグへの代入が無いことが
  //     「幅だけの変更ではカスタマイズ済みにしない」要件を保証する。
  //     ただし、未カスタマイズ(ビュー列連動中)のプリセットで columnOrder を
  //     ビューの表示順のまま誤って永続化してしまう不具合(v3.2.1で修正)を防ぐため、
  //     columnsCustomized===true かどうかを読んで分岐するようになった。
  //     「読む」のは許容し、「書く(代入する)」ことだけが無い、を確認する)
  {
    const persistColumnPrefSrc = extractFunctionSource(
      contentJs, new RegExp('\\n {4}async persistColumnPref\\(order, widths\\)\\s\\{')
    );
    check('persistColumnPref never writes columnsCustomized (width-only changes do not flip the flag)',
      !/\.columnsCustomized\s*=[^=]/.test(persistColumnPrefSrc));
    check('persistColumnPref reads columnsCustomized to decide whether to resync columnOrder from the live render order',
      /active\.columnsCustomized === true/.test(persistColumnPrefSrc));
  }

  // ── 8. 列ダイアログの明示保存(handleColumnSave)とリセット(removeColumnOrder)は
  //     それぞれ columnsCustomized を true / false に書き換える ──
  {
    const handleColumnSaveSrc = extractFunctionSource(contentJs, new RegExp('\\n {4}async handleColumnSave\\(\\)\\s\\{'));
    check('handleColumnSave sets columnsCustomized=true on explicit column edit/save',
      /activePreset\.columnsCustomized = true/.test(handleColumnSaveSrc));

    const removeColumnOrderSrc = extractFunctionSource(contentJs, new RegExp('\\n {4}async removeColumnOrder\\(\\)\\s\\{'));
    check('removeColumnOrder resets columnsCustomized=false so view sync resumes',
      /active\.columnsCustomized = false/.test(removeColumnOrderSrc));
  }
}
