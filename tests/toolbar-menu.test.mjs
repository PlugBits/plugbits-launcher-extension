// Excel Overlay ツールバー整理（「ツール ▾」メニュー集約）の回帰テスト。
// 列表示・再計算・ルックアップ再取得を低頻度の管理系操作としてメニューに
// まとめ、ツールバー2列目には [ツール▾] | [行追加/元に戻す/やり直す] |
// [変更バッジ/保存/閉じる] の3グループだけが直下に残ることを確認する。
import { openOverlay } from './helpers/overlay-page.mjs';

// ルックアップキー項目ありのフィールド定義（メニュー内3項目すべてが有効になる想定）
const FIELDS_WITH_LOOKUP = [
  { code: '案件名', label: '案件名', type: 'SINGLE_LINE_TEXT', required: true, choices: [] },
  { code: '数量', label: '数量', type: 'NUMBER', required: false, choices: [] },
  {
    code: '商品', label: '商品', type: 'SINGLE_LINE_TEXT', required: false, choices: [],
    lookup: { relatedApp: { app: '88' }, relatedKeyField: '商品名', lookupPickerFields: ['商品名'], fieldMappings: [] }
  }
];

// ルックアップキー項目なしのフィールド定義（「ルックアップ再取得」項目が
// メニュー内で非表示になることを確認するための構成）
const FIELDS_NO_LOOKUP = [
  { code: '案件名', label: '案件名', type: 'SINGLE_LINE_TEXT', required: true, choices: [] },
  { code: '数量', label: '数量', type: 'NUMBER', required: false, choices: [] }
];

const RECORDS = [
  { $id: { value: '101' }, $revision: { value: '1' }, 案件名: { value: '案件A' }, 数量: { value: '5' }, 商品: { value: '商品001' } },
  { $id: { value: '102' }, $revision: { value: '1' }, 案件名: { value: '案件B' }, 数量: { value: '2' }, 商品: { value: '商品002' } }
];

function buildBridge(fields) {
  return `
const RECORDS = ${JSON.stringify(RECORDS)};
window.addEventListener('message', (ev) => {
  const d = ev.data || {};
  if (!d || d.__kfav__ !== true || !d.id || d.replyTo) return;
  const reply = (extra) => window.postMessage({ __kfav__: true, replyTo: d.id, ...extra }, location.origin);
  const type = d.type;
  if (type === 'EXCEL_GET_APP_CONTEXT') return reply({ ok: true, appId: '12', appName: '受注管理', query: '', timezone: 'Asia/Tokyo' });
  if (type === 'EXCEL_GET_FIELDS_META') return reply({ ok: true, fieldsMeta: ${JSON.stringify(fields)} });
  if (type === 'EXCEL_GET_RECORDS') return reply({ ok: true, records: RECORDS, totalCount: RECORDS.length });
  if (type === 'EXCEL_EVALUATE_RECORD_ACL') {
    const ids = Array.isArray(d.payload?.ids) ? d.payload.ids : [];
    return reply({ ok: true, rights: ids.map((id) => ({ id, editable: true, deletable: true, viewable: true })) });
  }
  if (type === 'EXCEL_GET_LOOKUP_CANDIDATES') return reply({ ok: true, result: { records: [{ 商品名: { value: '商品001' } }, { 商品名: { value: '商品002' } }], totalCount: 2 } });
  if (type === 'EXCEL_GET_LOGIN_USER') return reply({ ok: true, user: { timezone: 'Asia/Tokyo' } });
  if (type === 'GET_APP_NAME') return reply({ ok: true, name: '受注管理' });
  if (type === 'EXCEL_GET_APP_ACL' || type === 'EXCEL_GET_RECORD_ACL' || type === 'EXCEL_GET_FIELD_ACL' || type === 'EXCEL_GET_VIEWS') return reply({ ok: true, result: {} });
  reply({ ok: false });
});`;
}

export async function run({ browser, check }) {
  const name = (n) => `toolbar-menu: ${n}`;

  // ── コンテキスト1: ルックアップキー項目ありのアプリ ──
  const { ctx: ctx1, page } = await openOverlay({ browser, bridgeScript: buildBridge(FIELDS_WITH_LOOKUP) });
  try {
    check(name('overlay opened'), (await page.locator('#pb-excel-overlay, .pb-overlay').count()) > 0);

    const toolMenuToggle = page.locator('.pb-overlay__tool-menu-toggle');

    // ── 1. ツールバー2列目の直下ボタン構成: 列表示/再計算/ルックアップ再取得が
    //       直下に無く、[ツール▾][行追加][元に戻す][やり直す][保存][閉じる]だけになっている ──
    const visibleTopLevelLabels = await page.locator('.pb-overlay__toolbar-secondary button:visible').allTextContents();
    const trimmedLabels = visibleTopLevelLabels.map((t) => t.trim());
    // 既存ボタンの実文言はアイコン付き(「＋ 行追加」「↶ Undo」「↷ Redo」)なので、
    // 部分一致で「行追加/元に戻す(Undo)/やり直す(Redo)」の並びを確認する
    check(
      name('toolbar-secondary direct buttons are [ツール▾, 行追加, Undo, Redo, 保存, 閉じる] in this order'),
      trimmedLabels.length === 6
        && /^ツール/.test(trimmedLabels[0])
        && /行追加/.test(trimmedLabels[1])
        && /Undo/.test(trimmedLabels[2])
        && /Redo/.test(trimmedLabels[3])
        && trimmedLabels[4] === '保存'
        && trimmedLabels[5] === '閉じる'
    );
    check(
      name('列順・再計算・ルックアップ再取得はトップレベルに出てこない'),
      !trimmedLabels.some((t) => t === '列順' || t === '再計算' || t === 'ルックアップ再取得')
    );

    // ── 2. ツール▾クリック → メニューが開き3項目が見える（aria-expanded=true）──
    await toolMenuToggle.click();
    await page.waitForTimeout(200);
    check(name('tool menu toggle aria-expanded=true after click'), (await toolMenuToggle.getAttribute('aria-expanded')) === 'true');
    const menuItems = page.locator('.pb-overlay__tool-menu-item');
    check(name('tool menu has 3 items'), (await menuItems.count()) === 3);
    const menuItemVisibility = await Promise.all(
      (await menuItems.all()).map((item) => item.isVisible())
    );
    check(name('all 3 tool menu items are visible'), menuItemVisibility.every(Boolean));

    // ── 3. 「列順」をクリック → 列マネージャが開く ──
    const columnsItem = page.locator('.pb-overlay__tool-menu-item', { hasText: /列順|Columns/ });
    await columnsItem.click();
    await page.waitForTimeout(300);
    check(name('clicking columns item opens the column manager panel'), (await page.locator('.pb-overlay__column-panel').count()) === 1);
    check(name('tool menu closed itself after the item click'), (await toolMenuToggle.getAttribute('aria-expanded')) === 'false');
    await page.locator('.pb-overlay__column-close').click();
    await page.waitForTimeout(200);
    check(name('column manager panel closes'), (await page.locator('.pb-overlay__column-panel').count()) === 0);

    // ── 4. Esc / 外側クリックでメニューが閉じる ──
    await toolMenuToggle.click();
    await page.waitForTimeout(200);
    check(name('tool menu open before Esc test'), (await toolMenuToggle.getAttribute('aria-expanded')) === 'true');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(150);
    check(name('Escape closes the tool menu'), (await toolMenuToggle.getAttribute('aria-expanded')) === 'false');
    check(name('focus returns to the toggle button after Esc'), await toolMenuToggle.evaluate((el) => el === document.activeElement));

    await toolMenuToggle.click();
    await page.waitForTimeout(200);
    check(name('tool menu open before outside-click test'), (await toolMenuToggle.getAttribute('aria-expanded')) === 'true');
    await page.locator('.pb-overlay__title').click();
    await page.waitForTimeout(150);
    check(name('outside click closes the tool menu'), (await toolMenuToggle.getAttribute('aria-expanded')) === 'false');

    // ── 5. 「再計算」をクリック → スコープ確認ダイアログが出る（キャンセルで閉じる）──
    await toolMenuToggle.click();
    await page.waitForTimeout(200);
    const recalcItem = page.locator('.pb-overlay__tool-menu-item', { hasText: /再計算|Recalculate/ });
    await recalcItem.click();
    await page.waitForTimeout(300);
    check(name('recalc menu item opens the scope confirm dialog'), (await page.locator('.pb-overlay__confirm-layer').count()) === 1);
    const cancelBtn = page.locator('.pb-overlay__confirm-actions button', { hasText: /キャンセル|Cancel/ });
    await cancelBtn.click();
    await page.waitForTimeout(200);
    check(name('cancel closes the recalc confirm dialog'), (await page.locator('.pb-overlay__confirm-layer').count()) === 0);
  } finally {
    await ctx1.close();
  }

  // ── 6. ルックアップキー項目が無いアプリでも起動でき、メニュー内の
  //       「ルックアップ再取得」項目が非表示になっている ──
  const { ctx: ctx2, page: page2 } = await openOverlay({ browser, bridgeScript: buildBridge(FIELDS_NO_LOOKUP) });
  try {
    check(name('overlay opened for the no-lookup-field app'), (await page2.locator('#pb-excel-overlay, .pb-overlay').count()) > 0);

    const toolMenuToggle2 = page2.locator('.pb-overlay__tool-menu-toggle');
    await toolMenuToggle2.click();
    await page2.waitForTimeout(200);
    const lookupRefreshItem2 = page2.locator('.pb-overlay__tool-menu-item', { hasText: /ルックアップ再取得|Refresh lookups/ });
    check(name('lookup refresh item exists in DOM but is hidden (no lookup key fields)'), (await lookupRefreshItem2.count()) === 1 && !(await lookupRefreshItem2.isVisible()));
    check(name('columns / recalc items remain visible'), (await page2.locator('.pb-overlay__tool-menu-item', { hasText: /列順|Columns/ }).isVisible())
      && (await page2.locator('.pb-overlay__tool-menu-item', { hasText: /再計算|Recalculate/ }).isVisible()));
  } finally {
    await ctx2.close();
  }
}
