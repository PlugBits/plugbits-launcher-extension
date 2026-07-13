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

  class QuickNewRecordModal {
    constructor(postFn) {
      this.postFn = postFn;
      this.el = null;
      this.kintoneTimezone = _browserTz;
    }

    isVisible() { return Boolean(this.el); }

    close() {
      if (this.el) { this.el.remove(); this.el = null; }
    }

    async open() {
      if (this.el) { this.close(); return; }
      const listCtx = parseListOverlayContext(location.href);
      if (!listCtx?.appId) return;
      const appId = listCtx.appId;
      const listUrl = listCtx.href;

      ensureOverlayCss();
      const { language } = await resolveOverlayUiLanguage();
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
        this._buildContent(panel, appId, language, allFieldsMap, presets, activePresetId, listUrl);
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
      layer.addEventListener('mousedown', (e) => { if (e.target === layer) this.close(); });
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

    _buildContent(panel, appId, language, allFieldsMap, presets, activePresetId, listUrl) {
      const t = (key) => resolveText(language, key);

      // Header
      const head = document.createElement('div');
      head.className = 'pb-newrec__head';
      const title = document.createElement('div');
      title.className = 'pb-newrec__title';
      title.id = 'pb-newrec-title';
      title.textContent = t('newRecordTitle');
      if (panel?.closest) {
        const layerEl = panel.closest('.pb-newrec__layer');
        if (layerEl) layerEl.setAttribute('aria-labelledby', 'pb-newrec-title');
      }
      const closeBtn = document.createElement('button');
      closeBtn.type = 'button';
      closeBtn.className = 'pb-newrec__close';
      closeBtn.innerHTML = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M18 6L6 18M6 6l12 12"/></svg>';
      closeBtn.setAttribute('aria-label', t('newRecordCancel'));
      closeBtn.addEventListener('click', () => this.close());
      head.appendChild(title);
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

      // Footer
      const foot = document.createElement('div');
      foot.className = 'pb-newrec__foot';
      const cancelBtn = document.createElement('button');
      cancelBtn.type = 'button';
      cancelBtn.className = 'pb-overlay__btn';
      cancelBtn.textContent = t('newRecordCancel');
      cancelBtn.addEventListener('click', () => this.close());
      const saveBtn = document.createElement('button');
      saveBtn.type = 'button';
      saveBtn.className = 'pb-overlay__btn pb-overlay__btn--primary';
      saveBtn.textContent = t('newRecordSave');
      foot.appendChild(cancelBtn);
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
            input.readOnly = true;
            const searchBtn = document.createElement('button');
            searchBtn.type = 'button';
            searchBtn.className = 'pb-newrec__lookup-btn';
            searchBtn.textContent = '🔍';
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
            searchBtn.addEventListener('click', () => {
              buildNewRecordLookupPicker(wrap, relatedAppId, relatedKeyField, pickerFields, mappings, fieldInputMap, input, this.postFn, language);
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
          fieldInputMap.set(field.code, { field, getValue, setValue });
          row.appendChild(labelEl);
          row.appendChild(controlWrap);
          body.appendChild(row);
        });
      };

      renderBody(activePresetId || (presets[0]?.id || ''));

      presetSelect.addEventListener('change', () => renderBody(presetSelect.value));

      saveBtn.addEventListener('click', () => {
        void this._submit(appId, language, fieldInputMap, saveBtn, cancelBtn, listUrl);
      });

      panel.appendChild(head);
      panel.appendChild(presetRow);
      panel.appendChild(body);
      panel.appendChild(foot);

      requestAnimationFrame(() => {
        const first = panel.querySelector('input:not([type="date"]):not([type="datetime-local"]), textarea, select:not(.pb-newrec__preset-select)');
        if (first) first.focus();
      });
    }

    async _submit(appId, language, fieldInputMap, saveBtn, cancelBtn, listUrl) {
      const t = (key) => resolveText(language, key);
      const record = {};
      let hasRequiredMissing = false;

      fieldInputMap.forEach(({ field, getValue }) => {
        const raw = getValue();
        const type = String(field.type || '').toUpperCase();
        let value;
        if (type === 'CHECK_BOX' || type === 'MULTI_SELECT') {
          value = Array.isArray(raw) ? raw : [];
        } else {
          value = String(raw ?? '');
        }
        if (field.required) {
          const isEmpty = Array.isArray(value) ? value.length === 0 : value === '';
          if (isEmpty) hasRequiredMissing = true;
        }
        record[field.code] = { value };
      });

      if (hasRequiredMissing) {
        this._showNotice(t('newRecordRequiredMissing'));
        return;
      }

      saveBtn.disabled = true;
      cancelBtn.disabled = true;
      saveBtn.textContent = t('newRecordSaving');

      try {
        const response = await this.postFn('EXCEL_POST_RECORDS', {
          appId,
          records: [record],
          __pbTrigger: 'quick_new_record'
        });
        if (!response?.ok) throw new Error(response?.error || 'create failed');
        this.close();
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
      } catch (err) {
        console.error('[kintone-excel-overlay] quick new record failed', err);
        this._showNotice(t('toastNewRecordFailed'));
        saveBtn.disabled = false;
        cancelBtn.disabled = false;
        saveBtn.textContent = t('newRecordSave');
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
      quickNewRecord.close();
    } else {
      void quickNewRecord.open();
    }
  }, true);

  // ── End Quick New Record Modal ───────────────────────────────────────────
