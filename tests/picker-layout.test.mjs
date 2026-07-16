// 候補ピッカーのレイアウト/ハイライト視認性の検証。
// 症状: 頻出セクションがスクロールリストの外(上)に固定されリストに被さって見える、
// かつ --frequent の背景が --active を上書きして選択位置が見えない。
// 修正: 頻出をリスト内先頭に移動(スクロール1本化) + ハイライト優先CSS + 左バー。
import { openOverlay } from './helpers/overlay-page.mjs';

const FIELDS = [
  { code: '案件名', label: '案件名', type: 'SINGLE_LINE_TEXT', required: true, choices: [] },
  {
    code: '商品', label: '商品', type: 'SINGLE_LINE_TEXT', required: false, choices: [],
    lookup: { relatedApp: { app: '88' }, relatedKeyField: '商品名', lookupPickerFields: ['商品名'], fieldMappings: [] }
  }
];

// 頻出セクションが最大8件出るように、商品にバラけた値を入れた10行
// ＋ 全候補ブラウズ用の空セル行（値入りセルで↓を押すと現在値で検索されるため）
const RECORDS = [
  ...Array.from({ length: 10 }, (_, i) => ({
    $id: { value: String(101 + i) },
    $revision: { value: '1' },
    案件名: { value: `案件${i + 1}` },
    商品: { value: `商品${String((i % 8) + 1).padStart(3, '0')}` }
  })),
  { $id: { value: '200' }, $revision: { value: '1' }, 案件名: { value: '空セル行' }, 商品: { value: '' } }
];

// 参照先は30件（頻出8件+通常30件でピッカーのmax-heightを超える量）
const CANDIDATES = Array.from({ length: 30 }, (_, i) => ({ 商品名: { value: `商品${String(i + 1).padStart(3, '0')}` } }));

function buildBridge() {
  return `
const RECORDS = ${JSON.stringify(RECORDS)};
const CANDIDATES = ${JSON.stringify(CANDIDATES)};
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
    const filtered = kw ? CANDIDATES.filter((r) => r['商品名'].value.includes(kw)) : CANDIDATES;
    return reply({ ok: true, result: { records: filtered, totalCount: filtered.length } });
  }
  if (type === 'EXCEL_GET_LOGIN_USER') return reply({ ok: true, user: { timezone: 'Asia/Tokyo' } });
  if (type === 'GET_APP_NAME') return reply({ ok: true, name: '受注管理' });
  if (type === 'EXCEL_GET_APP_ACL' || type === 'EXCEL_GET_RECORD_ACL' || type === 'EXCEL_GET_FIELD_ACL' || type === 'EXCEL_GET_VIEWS') return reply({ ok: true, result: {} });
  reply({ ok: false });
});`;
}

export async function run({ browser, check }) {
  const name = (n) => `picker-layout: ${n}`;
  const { ctx, page } = await openOverlay({ browser, bridgeScript: buildBridge(), deviceScaleFactor: 2 });
  try {
    check(name('overlay opened'), (await page.locator('#pb-excel-overlay, .pb-overlay').count()) > 0);

    // 空セル（行10）で開く: 値入りセルだと↓が現在値での検索になり全候補にならない
    const shohinCell = page.locator('.pb-overlay__cell input[data-field-code="商品"][data-row-index="10"]');
    await shohinCell.dblclick();
    await page.waitForTimeout(300);
    // ↓キーで全候補ブラウズ（頻出8件 + 参照先30件）
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(700);

    // 構造: 頻出セクションがスクロールリストの内側・先頭にある（1本スクロール）
    const structure = await page.evaluate(() => {
      const list = document.querySelector('.pb-overlay__lookup-anchor .pb-newrec__lookup-list');
      const freq = document.querySelector('.pb-overlay__lookup-anchor .pb-newrec__lookup-frequent');
      if (!list || !freq) return null;
      return {
        freqInsideList: list.contains(freq) && list.firstElementChild === freq,
        listScrollable: list.scrollHeight > list.clientHeight,
        freqItems: freq.querySelectorAll('.pb-newrec__lookup-item').length,
        regularItems: list.querySelectorAll('.pb-newrec__lookup-item:not(.pb-newrec__lookup-item--frequent)').length
      };
    });
    check(name('frequent section lives inside the scroll list (as first child)'), Boolean(structure?.freqInsideList));
    check(name('single scroll container holds both sections'), Boolean(structure?.listScrollable));
    check(name('frequent shows up to 8 items'), structure?.freqItems === 8);
    check(name('regular candidates rendered below'), structure?.regularItems === 30);

    // ↓1回目のハイライトは頻出セクションの先頭（「まず使用中から選択」の期待）
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(150);
    const firstActive = await page.evaluate(() => {
      const el = document.querySelector('.pb-overlay__lookup-anchor .pb-newrec__lookup-item--active');
      if (!el) return null;
      const cs = getComputedStyle(el);
      return {
        isFrequent: el.classList.contains('pb-newrec__lookup-item--frequent'),
        bg: cs.backgroundColor,
        shadow: cs.boxShadow
      };
    });
    check(name('first ArrowDown highlights a FREQUENT item'), Boolean(firstActive?.isFrequent));
    check(name('active highlight is visible on frequent item (blue bg, not gray)'), firstActive?.bg === 'rgb(239, 246, 255)');
    check(name('active highlight has the left bar (inset box-shadow)'), String(firstActive?.shadow || '').includes('inset'));

    // 頻出8件を越えて通常候補までナビゲート → ハイライトが常にリストの可視範囲内にある
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press('ArrowDown');
      await page.waitForTimeout(60);
    }
    const deepActive = await page.evaluate(() => {
      const list = document.querySelector('.pb-overlay__lookup-anchor .pb-newrec__lookup-list');
      const el = document.querySelector('.pb-overlay__lookup-anchor .pb-newrec__lookup-item--active');
      if (!list || !el) return null;
      const lr = list.getBoundingClientRect();
      const er = el.getBoundingClientRect();
      return {
        isFrequent: el.classList.contains('pb-newrec__lookup-item--frequent'),
        visible: er.top >= lr.top - 1 && er.bottom <= lr.bottom + 1,
        text: el.textContent
      };
    });
    check(name('navigation crosses into regular candidates'), deepActive ? !deepActive.isFrequent : false);
    check(name('active item stays inside the visible scroll area'), Boolean(deepActive?.visible));

    // Enterで確定できる
    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);
    check(name('Enter applies the highlighted candidate'), (await shohinCell.inputValue()).startsWith('商品'));
  } finally {
    await ctx.close();
  }
}
