// 「ビューごとの既定レイアウトプリセット」(v3.3.0)の単体テスト。
//
// 対象(すべてcontent.jsから実装をそのまま抜き出して検証する):
//  - isViewKeyEligibleForViewDefault: viewKeyが id:<viewId> 形式でない場合
//    (name:/param:/default)は「このビューの既定にする」操作を許可しない
//    (ボタンがdisabledになる根拠)
//  - normalizeViewDefaultsMap: 保存済みのviewDefaultsを読み込む際の正規化。
//    id:以外のキー、存在しないプリセットIDを指すエントリを落とす
//    (削除済みプリセットを指すマッピングのクリーンアップ)
//  - buildViewDefaultPseudoPreset: 「このビューの列」疑似プリセットは
//    常にcolumnsCustomized=falseで返る(resolveViewSyncColumnsがビュー列を
//    採用する条件を満たすため)
//  - applyViewDefaultPresetSelection: open()時のビュー別既定の反映ロジック
//    (マッピング無し→3.2.0互換/個別マッピング/フォールバックの疑似選択)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractFunctionSource } from './helpers/extract-src.mjs';
import { checkEqual } from './helpers/assert.mjs';

const srcDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');
const contentJs = fs.readFileSync(path.join(srcDir, 'content.js'), 'utf8');

// このテストが対象とするメソッドは resolveText(...) や
// ExcelOverlayController.VIEW_DEFAULT_PRESET_ID / MAX_LAYOUT_PRESET_COUNT
// (クラス外のモジュールスコープの定数・クラス静的フィールド)を直接参照する。
// extractMethodAsFunction(helpers/extract-src.mjs)単体ではこれらが
// ReferenceErrorになるため、view-column-sync-unit.test.mjsの
// extractMethodWithTextStub と同じ考え方でテキスト置換してからevalする
function extractMethodStubbed(text, signature, name, params) {
  const bodySrc = extractFunctionSource(text, new RegExp(`\\n {4}${signature}\\s\\{`))
    .replace(new RegExp(`^\\n {4}${signature}`), '')
    .replace(/resolveText\([^)]*\)/g, '"__label__"')
    .replace(/ExcelOverlayController\.VIEW_DEFAULT_PRESET_ID/g, "'__view__'")
    .replace(/MAX_LAYOUT_PRESET_COUNT/g, '12');
  // eslint-disable-next-line no-eval
  return eval(`(function ${name}(${params}) ${bodySrc})`);
}

export async function run({ check }) {
  const eq = (name, actual, expected) => checkEqual(check, `view-default-preset-unit: ${name}`, actual, expected);

  const isViewKeyEligibleForViewDefault = extractMethodStubbed(
    contentJs, 'isViewKeyEligibleForViewDefault\\(\\)', 'isViewKeyEligibleForViewDefault', '');
  const normalizeViewDefaultsMap = extractMethodStubbed(
    contentJs, 'normalizeViewDefaultsMap\\(rawViewDefaults, presets\\)', 'normalizeViewDefaultsMap', 'rawViewDefaults, presets');
  const buildViewDefaultPseudoPreset = extractMethodStubbed(
    contentJs, 'buildViewDefaultPseudoPreset\\(state\\)', 'buildViewDefaultPseudoPreset', 'state');
  const applyViewDefaultPresetSelection = extractMethodStubbed(
    contentJs, 'applyViewDefaultPresetSelection\\(\\)', 'applyViewDefaultPresetSelection', '');

  // ── 1. isViewKeyEligibleForViewDefault: id:形式のviewKeyだけ許可する ──
  {
    const mk = (isListMode, viewKey) => ({ isListMode: () => isListMode, viewKey });
    check('list mode + id:viewKey -> eligible',
      isViewKeyEligibleForViewDefault.call(mk(true, 'id:20')) === true);
    check('list mode + name:viewKey -> not eligible (view not uniquely identified)',
      isViewKeyEligibleForViewDefault.call(mk(true, 'name:foo')) === false);
    check('list mode + param:viewKey -> not eligible',
      isViewKeyEligibleForViewDefault.call(mk(true, 'param:detail')) === false);
    check('list mode + default viewKey -> not eligible',
      isViewKeyEligibleForViewDefault.call(mk(true, 'default')) === false);
    check('list mode + empty viewKey -> not eligible',
      isViewKeyEligibleForViewDefault.call(mk(true, '')) === false);
    check('detail mode even with id:viewKey -> not eligible (toolbar hidden anyway)',
      isViewKeyEligibleForViewDefault.call(mk(false, 'id:20')) === false);
  }

  // ── 2. normalizeViewDefaultsMap: 不正/孤立エントリを落とす ──
  {
    const presets = [{ id: 'default' }, { id: 'preset_abc' }];
    const normalized = normalizeViewDefaultsMap.call({}, {
      'id:20': 'default',
      'id:21': 'preset_abc',
      'id:22': '__view__',
      'id:23': 'preset_deleted', // 存在しないプリセットID -> 落ちる
      'name:foo': 'default',     // id:形式でないキー -> 落ちる
      'id:24': '',                // 空値 -> 落ちる
      'id:25': '   id:26  '       // trim後も実在しないID -> 落ちる
    }, presets);
    eq('keeps mapping to an existing preset', normalized['id:20'], 'default');
    eq('keeps mapping to another existing preset', normalized['id:21'], 'preset_abc');
    eq('keeps mapping to the pseudo preset id', normalized['id:22'], '__view__');
    check('drops mapping pointing at a deleted preset', !('id:23' in normalized));
    check('drops non id: key', !('name:foo' in normalized));
    check('drops empty value', !('id:24' in normalized));
    check('drops mapping to a nonexistent id', !('id:25' in normalized));
    eq('result has exactly the 3 valid entries', Object.keys(normalized).sort(), ['id:20', 'id:21', 'id:22']);

    // 非object/未定義の入力でも例外を投げず空オブジェクトを返す
    eq('undefined rawViewDefaults -> {}', normalizeViewDefaultsMap.call({}, undefined, presets), {});
    eq('null rawViewDefaults -> {}', normalizeViewDefaultsMap.call({}, null, presets), {});
  }

  // ── 3. buildViewDefaultPseudoPreset: 常にcolumnsCustomized=falseで返す ──
  {
    const state = {
      presets: [{
        id: 'default',
        visibleColumns: ['A', 'B'],
        columnOrder: ['A', 'B'],
        columnWidths: { A: 200 },
        pinnedColumns: [],
        columnsCustomized: true // 実プリセット側がカスタマイズ済みでも疑似プリセットは無関係
      }]
    };
    const stub = { language: 'ja' };
    const pseudo = buildViewDefaultPseudoPreset.call(stub, state);
    eq('pseudo preset id', pseudo.id, '__view__');
    check('pseudo preset is always columnsCustomized=false (so resolveViewSyncColumns applies)',
      pseudo.columnsCustomized === false);
    eq('pseudo preset falls back to the base(first) preset columns', pseudo.visibleColumns, ['A', 'B']);
    eq('pseudo preset falls back to the base(first) preset widths', pseudo.columnWidths, { A: 200 });

    const emptyPseudo = buildViewDefaultPseudoPreset.call(stub, { presets: [] });
    eq('no base preset -> empty visibleColumns', emptyPseudo.visibleColumns, []);
  }

  // ── 4. applyViewDefaultPresetSelection: open()時のビュー別既定の反映 ──
  const makeState = (overrides = {}) => ({
    activePresetId: 'default',
    presets: [{ id: 'default' }, { id: 'preset_b' }],
    viewDefaults: {},
    ...overrides
  });
  const run4 = (stubOverrides) => {
    const stub = {
      viewKey: 'id:20',
      viewFieldOrderTrusted: true,
      viewFieldOrder: ['B', 'A'],
      viewDefaultPseudoActive: false,
      overlayLayoutState: makeState(),
      ...stubOverrides
    };
    applyViewDefaultPresetSelection.call(stub);
    return stub;
  };

  {
    // 4a. マッピングが1件も無い -> 何もしない(3.2.0までと完全互換)
    const stub = run4({ overlayLayoutState: makeState({ viewDefaults: {} }) });
    check('no mappings at all -> activePresetId untouched', stub.overlayLayoutState.activePresetId === 'default');
    check('no mappings at all -> pseudo not activated', stub.viewDefaultPseudoActive === false);
  }
  {
    // 4b. このビュー専用の既定が実プリセットを指す -> activePresetIdをそれにする
    const stub = run4({ overlayLayoutState: makeState({ viewDefaults: { 'id:20': 'preset_b' } }) });
    check('mapped to a real preset -> activePresetId switches to it', stub.overlayLayoutState.activePresetId === 'preset_b');
    check('mapped to a real preset -> pseudo stays off', stub.viewDefaultPseudoActive === false);
  }
  {
    // 4c. このビュー専用の既定が疑似プリセット('__view__')を指す -> pseudoをON
    const stub = run4({ overlayLayoutState: makeState({ viewDefaults: { 'id:20': '__view__' } }) });
    check('mapped to pseudo preset -> viewDefaultPseudoActive=true', stub.viewDefaultPseudoActive === true);
    check('mapped to pseudo preset -> activePresetId untouched', stub.overlayLayoutState.activePresetId === 'default');
  }
  {
    // 4d. このビューには個別の既定が無いが、アプリには他ビューの既定が1件以上ある
    //     -> 「このビューの列」(pseudo)を選ぶ(ビュー列が信頼できる時のみ)
    const stub = run4({ overlayLayoutState: makeState({ viewDefaults: { 'id:999': 'preset_b' } }) });
    check('unmapped view in an app that has mappings -> falls back to pseudo view-columns',
      stub.viewDefaultPseudoActive === true);
  }
  {
    // 4e. 4dと同条件だが、ビュー列が信頼できない(viewFieldOrderTrusted=false)
    //     -> pseudoにはしない(=従来どおりの挙動にフォールバック)
    const stub = run4({
      overlayLayoutState: makeState({ viewDefaults: { 'id:999': 'preset_b' } }),
      viewFieldOrderTrusted: false
    });
    check('unmapped view + untrusted view columns -> pseudo NOT activated (fallback to normal behavior)',
      stub.viewDefaultPseudoActive === false);
  }
  {
    // 4f. マッピング先の実プリセットIDがもう存在しない(削除済み) -> 無視する
    const stub = run4({ overlayLayoutState: makeState({ viewDefaults: { 'id:20': 'preset_deleted' } }) });
    check('mapped to a preset id that no longer exists -> ignored, activePresetId untouched',
      stub.overlayLayoutState.activePresetId === 'default');
    check('mapped to a preset id that no longer exists -> pseudo stays off', stub.viewDefaultPseudoActive === false);
  }
  {
    // 4g. 疑似プリセット選択中に再度呼ばれても(一旦false→再判定)結果は一貫する
    const stub = run4({
      overlayLayoutState: makeState({ viewDefaults: { 'id:20': 'preset_b' } }),
      viewDefaultPseudoActive: true
    });
    check('re-evaluating always resets pseudo first, then re-decides from viewDefaults',
      stub.viewDefaultPseudoActive === false && stub.overlayLayoutState.activePresetId === 'preset_b');
  }
}
