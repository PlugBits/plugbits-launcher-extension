// content-command-palette.js
// content.js から抽出された Command Palette セクションです。
// content script として単体で読み込まれることは想定しておらず、
// scripts/build.mjs が content.js 内の @@INCLUDE マーカー位置へビルド時に
// テキストとしてそのまま埋め込みます(実行時のスコープ・挙動は分割前と完全に同一)。
// @@BODY_START
  // ── Command Palette ──────────────────────────────────────────────────────

  const APP_CATALOG_REFRESH_KEYWORDS = ['refresh', 'reload', 'cache', 'キャッシュ', '更新', 'アプリ一覧'];

  // content.js is a classic content script (not an ES module), so it cannot import
  // core.js's buildKintoneUrl. This is a local copy scoped to the current tenant
  // (host defaults to location.origin) for the command palette's own app/record links.
  function buildCurrentTenantUrl(appId, options = {}) {
    const normalizedAppId = String(appId || '').trim();
    if (!normalizedAppId) return '';
    const encodedAppId = encodeURIComponent(normalizedAppId);
    const recordId = String(options.recordId || '').trim();
    if (recordId) {
      const encodedRecordId = encodeURIComponent(recordId);
      if (options.mode === 'edit') return `${location.origin}/k/${encodedAppId}/edit?record=${encodedRecordId}`;
      if (options.mode === 'print') return `${location.origin}/k/${encodedAppId}/print?record=${encodedRecordId}`;
      return `${location.origin}/k/${encodedAppId}/show#record=${encodedRecordId}`;
    }
    const base = `${location.origin}/k/${encodedAppId}/`;
    const viewId = String(options.viewId || '').trim();
    if (viewId) return `${base}?view=${encodeURIComponent(viewId)}`;
    return base;
  }

  // ── Palette feedback toast (palette本体から独立して生存する) ─────────────
  let cpToastEl = null;
  let cpToastTimer = null;
  function cpShowToast(message, ok = true) {
    try {
      if (!cpToastEl || !document.body.contains(cpToastEl)) {
        cpToastEl = document.createElement('div');
        cpToastEl.id = 'pb-cp-toast';
        document.body.appendChild(cpToastEl);
      }
      cpToastEl.textContent = message;
      cpToastEl.style.cssText = [
        'position:fixed', 'left:50%', 'bottom:32px', 'transform:translateX(-50%)',
        'z-index:2147483647', 'padding:9px 16px', 'border-radius:8px',
        'font-size:13px', "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif",
        'box-shadow:0 8px 24px rgba(0,0,0,.22)', 'pointer-events:none',
        'transition:opacity .2s ease', 'opacity:1',
        ok ? 'background:#111827;color:#f9fafb' : 'background:#b91c1c;color:#fef2f2'
      ].join(';');
      if (cpToastTimer) clearTimeout(cpToastTimer);
      cpToastTimer = setTimeout(() => {
        if (cpToastEl) cpToastEl.style.opacity = '0';
      }, 2200);
    } catch (_) { /* ignore */ }
  }

  async function cpCopyText(text, successMessage) {
    try {
      await navigator.clipboard.writeText(String(text ?? ''));
      cpShowToast(successMessage || 'コピーしました');
      return true;
    } catch (_) {
      cpShowToast('コピーに失敗しました', false);
      return false;
    }
  }

  // ── Keyboard shortcut cheatsheet ─────────────────────────────────────────
  const CP_CHEATSHEET_SECTIONS = [
    {
      title: '全般',
      items: [
        ['Ctrl / ⌘ + /', 'コマンドパレットを開く'],
        ['Ctrl / ⌘ + Shift + E', 'Excel Overlay を開く'],
        ['Shift + Alt + N', 'クイック新規レコード（一覧画面）'],
        ['?', 'このショートカット一覧を表示']
      ]
    },
    {
      title: 'コマンドパレット',
      items: [
        ['↑ / ↓', '項目を移動'],
        ['Enter', '実行 / 開く'],
        ['Shift + Enter', 'App検索: 新規タブで開く'],
        ['1 – 9', '番号ショートカットを実行'],
        ['Esc', '閉じる']
      ]
    },
    {
      title: 'Excel Overlay',
      items: [
        ['↑ ↓ ← →', 'セル移動 / 範囲選択（Shift併用）'],
        ['Enter / Shift + Enter', '確定して下 / 上へ'],
        ['Tab / Shift + Tab', '右 / 左へ'],
        ['F2 / Space', '編集開始・ピッカーを開く'],
        ['Ctrl / ⌘ + C / V', 'コピー / 貼り付け'],
        ['Ctrl / ⌘ + Z / Y', '元に戻す / やり直し'],
        ['Ctrl / ⌘ + S', '保存'],
        ['Esc', 'パネル / Overlay を閉じる']
      ]
    }
  ];

  let cpCheatsheetEl = null;
  function cpCheatsheetEscHandler(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopImmediatePropagation();
      cpToggleCheatsheet(false);
    }
  }
  function cpToggleCheatsheet(forceOpen) {
    const shouldOpen = forceOpen !== undefined
      ? Boolean(forceOpen)
      : !(cpCheatsheetEl && cpCheatsheetEl.style.display !== 'none');
    if (!shouldOpen) {
      if (cpCheatsheetEl) cpCheatsheetEl.style.display = 'none';
      document.removeEventListener('keydown', cpCheatsheetEscHandler, true);
      return;
    }
    if (!cpCheatsheetEl || !document.body.contains(cpCheatsheetEl)) {
      const backdrop = document.createElement('div');
      backdrop.id = 'pb-cp-cheatsheet';
      backdrop.addEventListener('mousedown', (e) => {
        if (e.target === backdrop) cpToggleCheatsheet(false);
      });

      const style = document.createElement('style');
      style.textContent = `
        #pb-cp-cheatsheet{position:fixed!important;inset:0!important;background:rgba(0,0,0,.4)!important;z-index:2147483647!important;display:flex!important;align-items:flex-start!important;justify-content:center!important;padding-top:9vh!important}
        #pb-cp-cheatsheet .pb-cs__panel{width:520px!important;max-width:calc(100vw - 32px)!important;max-height:80vh!important;overflow-y:auto!important;background:#fff!important;border-radius:12px!important;box-shadow:0 24px 64px rgba(0,0,0,.25)!important;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif!important;color:#374151!important;padding:20px 24px 22px!important;box-sizing:border-box!important}
        #pb-cp-cheatsheet .pb-cs__head{display:flex!important;align-items:center!important;justify-content:space-between!important;margin:0 0 6px!important}
        #pb-cp-cheatsheet .pb-cs__title{font-size:15px!important;font-weight:700!important;color:#111827!important;margin:0!important}
        #pb-cp-cheatsheet .pb-cs__close{border:none!important;background:transparent!important;cursor:pointer!important;color:#9ca3af!important;padding:4px!important;border-radius:6px!important;line-height:0!important}
        #pb-cp-cheatsheet .pb-cs__close:hover{background:#f3f4f6!important;color:#374151!important}
        #pb-cp-cheatsheet .pb-cs__section-title{font-size:10px!important;font-weight:700!important;color:#9ca3af!important;letter-spacing:.1em!important;text-transform:uppercase!important;margin:16px 0 6px!important}
        #pb-cp-cheatsheet .pb-cs__row{display:flex!important;align-items:baseline!important;justify-content:space-between!important;gap:16px!important;padding:5px 0!important;font-size:13px!important}
        #pb-cp-cheatsheet .pb-cs__keys{flex:0 0 auto!important;font-family:ui-monospace,SFMono-Regular,Menlo,monospace!important;font-size:11px!important;color:#374151!important;background:#f3f4f6!important;border:1px solid #e5e7eb!important;border-radius:5px!important;padding:2px 7px!important;white-space:nowrap!important}
        #pb-cp-cheatsheet .pb-cs__desc{flex:1!important;color:#4b5563!important;text-align:left!important}
      `;

      const panel = document.createElement('div');
      panel.className = 'pb-cs__panel';

      const head = document.createElement('div');
      head.className = 'pb-cs__head';
      const title = document.createElement('h2');
      title.className = 'pb-cs__title';
      title.textContent = 'キーボードショートカット';
      const closeBtn = document.createElement('button');
      closeBtn.type = 'button';
      closeBtn.className = 'pb-cs__close';
      closeBtn.setAttribute('aria-label', '閉じる');
      closeBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>';
      closeBtn.addEventListener('click', () => cpToggleCheatsheet(false));
      head.append(title, closeBtn);
      panel.appendChild(head);

      CP_CHEATSHEET_SECTIONS.forEach((section) => {
        const sTitle = document.createElement('div');
        sTitle.className = 'pb-cs__section-title';
        sTitle.textContent = section.title;
        panel.appendChild(sTitle);
        section.items.forEach(([keys, desc]) => {
          const row = document.createElement('div');
          row.className = 'pb-cs__row';
          const keysEl = document.createElement('span');
          keysEl.className = 'pb-cs__keys';
          keysEl.textContent = keys;
          const descEl = document.createElement('span');
          descEl.className = 'pb-cs__desc';
          descEl.textContent = desc;
          row.append(keysEl, descEl);
          panel.appendChild(row);
        });
      });

      backdrop.append(style, panel);
      document.body.appendChild(backdrop);
      cpCheatsheetEl = backdrop;
    }
    cpCheatsheetEl.style.display = 'flex';
    document.addEventListener('keydown', cpCheatsheetEscHandler, true);
  }

  const CP_COMMANDS = [
    // ─ App search ─
    {
      id: 'start-app-search',
      label: 'App検索を開始',
      icon: '⌕',
      category: 'app',
      badge: 'search',
      keywords: ['search', 'app', 'apps', 'アプリ', '検索'],
      keepOpen: true,
      action(_ctx, palette) {
        palette.startAppSearch();
      }
    },
    // ─ Nav ─
    {
      id: 'open-app-top',
      label: 'アプリトップへ',
      icon: '⌂',
      category: 'nav',
      badge: 'top',
      keywords: ['app', 'top', 'アプリ', 'トップ', 'cd'],
      requiresApp: true,
      action(ctx) { window.location.href = buildCurrentTenantUrl(ctx.appId); }
    },
    {
      id: 'open-portal',
      label: 'ポータルへ',
      icon: '⌂',
      category: 'nav',
      badge: 'portal',
      keywords: ['portal', 'ポータル', 'home', 'トップ'],
      action() { window.location.href = `${location.origin}/k/`; }
    },
    // ─ List: view / graph ─
    {
      id: 'switch-view',
      label: 'ビューを切り替え',
      icon: '▤',
      category: 'list',
      badge: 'view',
      keywords: ['view', 'switch', 'ビュー', '切替', '一覧'],
      requiresApp: true,
      keepOpen: true,
      action(ctx, palette) { palette.startSubPicker('view'); }
    },
    {
      id: 'open-graph-view',
      label: 'グラフビューへ',
      icon: '▲',
      category: 'list',
      badge: 'graph',
      keywords: ['graph', 'chart', 'グラフ', 'レポート', 'report'],
      requiresApp: true,
      keepOpen: true,
      action(ctx, palette) { palette.startSubPicker('graph'); }
    },
    // ─ Record detail ─
    {
      id: 'duplicate-record',
      label: 'レコードを複製',
      icon: '⧉',
      category: 'record',
      badge: 'dup',
      keywords: ['duplicate', 'copy', 'reuse', '複製', '再利用'],
      requiresRecord: true,
      action(ctx) { window.location.href = buildCurrentTenantUrl(ctx.appId, { recordId: ctx.recordId, mode: 'edit' }); }
    },
    {
      id: 'copy-record-link',
      label: 'レコードリンクをコピー',
      icon: 'L',
      category: 'record',
      badge: 'link',
      keywords: ['link', 'url', 'リンク', 'コピー', 'copy'],
      requiresRecord: true,
      action(ctx) {
        cpCopyText(buildCurrentTenantUrl(ctx.appId, { recordId: ctx.recordId }), 'レコードリンクをコピーしました');
      }
    },
    {
      id: 'open-print-preview',
      label: '印刷プレビューへ',
      icon: 'P',
      category: 'record',
      badge: 'print',
      keywords: ['print', '印刷', 'プレビュー', 'preview'],
      requiresRecord: true,
      action(ctx) { window.location.href = buildCurrentTenantUrl(ctx.appId, { recordId: ctx.recordId, mode: 'print' }); }
    },
    // ─ Admin: navigation ─
    {
      id: 'open-form-settings',
      label: 'フォーム設定を開く',
      icon: '⚙',
      category: 'admin',
      badge: 'form',
      keywords: ['form', 'フォーム', '設定', 'admin'],
      requiresApp: true,
      action(ctx) { window.location.href = `/k/admin/app/flow?app=${ctx.appId}#section=form`; }
    },
    {
      id: 'open-process-settings',
      label: 'プロセス管理設定を開く',
      icon: '⚙',
      category: 'admin',
      badge: 'status',
      keywords: ['process', 'status', 'プロセス', '管理', 'workflow'],
      requiresApp: true,
      action(ctx) { window.location.href = `/k/admin/app/status?app=${ctx.appId}`; }
    },
    {
      id: 'open-api-token-settings',
      label: 'APIトークン設定を開く',
      icon: '⚙',
      category: 'admin',
      badge: 'apitoken',
      keywords: ['api', 'token', 'apitoken', 'トークン'],
      requiresApp: true,
      action(ctx) { window.location.href = `/k/admin/app/apitoken?app=${ctx.appId}`; }
    },
    {
      id: 'open-list-settings',
      label: '一覧設定を開く',
      icon: '⚙',
      category: 'admin',
      badge: 'view',
      keywords: ['list', 'view', '一覧', 'ビュー', '設定'],
      requiresApp: true,
      action(ctx) { window.location.href = `/k/admin/app/flow?app=${ctx.appId}#section=view`; }
    },
    {
      id: 'open-notification-settings',
      label: '通知条件を開く',
      icon: '⚙',
      category: 'admin',
      badge: 'notify',
      keywords: ['notification', 'notify', '通知', '条件', 'reminder'],
      requiresApp: true,
      keepOpen: true,
      action(ctx, palette) { palette.startSubPicker('notification'); }
    },
    {
      id: 'open-acl-settings',
      label: 'アクセス権を開く',
      icon: '⚙',
      category: 'admin',
      badge: 'acl',
      keywords: ['acl', 'access', 'permission', 'アクセス権', '権限'],
      requiresApp: true,
      keepOpen: true,
      action(ctx, palette) { palette.startSubPicker('acl'); }
    },
    {
      id: 'open-customize-settings',
      label: 'JS・CSSカスタマイズを開く',
      icon: '⚙',
      category: 'admin',
      badge: 'custom',
      keywords: ['customize', 'js', 'css', 'カスタマイズ', 'javascript'],
      requiresApp: true,
      action(ctx) { window.location.href = `/k/admin/app/customize?app=${ctx.appId}`; }
    },
    {
      id: 'open-plugin-settings',
      label: 'プラグイン設定を開く',
      icon: '⚙',
      category: 'admin',
      badge: 'plugin',
      keywords: ['plugin', 'プラグイン', '設定'],
      requiresApp: true,
      action(ctx) { window.location.href = `/k/admin/app/${ctx.appId}/plugin/#/`; }
    },
    {
      id: 'open-deploy',
      label: '運用環境へ反映',
      icon: '⚙',
      category: 'admin',
      badge: 'deploy',
      keywords: ['deploy', '反映', '運用', '公開', 'release'],
      requiresApp: true,
      action(ctx) { window.location.href = `/k/admin/preview/${ctx.appId}/`; }
    },
    // ─ Developer: clipboard ─
    {
      id: 'copy-app-id',
      label: 'App IDをコピー',
      icon: '#',
      category: 'dev',
      badge: 'appid',
      keywords: ['app', 'id', 'appid', 'copy'],
      requiresApp: true,
      action(ctx) {
        cpCopyText(String(ctx.appId), 'App IDをコピーしました');
      }
    },
    {
      id: 'copy-record-id',
      label: 'Record IDをコピー',
      icon: '#',
      category: 'dev',
      badge: 'recid',
      keywords: ['record', 'id', 'recid', 'recordid', 'copy'],
      requiresRecord: true,
      action(ctx) {
        cpCopyText(String(ctx.recordId), 'Record IDをコピーしました');
      }
    },
    {
      id: 'copy-query',
      label: 'クエリ条件をコピー',
      icon: 'Q',
      category: 'dev',
      badge: 'query',
      keywords: ['query', 'クエリ', 'condition', '条件', 'copy'],
      requiresApp: true,
      action(ctx) {
        cpCopyText(ctx.query || '', 'クエリ条件をコピーしました');
      }
    },
    {
      id: 'copy-field-codes',
      label: 'フィールドコード一覧をコピー',
      icon: '{}',
      category: 'dev',
      badge: 'fields',
      keywords: ['field', 'code', 'fields', 'copy'],
      requiresApp: true,
      isAsync: true,
      async action(ctx, palette) {
        await palette.copyFieldCodes(ctx);
      }
    },
    {
      id: 'copy-form-definition',
      label: 'フォーム定義をJSONで取得',
      icon: 'F',
      category: 'dev',
      badge: 'json',
      keywords: ['form', 'definition', 'json', 'フォーム', '定義', 'schema'],
      requiresApp: true,
      isAsync: true,
      async action(ctx, palette) {
        await palette.copyFormDefinition(ctx);
      }
    },
    // ─ Help ─
    {
      id: 'show-shortcut-help',
      label: 'ショートカットキー一覧を表示',
      icon: '?',
      category: 'help',
      badge: 'help',
      keywords: ['help', 'shortcut', 'ヘルプ', 'ショートカット', '一覧'],
      action() {
        cpToggleCheatsheet(true);
      }
    },
  ];

  class CommandPalette {
    constructor(postFn) {
      this.postFn = postFn;
      this.backdropEl = null;
      this.inputEl = null;
      this.listEl = null;
      this.footerEl = null;
      this.isOpen = false;
      this.ctx = { appId: null, recordId: null, query: '' };
      this.filtered = [];
      this.activeIndex = 0;
      this.appCatalog = [];
      this.appCatalogHost = '';
      this.appCatalogLoading = false;
      this.appCatalogLoaded = false;
      this.appSearchMode = false;
      this.shortcutCommands = [];
      this.shortcutBarEl = null;
      this.subPickerKind = null;
      this.viewPickerItems = [];
      this.viewPickerLoadedAppId = '';
      this.reportItems = [];
      this.reportItemsLoadedAppId = '';
      this.staticSubItems = [];
    }

    async fetchContext() {
      try {
        const res = await this.postFn('CP_GET_CONTEXT', {});
        if (res?.ok) this.ctx = { ...this.ctx, ...res.result };
      } catch (_) { /* ignore */ }
    }

    async fetchShortcutCommands() {
      try {
        const res = await chrome.runtime.sendMessage({ type: 'CP_GET_SHORTCUTS' });
        if (!res?.ok) { this.shortcutCommands = []; return; }
        const list = Array.isArray(res.shortcuts) ? res.shortcuts : [];
        this.shortcutCommands = list.slice(0, 9).map((entry, i) => ({
          id: `shortcut-${i}`,
          label: (entry.label || '').trim() || `ショートカット ${i + 1}`,
          icon: String(i + 1),
          category: 'shortcut',
          badge: `[${i + 1}]`,
          keywords: ['shortcut', 'ショートカット', String(i + 1)],
          _url: (() => {
            const host = String(entry.host || '').replace(/\/$/, '');
            const appId = String(entry.appId || '').trim();
            const type = entry.type || 'appTop';
            if (!host || !appId) return '';
            if (type === 'create') return `${host}/k/${encodeURIComponent(appId)}/edit`;
            const base = `${host}/k/${encodeURIComponent(appId)}/`;
            if (type === 'view') {
              const view = String(entry.viewIdOrName || '').trim();
              if (view) return `${base}?view=${encodeURIComponent(view)}`;
            }
            return base;
          })(),
          action(ctx, palette) {
            const url = this._url;
            if (!url) return;
            window.open(url, '_blank', 'noopener,noreferrer');
          }
        }));
      } catch (_) {
        this.shortcutCommands = [];
      }
    }

    async copyFieldCodes(ctx) {
      try {
        const res = await this.postFn('CP_GET_FIELDS', { appId: ctx.appId });
        if (!res?.ok) {
          cpShowToast('フィールド情報の取得に失敗しました', false);
          return;
        }
        const fields = Array.isArray(res.result?.fields) ? res.result.fields : [];
        const text = fields.map((f) => `${f.code}\t${f.label || ''}\t${f.type || ''}`).join('\n');
        await cpCopyText(text, `フィールドコード ${fields.length}件をコピーしました`);
      } catch (_) {
        cpShowToast('フィールド情報の取得に失敗しました', false);
      }
    }

    async copyFormDefinition(ctx) {
      try {
        const res = await this.postFn('CP_GET_FORM_DEFINITION', { appId: ctx.appId });
        if (!res?.ok) {
          cpShowToast('フォーム定義の取得に失敗しました', false);
          return;
        }
        const properties = res.result?.properties || {};
        await cpCopyText(JSON.stringify(properties, null, 2), 'フォーム定義(JSON)をコピーしました');
      } catch (_) {
        cpShowToast('フォーム定義の取得に失敗しました', false);
      }
    }

    buildAclItems(ctx) {
      const appId = ctx.appId;
      return [
        { id: 'acl-app', label: 'アプリのアクセス権', icon: '⚙', badge: 'app', action: () => { window.location.href = `/k/admin/app/acl/app?app=${appId}`; } },
        { id: 'acl-record', label: 'レコードのアクセス権', icon: '⚙', badge: 'record', action: () => { window.location.href = `/k/admin/app/acl/record?app=${appId}`; } },
        { id: 'acl-field', label: 'フィールドのアクセス権', icon: '⚙', badge: 'field', action: () => { window.location.href = `/k/admin/app/acl/field?app=${appId}`; } }
      ];
    }

    buildNotificationItems(ctx) {
      const appId = ctx.appId;
      return [
        { id: 'notify-app', label: '全般通知', icon: '⚙', badge: 'app', action: () => { window.location.href = `/k/admin/app/notification?app=${appId}&trigger=app`; } },
        { id: 'notify-record', label: 'レコード単位の通知', icon: '⚙', badge: 'record', action: () => { window.location.href = `/k/admin/app/notification?app=${appId}&trigger=record`; } },
        { id: 'notify-reminder', label: 'リマインダー通知', icon: '⚙', badge: 'reminder', action: () => { window.location.href = `/k/admin/app/notification?app=${appId}&trigger=reminder`; } }
      ];
    }

    async startSubPicker(kind) {
      this.subPickerKind = kind;
      const PLACEHOLDERS = {
        view: 'ビュー名を検索...',
        graph: 'グラフ名を検索...',
        acl: '種類を選択...',
        notification: '種類を選択...'
      };
      if (this.inputEl) {
        this.inputEl.value = '';
        this.inputEl.placeholder = PLACEHOLDERS[kind] || '検索...';
        this.inputEl.focus();
      }
      if (kind === 'acl') { this.staticSubItems = this.buildAclItems(this.ctx); this.filter(''); return; }
      if (kind === 'notification') { this.staticSubItems = this.buildNotificationItems(this.ctx); this.filter(''); return; }
      this.filter('');
      if (kind === 'view') await this.loadViewPickerItems();
      if (kind === 'graph') await this.loadReportItems();
    }

    async loadViewPickerItems() {
      const appId = this.ctx.appId;
      if (!appId) { this.viewPickerItems = []; return; }
      if (this.viewPickerLoadedAppId === appId && this.viewPickerItems.length) {
        if (this.isOpen && this.subPickerKind === 'view') this.filter(this.inputEl?.value || '');
        return;
      }
      try {
        const res = await this.postFn('META_GET_VIEWS', { appId, source: 'command_palette' });
        if (!res?.ok) { this.viewPickerItems = []; return; }
        const views = res.views && typeof res.views === 'object' ? res.views : {};
        this.viewPickerItems = Object.values(views)
          .map((v) => ({
            id: `view-${v.id}`,
            label: v.name || `view-${v.id}`,
            icon: '▤',
            badge: v.type || '',
            action: () => {
              window.location.href = buildCurrentTenantUrl(appId, { viewId: v.id });
            }
          }))
          .sort((a, b) => String(a.label).localeCompare(String(b.label), 'ja'));
        this.viewPickerLoadedAppId = appId;
      } catch (_) {
        this.viewPickerItems = [];
      } finally {
        if (this.isOpen && this.subPickerKind === 'view') this.filter(this.inputEl?.value || '');
      }
    }

    async loadReportItems() {
      const appId = this.ctx.appId;
      if (!appId) { this.reportItems = []; return; }
      if (this.reportItemsLoadedAppId === appId && this.reportItems.length) {
        if (this.isOpen && this.subPickerKind === 'graph') this.filter(this.inputEl?.value || '');
        return;
      }
      try {
        const res = await this.postFn('CP_GET_REPORTS', { appId });
        if (!res?.ok) { this.reportItems = []; return; }
        const reports = Array.isArray(res.result?.reports) ? res.result.reports : [];
        this.reportItems = reports
          .map((r) => {
            const reportId = r?.id != null ? String(r.id) : '';
            return {
              id: `report-${reportId || r?.name || ''}`,
              label: r?.name || `report-${reportId}`,
              icon: '▲',
              badge: r?.chartType || 'graph',
              action: () => {
                window.location.href = reportId
                  ? `${location.origin}/k/${appId}/report?report=${reportId}`
                  : `${location.origin}/k/${appId}/report`;
              }
            };
          })
          .sort((a, b) => String(a.label).localeCompare(String(b.label), 'ja'));
        this.reportItemsLoadedAppId = appId;
      } catch (_) {
        this.reportItems = [];
      } finally {
        if (this.isOpen && this.subPickerKind === 'graph') this.filter(this.inputEl?.value || '');
      }
    }

    normalizeHost(host) {
      const raw = String(host || '').trim();
      if (!raw) return '';
      try {
        return new URL(raw).origin.replace(/\/$/, '').toLowerCase();
      } catch (_) {
        return raw.replace(/\/$/, '').toLowerCase();
      }
    }

    async loadAppCatalog(forceRefresh = false) {
      const host = this.normalizeHost(location.origin || '');
      if (!host) return;
      if (!forceRefresh && (this.appCatalogLoading || (this.appCatalogLoaded && this.appCatalogHost === host))) return;
      this.appCatalogLoading = true;
      this.appCatalogHost = host;
      try {
        const res = await chrome.runtime.sendMessage({
          type: 'GET_APP_SEARCH_CATALOG',
          payload: { host, forceRefresh }
        });
        const map = res?.map && typeof res.map === 'object' ? res.map : {};
        this.appCatalog = Object.entries(map)
          .map(([appIdRaw, nameRaw]) => {
            const appId = String(appIdRaw || '').trim();
            const name = String(nameRaw || '').trim();
            if (!/^\d+$/.test(appId) || !name) return null;
            return {
              id: `app-search-${host}-${appId}`,
              label: name,
              icon: '⌕',
              category: 'app',
              badge: `app:${appId}`,
              appId,
              host,
              searchText: `${name}\n${appId}`.toLowerCase(),
              action: async (_ctx, _palette, options = {}) => {
                const url = `${host}/k/${encodeURIComponent(appId)}/`;
                if (options.newTab) {
                  try {
                    const res = await chrome.runtime.sendMessage({
                      type: 'PB_OPEN_APP_SEARCH_TAB',
                      payload: { url }
                    });
                    if (res?.ok) return;
                  } catch (_) {
                    // Fall back to browser default when the service worker is unavailable.
                  }
                  window.open(url, '_blank');
                  return;
                }
                window.location.href = url;
              }
            };
          })
          .filter(Boolean)
          .sort((a, b) => {
            const byName = String(a.label || '').localeCompare(String(b.label || ''), 'ja');
            if (byName !== 0) return byName;
            return String(a.appId || '').localeCompare(String(b.appId || ''), 'ja');
          });
        this.appCatalogLoaded = true;
        if (this.isOpen) this.filter(this.inputEl?.value || '');
      } catch (_) {
        this.appCatalog = [];
        this.appCatalogLoaded = true;
      } finally {
        this.appCatalogLoading = false;
      }
    }

    buildAppCatalogRefreshItem() {
      return {
        id: 'refresh-app-catalog-inline',
        label: 'アプリ一覧キャッシュを更新',
        icon: '⟳',
        badge: 'refresh',
        keepOpen: true,
        action: async (_ctx, palette) => { await palette.refreshAppCatalog(); }
      };
    }

    searchApps(query, limit = 8) {
      const q = String(query || '').trim().toLowerCase();
      if (!q) return [];
      const prefix = [];
      const partial = [];
      this.appCatalog.forEach((app) => {
        const label = String(app.label || '').toLowerCase();
        const appId = String(app.appId || '').toLowerCase();
        if (label.startsWith(q) || appId.startsWith(q)) {
          prefix.push(app);
          return;
        }
        if (app.searchText.includes(q)) {
          partial.push(app);
        }
      });
      return [...prefix, ...partial].slice(0, limit);
    }

    startAppSearch() {
      this.appSearchMode = true;
      if (this.inputEl) {
        this.inputEl.value = '';
        this.inputEl.placeholder = 'App名またはApp IDを検索...';
        this.inputEl.focus();
      }
      this.loadAppCatalog();
      this.filter('');
    }

    async refreshAppCatalog() {
      if (this.inputEl) this.inputEl.placeholder = 'アプリ一覧を更新しています...';
      this.appCatalogLoaded = false;
      await this.loadAppCatalog(true);
      if (this.inputEl) {
        this.inputEl.placeholder = this.appSearchMode ? 'App名またはApp IDを検索...' : 'コマンドを検索...';
      }
      if (this.appSearchMode) this.filter(this.inputEl?.value || '');
    }

    mount() {
      const backdrop = document.createElement('div');
      backdrop.id = 'pb-command-palette-backdrop';
      backdrop.addEventListener('mousedown', (e) => {
        if (e.target === backdrop) this.close();
      });

      const panel = document.createElement('div');
      panel.id = 'pb-command-palette';

      const searchWrap = document.createElement('div');
      searchWrap.className = 'pb-cp__search-wrap';

      const icon = document.createElement('span');
      icon.className = 'pb-cp__search-icon';
      icon.textContent = '⌕';

      const input = document.createElement('input');
      input.className = 'pb-cp__search-input';
      input.type = 'text';
      input.placeholder = 'コマンドを検索...';
      input.autocomplete = 'off';
      input.spellcheck = false;
      input.addEventListener('input', () => this.filter(input.value));
      input.addEventListener('keydown', (e) => {
        e.stopPropagation();
        this.handleKey(e);
      });
      this.inputEl = input;

      searchWrap.append(icon, input);

      const list = document.createElement('div');
      list.className = 'pb-cp__list';
      this.listEl = list;

      const footer = document.createElement('div');
      footer.className = 'pb-cp__footer';
      footer.innerHTML = '<span><kbd>↑↓</kbd> 移動</span><span><kbd>Enter</kbd> 実行</span><span><kbd>Esc</kbd> 閉じる</span>';
      this.footerEl = footer;

      const shortcutBar = document.createElement('div');
      shortcutBar.className = 'pb-cp__shortcut-bar';
      this.shortcutBarEl = shortcutBar;

      const style = document.createElement('style');
      style.textContent = `
        #pb-command-palette-backdrop{position:fixed!important;inset:0!important;background:rgba(0,0,0,.4)!important;z-index:2147483647!important;display:none!important;align-items:flex-start!important;justify-content:center!important;padding-top:12vh!important}
        #pb-command-palette-backdrop[style*="flex"]{display:flex!important}
        #pb-command-palette{width:560px!important;max-width:calc(100vw - 32px)!important;background:#fff!important;border-radius:12px!important;box-shadow:0 24px 64px rgba(0,0,0,.25),0 4px 16px rgba(0,0,0,.12)!important;overflow:hidden!important;display:flex!important;flex-direction:column!important;max-height:72vh!important;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif!important;font-size:14px!important;line-height:1.5!important;color:#374151!important}
        #pb-command-palette *{box-sizing:border-box!important;margin:0!important;padding:0!important}
        #pb-command-palette .pb-cp__search-wrap{display:flex!important;align-items:center!important;padding:0 14px!important;border-bottom:1px solid #e5e7eb!important;gap:10px!important;flex-shrink:0!important}
        #pb-command-palette .pb-cp__search-icon{color:#9ca3af!important;font-size:20px!important;flex-shrink:0!important;line-height:1!important}
        #pb-command-palette .pb-cp__search-input{flex:1!important;border:none!important;outline:none!important;height:48px!important;font-size:15px!important;color:#111827!important;background:transparent!important;font-family:inherit!important;box-shadow:none!important;width:auto!important}
        #pb-command-palette .pb-cp__search-input::placeholder{color:#9ca3af!important}
        #pb-command-palette .pb-cp__list{overflow-y:auto!important;padding:6px 0!important;flex:1!important;min-height:0!important}
        #pb-command-palette .pb-cp__group-label{padding:10px 16px 4px!important;font-size:10px!important;font-weight:700!important;color:#9ca3af!important;letter-spacing:.1em!important;text-transform:uppercase!important;display:block!important}
        #pb-command-palette .pb-cp__item{display:flex!important;align-items:center!important;gap:10px!important;padding:8px 14px!important;cursor:pointer!important;font-size:13px!important;color:#374151!important;background:transparent!important;width:100%!important}
        #pb-command-palette .pb-cp__item:hover,#pb-command-palette .pb-cp__item--active{background:#eff6ff!important;color:#1d4ed8!important}
        #pb-command-palette .pb-cp__item-icon{width:28px!important;height:28px!important;display:flex!important;align-items:center!important;justify-content:center!important;background:#f3f4f6!important;border-radius:6px!important;font-size:13px!important;flex-shrink:0!important;color:#6b7280!important}
        #pb-command-palette .pb-cp__item--active .pb-cp__item-icon{background:#dbeafe!important;color:#1d4ed8!important}
        #pb-command-palette .pb-cp__item-text{flex:1!important;min-width:0!important;display:flex!important;flex-direction:column!important;gap:1px!important}
        #pb-command-palette .pb-cp__item-label{white-space:nowrap!important;overflow:hidden!important;text-overflow:ellipsis!important}
        #pb-command-palette .pb-cp__item-sub{font-size:11px!important;color:#9ca3af!important;white-space:nowrap!important;overflow:hidden!important;text-overflow:ellipsis!important}
        #pb-command-palette .pb-cp__item--active .pb-cp__item-sub{color:#60a5fa!important}
        #pb-command-palette .pb-cp__item-badge{font-size:10px!important;padding:2px 8px!important;border-radius:9999px!important;background:#f3f4f6!important;color:#6b7280!important;font-weight:600!important;font-family:ui-monospace,monospace!important;flex-shrink:0!important;white-space:nowrap!important;letter-spacing:.02em!important}
        #pb-command-palette .pb-cp__item--active .pb-cp__item-badge{background:#dbeafe!important;color:#3b82f6!important}
        #pb-command-palette .pb-cp__empty{padding:32px 16px!important;text-align:center!important;color:#9ca3af!important;font-size:13px!important;display:block!important}
        #pb-command-palette .pb-cp__shortcut-bar{border-top:1px solid #e5e7eb!important;padding:8px 12px!important;display:flex!important;gap:6px!important;flex-wrap:wrap!important;flex-shrink:0!important;background:#fafafa!important}
        #pb-command-palette .pb-cp__shortcut-bar:empty{display:none!important}
        #pb-command-palette .pb-cp__sc-btn{display:flex!important;align-items:center!important;gap:5px!important;padding:4px 8px!important;border-radius:6px!important;border:1px solid #e5e7eb!important;background:#fff!important;cursor:pointer!important;font-size:12px!important;color:#374151!important;font-family:inherit!important;max-width:100px!important;transition:background .1s,border-color .1s!important}
        #pb-command-palette .pb-cp__sc-btn:hover{background:#eff6ff!important;border-color:#bfdbfe!important;color:#1d4ed8!important}
        #pb-command-palette .pb-cp__sc-btn-num{font-size:10px!important;font-weight:700!important;background:#f3f4f6!important;border-radius:3px!important;padding:0 4px!important;color:#9ca3af!important;font-family:ui-monospace,monospace!important;flex-shrink:0!important}
        #pb-command-palette .pb-cp__sc-btn:hover .pb-cp__sc-btn-num{background:#dbeafe!important;color:#3b82f6!important}
        #pb-command-palette .pb-cp__sc-btn-label{white-space:nowrap!important;overflow:hidden!important;text-overflow:ellipsis!important}
        #pb-command-palette .pb-cp__footer{border-top:1px solid #f3f4f6!important;padding:8px 16px!important;display:flex!important;gap:16px!important;font-size:11px!important;color:#9ca3af!important;flex-shrink:0!important}
        #pb-command-palette .pb-cp__footer kbd{display:inline-block!important;background:#f3f4f6!important;border:1px solid #e5e7eb!important;border-radius:4px!important;padding:1px 5px!important;font-size:10px!important;color:#6b7280!important;font-family:inherit!important}
      `;

      panel.append(searchWrap, list, shortcutBar, footer);
      backdrop.append(style, panel);
      document.body.appendChild(backdrop);
      this.backdropEl = backdrop;
    }

    renderShortcutBar() {
      if (!this.shortcutBarEl) return;
      this.shortcutBarEl.innerHTML = '';
      this.shortcutCommands.forEach((cmd, i) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'pb-cp__sc-btn';
        btn.title = cmd.label;

        const num = document.createElement('span');
        num.className = 'pb-cp__sc-btn-num';
        num.textContent = String(i + 1);

        const label = document.createElement('span');
        label.className = 'pb-cp__sc-btn-label';
        label.textContent = cmd.label;

        btn.append(num, label);
        btn.addEventListener('mousedown', (e) => {
          e.preventDefault();
          cmd.action(this.ctx, this);
          this.close();
        });
        this.shortcutBarEl.appendChild(btn);
      });
    }

    filter(query) {
      const q = String(query || '').trim().toLowerCase();
      if (this.appSearchMode) {
        this.filtered = this.searchApps(q);
        if (q && APP_CATALOG_REFRESH_KEYWORDS.some((k) => k.includes(q))) {
          this.filtered = [this.buildAppCatalogRefreshItem(), ...this.filtered];
        }
        this.activeIndex = 0;
        this.renderFooter();
        this.renderList();
        return;
      }
      if (this.subPickerKind) {
        let scoped;
        if (this.subPickerKind === 'view') scoped = this.viewPickerItems;
        else if (this.subPickerKind === 'graph') scoped = this.reportItems;
        else scoped = this.staticSubItems;
        this.filtered = q ? scoped.filter((v) => String(v.label).toLowerCase().includes(q)) : scoped;
        this.activeIndex = 0;
        this.renderFooter();
        this.renderList();
        return;
      }
      const allCmds = [...CP_COMMANDS, ...this.shortcutCommands];
      const cmds = allCmds.filter((cmd) => {
        if (cmd.requiresApp && !this.ctx.appId) return false;
        if (cmd.requiresRecord && !this.ctx.recordId) return false;
        if (!q) return true;
        if (cmd.label.toLowerCase().includes(q)) return true;
        return (cmd.keywords || []).some((k) => k.toLowerCase().includes(q));
      });
      this.filtered = cmds;
      this.activeIndex = 0;
      this.renderFooter();
      this.renderList();
    }

    renderFooter() {
      if (!this.footerEl) return;
      if (this.appSearchMode) {
        this.footerEl.innerHTML = '<span><kbd>↑↓</kbd> 移動</span><span><kbd>Enter</kbd> 開く</span><span><kbd>Shift</kbd>+<kbd>Enter</kbd> 新規タブ</span><span><kbd>Esc</kbd> 閉じる</span>';
      } else if (this.subPickerKind) {
        this.footerEl.innerHTML = '<span><kbd>↑↓</kbd> 移動</span><span><kbd>Enter</kbd> 開く</span><span><kbd>Esc</kbd> 閉じる</span>';
      } else {
        const shortcutHint = this.shortcutCommands.length
          ? '<span><kbd>1-9</kbd> ショートカット</span>'
          : '';
        this.footerEl.innerHTML = `<span><kbd>↑↓</kbd> 移動</span><span><kbd>Enter</kbd> 実行</span>${shortcutHint}<span><kbd>Esc</kbd> 閉じる</span>`;
      }
    }

    renderList() {
      if (!this.listEl) return;
      this.listEl.innerHTML = '';
      if (!this.filtered.length) {
        const empty = document.createElement('div');
        empty.className = 'pb-cp__empty';
        if (this.appSearchMode) {
          const q = String(this.inputEl?.value || '').trim();
          empty.textContent = this.appCatalogLoading
            ? 'App一覧を読み込んでいます...'
            : (q ? '該当するAppが見つかりません' : 'App名またはApp IDを入力してください');
        } else if (this.subPickerKind) {
          const emptyText = {
            view: 'ビューが見つかりません',
            graph: 'グラフビューが見つかりません',
            acl: '項目が見つかりません',
            notification: '項目が見つかりません'
          };
          empty.textContent = emptyText[this.subPickerKind] || '該当する項目が見つかりません';
        } else {
          empty.textContent = '該当するコマンドが見つかりません';
        }
        this.listEl.appendChild(empty);
        return;
      }
      const CATEGORY_LABELS = {
        shortcut: 'SHORTCUTS', admin: 'ADMIN', dev: 'DEV', app: 'APP',
        nav: 'NAV', list: 'LIST', record: 'RECORD', help: 'HELP'
      };
      let lastCategory = null;
      this.filtered.forEach((cmd, i) => {
        if (cmd.category && cmd.category !== lastCategory) {
          const grp = document.createElement('div');
          grp.className = 'pb-cp__group-label';
          grp.textContent = CATEGORY_LABELS[cmd.category] || cmd.category.toUpperCase();
          this.listEl.appendChild(grp);
          lastCategory = cmd.category;
        }

        const item = document.createElement('div');
        item.className = 'pb-cp__item' + (i === this.activeIndex ? ' pb-cp__item--active' : '');

        const icon = document.createElement('span');
        icon.className = 'pb-cp__item-icon';
        icon.textContent = cmd.icon || '›';

        const text = document.createElement('span');
        text.className = 'pb-cp__item-text';

        const label = document.createElement('span');
        label.className = 'pb-cp__item-label';
        label.textContent = cmd.label;
        text.appendChild(label);

        if (cmd.category === 'app' && cmd.appId) {
          const sub = document.createElement('span');
          sub.className = 'pb-cp__item-sub';
          sub.textContent = cmd.host || location.origin || '';
          text.appendChild(sub);
        }

        const badge = document.createElement('span');
        badge.className = 'pb-cp__item-badge';
        badge.textContent = cmd.badge || '';

        item.append(icon, text, badge);
        item.addEventListener('mousedown', (e) => {
          e.preventDefault();
          this.execute(i);
        });
        item.addEventListener('mousemove', () => {
          if (this.activeIndex !== i) {
            this.activeIndex = i;
            this.renderList();
          }
        });
        this.listEl.appendChild(item);
      });
      const activeEl = this.listEl.querySelector('.pb-cp__item--active');
      if (activeEl) activeEl.scrollIntoView({ block: 'nearest' });
    }

    handleKey(e) {
      if (e.key === 'Escape') { this.close(); return; }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        this.activeIndex = Math.min(this.activeIndex + 1, this.filtered.length - 1);
        this.renderList();
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        this.activeIndex = Math.max(this.activeIndex - 1, 0);
        this.renderList();
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        this.execute(this.activeIndex, { newTab: this.appSearchMode && e.shiftKey });
        return;
      }
      // 検索欄が空のとき、1-9キーで番号ショートカットを直接実行する
      if (
        !this.appSearchMode && !this.subPickerKind &&
        /^[1-9]$/.test(e.key) && !e.ctrlKey && !e.metaKey && !e.altKey &&
        !(this.inputEl && this.inputEl.value)
      ) {
        const cmd = this.shortcutCommands[Number(e.key) - 1];
        if (cmd) {
          e.preventDefault();
          this.close();
          cmd.action(this.ctx, this);
          return;
        }
      }
    }

    execute(index, options = {}) {
      const cmd = this.filtered[index];
      if (!cmd) return;
      if (!cmd.keepOpen) this.close();
      if (cmd.isAsync) {
        cmd.action(this.ctx, this, options);
      } else {
        cmd.action(this.ctx, this, options);
      }
    }

    async open() {
      if (!this.backdropEl) this.mount();
      await Promise.all([this.fetchContext(), this.fetchShortcutCommands()]);
      this.backdropEl.style.display = 'flex';
      this.isOpen = true;
      this.appSearchMode = false;
      this.subPickerKind = null;
      this.renderShortcutBar();
      this.filter('');
      if (this.inputEl) {
        this.inputEl.value = '';
        this.inputEl.placeholder = 'コマンドを検索...';
        this.inputEl.focus();
      }
    }

    close() {
      if (this.backdropEl) this.backdropEl.style.display = 'none';
      this.isOpen = false;
    }

    toggle() {
      if (this.isOpen) this.close(); else this.open();
    }
  }

  const commandPalette = new CommandPalette(postToPage);

  document.addEventListener('keydown', (e) => {
    if (e.key === '/' && (e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey) {
      e.preventDefault();
      commandPalette.toggle();
      return;
    }
    // '?' でチートシートを表示（入力中・編集中は反応しない）
    if (e.key === '?' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const t = e.target;
      const isEditable = Boolean(
        t && (
          t.tagName === 'INPUT' ||
          t.tagName === 'TEXTAREA' ||
          t.tagName === 'SELECT' ||
          t.isContentEditable ||
          (typeof t.closest === 'function' && t.closest('[contenteditable="true"]'))
        )
      );
      if (isEditable || commandPalette.isOpen) return;
      e.preventDefault();
      cpToggleCheatsheet(true);
      return;
    }
  }, true);

  // ── End Command Palette ──────────────────────────────────────────────────
