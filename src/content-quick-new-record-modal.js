// content-quick-new-record-modal.js
// content.js から抽出された Quick New Record Modal セクションです。
// content script として単体で読み込まれることは想定しておらず、
// scripts/build.mjs が content.js 内の @@INCLUDE マーカー位置へビルド時に
// テキストとしてそのまま埋め込みます(実行時のスコープ・挙動は分割前と完全に同一)。
// @@BODY_START
  // ── Quick New Record Modal ───────────────────────────────────────────────

  const NON_EDITABLE_QNR_TYPES = new Set([
    'RECORD_NUMBER', 'CREATED_TIME', 'UPDATED_TIME', 'CREATOR', 'MODIFIER',
    'STATUS', 'STATUS_ASSIGNEE', 'CALC', 'REFERENCE_TABLE', 'RICH_TEXT',
    'SUBTABLE', 'FILE'
  ]);

  // kintone標準UIのレコード追加ではサブテーブルに必ず空行が1行できる。
  // 0行で登録するとサブテーブル値を参照する計算フィールド
  // （SUM(テーブル.金額) など）がエラーになるため、標準UIと同じく
  // 空行を1行含めて送信する。行内の各列にはkintone側の初期値が適用される。
  // ただし「必須かつ初期値なし」の列を持つテーブルは、空行を送ると
  // 保存自体が失敗するため従来どおり0行のままにする。
  function qnrAppendEmptySubtableRows(record, fields) {
    if (!record || !fields || typeof fields.forEach !== 'function') return;
    fields.forEach((field) => {
      if (String(field?.type || '').toUpperCase() !== 'SUBTABLE') return;
      if (!field.code || record[field.code] !== undefined) return;
      const columns = Array.isArray(field.subtable?.fields) ? field.subtable.fields : [];
      const hasBlockingRequired = columns.some((col) => {
        if (!col?.required) return false;
        if (col.defaultNowValue) return false;
        const dv = col.defaultValue;
        if (dv === undefined || dv === null) return true;
        return Array.isArray(dv) ? dv.length === 0 : String(dv) === '';
      });
      if (hasBlockingRequired) return;
      record[field.code] = { value: [{ value: {} }] };
    });
  }

  // 数値フィールド向けの入力正規化。全角数字・全角記号を半角化し、
  // 桁区切りカンマを除去する（"１，０００" → "1000"）。
  function qnrNormalizeNumberText(raw) {
    let text = String(raw ?? '').trim();
    if (!text) return '';
    text = text.replace(/[０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0));
    text = text.replace(/．/g, '.').replace(/[－ー−]/g, '-').replace(/＋/g, '+');
    text = text.replace(/[,，\s]/g, '');
    return text;
  }

  class QuickNewRecordModal {
    constructor(postFn) {
      this.postFn = postFn;
      this.el = null;
      this.kintoneTimezone = _browserTz;
      this._language = DEFAULT_OVERLAY_LANGUAGE;
      this._listUrl = '';
      this._fieldInputMap = null;
      this._dirtySnapshot = '';
      this._confirmEl = null;
      this._savedAny = false;
      this._triggerSave = null;
      this._triggerSaveNext = null;
    }

    isVisible() { return Boolean(this.el); }

    close(options = {}) {
      if (this._confirmEl) { this._confirmEl.remove(); this._confirmEl = null; }
      if (this.el) { this.el.remove(); this.el = null; }
      const needReload = this._savedAny && !options.skipReload;
      const listUrl = this._listUrl;
      this._savedAny = false;
      this._fieldInputMap = null;
      this._dirtySnapshot = '';
      this._triggerSave = null;
      this._triggerSaveNext = null;
      // 「保存して次へ」で保存済みのまま閉じた場合は、一覧に反映するためリロード
      if (needReload && listUrl) this._reloadList(listUrl);
    }

    // ユーザー操作によるクローズ（背景クリック/Esc/✕/キャンセル）。
    // 未保存の入力がある場合は破棄確認を挟む。
    async requestClose() {
      if (!this.el) return;
      if (this._isDirty()) {
        const ok = await this._confirmDiscard();
        if (!ok) return;
      }
      this.close();
    }

    _snapshotValues() {
      if (!this._fieldInputMap) return '';
      const values = {};
      this._fieldInputMap.forEach(({ field, getValue }) => {
        values[field.code] = getValue();
      });
      try {
        return JSON.stringify(values);
      } catch (_e) {
        return '';
      }
    }

    _isDirty() {
      if (!this._fieldInputMap) return false;
      return this._snapshotValues() !== this._dirtySnapshot;
    }

    // 未保存入力の破棄確認。overlay.css の確認モーダルスタイルを流用する。
    _confirmDiscard() {
      return new Promise((resolve) => {
        if (!this.el || this._confirmEl) { resolve(true); return; }
        const t = (key) => resolveText(this._language, key);
        const layer = document.createElement('div');
        layer.className = 'pb-overlay__confirm-layer';
        const card = document.createElement('div');
        card.className = 'pb-overlay__confirm-card';
        card.setAttribute('role', 'alertdialog');
        card.setAttribute('aria-modal', 'true');
        const text = document.createElement('p');
        text.className = 'pb-overlay__confirm-message';
        text.textContent = t('newRecordDiscardConfirm');
        const actions = document.createElement('div');
        actions.className = 'pb-overlay__confirm-actions';
        const cancelBtn = document.createElement('button');
        cancelBtn.type = 'button';
        cancelBtn.className = 'pb-overlay__upsell-btn';
        cancelBtn.textContent = t('confirmCancel');
        const okBtn = document.createElement('button');
        okBtn.type = 'button';
        okBtn.className = 'pb-overlay__upsell-btn pb-overlay__upsell-btn--primary pb-overlay__confirm-btn--danger';
        okBtn.textContent = t('newRecordDiscardAction');
        actions.append(cancelBtn, okBtn);
        card.append(text, actions);
        layer.appendChild(card);
        // 確認を閉じたらフォーカスをモーダル内へ戻す
        // （bodyに落ちるとEsc等のキーボード操作が届かなくなる）
        const prevFocus = document.activeElement;
        const finish = (result) => {
          if (this._confirmEl !== layer) return;
          this._confirmEl = null;
          layer.remove();
          if (!result) {
            try {
              if (prevFocus && prevFocus.isConnected && this.el?.contains(prevFocus)) {
                prevFocus.focus();
              } else {
                const fallback = this.el?.querySelector('.pb-newrec__body input:not([tabindex="-1"]), .pb-newrec__body textarea, .pb-newrec__body select');
                if (fallback) fallback.focus();
              }
            } catch (_e) { /* noop */ }
          }
          resolve(result);
        };
        layer.addEventListener('mousedown', (e) => {
          e.stopPropagation();
          if (e.target === layer) finish(false);
        });
        layer.addEventListener('keydown', (e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            finish(false);
            return;
          }
          if (e.key === 'Tab') {
            e.preventDefault();
            e.stopPropagation();
            (document.activeElement === okBtn ? cancelBtn : okBtn).focus();
          }
        });
        cancelBtn.addEventListener('click', () => finish(false));
        okBtn.addEventListener('click', () => finish(true));
        this._confirmEl = layer;
        this.el.appendChild(layer);
        try { okBtn.focus(); } catch (_e) { /* noop */ }
      });
    }

    // 一覧をスクロール位置を保ったままリロードする
    _reloadList(listUrl) {
      if (window.location.href === listUrl) {
        try {
          sessionStorage.setItem(QUICK_NEW_SCROLL_KEY, JSON.stringify({
            url: listUrl,
            y: Math.round(window.scrollY || 0),
            savedAt: Date.now()
          }));
        } catch (_e) { /* noop */ }
        window.location.reload();
      } else {
        window.location.href = listUrl;
      }
    }

    async open() {
      if (this.el) { void this.requestClose(); return; }
      const listCtx = parseListOverlayContext(location.href);
      if (!listCtx?.appId) return;
      const appId = listCtx.appId;
      const listUrl = listCtx.href;
      this._listUrl = listUrl;

      ensureOverlayCss();
      const { language } = await resolveOverlayUiLanguage();
      this._language = language;
      const t = (key) => resolveText(language, key);
      try {
        const userRes = await this.postFn('EXCEL_GET_LOGIN_USER');
        const timezone = String(userRes?.user?.timezone || '').trim();
        if (timezone) this.kintoneTimezone = timezone;
      } catch (_err) {
        this.kintoneTimezone = _browserTz;
      }

      // Loading backdrop
      const layer = this._buildLayer();
      const panel = document.createElement('div');
      panel.className = 'pb-newrec__panel';
      const loadingEl = document.createElement('div');
      loadingEl.className = 'pb-newrec__body';
      loadingEl.style.alignItems = 'center';
      loadingEl.style.justifyContent = 'center';
      loadingEl.style.minHeight = '80px';
      loadingEl.textContent = t('quickNewLoading');
      panel.appendChild(loadingEl);
      layer.appendChild(panel);
      document.body.appendChild(layer);
      this.el = layer;

      try {
        // Load fields
        const fieldsRes = await this.postFn('EXCEL_GET_FIELDS_META', { appId });
        const allFieldsMeta = (fieldsRes?.ok && Array.isArray(fieldsRes.fieldsMeta))
          ? fieldsRes.fieldsMeta
          : [];
        const allFieldsMap = new Map(allFieldsMeta.map((f) => [f.code, f]));

        // アプリ名（どのアプリに作成するかをヘッダーに明示する。失敗しても続行）
        let appName = '';
        try {
          const nameRes = await this.postFn('GET_APP_NAME', { appId, source: 'quick_new', __pbTrigger: 'quick_new_open' });
          if (nameRes?.ok) appName = String(nameRes.name || '').trim();
        } catch (_e) { /* noop */ }

        // Load layout presets
        const appKey = `${String(location.origin || '').trim()}::${appId}`;
        let presets = [];
        let activePresetId = '';
        try {
          const stored = await chrome.storage.local.get(OVERLAY_LAYOUT_PRESETS_KEY);
          const presetsMap = stored?.[OVERLAY_LAYOUT_PRESETS_KEY];
          const state = presetsMap && typeof presetsMap === 'object' ? presetsMap[appKey] : null;
          presets = Array.isArray(state?.presets) ? state.presets : [];
          activePresetId = String(state?.activePresetId || '').trim();
        } catch (_err) { /* use defaults */ }

        if (!presets.length) {
          // fallback: show all editable fields
          const fallback = allFieldsMeta.filter((f) => !NON_EDITABLE_QNR_TYPES.has(String(f.type || '').toUpperCase()) && !f.lookupAuto);
          presets = [{ id: 'default', name: t('layoutPresetDefault'), columnOrder: fallback.map((f) => f.code), visibleColumns: fallback.map((f) => f.code) }];
          activePresetId = 'default';
        }

        // Rebuild panel
        panel.innerHTML = '';
        this._buildContent(panel, appId, language, allFieldsMap, presets, activePresetId, listUrl, appName);
      } catch (err) {
        console.error('[kintone-excel-overlay] quick new record load failed', err);
        this.close();
      }
    }

    _buildLayer() {
      const layer = document.createElement('div');
      layer.className = 'pb-newrec__layer pb-newrec__layer--standalone';
      layer.setAttribute('role', 'dialog');
      layer.setAttribute('aria-modal', 'true');
      layer.addEventListener('mousedown', (e) => { if (e.target === layer) void this.requestClose(); });
      // Esc: 破棄確認つきで閉じる / Ctrl(⌘)+Enter: 保存 / +Shift: 保存して次へ
      layer.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
          if (this._confirmEl) return;
          e.preventDefault();
          e.stopPropagation();
          // ルックアップのドロップダウンが開いていれば、まずそれだけ閉じる
          const openPicker = layer.querySelector('.pb-newrec__lookup-picker');
          if (openPicker) {
            if (typeof openPicker.__pbClose === 'function') openPicker.__pbClose();
            else openPicker.remove();
            return;
          }
          void this.requestClose();
          return;
        }
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
          e.preventDefault();
          e.stopPropagation();
          if (e.shiftKey) {
            if (this._triggerSaveNext) this._triggerSaveNext();
          } else if (this._triggerSave) {
            this._triggerSave();
          }
        }
      });
      // フォーカストラップ: Tabはモーダル内でループさせる
      layer.addEventListener('keydown', (e) => {
        if (e.key !== 'Tab') return;
        const focusables = Array.from(layer.querySelectorAll(
          'button, input, select, textarea, [tabindex]:not([tabindex="-1"])'
        )).filter((el) => !el.disabled && el.offsetParent !== null);
        if (!focusables.length) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      });
      return layer;
    }

    _getFieldsForPreset(preset, allFieldsMap) {
      const visible = new Set(Array.isArray(preset.visibleColumns) ? preset.visibleColumns : []);
      const order = Array.isArray(preset.columnOrder) ? preset.columnOrder : [];
      const codes = order.filter((c) => visible.size === 0 || visible.has(c));

      const isLookupKey = (f) => !f.lookupAuto && (String(f.type || '').toUpperCase() === 'LOOKUP' || Boolean(f.lookup));

      // Build set of auto-fill destinations so we can inject them after their LOOKUP
      const lookupAutoSet = new Set();
      allFieldsMap.forEach((f) => {
        if (isLookupKey(f) && Array.isArray(f.lookup?.fieldMappings)) {
          f.lookup.fieldMappings.forEach((m) => { if (m.field) lookupAutoSet.add(m.field); });
        }
      });

      const result = [];
      const added = new Set();
      codes.forEach((code) => {
        const f = allFieldsMap.get(code);
        if (!f) return;
        const type = String(f.type || '').toUpperCase();
        if (NON_EDITABLE_QNR_TYPES.has(type)) return;
        if (lookupAutoSet.has(f.code)) return;
        if (f.lookupAuto) return;
        if (added.has(f.code)) return;
        result.push(f);
        added.add(f.code);
        if (isLookupKey(f) && Array.isArray(f.lookup?.fieldMappings)) {
          f.lookup.fieldMappings.forEach((m) => {
            const autoField = allFieldsMap.get(m.field);
            if (autoField && !added.has(m.field)) {
              result.push({ ...autoField, _isLookupAuto: true, _lookupSourceCode: f.code });
              added.add(m.field);
            }
          });
        }
      });
      return result;
    }

    _buildContent(panel, appId, language, allFieldsMap, presets, activePresetId, listUrl, appName = '') {
      const t = (key) => resolveText(language, key);

      // Header（アプリ名 + タイトル）
      const head = document.createElement('div');
      head.className = 'pb-newrec__head';
      const titleWrap = document.createElement('div');
      titleWrap.className = 'pb-newrec__title-wrap';
      if (appName) {
        const app = document.createElement('div');
        app.className = 'pb-newrec__app';
        app.textContent = appName;
        titleWrap.appendChild(app);
      }
      const title = document.createElement('div');
      title.className = 'pb-newrec__title';
      title.id = 'pb-newrec-title';
      title.textContent = t('newRecordTitle');
      titleWrap.appendChild(title);
      if (panel?.closest) {
        const layerEl = panel.closest('.pb-newrec__layer');
        if (layerEl) layerEl.setAttribute('aria-labelledby', 'pb-newrec-title');
      }
      const closeBtn = document.createElement('button');
      closeBtn.type = 'button';
      closeBtn.className = 'pb-newrec__close';
      closeBtn.innerHTML = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M18 6L6 18M6 6l12 12"/></svg>';
      closeBtn.setAttribute('aria-label', t('newRecordCancel'));
      closeBtn.addEventListener('click', () => { void this.requestClose(); });
      head.appendChild(titleWrap);
      head.appendChild(closeBtn);

      // Preset selector
      const presetRow = document.createElement('div');
      presetRow.className = 'pb-newrec__preset-row';
      const presetLabelEl = document.createElement('label');
      presetLabelEl.className = 'pb-newrec__preset-label';
      presetLabelEl.textContent = t('quickNewPresetLabel');
      const presetSelect = document.createElement('select');
      presetSelect.className = 'pb-newrec__select pb-newrec__preset-select';
      presets.forEach((p) => {
        const opt = document.createElement('option');
        opt.value = p.id;
        opt.textContent = p.name || p.id;
        opt.selected = p.id === activePresetId;
        presetSelect.appendChild(opt);
      });
      presetRow.appendChild(presetLabelEl);
      presetRow.appendChild(presetSelect);

      // Body (form fields)
      const body = document.createElement('div');
      body.className = 'pb-newrec__body';

      // Footer: [キャンセル] [保存して次へ] [保存]
      const foot = document.createElement('div');
      foot.className = 'pb-newrec__foot';
      const cancelBtn = document.createElement('button');
      cancelBtn.type = 'button';
      cancelBtn.className = 'pb-overlay__btn';
      cancelBtn.textContent = t('newRecordCancel');
      cancelBtn.addEventListener('click', () => { void this.requestClose(); });
      const saveNextBtn = document.createElement('button');
      saveNextBtn.type = 'button';
      saveNextBtn.className = 'pb-overlay__btn';
      saveNextBtn.textContent = t('newRecordSaveNext');
      saveNextBtn.title = 'Ctrl+Shift+Enter';
      const saveBtn = document.createElement('button');
      saveBtn.type = 'button';
      saveBtn.className = 'pb-overlay__btn pb-overlay__btn--primary';
      saveBtn.textContent = t('newRecordSave');
      saveBtn.title = 'Ctrl+Enter';
      foot.appendChild(cancelBtn);
      foot.appendChild(saveNextBtn);
      foot.appendChild(saveBtn);

      let fieldInputMap = new Map();
      const renderBody = (presetId) => {
        body.innerHTML = '';
        fieldInputMap = new Map();
        const preset = presets.find((p) => p.id === presetId) || presets[0];
        const fields = this._getFieldsForPreset(preset, allFieldsMap);
        if (!fields.length) {
          const empty = document.createElement('div');
          empty.className = 'pb-newrec__empty';
          empty.textContent = t('quickNewNoFields');
          body.appendChild(empty);
          return;
        }
        fields.forEach((field) => {
          const row = document.createElement('div');
          row.className = 'pb-newrec__field-row';
          const labelEl = document.createElement('label');
          labelEl.className = 'pb-newrec__label';
          const labelText = document.createElement('span');
          labelText.textContent = field.label || field.code;
          if (field.required) {
            const req = document.createElement('span');
            req.className = 'pb-newrec__required';
            req.textContent = ' *';
            labelText.appendChild(req);
          }
          labelEl.appendChild(labelText);
          const controlWrap = document.createElement('div');
          controlWrap.className = 'pb-newrec__control';
          const type = String(field.type || '').toUpperCase();
          let getValue;
          let setValue;

          if (field._isLookupAuto) {
            const input = document.createElement('input');
            input.type = 'text';
            input.className = 'pb-newrec__input pb-newrec__input--lookup-auto';
            input.readOnly = true;
            input.placeholder = '—';
            controlWrap.appendChild(input);
            getValue = () => input.value;
            setValue = (v) => { input.value = v; };
            row.classList.add('pb-newrec__field-row--lookup-auto');
          } else if (type === 'LOOKUP' || (!field._isLookupAuto && field.lookup)) {
            const wrap = document.createElement('div');
            wrap.className = 'pb-newrec__lookup-wrap';
            const input = document.createElement('input');
            input.type = 'text';
            input.className = 'pb-newrec__input';
            // 手打ち可: 値を覚えているユーザーは直接入力できる。
            // 妥当性は保存時にkintoneが検証し、コピー先も自動取得される
            input.placeholder = t('newRecordLookupManualPh');
            const searchBtn = document.createElement('button');
            searchBtn.type = 'button';
            searchBtn.className = 'pb-newrec__lookup-btn';
            searchBtn.textContent = '🔍';
            searchBtn.title = t('newRecordLookupPickTitle');
            wrap.appendChild(input);
            wrap.appendChild(searchBtn);
            controlWrap.appendChild(wrap);
            getValue = () => input.value;
            setValue = (v) => { input.value = v; };
            const lookupInfo = field.lookup || {};
            const relatedAppId = String(
              lookupInfo.relatedApp?.app || lookupInfo.relatedApp?.code || lookupInfo.relatedApp || ''
            ).trim();
            const relatedKeyField = String(lookupInfo.relatedKeyField || lookupInfo.keyField || '').trim();
            const pickerFields = Array.isArray(lookupInfo.lookupPickerFields) ? lookupInfo.lookupPickerFields : [];
            const mappings = Array.isArray(lookupInfo.fieldMappings) ? lookupInfo.fieldMappings : [];
            const lookupPicker = relatedAppId
              ? createNewRecordLookupPicker({
                anchorEl: wrap,
                relatedAppId,
                relatedKeyField,
                pickerFields,
                mappings,
                fieldInputMap,
                keyInput: input,
                postFn: this.postFn,
                language
              })
              : null;
            // 手打ち = インクリメンタル検索（デバウンスはピッカー内蔵）。
            // コピー先の表示は一旦クリアし、完全一致が見つかれば
            // インジケータ側で再度埋まる
            input.addEventListener('input', () => {
              mappings.forEach((m) => {
                const autoEntry = fieldInputMap.get(m.field);
                if (autoEntry?.setValue) autoEntry.setValue('');
              });
              if (lookupPicker) lookupPicker.search(input.value);
            });
            searchBtn.addEventListener('click', () => {
              if (lookupPicker) lookupPicker.browse();
            });
          } else if (type === 'MULTI_LINE_TEXT') {
            const ta = document.createElement('textarea');
            ta.className = 'pb-newrec__textarea';
            ta.rows = 3;
            controlWrap.appendChild(ta);
            getValue = () => ta.value;
            setValue = (v) => { ta.value = String(v ?? ''); };
          } else if (type === 'DROP_DOWN' || type === 'RADIO_BUTTON') {
            const sel = document.createElement('select');
            sel.className = 'pb-newrec__select';
            const empty = document.createElement('option');
            empty.value = '';
            empty.textContent = '';
            sel.appendChild(empty);
            (Array.isArray(field.choices) ? field.choices : []).forEach((c) => {
              const opt = document.createElement('option');
              opt.value = String(c || '');
              opt.textContent = String(c || '');
              sel.appendChild(opt);
            });
            controlWrap.appendChild(sel);
            getValue = () => sel.value;
            setValue = (v) => { sel.value = String(v ?? ''); };
          } else if (type === 'CHECK_BOX' || type === 'MULTI_SELECT') {
            const checkWrap = document.createElement('div');
            checkWrap.className = 'pb-newrec__checkgroup';
            const checkboxes = [];
            (Array.isArray(field.choices) ? field.choices : []).forEach((c) => {
              const item = document.createElement('label');
              item.className = 'pb-newrec__check-item';
              const cb = document.createElement('input');
              cb.type = 'checkbox';
              cb.value = String(c || '');
              checkboxes.push(cb);
              item.appendChild(cb);
              item.appendChild(document.createTextNode(String(c || '')));
              checkWrap.appendChild(item);
            });
            controlWrap.appendChild(checkWrap);
            getValue = () => checkboxes.filter((cb) => cb.checked).map((cb) => cb.value);
            setValue = (v) => {
              const selected = new Set((Array.isArray(v) ? v : [v]).map((item) => String(item ?? '')));
              checkboxes.forEach((cb) => { cb.checked = selected.has(cb.value); });
            };
          } else if (type === 'DATE') {
            const wrap = document.createElement('div');
            wrap.className = 'pb-newrec__date-wrap';
            const input = document.createElement('input');
            input.type = 'text';
            input.className = 'pb-newrec__input';
            input.placeholder = 't · +3 · end · end+1 · first · mon';
            input.addEventListener('focus', () => { if (input.value) input.select(); });
            input.addEventListener('keydown', (e) => {
              if (e.key === 'Enter' || e.key === 'Tab') {
                const smart = smartDateToYMD(input.value);
                if (smart) { input.value = smart; input.select(); }
                if (e.key === 'Enter') e.preventDefault();
              }
            });
            const pickerLabel = document.createElement('label');
            pickerLabel.className = 'pb-newrec__date-btn';
            pickerLabel.textContent = '▾';
            const nativePicker = document.createElement('input');
            nativePicker.type = 'date';
            nativePicker.className = 'pb-overlay__date-pick-native';
            nativePicker.tabIndex = -1;
            pickerLabel.appendChild(nativePicker);
            pickerLabel.addEventListener('mousedown', (e) => { e.stopPropagation(); nativePicker.value = input.value || ''; });
            nativePicker.addEventListener('mousedown', (e) => e.stopPropagation());
            nativePicker.addEventListener('change', () => { if (nativePicker.value) input.value = nativePicker.value; });
            wrap.appendChild(input);
            wrap.appendChild(pickerLabel);
            controlWrap.appendChild(wrap);
            getValue = () => { const smart = smartDateToYMD(input.value); return smart || input.value || ''; };
            setValue = (v) => { input.value = String(v ?? ''); };
          } else if (type === 'DATETIME') {
            const wrap = document.createElement('div');
            wrap.className = 'pb-newrec__date-wrap';
            const input = document.createElement('input');
            input.type = 'text';
            input.className = 'pb-newrec__input';
            input.placeholder = 'now · t · +1d · +2h · +30m';
            input.addEventListener('focus', () => { if (input.value) input.select(); });
            input.addEventListener('keydown', (e) => {
              if (e.key === 'Enter' || e.key === 'Tab') {
                const utc = smartDateTimeToUtc(input.value, this.kintoneTimezone);
                if (utc) input.value = utcToLocalDisplay(utc, this.kintoneTimezone);
                if (e.key === 'Enter') e.preventDefault();
              }
            });
            const pickerLabel = document.createElement('label');
            pickerLabel.className = 'pb-newrec__date-btn';
            pickerLabel.textContent = '▾';
            const nativePicker = document.createElement('input');
            nativePicker.type = 'datetime-local';
            nativePicker.className = 'pb-overlay__date-pick-native';
            nativePicker.tabIndex = -1;
            pickerLabel.appendChild(nativePicker);
            pickerLabel.addEventListener('mousedown', (e) => { e.stopPropagation(); nativePicker.value = input.value ? input.value.replace(' ', 'T') : ''; });
            nativePicker.addEventListener('mousedown', (e) => e.stopPropagation());
            nativePicker.addEventListener('change', () => { if (nativePicker.value) input.value = nativePicker.value.replace('T', ' '); });
            wrap.appendChild(input);
            wrap.appendChild(pickerLabel);
            controlWrap.appendChild(wrap);
            getValue = () => { const utc = smartDateTimeToUtc(input.value, this.kintoneTimezone); return utc || input.value || ''; };
            setValue = (v) => { input.value = String(v ?? ''); };
          } else {
            const input = document.createElement('input');
            input.type = 'text';
            input.className = 'pb-newrec__input';
            if (type === 'NUMBER') input.inputMode = 'decimal';
            if (type === 'LINK') input.inputMode = 'url';
            controlWrap.appendChild(input);
            getValue = () => input.value;
            setValue = (v) => { input.value = String(v ?? ''); };
          }

          if (!field._isLookupAuto && hasFieldDefaultValue(field) && typeof setValue === 'function') {
            setValue(normalizeFieldDefaultValue(field, this.kintoneTimezone));
          }
          const focusFn = () => {
            const el = controlWrap.querySelector('input:not([tabindex="-1"]), textarea, select');
            if (el) { try { el.focus(); } catch (_e) { /* noop */ } }
          };
          // 入力したらそのフィールドのエラー表示を消す
          const clearError = () => {
            row.classList.remove('pb-newrec__field-row--error');
            const msg = row.querySelector('.pb-newrec__field-error');
            if (msg) msg.remove();
          };
          row.addEventListener('input', clearError);
          row.addEventListener('change', clearError);
          fieldInputMap.set(field.code, { field, getValue, setValue, row, focusFn });
          row.appendChild(labelEl);
          row.appendChild(controlWrap);
          body.appendChild(row);
        });
        this._fieldInputMap = fieldInputMap;
        this._dirtySnapshot = this._snapshotValues();
      };

      const focusFirst = () => {
        requestAnimationFrame(() => {
          const first = panel.querySelector('.pb-newrec__body input:not([tabindex="-1"]):not([readonly]), .pb-newrec__body textarea, .pb-newrec__body select');
          if (first) { try { first.focus(); } catch (_e) { /* noop */ } }
        });
      };

      renderBody(activePresetId || (presets[0]?.id || ''));

      presetSelect.addEventListener('change', () => renderBody(presetSelect.value));

      // 「保存して次へ」成功後にフォームを初期状態へ戻す
      const resetForm = () => {
        renderBody(presetSelect.value || activePresetId || (presets[0]?.id || ''));
        focusFirst();
      };

      const buttons = { saveBtn, saveNextBtn, cancelBtn };
      saveBtn.addEventListener('click', () => {
        void this._submit(appId, language, fieldInputMap, allFieldsMap, buttons, listUrl, { keepOpen: false, resetForm });
      });
      saveNextBtn.addEventListener('click', () => {
        void this._submit(appId, language, fieldInputMap, allFieldsMap, buttons, listUrl, { keepOpen: true, resetForm });
      });
      this._triggerSave = () => { if (!saveBtn.disabled) saveBtn.click(); };
      this._triggerSaveNext = () => { if (!saveNextBtn.disabled) saveNextBtn.click(); };

      panel.appendChild(head);
      panel.appendChild(presetRow);
      panel.appendChild(body);
      panel.appendChild(foot);

      focusFirst();
    }

    _markFieldError(entry, message) {
      if (!entry?.row) return;
      entry.row.classList.add('pb-newrec__field-row--error');
      let msg = entry.row.querySelector('.pb-newrec__field-error');
      if (!msg) {
        msg = document.createElement('div');
        msg.className = 'pb-newrec__field-error';
        entry.row.appendChild(msg);
      }
      msg.textContent = message;
    }

    _clearFieldErrors(fieldInputMap) {
      fieldInputMap.forEach((entry) => {
        if (!entry?.row) return;
        entry.row.classList.remove('pb-newrec__field-row--error');
        const msg = entry.row.querySelector('.pb-newrec__field-error');
        if (msg) msg.remove();
      });
    }

    _focusFirstError(fieldInputMap) {
      for (const entry of fieldInputMap.values()) {
        if (entry?.row?.classList.contains('pb-newrec__field-row--error')) {
          try { entry.row.scrollIntoView({ block: 'center' }); } catch (_e) { /* noop */ }
          entry.focusFn?.();
          return;
        }
      }
    }

    // kintone APIのフィールド単位エラー（errorDetails）を該当フィールドに表示する。
    // キー例: "records[0].数量.value" / "record.数量.value"
    _applyServerErrors(fieldInputMap, response, t) {
      const details = response?.errorDetails;
      if (!details || typeof details !== 'object') return false;
      let matched = false;
      Object.entries(details).forEach(([key, val]) => {
        const match = String(key).match(/(?:records\[\d+\]\.)?(?:record\.)?([^.\[\]]+)(?:\.value|\[|$)/);
        const code = match ? match[1] : '';
        const entry = code ? fieldInputMap.get(code) : null;
        if (!entry) return;
        const messages = Array.isArray(val?.messages) ? val.messages.join(' ') : String(val?.message || '');
        this._markFieldError(entry, messages || t('toastNewRecordFailed'));
        matched = true;
      });
      return matched;
    }

    async _submit(appId, language, fieldInputMap, allFieldsMap, buttons, listUrl, options = {}) {
      const t = (key) => resolveText(language, key);
      const { saveBtn, saveNextBtn, cancelBtn } = buttons;
      const keepOpen = Boolean(options.keepOpen);
      const record = {};
      const missingEntries = [];

      this._clearFieldErrors(fieldInputMap);

      fieldInputMap.forEach((entry) => {
        const { field, getValue } = entry;
        // ルックアップのコピー先は送信しない。保存時にkintoneがルックアップを
        // 実行して自動設定するため（手打ちされたキーにも正しく追従する）
        if (field._isLookupAuto) return;
        const raw = getValue();
        const type = String(field.type || '').toUpperCase();
        let value;
        if (type === 'CHECK_BOX' || type === 'MULTI_SELECT') {
          value = Array.isArray(raw) ? raw : [];
        } else if (type === 'USER_SELECT' || type === 'ORGANIZATION_SELECT' || type === 'GROUP_SELECT') {
          value = String(raw ?? '').split(/[,、\s]+/)
            .map((code) => code.trim())
            .filter(Boolean)
            .map((code) => ({ code }));
        } else {
          value = String(raw ?? '');
          if (type === 'NUMBER') value = qnrNormalizeNumberText(value);
        }
        const isEmpty = Array.isArray(value) ? value.length === 0 : value === '';
        if (field.required && isEmpty) missingEntries.push(entry);
        // 未入力フィールドはリクエストに含めない。
        // value:'' で明示送信するとkintoneアプリ側の初期値が適用されず
        // 空で確定し、そのフィールドを参照する計算フィールドがエラーになる。
        if (isEmpty) return;
        record[field.code] = { value };
      });

      qnrAppendEmptySubtableRows(record, allFieldsMap);

      if (missingEntries.length) {
        missingEntries.forEach((entry) => this._markFieldError(entry, t('newRecordRequiredField')));
        this._focusFirstError(fieldInputMap);
        this._showNotice(t('newRecordRequiredMissing'));
        return;
      }

      const activeSaveBtn = keepOpen ? saveNextBtn : saveBtn;
      const originalLabel = activeSaveBtn.textContent;
      saveBtn.disabled = true;
      saveNextBtn.disabled = true;
      cancelBtn.disabled = true;
      activeSaveBtn.textContent = t('newRecordSaving');

      try {
        const response = await this.postFn('EXCEL_POST_RECORDS', {
          appId,
          records: [record],
          __pbTrigger: 'quick_new_record'
        });
        if (!response?.ok) {
          // フィールド単位のエラーは該当行に表示し、全体メッセージはトーストで伝える
          const matched = this._applyServerErrors(fieldInputMap, response, t);
          if (matched) this._focusFirstError(fieldInputMap);
          const summary = String(response?.error || '').trim();
          this._showNotice(summary ? `${t('toastNewRecordFailed')}: ${summary}` : t('toastNewRecordFailed'));
          return;
        }
        if (keepOpen) {
          // 連続作成: フォームを初期状態に戻して次の入力へ。
          // 一覧のリロードはモーダルを閉じるときにまとめて行う。
          this._savedAny = true;
          this._showNotice(t('newRecordSavedNext'));
          if (typeof options.resetForm === 'function') options.resetForm();
          return;
        }
        this.close({ skipReload: true });
        this._reloadList(listUrl);
      } catch (err) {
        console.error('[kintone-excel-overlay] quick new record failed', err);
        this._showNotice(t('toastNewRecordFailed'));
      } finally {
        if (this.el) {
          saveBtn.disabled = false;
          saveNextBtn.disabled = false;
          cancelBtn.disabled = false;
          activeSaveBtn.textContent = originalLabel;
        }
      }
    }

    _showNotice(message) {
      showOverlayLaunchNotice(message);
    }
  }

  const QUICK_NEW_SCROLL_KEY = 'pbQuickNewScrollV1';

  // Quick New保存後のリロードでスクロール位置を復元する。
  // kintoneの一覧はリロード後に非同期描画されるため、ブラウザ標準の
  // スクロール復元は効かない。描画が進んで目標位置まで到達可能に
  // なるのを待ってから復元する（ユーザーが先にスクロールしたら中断）。
  function restoreQuickNewScroll() {
    let payload = null;
    try {
      const raw = sessionStorage.getItem(QUICK_NEW_SCROLL_KEY);
      if (!raw) return;
      sessionStorage.removeItem(QUICK_NEW_SCROLL_KEY);
      payload = JSON.parse(raw);
    } catch (_e) {
      return;
    }
    if (!payload || payload.url !== window.location.href) return;
    const y = Number(payload.y) || 0;
    if (y <= 0) return;
    if (Date.now() - (Number(payload.savedAt) || 0) > 30000) return;
    const startedAt = Date.now();
    const tryRestore = () => {
      if (window.scrollY > 0) return;
      const maxY = document.documentElement.scrollHeight - window.innerHeight;
      if (maxY >= y) {
        window.scrollTo(0, y);
        return;
      }
      if (Date.now() - startedAt > 5000) {
        if (maxY > 0) window.scrollTo(0, Math.min(y, maxY));
        return;
      }
      setTimeout(tryRestore, 200);
    };
    tryRestore();
  }
  restoreQuickNewScroll();

  const quickNewRecord = new QuickNewRecordModal(postToPage);

  document.addEventListener('keydown', (e) => {
    if (e.code !== 'KeyN') return;
    if (!e.shiftKey || !e.altKey || e.ctrlKey || e.metaKey) return;
    if (!parseListOverlayContext(location.href)) return;
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    if (quickNewRecord.isVisible()) {
      void quickNewRecord.requestClose();
    } else {
      void quickNewRecord.open();
    }
  }, true);

  // ── End Quick New Record Modal ───────────────────────────────────────────
