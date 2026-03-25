// options.js
const DEFAULT_PANE = 'general';
const menuButtons = Array.from(document.querySelectorAll('[data-pane-target]'));
const panes = Array.from(document.querySelectorAll('[data-pane]'));

function activatePane(target, options = {}) {
  const { updateHash = true } = options;
  const next = panes.some((pane) => pane.dataset.pane === target) ? target : DEFAULT_PANE;
  panes.forEach((pane) => {
    pane.classList.toggle('is-active', pane.dataset.pane === next);
  });
  menuButtons.forEach((btn) => {
    btn.classList.toggle('is-active', btn.dataset.paneTarget === next);
  });
  if (updateHash) {
    const newHash = `#${next}`;
    if (window.location.hash !== newHash) {
      let replaced = false;
      if (typeof history !== 'undefined' && typeof history.replaceState === 'function') {
        try {
          history.replaceState(null, '', newHash);
          replaced = true;
        } catch (_err) {
          // ignore fallback below
        }
      }
      if (!replaced) {
        try {
          window.location.hash = newHash;
        } catch (_err) {
          // ignore hash update failures
        }
      }
    }
  }
}

menuButtons.forEach((btn) => {
  btn.addEventListener('click', () => {
    activatePane(btn.dataset.paneTarget);
  });
});

window.addEventListener('hashchange', () => {
  activatePane(window.location.hash.slice(1), { updateHash: false });
});

activatePane(window.location.hash.slice(1) || DEFAULT_PANE, { updateHash: false });

const I18N_MESSAGES = {
  ja: {
    settings_title: 'PlugBits Launcher 設定',
    settings_menu_aria: '設定メニュー',
    nav_general: '全般',
    nav_shortcuts: 'ショートカット',
    nav_watchlist: 'ウォッチリスト',
    nav_pins: 'ピン止め',
    nav_excel_overlay: 'スプレッドシート',
    nav_api_usage: 'API使用状況',
    general_section_title: '全般',
    general_intro_1: 'PlugBits Launcher は、kintone を横断的に閲覧・操作するための Chrome 拡張機能です。各機能は左メニューから切り替えて設定できます。',
    general_intro_2: '設定は自動で保存され、同期が有効になっている場合は同じ Google アカウントで Chrome を使用する他端末にも共有されます。',
    general_tips_title: '使い方のヒント',
    general_tip_watchlist: 'ウォッチリストに登録したアプリはサイドパネルから素早く開けます。',
    general_tip_pins: 'ピン止めは重要レコードをメモ付きで保存できます。',
    general_tip_shortcuts: 'ショートカットはよく使う画面を Chrome から直接開くためのリンクです。',
    general_language_label: '言語',
    general_language_auto: 'Auto',
    general_language_ja: '日本語',
    general_language_en: 'English',
    general_language_help: 'Auto はPCまたはブラウザの表示言語に合わせます。',
    shortcuts_section_title: 'ショートカット',
    watchlist_section_title: 'ウォッチリスト',
    watchlist_refresh_preset_label: 'WatchList 更新頻度',
    watchlist_refresh_preset_eco: '省エネ',
    watchlist_refresh_preset_normal: '標準',
    watchlist_refresh_preset_fast: '高頻度',
    watchlist_refresh_preset_hint: '短くすると更新は早くなりますが、API消費は増えます。',
    watchlist_refresh_preset_warn: '高頻度設定は自己責任で使用してください。',
    pins_section_title: 'ピン止め',
    overlay_section_title: 'スプレッドシート',
    overlay_section_desc: 'kintone 一覧画面で スプレッドシートビュー を利用します。利用モードに応じて、無効・Standard・Pro を切り替えます。',
    overlay_mode_label: '利用モード',
    overlay_mode_disabled: '無効',
    overlay_mode_disabled_desc: 'スプレッドシートビュー を起動しません。標準の kintone 一覧を使用します。',
    overlay_mode_standard: 'Standard',
    overlay_mode_standard_desc: 'スプレッドシートビュー のフィルタ・ソート・コピー・列レイアウト変更は可能です。編集と保存は利用できません。',
    overlay_mode_pro: 'Pro',
    overlay_mode_pro_desc: '編集機能を利用できる上位モードです。近日公開予定。',
    overlay_mode_pro_notice: 'Proモードは近日公開予定です。現在はStandardをご利用ください。',
    overlay_layout_title: '列レイアウト設定',
    overlay_layout_desc: 'アプリごとに保存された Overlay レイアウトプリセットを確認・管理します。Overlay 本体と同じ設定を表示します。',
    overlay_layout_active: 'active',
    overlay_layout_active_badge: '使用中',
    overlay_layout_presets: 'プリセット数',
    overlay_layout_key: 'キー',
    overlay_layout_visible_columns: '表示列',
    overlay_layout_order_preview: '並び順(先頭)',
    overlay_layout_set_active: '既定にする',
    overlay_layout_delete_app: 'このアプリ設定を削除',
    overlay_layout_rename: '名前編集',
    overlay_layout_prompt_name: 'プリセット名を入力してください',
    overlay_layout_delete_preset_confirm: 'このプリセットを削除します。よろしいですか？',
    overlay_layout_delete_app_confirm: 'このアプリの Overlay レイアウト設定を削除します。よろしいですか？',
    overlay_layout_detail_name: '詳細画面',
    overlay_note_title: '補足',
    overlay_note_desc: '今後、列表示設定や固定列などもこのセクションに追加予定です。',
    host_perm_title: 'ホストアクセス許可',
    host_perm_desc: 'kintone の URL（例：https://xxx.cybozu.com/k/）を入力して「このホストを許可」を押すと、件数取得やショートカットが自動的に動作できるようになります。',
    host_perm_input_label: 'kintone URL またはホスト',
    host_perm_input_placeholder: '例：https://example.cybozu.com/k/',
    host_perm_request_btn: 'このホストを許可',
    host_perm_check_btn: '状態を確認',
    host_perm_status_unknown: '権限: 未確認',
    host_perm_status_granted: '権限: 許可済み',
    host_perm_status_denied: '権限: 未許可',
    host_perm_hint: 'InPrivate で利用する場合は拡張機能の「InPrivate で許可」をオンにしてから実行してください。',
    watch_label_optional: '表示名（任意）',
    watch_label_label: '表示名',
    watch_url_label: 'kintone URL（アプリ／ビュー）',
    watch_category_optional: 'カテゴリ（任意）',
    watch_icon_label: 'アイコン',
    watch_icon_color_label: 'アイコン色',
    watch_icon_hint: '※ アイコンと色はショートカット/ウォッチ行に反映されます。カテゴリはサイドパネルのグループ分けに利用されます。',
    common_advanced_settings_manual: '高度な設定（手動指定）',
    watch_app_id_label: 'App ID',
    watch_view_label: 'View ID/Name',
    watch_query_optional_label: 'Query（任意）',
    watch_view_query_hint: '※ View を指定するとそのフィルタ条件で件数カウント。Query を指定した場合は View より優先します。',
    watch_advanced_hint: '通常は URL から自動取得されます。必要な場合のみ手動で指定してください。',
    watch_limit_hint: '現在の登録上限: {limit}件（登録済み: {count}件）',
    watch_limit_reached: 'ウォッチリストは{limit}件まで登録できます',
    watch_item_needs_repair: '要修復',
    watch_edit_hint: '※ アイコンと色、カテゴリはショートカット／サイドパネルでそのまま利用されます。',
    watch_edit_query_hint: '※ Query を指定した場合は View より優先します。',
    watch_placeholder_label: '例：受注一覧（未出荷）',
    watch_placeholder_url: '例：https://xxx.cybozu.com/k/45/?view=123',
    watch_placeholder_category: '例：営業',
    watch_placeholder_app_id: '45',
    watch_placeholder_view: '123 または ビュー名',
    watch_placeholder_query: 'ステータス in ("未出荷")',
    common_add: '追加',
    watch_registered_title: '登録済みウォッチリスト',
    watch_registered_hint: 'ドラッグで並び替え。右上のアイコンで固定・開く・編集・削除ができます。詳細は各カードの「詳細」を展開してください。',
    pins_intro_hint: '※ 気になるレコードを登録すると、サイドパネルの専用タブでメモ付きで表示できます。',
    pins_visible_label: 'サイドパネルにレコードピンを表示する',
    pins_visible_hint: 'この設定をオフにするとサイドパネルからレコードピンカード全体が非表示になります。',
    pins_add_title: 'ピン留めレコードを追加',
    pins_label_optional: '表示名（任意）',
    pins_url_label: 'kintone レコード URL',
    pins_app_id_label: 'App ID',
    pins_record_id_label: 'レコードID',
    pins_note_optional: '初期メモ（任意）',
    pins_title_field_optional: 'タイトル用フィールドコード（任意）',
    pins_placeholder_label: '例：重要案件A',
    pins_placeholder_url: '例：https://xxx.cybozu.com/k/45/show#record=12',
    pins_placeholder_app_id: '45',
    pins_placeholder_record_id: '12',
    pins_placeholder_note: 'サイドパネルで編集できます',
    pins_placeholder_title_field: '例：件名',
    pins_reset_btn: '入力をクリア',
    pins_registered_title: '登録済みピン',
    pins_registered_hint: 'カード右上のアイコンで開く・編集・削除ができます。詳細情報は「詳細」を展開してください。',
    shortcuts_hint: 'サイドパネル右端のショートカットボタンを管理します。右クリックメニューから追加できます。',
    shortcuts_visible_label: 'ショートカットを表示する',
    shortcuts_search_mode_label: 'ショートカット検索の開き方',
    shortcuts_open_current_tab: '現在のタブ',
    shortcuts_open_new_tab: '新しいタブ',
    shortcuts_list_hint: '並び順はドラッグで変更できます。削除は各行の削除ボタンから行えます。',
    dialog_watch_edit_title: 'ウォッチリストを編集',
    dialog_pin_edit_title: 'ピン止めを編集',
    dialog_close: '閉じる',
    dialog_apply_hint: '変更内容は保存時のみ反映されます。',
    common_cancel: 'キャンセル',
    common_save: '保存',
    reset_all: 'すべてリセット',
    clear_sort: '並びを解除',
    clear_width: '幅を解除',
    delete: '削除',
    confirm_clear_layouts: '保存済みの列レイアウトをすべて削除します。よろしいですか？',
    alert_invalid_kintone_url: '有効な kintone URL を入力してください',
    alert_host_permission_denied: 'このドメインへのアクセス権限が許可されませんでした',
    alert_duplicate_url: 'このURLは既に登録済みです',
    alert_watchlist_limit_reached: 'ウォッチリストは{limit}件まで登録できます',
    alert_watch_query_resolve_failed: 'ビューの Query を取得できませんでした。Query を直接入力するか、該当ビューURLで再保存してください',
    alert_watch_add_query_resolve_failed: 'ビュー条件を取得できなかったためウォッチリストを追加できませんでした',
    alert_required_pin_fields: 'host / App ID / レコードID は必須です',
    alert_dialog_not_supported: 'このブラウザはdialog要素に対応していません',
    alert_invalid_kintone_url_or_host: '有効な kintone URL またはホストを入力してください',
    alert_permission_cancelled: '許可がキャンセルされました',
    alert_permission_granted: '許可が完了しました',
    app_unspecified: 'App 未指定',
    view_unspecified: 'ビュー未指定',
    app_prefix: 'App',
    record_prefix: 'Record',
    record_unspecified: 'Record 未指定',
    category_other: 'その他',
    no_label: '(no label)',
    icon_color_gray: 'グレー',
    icon_color_blue: 'ブルー',
    icon_color_green: 'グリーン',
    icon_color_orange: 'オレンジ',
    icon_color_red: 'レッド',
    icon_color_purple: 'パープル',
    shortcut_type_appTop: 'アプリトップ',
    shortcut_type_view: 'ビュー',
    shortcut_type_create: 'レコード新規',
    shortcut_meta_type: '種別',
    shortcut_meta_host: 'Host',
    shortcut_meta_app: 'App',
    shortcut_meta_icon: 'Icon',
    shortcut_meta_color: '色',
    shortcut_meta_view: 'View',
    shortcut_empty: 'ショートカットはまだありません。',
    shortcut_drag_handle_title: 'ドラッグで並び替え',
    shortcut_editor_label: '表示名',
    shortcut_editor_icon: 'アイコン',
    shortcut_editor_icon_color: 'アイコン色',
    shortcut_save: '保存',
    shortcut_cancel: 'キャンセル',
    shortcut_open: '開く',
    shortcut_open_url_unavailable: '対象URLを生成できません',
    shortcut_edit: '編集',
    shortcut_close: '閉じる',
    shortcut_delete: '削除',
    pins_empty: '登録済みのピンはありません。',
    pins_open: '開く',
    pins_edit: '編集',
    pins_delete: '削除',
    pins_details: '詳細',
    pins_detail_host: 'Host',
    pins_detail_url: 'URL',
    pins_detail_app_id: 'App ID',
    pins_detail_record_id: 'Record ID',
    pins_detail_title_field: 'Title field',
    watch_empty: '登録済みのウォッチリストはまだありません。',
    watch_badge_target_title: 'このウォッチリストをバッジ対象にする',
    watch_pin_set: '固定する',
    watch_pin_remove: '固定を解除',
    watch_open: '開く',
    watch_edit: '編集',
    watch_delete: '削除',
    watch_details: '詳細',
    watch_detail_host: 'Host',
    watch_detail_url: 'URL',
    watch_detail_app: 'App',
    watch_detail_view: 'View',
    watch_detail_query: 'Query',
    watch_query_none: '条件なし',
    watch_detail_color: '色',
    watch_detail_category: 'カテゴリ',
    layout_empty_title: '保存済みの列レイアウトはありません。',
    layout_empty_desc: 'Overlay でプリセットを作成すると、ここに保存されます。',
    layout_meta_order: '列順',
    layout_meta_width: '幅設定',
    layout_meta_saved: '保存',
    layout_meta_scope: '対象',
    layout_scope_list: '一覧',
    layout_scope_detail: '詳細',
    api_usage_title: 'API使用状況',
    api_usage_desc:  'この拡張機能が発行したすべてのAPI呼び出しを、主要機能別に集約して表示します。',
    api_usage_scope_note: 'kintone全体のAPI使用量ではありません。',
    api_usage_period_today: 'Today',
    api_usage_period_7d: '7日',
    api_usage_period_30d: '30日',
    api_usage_total: 'Total',
    api_usage_success: 'Success',
    api_usage_error: 'Error',
    api_usage_by_feature_title: '機能別内訳',
    api_usage_feature: '機能',
    api_usage_reset: '統計をリセット',
    api_usage_reset_confirm: 'API使用統計をリセットします。よろしいですか？',
    api_usage_empty: 'データはまだありません。',
    api_usage_feature_watchlist: 'Watchlist',
    api_usage_feature_watchlist_bulk: 'Watchlist API Requests',
    api_usage_feature_record_pin: 'Record Pin',
    api_usage_feature_recent: 'Recent',
    api_usage_feature_overlay: 'Overlay',
    api_usage_feature_overlay_records: 'Overlay Records',
    api_usage_feature_overlay_acl: 'Overlay ACL',
    api_usage_feature_metadata_app: 'Metadata App',
    api_usage_feature_metadata_views: 'Metadata Views',
    api_usage_feature_metadata_fields: 'Metadata Fields',
    api_usage_feature_bootstrap: 'Bootstrap',
    api_usage_feature_admin: 'Admin',
    api_usage_feature_other: 'Other',
    metadata_cache_clear_btn: 'キャッシュを更新',
    metadata_cache_clear_desc: 'アプリ・ビュー・フィールド情報のキャッシュを更新します。',
    metadata_cache_clear_confirm: 'キャッシュを削除します。よろしいですか？',
    metadata_cache_clear_done: 'キャッシュを削除しました。',
    metadata_cache_clear_failed: 'キャッシュの削除に失敗しました。',
    api_usage_group_shortcuts: 'ショートカット',
    api_usage_group_watchlist: 'ウォッチリスト',
    api_usage_group_record_pin: 'ピン止め',
    api_usage_group_recent: '最近のレコード',
    api_usage_group_spreadsheet: 'スプレッドシート',
    api_usage_group_admin: '管理',
  },
  en: {
    settings_title: 'PlugBits Launcher Settings',
    settings_menu_aria: 'Settings menu',
    nav_general: 'General',
    nav_shortcuts: 'Shortcuts',
    nav_watchlist: 'Watchlist',
    nav_pins: 'Pins',
    nav_excel_overlay: 'Spreadsheet',
    nav_api_usage: 'API Usage',
    general_section_title: 'General',
    general_intro_1: 'PlugBits Launcher is a Chrome extension for browsing and operating kintone more efficiently across apps.',
    general_intro_2: 'Settings are saved automatically and synced across devices signed in with the same Google account when sync is enabled.',
    general_tips_title: 'Tips',
    general_tip_watchlist: 'Apps in your watchlist can be opened quickly from the side panel.',
    general_tip_pins: 'Pin records with notes to keep important items close.',
    general_tip_shortcuts: 'Shortcuts let you open frequent screens directly from Chrome.',
    general_language_label: 'Language',
    general_language_auto: 'Auto',
    general_language_ja: 'Japanese',
    general_language_en: 'English',
    general_language_help: 'Auto follows your PC or browser language.',
    shortcuts_section_title: 'Shortcuts',
    watchlist_section_title: 'Watchlist',
    watchlist_refresh_preset_label: 'WatchList refresh frequency',
    watchlist_refresh_preset_eco: 'Eco',
    watchlist_refresh_preset_normal: 'Normal',
    watchlist_refresh_preset_fast: 'Fast',
    watchlist_refresh_preset_hint: 'Shorter intervals improve freshness but increase API usage.',
    watchlist_refresh_preset_warn: 'Use fast mode at your own responsibility.',
    pins_section_title: 'Pins',
    overlay_section_title: 'Spreadsheet View',
    overlay_section_desc: 'Use Spreadsheet View on kintone list pages. Switch between Disabled, Standard, and Pro modes.',
    overlay_mode_label: 'Mode',
    overlay_mode_disabled: 'Disabled',
    overlay_mode_disabled_desc: 'Do not launch Spreadsheet View. Use the standard kintone list view.',
    overlay_mode_standard: 'Standard',
    overlay_mode_standard_desc: 'Spreadsheet View supports filtering, sorting, copying, and column layout changes. Editing and saving are disabled.',
    overlay_mode_pro: 'Pro',
    overlay_mode_pro_desc: 'Advanced mode with editing features. Coming soon.',
    overlay_mode_pro_notice: 'Pro mode is coming soon. Please use Standard for now.',
    overlay_layout_title: 'Column Layout Settings',
    overlay_layout_desc: 'Review and manage Overlay layout presets saved per app. This view uses the same storage as the Overlay screen.',
    overlay_layout_active: 'Active',
    overlay_layout_active_badge: 'Active',
    overlay_layout_presets: 'Presets',
    overlay_layout_key: 'Key',
    overlay_layout_visible_columns: 'Visible columns',
    overlay_layout_order_preview: 'Order (head)',
    overlay_layout_set_active: 'Set active',
    overlay_layout_delete_app: 'Delete app settings',
    overlay_layout_rename: 'Rename',
    overlay_layout_prompt_name: 'Enter preset name',
    overlay_layout_delete_preset_confirm: 'Delete this preset?',
    overlay_layout_delete_app_confirm: 'Delete all Overlay layout presets for this app?',
    overlay_layout_detail_name: 'Detail View',
    overlay_note_title: 'Notes',
    overlay_note_desc: 'Column visibility and fixed columns are planned to be added here in future updates.',
    host_perm_title: 'Host Access Permission',
    host_perm_desc: 'Enter a kintone URL (example: https://xxx.cybozu.com/k/) and click "Allow this host" to enable counts and shortcut actions.',
    host_perm_input_label: 'kintone URL or host',
    host_perm_input_placeholder: 'Example: https://example.cybozu.com/k/',
    host_perm_request_btn: 'Allow this host',
    host_perm_check_btn: 'Check status',
    host_perm_status_unknown: 'Permission: Unknown',
    host_perm_status_granted: 'Permission: Granted',
    host_perm_status_denied: 'Permission: Not granted',
    host_perm_hint: 'For InPrivate use, turn on "Allow in InPrivate" in extension settings before running.',
    watch_label_optional: 'Display name (optional)',
    watch_label_label: 'Display name',
    watch_url_label: 'kintone URL (app/view)',
    watch_category_optional: 'Category (optional)',
    watch_icon_label: 'Icon',
    watch_icon_color_label: 'Icon color',
    watch_icon_hint: 'Icon, color, and category are reflected in shortcut/watchlist rows in the side panel.',
    common_advanced_settings_manual: 'Advanced settings (manual)',
    watch_app_id_label: 'App ID',
    watch_view_label: 'View ID/Name',
    watch_query_optional_label: 'Query (optional)',
    watch_view_query_hint: 'If View is set, counts use that filter. If Query is set, Query takes priority.',
    watch_advanced_hint: 'Usually resolved from URL automatically. Set manually only when needed.',
    watch_limit_hint: 'Current limit: {limit} items (registered: {count})',
    watch_limit_reached: 'Watchlist is limited to {limit} items',
    watch_item_needs_repair: 'Needs repair',
    watch_edit_hint: 'Icon, color, and category are used directly in shortcuts and the side panel.',
    watch_edit_query_hint: 'If Query is set, Query takes priority over View.',
    watch_placeholder_label: 'Example: Orders (Unshipped)',
    watch_placeholder_url: 'Example: https://xxx.cybozu.com/k/45/?view=123',
    watch_placeholder_category: 'Example: Sales',
    watch_placeholder_app_id: '45',
    watch_placeholder_view: '123 or view name',
    watch_placeholder_query: 'Status in ("Unshipped")',
    common_add: 'Add',
    watch_registered_title: 'Saved Watchlist',
    watch_registered_hint: 'Drag to reorder. Use top-right icons to pin, open, edit, or delete. Expand "Details" on each card for more info.',
    pins_intro_hint: 'Pinned records are shown with notes in the side panel record pin section.',
    pins_visible_label: 'Show record pins in side panel',
    pins_visible_hint: 'When off, record pin cards are hidden in the side panel.',
    pins_add_title: 'Add pinned record',
    pins_label_optional: 'Display name (optional)',
    pins_url_label: 'kintone record URL',
    pins_app_id_label: 'App ID',
    pins_record_id_label: 'Record ID',
    pins_note_optional: 'Initial note (optional)',
    pins_title_field_optional: 'Title field code (optional)',
    pins_placeholder_label: 'Example: Important deal A',
    pins_placeholder_url: 'Example: https://xxx.cybozu.com/k/45/show#record=12',
    pins_placeholder_app_id: '45',
    pins_placeholder_record_id: '12',
    pins_placeholder_note: 'Editable from side panel',
    pins_placeholder_title_field: 'Example: subject',
    pins_reset_btn: 'Clear input',
    pins_registered_title: 'Saved pins',
    pins_registered_hint: 'Use top-right icons to open, edit, or delete. Expand "Details" for more info.',
    shortcuts_hint: 'Manage shortcut buttons shown at the right edge of the side panel. Add from context menu.',
    shortcuts_visible_label: 'Show shortcuts',
    shortcuts_search_mode_label: 'Shortcut search open behavior',
    shortcuts_open_current_tab: 'Current tab',
    shortcuts_open_new_tab: 'New tab',
    shortcuts_list_hint: 'Drag to reorder. Delete each row from its delete button.',
    dialog_watch_edit_title: 'Edit watchlist',
    dialog_pin_edit_title: 'Edit pin',
    dialog_close: 'Close',
    dialog_apply_hint: 'Changes are applied only when saved.',
    common_cancel: 'Cancel',
    common_save: 'Save',
    reset_all: 'Reset All',
    clear_sort: 'Clear Sort',
    clear_width: 'Clear Width',
    delete: 'Delete',
    confirm_clear_layouts: 'Delete all saved column layouts. Continue?',
    alert_invalid_kintone_url: 'Please enter a valid kintone URL.',
    alert_host_permission_denied: 'Host access permission was not granted for this domain.',
    alert_duplicate_url: 'This URL is already registered.',
    alert_watchlist_limit_reached: 'Watchlist is limited to {limit} items.',
    alert_watch_query_resolve_failed: 'Could not resolve the view query. Enter Query manually or re-save from the target view URL.',
    alert_watch_add_query_resolve_failed: 'Could not resolve view conditions, so watchlist item was not added.',
    alert_required_pin_fields: 'host / App ID / Record ID are required.',
    alert_dialog_not_supported: 'This browser does not support the dialog element.',
    alert_invalid_kintone_url_or_host: 'Please enter a valid kintone URL or host.',
    alert_permission_cancelled: 'Permission request was cancelled.',
    alert_permission_granted: 'Permission granted.',
    app_unspecified: 'App unspecified',
    view_unspecified: 'View unspecified',
    app_prefix: 'App',
    record_prefix: 'Record',
    record_unspecified: 'Record unspecified',
    category_other: 'Other',
    no_label: '(no label)',
    icon_color_gray: 'Gray',
    icon_color_blue: 'Blue',
    icon_color_green: 'Green',
    icon_color_orange: 'Orange',
    icon_color_red: 'Red',
    icon_color_purple: 'Purple',
    shortcut_type_appTop: 'App top',
    shortcut_type_view: 'View',
    shortcut_type_create: 'Create record',
    shortcut_meta_type: 'Type',
    shortcut_meta_host: 'Host',
    shortcut_meta_app: 'App',
    shortcut_meta_icon: 'Icon',
    shortcut_meta_color: 'Color',
    shortcut_meta_view: 'View',
    shortcut_empty: 'No shortcuts yet.',
    shortcut_drag_handle_title: 'Drag to reorder',
    shortcut_editor_label: 'Label',
    shortcut_editor_icon: 'Icon',
    shortcut_editor_icon_color: 'Icon color',
    shortcut_save: 'Save',
    shortcut_cancel: 'Cancel',
    shortcut_open: 'Open',
    shortcut_open_url_unavailable: 'Target URL cannot be generated.',
    shortcut_edit: 'Edit',
    shortcut_close: 'Close',
    shortcut_delete: 'Delete',
    pins_empty: 'No saved pins.',
    pins_open: 'Open',
    pins_edit: 'Edit',
    pins_delete: 'Delete',
    pins_details: 'Details',
    pins_detail_host: 'Host',
    pins_detail_url: 'URL',
    pins_detail_app_id: 'App ID',
    pins_detail_record_id: 'Record ID',
    pins_detail_title_field: 'Title field',
    watch_empty: 'No watchlist items yet.',
    watch_badge_target_title: 'Set this watchlist as badge target',
    watch_pin_set: 'Pin',
    watch_pin_remove: 'Unpin',
    watch_open: 'Open',
    watch_edit: 'Edit',
    watch_delete: 'Delete',
    watch_details: 'Details',
    watch_detail_host: 'Host',
    watch_detail_url: 'URL',
    watch_detail_app: 'App',
    watch_detail_view: 'View',
    watch_detail_query: 'Query',
    watch_query_none: 'No filter',
    watch_detail_color: 'Color',
    watch_detail_category: 'Category',
    layout_empty_title: 'No saved column layouts.',
    layout_empty_desc: 'Saved Overlay presets will appear here after you create them.',
    layout_meta_order: 'Order',
    layout_meta_width: 'Widths',
    layout_meta_saved: 'Saved',
    layout_meta_scope: 'Target',
    layout_scope_list: 'List',
    layout_scope_detail: 'Detail',
    api_usage_title: 'API Usage',
    api_usage_desc: 'Shows all API calls issued by this extension, aggregated by major feature.',
    api_usage_scope_note: 'This is not the total API usage of your kintone environment.',
    api_usage_period_today: 'Today',
    api_usage_period_7d: '7 days',
    api_usage_period_30d: '30 days',
    api_usage_total: 'Total',
    api_usage_success: 'Success',
    api_usage_error: 'Error',
    api_usage_by_feature_title: 'By Feature',
    api_usage_feature: 'Feature',
    api_usage_reset: 'Reset stats',
    api_usage_reset_confirm: 'Reset API usage statistics?',
    api_usage_empty: 'No data yet.',
    api_usage_feature_watchlist: 'Watchlist',
    api_usage_feature_watchlist_bulk: 'Watchlist API Requests',
    api_usage_feature_record_pin: 'Record Pin',
    api_usage_feature_recent: 'Recent',
    api_usage_feature_overlay: 'Overlay',
    api_usage_feature_overlay_records: 'Overlay Records',
    api_usage_feature_overlay_acl: 'Overlay ACL',
    api_usage_feature_metadata_app: 'Metadata App',
    api_usage_feature_metadata_views: 'Metadata Views',
    api_usage_feature_metadata_fields: 'Metadata Fields',
    api_usage_feature_bootstrap: 'Bootstrap',
    api_usage_feature_admin: 'Admin',
    api_usage_feature_other: 'Other',
    metadata_cache_clear_btn: 'Clear metadata cache',
    metadata_cache_clear_desc: 'Clears 24h cache for app / views / fields.',
    metadata_cache_clear_confirm: 'Clear metadata cache?',
    metadata_cache_clear_done: 'Metadata cache was cleared.',
    metadata_cache_clear_failed: 'Failed to clear metadata cache.',
    api_usage_group_shortcuts: 'Shortcuts',
    api_usage_group_watchlist: 'Watchlist',
    api_usage_group_record_pin: 'Pinned Records',
    api_usage_group_recent: 'Recent Records',
    api_usage_group_spreadsheet: 'Spreadsheet',
    api_usage_group_admin: 'System / Admin',
  }
};

const UI_LANGUAGE_KEY = 'uiLanguage';
const UI_LANGUAGE_VALUES = ['auto', 'ja', 'en'];
const DEFAULT_UI_LANGUAGE = 'auto';
const DEVELOPER_PRO_OVERRIDE_KEY = 'pbDeveloperProOverride';
const DEVELOPER_UI_QUERY_PARAM = 'dev';

let currentLang = 'ja';
let currentUiLanguageSetting = DEFAULT_UI_LANGUAGE;
let optionsDataReady = false;

function normalizeUiLanguage(raw) {
  const value = String(raw || '').trim().toLowerCase();
  if (!value) return 'ja';
  if (value === 'ja' || value.startsWith('ja-')) return 'ja';
  return 'en';
}

function normalizeUiLanguageSetting(raw) {
  const value = String(raw || '').trim().toLowerCase();
  if (UI_LANGUAGE_VALUES.includes(value)) return value;
  return DEFAULT_UI_LANGUAGE;
}

function getBrowserUiLanguage() {
  try {
    const browserLang = navigator.language || (Array.isArray(navigator.languages) ? navigator.languages[0] : '');
    return normalizeUiLanguage(browserLang);
  } catch (_err) {
    return 'ja';
  }
}

function resolveEffectiveUiLanguage(setting) {
  if (setting === 'ja' || setting === 'en') return setting;
  return getBrowserUiLanguage();
}

function t(key, vars) {
  const base = I18N_MESSAGES[currentLang]?.[key]
    ?? I18N_MESSAGES.ja?.[key]
    ?? key;
  if (!vars || typeof vars !== 'object') return base;
  return Object.keys(vars).reduce((text, name) => {
    return text.replaceAll(`{${name}}`, String(vars[name]));
  }, base);
}

function applyI18n(root = document) {
  if (!root) return;
  root.querySelectorAll('[data-i18n]').forEach((el) => {
    const key = el.getAttribute('data-i18n');
    if (!key) return;
    el.textContent = t(key);
  });
  root.querySelectorAll('[data-i18n-title]').forEach((el) => {
    const key = el.getAttribute('data-i18n-title');
    if (!key) return;
    el.setAttribute('title', t(key));
  });
  root.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
    const key = el.getAttribute('data-i18n-placeholder');
    if (!key) return;
    el.setAttribute('placeholder', t(key));
  });
  root.querySelectorAll('[data-i18n-aria-label]').forEach((el) => {
    const key = el.getAttribute('data-i18n-aria-label');
    if (!key) return;
    el.setAttribute('aria-label', t(key));
  });
}

async function initializeI18n() {
  let setting = DEFAULT_UI_LANGUAGE;
  try {
    const stored = await chrome.storage.local.get(UI_LANGUAGE_KEY);
    setting = normalizeUiLanguageSetting(stored?.[UI_LANGUAGE_KEY]);
  } catch (_err) {
    setting = DEFAULT_UI_LANGUAGE;
  }
  await applyUiLanguageSetting(setting, { persist: false });
}

function isDeveloperUiEnabled() {
  try {
    const params = new URLSearchParams(window.location.search || '');
    return params.get(DEVELOPER_UI_QUERY_PARAM) === '1';
  } catch (_err) {
    return false;
  }
}

function updateDeveloperProOverrideVisibility() {
  if (!developerProOverrideRowEl) return false;
  const enabled = isDeveloperUiEnabled();
  developerProOverrideRowEl.hidden = !enabled;
  return enabled;
}

async function loadDeveloperProOverride() {
  if (!developerProOverrideEl) return;
  const visible = updateDeveloperProOverrideVisibility();
  if (!visible) return;
  try {
    const stored = await chrome.storage.local.get(DEVELOPER_PRO_OVERRIDE_KEY);
    developerProOverrideEl.checked = Boolean(stored?.[DEVELOPER_PRO_OVERRIDE_KEY]);
  } catch (_err) {
    developerProOverrideEl.checked = false;
  }
}

const labelEl = document.getElementById('label');
const urlEl = document.getElementById('url');
const appIdEl = document.getElementById('appId');
const viewEl = document.getElementById('viewIdOrName');
const queryEl = document.getElementById('query');
const watchlistRefreshPresetEl = document.getElementById('watchlist_refresh_preset');
const hostPermInputEl = document.getElementById('perm_host_input');
const hostPermRequestBtn = document.getElementById('perm_request');
const hostPermCheckBtn = document.getElementById('perm_check');
const hostPermStatusEl = document.getElementById('perm_status');
const iconEl = document.getElementById('icon');
const iconColorEl = document.getElementById('iconColor');
const categoryEl = document.getElementById('category');
const addBtn = document.getElementById('add');
const watchlistLimitHintEl = document.getElementById('watchlist_limit_hint');
const watchlistLimitStateEl = document.getElementById('watchlist_limit_state');
const listEl = document.getElementById('list');
const shortcutToggleEl = document.getElementById('shortcut_visible');
const shortcutListEl = document.getElementById('shortcut_list');
const shortcutSearchModeInputs = Array.from(document.querySelectorAll('input[name="shortcut_search_open_mode"]'));
const excelListEl = document.getElementById('excel_columns_list');
const excelClearBtn = document.getElementById('excel_columns_clear');
const apiUsageFeatureTableBodyEl = document.getElementById('api_usage_feature_table_body');
const apiUsageResetBtn = document.getElementById('api_usage_reset');
const metadataCacheClearBtn = document.getElementById('metadata_cache_clear');
const metadataCacheStatusEl = document.getElementById('metadata_cache_status');
const apiUsageTodayTotalEl = document.getElementById('api_usage_today_total');
const apiUsageTodaySuccessEl = document.getElementById('api_usage_today_success');
const apiUsageTodayErrorEl = document.getElementById('api_usage_today_error');
const apiUsage7dTotalEl = document.getElementById('api_usage_7d_total');
const apiUsage7dSuccessEl = document.getElementById('api_usage_7d_success');
const apiUsage7dErrorEl = document.getElementById('api_usage_7d_error');
const apiUsage30dTotalEl = document.getElementById('api_usage_30d_total');
const apiUsage30dSuccessEl = document.getElementById('api_usage_30d_success');
const apiUsage30dErrorEl = document.getElementById('api_usage_30d_error');
const uiLanguageEl = document.getElementById('ui_language');
const developerProOverrideRowEl = document.getElementById('developer_pro_override_row');
const developerProOverrideEl = document.getElementById('developer_pro_override');
const excelModeInputs = Array.from(document.querySelectorAll('input[name="excel_overlay_mode"]'));
const excelModeNoticeEl = document.getElementById('excel_mode_notice');
const OVERLAY_LAYOUT_PRESETS_KEY = 'kfavOverlayLayoutPresets';
const EXCEL_OVERLAY_MODE_KEY = 'kfavExcelOverlayMode';
const EXCEL_OVERLAY_MODE_OFF = 'off';
const EXCEL_OVERLAY_MODE_STANDARD = 'standard';
const EXCEL_OVERLAY_MODE_PRO = 'pro';
const DEFAULT_EXCEL_OVERLAY_MODE = EXCEL_OVERLAY_MODE_STANDARD;
const EXCEL_OVERLAY_MODE_VALUES = [EXCEL_OVERLAY_MODE_OFF, EXCEL_OVERLAY_MODE_STANDARD, EXCEL_OVERLAY_MODE_PRO];
const EXCEL_OVERLAY_MODE_PRO_NOTICE_KEY = 'overlay_mode_pro_notice';
const SHORTCUT_SEARCH_OPEN_MODE_KEY = 'shortcutSearchOpenMode';
const SHORTCUT_SEARCH_OPEN_MODE_VALUES = ['current_tab', 'new_tab'];
const DEFAULT_SHORTCUT_SEARCH_OPEN_MODE = 'current_tab';
const WATCHLIST_REFRESH_PRESET_KEY = 'pb_watchlist_refresh_preset';
const WATCHLIST_REFRESH_PRESET_VALUES = ['eco', 'normal', 'fast'];
const DEFAULT_WATCHLIST_REFRESH_PRESET = 'normal';
const WATCHLIST_LIMIT_KEY = 'pb_watchlist_limit';
const DEFAULT_WATCHLIST_LIMIT = 3;
const MAX_WATCHLIST_LIMIT = 5;
const WATCHLIST_LIMIT_VALUES = [DEFAULT_WATCHLIST_LIMIT, MAX_WATCHLIST_LIMIT];
const PIN_VISIBLE_KEY = 'kfavRecordPinsVisible';
const API_USAGE_DAILY_KEY = 'apiUsageDaily';
const PB_METADATA_CACHE_PREFIX = 'pb:meta:v1:';
const API_USAGE_RETENTION_DAYS = 31;
const API_USAGE_FEATURE_ORDER = [
  'shortcut',
  'shortcuts',
  'watchlist_bulk',
  'record_pin',
  'recent',
  'overlay',
  'overlay_records',
  'overlay_acl',
  'metadata_app',
  'metadata_views',
  'metadata_fields',
  'bootstrap',
  'admin'
];
const API_USAGE_FEATURE_VALUES = new Set([...API_USAGE_FEATURE_ORDER, 'other']);
const API_USAGE_LEGACY_FEATURE_MAP = {
  watchlist: 'watchlist_bulk',
  watchlist_manual: 'watchlist_bulk',
  watchlist_panel_open: 'watchlist_bulk',
  watchlist_visible_tick: 'watchlist_bulk',
  watchlist_resume_catchup: 'watchlist_bulk',
  watchlist_expand: 'watchlist_bulk',
  watchlist_focus_resume: 'watchlist_bulk',
  watchlist_tab_resume: 'watchlist_bulk',
  pins: 'record_pin',
  launcher: 'admin',
  options: 'admin',
  auth: 'admin'
};
const API_USAGE_DISPLAY_GROUP_ORDER = [
  'shortcuts',
  'watchlist',
  'record_pin',
  'recent',
  'spreadsheet',
  'admin'
];

const API_USAGE_DISPLAY_GROUP_LABEL_KEYS = {
  shortcuts: 'api_usage_group_shortcuts',
  watchlist: 'api_usage_group_watchlist',
  record_pin: 'api_usage_group_record_pin',
  recent: 'api_usage_group_recent',
  spreadsheet: 'api_usage_group_spreadsheet',
  admin: 'api_usage_group_admin'
};

const API_USAGE_DISPLAY_GROUP_MAP = {
  shortcuts: ['shortcut', 'shortcuts'],
  watchlist: ['watchlist_bulk', 'watchlist'],
  record_pin: ['record_pin', 'pins'],
  recent: ['recent'],
  spreadsheet: ['overlay', 'overlay_records', 'overlay_acl'],
  admin: [
    'metadata_app',
    'metadata_views',
    'metadata_fields',
    'bootstrap',
    'admin',
    'other'
  ]
};
// ---- pinned record elements ----
const pinLabelEl = document.getElementById('pin_label');
const pinUrlEl = document.getElementById('pin_url');
const pinAppIdEl = document.getElementById('pin_appId');
const pinRecordIdEl = document.getElementById('pin_recordId');
const pinTitleFieldEl = document.getElementById('pin_titleField');
const pinNoteEl = document.getElementById('pin_note');
const pinSaveBtn = document.getElementById('pin_save');
const pinResetBtn = document.getElementById('pin_reset');
const pinListEl = document.getElementById('pin_list');
const pinVisibleToggleEl = document.getElementById('pin_visible');
// 編集ダイアログ要素
const editDialog = document.getElementById('editDialog');
const editForm = document.getElementById('editForm');
const editLabelEl = document.getElementById('edit_label');
const editUrlEl = document.getElementById('edit_url');
const editAppIdEl = document.getElementById('edit_appId');
const editViewEl = document.getElementById('edit_viewIdOrName');
const editQueryEl = document.getElementById('edit_query');
const editIconEl = document.getElementById('edit_icon');
const editIconColorEl = document.getElementById('edit_iconColor');
const editCategoryEl = document.getElementById('edit_category');
const iconPreviewEl = document.getElementById('iconPreview');
const editIconPreviewEl = document.getElementById('editIconPreview');
const categorySuggestionsEl = document.getElementById('categorySuggestions');
const editCancelBtn = document.getElementById('editCancel');
const editCloseXBtn = document.getElementById('editCloseX');
const editSaveBtn = document.getElementById('editSave');
const pinEditDialog = document.getElementById('pinEditDialog');
const pinEditForm = document.getElementById('pinEditForm');
const pinEditLabelEl = document.getElementById('pin_edit_label');
const pinEditUrlEl = document.getElementById('pin_edit_url');
const pinEditAppIdEl = document.getElementById('pin_edit_appId');
const pinEditRecordIdEl = document.getElementById('pin_edit_recordId');
const pinEditTitleFieldEl = document.getElementById('pin_edit_titleField');
const pinEditNoteEl = document.getElementById('pin_edit_note');
const pinEditCancelBtn = document.getElementById('pinEditCancel');
const pinEditCloseXBtn = document.getElementById('pinEditCloseX');
const pinEditSaveBtn = document.getElementById('pinEditSave');
editForm?.addEventListener('click', (event) => event.stopPropagation());
pinEditForm?.addEventListener('click', (event) => event.stopPropagation());
let editingId = null;
let pinnedEntries = [];
let pinModalEditingId = null;
let shortcutEntries = [];
let shortcutsVisible = true;
let shortcutDraggingId = null;
let overlayLayoutPresets = {};
let overlayAppNameLookup = {};
let apiUsageDaily = {};
let watchlistLimit = DEFAULT_WATCHLIST_LIMIT;
const ensuredOrigins = new Set();
const ICON_CHOICES = [
  'clipboard', 'file-text', 'package', 'box', 'truck', 'factory', 'wrench', 'calendar',
  'list-checks', 'search', 'chart-bar', 'receipt', 'users', 'settings', 'bookmark', 'star'
];
const DEFAULT_ICON = 'file-text';
const ICON_COLOR_CHOICES = ['gray', 'blue', 'green', 'orange', 'red', 'purple'];
const DEFAULT_ICON_COLOR = 'gray';
const DEFAULT_CATEGORY = 'その他';
const MAX_SHORTCUT_INITIAL_LENGTH = 2;

function normalizeShortcutInitialLocal(value) {
  if (value == null) return '';
  const str = String(value).trim();
  if (!str) return '';
  return Array.from(str).slice(0, MAX_SHORTCUT_INITIAL_LENGTH).join('');
}

function sanitizeIcon(value) {
  const name = (value || '').trim();
  return ICON_CHOICES.includes(name) ? name : DEFAULT_ICON;
}

function sanitizeIconColor(value) {
  const color = String(value || '').trim().toLowerCase();
  return ICON_COLOR_CHOICES.includes(color) ? color : DEFAULT_ICON_COLOR;
}

function sanitizeShortcutIcon(value) {
  return sanitizeIcon(value);
}

function sanitizeShortcutIconColor(value) {
  return sanitizeIconColor(value);
}

function sanitizeCategory(value) {
  const trimmed = (value || '').trim();
  return trimmed;
}

function getCategoryLabel(value) {
  const name = sanitizeCategory(value);
  return name || t('category_other');
}

function isDefaultCategoryName(value) {
  const normalized = sanitizeCategory(value);
  if (!normalized) return true;
  return normalized === DEFAULT_CATEGORY || normalized === t('category_other');
}

function getIconColorLabel(value) {
  return t(`icon_color_${sanitizeIconColor(value)}`);
}

function normalizeWatchlistLimit(raw) {
  const value = Number(raw);
  if (WATCHLIST_LIMIT_VALUES.includes(value)) return value;
  return DEFAULT_WATCHLIST_LIMIT;
}

function normalizeFavoriteEntryLocal(item, fallbackOrder) {
  const source = item && typeof item === 'object' ? item : {};
  const label = source.label == null ? '' : String(source.label);
  const title = source.title == null ? '' : String(source.title).trim();
  const viewIdOrName = source.viewIdOrName == null ? '' : String(source.viewIdOrName).trim();
  const viewId = source.viewId == null ? '' : String(source.viewId).trim();
  const normalizedViewId = viewId || (/^\d+$/.test(viewIdOrName) ? viewIdOrName : '');
  const queryRaw = source.query == null ? null : String(source.query).trim();
  return {
    ...source,
    id: source.id || createId(),
    label: label || title,
    title: title || label || '',
    url: source.url == null ? '' : String(source.url).trim(),
    host: source.host == null ? '' : String(source.host).trim(),
    appId: source.appId == null ? '' : String(source.appId).trim(),
    viewId: normalizedViewId,
    viewIdOrName: viewIdOrName || normalizedViewId,
    viewName: source.viewName == null ? '' : String(source.viewName).trim(),
    query: queryRaw,
    queryRepairRequired: Boolean(source.queryRepairRequired),
    pinned: Boolean(source.pinned),
    icon: sanitizeIcon(source.icon),
    iconColor: sanitizeIconColor(source.iconColor),
    category: sanitizeCategory(source.category),
    order: typeof source.order === 'number' ? source.order : fallbackOrder
  };
}

function isWatchlistQueryMissingValue(query) {
  if (query == null) return true;
  const value = String(query).trim();
  return value === '-';
}

function isWatchlistItemNeedsRepair(item) {
  if (!item || typeof item !== 'object') return true;
  return isWatchlistQueryMissingValue(item.query);
}

function isWatchlistQueryEmpty(item) {
  if (!item || typeof item !== 'object') return false;
  if (item.query == null) return false;
  return String(item.query).trim() === '';
}

function getWatchlistQueryDisplay(item) {
  if (isWatchlistItemNeedsRepair(item)) return '-';
  if (isWatchlistQueryEmpty(item)) return t('watch_query_none');
  return String(item?.query || '');
}

function buildWatchlistUrl(host, appId, viewId) {
  const normalizedHost = String(host || '').trim().replace(/\/+$/, '');
  const normalizedAppId = String(appId || '').trim();
  const normalizedViewId = String(viewId || '').trim();
  if (!normalizedHost || !normalizedAppId) return '';
  const base = `${normalizedHost}/k/${encodeURIComponent(normalizedAppId)}/`;
  if (!normalizedViewId) return base;
  return `${base}?view=${encodeURIComponent(normalizedViewId)}`;
}

function toPascalIconName(name) {
  return String(name || '')
    .trim()
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join('');
}

function iconToSvgLocal(name, size = 18) {
  const lucide = globalThis.lucide;
  const icons = lucide?.icons;
  if (!icons) return '';
  const kebab = sanitizeIcon(name);
  const candidates = [kebab, toPascalIconName(kebab)];
  for (const key of candidates) {
    const iconNode = icons[key];
    if (!iconNode) continue;
    if (typeof iconNode.toSvg === 'function') {
      return iconNode.toSvg({ width: size, height: size });
    }
    if (typeof lucide.createElement === 'function') {
      const node = lucide.createElement(iconNode, { width: size, height: size });
      return node?.outerHTML || '';
    }
  }
  return '';
}

function renderLucideIconsLocal(root = document) {
  const nodes = root.querySelectorAll('.lc[data-icon]');
  nodes.forEach((el) => {
    const iconName = sanitizeIcon(el.dataset.icon);
    el.dataset.icon = iconName;
    el.innerHTML = iconToSvgLocal(iconName, 18);
  });
}

function renderIconPreview(targetEl, iconName, iconColor = DEFAULT_ICON_COLOR) {
  if (!targetEl) return;
  const name = sanitizeIcon(iconName);
  const color = sanitizeIconColor(iconColor);
  targetEl.dataset.icon = name;
  targetEl.dataset.icoColor = color;
  targetEl.innerHTML = iconToSvgLocal(name, 18);
}

function updateCategorySuggestions(items = []) {
  if (!categorySuggestionsEl) return;
  const categories = Array.from(
    new Set(
      (items || [])
        .map((item) => sanitizeCategory(item.category))
        .filter((name) => name && !isDefaultCategoryName(name))
    )
  ).sort((a, b) => a.localeCompare(b, 'ja'));
  categorySuggestionsEl.innerHTML = '';
  categories.forEach((name) => {
    const option = document.createElement('option');
    option.value = name;
    categorySuggestionsEl.appendChild(option);
  });
}

function normalizeOrigin(input) {
  if (!input) return '';
  const trimmed = String(input).trim();
  if (!trimmed) return '';
  const withoutWildcard = trimmed.endsWith('*') ? trimmed.slice(0, -1) : trimmed;
  try {
    const url = new URL(withoutWildcard);
    return url.origin;
  } catch (_e) {
    return '';
  }
}

function originPatternFor(input) {
  const origin = normalizeOrigin(input);
  if (!origin) return null;
  return `${origin}/*`;
}

function rememberGrantedOrigin(input) {
  const origin = normalizeOrigin(input);
  if (origin) ensuredOrigins.add(origin);
}

async function primeExistingPermissionCache() {
  if (!chrome?.permissions?.getAll) return;
  try {
    const perms = await chrome.permissions.getAll();
    (perms?.origins || []).forEach((pattern) => rememberGrantedOrigin(pattern));
  } catch (error) {
    console.debug('permissions cache prime failed', error);
  }
}

primeExistingPermissionCache();

function populateIconSelect(selectEl) {
  if (!selectEl) return;
  selectEl.innerHTML = '';
  ICON_CHOICES.forEach((name) => {
    const option = document.createElement('option');
    option.value = name;
    option.textContent = name;
    selectEl.appendChild(option);
  });
  selectEl.value = DEFAULT_ICON;
}

function populateIconColorSelect(selectEl) {
  if (!selectEl) return;
  selectEl.innerHTML = '';
  ICON_COLOR_CHOICES.forEach((name) => {
    const option = document.createElement('option');
    option.value = name;
    option.textContent = getIconColorLabel(name);
    selectEl.appendChild(option);
  });
  selectEl.value = DEFAULT_ICON_COLOR;
}

function populateShortcutIconSelect(selectEl, currentValue = '') {
  if (!selectEl) return;
  const normalized = sanitizeShortcutIcon(currentValue);
  selectEl.innerHTML = '';
  ICON_CHOICES.forEach((name) => {
    const option = document.createElement('option');
    option.value = name;
    option.textContent = name;
    selectEl.appendChild(option);
  });
  selectEl.value = normalized;
}

function populateShortcutIconColorSelect(selectEl, currentValue = '') {
  if (!selectEl) return;
  const normalized = sanitizeShortcutIconColor(currentValue);
  selectEl.innerHTML = '';
  ICON_COLOR_CHOICES.forEach((name) => {
    const option = document.createElement('option');
    option.value = name;
    option.textContent = getIconColorLabel(name);
    selectEl.appendChild(option);
  });
  selectEl.value = normalized;
}

function shortcutEditorPreviewState(iconValue, colorValue) {
  const icon = sanitizeShortcutIcon(iconValue);
  const color = sanitizeShortcutIconColor(colorValue);
  return { icon, color };
}

populateIconSelect(iconEl);
populateIconSelect(editIconEl);
populateIconColorSelect(iconColorEl);
populateIconColorSelect(editIconColorEl);
renderIconPreview(iconPreviewEl, DEFAULT_ICON, DEFAULT_ICON_COLOR);
renderIconPreview(editIconPreviewEl, DEFAULT_ICON, DEFAULT_ICON_COLOR);
iconEl?.addEventListener('change', () => renderIconPreview(iconPreviewEl, iconEl.value, iconColorEl?.value));
iconColorEl?.addEventListener('change', () => renderIconPreview(iconPreviewEl, iconEl?.value, iconColorEl.value));
editIconEl?.addEventListener('change', () => renderIconPreview(editIconPreviewEl, editIconEl.value, editIconColorEl?.value));
editIconColorEl?.addEventListener('change', () => renderIconPreview(editIconPreviewEl, editIconEl?.value, editIconColorEl.value));

async function warmHostPermissionStatus(items = []) {
  const hosts = Array.from(new Set(items.map((item) => item.host).filter(Boolean)));
  for (const host of hosts) {
    const origin = normalizeOrigin(host);
    if (!origin || ensuredOrigins.has(origin)) continue;
    await hasHostPermission(host);
  }
}

async function ensureHostPermissionFor(host) {
  const origin = normalizeOrigin(host);
  if (!origin) return true;
  if (ensuredOrigins.has(origin)) return true;
  return await requestHostPermission(origin);
}

function clearShortcutDropIndicators() {
  if (!shortcutListEl) return;
  const items = shortcutListEl.querySelectorAll('.shortcut-item.is-drop-before, .shortcut-item.is-drop-after');
  items.forEach((item) => {
    item.classList.remove('is-drop-before', 'is-drop-after');
  });
}

function beginShortcutDrag(ev, entryId, li) {
  shortcutDraggingId = entryId;
  clearShortcutDropIndicators();
  if (ev.dataTransfer) {
    try {
      ev.dataTransfer.effectAllowed = 'move';
      ev.dataTransfer.setData('text/plain', entryId);
    } catch (_err) {
      // ignore
    }
  }
  if (li) li.classList.add('dragging');
}

function endShortcutDrag(li) {
  if (li) li.classList.remove('dragging');
  shortcutDraggingId = null;
  clearShortcutDropIndicators();
}

function ensureShortcutListDnDHandlers() {
  if (!shortcutListEl || shortcutListEl.dataset.dndBound === '1') return;
  shortcutListEl.addEventListener('dragover', (ev) => {
    if (!shortcutDraggingId) return;
    ev.preventDefault();
    if (ev.dataTransfer) {
      try {
        ev.dataTransfer.dropEffect = 'move';
      } catch (_err) {
        // ignore
      }
    }
    clearShortcutDropIndicators();
    const target = ev.target.closest('.shortcut-item');
    if (!target || target.dataset.id === shortcutDraggingId) return;
    const rect = target.getBoundingClientRect();
    const isAfter = ev.clientY - rect.top > rect.height / 2;
    target.classList.add(isAfter ? 'is-drop-after' : 'is-drop-before');
  });
  shortcutListEl.addEventListener('dragleave', (ev) => {
    if (!shortcutListEl.contains(ev.relatedTarget)) {
      clearShortcutDropIndicators();
    }
  });
  shortcutListEl.addEventListener('drop', async (ev) => {
    if (!shortcutDraggingId) return;
    ev.preventDefault();
    const targetItem = ev.target.closest('.shortcut-item');
    let insertIndex = shortcutEntries.length;
    if (targetItem) {
      const targetId = targetItem.dataset.id;
      const targetIdx = shortcutEntries.findIndex((entry) => entry.id === targetId);
      if (targetIdx !== -1) {
        const rect = targetItem.getBoundingClientRect();
        const isAfter = ev.clientY - rect.top > rect.height / 2;
        insertIndex = targetIdx + (isAfter ? 1 : 0);
      }
    }
    const fromIdx = shortcutEntries.findIndex((entry) => entry.id === shortcutDraggingId);
    if (fromIdx === -1) {
      endShortcutDrag(null);
      return;
    }
    if (insertIndex < 0) insertIndex = 0;
    if (insertIndex > shortcutEntries.length) insertIndex = shortcutEntries.length;
    const [moved] = shortcutEntries.splice(fromIdx, 1);
    if (fromIdx < insertIndex) insertIndex -= 1;
    shortcutEntries.splice(insertIndex, 0, moved);
    await persistShortcutEntries();
    renderShortcutEntries();
    endShortcutDrag(null);
  });
  shortcutListEl.dataset.dndBound = '1';
}

function parseKintoneUrl(u) {
  try {
    const url = new URL(u);
    const m = url.pathname.match(/\/k\/(\d+)(?:\/|$)/);
    const appId = m ? m[1] : '';
    const viewParam = url.searchParams.get('view') || '';
    const host = url.origin;
    let recordId = '';
    if (url.hash) {
      const recMatch = String(url.hash).match(/record=(\d+)/);
      if (recMatch) recordId = recMatch[1];
    }
    return {
      host,
      appId,
      viewId: viewParam,
      viewIdOrName: viewParam,
      recordId,
      url: url.href
    };
  } catch (_e) {
    return {};
  }
}

const SHORTCUT_TYPES = ['appTop', 'view', 'create'];
const SHORTCUT_TYPE_LABELS = {
  appTop: 'shortcut_type_appTop',
  view: 'shortcut_type_view',
  create: 'shortcut_type_create'
};

function normalizeShortcutEntryLocal(entry, fallbackOrder = 0) {
  if (!entry || typeof entry !== 'object') return null;
  const type = SHORTCUT_TYPES.includes(entry.type) ? entry.type : 'appTop';
  const host = typeof entry.host === 'string' ? entry.host : '';
  const appId = entry.appId == null ? '' : String(entry.appId).trim();
  const viewIdOrName = entry.viewIdOrName == null ? '' : String(entry.viewIdOrName).trim();
  const label = entry.label == null ? '' : String(entry.label);
  const initial = normalizeShortcutInitialLocal(entry.initial);
  const icon = sanitizeShortcutIcon(entry.icon);
  const iconColor = sanitizeShortcutIconColor(entry.iconColor);
  const order = Number.isFinite(entry.order) ? entry.order : fallbackOrder;
  return {
    id: entry.id || createId(),
    type,
    host,
    appId,
    viewIdOrName,
    label,
    initial,
    icon,
    iconColor,
    order
  };
}

function sortShortcutEntriesLocal(list) {
  return [...(list || [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

function shortcutTypeLabel(type) {
  return t(SHORTCUT_TYPE_LABELS[type] || SHORTCUT_TYPE_LABELS.appTop);
}

function buildShortcutUrl(entry) {
  const host = (entry.host || '').replace(/\/$/, '');
  const appId = (entry.appId || '').trim();
  if (!host || !appId) return '';
  if (entry.type === 'create') {
    return `${host}/k/${encodeURIComponent(appId)}/edit`;
  }
  const base = `${host}/k/${encodeURIComponent(appId)}/`;
  if (entry.type === 'view') {
    const view = (entry.viewIdOrName || '').trim();
    if (view) {
      return `${base}?view=${encodeURIComponent(view)}`;
    }
  }
  return base;
}

function shortcutMetaText(entry) {
  const parts = [
    `${t('shortcut_meta_type')}: ${shortcutTypeLabel(entry.type)}`,
    `${t('shortcut_meta_host')}: ${entry.host || '-'}`,
    `${t('shortcut_meta_app')}: ${entry.appId || '-'}`,
    `${t('shortcut_meta_icon')}: ${sanitizeShortcutIcon(entry.icon)}`,
    `${t('shortcut_meta_color')}: ${sanitizeShortcutIconColor(entry.iconColor)}`
  ];
  if (entry.type === 'view') {
    parts.push(`${t('shortcut_meta_view')}: ${entry.viewIdOrName || '-'}`);
  }
  return parts.join(' / ');
}

async function persistShortcutEntries() {
  shortcutEntries = shortcutEntries.map((entry, index) => ({
    ...entry,
    order: index,
    initial: normalizeShortcutInitialLocal(entry.initial),
    icon: sanitizeShortcutIcon(entry.icon),
    iconColor: sanitizeShortcutIconColor(entry.iconColor)
  }));
  const core = await import('./core.js');
  await core.saveShortcuts(shortcutEntries);
}

function renderShortcutEntries() {
  if (!shortcutListEl) return;
  ensureShortcutListDnDHandlers();
  shortcutListEl.innerHTML = '';
  if (!shortcutEntries.length) {
    const empty = document.createElement('li');
    empty.className = 'shortcut-empty';
    empty.textContent = t('shortcut_empty');
    shortcutListEl.appendChild(empty);
    return;
  }

  shortcutEntries = sortShortcutEntriesLocal(shortcutEntries);
  shortcutEntries.forEach((entry, index) => {
    entry.order = index;
    entry.initial = normalizeShortcutInitialLocal(entry.initial);
    entry.icon = sanitizeShortcutIcon(entry.icon);
    entry.iconColor = sanitizeShortcutIconColor(entry.iconColor);
    const li = document.createElement('li');
    li.className = 'shortcut-item';
    li.dataset.id = entry.id;
    li.draggable = true;

    const handle = document.createElement('span');
    handle.className = 'shortcut-handle';
    handle.textContent = '::';
    handle.title = t('shortcut_drag_handle_title');

    const info = document.createElement('div');
    info.className = 'shortcut-info';
    const title = document.createElement('div');
    title.className = 'shortcut-title';
    const titleIcon = document.createElement('span');
    titleIcon.className = 'item-icon lc';
    const rowPreview = shortcutEditorPreviewState(entry.icon, entry.iconColor);
    titleIcon.dataset.icon = rowPreview.icon;
    titleIcon.dataset.icoColor = rowPreview.color;
    titleIcon.setAttribute('aria-hidden', 'true');
    const titleText = document.createElement('span');
    titleText.textContent = entry.label || shortcutTypeLabel(entry.type);
    title.appendChild(titleIcon);
    title.appendChild(titleText);
    const meta = document.createElement('div');
    meta.className = 'shortcut-meta';
    meta.textContent = shortcutMetaText(entry);
    info.appendChild(title);
    info.appendChild(meta);

    const editor = document.createElement('div');
    editor.className = 'shortcut-editor';

    const editorGrid = document.createElement('div');
    editorGrid.className = 'grid icon-cat-grid shortcut-editor-grid';

    const labelWrap = document.createElement('label');
    labelWrap.textContent = t('shortcut_editor_label');
    labelWrap.appendChild(document.createElement('br'));
    const labelInput = document.createElement('input');
    labelInput.value = entry.label || '';
    labelWrap.appendChild(labelInput);

    const iconWrap = document.createElement('label');
    iconWrap.textContent = t('shortcut_editor_icon');
    iconWrap.appendChild(document.createElement('br'));
    const iconSelect = document.createElement('select');
    populateShortcutIconSelect(iconSelect, entry.icon);
    const iconPreview = document.createElement('span');
    iconPreview.className = 'icon-preview lc';
    iconPreview.setAttribute('aria-hidden', 'true');
    iconWrap.appendChild(iconSelect);
    iconWrap.appendChild(iconPreview);

    const colorWrap = document.createElement('label');
    colorWrap.textContent = t('shortcut_editor_icon_color');
    colorWrap.appendChild(document.createElement('br'));
    const colorSelect = document.createElement('select');
    populateShortcutIconColorSelect(colorSelect, entry.iconColor);
    colorWrap.appendChild(colorSelect);

    editorGrid.appendChild(labelWrap);
    editorGrid.appendChild(iconWrap);
    editorGrid.appendChild(colorWrap);

    const editorActions = document.createElement('div');
    editorActions.className = 'shortcut-editor-actions';
    const saveBtn = document.createElement('button');
    saveBtn.type = 'button';
    saveBtn.textContent = t('shortcut_save');
    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.textContent = t('shortcut_cancel');

    editorActions.appendChild(saveBtn);
    editorActions.appendChild(cancelBtn);
    editor.appendChild(editorGrid);
    editor.appendChild(editorActions);
    info.appendChild(editor);

    const updateEditorPreview = () => {
      const preview = shortcutEditorPreviewState(iconSelect.value, colorSelect.value);
      iconPreview.dataset.icon = preview.icon;
      iconPreview.dataset.icoColor = preview.color;
      renderLucideIconsLocal(editor);
    };
    updateEditorPreview();

    const ops = document.createElement('div');
    ops.className = 'shortcut-ops';
    const url = buildShortcutUrl(entry);
    const openA = document.createElement('a');
        openA.textContent = t('shortcut_open');
    openA.className = 'btn';
    if (url) {
      openA.href = url;
      openA.target = '_blank';
      openA.rel = 'noopener';
      openA.title = url;
    } else {
      openA.href = '#';
      openA.setAttribute('aria-disabled', 'true');
      openA.classList.add('disabled');
      openA.title = t('shortcut_open_url_unavailable');
      openA.addEventListener('click', (ev) => ev.preventDefault());
    }
    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.textContent = t('shortcut_edit');
    editBtn.addEventListener('click', () => {
      const opening = !editor.classList.contains('is-open');
      editor.classList.toggle('is-open', opening);
      editBtn.textContent = opening ? t('shortcut_close') : t('shortcut_edit');
      if (opening) {
        labelInput.focus();
        labelInput.select();
      }
    });
    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.textContent = t('shortcut_delete');
    delBtn.addEventListener('click', async () => {
      shortcutEntries = shortcutEntries.filter((item) => item.id !== entry.id);
      await persistShortcutEntries();
      renderShortcutEntries();
    });
    iconSelect.addEventListener('change', updateEditorPreview);
    colorSelect.addEventListener('change', updateEditorPreview);
    saveBtn.addEventListener('click', async () => {
      entry.label = labelInput.value.trim();
      entry.icon = sanitizeShortcutIcon(iconSelect.value);
      entry.iconColor = sanitizeShortcutIconColor(colorSelect.value);
      await persistShortcutEntries();
      renderShortcutEntries();
    });
    cancelBtn.addEventListener('click', () => {
      labelInput.value = entry.label || '';
      populateShortcutIconSelect(iconSelect, entry.icon);
      populateShortcutIconColorSelect(colorSelect, entry.iconColor);
      updateEditorPreview();
      editor.classList.remove('is-open');
      editBtn.textContent = t('shortcut_edit');
    });
    ops.appendChild(openA);
    ops.appendChild(editBtn);
    ops.appendChild(delBtn);

    li.appendChild(handle);
    li.appendChild(info);
    li.appendChild(ops);

    const onDragStart = (ev) => {
      ev.stopPropagation();
      beginShortcutDrag(ev, entry.id, li);
    };
    const onDragEnd = () => {
      endShortcutDrag(li);
    };

    handle.draggable = true;
    handle.addEventListener('dragstart', onDragStart);
    handle.addEventListener('dragend', onDragEnd);

    li.addEventListener('dragstart', onDragStart);
    li.addEventListener('dragend', onDragEnd);

    shortcutListEl.appendChild(li);
  });
  renderLucideIconsLocal(shortcutListEl);
}

shortcutToggleEl?.addEventListener('change', async () => {
  shortcutsVisible = Boolean(shortcutToggleEl.checked);
  await chrome.storage.sync.set({ kfavShortcutsVisible: shortcutsVisible });
});

function createId() {
  return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

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

function pinnedEntryLabel(entry) {
  const label = entry.label?.trim();
  if (label) return label;
  const app = entry.appId ? `${t('app_prefix')} ${entry.appId}` : t('app_unspecified');
  const record = entry.recordId ? `${t('record_prefix')} ${entry.recordId}` : t('record_unspecified');
  return `${app} / ${record}`;
}

async function savePinnedEntries() {
  await chrome.storage.sync.set({ kfavPins: pinnedEntries.map(({ id, label, host, appId, recordId, titleField, note, pinnedAt, modifiedAt }) => ({
    id,
    label,
    host,
    appId,
    recordId,
    titleField,
    note,
    pinnedAt: normalizeTimestamp(pinnedAt),
    modifiedAt: normalizeTimestamp(modifiedAt)
  })) });
}

function renderPinnedEntries() {
  if (!pinListEl) return;
  pinListEl.innerHTML = '';
  if (!pinnedEntries.length) {
    const empty = document.createElement('li');
    empty.className = 'muted';
    empty.textContent = t('pins_empty');
    pinListEl.appendChild(empty);
    return;
  }

  pinnedEntries.forEach((entry) => {
    const li = document.createElement('li');
    li.className = 'pin-item pin-card-item';
    li.dataset.id = entry.id;

    const main = document.createElement('div');
    main.className = 'pin-main';
    const top = document.createElement('div');
    top.className = 'pin-top';

    const title = document.createElement('div');
    title.className = 'pin-title';
    const pinMark = document.createElement('span');
    pinMark.className = 'pin-mark';
    pinMark.textContent = '📌';
    pinMark.setAttribute('aria-hidden', 'true');
    const titleText = document.createElement('span');
    titleText.className = 'pin-title-text';
    titleText.textContent = pinnedEntryLabel(entry);
    titleText.title = titleText.textContent;
    title.appendChild(pinMark);
    title.appendChild(titleText);

    const ops = document.createElement('div');
    ops.className = 'pin-ops pin-actions';
    const openBtn = document.createElement('a');
    openBtn.className = 'watch-icon-btn pin-icon-btn pin-open-btn';
    openBtn.textContent = '↗';
    openBtn.title = t('pins_open');
    openBtn.setAttribute('aria-label', t('pins_open'));
    if (entry.host && entry.appId && entry.recordId) {
      openBtn.href = `${entry.host}/k/${entry.appId}/show#record=${entry.recordId}`;
      openBtn.target = '_blank';
      openBtn.rel = 'noopener';
    } else {
      openBtn.href = '#';
      openBtn.setAttribute('aria-disabled', 'true');
      openBtn.classList.add('disabled', 'is-disabled');
      openBtn.addEventListener('click', (ev) => ev.preventDefault());
    }
    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.className = 'watch-icon-btn pin-icon-btn pin-edit-btn';
    editBtn.textContent = '✎';
    editBtn.title = t('pins_edit');
    editBtn.setAttribute('aria-label', t('pins_edit'));
    editBtn.addEventListener('click', () => openPinEditModal(entry, editBtn));
    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'watch-icon-btn pin-icon-btn pin-del-btn';
    delBtn.textContent = '×';
    delBtn.title = t('pins_delete');
    delBtn.setAttribute('aria-label', t('pins_delete'));
    delBtn.addEventListener('click', async () => {
      pinnedEntries = pinnedEntries.filter((item) => item.id !== entry.id);
      await savePinnedEntries();
      renderPinnedEntries();
    });
    ops.appendChild(openBtn);
    ops.appendChild(editBtn);
    ops.appendChild(delBtn);

    top.appendChild(title);
    top.appendChild(ops);

    const summary = document.createElement('div');
    summary.className = 'watch-summary pin-summary';
    const appChip = document.createElement('span');
    appChip.className = 'watch-chip pin-chip';
    appChip.textContent = `${t('app_prefix')} ${entry.appId || '-'}`;
    const recordChip = document.createElement('span');
    recordChip.className = 'watch-chip pin-chip';
    recordChip.textContent = `${t('record_prefix')} ${entry.recordId || '-'}`;
    summary.appendChild(appChip);
    summary.appendChild(recordChip);

    const noteText = (entry.note || '').trim();
    let noteEl = null;
    if (noteText) {
      noteEl = document.createElement('div');
      noteEl.className = 'watch-query pin-note-line';
      noteEl.textContent = noteText;
      noteEl.title = noteText;
    }

    const details = document.createElement('details');
    details.className = 'watch-details pin-details';
    const detailSummary = document.createElement('summary');
    detailSummary.textContent = t('pins_details');
    const detailBody = document.createElement('div');
    detailBody.className = 'watch-details-body pin-details-body';
    const fullUrl = entry.host && entry.appId && entry.recordId
      ? `${entry.host}/k/${entry.appId}/show#record=${entry.recordId}`
      : '-';
    [
      [t('pins_detail_host'), entry.host || '-'],
      [t('pins_detail_url'), fullUrl],
      [t('pins_detail_app_id'), entry.appId || '-'],
      [t('pins_detail_record_id'), entry.recordId || '-'],
      [t('pins_detail_title_field'), entry.titleField || '-']
    ].forEach(([label, value]) => {
      const row = document.createElement('div');
      row.className = 'watch-detail-row pin-detail-row';
      row.textContent = `${label}: ${value}`;
      row.title = String(value);
      detailBody.appendChild(row);
    });
    details.appendChild(detailSummary);
    details.appendChild(detailBody);

    main.appendChild(top);
    main.appendChild(summary);
    if (noteEl) main.appendChild(noteEl);
    main.appendChild(details);
    li.appendChild(main);
    pinListEl.appendChild(li);
  });
}

function resetPinnedForm() {
  if (pinLabelEl) pinLabelEl.value = '';
  pinUrlEl.value = '';
  pinAppIdEl.value = '';
  pinRecordIdEl.value = '';
  pinTitleFieldEl.value = '';
  pinNoteEl.value = '';
  if (pinSaveBtn) pinSaveBtn.textContent = t('common_add');
}
async function loadFavorites() {
  const { kintoneFavorites = [] } = await chrome.storage.sync.get('kintoneFavorites');
  return kintoneFavorites.map((item, idx) => normalizeFavoriteEntryLocal(item, idx));
}
async function saveFavorites(items) {
  const normalized = items.map((item, idx) => normalizeFavoriteEntryLocal(item, idx));
  await chrome.storage.sync.set({ kintoneFavorites: normalized });
}

async function loadWatchlistLimitSetting() {
  try {
    const stored = await chrome.storage.local.get(WATCHLIST_LIMIT_KEY);
    const raw = stored?.[WATCHLIST_LIMIT_KEY];
    const normalized = normalizeWatchlistLimit(raw);
    watchlistLimit = normalized;
    if (raw !== normalized) {
      await chrome.storage.local.set({ [WATCHLIST_LIMIT_KEY]: normalized });
    }
  } catch (_err) {
    watchlistLimit = DEFAULT_WATCHLIST_LIMIT;
    try {
      await chrome.storage.local.set({ [WATCHLIST_LIMIT_KEY]: DEFAULT_WATCHLIST_LIMIT });
    } catch (_ignore) {
      // ignore
    }
  }
}

function getWatchlistLimit() {
  return normalizeWatchlistLimit(watchlistLimit);
}

function renderWatchlistLimitHint(countValue = 0) {
  const limit = getWatchlistLimit();
  const count = Math.max(0, Number(countValue) || 0);
  if (watchlistLimitHintEl) {
    watchlistLimitHintEl.textContent = t('watch_limit_hint', { limit, count });
    watchlistLimitHintEl.classList.toggle('is-limit-reached', count >= limit);
  }
  const reached = count >= limit;
  if (watchlistLimitStateEl) {
    watchlistLimitStateEl.textContent = reached ? t('watch_limit_reached', { limit }) : '';
    watchlistLimitStateEl.classList.toggle('is-visible', reached);
  }
  if (addBtn) {
    addBtn.disabled = reached;
    if (reached) {
      addBtn.title = t('watch_limit_reached', { limit });
      addBtn.setAttribute('aria-disabled', 'true');
      if (watchlistLimitStateEl) addBtn.setAttribute('aria-describedby', 'watchlist_limit_state');
    } else {
      addBtn.title = '';
      addBtn.removeAttribute('aria-disabled');
      addBtn.removeAttribute('aria-describedby');
    }
  }
}

function sortItems(items) {
  return [...items].sort((a,b) => (b.pinned?1:0)-(a.pinned?1:0) || (a.order??0)-(b.order??0));
}

async function setBadgeTarget(id) {
  await chrome.storage.sync.set({ kfavBadgeTargetId: id });
}

async function getBadgeTarget() {
  const { kfavBadgeTargetId = null } = await chrome.storage.sync.get('kfavBadgeTargetId');
  return kfavBadgeTargetId;
}

async function render(items) {
  if (!listEl) return;
  const sorted = sortItems(items);
  const badgeTargetId = await getBadgeTarget();
  updateCategorySuggestions(sorted);
  renderWatchlistLimitHint(sorted.length);

  listEl.innerHTML = '';
  if (!sorted.length) {
    const empty = document.createElement('li');
    empty.className = 'item item-empty';
    empty.textContent = t('watch_empty');
    listEl.appendChild(empty);
    return;
  }

  sorted.forEach((it, idx) => {
    if (typeof it.order !== 'number') it.order = idx;

    const li = document.createElement('li');
    li.className = 'item watch-item';
    li.draggable = true;
    li.dataset.id = it.id;

    const handle = document.createElement('div');
    handle.className = 'drag-handle watch-drag-handle';
    handle.textContent = '⋮⋮';
    handle.title = t('shortcut_drag_handle_title');

    const body = document.createElement('div');
    body.className = 'watch-main';
    const top = document.createElement('div');
    top.className = 'watch-top';
    const title = document.createElement('div');
    title.className = 'title watch-title';
    const iconPreview = document.createElement('span');
    iconPreview.className = 'item-icon lc';
    iconPreview.dataset.icon = sanitizeIcon(it.icon);
    iconPreview.dataset.icoColor = sanitizeIconColor(it.iconColor);
    iconPreview.setAttribute('aria-hidden', 'true');
    const titleText = document.createElement('span');
    titleText.className = 'watch-title-text';
    titleText.textContent = it.label || t('no_label');
    title.appendChild(iconPreview);
    title.appendChild(titleText);
    top.appendChild(title);

    const right = document.createElement('div');
    right.className = 'ops watch-actions';

    // バッジ対象ラジオ
    const badgeWrap = document.createElement('label');
    badgeWrap.className = 'watch-icon-btn watch-badge-btn';
    badgeWrap.title = t('watch_badge_target_title');
    badgeWrap.setAttribute('aria-label', t('watch_badge_target_title'));
    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = 'badgeTarget';
    radio.className = 'badge-radio watch-badge-radio';
    radio.checked = badgeTargetId ? (badgeTargetId === it.id) : (sorted[0]?.id === it.id);
    const badgeMark = document.createElement('span');
    badgeMark.className = 'watch-badge-mark';
    badgeMark.textContent = '◎';
    radio.addEventListener('change', async () => {
      await setBadgeTarget(it.id);
      const wraps = listEl.querySelectorAll('.watch-badge-btn');
      wraps.forEach((el) => el.classList.remove('is-active'));
      badgeWrap.classList.add('is-active');
    });
    badgeWrap.classList.toggle('is-active', radio.checked);
    badgeWrap.appendChild(radio);
    badgeWrap.appendChild(badgeMark);

    // ピン切替
    const pinBtn = document.createElement('button');
    pinBtn.className = 'pin watch-icon-btn watch-pin-btn';
    pinBtn.type = 'button';
    pinBtn.textContent = '📌';
    pinBtn.title = it.pinned ? t('watch_pin_remove') : t('watch_pin_set');
    pinBtn.setAttribute('aria-label', it.pinned ? t('watch_pin_remove') : t('watch_pin_set'));
    pinBtn.classList.toggle('is-active', Boolean(it.pinned));
    pinBtn.addEventListener('click', async () => {
      const all = await loadFavorites();
      const me = all.find(x => x.id === it.id);
      me.pinned = !me.pinned;
      await saveFavorites(all);
      render(all);
    });

    // 開く・削除
    const openA = document.createElement('a');
    openA.textContent = '↗';
    openA.className = 'btn watch-icon-btn watch-open-btn';
    openA.title = t('watch_open');
    openA.setAttribute('aria-label', t('watch_open'));
    openA.href = it.url;
    openA.target = '_blank';
    openA.rel = 'noopener';
    // 編集ボタン
    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.textContent = '✎';
    editBtn.className = 'watch-icon-btn watch-edit-btn';
    editBtn.title = t('watch_edit');
    editBtn.setAttribute('aria-label', t('watch_edit'));
    editBtn.addEventListener('click', () => openEdit(it, editBtn));

    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.textContent = '✕';
    delBtn.className = 'watch-icon-btn watch-del-btn';
    delBtn.title = t('watch_delete');
    delBtn.setAttribute('aria-label', t('watch_delete'));
    delBtn.addEventListener('click', async () => {
      const next = (await loadFavorites()).filter(x => x.id !== it.id);
      await saveFavorites(next);
      render(next);
    });

    right.appendChild(badgeWrap);
    right.appendChild(pinBtn);
    right.appendChild(openA);
    right.appendChild(editBtn);
    right.appendChild(delBtn);
    top.appendChild(right);

    const summary = document.createElement('div');
    summary.className = 'watch-summary';
    const addChip = (text, variant = '') => {
      const chip = document.createElement('span');
      chip.className = 'watch-chip';
      if (variant) chip.classList.add(`is-${variant}`);
      chip.textContent = text;
      summary.appendChild(chip);
    };
    if (it.appId) addChip(`${t('app_prefix')} ${it.appId}`);
    const resolvedViewForDisplay = String(it.viewId || it.viewIdOrName || '').trim() || String(it.viewName || '').trim();
    if (resolvedViewForDisplay) addChip(`${t('watch_detail_view')} ${resolvedViewForDisplay}`);
    addChip(getCategoryLabel(it.category));
    if (isWatchlistQueryEmpty(it)) addChip(t('watch_query_none'), 'muted');
    if (isWatchlistItemNeedsRepair(it)) addChip(t('watch_item_needs_repair'), 'warning');

    const urlLine = document.createElement('div');
    urlLine.className = 'watch-info-line watch-url';
    const urlLabel = document.createElement('span');
    urlLabel.className = 'watch-info-label';
    urlLabel.textContent = `${t('watch_detail_url')}:`;
    const urlValue = document.createElement('span');
    urlValue.className = 'watch-info-value';
    urlValue.textContent = it.url || '-';
    urlValue.title = it.url || '';
    urlLine.appendChild(urlLabel);
    urlLine.appendChild(urlValue);

    const queryLine = document.createElement('div');
    queryLine.className = 'watch-info-line watch-query';
    const queryLabel = document.createElement('span');
    queryLabel.className = 'watch-info-label';
    queryLabel.textContent = `${t('watch_detail_query')}:`;
    const queryValue = document.createElement('span');
    queryValue.className = 'watch-info-value watch-query-value';
    const queryDisplay = getWatchlistQueryDisplay(it);
    queryValue.textContent = queryDisplay;
    queryValue.title = queryDisplay;
    queryValue.classList.toggle('is-query-empty', isWatchlistQueryEmpty(it));
    queryValue.classList.toggle('is-query-repair', isWatchlistItemNeedsRepair(it));
    queryLine.appendChild(queryLabel);
    queryLine.appendChild(queryValue);

    const details = document.createElement('details');
    details.className = 'watch-details';
    const detailsSummary = document.createElement('summary');
    detailsSummary.textContent = t('watch_details');
    const detailsBody = document.createElement('div');
    detailsBody.className = 'watch-details-body';
    const metaRows = [
      [t('watch_detail_host'), it.host || '-'],
      [t('watch_detail_url'), it.url || '-'],
      [t('watch_detail_app'), it.appId || '-'],
      [t('watch_detail_view'), resolvedViewForDisplay || '-'],
      [t('watch_detail_query'), queryDisplay],
      [t('shortcut_meta_icon'), sanitizeIcon(it.icon)],
      [t('watch_detail_color'), sanitizeIconColor(it.iconColor)],
      [t('watch_detail_category'), getCategoryLabel(it.category)]
    ];
    metaRows.forEach(([label, value]) => {
      const row = document.createElement('div');
      row.className = 'watch-detail-row';
      const rowLabel = document.createElement('span');
      rowLabel.className = 'watch-detail-label';
      rowLabel.textContent = `${label}:`;
      const rowValue = document.createElement('span');
      rowValue.className = 'watch-detail-value';
      rowValue.textContent = String(value);
      rowValue.title = String(value);
      row.appendChild(rowLabel);
      row.appendChild(rowValue);
      detailsBody.appendChild(row);
    });
    details.appendChild(detailsSummary);
    details.appendChild(detailsBody);

    body.appendChild(top);
    body.appendChild(summary);
    body.appendChild(urlLine);
    body.appendChild(queryLine);
    body.appendChild(details);

    // D&D
    li.addEventListener('dragstart', e => {
      e.dataTransfer.setData('text/plain', it.id);
      li.classList.add('dragging');
    });
    li.addEventListener('dragend', () => li.classList.remove('dragging'));
    li.addEventListener('dragover', e => e.preventDefault());
    li.addEventListener('drop', async e => {
      e.preventDefault();
      const fromId = e.dataTransfer.getData('text/plain');
      const toId = it.id;
      if (fromId === toId) return;
      const all = await loadFavorites();
      const fromIdx = all.findIndex(x => x.id === fromId);
      const toIdx = all.findIndex(x => x.id === toId);
      const [moved] = all.splice(fromIdx, 1);
      all.splice(toIdx, 0, moved);
      all.forEach((x, i) => x.order = i);
      await saveFavorites(all);
      render(all);
    });

    li.appendChild(handle);
    li.appendChild(body);
    listEl.appendChild(li);
  });
  renderLucideIconsLocal(listEl);
}

// ---- 編集処理（renderの外に1回だけ定義）----
const editModalState = {
  triggerEl: null,
  previousBodyOverflow: '',
  handlers: null
};

function getDialogFocusableElements() {
  if (!editDialog) return [];
  const selector = [
    'button:not([disabled])',
    'a[href]',
    'input:not([disabled])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"])'
  ].join(',');
  return Array.from(editDialog.querySelectorAll(selector))
    .filter((el) => !el.hasAttribute('hidden') && el.offsetParent !== null);
}

function handleDialogTabTrap(event) {
  if (event.key !== 'Tab' || !editDialog?.open) return;
  const focusables = getDialogFocusableElements();
  if (!focusables.length) {
    event.preventDefault();
    return;
  }
  const first = focusables[0];
  const last = focusables[focusables.length - 1];
  const active = document.activeElement;
  if (event.shiftKey && active === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && active === last) {
    event.preventDefault();
    first.focus();
  }
}

function extractQueryParamFromUrl(urlValue) {
  try {
    const url = new URL(String(urlValue || ''));
    return String(url.searchParams.get('query') || '').trim();
  } catch (_err) {
    return '';
  }
}

function extractViewFilterFromViews(viewsObj, viewIdOrName) {
  if (!viewsObj || typeof viewsObj !== 'object') {
    return { matched: false, query: '', viewName: '', viewId: '', reason: 'missing_views' };
  }
  const entries = Object.entries(viewsObj);
  if (!entries.length) {
    return {
      matched: true,
      query: '',
      viewName: 'All Records',
      viewId: '',
      reason: 'all_records_virtual'
    };
  }

  const target = String(viewIdOrName || '').trim();
  if (target) {
    const byId = entries.find(([, view]) => String(view?.id || '').trim() === target);
    if (byId) {
      const queryRaw = byId[1]?.filterCond;
      return {
        matched: true,
        query: queryRaw == null ? null : String(queryRaw).trim(),
        viewName: String(byId[0] || '').trim(),
        viewId: String(byId[1]?.id || '').trim(),
        reason: 'matched_view_id'
      };
    }
    const byName = entries.find(([name]) => String(name || '').trim() === target);
    if (byName) {
      const queryRaw = byName[1]?.filterCond;
      return {
        matched: true,
        query: queryRaw == null ? null : String(queryRaw).trim(),
        viewName: String(byName[0] || '').trim(),
        viewId: String(byName[1]?.id || '').trim(),
        reason: 'matched_view_name'
      };
    }
    return { matched: false, query: '', viewName: '', viewId: '', reason: 'view_not_found' };
  }

  const indexed = entries
    .map(([name, view], idx) => ({
      name: String(name || '').trim(),
      view: view || {},
      idx,
      order: Number(view?.index)
    }))
    .sort((a, b) => {
      const aOrder = Number.isFinite(a.order) ? a.order : Number.POSITIVE_INFINITY;
      const bOrder = Number.isFinite(b.order) ? b.order : Number.POSITIVE_INFINITY;
      if (aOrder !== bOrder) return aOrder - bOrder;
      return a.idx - b.idx;
    });
  const picked = indexed[0];
  const queryRaw = picked?.view?.filterCond;
  return {
    matched: true,
    query: queryRaw == null ? null : String(queryRaw).trim(),
    viewName: String(picked?.name || '').trim(),
    viewId: String(picked?.view?.id || '').trim(),
    reason: 'default_view'
  };
}

async function runInKintoneOnHost(host, type, payload = {}) {
  const safeHost = String(host || '').trim();
  if (!safeHost) throw new Error('host is required');
  const response = await chrome.runtime.sendMessage({
    type: 'RUN_IN_KINTONE',
    host: safeHost,
    forward: {
      type,
      payload
    }
  });
  if (!response?.ok) {
    throw new Error(String(response?.error || `${type} failed`));
  }
  return response;
}

async function fetchViewsForWatchlist(host, appId, cacheMap) {
  const cacheKey = `${String(host || '').trim()}::${String(appId || '').trim()}`;
  if (cacheMap?.has(cacheKey)) return cacheMap.get(cacheKey);
  const response = await runInKintoneOnHost(host, 'LIST_VIEWS', {
    appId: String(appId || '').trim(),
    __pbTrigger: 'watchlist_register',
    __pbSource: 'options_query_resolve'
  });
  const views = response?.views && typeof response.views === 'object' ? response.views : {};
  if (cacheMap) cacheMap.set(cacheKey, views);
  return views;
}

async function resolveWatchlistSavedQuery(entry, viewsCache = new Map()) {
  const explicit = String(entry?.query || '').trim();
  const hasExplicitQuery = explicit.length > 0;
  const viewIdOrName = String(entry?.viewId || entry?.viewIdOrName || '').trim();
  const host = String(entry?.host || '').trim();
  const appId = String(entry?.appId || '').trim();
  if (!host || !appId) return { ok: false, query: '', viewId: '', viewName: '', reason: 'missing_host_or_app' };
  try {
    const views = await fetchViewsForWatchlist(host, appId, viewsCache);
    const resolved = extractViewFilterFromViews(views, viewIdOrName);
    if (!resolved.matched) {
      return {
        ok: false,
        query: '',
        viewId: '',
        viewName: '',
        reason: resolved.reason || 'view_not_found'
      };
    }
    const resolvedQueryRaw = resolved?.query;
    const finalQuery = hasExplicitQuery
      ? explicit
      : String(resolvedQueryRaw == null ? '' : resolvedQueryRaw).trim();
    if (isWatchlistQueryMissingValue(finalQuery)) {
      return {
        ok: false,
        query: '',
        viewId: resolved.viewId,
        viewName: resolved.viewName || '',
        reason: 'query_not_found'
      };
    }
    return {
      ok: true,
      query: finalQuery,
      viewId: resolved.viewId,
      viewName: resolved.viewName || ''
    };
  } catch (error) {
    return {
      ok: false,
      query: '',
      viewId: '',
      viewName: '',
      reason: String(error?.message || error || 'view_resolve_failed')
    };
  }
}

function needsWatchlistQueryMigration(item) {
  if (!item || typeof item !== 'object') return false;
  if (!isWatchlistQueryMissingValue(item.query)) return false;
  if (item.queryRepairRequired) return false;
  if (!String(item.host || '').trim()) return false;
  if (!String(item.appId || '').trim()) return false;
  return true;
}

async function migrateWatchlistQueriesIfNeeded(items) {
  const source = Array.isArray(items) ? items.map((item, index) => normalizeFavoriteEntryLocal(item, index)) : [];
  if (!source.some((item) => needsWatchlistQueryMigration(item))) {
    return { changed: false, items: source };
  }
  const viewsCache = new Map();
  let changed = false;
  for (const item of source) {
    if (!needsWatchlistQueryMigration(item)) continue;
    const resolved = await resolveWatchlistSavedQuery(item, viewsCache);
    if (!resolved.ok) {
      item.queryRepairRequired = true;
      changed = true;
      continue;
    }
    item.query = String(resolved.query || '');
    item.viewId = String(resolved.viewId || item.viewId || '').trim();
    item.viewIdOrName = item.viewId || String(item.viewIdOrName || '').trim();
    item.queryRepairRequired = false;
    const canonicalUrl = buildWatchlistUrl(item.host, item.appId, item.viewId);
    if (canonicalUrl) item.url = canonicalUrl;
    if (resolved.viewName) item.viewName = resolved.viewName;
    changed = true;
  }
  if (changed) {
    const normalized = source.map((entry, index) => normalizeFavoriteEntryLocal(entry, index));
    await chrome.storage.sync.set({ kintoneFavorites: normalized });
    return { changed: true, items: normalized };
  }
  return { changed: false, items: source.map((entry, index) => normalizeFavoriteEntryLocal(entry, index)) };
}

function closeEditDialog({ restoreFocus = true } = {}) {
  if (!editDialog) return;
  const closingId = editingId;
  const handlers = editModalState.handlers;
  if (handlers) {
    document.removeEventListener('keydown', handlers.onDocumentKeydown, true);
    editDialog.removeEventListener('click', handlers.onDialogClick);
    editDialog.removeEventListener('cancel', handlers.onDialogCancel);
    editDialog.removeEventListener('keydown', handlers.onDialogKeydown);
    editModalState.handlers = null;
  }
  if (editDialog.open && typeof editDialog.close === 'function') {
    editDialog.close();
  }
  document.body.style.overflow = editModalState.previousBodyOverflow;
  let focusTarget = editModalState.triggerEl;
  if ((!focusTarget || !focusTarget.isConnected) && closingId) {
    const escaped = globalThis.CSS?.escape ? CSS.escape(String(closingId)) : String(closingId);
    focusTarget = document.querySelector(`#list .watch-item[data-id="${escaped}"] .watch-edit-btn`);
  }
  if (restoreFocus && focusTarget && typeof focusTarget.focus === 'function') {
    try {
      focusTarget.focus();
    } catch (_err) {
      // ignore
    }
  }
  editModalState.triggerEl = null;
  editingId = null;
}

function openEdit(item, triggerEl = null) {
  editingId = item.id;
  editLabelEl.value = item.label || '';
  editUrlEl.value = item.url || '';
  editAppIdEl.value = item.appId || '';
  editViewEl.value = item.viewId || item.viewIdOrName || '';
  editQueryEl.value = item.query || '';
  if (editIconEl) {
    editIconEl.value = sanitizeIcon(item.icon);
  }
  if (editIconColorEl) {
    editIconColorEl.value = sanitizeIconColor(item.iconColor);
  }
  if (editIconEl) {
    renderIconPreview(editIconPreviewEl, editIconEl.value, editIconColorEl?.value);
  }
  if (editCategoryEl) {
    editCategoryEl.value = sanitizeCategory(item.category);
  }
  if (typeof editDialog.showModal === 'function') {
    if (editDialog.open) {
      closeEditDialog({ restoreFocus: false });
    }
    editModalState.triggerEl = triggerEl || document.activeElement;
    editModalState.previousBodyOverflow = document.body.style.overflow;
    const onDocumentKeydown = (event) => {
      if (event.isComposing) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        closeEditDialog();
      }
    };
    const onDialogClick = (event) => {
      if (event.target === editDialog) {
        closeEditDialog();
      }
    };
    const onDialogCancel = (event) => {
      event.preventDefault();
      closeEditDialog();
    };
    const onDialogKeydown = (event) => {
      handleDialogTabTrap(event);
    };
    editModalState.handlers = {
      onDocumentKeydown,
      onDialogClick,
      onDialogCancel,
      onDialogKeydown
    };
    document.addEventListener('keydown', onDocumentKeydown, true);
    editDialog.addEventListener('click', onDialogClick);
    editDialog.addEventListener('cancel', onDialogCancel);
    editDialog.addEventListener('keydown', onDialogKeydown);
    editDialog.showModal();
    document.body.style.overflow = 'hidden';
    setTimeout(() => {
      try {
        editLabelEl.focus();
        editLabelEl.select();
      } catch (_err) {
        // ignore
      }
    }, 0);
  } else {
    alert(t('alert_dialog_not_supported'));
  }
}

editCancelBtn?.addEventListener('click', () => closeEditDialog());
editCloseXBtn?.addEventListener('click', () => closeEditDialog());

editSaveBtn.addEventListener('click', async (e) => {
  e.preventDefault();
  if (!editingId) { closeEditDialog(); return; }
  const newLabel = editLabelEl.value.trim();
  const newUrlRaw = editUrlEl.value.trim();
  let { host, appId, viewIdOrName } = parseKintoneUrl(newUrlRaw);
  if (editAppIdEl.value.trim()) appId = editAppIdEl.value.trim();
  if (editViewEl.value.trim()) viewIdOrName = editViewEl.value.trim();
  const newQuery = editQueryEl.value.trim() || '';
  const newIcon = sanitizeIcon(editIconEl?.value);
  const newIconColor = sanitizeIconColor(editIconColorEl?.value);
  const newCategory = sanitizeCategory(editCategoryEl?.value);
  if (!newUrlRaw || !host || !String(appId || '').trim()) {
    alert(t('alert_invalid_kintone_url'));
    return;
  }
  if (!(await ensureHostPermissionFor(host))) {
    alert(t('alert_host_permission_denied'));
    return;
  }
  const all = await loadFavorites();
  const idx = all.findIndex((x) => x.id === editingId);
  if (idx === -1) { closeEditDialog(); return; }
  const resolvedQuery = await resolveWatchlistSavedQuery({
    host,
    appId: appId || '',
    viewIdOrName: viewIdOrName || '',
    url: newUrlRaw,
    query: newQuery
  });
  if (!resolvedQuery.ok) {
    alert(t('alert_watch_add_query_resolve_failed'));
    return;
  }
  const canonicalUrl = buildWatchlistUrl(host, appId, resolvedQuery.viewId);
  if (!canonicalUrl) {
    alert(t('alert_watch_add_query_resolve_failed'));
    return;
  }
  if (all.some((x, i) => i !== idx && x.url === canonicalUrl)) {
    alert(t('alert_duplicate_url'));
    return;
  }
  const resolvedTitle = newLabel || `${t('app_prefix')} ${String(appId || '').trim()}`;
  const old = all[idx];
  all[idx] = {
    ...old,
    label: resolvedTitle,
    title: resolvedTitle,
    url: canonicalUrl,
    host,
    appId: String(appId || '').trim(),
    viewId: String(resolvedQuery.viewId || '').trim(),
    viewIdOrName: String(resolvedQuery.viewId || '').trim(),
    viewName: resolvedQuery.viewName || old.viewName || '',
    query: String(resolvedQuery.query || ''),
    queryRepairRequired: false,
    icon: newIcon,
    iconColor: newIconColor,
    category: newCategory
  };
  await saveFavorites(all);
  await render(all);
  closeEditDialog();
});

const pinEditModalState = {
  triggerEl: null,
  previousBodyOverflow: '',
  handlers: null
};

function getPinDialogFocusableElements() {
  if (!pinEditDialog) return [];
  const selector = [
    'button:not([disabled])',
    'a[href]',
    'input:not([disabled])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"])'
  ].join(',');
  return Array.from(pinEditDialog.querySelectorAll(selector))
    .filter((el) => !el.hasAttribute('hidden') && el.offsetParent !== null);
}

function handlePinDialogTabTrap(event) {
  if (event.key !== 'Tab' || !pinEditDialog?.open) return;
  const focusables = getPinDialogFocusableElements();
  if (!focusables.length) {
    event.preventDefault();
    return;
  }
  const first = focusables[0];
  const last = focusables[focusables.length - 1];
  const active = document.activeElement;
  if (event.shiftKey && active === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && active === last) {
    event.preventDefault();
    first.focus();
  }
}

function closePinEditDialog({ restoreFocus = true } = {}) {
  if (!pinEditDialog) return;
  const closingId = pinModalEditingId;
  const handlers = pinEditModalState.handlers;
  if (handlers) {
    document.removeEventListener('keydown', handlers.onDocumentKeydown, true);
    pinEditDialog.removeEventListener('click', handlers.onDialogClick);
    pinEditDialog.removeEventListener('cancel', handlers.onDialogCancel);
    pinEditDialog.removeEventListener('keydown', handlers.onDialogKeydown);
    pinEditModalState.handlers = null;
  }
  if (pinEditDialog.open && typeof pinEditDialog.close === 'function') {
    pinEditDialog.close();
  }
  document.body.style.overflow = pinEditModalState.previousBodyOverflow;
  let focusTarget = pinEditModalState.triggerEl;
  if ((!focusTarget || !focusTarget.isConnected) && closingId) {
    const escaped = globalThis.CSS?.escape ? CSS.escape(String(closingId)) : String(closingId);
    focusTarget = document.querySelector(`#pin_list .pin-item[data-id="${escaped}"] .pin-edit-btn`);
  }
  if (restoreFocus && focusTarget && typeof focusTarget.focus === 'function') {
    try {
      focusTarget.focus();
    } catch (_err) {
      // ignore
    }
  }
  pinEditModalState.triggerEl = null;
  pinModalEditingId = null;
}

function openPinEditModal(entry, triggerEl = null) {
  if (!entry || !pinEditDialog) return;
  pinModalEditingId = entry.id;
  if (pinEditLabelEl) pinEditLabelEl.value = entry.label || '';
  if (pinEditUrlEl) {
    pinEditUrlEl.value = entry.host && entry.appId && entry.recordId
      ? `${entry.host}/k/${entry.appId}/show#record=${entry.recordId}`
      : '';
  }
  if (pinEditAppIdEl) pinEditAppIdEl.value = entry.appId || '';
  if (pinEditRecordIdEl) pinEditRecordIdEl.value = entry.recordId || '';
  if (pinEditTitleFieldEl) pinEditTitleFieldEl.value = entry.titleField || '';
  if (pinEditNoteEl) pinEditNoteEl.value = entry.note || '';

  if (typeof pinEditDialog.showModal === 'function') {
    if (pinEditDialog.open) {
      closePinEditDialog({ restoreFocus: false });
    }
    pinEditModalState.triggerEl = triggerEl || document.activeElement;
    pinEditModalState.previousBodyOverflow = document.body.style.overflow;
    const onDocumentKeydown = (event) => {
      if (event.isComposing) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        closePinEditDialog();
      }
    };
    const onDialogClick = (event) => {
      if (event.target === pinEditDialog) {
        closePinEditDialog();
      }
    };
    const onDialogCancel = (event) => {
      event.preventDefault();
      closePinEditDialog();
    };
    const onDialogKeydown = (event) => {
      handlePinDialogTabTrap(event);
    };
    pinEditModalState.handlers = {
      onDocumentKeydown,
      onDialogClick,
      onDialogCancel,
      onDialogKeydown
    };
    document.addEventListener('keydown', onDocumentKeydown, true);
    pinEditDialog.addEventListener('click', onDialogClick);
    pinEditDialog.addEventListener('cancel', onDialogCancel);
    pinEditDialog.addEventListener('keydown', onDialogKeydown);
    pinEditDialog.showModal();
    document.body.style.overflow = 'hidden';
    setTimeout(() => {
      try {
        (pinEditLabelEl || pinEditUrlEl)?.focus();
      } catch (_err) {
        // ignore
      }
    }, 0);
  } else {
    alert(t('alert_dialog_not_supported'));
  }
}

pinEditCancelBtn?.addEventListener('click', () => closePinEditDialog());
pinEditCloseXBtn?.addEventListener('click', () => closePinEditDialog());

pinEditSaveBtn?.addEventListener('click', async (event) => {
  event.preventDefault();
  if (!pinModalEditingId) {
    closePinEditDialog();
    return;
  }
  const label = pinEditLabelEl?.value.trim() || '';
  const url = pinEditUrlEl?.value.trim() || '';
  const parsed = parseKintoneUrl(url);
  const host = parsed.host || hostFromUrl(url);
  const appId = (pinEditAppIdEl?.value || parsed.appId || '').toString().trim();
  const recordId = (pinEditRecordIdEl?.value || parsed.recordId || '').toString().trim();
  const titleField = pinEditTitleFieldEl?.value.trim() || '';
  const note = pinEditNoteEl?.value.trim() || '';

  if (!host || !appId || !recordId) {
    alert(t('alert_required_pin_fields'));
    return;
  }

  const idx = pinnedEntries.findIndex((item) => item.id === pinModalEditingId);
  if (idx === -1) {
    closePinEditDialog();
    return;
  }
  pinnedEntries[idx] = normalizePinnedEntry({
    id: pinModalEditingId,
    label,
    host,
    appId,
    recordId,
    titleField,
    note,
    pinnedAt: pinnedEntries[idx]?.pinnedAt,
    modifiedAt: Date.now()
  });
  await savePinnedEntries();
  renderPinnedEntries();
  closePinEditDialog();
});

addBtn.addEventListener('click', async () => {
  const label = labelEl.value.trim();
  const urlRaw = urlEl.value.trim();
  let { host, appId, viewIdOrName } = parseKintoneUrl(urlRaw);

  if (appIdEl.value.trim()) appId = appIdEl.value.trim();
  if (viewEl.value.trim()) viewIdOrName = viewEl.value.trim();
  const query = queryEl.value.trim() || '';
  const icon = sanitizeIcon(iconEl?.value);
  const iconColor = sanitizeIconColor(iconColorEl?.value);
  const category = sanitizeCategory(categoryEl?.value);

  if (!urlRaw || !host || !String(appId || '').trim()) {
    alert(t('alert_invalid_kintone_url'));
    return;
  }
  if (!(await ensureHostPermissionFor(host))) {
    alert(t('alert_host_permission_denied'));
    return;
  }

  const list = await loadFavorites();
  const limit = getWatchlistLimit();
  if (list.length >= limit) {
    alert(t('alert_watchlist_limit_reached', { limit }));
    renderWatchlistLimitHint(list.length);
    return;
  }
  const resolvedQuery = await resolveWatchlistSavedQuery({
    host,
    appId: appId || '',
    viewIdOrName: viewIdOrName || '',
    url: urlRaw,
    query
  });
  if (!resolvedQuery.ok) {
    alert(t('alert_watch_add_query_resolve_failed'));
    return;
  }
  const canonicalUrl = buildWatchlistUrl(host, appId, resolvedQuery.viewId);
  if (!canonicalUrl) {
    alert(t('alert_watch_add_query_resolve_failed'));
    return;
  }
  if (list.some((x) => x.url === canonicalUrl)) {
    alert(t('alert_duplicate_url'));
    return;
  }
  const resolvedTitle = label || `${t('app_prefix')} ${String(appId || '').trim()}`;

  const item = {
    id: createId(),
    label: resolvedTitle,
    title: resolvedTitle,
    url: canonicalUrl,
    host,
    appId: String(appId || '').trim(),
    viewId: String(resolvedQuery.viewId || '').trim(),
    viewIdOrName: String(resolvedQuery.viewId || '').trim(),
    viewName: resolvedQuery.viewName || '',
    query: String(resolvedQuery.query || ''),
    queryRepairRequired: false,
    icon,
    iconColor,
    category,
    order: list.length,
    pinned: false
  };

  const next = [...list, item];
  await saveFavorites(next);
  await render(next);

  // 入力クリア（ラベルは残す）
  urlEl.value = '';
  appIdEl.value = '';
  viewEl.value = '';
  queryEl.value = '';
  if (iconEl) {
    iconEl.value = DEFAULT_ICON;
  }
  if (iconColorEl) {
    iconColorEl.value = DEFAULT_ICON_COLOR;
  }
  if (iconEl) {
    renderIconPreview(iconPreviewEl, iconEl.value, iconColorEl?.value);
  }
  if (categoryEl) categoryEl.value = '';
});

// 初期表示
(async () => {
  await initializeI18n();
  await loadWatchlistLimitSetting();
  const loadedItems = await loadFavorites();
  const migrated = await migrateWatchlistQueriesIfNeeded(loadedItems);
  const items = migrated.items;
  await warmHostPermissionStatus(items);
  await render(items);

  const [core, shortcutStored] = await Promise.all([
    import('./core.js'),
    chrome.storage.sync.get(['kfavShortcutsVisible'])
  ]);
  shortcutEntries = core
    .sortShortcuts(await core.loadShortcuts())
    .map((item, idx) => normalizeShortcutEntryLocal(item, idx))
    .filter(Boolean);
  const visibleFlag = shortcutStored.kfavShortcutsVisible;
  shortcutsVisible = typeof visibleFlag === 'boolean' ? visibleFlag : true;
  if (shortcutToggleEl) shortcutToggleEl.checked = shortcutsVisible;
  renderShortcutEntries();

  const pinsStored = await chrome.storage.sync.get(['kfavPins', PIN_VISIBLE_KEY]);
  const pinRaw = pinsStored.kfavPins;
  const pinArr = Array.isArray(pinRaw) ? pinRaw : pinRaw ? [pinRaw] : [];
  pinnedEntries = pinArr.map(normalizePinnedEntry).filter(Boolean);
  renderPinnedEntries();
  resetPinnedForm();
  const pinVisibleFlag = pinsStored[PIN_VISIBLE_KEY];
  const pinVisible = typeof pinVisibleFlag === 'boolean' ? pinVisibleFlag : true;
  if (pinVisibleToggleEl) pinVisibleToggleEl.checked = pinVisible;

  await Promise.all([
    loadOverlayLayoutPresets(),
    loadExcelOverlayMode(),
    loadShortcutSearchOpenMode(),
    loadWatchlistRefreshPreset(),
    loadDeveloperProOverride(),
    loadApiUsageStats(),
  ]);
  optionsDataReady = true;

})();

if (chrome?.storage?.onChanged) {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && Object.prototype.hasOwnProperty.call(changes, UI_LANGUAGE_KEY)) {
      void applyUiLanguageSetting(changes[UI_LANGUAGE_KEY].newValue, { persist: false });
    }
    if (area === 'local' && Object.prototype.hasOwnProperty.call(changes, DEVELOPER_PRO_OVERRIDE_KEY)) {
      if (developerProOverrideEl && isDeveloperUiEnabled()) {
        developerProOverrideEl.checked = Boolean(changes[DEVELOPER_PRO_OVERRIDE_KEY].newValue);
      }
    }
    if (area === 'local' && Object.prototype.hasOwnProperty.call(changes, WATCHLIST_REFRESH_PRESET_KEY)) {
      if (watchlistRefreshPresetEl) {
        watchlistRefreshPresetEl.value = normalizeWatchlistRefreshPreset(changes[WATCHLIST_REFRESH_PRESET_KEY].newValue);
      }
    }
    if (area === 'local' && Object.prototype.hasOwnProperty.call(changes, WATCHLIST_LIMIT_KEY)) {
      watchlistLimit = normalizeWatchlistLimit(changes[WATCHLIST_LIMIT_KEY].newValue);
      loadFavorites()
        .then((items) => renderWatchlistLimitHint(items.length))
        .catch(() => renderWatchlistLimitHint(0));
    }
    if (area === 'local' && Object.prototype.hasOwnProperty.call(changes, API_USAGE_DAILY_KEY)) {
      apiUsageDaily = normalizeApiUsageDaily(changes[API_USAGE_DAILY_KEY].newValue);
      renderApiUsageStats();
    }

    if (area === 'sync' && Object.prototype.hasOwnProperty.call(changes, 'kfavPins')) {
      const next = changes.kfavPins.newValue;
      const arr = Array.isArray(next) ? next : next ? [next] : [];
      pinnedEntries = arr.map(normalizePinnedEntry).filter(Boolean);
      renderPinnedEntries();
    }
    if (area === 'sync' && Object.prototype.hasOwnProperty.call(changes, PIN_VISIBLE_KEY)) {
      const flag = typeof changes[PIN_VISIBLE_KEY].newValue === 'boolean'
        ? changes[PIN_VISIBLE_KEY].newValue
        : true;
      if (pinVisibleToggleEl) pinVisibleToggleEl.checked = flag;
    }
    if (area === 'local' && Object.prototype.hasOwnProperty.call(changes, OVERLAY_LAYOUT_PRESETS_KEY)) {
      overlayLayoutPresets = normalizeOverlayLayoutPresets(changes[OVERLAY_LAYOUT_PRESETS_KEY].newValue);
      renderOverlayLayoutPresets();
    }
    if (area === 'local' && Object.keys(changes).some((key) => String(key || '').startsWith(PB_METADATA_CACHE_PREFIX))) {
      loadOverlayAppNameLookup()
        .then(() => renderOverlayLayoutPresets())
        .catch(() => {});
    }
    if (area === 'sync' && Object.prototype.hasOwnProperty.call(changes, EXCEL_OVERLAY_MODE_KEY)) {
      const requestedMode = normalizeExcelOverlayMode(changes[EXCEL_OVERLAY_MODE_KEY].newValue);
      const mode = getEffectiveExcelOverlayMode(requestedMode);
      excelModeInputs.forEach((input) => {
        input.checked = input.value === mode;
      });
      if (requestedMode === EXCEL_OVERLAY_MODE_PRO) {
        setExcelModeNotice(t(EXCEL_OVERLAY_MODE_PRO_NOTICE_KEY));
      } else {
        setExcelModeNotice('');
      }
    }
    if (area === 'sync' && Object.prototype.hasOwnProperty.call(changes, SHORTCUT_SEARCH_OPEN_MODE_KEY)) {
      const mode = normalizeShortcutSearchOpenMode(changes[SHORTCUT_SEARCH_OPEN_MODE_KEY].newValue);
      shortcutSearchModeInputs.forEach((input) => {
        input.checked = input.value === mode;
      });
    }
  });
}

function hostFromUrl(u){
  if (!u) return '';
  try {
    return new URL(u).origin;
  } catch {
    try {
      return new URL(`https://${u}`).origin;
    } catch {
      return '';
    }
  }
}

async function rerenderLocalizedDynamicSections() {
  if (!optionsDataReady) return;
  const items = await loadFavorites();
  await render(items);
  renderShortcutEntries();
  renderPinnedEntries();
  renderOverlayLayoutPresets();
  renderApiUsageStats(); 
}

async function refreshLocalizedFormControls() {
  const mainColor = sanitizeIconColor(iconColorEl?.value);
  const editColor = sanitizeIconColor(editIconColorEl?.value);
  populateIconColorSelect(iconColorEl);
  populateIconColorSelect(editIconColorEl);
  if (iconColorEl) iconColorEl.value = mainColor;
  if (editIconColorEl) editIconColorEl.value = editColor;
  renderIconPreview(iconPreviewEl, sanitizeIcon(iconEl?.value), mainColor);
  renderIconPreview(editIconPreviewEl, sanitizeIcon(editIconEl?.value), editColor);

  if (pinSaveBtn && !pinModalEditingId) {
    pinSaveBtn.textContent = t('common_add');
  }

  const host = hostFromUrl(hostPermInputEl?.value?.trim() || '');
  if (hostPermStatusEl) {
    if (host) {
      await updatePermStatus(host);
    } else {
      hostPermStatusEl.textContent = t('host_perm_status_unknown');
    }
  }
}

async function applyUiLanguageSetting(settingValue, { persist = false } = {}) {
  const setting = normalizeUiLanguageSetting(settingValue);
  currentUiLanguageSetting = setting;
  currentLang = resolveEffectiveUiLanguage(setting);
  document.documentElement.lang = currentLang;
  document.title = t('settings_title');
  if (persist) {
    await chrome.storage.local.set({ [UI_LANGUAGE_KEY]: setting });
  }
  applyI18n(document);
  updateDeveloperProOverrideVisibility();
  if (uiLanguageEl) {
    uiLanguageEl.value = setting;
  }
  const noticeVisible = Boolean(excelModeNoticeEl && !excelModeNoticeEl.hidden);
  if (noticeVisible) {
    setExcelModeNotice(t(EXCEL_OVERLAY_MODE_PRO_NOTICE_KEY));
  }
  await refreshLocalizedFormControls();
  await rerenderLocalizedDynamicSections();
}

function normalizeExcelOverlayMode(value) {
  const mode = String(value || '').trim().toLowerCase();
  if (mode === 'edit') return EXCEL_OVERLAY_MODE_PRO;
  if (mode === 'view') return EXCEL_OVERLAY_MODE_STANDARD;
  return EXCEL_OVERLAY_MODE_VALUES.includes(mode) ? mode : DEFAULT_EXCEL_OVERLAY_MODE;
}

function getEffectiveExcelOverlayMode(value) {
  const normalized = normalizeExcelOverlayMode(value);
  if (normalized === EXCEL_OVERLAY_MODE_PRO) return EXCEL_OVERLAY_MODE_STANDARD;
  return normalized;
}

function setExcelModeNotice(message) {
  if (!excelModeNoticeEl) return;
  const text = String(message || '').trim();
  if (!text) {
    excelModeNoticeEl.hidden = true;
    excelModeNoticeEl.textContent = t(EXCEL_OVERLAY_MODE_PRO_NOTICE_KEY);
    return;
  }
  excelModeNoticeEl.hidden = false;
  excelModeNoticeEl.textContent = text;
}

function setMetadataCacheStatus(message) {
  if (!metadataCacheStatusEl) return;
  metadataCacheStatusEl.textContent = String(message || '').trim() || t('metadata_cache_clear_desc');
}

function normalizeShortcutSearchOpenMode(value) {
  return SHORTCUT_SEARCH_OPEN_MODE_VALUES.includes(value)
    ? value
    : DEFAULT_SHORTCUT_SEARCH_OPEN_MODE;
}

function normalizeWatchlistRefreshPreset(value) {
  const preset = String(value || '').trim().toLowerCase();
  return WATCHLIST_REFRESH_PRESET_VALUES.includes(preset)
    ? preset
    : DEFAULT_WATCHLIST_REFRESH_PRESET;
}

async function loadExcelOverlayMode() {
  if (!excelModeInputs.length) return;
  const stored = await chrome.storage.sync.get(EXCEL_OVERLAY_MODE_KEY);
  const requestedMode = normalizeExcelOverlayMode(stored[EXCEL_OVERLAY_MODE_KEY]);
  const mode = getEffectiveExcelOverlayMode(requestedMode);
  excelModeInputs.forEach((input) => {
    input.checked = input.value === mode;
  });
  if (requestedMode === EXCEL_OVERLAY_MODE_PRO) {
    await saveExcelOverlayMode(EXCEL_OVERLAY_MODE_STANDARD);
  }
  setExcelModeNotice('');
}

async function loadShortcutSearchOpenMode() {
  if (!shortcutSearchModeInputs.length) return;
  const stored = await chrome.storage.sync.get(SHORTCUT_SEARCH_OPEN_MODE_KEY);
  const mode = normalizeShortcutSearchOpenMode(stored[SHORTCUT_SEARCH_OPEN_MODE_KEY]);
  shortcutSearchModeInputs.forEach((input) => {
    input.checked = input.value === mode;
  });
}

async function loadWatchlistRefreshPreset() {
  if (!watchlistRefreshPresetEl) return;
  try {
    const stored = await chrome.storage.local.get(WATCHLIST_REFRESH_PRESET_KEY);
    const rawPreset = stored?.[WATCHLIST_REFRESH_PRESET_KEY];
    const normalizedPreset = normalizeWatchlistRefreshPreset(rawPreset);
    watchlistRefreshPresetEl.value = normalizedPreset;
    if (rawPreset !== normalizedPreset) {
      await saveWatchlistRefreshPreset(normalizedPreset);
    }
  } catch (_err) {
    watchlistRefreshPresetEl.value = DEFAULT_WATCHLIST_REFRESH_PRESET;
    await saveWatchlistRefreshPreset(DEFAULT_WATCHLIST_REFRESH_PRESET);
  }
}

async function saveExcelOverlayMode(modeValue) {
  const mode = getEffectiveExcelOverlayMode(modeValue);
  await chrome.storage.sync.set({ [EXCEL_OVERLAY_MODE_KEY]: mode });
}

async function saveShortcutSearchOpenMode(modeValue) {
  const mode = normalizeShortcutSearchOpenMode(modeValue);
  await chrome.storage.sync.set({ [SHORTCUT_SEARCH_OPEN_MODE_KEY]: mode });
}

async function saveWatchlistRefreshPreset(presetValue) {
  const preset = normalizeWatchlistRefreshPreset(presetValue);
  await chrome.storage.local.set({ [WATCHLIST_REFRESH_PRESET_KEY]: preset });
}

excelModeInputs.forEach((input) => {
  input.addEventListener('change', async () => {
    if (!input.checked) return;
    const selectedMode = normalizeExcelOverlayMode(input.value);
    if (selectedMode === EXCEL_OVERLAY_MODE_PRO) {
      setExcelModeNotice(t(EXCEL_OVERLAY_MODE_PRO_NOTICE_KEY));
      const fallback = excelModeInputs.find((node) => node.value === EXCEL_OVERLAY_MODE_STANDARD);
      if (fallback) fallback.checked = true;
      await saveExcelOverlayMode(EXCEL_OVERLAY_MODE_STANDARD);
      return;
    }
    setExcelModeNotice('');
    await saveExcelOverlayMode(selectedMode);
  });
});

shortcutSearchModeInputs.forEach((input) => {
  input.addEventListener('change', async () => {
    if (!input.checked) return;
    await saveShortcutSearchOpenMode(input.value);
  });
});

watchlistRefreshPresetEl?.addEventListener('change', async () => {
  const preset = normalizeWatchlistRefreshPreset(watchlistRefreshPresetEl.value);
  watchlistRefreshPresetEl.value = preset;
  await saveWatchlistRefreshPreset(preset);
});

uiLanguageEl?.addEventListener('change', async () => {
  const setting = normalizeUiLanguageSetting(uiLanguageEl.value);
  await applyUiLanguageSetting(setting, { persist: true });
});

developerProOverrideEl?.addEventListener('change', async () => {
  if (!isDeveloperUiEnabled()) return;
  await chrome.storage.local.set({
    [DEVELOPER_PRO_OVERRIDE_KEY]: Boolean(developerProOverrideEl.checked)
  });
});

apiUsageResetBtn?.addEventListener('click', async () => {
  if (!window.confirm(t('api_usage_reset_confirm'))) return;
  await resetApiUsageStats();
});

metadataCacheClearBtn?.addEventListener('click', async () => {
  if (!window.confirm(t('metadata_cache_clear_confirm'))) return;
  setMetadataCacheStatus('...');
  try {
    const response = await chrome.runtime.sendMessage({ type: 'PB_CLEAR_METADATA_CACHE_ALL' });
    if (response?.ok) {
      setMetadataCacheStatus(t('metadata_cache_clear_done'));
      return;
    }
    setMetadataCacheStatus(t('metadata_cache_clear_failed'));
  } catch (_err) {
    setMetadataCacheStatus(t('metadata_cache_clear_failed'));
  }
});

// ---- Overlay layout presets ----
function normalizeOverlayLayoutPreset(rawPreset, index = 0) {
  if (!rawPreset || typeof rawPreset !== 'object') return null;
  const id = String(rawPreset.id || `preset_${index + 1}`).trim();
  if (!id) return null;
  const name = String(rawPreset.name || '').trim() || `Preset ${index + 1}`;
  const visibleColumns = Array.isArray(rawPreset.visibleColumns)
    ? Array.from(new Set(rawPreset.visibleColumns.map((code) => String(code || '').trim()).filter(Boolean)))
    : [];
  const allowed = new Set(visibleColumns);
  const columnOrderRaw = Array.isArray(rawPreset.columnOrder) ? rawPreset.columnOrder : [];
  const seen = new Set();
  const columnOrder = [];
  columnOrderRaw.forEach((codeRaw) => {
    const code = String(codeRaw || '').trim();
    if (!code || seen.has(code)) return;
    if (allowed.size > 0 && !allowed.has(code)) return;
    columnOrder.push(code);
    seen.add(code);
  });
  visibleColumns.forEach((code) => {
    if (seen.has(code)) return;
    columnOrder.push(code);
    seen.add(code);
  });
  const rawWidths = rawPreset.columnWidths && typeof rawPreset.columnWidths === 'object'
    ? rawPreset.columnWidths
    : {};
  const columnWidths = {};
  Object.entries(rawWidths).forEach(([codeRaw, widthRaw]) => {
    const code = String(codeRaw || '').trim();
    if (!code) return;
    const numeric = Number(widthRaw);
    if (!Number.isFinite(numeric) || numeric <= 0) return;
    columnWidths[code] = Math.round(numeric);
  });
  return {
    id,
    name,
    scope: String(rawPreset.scope || '').trim().toLowerCase() === 'detail' ? 'detail' : 'list',
    visibleColumns,
    columnOrder,
    columnWidths,
    pinnedColumns: Array.isArray(rawPreset.pinnedColumns)
      ? Array.from(new Set(rawPreset.pinnedColumns.map((code) => String(code || '').trim()).filter(Boolean)))
      : []
  };
}

function normalizeOverlayLayoutPresets(raw) {
  if (!raw || typeof raw !== 'object') return {};
  const next = {};
  Object.entries(raw).forEach(([keyRaw, value]) => {
    const key = String(keyRaw || '').trim();
    if (!key || !value || typeof value !== 'object') return;
    const presetsRaw = Array.isArray(value.presets) ? value.presets : [];
    const presets = presetsRaw
      .map((preset, index) => normalizeOverlayLayoutPreset(preset, index))
      .filter(Boolean);
    if (!presets.length) return;
    const activePresetIdRaw = String(value.activePresetId || '').trim();
    const activePresetId = presets.some((preset) => preset.id === activePresetIdRaw)
      ? activePresetIdRaw
      : presets[0].id;
    next[key] = {
      host: String(value.host || key.split('::')[0] || '').trim(),
      appId: String(value.appId || key.split('::')[1] || '').trim(),
      appName: String(value.appName || '').trim(),
      activePresetId,
      presets,
      updatedAt: Number(value.updatedAt || 0)
    };
  });
  return next;
}

function makeOverlayLayoutAppLookupKey(host, appId) {
  const safeHost = String(host || '').trim().toLowerCase();
  const safeAppId = String(appId || '').trim();
  if (!safeHost || !safeAppId) return '';
  return `${safeHost}::${safeAppId}`;
}

async function loadOverlayAppNameLookup() {
  const lookup = {};
  try {
    const all = await chrome.storage.local.get(null);
    Object.entries(all || {}).forEach(([key, value]) => {
      if (!String(key || '').startsWith(PB_METADATA_CACHE_PREFIX)) return;
      const suffix = String(key).slice(PB_METADATA_CACHE_PREFIX.length);
      const splitAt = suffix.lastIndexOf(':');
      if (splitAt <= 0) return;
      const host = suffix.slice(0, splitAt).trim().toLowerCase();
      const appId = suffix.slice(splitAt + 1).trim();
      const appName = String(value?.app?.name || '').trim();
      const appKey = makeOverlayLayoutAppLookupKey(host, appId);
      if (!appKey || !appName) return;
      lookup[appKey] = appName;
    });
  } catch (_err) {
    // ignore
  }
  overlayAppNameLookup = lookup;
}

function getOverlayPresetDisplayName(preset) {
  const safePreset = preset && typeof preset === 'object' ? preset : {};
  if (String(safePreset.scope || '').trim().toLowerCase() === 'detail') {
    return t('overlay_layout_detail_name');
  }
  const name = String(safePreset.name || '').trim();
  return name || '-';
}

function formatPrefDate(ts) {
  if (!ts) return '-';
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '-';
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${yyyy}/${mm}/${dd} ${hh}:${mi}`;
}

function toLocalDateKey(date = new Date()) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function normalizeApiUsageDaily(raw) {
  if (!raw || typeof raw !== 'object') return {};
  const daily = {};
  Object.entries(raw).forEach(([dateKey, featureMap]) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateKey))) return;
    if (!featureMap || typeof featureMap !== 'object') return;
    const normalizedFeatureMap = {};
    Object.entries(featureMap).forEach(([featureKey, bucket]) => {
      const feature = normalizeApiUsageFeature(featureKey);
      if (isApiUsageStatLike(bucket)) {
        mergeApiUsageStat(normalizedFeatureMap, feature, createApiUsageStat(bucket));
        return;
      }
      // Legacy format: { date: { menu: { purpose: { count/success/error } } } }
      if (!bucket || typeof bucket !== 'object') return;
      Object.values(bucket).forEach((legacyStat) => {
        if (!isApiUsageStatLike(legacyStat)) return;
        mergeApiUsageStat(normalizedFeatureMap, feature, createApiUsageStat(legacyStat));
      });
    });
    if (Object.keys(normalizedFeatureMap).length) {
      daily[dateKey] = normalizedFeatureMap;
    }
  });
  return daily;
}


function normalizeApiUsageFeature(rawFeature) {
  const feature = String(rawFeature || '').trim().toLowerCase();
  if (API_USAGE_FEATURE_VALUES.has(feature)) return feature;
  if (Object.prototype.hasOwnProperty.call(API_USAGE_LEGACY_FEATURE_MAP, feature)) {
    return API_USAGE_LEGACY_FEATURE_MAP[feature];
  }
  return 'other';
}

function isApiUsageStatLike(raw) {
  if (!raw || typeof raw !== 'object') return false;
  return Object.prototype.hasOwnProperty.call(raw, 'count')
    || Object.prototype.hasOwnProperty.call(raw, 'success')
    || Object.prototype.hasOwnProperty.call(raw, 'error');
}

function createApiUsageStat(raw) {
  const count = Number(raw?.count || 0);
  const success = Number(raw?.success || 0);
  const error = Number(raw?.error || 0);
  return {
    count: Number.isFinite(count) && count > 0 ? count : 0,
    success: Number.isFinite(success) && success > 0 ? success : 0,
    error: Number.isFinite(error) && error > 0 ? error : 0
  };
}

function mergeApiUsageStat(featureMap, featureValue, stat) {
  const feature = normalizeApiUsageFeature(featureValue);
  const current = featureMap[feature] || { count: 0, success: 0, error: 0 };
  current.count += Number(stat?.count || 0);
  current.success += Number(stat?.success || 0);
  current.error += Number(stat?.error || 0);
  featureMap[feature] = current;
}

function pruneApiUsageDaily(daily) {
  const cutoff = new Date();
  cutoff.setHours(0, 0, 0, 0);
  cutoff.setDate(cutoff.getDate() - (API_USAGE_RETENTION_DAYS - 1));
  const cutoffKey = toLocalDateKey(cutoff);
  let changed = false;
  Object.keys(daily).forEach((dateKey) => {
    if (dateKey < cutoffKey) {
      delete daily[dateKey];
      changed = true;
    }
  });
  return changed;
}

function buildRangeDateKeys(days) {
  const keys = [];
  const span = Math.max(1, Number(days) || 1);
  const cursor = new Date();
  cursor.setHours(0, 0, 0, 0);
  for (let i = 0; i < span; i += 1) {
    const d = new Date(cursor);
    d.setDate(cursor.getDate() - i);
    keys.push(toLocalDateKey(d));
  }
  return keys;
}

function aggregateApiUsage(days) {
  const keys = new Set(buildRangeDateKeys(days));
  const byFeature = {};
  let total = 0;
  let success = 0;
  let error = 0;

  Object.entries(apiUsageDaily).forEach(([dateKey, featureMap]) => {
    if (!keys.has(dateKey)) return;
    Object.entries(featureMap || {}).forEach(([feature, stat]) => {
      const countValue = Number(stat?.count || 0);
      const successValue = Number(stat?.success || 0);
      const errorValue = Number(stat?.error || 0);
      const resolvedCount = countValue > 0 ? countValue : successValue + errorValue;
      if (!resolvedCount && !successValue && !errorValue) return;
      const normalizedFeature = normalizeApiUsageFeature(feature);
      total += resolvedCount;
      success += successValue;
      error += errorValue;
      byFeature[normalizedFeature] = (byFeature[normalizedFeature] || 0) + resolvedCount;
    });
  });

  return { total, success, error, byFeature };
}
function aggregateApiUsageDisplay(days) {
  const base = aggregateApiUsage(days);
  const grouped = {};

  API_USAGE_DISPLAY_GROUP_ORDER.forEach((group) => {
    grouped[group] = 0;
  });

  Object.entries(base.byFeature || {}).forEach(([feature, count]) => {
    const group = resolveApiUsageDisplayGroup(feature);
    grouped[group] = (grouped[group] || 0) + Number(count || 0);
  });

  return {
    total: base.total,
    success: base.success,
    error: base.error,
    byGroup: grouped
  };
}


function setApiUsageMetric(el, value) {
  if (!el) return;
  const num = Number(value || 0);
  el.textContent = String(Number.isFinite(num) && num >= 0 ? num : 0);
}

function renderApiUsageFeatureTable(today, week, month) {
  if (!apiUsageFeatureTableBodyEl) return;
  apiUsageFeatureTableBodyEl.innerHTML = '';

  API_USAGE_DISPLAY_GROUP_ORDER.forEach((group) => {
    const row = document.createElement('tr');

    const nameCell = document.createElement('td');
    nameCell.textContent = t(API_USAGE_DISPLAY_GROUP_LABEL_KEYS[group] || group);

    const todayCell = document.createElement('td');
    todayCell.textContent = String(Number(today.byGroup?.[group] || 0));

    const weekCell = document.createElement('td');
    weekCell.textContent = String(Number(week.byGroup?.[group] || 0));

    const monthCell = document.createElement('td');
    monthCell.textContent = String(Number(month.byGroup?.[group] || 0));

    row.appendChild(nameCell);
    row.appendChild(todayCell);
    row.appendChild(weekCell);
    row.appendChild(monthCell);

    apiUsageFeatureTableBodyEl.appendChild(row);
  });
}
function resolveApiUsageDisplayGroup(feature) {
  const normalized = normalizeApiUsageFeature(feature);

  for (const [group, features] of Object.entries(API_USAGE_DISPLAY_GROUP_MAP)) {
    if (features.includes(normalized)) return group;
  }

  return 'admin';
}

function renderApiUsageStats() {
  if (!apiUsageFeatureTableBodyEl) return;
  const todayRaw = aggregateApiUsage(1);
  const weekRaw = aggregateApiUsage(7);
  const monthRaw = aggregateApiUsage(30);

  const today = aggregateApiUsageDisplay(1);
  const week = aggregateApiUsageDisplay(7);
  const month = aggregateApiUsageDisplay(30);

  setApiUsageMetric(apiUsageTodayTotalEl, todayRaw.total);
  setApiUsageMetric(apiUsageTodaySuccessEl, todayRaw.success);
  setApiUsageMetric(apiUsageTodayErrorEl, todayRaw.error);

  setApiUsageMetric(apiUsage7dTotalEl, weekRaw.total);
  setApiUsageMetric(apiUsage7dSuccessEl, weekRaw.success);
  setApiUsageMetric(apiUsage7dErrorEl, weekRaw.error);

  setApiUsageMetric(apiUsage30dTotalEl, monthRaw.total);
  setApiUsageMetric(apiUsage30dSuccessEl, monthRaw.success);
  setApiUsageMetric(apiUsage30dErrorEl, monthRaw.error);

  renderApiUsageFeatureTable(today, week, month);

}


async function loadApiUsageStats() {
  const stored = await chrome.storage.local.get([API_USAGE_DAILY_KEY]);
  const normalized = normalizeApiUsageDaily(stored?.[API_USAGE_DAILY_KEY]);
  const pruned = pruneApiUsageDaily(normalized);
  apiUsageDaily = normalized;

  if (pruned) {
    if (Object.keys(normalized).length) {
      await chrome.storage.local.set({ [API_USAGE_DAILY_KEY]: normalized });
    } else {
      await chrome.storage.local.remove(API_USAGE_DAILY_KEY);
    }
  }

  renderApiUsageStats();
}


function getOverlayLayoutActivePreset(entry) {
  if (!entry || !Array.isArray(entry.presets) || !entry.presets.length) return null;
  const activeId = String(entry.activePresetId || '').trim();
  return entry.presets.find((preset) => preset.id === activeId) || entry.presets[0];
}

function renderOverlayLayoutPresets() {
  if (!excelListEl) return;
  excelListEl.innerHTML = '';
  const entries = Object.entries(overlayLayoutPresets)
    .map(([key, state]) => ({ key, state }))
    .sort((a, b) => (Number(b.state?.updatedAt || 0) - Number(a.state?.updatedAt || 0)));

  if (!entries.length) {
    const li = document.createElement('li');
    li.className = 'excel-columns-empty';
    li.innerHTML = `${t('layout_empty_title')}<br/>${t('layout_empty_desc')}`;
    excelListEl.appendChild(li);
    return;
  }

  entries.forEach((entryBundle) => {
    const { key, state } = entryBundle;
    const activePreset = getOverlayLayoutActivePreset(state);
    const appLookupKey = makeOverlayLayoutAppLookupKey(state.host, state.appId);
    const appName = String(state.appName || overlayAppNameLookup[appLookupKey] || '').trim();
    const li = document.createElement('li');
    li.className = 'excel-columns-item';
    li.dataset.appKey = key;

    const info = document.createElement('div');
    info.className = 'excel-columns-info';
    const title = document.createElement('div');
    title.className = 'excel-columns-title';
    const appLabel = appName || (state.appId ? `${t('app_prefix')} ${state.appId}` : t('app_unspecified'));
    title.textContent = appLabel;

    const meta = document.createElement('div');
    meta.className = 'excel-columns-meta';
    const appIdMeta = document.createElement('span');
    appIdMeta.textContent = `${t('app_prefix')} ${state.appId || '-'}`;
    const hostMeta = document.createElement('span');
    hostMeta.textContent = state.host || '-';
    const active = document.createElement('span');
    active.textContent = `${t('overlay_layout_active')}: ${getOverlayPresetDisplayName(activePreset)}`;
    const presetCount = document.createElement('span');
    presetCount.textContent = `${t('overlay_layout_presets')}: ${Array.isArray(state.presets) ? state.presets.length : 0}`;
    const saved = document.createElement('span');
    saved.textContent = `${t('layout_meta_saved')}: ${formatPrefDate(state.updatedAt)}`;
    meta.appendChild(appIdMeta);
    meta.appendChild(hostMeta);
    meta.appendChild(active);
    meta.appendChild(presetCount);
    meta.appendChild(saved);

    const keyMeta = document.createElement('span');
    keyMeta.textContent = `${t('overlay_layout_key')}: ${key}`;
    meta.appendChild(keyMeta);

    info.appendChild(title);
    info.appendChild(meta);

    const presetList = document.createElement('div');
    presetList.className = 'overlay-preset-list';
    (Array.isArray(state.presets) ? state.presets : []).forEach((preset) => {
      const row = document.createElement('div');
      row.className = 'overlay-preset-item';

      const rowInfo = document.createElement('div');
      rowInfo.className = 'overlay-preset-item-info';
      const name = document.createElement('div');
      name.className = 'overlay-preset-item-title';
      name.textContent = getOverlayPresetDisplayName(preset);
      if (preset.id === state.activePresetId) {
        const activeBadge = document.createElement('span');
        activeBadge.className = 'excel-layout-scope excel-layout-scope--detail';
        activeBadge.textContent = t('overlay_layout_active_badge');
        name.appendChild(activeBadge);
      }
      const rowMeta = document.createElement('div');
      rowMeta.className = 'excel-columns-meta';
      const visibleCount = Array.isArray(preset.visibleColumns) ? preset.visibleColumns.length : 0;
      const orderPreview = Array.isArray(preset.columnOrder)
        ? preset.columnOrder.slice(0, 4).join(', ')
        : '';
      const visible = document.createElement('span');
      visible.textContent = `${t('overlay_layout_visible_columns')}: ${visibleCount}`;
      const order = document.createElement('span');
      order.textContent = `${t('overlay_layout_order_preview')}: ${orderPreview || '-'}`;
      rowMeta.appendChild(visible);
      rowMeta.appendChild(order);
      rowInfo.appendChild(name);
      rowInfo.appendChild(rowMeta);

      const rowActions = document.createElement('div');
      rowActions.className = 'excel-columns-actions';
      if (preset.id !== state.activePresetId) {
        const setActiveBtn = document.createElement('button');
        setActiveBtn.type = 'button';
        setActiveBtn.className = 'pb-layout-set-active';
        setActiveBtn.dataset.appKey = key;
        setActiveBtn.dataset.layoutId = String(preset.id || '');
        setActiveBtn.textContent = t('overlay_layout_set_active');
        rowActions.appendChild(setActiveBtn);
      }
      const renameBtn = document.createElement('button');
      renameBtn.type = 'button';
      renameBtn.className = 'pb-layout-rename';
      renameBtn.dataset.appKey = key;
      renameBtn.dataset.layoutId = String(preset.id || '');
      renameBtn.textContent = t('overlay_layout_rename');
      rowActions.appendChild(renameBtn);

      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'btn-danger-subtle pb-layout-delete';
      removeBtn.dataset.appKey = key;
      removeBtn.dataset.layoutId = String(preset.id || '');
      removeBtn.textContent = t('delete');
      removeBtn.disabled = false;
      rowActions.appendChild(removeBtn);

      row.appendChild(rowInfo);
      row.appendChild(rowActions);
      presetList.appendChild(row);
    });
    info.appendChild(presetList);

    const actions = document.createElement('div');
    actions.className = 'excel-columns-actions';
    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'btn-danger-subtle pb-layout-delete-app';
    removeBtn.dataset.appKey = key;
    removeBtn.textContent = t('overlay_layout_delete_app');
    actions.appendChild(removeBtn);

    li.appendChild(info);
    li.appendChild(actions);
    excelListEl.appendChild(li);
  });
}

async function loadOverlayLayoutPresets() {
  if (!excelListEl) return;
  const [stored] = await Promise.all([
    chrome.storage.local.get(OVERLAY_LAYOUT_PRESETS_KEY),
    loadOverlayAppNameLookup()
  ]);
  overlayLayoutPresets = normalizeOverlayLayoutPresets(stored?.[OVERLAY_LAYOUT_PRESETS_KEY]);
  renderOverlayLayoutPresets();
}

async function saveOverlayLayoutPresetsMap(next) {
  if (Object.keys(next).length) {
    await chrome.storage.local.set({ [OVERLAY_LAYOUT_PRESETS_KEY]: next });
  } else {
    await chrome.storage.local.remove(OVERLAY_LAYOUT_PRESETS_KEY);
  }
}

async function setOverlayLayoutActivePreset(key, presetId) {
  const state = overlayLayoutPresets[key];
  if (!state || !Array.isArray(state.presets)) return;
  if (!state.presets.some((preset) => preset.id === presetId)) return;
  const next = {
    ...overlayLayoutPresets,
    [key]: {
      ...state,
      activePresetId: presetId,
      updatedAt: Date.now()
    }
  };
  overlayLayoutPresets = next;
  await saveOverlayLayoutPresetsMap(next);
  renderOverlayLayoutPresets();
}

async function renameOverlayLayoutPreset(key, presetId) {
  const state = overlayLayoutPresets[key];
  if (!state || !Array.isArray(state.presets)) return;
  const target = state.presets.find((preset) => preset.id === presetId);
  if (!target) return;
  const input = window.prompt(t('overlay_layout_prompt_name'), target.name || '');
  if (input == null) return;
  const nextName = String(input || '').replace(/\s+/g, ' ').trim().slice(0, 40);
  if (!nextName) return;
  const nextPresets = state.presets.map((preset) => (
    preset.id === presetId ? { ...preset, name: nextName } : preset
  ));
  const next = {
    ...overlayLayoutPresets,
    [key]: {
      ...state,
      presets: nextPresets,
      updatedAt: Date.now()
    }
  };
  overlayLayoutPresets = next;
  await saveOverlayLayoutPresetsMap(next);
  renderOverlayLayoutPresets();
}

async function removeOverlayLayoutPreset(key, presetId) {
  const state = overlayLayoutPresets[key];
  if (!state || !Array.isArray(state.presets)) return;
  if (!window.confirm(t('overlay_layout_delete_preset_confirm'))) return;
  await deleteLayoutById(presetId, key);
}

async function deleteLayoutById(layoutId, appKeyHint = '') {
  const targetLayoutId = String(layoutId || '').trim();
  if (!targetLayoutId) return false;
  const hintKey = String(appKeyHint || '').trim();
  const candidateKeys = hintKey && overlayLayoutPresets[hintKey]
    ? [hintKey]
    : Object.keys(overlayLayoutPresets || {});
  const next = { ...overlayLayoutPresets };
  let changed = false;
  candidateKeys.some((key) => {
    const state = next[key];
    if (!state || !Array.isArray(state.presets)) return false;
    const before = state.presets.length;
    const nextPresets = state.presets.filter((preset) => String(preset?.id || '') !== targetLayoutId);
    if (nextPresets.length === before) return false;
    if (!nextPresets.length) {
      delete next[key];
    } else {
      const activePresetId = nextPresets.some((preset) => String(preset?.id || '') === String(state.activePresetId || ''))
        ? state.activePresetId
        : nextPresets[0].id;
      next[key] = {
        ...state,
        activePresetId,
        presets: nextPresets,
        updatedAt: Date.now()
      };
    }
    changed = true;
    return true;
  });
  if (!changed) return false;
  overlayLayoutPresets = next;
  await saveOverlayLayoutPresetsMap(next);
  renderOverlayLayoutPresets();
  return true;
}

async function removeOverlayLayoutApp(key) {
  if (!key || !overlayLayoutPresets[key]) return;
  if (!window.confirm(t('overlay_layout_delete_app_confirm'))) return;
  const next = { ...overlayLayoutPresets };
  delete next[key];
  overlayLayoutPresets = next;
  await saveOverlayLayoutPresetsMap(next);
  renderOverlayLayoutPresets();
}

async function handleOverlayLayoutListClick(event) {
  if (!excelListEl) return;
  const target = event?.target;
  if (!(target instanceof Element)) return;

  const setActiveBtn = target.closest('.pb-layout-set-active');
  if (setActiveBtn && excelListEl.contains(setActiveBtn)) {
    const appKey = String(setActiveBtn.dataset.appKey || '').trim();
    const layoutId = String(setActiveBtn.dataset.layoutId || '').trim();
    if (!appKey || !layoutId) return;
    await setOverlayLayoutActivePreset(appKey, layoutId);
    return;
  }

  const renameBtn = target.closest('.pb-layout-rename');
  if (renameBtn && excelListEl.contains(renameBtn)) {
    const appKey = String(renameBtn.dataset.appKey || '').trim();
    const layoutId = String(renameBtn.dataset.layoutId || '').trim();
    if (!appKey || !layoutId) return;
    await renameOverlayLayoutPreset(appKey, layoutId);
    return;
  }

  const deleteBtn = target.closest('.pb-layout-delete');
  if (deleteBtn && excelListEl.contains(deleteBtn)) {
    const appKey = String(deleteBtn.dataset.appKey || '').trim();
    const layoutId = String(deleteBtn.dataset.layoutId || '').trim();
    if (!layoutId) return;
    console.debug('[SpreadsheetView] layout delete click', { layoutId, appKey: appKey || '-' });
    if (!window.confirm(t('overlay_layout_delete_preset_confirm'))) return;
    await deleteLayoutById(layoutId, appKey);
    return;
  }

  const deleteAppBtn = target.closest('.pb-layout-delete-app');
  if (deleteAppBtn && excelListEl.contains(deleteAppBtn)) {
    const appKey = String(deleteAppBtn.dataset.appKey || '').trim();
    if (!appKey) return;
    await removeOverlayLayoutApp(appKey);
  }
}

excelListEl?.addEventListener('click', (event) => {
  void handleOverlayLayoutListClick(event);
});

excelClearBtn?.addEventListener('click', async () => {
  if (!Object.keys(overlayLayoutPresets).length) return;
  if (!window.confirm(t('confirm_clear_layouts'))) return;
  overlayLayoutPresets = {};
  await chrome.storage.local.remove(OVERLAY_LAYOUT_PRESETS_KEY);
  renderOverlayLayoutPresets();
});

// ---- Host permission helpers ----
async function hasHostPermission(origin) {
  const pattern = originPatternFor(origin);
  if (!pattern || !chrome?.permissions?.contains) return false;
  try {
    const granted = await chrome.permissions.contains({ origins: [pattern] });
    if (granted) rememberGrantedOrigin(origin);
    return granted;
  } catch (error) {
    console.warn('host permission check failed', error);
    return false;
  }
}

async function requestHostPermission(origin) {
  const pattern = originPatternFor(origin);
  if (!pattern || !chrome?.permissions?.request) return false;
  try {
    const granted = await chrome.permissions.request({ origins: [pattern] });
    if (granted) rememberGrantedOrigin(origin);
    return granted;
  } catch (error) {
    console.warn('host permission request failed', error);
    return false;
  }
}

async function updatePermStatus(origin, statusEl = hostPermStatusEl) {
  const el = statusEl;
  if (!el) return false;
  const normalized = normalizeOrigin(origin);
  if (!normalized) {
    el.textContent = t('host_perm_status_unknown');
    return false;
  }
  const granted = await hasHostPermission(normalized);
  el.textContent = granted ? t('host_perm_status_granted') : t('host_perm_status_denied');
  return granted;
}

hostPermRequestBtn?.addEventListener('click', async () => {
  const raw = hostPermInputEl?.value?.trim() || '';
  const host = hostFromUrl(raw);
  if (!host) {
    alert(t('alert_invalid_kintone_url_or_host'));
    await updatePermStatus('');
    return;
  }
  const ok = await requestHostPermission(host);
  await updatePermStatus(host);
  if (!ok) {
    alert(t('alert_permission_cancelled'));
    return;
  }
  if (hostPermInputEl) hostPermInputEl.value = host;
  alert(t('alert_permission_granted'));
});

hostPermCheckBtn?.addEventListener('click', async () => {
  const raw = hostPermInputEl?.value?.trim() || '';
  const host = hostFromUrl(raw);
  if (!host) {
    alert(t('alert_invalid_kintone_url_or_host'));
    await updatePermStatus('');
    return;
  }
  await updatePermStatus(host);
});


// ---- pinned events ----
pinResetBtn?.addEventListener('click', () => {
  resetPinnedForm();
});
pinVisibleToggleEl?.addEventListener('change', async () => {
  const visible = Boolean(pinVisibleToggleEl.checked);
  await chrome.storage.sync.set({ [PIN_VISIBLE_KEY]: visible });
});
pinSaveBtn?.addEventListener('click', async () => {
  const label = pinLabelEl?.value.trim() || '';
  const url = pinUrlEl.value.trim();
  const parsed = parseKintoneUrl(url);
  const host = parsed.host || hostFromUrl(url);
  const appId = (pinAppIdEl.value || parsed.appId || '').toString().trim();
  const recordId = (pinRecordIdEl.value || parsed.recordId || '').toString().trim();
  const titleField = pinTitleFieldEl.value.trim();
  const note = pinNoteEl.value.trim();

  if (!host || !appId || !recordId) {
    alert(t('alert_required_pin_fields'));
    return;
  }

  const entry = normalizePinnedEntry({
    id: createId(),
    label,
    host,
    appId,
    recordId,
    titleField,
    note,
    pinnedAt: Date.now(),
    modifiedAt: Date.now()
  });
  pinnedEntries.push(entry);

  await savePinnedEntries();
  renderPinnedEntries();
  resetPinnedForm();
});
pinUrlEl?.addEventListener('change', () => {
  const raw = pinUrlEl.value.trim();
  const parsed = parseKintoneUrl(raw);
  if (parsed.appId && !pinAppIdEl.value) pinAppIdEl.value = parsed.appId;
  if (parsed.recordId && !pinRecordIdEl.value) pinRecordIdEl.value = parsed.recordId;
});
pinEditUrlEl?.addEventListener('change', () => {
  const raw = pinEditUrlEl.value.trim();
  const parsed = parseKintoneUrl(raw);
  if (parsed.appId && pinEditAppIdEl && !pinEditAppIdEl.value) pinEditAppIdEl.value = parsed.appId;
  if (parsed.recordId && pinEditRecordIdEl && !pinEditRecordIdEl.value) pinEditRecordIdEl.value = parsed.recordId;
});
// ------------------------------------------------------------
// Developer tools loader (DEV build only)
// Store build では読み込まない
// 
function loadDevToolsIfNeeded() {
  try {
    const manifest = chrome.runtime.getManifest();
    const isDevToolsEnabled = manifest?.plugbits_dev_tools === true;

    if (!isDevToolsEnabled) {
      return;
    }

    const script = document.createElement('script');
    script.src = chrome.runtime.getURL('dev-tools.js');

    script.onload = () => {
      console.log('[PlugBits] Developer tools loaded');
    };

    script.onerror = () => {
      console.warn('[PlugBits] Failed to load dev-tools.js');
    };

    document.head.appendChild(script);
  } catch (err) {
    console.warn('[PlugBits] dev-tools init failed', err);
  }
}

loadDevToolsIfNeeded();