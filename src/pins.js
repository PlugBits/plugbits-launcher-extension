'use strict';

import {
  loadPinnedRecords,
  savePinnedRecords,
  createId,
  getActiveTab,
  parseKintoneUrl,
  isKintoneUrl,
  buildKintoneUrl
} from './core.js';

export function initPins(options = {}) {
  const doc = options.document || document;
  const pinListEl = doc.getElementById('pinList');
  const pinNoticeEl = doc.getElementById('pinNotice');
  let refreshBtn = doc.getElementById('refreshPins');
  const addBtn = doc.getElementById('addPinFromTab');

  if (!pinListEl) {
    return {
      reload() {},
      refresh() {},
      refreshPins() {},
      quickAdd() { return false; },
      dispose() {}
    };
  }

  if (!refreshBtn) {
    const sectionActions = doc.querySelector('#recordPinSection .section-actions');
    if (sectionActions) {
      const btn = doc.createElement('button');
      btn.id = 'refreshPins';
      btn.className = 'ghost-btn';
      btn.type = 'button';
      btn.textContent = '↻ Refresh';
      btn.title = 'Refresh pinned records';
      sectionActions.appendChild(btn);
      refreshBtn = btn;
    }
  }

  const state = {
    entries: [],
    storageListener: null,
    skipStorageOnce: false
  };

  let noticeTimer = null;
  let persistTimer = null;
  let dragSourceId = null;

  const escapeSelector = (value) => {
    if (value == null) return '';
    if (globalThis.CSS?.escape) return CSS.escape(String(value));
    return String(value).replace(/[^\w-]/g, (ch) => `\\${ch}`);
  };

  function normalizeTimestamp(value) {
    const num = Number(value);
    return Number.isFinite(num) && num > 0 ? Math.floor(num) : 0;
  }

  function normalizePinnedEntry(entry) {
    if (!entry || typeof entry !== 'object') return null;
    const pinnedAt = normalizeTimestamp(entry.pinnedAt || entry.createdAt);
    const modifiedAt = normalizeTimestamp(entry.modifiedAt || entry.lastEditedAt || entry.updatedAt || pinnedAt);
    return {
      id: entry.id || createId(),
      label: entry.label || '',
      host: entry.host || '',
      appId: String(entry.appId || '').trim(),
      recordId: String(entry.recordId || '').trim(),
      titleField: entry.titleField || '',
      note: entry.note || '',
      pinnedAt: pinnedAt || modifiedAt || 0,
      modifiedAt: modifiedAt || pinnedAt || 0
    };
  }

  function touchEntry(entry) {
    const now = Date.now();
    if (!normalizeTimestamp(entry.pinnedAt)) entry.pinnedAt = now;
    entry.modifiedAt = now;
  }

  async function persistPins() {
    state.skipStorageOnce = true;
    await savePinnedRecords(state.entries.map(({ id, label, host, appId, recordId, titleField, note, pinnedAt, modifiedAt }) => ({
      id,
      label,
      host,
      appId,
      recordId,
      titleField,
      note,
      pinnedAt: normalizeTimestamp(pinnedAt),
      modifiedAt: normalizeTimestamp(modifiedAt)
    })));
  }

  function schedulePersist() {
    if (persistTimer) clearTimeout(persistTimer);
    persistTimer = setTimeout(() => {
      persistTimer = null;
      persistPins().catch(() => {});
    }, 400);
  }

  function setNotice(msg, ttlMs = 0) {
    if (noticeTimer) {
      clearTimeout(noticeTimer);
      noticeTimer = null;
    }
    if (!pinNoticeEl) return;
    if (msg) {
      pinNoticeEl.textContent = msg;
      pinNoticeEl.classList.remove('hidden');
      if (ttlMs > 0) {
        noticeTimer = setTimeout(() => setNotice(''), ttlMs);
      }
    } else {
      pinNoticeEl.textContent = '';
      pinNoticeEl.classList.add('hidden');
    }
  }

  function formatUpdatedAt(ts) {
    if (!ts) return '';
    try {
      return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    } catch (_err) {
      return '';
    }
  }

  function defaultLabel(entry) {
    const app = entry.appId ? `App ${entry.appId}` : 'App (unset)';
    const record = entry.recordId ? `Record ${entry.recordId}` : 'Record (unset)';
    return `${app} / ${record}`;
  }

  function openOptionsPage() {
    if (chrome?.runtime?.openOptionsPage) {
      chrome.runtime.openOptionsPage();
    } else {
      window.open(chrome.runtime.getURL('options.html'), '_blank');
    }
  }

  function createCard(entry) {
    const li = doc.createElement('li');
    li.className = 'pin-card record-pin-card';
    li.dataset.id = entry.id;

    li.addEventListener('dragenter', handleDragEnter, true);
    li.addEventListener('dragover', handleDragOver);
    li.addEventListener('dragleave', handleDragLeave, true);
    li.addEventListener('drop', handleDrop);
    li.addEventListener('dragend', handleDragEnd);

    const header = doc.createElement('div');
    header.className = 'pin-card-header record-pin-head';

    const titleWrap = doc.createElement('div');
    titleWrap.className = 'pin-title-wrap record-pin-title';
    const dragHandle = doc.createElement('span');
    dragHandle.className = 'pin-drag-handle';
    dragHandle.title = 'Drag to reorder';
    dragHandle.textContent = '::';
    dragHandle.draggable = true;
    dragHandle.dataset.cardId = entry.id;
    dragHandle.setAttribute('role', 'button');
    dragHandle.setAttribute('aria-label', 'Drag to reorder');
    dragHandle.addEventListener('dragstart', handleDragStart);
    dragHandle.addEventListener('dragend', handleDragEnd);
    dragHandle.addEventListener('click', (ev) => ev.preventDefault());

    const titleInput = doc.createElement('input');
    titleInput.type = 'text';
    titleInput.className = 'pin-title-input';
    titleInput.value = entry.label || '';
    titleInput.placeholder = defaultLabel(entry);
    titleInput.addEventListener('input', () => {
      entry.label = titleInput.value;
      touchEntry(entry);
      schedulePersist();
    });
    titleInput.addEventListener('blur', () => {
      entry.label = titleInput.value.trim();
      titleInput.value = entry.label;
      touchEntry(entry);
      schedulePersist();
    });
    titleWrap.appendChild(dragHandle);
    titleWrap.appendChild(titleInput);
    header.appendChild(titleWrap);

    const actions = doc.createElement('div');
    actions.className = 'pin-actions record-pin-actions';
    const openBtn = doc.createElement('a');
    openBtn.textContent = 'Open';
    openBtn.className = 'btn record-pin-open';
    openBtn.href = buildKintoneUrl(entry.host, entry.appId, { recordId: entry.recordId });
    openBtn.target = '_blank';
    openBtn.rel = 'noopener';

    const removeBtn = doc.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'pin-remove btn record-pin-remove x-only';
    removeBtn.title = 'Remove';
    removeBtn.setAttribute('aria-label', 'Remove');
    removeBtn.textContent = '✖';
    removeBtn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      removeEntry(entry.id).catch(() => {});
    });

    actions.appendChild(openBtn);
    actions.appendChild(removeBtn);
    header.appendChild(actions);
    li.appendChild(header);

    const meta = doc.createElement('div');
    meta.className = 'pin-meta record-pin-meta';
    const metaItems = [
      `App: ${entry.appId || '-'}`,
      `Record: ${entry.recordId || '-'}`
    ];
    const updatedAtText = formatUpdatedAt(entry.modifiedAt || entry.pinnedAt);
    if (updatedAtText) {
      metaItems.push(`Updated: ${updatedAtText}`);
    }
    metaItems.forEach((text) => {
      const span = doc.createElement('span');
      span.textContent = text;
      meta.appendChild(span);
    });
    li.appendChild(meta);

    const body = doc.createElement('div');
    body.className = 'record-pin-body';

    const note = doc.createElement('textarea');
    note.className = 'pin-note-input';
    note.placeholder = 'Notes';
    note.value = entry.note || '';
    note.addEventListener('input', () => {
      entry.note = note.value;
      touchEntry(entry);
      schedulePersist();
    });
    note.addEventListener('blur', () => {
      entry.note = note.value;
      touchEntry(entry);
      schedulePersist();
    });
    body.appendChild(note);

    li.appendChild(body);

    return li;
  }

  function renderList() {
    pinListEl.innerHTML = '';
    if (!state.entries.length) {
      const empty = doc.createElement('li');
      empty.className = 'pin-empty';
      const msg = doc.createElement('div');
      msg.textContent = 'No pinned records yet.';

      const actions = doc.createElement('div');
      actions.className = 'pin-empty-actions';
      const openOptionsBtn = doc.createElement('button');
      openOptionsBtn.type = 'button';
      openOptionsBtn.className = 'ghost-btn';
      openOptionsBtn.textContent = 'Open settings';
      openOptionsBtn.addEventListener('click', openOptionsPage);
      actions.appendChild(openOptionsBtn);

      empty.appendChild(msg);
      empty.appendChild(actions);
      pinListEl.appendChild(empty);
      return;
    }

    state.entries.forEach((entry) => {
      const card = createCard(entry);
      pinListEl.appendChild(card);
    });
  }

  async function reloadPins({ silent = true } = {}) {
    const now = Date.now();
    let migrated = false;
    state.entries = (await loadPinnedRecords())
      .map(normalizePinnedEntry)
      .filter(Boolean)
      .map((entry) => {
        if (normalizeTimestamp(entry.pinnedAt) || normalizeTimestamp(entry.modifiedAt)) {
          return entry;
        }
        migrated = true;
        return {
          ...entry,
          pinnedAt: now,
          modifiedAt: now
        };
      });
    if (migrated) {
      await persistPins();
    }
    renderList();
    if (!silent) setNotice('');
  }

  function attachStorageListener() {
    if (!chrome?.storage?.onChanged) return;
    const listener = async (changes, area) => {
      if (area !== 'sync' || !Object.prototype.hasOwnProperty.call(changes, 'kfavPins')) return;
      if (state.skipStorageOnce) {
        state.skipStorageOnce = false;
        return;
      }
      await reloadPins({ silent: true });
    };
    chrome.storage.onChanged.addListener(listener);
    state.storageListener = listener;
  }

  async function quickAddCurrentRecord() {
    try {
      const tab = await getActiveTab();
      if (!tab || !isKintoneUrl(tab.url || '')) {
        setNotice('Open a kintone record tab first.', 2000);
        return false;
      }
      const parsed = parseKintoneUrl(tab.url || '');
      if (!parsed.host || !parsed.appId || !parsed.recordId) {
        setNotice('Open a record detail page and try again.', 2000);
        return false;
      }
      if (state.entries.some((entry) => entry.host === parsed.host && entry.appId === parsed.appId && entry.recordId === parsed.recordId)) {
        setNotice('This record is already pinned.', 2000);
        return false;
      }
      const labelFromTab = (tab.title || '').replace(/\s+-\s+kintone.*/i, '').trim();
      const entry = normalizePinnedEntry({
        id: createId(),
        label: labelFromTab,
        host: parsed.host,
        appId: parsed.appId,
        recordId: parsed.recordId,
        titleField: '',
        note: '',
        pinnedAt: Date.now(),
        modifiedAt: Date.now()
      });
      state.entries.push(entry);
      await persistPins();
      renderList();
      setNotice('Pinned.', 2000);
      return true;
    } catch (error) {
      setNotice(String(error?.message || error), 2000);
      return false;
    }
  }

  async function removeEntry(id) {
    const idx = state.entries.findIndex((entry) => entry.id === id);
    if (idx === -1) return;
    state.entries.splice(idx, 1);
    await persistPins();
    renderList();
    setNotice('Pin removed.', 2000);
  }

  function handleDragStart(event) {
    const sourceId = event.currentTarget.dataset.cardId
      || event.currentTarget.dataset.id
      || event.currentTarget.closest('.pin-card')?.dataset.id;
    dragSourceId = sourceId || null;
    if (!dragSourceId) return;
    event.stopPropagation();
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', dragSourceId);
    const card = pinListEl.querySelector(`.pin-card[data-id="${escapeSelector(dragSourceId)}"]`);
    card?.classList.add('dragging');
  }

  function handleDragEnter(event) {
    if (!dragSourceId) return;
    if (event.target !== event.currentTarget) return;
    if (event.currentTarget.dataset.id === dragSourceId) return;
    event.currentTarget.classList.add('drag-over');
  }

  function handleDragOver(event) {
    if (!dragSourceId) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }

  function handleDragLeave(event) {
    if (event.target !== event.currentTarget) return;
    event.currentTarget.classList.remove('drag-over');
  }

  async function handleDrop(event) {
    event.preventDefault();
    const targetId = event.currentTarget.dataset.id;
    event.currentTarget.classList.remove('drag-over');
    if (!dragSourceId || !targetId || dragSourceId === targetId) return;
    const fromIdx = state.entries.findIndex((entry) => entry.id === dragSourceId);
    const toIdx = state.entries.findIndex((entry) => entry.id === targetId);
    if (fromIdx === -1 || toIdx === -1) return;
    const [moved] = state.entries.splice(fromIdx, 1);
    state.entries.splice(toIdx, 0, moved);
    await persistPins();
    renderList();
    dragSourceId = null;
    Array.from(pinListEl.querySelectorAll('.pin-card.dragging')).forEach((el) => el.classList.remove('dragging'));
  }

  function handleDragEnd(event) {
    event.stopPropagation();
    const card = pinListEl.querySelector('.pin-card.dragging');
    card?.classList.remove('dragging');
    dragSourceId = null;
    Array.from(pinListEl.querySelectorAll('.pin-card.drag-over')).forEach((el) => el.classList.remove('drag-over'));
  }

  async function refreshPins({ silent = false } = {}) {
    await reloadPins({ silent: true });
    if (!silent) setNotice('');
  }

  const handleRefreshClick = () => {
    refreshPins().catch((error) => setNotice(String(error?.message || error)));
  };
  refreshBtn?.addEventListener('click', handleRefreshClick);

  const handleQuickAddClick = () => {
    quickAddCurrentRecord().catch((error) => setNotice(String(error?.message || error)));
  };
  addBtn?.addEventListener('click', handleQuickAddClick);

  async function boot() {
    await reloadPins({ silent: false });
  }

  attachStorageListener();
  boot().catch((error) => setNotice(String(error?.message || error)));

  return {
    reload: reloadPins,
    refresh: refreshPins,
    refreshPins,
    quickAdd: quickAddCurrentRecord,
    dispose() {
      if (state.storageListener) {
        chrome.storage.onChanged.removeListener(state.storageListener);
        state.storageListener = null;
      }
      if (noticeTimer) {
        clearTimeout(noticeTimer);
        noticeTimer = null;
      }
      if (persistTimer) {
        clearTimeout(persistTimer);
        persistTimer = null;
      }
      refreshBtn?.removeEventListener('click', handleRefreshClick);
      addBtn?.removeEventListener('click', handleQuickAddClick);
    }
  };
}
