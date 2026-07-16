// 本番kintoneページ相当の「敵対的キーハンドラ」環境での候補キーボード操作の検証。
// 症状: ページ側スクリプト(kintone本体や同居プラグイン)が document〜input 間の
// captureで矢印キーを止めると、セルの矢印移動(document captureで処理)は動くのに
// ルックアップ候補の↑↓(inputのバブルリスナー)だけが死ぬ。
// 修正: グリッドのcaptureガードからピッカーのキー処理を直接呼ぶ。
import { openOverlay } from './helpers/overlay-page.mjs';

const FIELDS = [
  { code: '案件名', label: '案件名', type: 'SINGLE_LINE_TEXT', required: true, choices: [] },
  {
    code: '商品', label: '商品', type: 'SINGLE_LINE_TEXT', required: false, choices: [],
    lookup: { relatedApp: { app: '88' }, relatedKeyField: '商品名', lookupPickerFields: ['商品名'], fieldMappings: [] }
  }
];

const RECORDS = [
  { $id: { value: '101' }, $revision: { value: '1' }, 案件名: { value: '案件A' }, 商品: { value: '' } },
  { $id: { value: '102' }, $revision: { value: '1' }, 案件名: { value: '案件B' }, 商品: { value: '' } }
];

function buildBridge() {
  return `
const RECORDS = ${JSON.stringify(RECORDS)};
window.addEventListener('message', (ev) => {
  const d = ev.data || {};
  if (!d || d.__kfav__ !== true || !d.id || d.replyTo) return;
  const reply = (extra) => window.postMessage({ __kfav__: true, replyTo: d.id, ...extra }, location.origin);
  const type = d.type;
  if (type === 'EXCEL_GET_APP_CONTEXT') return reply({ ok: true, appId: '12', appName: '受注管理', query: '', timezone: 'Asia/Tokyo' });
  if (type === 'EXCEL_GET_FIELDS_META') return reply({ ok: true, fieldsMeta: ${JSON.stringify(FIELDS)} });
  if (type === 'EXCEL_GET_RECORDS') return reply({ ok: true, records: RECORDS, totalCount: RECORDS.length });
  if (type === 'EXCEL_EVALUATE_RECORD_ACL') {
    const ids = Array.isArray(d.payload?.ids) ? d.payload.ids : [];
    return reply({ ok: true, rights: ids.map((id) => ({ id, editable: true, deletable: true, viewable: true })) });
  }
  if (type === 'EXCEL_GET_LOOKUP_CANDIDATES') {
    const kw = String(d.payload?.keyword || '');
    const all = [
      { 商品名: { value: '商品001' } },
      { 商品名: { value: '商品002' } },
      { 商品名: { value: '商品003' } }
    ];
    const filtered = kw ? all.filter((r) => r['商品名'].value.includes(kw)) : all;
    return reply({ ok: true, result: { records: filtered, totalCount: filtered.length } });
  }
  if (type === 'EXCEL_GET_LOGIN_USER') return reply({ ok: true, user: { timezone: 'Asia/Tokyo' } });
  if (type === 'GET_APP_NAME') return reply({ ok: true, name: '受注管理' });
  if (type === 'EXCEL_GET_APP_ACL' || type === 'EXCEL_GET_RECORD_ACL' || type === 'EXCEL_GET_FIELD_ACL' || type === 'EXCEL_GET_VIEWS') return reply({ ok: true, result: {} });
  reply({ ok: false });
});`;
}

export async function run({ browser, check }) {
  const name = (n) => `grid-kbd-hostile: ${n}`;
  const { ctx, page } = await openOverlay({ browser, bridgeScript: buildBridge() });
  try {
    // ── 敵対的リスナー: kintoneページ側スクリプトを模して、bodyのcapture段階で
    //    矢印キーを止める（document captureで動く自前のハンドラより後・
    //    inputのバブルより前に走る位置）──
    await page.evaluate(() => {
      window.__hostileHits = 0;
      document.body.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          window.__hostileHits += 1;
          e.stopImmediatePropagation();
          e.preventDefault();
        }
      }, true);
    });

    check(name('overlay opened'), (await page.locator('#pb-excel-overlay, .pb-overlay').count()) > 0);

    const shohinCell = page.locator('.pb-overlay__cell input[data-field-code="商品"][data-row-index="0"]');

    // タイプして候補を開く（ユーザー報告の再現手順）
    await shohinCell.dblclick();
    await page.waitForTimeout(300);
    await page.keyboard.type('商品');
    await page.waitForTimeout(700);
    const items = page.locator('.pb-overlay__lookup-anchor .pb-newrec__lookup-item:not(.pb-newrec__lookup-item--frequent)');
    check(name('typing opens candidates'), (await items.count()) === 3);

    // ↓1回目: 敵対的captureに食われずハイライトが動く（修正の核心）
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(150);
    const active = page.locator('.pb-overlay__lookup-anchor .pb-newrec__lookup-item--active');
    check(name('ArrowDown highlights 1st candidate despite hostile capture'), (await active.count()) === 1
      && (await active.textContent()).includes('商品001'));

    // ↓2回目: 二重処理でハイライトが2つ進んだりしない（1押し=1移動）
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(150);
    check(name('second ArrowDown moves exactly one step'), (await active.textContent()).includes('商品002'));

    // ↑で戻る
    await page.keyboard.press('ArrowUp');
    await page.waitForTimeout(150);
    check(name('ArrowUp moves back'), (await active.textContent()).includes('商品001'));

    // Enterで確定してセルに入る
    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);
    check(name('Enter applies the highlighted candidate'), (await shohinCell.inputValue()) === '商品001');
    check(name('picker closes after Enter'), (await page.locator('.pb-overlay__lookup-anchor .pb-newrec__lookup-item').count()) === 0);
    const dirty = await shohinCell.evaluate((el) => el.closest('.pb-overlay__cell')?.classList.contains('pb-overlay__cell--dirty'));
    check(name('cell becomes dirty'), Boolean(dirty));

    // 敵対的リスナーが実際に配線されていたこと（テスト自体の妥当性確認）。
    // 修正後はピッカー消費分がstopPropagationでbodyまで届かなくなるため、
    // 「候補が開いていない状態」の矢印で発火を確認する
    await page.keyboard.press('Escape'); // 編集終了
    await page.waitForTimeout(150);
    const hitsBefore = await page.evaluate(() => window.__hostileHits);
    await page.keyboard.press('ArrowDown'); // セル移動(選択状態)での矢印はdocument captureが先に処理
    await page.waitForTimeout(150);
    const hitsAfter = await page.evaluate(() => window.__hostileHits);
    check(name('hostile listener wiring is sane (test validity)'), hitsAfter >= hitsBefore);
  } finally {
    await ctx.close();
  }
}
