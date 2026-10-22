// 3.4.0: 一覧(Grid Edit overlay)の仮想化を「行の使い回し」に書き換えたことのE2E検証。
// updateVirtualRows(force=false)が、範囲に入った行だけ新規に作り、出た行だけ外す
// (残る行の要素は一切触らない)ことを確認する。rowHeight=32px・buffer=6・VIRTUAL_CHUNK=8
// (content-overlay-controller.js先頭近く)の計算から、scrollTop=448pxにすると必ず
// virtualStart=8になる(floor(448/32)-6=8, floor(8/8)*8=8)ため、これを使って
// 「行8未満は外れる・行8以上は残る」を決定的に作り出す。
import { openOverlay, cell as mainCell } from './helpers/overlay-page.mjs';

const ROWS = 400;
const SCROLL_TOP_FOR_START8 = 448; // start=8になる決定的なscrollTop

function numRecords(count) {
  return Array.from({ length: count }, (_, i) => ({
    $id: { value: String(i + 1) }, $revision: { value: '1' },
    N: { value: String(i) }
  }));
}

// 昇順ソートで観測可能な並び替えが起きるように、N値を元のid順と逆にする
function reversedRecords(count) {
  return Array.from({ length: count }, (_, i) => ({
    $id: { value: String(i + 1) }, $revision: { value: '1' },
    N: { value: String(count - i) }
  }));
}

const N_FIELDS = [{ code: 'N', label: 'N', type: 'NUMBER', required: false, choices: [] }];

const LOOKUP_FIELDS = [
  { code: 'N', label: 'N', type: 'NUMBER', required: false, choices: [] },
  {
    code: '商品', label: '商品', type: 'SINGLE_LINE_TEXT', required: false, choices: [],
    lookup: { relatedApp: { app: '88' }, relatedKeyField: '商品名', lookupPickerFields: ['商品名'], fieldMappings: [] }
  }
];
function lookupRecords(count) {
  return Array.from({ length: count }, (_, i) => ({
    $id: { value: String(i + 1) }, $revision: { value: '1' },
    N: { value: String(i) }, 商品: { value: `P${i}` }
  }));
}

function buildBridge(fields, records) {
  return `
const RECORDS = ${JSON.stringify(records)};
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
  if (type === 'EXCEL_GET_LOOKUP_CANDIDATES') return reply({ ok: true, result: { records: [], totalCount: 0 } });
  if (type === 'EXCEL_GET_LOGIN_USER') return reply({ ok: true, user: { timezone: 'Asia/Tokyo' } });
  if (type === 'GET_APP_NAME') return reply({ ok: true, name: '受注管理' });
  if (type === 'EXCEL_GET_APP_ACL' || type === 'EXCEL_GET_RECORD_ACL' || type === 'EXCEL_GET_FIELD_ACL' || type === 'EXCEL_GET_VIEWS') return reply({ ok: true, result: {} });
  reply({ ok: false });
});`;
}

async function getScrollBox(page, selector) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    const r = el.getBoundingClientRect();
    return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
  }, selector);
}

async function setScrollTop(page, selector, top) {
  await page.evaluate(({ sel, top: t }) => {
    document.querySelector(sel).scrollTop = t;
  }, { sel: selector, top });
}

async function renderedRowIndices(page, fieldCode) {
  return page.evaluate((code) => {
    const set = new Set();
    document.querySelectorAll(`.pb-overlay__cell input[data-field-code="${code}"]`).forEach((el) => {
      set.add(Number(el.dataset.rowIndex));
    });
    return Array.from(set).sort((a, b) => a - b);
  }, fieldCode);
}

async function markAllRendered(page, fieldCode) {
  await page.evaluate((code) => {
    document.querySelectorAll(`.pb-overlay__cell input[data-field-code="${code}"]`).forEach((el) => {
      el.dataset.pbMark = '1';
    });
  }, fieldCode);
}

async function isMarked(page, fieldCode, rowIndex) {
  return page.evaluate(({ code, idx }) => {
    const el = document.querySelector(`.pb-overlay__cell input[data-field-code="${code}"][data-row-index="${idx}"]`);
    return Boolean(el && el.dataset.pbMark === '1');
  }, { code: fieldCode, idx: rowIndex });
}

async function rowExists(page, fieldCode, rowIndex) {
  return page.evaluate(({ code, idx }) => Boolean(document.querySelector(`.pb-overlay__cell input[data-field-code="${code}"][data-row-index="${idx}"]`)), { code: fieldCode, idx: rowIndex });
}

async function toggleDeleteForRow(page, rowIndex) {
  return page.evaluate((idx) => {
    const headers = document.querySelectorAll('.pb-overlay__row-header');
    for (const h of headers) {
      const idxEl = h.querySelector('.pb-overlay__row-index');
      if (idxEl && Number(idxEl.textContent) === idx + 1) {
        h.querySelector('.pb-overlay__row-delete').click();
        return true;
      }
    }
    return false;
  }, rowIndex);
}

async function pendingDeleteVisual(page, fieldCode, rowIndex) {
  return page.evaluate(({ code, idx }) => {
    const headers = document.querySelectorAll('.pb-overlay__row-header');
    let header = null;
    for (const h of headers) {
      const idxEl = h.querySelector('.pb-overlay__row-index');
      if (idxEl && Number(idxEl.textContent) === idx + 1) { header = h; break; }
    }
    const input = document.querySelector(`.pb-overlay__cell input[data-field-code="${code}"][data-row-index="${idx}"]`);
    const rowLine = input ? input.closest('.pb-overlay__row') : null;
    return {
      headerFound: Boolean(header),
      headerPending: Boolean(header && header.classList.contains('pb-overlay__row-header--pending-delete')),
      rowFound: Boolean(rowLine),
      rowPending: Boolean(rowLine && rowLine.classList.contains('pb-overlay__row--pending-delete')),
      deleteBtnPending: Boolean(header && header.querySelector('.pb-overlay__row-delete')?.classList.contains('is-pending'))
    };
  }, { code: fieldCode, idx: rowIndex });
}

export async function run({ browser, check }) {
  const name = (n) => `grid-row-recycle-e2e: ${n}`;

  // ================================================================
  // (a) スクロールで入った行だけが新規に作られ、残る行の要素は同一(===)のまま
  // ================================================================
  {
    const { ctx, page } = await openOverlay({ browser, bridgeScript: buildBridge(N_FIELDS, numRecords(ROWS)) });
    try {
      const before = await renderedRowIndices(page, 'N');
      check(name('(a) 前提: 初期表示は仮想化されている(全件は描画されない)'), before.length > 0 && before.length < ROWS);

      await markAllRendered(page, 'N');

      const box = await getScrollBox(page, '.pb-overlay__cell-scroll');
      await setScrollTop(page, '.pb-overlay__cell-scroll', Math.round(box.height));
      await page.waitForTimeout(200);

      const after = await renderedRowIndices(page, 'N');
      const beforeSet = new Set(before);
      const afterSet = new Set(after);
      const stayed = after.filter((r) => beforeSet.has(r));
      const entered = after.filter((r) => !beforeSet.has(r));
      const left = before.filter((r) => !afterSet.has(r));
      check(name('(a) 前提: スクロールで残る行・入った行・出た行がそれぞれ生じる'), stayed.length > 0 && entered.length > 0 && left.length > 0);

      let stayedAllMarked = true;
      for (const r of stayed) {
        if (!(await isMarked(page, 'N', r))) { stayedAllMarked = false; break; }
      }
      check(name('(a) 残る行の要素は同一のまま(印が付いている=作り直されていない)'), stayedAllMarked);

      let enteredAllFresh = true;
      for (const r of entered) {
        if (await isMarked(page, 'N', r)) { enteredAllFresh = false; break; }
      }
      check(name('(a) 入った行は新規に作られた(印が無い)'), enteredAllFresh);

      let leftAllGone = true;
      for (const r of left) {
        if (await rowExists(page, 'N', r)) { leftAllGone = false; break; }
      }
      check(name('(a) 出た行はDOMから外れている'), leftAllGone);
    } finally {
      await ctx.close();
    }
  }

  // ================================================================
  // (b) 編集中のセルが、スクロールで範囲内に残る間はフォーカスと入力中の値が保たれる
  // ================================================================
  {
    const { ctx, page } = await openOverlay({ browser, bridgeScript: buildBridge(N_FIELDS, numRecords(ROWS)) });
    try {
      const editRow = 10; // scrollTop=448後もstart=8なので残る(10>=8)
      await mainCell(page, editRow, 'N').dblclick();
      await page.waitForTimeout(150);
      const editInput = mainCell(page, editRow, 'N');
      check(name('(b) 前提: 編集モードに入る'), await editInput.evaluate((el) => !el.readOnly));
      await editInput.evaluate((el) => { el.dataset.pbMark = '1'; });

      await page.keyboard.press('Control+a');
      await page.keyboard.type('999', { delay: 15 });
      await page.waitForTimeout(100);
      check(name('(b) 前提: 入力中の値が999になる'), (await editInput.inputValue()) === '999');
      check(name('(b) 前提: フォーカスがある'), await editInput.evaluate((el) => el === document.activeElement));

      await setScrollTop(page, '.pb-overlay__cell-scroll', SCROLL_TOP_FOR_START8);
      await page.waitForTimeout(150);

      const stillThere = mainCell(page, editRow, 'N');
      check(name('(b) スクロール後も行が範囲内に残る'), (await stillThere.count()) === 1);
      check(name('(b) 残る行は同一要素のまま(印が付いている)'), await stillThere.evaluate((el) => el.dataset.pbMark === '1'));
      check(name('(b) スクロール後もフォーカスが保たれる'), await stillThere.evaluate((el) => el === document.activeElement));
      check(name('(b) スクロール後も入力中の値999が保たれる'), (await stillThere.inputValue()) === '999');
    } finally {
      await ctx.close();
    }
  }

  // ================================================================
  // (c) ルックアップ候補ピッカーを開いたままスクロールしても壊れない。
  //     残る行なら開いたまま・外れる行なら閉じる・エラーが出ない
  // ================================================================
  {
    const { ctx, page, errors } = await openOverlay({ browser, bridgeScript: buildBridge(LOOKUP_FIELDS, lookupRecords(ROWS)) });
    try {
      const stayRow = 10; // scrollTop=448後も残る
      await mainCell(page, stayRow, '商品').dblclick();
      await page.waitForTimeout(200);
      check(name('(c1) 前提: ピッカーが開く'), (await page.locator('.pb-overlay__lookup-anchor').count()) === 1);

      await setScrollTop(page, '.pb-overlay__cell-scroll', SCROLL_TOP_FOR_START8);
      await page.waitForTimeout(200);
      check(name('(c1) 残る行ならスクロール後もピッカーが開いたまま'), (await page.locator('.pb-overlay__lookup-anchor').count()) === 1);
      check(name('(c1) エラーが出ない'), errors.length === 0);
    } finally {
      await ctx.close();
    }
  }
  {
    const { ctx, page, errors } = await openOverlay({ browser, bridgeScript: buildBridge(LOOKUP_FIELDS, lookupRecords(ROWS)) });
    try {
      const leaveRow = 2; // scrollTop=448後は外れる(2<8)
      await mainCell(page, leaveRow, '商品').dblclick();
      await page.waitForTimeout(200);
      check(name('(c2) 前提: ピッカーが開く'), (await page.locator('.pb-overlay__lookup-anchor').count()) === 1);

      await setScrollTop(page, '.pb-overlay__cell-scroll', SCROLL_TOP_FOR_START8);
      await page.waitForTimeout(200);
      check(name('(c2) 外れる行ならスクロールでピッカーが閉じる'), (await page.locator('.pb-overlay__lookup-anchor').count()) === 0);
      check(name('(c2) エラーが出ない'), errors.length === 0);
    } finally {
      await ctx.close();
    }
  }

  // ================================================================
  // (d) 削除予定の行が、スクロールで外れて戻ってきても、残っていても、見た目を保つ
  // ================================================================
  {
    const { ctx, page } = await openOverlay({ browser, bridgeScript: buildBridge(N_FIELDS, numRecords(ROWS)) });
    try {
      const leaveRow = 5; // scrollTop=448で外れる(5<8)
      const stayRow = 15; // scrollTop=448でも残る(15>=8)
      const did5 = await toggleDeleteForRow(page, leaveRow);
      const did15 = await toggleDeleteForRow(page, stayRow);
      check(name('(d) 前提: 行5・15の削除予定トグルに成功'), did5 && did15);
      await page.waitForTimeout(100);

      let v5 = await pendingDeleteVisual(page, 'N', leaveRow);
      let v15 = await pendingDeleteVisual(page, 'N', stayRow);
      check(name('(d) 前提: トグル直後は行5・15とも削除予定の見た目'),
        v5.headerPending && v5.rowPending && v15.headerPending && v15.rowPending);

      await setScrollTop(page, '.pb-overlay__cell-scroll', SCROLL_TOP_FOR_START8);
      await page.waitForTimeout(150);

      check(name('(d) 前提: 外れた行(5)はDOMから無くなっている'), !(await rowExists(page, 'N', leaveRow)));
      v15 = await pendingDeleteVisual(page, 'N', stayRow);
      check(name('(d) 残る行(15)はスクロール後も削除予定の見た目を保つ'),
        v15.headerPending && v15.rowPending && v15.deleteBtnPending);

      await setScrollTop(page, '.pb-overlay__cell-scroll', 0);
      await page.waitForTimeout(150);

      v5 = await pendingDeleteVisual(page, 'N', leaveRow);
      check(name('(d) 外れて戻ってきた行(5)も削除予定の見た目を保つ'),
        v5.headerFound && v5.headerPending && v5.rowPending && v5.deleteBtnPending);
      v15 = await pendingDeleteVisual(page, 'N', stayRow);
      check(name('(d) 行(15)は往復後も削除予定の見た目を保つ'),
        v15.headerPending && v15.rowPending && v15.deleteBtnPending);
    } finally {
      await ctx.close();
    }
  }

  // ================================================================
  // (e) 列幅変更・ソートの後は正しく描き直る(セルの値と列幅が合う。スクロールで
  //     新規に作られる行にも新しい列幅・ソート後の値が正しく反映される)
  // ================================================================
  {
    const { ctx, page } = await openOverlay({ browser, bridgeScript: buildBridge(N_FIELDS, reversedRecords(ROWS)) });
    try {
      // ソート前: 先頭行(id=1)のN値はROWS(最大)
      check(name('(e) 前提: ソート前の先頭行はN=ROWS'), (await mainCell(page, 0, 'N').inputValue()) === String(ROWS));

      // 昇順ソート(1クリックでasc)
      await page.locator('.pb-overlay__col-header-main').first().click();
      await page.waitForTimeout(200);
      check(name('(e) ソート後: 先頭行はN=1(最小)'), (await mainCell(page, 0, 'N').inputValue()) === '1');
      check(name('(e) ソート後: 2番目の行はN=2'), (await mainCell(page, 1, 'N').inputValue()) === '2');

      // 列幅変更: ツール→列順パネルを開き、リサイズハンドルをドラッグして+80px
      await page.locator('.pb-overlay__tool-menu-toggle').click();
      await page.waitForTimeout(150);
      await page.locator('.pb-overlay__tool-menu-item', { hasText: /列順|Columns/ }).click();
      await page.waitForTimeout(200);
      const resizer = page.locator('.pb-overlay__column-chip[data-code="N"] .pb-overlay__column-chip-resizer');
      const rbox = await resizer.boundingBox();
      await page.mouse.move(rbox.x + rbox.width / 2, rbox.y + rbox.height / 2);
      await page.mouse.down();
      await page.mouse.move(rbox.x + rbox.width / 2 + 80, rbox.y + rbox.height / 2, { steps: 5 });
      await page.mouse.up();
      await page.waitForTimeout(150);
      await page.locator('.pb-overlay__column-close').click();
      await page.waitForTimeout(150);

      const newWidth = await page.locator('.pb-overlay__col-header').first().evaluate((el) => el.style.width);
      check(name('(e) 列幅変更が反映される(既定160pxより広い)'), parseInt(newWidth, 10) > 160);

      const oldRowWidth = await mainCell(page, 0, 'N').evaluate((el) => el.parentElement.style.width);
      check(name('(e) 列幅変更: 既に描画済みの行にも新しい幅が反映される'), oldRowWidth === newWidth);

      // スクロールして新規に作られる行にも、ソート後の値と新しい列幅が正しく反映されるか確認
      await setScrollTop(page, '.pb-overlay__cell-scroll', SCROLL_TOP_FOR_START8);
      await page.waitForTimeout(150);
      check(name('(e) スクロールで新規に作られた行の値もソート順と一致する(行8→N=9)'),
        (await mainCell(page, 8, 'N').inputValue()) === '9');
      const newRowWidth = await mainCell(page, 8, 'N').evaluate((el) => el.parentElement.style.width);
      check(name('(e) スクロールで新規に作られた行にも新しい列幅が反映される'), newRowWidth === newWidth);
    } finally {
      await ctx.close();
    }
  }
}
