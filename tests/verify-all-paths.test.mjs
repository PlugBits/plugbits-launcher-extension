// ルックアップ照合の全経路化（候補ピッカー選択/頻出候補選択/手打ち確定/貼り付け）の
// E2E検証。
import { openOverlay } from './helpers/overlay-page.mjs';

// ── フィールド定義: 商品(ルックアップキー、関連アプリ88・≤500件マスタ) ──
const FIELDS = [
  { code: '案件名', label: '案件名', type: 'SINGLE_LINE_TEXT', required: true, choices: [] },
  {
    code: '商品', label: '商品', type: 'SINGLE_LINE_TEXT', required: false, choices: [],
    lookup: { relatedApp: { app: '88' }, relatedKeyField: '商品名', lookupPickerFields: ['商品名'], fieldMappings: [] }
  }
];

// ── 表示中の5行 ──────────────────────────────────────────────
// 601: 商品004で初期値あり。frequentStoreへ唯一の頻出値(商品004)を供給しつつ、
//      「元の値のまま編集を終了」テストにも使う(diffが立たないので照合は起きないはず)
// 602: 空。候補ピッカーから参照先レコードを選ぶ(source='record')テスト用
// 603: 空。頻出候補から選ぶ(source='frequent')テスト用
// 604: 空。手打ちで実在する値を入力してEnter確定するテスト用
// 605: 空。手打ちで実在しない値を入力して別セルクリックで確定するテスト用
const RECORDS = [
  { $id: { value: '601' }, $revision: { value: '1' }, 案件名: { value: '案件A' }, 商品: { value: '商品004' } },
  { $id: { value: '602' }, $revision: { value: '1' }, 案件名: { value: '案件B' }, 商品: { value: '' } },
  { $id: { value: '603' }, $revision: { value: '1' }, 案件名: { value: '案件C' }, 商品: { value: '' } },
  { $id: { value: '604' }, $revision: { value: '1' }, 案件名: { value: '案件D' }, 商品: { value: '' } },
  { $id: { value: '605' }, $revision: { value: '1' }, 案件名: { value: '案件E' }, 商品: { value: '' } }
];

// 参照先(app88)の候補。4件のみ(≤500件マスタ=全件ローカルモード)
const LOOKUP_CANDIDATES = [
  { 商品名: { value: '商品001' } },
  { 商品名: { value: '商品002' } },
  { 商品名: { value: '商品003' } },
  { 商品名: { value: '商品004' } }
];

function buildBridge() {
  return `
window.__lookupCalls = [];
window.__putCalls = [];
const RECORDS = ${JSON.stringify(RECORDS)};
const CANDIDATES = ${JSON.stringify(LOOKUP_CANDIDATES)};
window.addEventListener('message', (ev) => {
  const d = ev.data || {};
  if (!d || d.__kfav__ !== true || !d.id || d.replyTo) return;
  const reply = (extra) => window.postMessage({ __kfav__: true, replyTo: d.id, ...extra }, location.origin);
  const type = d.type;
  if (type === 'EXCEL_GET_APP_CONTEXT') {
    return reply({ ok: true, appId: '12', appName: '受注管理', query: '', timezone: 'Asia/Tokyo' });
  }
  if (type === 'EXCEL_GET_FIELDS_META') {
    return reply({ ok: true, fieldsMeta: ${JSON.stringify(FIELDS)} });
  }
  if (type === 'EXCEL_GET_RECORDS') {
    return reply({ ok: true, records: RECORDS, totalCount: RECORDS.length });
  }
  if (type === 'EXCEL_EVALUATE_RECORD_ACL') {
    const ids = Array.isArray(d.payload?.ids) ? d.payload.ids : [];
    return reply({ ok: true, rights: ids.map((id) => ({ id, editable: true, deletable: true, viewable: true })) });
  }
  if (type === 'EXCEL_GET_LOOKUP_CANDIDATES') {
    window.__lookupCalls.push({ keyword: String(d.payload?.keyword || ''), exactValues: d.payload?.exactValues || null });
    const kw = String(d.payload?.keyword || '');
    const filtered = kw ? CANDIDATES.filter((r) => r['商品名'].value.includes(kw)) : CANDIDATES;
    return reply({ ok: true, result: { records: filtered, totalCount: filtered.length } });
  }
  if (type === 'EXCEL_PUT_RECORDS') {
    const records = Array.isArray(d.payload?.records) ? d.payload.records : [];
    window.__putCalls.push({ records, __pbTrigger: d.payload?.__pbTrigger });
    return reply({ ok: true, result: { records: records.map(() => ({ revision: '2' })) } });
  }
  if (type === 'EXCEL_GET_LOGIN_USER') return reply({ ok: true, user: { timezone: 'Asia/Tokyo' } });
  if (type === 'GET_APP_NAME') return reply({ ok: true, name: '受注管理' });
  if (type === 'EXCEL_GET_VIEW_INFO') return reply({ ok: false });
  if (type === 'EXCEL_GET_APP_ACL' || type === 'EXCEL_GET_RECORD_ACL' || type === 'EXCEL_GET_FIELD_ACL' || type === 'EXCEL_GET_VIEWS') {
    return reply({ ok: true, result: {} });
  }
  reply({ ok: false });
});`;
}

export async function run({ browser, check }) {
  const name = (n) => `verify-all-paths: ${n}`;
  const { ctx, page } = await openOverlay({ browser, bridgeScript: buildBridge(), deviceScaleFactor: 2 });
  try {
    const overlayVisible = await page.locator('#pb-excel-overlay, .pb-overlay').count();
    check(name('overlay opened (root element present)'), overlayVisible > 0);
    if (!overlayVisible) return;

    const getCell = (rowIndex, fieldCode) => page.locator(`.pb-overlay__cell input[data-field-code="${fieldCode}"][data-row-index="${rowIndex}"]`);
    const cellClasses = async (rowIndex, fieldCode) => getCell(rowIndex, fieldCode).evaluate((el) => Array.from(el.closest('.pb-overlay__cell')?.classList || []));
    const anchor = () => page.locator('.pb-overlay__lookup-anchor');
    const regularItems = () => anchor().locator('.pb-newrec__lookup-item:not(.pb-newrec__lookup-item--frequent)');
    const frequentItems = () => anchor().locator('.pb-newrec__lookup-item--frequent');
    const lookupCalls = () => page.evaluate(() => window.__lookupCalls);
    const toastTexts = () => page.locator('.pb-overlay__toast').allTextContents();

    // 行rowIndexの「案件名」セルから商品セルへ移動し、Enterで編集開始する
    // (overlay-lookup-grid.test.mjs等と同じ理由でdblclickではなくクリック→ArrowRightを使う)
    async function beginEdit(rowIndex) {
      await getCell(rowIndex, '案件名').click();
      await page.waitForTimeout(100);
      await page.keyboard.press('ArrowRight');
      await page.waitForTimeout(100);
      await getCell(rowIndex, '商品').press('Enter');
      await page.waitForTimeout(150);
    }

    // ArrowDownを押して候補ブラウズを開き、ハイライトが「頻出セクションを抜けて
    // 通常候補(参照先レコード由来)に達する」まで押し続ける。frequentCountに依存しない
    // 堅牢な実装(このアプリの頻出値は1件だけの想定だが決め打ちしない)
    async function moveHighlightToFirstRegular(rowIndex) {
      await getCell(rowIndex, '商品').press('ArrowDown'); // オープン(この1回はハイライトなし)
      await page.waitForTimeout(150);
      for (let i = 0; i < 12; i++) {
        const isFrequent = await anchor().locator('.pb-newrec__lookup-item--active')
          .evaluate((el) => el.classList.contains('pb-newrec__lookup-item--frequent'), { timeout: 2000 }).catch(() => null);
        if (isFrequent === false) return true;
        await getCell(rowIndex, '商品').press('ArrowDown');
        await page.waitForTimeout(100);
      }
      return false;
    }

    // ── 事前確認: 頻出セクションは601(商品004)由来の1件のみ ──
    await beginEdit(1); // row1=602(空)
    await getCell(1, '商品').press('ArrowDown');
    await page.waitForTimeout(300);
    check(name('前提: 頻出候補は601(商品004)由来の1件のみ'), await frequentItems().count() === 1);
    check(name('前提: 通常候補(参照先レコード)は4件'), await regularItems().count() === 4);
    await getCell(1, '商品').press('Escape');
    await page.waitForTimeout(100);
    await getCell(1, '商品').press('Escape');
    await page.waitForTimeout(100);

    // ── ① 候補ピッカーから参照先レコードを選択(source='record') → 照合不要で即・緑 ──
    const callsBeforeRecordPick = (await lookupCalls()).length;
    await beginEdit(1); // row1=602
    const reachedRegular = await moveHighlightToFirstRegular(1);
    check(name('①: ハイライトが通常候補(参照先レコード)まで到達'), reachedRegular);
    const pickedValue = await anchor().locator('.pb-newrec__lookup-item--active .pb-newrec__lookup-item-main').textContent();
    await getCell(1, '商品').press('Enter');
    await page.waitForTimeout(250);
    check(name('①: Enterでハイライトした候補がセルに入る'), (await getCell(1, '商品').inputValue()) === pickedValue);
    check(name('①: 候補ピッカーから選択 → 即座に--lookup-okが付く(照合不要)'), (await cellClasses(1, '商品')).includes('pb-overlay__cell--lookup-ok'));
    check(name('①: --lookup-warnは付かない'), !(await cellClasses(1, '商品')).includes('pb-overlay__cell--lookup-warn'));
    const callsAfterRecordPick = (await lookupCalls()).length;
    check(name('①: 追加のAPI呼び出しなし(候補取得分のみ。参照先レコードそのものなので照合しない)'), callsAfterRecordPick === callsBeforeRecordPick);
    await getCell(1, '商品').press('Escape');
    await page.waitForTimeout(150);

    // ── ② 頻出候補から選択(source='frequent') → 非同期照合してlookup-ok ──
    const callsBeforeFrequentPick = (await lookupCalls()).length;
    await beginEdit(2); // row2=603
    await page.waitForTimeout(150);
    await getCell(2, '商品').press('ArrowDown'); // オープン
    await page.waitForTimeout(400);
    await getCell(2, '商品').press('ArrowDown'); // 頻出(商品004)をハイライト(頻出は1件のみ)
    await page.waitForTimeout(150);
    const freqActiveIsFrequent = await anchor().locator('.pb-newrec__lookup-item--active')
      .evaluate((el) => el.classList.contains('pb-newrec__lookup-item--frequent'), { timeout: 3000 }).catch(() => null);
    check(name('②: ↓↓でハイライトが頻出候補になる'), freqActiveIsFrequent);
    await getCell(2, '商品').press('Enter');
    await page.waitForTimeout(400); // 非同期照合の完了待ち
    check(name('②: 頻出候補(商品004)がセルに入る'), (await getCell(2, '商品').inputValue()) === '商品004');
    check(name('②: 頻出候補から選択 → 非同期照合の結果--lookup-okが付く'), (await cellClasses(2, '商品')).includes('pb-overlay__cell--lookup-ok'));
    const callsAfterFrequentPick = (await lookupCalls()).length;
    check(name('②: ベースキャッシュ利用でAPI呼び出しは増えない'), callsAfterFrequentPick === callsBeforeFrequentPick);
    await getCell(2, '商品').press('Escape');
    await page.waitForTimeout(150);

    // ── ③ 手打ちで実在する値を入力してEnterで確定 → 非同期照合してlookup-ok ──
    const callsBeforeTypedOk = (await lookupCalls()).length;
    await beginEdit(3); // row3=604
    await getCell(3, '商品').type('商品003', { delay: 20 });
    await page.waitForTimeout(300);
    check(name('③: 入力中(コミット前)はまだマークが付かない'), (await cellClasses(3, '商品')).includes('pb-overlay__cell--lookup-ok') === false
      && (await cellClasses(3, '商品')).includes('pb-overlay__cell--lookup-warn') === false);
    // 候補が開いている状態のEnterは候補確定に化けるため、まず候補を閉じてからEnterでセル確定する
    await getCell(3, '商品').press('Escape');
    await page.waitForTimeout(100);
    await getCell(3, '商品').press('Enter'); // セル編集終了(下のセルへ移動) = moveEditingFocus経由
    await page.waitForTimeout(400);
    check(name('③: 手打ちで実在する値を入力してEnterで確定 → --lookup-okが付く'), (await cellClasses(3, '商品')).includes('pb-overlay__cell--lookup-ok'));
    const callsAfterTypedOk = (await lookupCalls()).length;
    check(name('③: ベースキャッシュ利用でAPI呼び出しは増えない'), callsAfterTypedOk === callsBeforeTypedOk);
    // (Enterでの下移動により編集がrow4に移っている可能性があるが、次のbeginEdit(4)の
    // 案件名クリックがblur経由で片付けてくれるので明示的な後始末は不要。
    // page全体へのEscapeはこの時点でeditingCellが既にnullだと「未保存の変更で閉じる確認」
    // にエスケープしてしまう事故があったため送らない)

    // ── ④ 手打ちで実在しない値を入力して別セルをクリック → --lookup-warn(赤) ──
    await beginEdit(4); // row4=605
    await getCell(4, '商品').type('存在しない商品X', { delay: 20 });
    await page.waitForTimeout(300);
    await getCell(4, '商品').press('Escape'); // 候補を閉じる(残っていれば)
    await page.waitForTimeout(100);
    await getCell(0, '案件名').click(); // 別セルをクリックしてセル編集を終える
    await page.waitForTimeout(400);
    check(name('④: 手打ちで実在しない値を入力して別セルクリックで確定 → --lookup-warnが付く'), (await cellClasses(4, '商品')).includes('pb-overlay__cell--lookup-warn'));
    check(name('④: --lookup-okは付かない'), !(await cellClasses(4, '商品')).includes('pb-overlay__cell--lookup-ok'));

    // ── ⑤ 色の確認: --lookup-warnの背景色がアンバーでなく#fee2e2(赤系)であること ──
    const warnBg = await getCell(4, '商品').evaluate((el) => getComputedStyle(el.closest('.pb-overlay__cell')).backgroundColor);
    check(name('⑤: --lookup-warnの背景色は rgb(254, 226, 226) (#fee2e2)'), warnBg === 'rgb(254, 226, 226)');

    // ── ⑥ 個別確定でトーストが出ないこと(貼り付けのサマリトーストのみ許容) ──
    const toastsAfterIndividualConfirms = await toastTexts();
    check(name('⑥: 個別確定(ピッカー/頻出/手打ち)ではトーストが出ない'), toastsAfterIndividualConfirms.length === 0);

    // ── ⑦ 元の値のまま編集を終了 → マークが付かない(601: 商品004は既存値のまま) ──
    const callsBeforeUnchangedEdit = (await lookupCalls()).length;
    await beginEdit(0); // row0=601(商品004のまま)
    await getCell(0, '商品').press('Escape'); // 何も変更せず編集終了
    await page.waitForTimeout(300);
    check(name('⑦: 元の値のまま編集を終了 → --lookup-okも--lookup-warnも付かない'), (await cellClasses(0, '商品')).includes('pb-overlay__cell--lookup-ok') === false
      && (await cellClasses(0, '商品')).includes('pb-overlay__cell--lookup-warn') === false);
    const callsAfterUnchangedEdit = (await lookupCalls()).length;
    check(name('⑦: 元の値のまま編集を終了してもAPI呼び出しは増えない(照合そのものが起きない)'), callsAfterUnchangedEdit === callsBeforeUnchangedEdit);

    // ── ⑧ マーク付きセル(④のwarnセル)を再編集して値を書き換える → マークが消える ──
    // (クリア条件は「そのセルの値が実際に変わったonInputChanged」なので、単に編集を
    // 開始しただけでは消えない。値を書き換えて初めて消える。セクション③の
    // 「入力中(コミット前)はまだマークが付かない」と同じ仕組みがwarn側でも効くことを確認する)
    const callsBeforeReedit = (await lookupCalls()).length;
    await beginEdit(4);
    await page.waitForTimeout(150);
    await getCell(4, '商品').press('End');
    await getCell(4, '商品').type('Y', { delay: 20 });
    // この行は再編集(2回目)のセッションなのでfullLocalキャッシュがまだ無く、
    // 候補検索のデバウンスが300ms(fullLocal時100msより長い)。ピッカーの実オープンを
    // 待ってからEscapeしないと「まだ開いていない」→1回目のEscapeがcandidate-close
    // ではなくセル編集終了に化けてしまう(2回目のEscapeがオーバーレイを閉じる方に
    // 抜けてしまう事故につながる)
    await page.waitForTimeout(500);
    check(name('⑧: マーク付きセルを再編集して値を書き換えると--lookup-warnが即座に消える'), !(await cellClasses(4, '商品')).includes('pb-overlay__cell--lookup-warn'));
    await getCell(4, '商品').press('Escape'); // 候補を閉じる
    await page.waitForTimeout(150);
    await getCell(4, '商品').press('Escape'); // 編集終了(新しい値の非同期照合が走る)
    await page.waitForTimeout(300);
    const callsAfterReedit = (await lookupCalls()).length;
    check(name('⑧: 再編集後の照合もベースキャッシュ利用でAPI呼び出しは増えない'), callsAfterReedit === callsBeforeReedit);

    // ── ⑨ 保存 → マーク全クリア＆保存はブロックされない ──
    // ④の再編集セルはonInputChangedでマークが消えているが値自体は「存在しない商品X」の
    // ままdirty(保存はブロックしない仕様)。①③のlookup-okセルも含めてまとめて保存する
    await page.evaluate(() => { window.__putCalls.length = 0; });
    const saveBtn = page.locator('.pb-overlay__btn--primary', { hasText: /保存|Save/ });
    await saveBtn.click();
    await page.waitForTimeout(700);
    const putCallsAfterSave = await page.evaluate(() => window.__putCalls);
    check(name('⑨: warn/okセルが残っていても保存クリックでEXCEL_PUT_RECORDSが飛ぶ(ブロックされない)'), putCallsAfterSave.length > 0);
    await page.waitForTimeout(500); // reload完了待ち
    const anyMarkAfterSave = await page.evaluate(() => Array.from(document.querySelectorAll('.pb-overlay__cell'))
      .some((el) => el.classList.contains('pb-overlay__cell--lookup-ok') || el.classList.contains('pb-overlay__cell--lookup-warn')));
    check(name('⑨: 保存後はlookup-ok/lookup-warnが全クリアされる'), !anyMarkAfterSave);
  } finally {
    await ctx.close();
  }
}
