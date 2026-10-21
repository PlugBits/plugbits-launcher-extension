// サブテーブル編集モーダルの「閉じる」回帰テスト(3.3.0 リリースブロッカー)。
//
// 実機報告(Invoice Detail アプリ・DETAIL-FORMレイアウト):
//   (1) 「キャンセル」も「×」もモーダルを閉じない
//   (2) EscがサブテーブルモーダルだけでなくOverlay全体を閉じてしまう
//
// グリッドモード・DETAIL-FORMモードの両方、単一クリック・ダブルクリックの両方で
// キャンセル/×/Escの挙動を検証する。
import { openOverlay, openDetailFormOverlay, cell } from './helpers/overlay-page.mjs';

const FIELDS = [
  { code: '案件名', label: '案件名', type: 'SINGLE_LINE_TEXT', required: false, choices: [] },
  {
    code: '明細', label: '明細', type: 'SUBTABLE', required: false, choices: [],
    subtable: { fields: [
      { code: '品目', label: '品目', type: 'SINGLE_LINE_TEXT', required: false, choices: [] }
    ] }
  }
];

function subtableItem(id, 品目) {
  return { id: String(id), value: { 品目: { value: 品目 } } };
}

const RECORDS = [
  {
    $id: { value: '301' }, $revision: { value: '1' },
    案件名: { value: '案件A' },
    明細: { value: [subtableItem('1', 'A'), subtableItem('2', 'B')] }
  }
];

function buildBridge() {
  return `
const RECORDS = ${JSON.stringify(RECORDS)};
window.addEventListener('message', (ev) => {
  const d = ev.data || {};
  if (!d || d.__kfav__ !== true || !d.id || d.replyTo) return;
  const reply = (extra) => window.postMessage({ __kfav__: true, replyTo: d.id, ...extra }, location.origin);
  const type = d.type;
  if (type === 'EXCEL_GET_APP_CONTEXT') return reply({ ok: true, appId: '12', appName: '請求詳細', query: '', timezone: 'Asia/Tokyo' });
  if (type === 'EXCEL_GET_FIELDS_META') return reply({ ok: true, fieldsMeta: ${JSON.stringify(FIELDS)} });
  if (type === 'EXCEL_GET_RECORDS') return reply({ ok: true, records: RECORDS, totalCount: RECORDS.length });
  if (type === 'EXCEL_EVALUATE_RECORD_ACL') {
    const ids = Array.isArray(d.payload?.ids) ? d.payload.ids : [];
    return reply({ ok: true, rights: ids.map((id) => ({ id, editable: true, deletable: true, viewable: true })) });
  }
  if (type === 'EXCEL_GET_LOGIN_USER') return reply({ ok: true, user: { timezone: 'Asia/Tokyo' } });
  if (type === 'GET_APP_NAME') return reply({ ok: true, name: '請求詳細' });
  if (type === 'EXCEL_GET_APP_ACL' || type === 'EXCEL_GET_RECORD_ACL' || type === 'EXCEL_GET_FIELD_ACL' || type === 'EXCEL_GET_VIEWS') return reply({ ok: true, result: {} });
  reply({ ok: false });
});`;
}

const overlayOk = (page) => page.locator('#pb-excel-overlay, .pb-overlay').count();
const layerCount = (page) => page.locator('.pb-overlay__subtable-layer').count();
const panelCount = (page) => page.locator('.pb-overlay__subtable-panel').count();

async function openSubtable(page, { dblclick, detailForm }) {
  const target = cell(page, 0, '明細');
  if (dblclick) {
    await target.dblclick();
  } else {
    await target.click();
  }
  await page.waitForTimeout(500);
}

export async function run({ browser, check }) {
  const name = (n) => `subtable-modal-close-e2e: ${n}`;

  for (const mode of ['grid', 'detail-form']) {
    for (const openBy of ['click', 'dblclick']) {
      const label = `[${mode}/${openBy}]`;
      const opener = mode === 'detail-form' ? openDetailFormOverlay : openOverlay;
      const { ctx, page } = await opener({ browser, bridgeScript: buildBridge() });
      try {
        check(name(`${label} overlay opened`), (await overlayOk(page)) > 0);
        if (mode === 'detail-form') {
          check(name(`${label} detail-form layout が有効`),
            (await page.locator('.pb-overlay__grid--detail-form').count()) > 0);
        }

        // ── キャンセルボタンで閉じる ──
        await openSubtable(page, { dblclick: openBy === 'dblclick' });
        check(name(`${label} キャンセル前: パネルが1枚存在する`), (await panelCount(page)) === 1);
        await page.locator('[data-subtable-action="cancel"]').click();
        await page.waitForTimeout(150);
        check(name(`${label} キャンセルで閉じる(layer残り0)`), (await layerCount(page)) === 0);
        check(name(`${label} キャンセル後もOverlayは開いたまま`), (await overlayOk(page)) > 0);
        await page.waitForTimeout(300);
        check(name(`${label} キャンセル後、再表示されない(300ms後もlayer0)`), (await layerCount(page)) === 0);

        // ── ×ボタンで閉じる ──
        await openSubtable(page, { dblclick: openBy === 'dblclick' });
        check(name(`${label} ×前: パネルが1枚存在する`), (await panelCount(page)) === 1);
        await page.locator('.pb-overlay__subtable-close').click();
        await page.waitForTimeout(150);
        check(name(`${label} ×で閉じる(layer残り0)`), (await layerCount(page)) === 0);
        check(name(`${label} ×後もOverlayは開いたまま`), (await overlayOk(page)) > 0);
        await page.waitForTimeout(300);
        check(name(`${label} ×後、再表示されない(300ms後もlayer0)`), (await layerCount(page)) === 0);

        // ── Esc: フォーカスがモーダル内の入力にある場合 ──
        await openSubtable(page, { dblclick: openBy === 'dblclick' });
        check(name(`${label} Esc(入力内)前: パネルが1枚存在する`), (await panelCount(page)) === 1);
        await page.locator('.pb-subtable__body input').first().click();
        await page.keyboard.press('Escape');
        await page.waitForTimeout(150);
        check(name(`${label} Esc(入力内): モーダルだけ閉じる`), (await layerCount(page)) === 0);
        check(name(`${label} Esc(入力内): Overlayは開いたまま`), (await overlayOk(page)) > 0);

        // ── Esc: フォーカスがモーダル外(開いた時点のまま・入力でない)の場合 ──
        await openSubtable(page, { dblclick: openBy === 'dblclick' });
        check(name(`${label} Esc(外)前: パネルが1枚存在する`), (await panelCount(page)) === 1);
        await page.keyboard.press('Escape');
        await page.waitForTimeout(150);
        check(name(`${label} Esc(外): モーダルだけ閉じる(Overlay全体は閉じない)`), (await layerCount(page)) === 0);
        check(name(`${label} Esc(外): Overlayは開いたまま`), (await overlayOk(page)) > 0);

        // ── モーダルを閉じた後、Escで今度はOverlay全体が閉じる(既存挙動の確認) ──
        await page.keyboard.press('Escape');
        await page.waitForTimeout(200);
        check(name(`${label} モーダルが無い状態のEscでOverlay全体が閉じる(既存挙動)`), (await overlayOk(page)) === 0);
      } finally {
        await ctx.close();
      }
    }
  }
}
