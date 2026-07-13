'use strict';

import {
  loadFavorites,
  saveFavorites,
  sortFavorites,
  loadShortcuts,
  sortShortcuts,
  loadShortcutVisibility,
  saveShortcutVisibility,
  getActiveTab,
  parseKintoneUrl,
  isKintoneUrl,
  hasHostPermission,
  ensureHostPermission,
  sendRunInKintone,
  sendCountBulk,
  createId,
  loadRecordPinVisibility,
  loadRecentRecords,
  saveRecentRecords,
  loadAppNameMap,
  buildKintoneUrl
} from './core.js';
import { initPins } from './pins.js';

const MAX_SHORTCUT_INITIAL_LENGTH = 2;
const SHORTCUT_SEARCH_OPEN_MODE_KEY = 'shortcutSearchOpenMode';
const SHORTCUT_SEARCH_OPEN_MODE_CURRENT_TAB = 'current_tab';
const SHORTCUT_SEARCH_OPEN_MODE_NEW_TAB = 'new_tab';
const MESSAGE_OPEN_OVERLAY = 'EXCEL_OPEN_OVERLAY_FROM_SIDEPANEL';
const MESSAGE_GET_OVERLAY_STATE = 'EXCEL_GET_OVERLAY_LAUNCH_STATE';
const COLLAPSED_SECTIONS_KEY = 'kfavLauncherCollapsedSections';
const WATCHLIST_COUNT_CACHE_KEY = 'kfavWatchlistCountCache';
const WATCHLIST_REFRESH_PRESET_KEY = 'pb_watchlist_refresh_preset';
const WATCHLIST_REFRESH_PRESET_VALUES = ['eco', 'normal', 'fast'];
const WATCHLIST_REFRESH_PRESET_DEFAULT = 'normal';
const WATCHLIST_LIMIT_KEY = 'pb_watchlist_limit';
const DEFAULT_WATCHLIST_LIMIT = 3;
const MAX_WATCHLIST_LIMIT = 5;
const WATCHLIST_LIMIT_VALUES = [DEFAULT_WATCHLIST_LIMIT, MAX_WATCHLIST_LIMIT];
const WATCHLIST_REFRESH_PRESET_CONFIGS = {
  eco: {
    visibleTickMs: 10 * 60 * 1000,
    cooldownMs: 180 * 1000,
    resumeThrottleMs: 10 * 1000
  },
  normal: {
    visibleTickMs: 5 * 60 * 1000,
    cooldownMs: 90 * 1000,
    resumeThrottleMs: 5 * 1000
  },
  fast: {
    visibleTickMs: 2 * 60 * 1000,
    cooldownMs: 30 * 1000,
    resumeThrottleMs: 3 * 1000
  }
};
const WATCHLIST_SOFT_TTL_MS = 5 * 60 * 1000;
const WATCHLIST_HARD_TTL_MS = 30 * 60 * 1000;
const UI_LANGUAGE_KEY = 'uiLanguage';
const UI_LANGUAGE_VALUES = ['auto', 'ja', 'en'];
const DEFAULT_UI_LANGUAGE = 'auto';
const DEFAULT_LANGUAGE = 'ja';
const DEFAULT_LOCALE = 'ja';
const HOST_ONBOARDING_DISMISSED_KEY = 'pbHostPermissionOnboardingDismissedHosts';
const MANUAL_URL = 'https://plugbits.app/launcher/manual.html';

const I18N_MESSAGES = {
  ja: {
    panel_title: 'kintone Base Launcher',
    panel_search_label: '検索',
    panel_search_placeholder: '検索（ラベル / URL / ホスト）',
    panel_shortcuts_toolbar: 'ショートカット一覧',
    panel_section_shortcuts: 'ショートカット',
    panel_section_watchlist_pinned: 'ウォッチリスト（固定）',
    panel_section_watchlist: 'ウォッチリスト',
    panel_section_record_pins: 'レコードピン',
    panel_section_recent_records: '最近のレコード',
    panel_action_toggle_search_show: '検索を表示',
    panel_action_toggle_search_hide: '検索を隠す',
    panel_action_open_overlay: 'Excel Overlay',
    panel_action_open_overlay_view_only: 'Excel Overlay (View only)',
    panel_action_open_overlay_unsupported: 'Excel Overlay (一覧/詳細画面のみ)',
    panel_action_open_settings: '設定を開く',
    panel_settings_menu_settings: '設定',
    panel_settings_menu_manual: 'はじめかた',
    panel_action_clear_search: '検索をクリア',
    panel_action_toggle_shortcuts_collapse: 'ショートカットを折りたたむ',
    panel_action_toggle_shortcuts_expand: 'ショートカットを展開',
    panel_action_add_current_view: '現在のkintoneビューを追加',
    panel_action_refresh_counts: '件数を更新',
    panel_action_toggle_watchlist_collapse: 'ウォッチリストを折りたたむ',
    panel_action_toggle_watchlist_expand: 'ウォッチリストを展開',
    panel_action_add_current_record_pin: '現在のレコードをピン留め',
    panel_action_refresh_pins: 'ピンを更新',
    panel_action_toggle_record_pins_collapse: 'レコードピンを折りたたむ',
    panel_action_toggle_record_pins_expand: 'レコードピンを展開',
    panel_action_toggle_recent_records_collapse: '最近のレコードを折りたたむ',
    panel_action_toggle_recent_records_expand: '最近のレコードを展開',
    panel_action_clear_recent_records: '履歴をクリア',
    panel_action_app_search: 'アプリ検索',
    panel_app_search_placeholder: 'アプリ名で検索',
    panel_app_search_load_failed: 'アプリ一覧を取得できませんでした',
    panel_app_search_no_results: '一致するアプリがありません',
    panel_collapsed_sections_label: '折りたたみ済みセクション',
    panel_collapsed_watchlist: 'ウォッチリスト',
    panel_collapsed_record_pins: 'レコードピン',
    panel_collapsed_recent_records: '最近のレコード',
    panel_recent_app_fallback: 'App',
    panel_recent_app_prefix: 'App',
    panel_empty_pinned_no_match: '検索条件に一致するピン留めはありません',
    panel_empty_pinned: 'ピン留めされた項目はありません',
    panel_empty_favorites_no_match: '検索条件に一致するウォッチリストはありません',
    panel_empty_favorites: 'ウォッチリストはまだありません',
    panel_empty_favorites_cta: 'このビューを追加',
    panel_empty_favorites_hint: 'kintoneの一覧画面を開いた状態で押すと、そのビューの件数を見張れます',
    pins_empty_message: 'ピン留めされたレコードはまだありません',
    pins_empty_pin_current: '現在のレコードをピン',
    pins_empty_hint: 'kintoneのレコード詳細を開いた状態で押すと、メモ付きで保存できます',
    pins_refresh_label: '更新',
    pins_refresh_title: 'ピン留めレコードを更新',
    pins_drag_reorder: 'ドラッグで並び替え',
    pins_open: '開く',
    pins_remove: '削除',
    pins_note_placeholder: 'メモ',
    pins_meta_updated: '更新',
    pins_unset: '未設定',
    pins_notice_open_kintone_first: 'kintoneのレコードタブを開いてください',
    pins_notice_open_record_detail: 'レコード詳細画面を開いてから再試行してください',
    pins_notice_already_pinned: 'このレコードは既にピン留めされています',
    pins_notice_pinned: 'ピン留めしました',
    pins_notice_removed: 'ピンを削除しました',
    panel_watchlist_status_refreshing: '更新中...',
    panel_watchlist_status_stale: '情報が古い可能性があります',
    panel_watchlist_status_queued: '更新待ち',
    panel_empty_shortcuts: 'ショートカットを設定',
    panel_entry_no_label: '(no label)',
    panel_tab_main: 'メイン',
    panel_tab_pins: 'レコードピン',
    panel_action_pin_entry: '固定表示にする',
    panel_action_unpin_entry: '固定を解除',
    panel_action_rename_entry: '名前を変更',
    panel_action_delete_entry: '削除',
    panel_dialog_rename_title: '表示名を変更',
    panel_dialog_delete_title: 'ウォッチリストから削除',
    panel_dialog_delete_message: '「{label}」を削除します。よろしいですか？',
    panel_dialog_save: '保存',
    panel_dialog_cancel: 'キャンセル',
    panel_dialog_delete_confirm: '削除',
    panel_tour_eyebrow: 'はじめに',
    panel_tour_title: '3ステップではじめる',
    panel_tour_dismiss: 'このガイドを閉じる（再表示されません）',
    panel_tour_step1: 'kintoneの一覧を開いて、件数を見張るビューを登録',
    panel_tour_step1_cta: 'このビューを追加',
    panel_tour_step2: '一覧をExcelのように表示・編集（Ctrl+Shift+E）',
    panel_tour_step2_cta: '今すぐ開く',
    panel_tour_step3: 'コマンドパレットでどこへでも移動（Ctrl+/）',
    panel_tour_step3_cta: 'ショートカット一覧',
    panel_footer_shortcuts: 'ショートカット一覧',
    panel_footer_shortcuts_title: 'キーボードショートカット一覧を表示（kintoneタブで開きます）',
    panel_footer_palette: 'パレット',
    panel_badge_not_fetched: '未取得',
    panel_badge_permission_required: 'ホスト権限が必要です',
    panel_badge_missing_result: 'この項目の件数が返されませんでした',
    panel_badge_fetch_failed: '件数取得に失敗しました',
    panel_notice_permission_missing_hosts: '次のホスト権限が不足しています: {hosts}',
    panel_notice_counts_failed: '一部ホストの件数取得に失敗しました。ログを確認してください。',
    panel_watchlist_last_updated: '更新: {time}',
    panel_watchlist_last_updated_none: '更新: -',
    panel_notice_shortcut_url_missing: 'ショートカットURLが設定されていません',
    panel_notice_open_kintone_first: '先にkintoneタブを開いてください',
    panel_notice_parse_url_failed: 'URLを解析できませんでした',
    panel_notice_already_registered: 'このビューは既に登録済みです',
    panel_notice_added: 'ウォッチリストに追加しました',
    panel_notice_added_fetching: 'ウォッチリストに追加しました。件数を取得しています...',
    panel_notice_add_failed: 'ウォッチリストの追加に失敗しました',
    panel_notice_watchlist_limit_reached: 'ウォッチリストは{limit}件まで登録できます',
    panel_notice_watchlist_query_resolve_failed: 'ビューの Query を取得できませんでした。設定画面で再保存してください',
    panel_notice_favorites_stale: '他のタブで更新がありました。最新状態を再読み込みしました。',
    panel_notice_overlay_unsupported: 'この画面では Excel Overlay を利用できません（一覧/詳細画面で利用できます）',
    panel_notice_overlay_open_failed: 'Excel Overlay の起動に失敗しました',
    panel_notice_overlay_disabled: 'Excel Overlay は設定で無効になっています（設定画面の「スプレッドシート」から有効化できます）',
    panel_notice_permission_granted: 'ホストアクセスを許可しました: {host}',
    panel_notice_permission_cancelled: 'ホストアクセスの許可がキャンセルされました',
    panel_notice_url_required: 'URLは必須です',
    panel_notice_kintone_url_required: 'kintone URLを入力してください',
    panel_notice_updated: '更新しました',
    panel_notice_icon_updated: 'アイコンを更新しました',
    panel_notice_category_updated: 'カテゴリを更新しました',
    panel_notice_initialization_failed: '初期化に失敗しました',
    panel_host_onboarding_eyebrow: '初回設定',
    panel_host_onboarding_title: 'ホストアクセスを設定',
    panel_host_onboarding_desc: '件数取得やショートカットを使うには、現在の kintone ホストへのアクセスを許可してください。',
    panel_host_onboarding_desc_no_host: '初回設定では kintone ホストへのアクセス許可が必要です。先に kintone タブを開くか、設定画面から手動で追加してください。',
    panel_host_onboarding_host_label: '対象ホスト',
    panel_host_onboarding_allow: 'このホストを許可',
    panel_host_onboarding_detect: '現在のホストを確認',
    panel_host_onboarding_allowing: '許可を確認中...',
    panel_host_onboarding_settings: '設定画面を開く',
    panel_host_onboarding_later: 'あとで',
    panel_prompt_edit_label: 'ラベルを編集',
    panel_prompt_edit_url: 'URLを編集',
    panel_prompt_icon: 'アイコン名を入力\n選択肢: {icons}',
    panel_prompt_category: 'カテゴリを入力（空欄 = その他）',
    panel_confirm_delete_shortcut: 'このショートカットを削除しますか？',
    panel_meta_view_prefix: 'view',
    panel_search_panel_placeholder: 'パネル内を検索'
  },
  en: {
    panel_title: 'kintone Base Launcher',
    panel_search_label: 'Search',
    panel_search_placeholder: 'Search (label / URL / host)',
    panel_shortcuts_toolbar: 'Shortcut list',
    panel_section_shortcuts: 'Shortcuts',
    panel_section_watchlist_pinned: 'Watchlist (starred)',
    panel_section_watchlist: 'Watchlist',
    panel_section_record_pins: 'Record pins',
    panel_section_recent_records: 'Recent records',
    panel_action_toggle_search_show: 'Show search',
    panel_action_toggle_search_hide: 'Hide search',
    panel_action_open_overlay: 'Excel Overlay',
    panel_action_open_overlay_view_only: 'Excel Overlay (View only)',
    panel_action_open_overlay_unsupported: 'Excel Overlay (List / Detail only)',
    panel_action_open_settings: 'Open settings',
    panel_settings_menu_settings: 'Settings',
    panel_settings_menu_manual: 'Getting Started',
    panel_action_clear_search: 'Clear search',
    panel_action_toggle_shortcuts_collapse: 'Collapse shortcuts',
    panel_action_toggle_shortcuts_expand: 'Expand shortcuts',
    panel_action_add_current_view: 'Add current kintone view',
    panel_action_refresh_counts: 'Refresh counts',
    panel_action_toggle_watchlist_collapse: 'Collapse watchlist',
    panel_action_toggle_watchlist_expand: 'Expand watchlist',
    panel_action_add_current_record_pin: 'Pin current record',
    panel_action_refresh_pins: 'Refresh pins',
    panel_action_toggle_record_pins_collapse: 'Collapse record pins',
    panel_action_toggle_record_pins_expand: 'Expand record pins',
    panel_action_toggle_recent_records_collapse: 'Collapse recent records',
    panel_action_toggle_recent_records_expand: 'Expand recent records',
    panel_action_clear_recent_records: 'Clear history',
    panel_action_app_search: 'App search',
    panel_app_search_placeholder: 'Search app name',
    panel_app_search_load_failed: 'App list could not be loaded',
    panel_app_search_no_results: 'No apps matched',
    panel_collapsed_sections_label: 'Collapsed sections',
    panel_collapsed_watchlist: 'Watchlist',
    panel_collapsed_record_pins: 'Record pins',
    panel_collapsed_recent_records: 'Recent records',
    panel_recent_app_fallback: 'App',
    panel_recent_app_prefix: 'App',
    panel_empty_pinned_no_match: 'No pinned items matched your search',
    panel_empty_pinned: 'No pinned items yet',
    panel_empty_favorites_no_match: 'No watchlist items matched your search',
    panel_empty_favorites: 'No watchlist items yet',
    panel_empty_favorites_cta: 'Add this view',
    panel_empty_favorites_hint: 'Open a kintone list view first, then press this to watch its record count',
    pins_empty_message: 'No pinned records yet',
    pins_empty_pin_current: 'Pin current record',
    pins_empty_hint: 'Open a kintone record first, then press this to save it with a note',
    pins_refresh_label: 'Refresh',
    pins_refresh_title: 'Refresh pinned records',
    pins_drag_reorder: 'Drag to reorder',
    pins_open: 'Open',
    pins_remove: 'Remove',
    pins_note_placeholder: 'Notes',
    pins_meta_updated: 'Updated',
    pins_unset: '(unset)',
    pins_notice_open_kintone_first: 'Open a kintone record tab first.',
    pins_notice_open_record_detail: 'Open a record detail page and try again.',
    pins_notice_already_pinned: 'This record is already pinned.',
    pins_notice_pinned: 'Pinned.',
    pins_notice_removed: 'Pin removed.',
    panel_watchlist_status_refreshing: 'refreshing...',
    panel_watchlist_status_stale: 'may be stale',
    panel_watchlist_status_queued: 'sync queued',
    panel_empty_shortcuts: 'Configure shortcuts',
    panel_entry_no_label: '(no label)',
    panel_tab_main: 'Main',
    panel_tab_pins: 'Record pins',
    panel_action_pin_entry: 'Star (keep at top)',
    panel_action_unpin_entry: 'Unstar',
    panel_action_rename_entry: 'Rename',
    panel_action_delete_entry: 'Delete',
    panel_dialog_rename_title: 'Rename item',
    panel_dialog_delete_title: 'Remove from watchlist',
    panel_dialog_delete_message: 'Remove "{label}" from the watchlist?',
    panel_dialog_save: 'Save',
    panel_dialog_cancel: 'Cancel',
    panel_dialog_delete_confirm: 'Remove',
    panel_tour_eyebrow: 'Getting started',
    panel_tour_title: 'Start in 3 steps',
    panel_tour_dismiss: 'Dismiss this guide (it will not show again)',
    panel_tour_step1: 'Open a kintone list and register the view to watch its count',
    panel_tour_step1_cta: 'Add this view',
    panel_tour_step2: 'View and edit lists like Excel (Ctrl+Shift+E)',
    panel_tour_step2_cta: 'Open now',
    panel_tour_step3: 'Jump anywhere with the command palette (Ctrl+/)',
    panel_tour_step3_cta: 'Keyboard shortcuts',
    panel_footer_shortcuts: 'Keyboard shortcuts',
    panel_footer_shortcuts_title: 'Show the keyboard shortcut cheatsheet (opens in the kintone tab)',
    panel_footer_palette: 'Palette',
    panel_badge_not_fetched: 'Not fetched',
    panel_badge_permission_required: 'Host permission required',
    panel_badge_missing_result: 'Count was not returned for this item',
    panel_badge_fetch_failed: 'Failed to fetch count',
    panel_notice_permission_missing_hosts: 'Permission is missing for hosts: {hosts}',
    panel_notice_counts_failed: 'Some hosts failed to fetch counts. Check the log for details.',
    panel_watchlist_last_updated: 'Last updated: {time}',
    panel_watchlist_last_updated_none: 'Last updated: -',
    panel_notice_shortcut_url_missing: 'Shortcut URL is not configured',
    panel_notice_open_kintone_first: 'Open a kintone tab first',
    panel_notice_parse_url_failed: 'Could not parse the URL',
    panel_notice_already_registered: 'This view is already registered',
    panel_notice_added: 'Added to watchlist',
    panel_notice_added_fetching: 'Added to watchlist. Fetching counts...',
    panel_notice_add_failed: 'Failed to add watchlist item',
    panel_notice_watchlist_limit_reached: 'Watchlist is limited to {limit} items',
    panel_notice_watchlist_query_resolve_failed: 'Could not resolve view query. Re-save it from options',
    panel_notice_favorites_stale: 'Another tab updated watchlist. Reloaded the latest state.',
    panel_notice_overlay_unsupported: 'Excel Overlay is only available on list/detail pages',
    panel_notice_overlay_open_failed: 'Failed to open Excel Overlay',
    panel_notice_overlay_disabled: 'Excel Overlay is turned off in settings (enable it from the Spreadsheet section)',
    panel_notice_permission_granted: 'Host access granted: {host}',
    panel_notice_permission_cancelled: 'Host access request was cancelled',
    panel_notice_url_required: 'URL is required',
    panel_notice_kintone_url_required: 'Please enter a kintone URL',
    panel_notice_updated: 'Updated',
    panel_notice_icon_updated: 'Icon updated',
    panel_notice_category_updated: 'Category updated',
    panel_notice_initialization_failed: 'Initialization failed',
    panel_host_onboarding_eyebrow: 'Initial setup',
    panel_host_onboarding_title: 'Set host access',
    panel_host_onboarding_desc: 'Allow access to the current kintone host to enable counts, shortcuts, and other page integrations.',
    panel_host_onboarding_desc_no_host: 'Initial setup needs a kintone host permission. Open a kintone tab first, or add a host manually from settings.',
    panel_host_onboarding_host_label: 'Target host',
    panel_host_onboarding_allow: 'Allow this host',
    panel_host_onboarding_detect: 'Detect current host',
    panel_host_onboarding_allowing: 'Checking permission...',
    panel_host_onboarding_settings: 'Open settings',
    panel_host_onboarding_later: 'Later',
    panel_prompt_edit_label: 'Edit label',
    panel_prompt_edit_url: 'Edit URL',
    panel_prompt_icon: 'Enter icon name\nChoices: {icons}',
    panel_prompt_category: 'Enter category (empty = Other)',
    panel_confirm_delete_shortcut: 'Delete this shortcut?',
    panel_meta_view_prefix: 'view',
    panel_search_panel_placeholder: 'Search panel'
  }
};

const doc = document;

const els = {
  hostOnboarding: doc.getElementById('hostOnboarding'),
  hostOnboardingDesc: doc.getElementById('hostOnboardingDesc'),
  hostOnboardingHost: doc.getElementById('hostOnboardingHost'),
  hostOnboardingHostValue: doc.getElementById('hostOnboardingHostValue'),
  hostOnboardingAllow: doc.getElementById('hostOnboardingAllow'),
  hostOnboardingOpenSettings: doc.getElementById('hostOnboardingOpenSettings'),
  hostOnboardingLater: doc.getElementById('hostOnboardingLater'),
  settingsMenu: doc.getElementById('settingsMenu'),
  openOptionsPageMenuItem: doc.getElementById('openOptionsPageMenuItem'),
  openManualMenuItem: doc.getElementById('openManualMenuItem'),
  openCheatsheet: doc.getElementById('openCheatsheet'),
  panelTour: doc.getElementById('panelTour'),
  panelTourDismiss: doc.getElementById('panelTourDismiss'),
  panelTourAddView: doc.getElementById('panelTourAddView'),
  panelTourOpenOverlay: doc.getElementById('panelTourOpenOverlay'),
  panelTourShowKeys: doc.getElementById('panelTourShowKeys'),
  filterPanel: doc.getElementById('filterPanel'),
  toggleFilterPanel: doc.getElementById('toggleFilterPanel'),
  filter: doc.getElementById('filter'),
  clearFilter: doc.getElementById('clearFilter'),
  togglePinsOnly: doc.getElementById('togglePinsOnly'),
  togglePinsOnlyIcon: doc.getElementById('togglePinsOnlyIcon'),
  pinnedList: doc.getElementById('pinnedWatchList'),
  pinSection: doc.getElementById('pinSection'),
  recentSection: doc.getElementById('recentSection'),
  recentList: doc.getElementById('recentList'),
  recentClear: doc.getElementById('recentClear'),
  toggleRecentRecords: null,
  appSearchToggle: null,
  appSearchPopover: null,
  appSearchInput: null,
  appSearchResults: null,
  listsScroll: doc.getElementById('listsScroll'),
  collapsedTray: null,
  collapsedTrayRow: null,
  recordPinSection: doc.getElementById('recordPinSection'),
  favSection: doc.getElementById('favSection'),
  favCategories: doc.getElementById('favCategories'),
  notice: doc.getElementById('notice'),
  refreshCounts: doc.getElementById('refreshCounts'),
  watchlistUpdatedAt: doc.getElementById('watchlistUpdatedAt'),
  quickAdd: doc.getElementById('quickAdd'),
  openExcelOverlay: doc.getElementById('openExcelOverlay'),
  openOptions: doc.getElementById('openOptions'),
  shortcutRow: doc.getElementById('shortcutRow'),
  shortcutPanel: doc.getElementById('shortcutPanel'),
  toggleShortcuts: doc.getElementById('toggleShortcuts'),
  toggleRecordPins: doc.getElementById('toggleRecordPins'),
  pinList: doc.getElementById('pinList'),
  panelTabBtns: doc.querySelectorAll('.panel-tab'),
  mainTabPane: doc.getElementById('tabpane-main'),
  pinsTabPane: doc.getElementById('tabpane-pins')
};

const state = {
  favorites: [],
  filterText: '',
  pinsOnly: false,
  badgeStatus: new Map(),
  noticeTimerId: 0,
  watchlistCountCache: new Map(),
  watchlistRefreshInFlight: false,
  watchlistLimit: DEFAULT_WATCHLIST_LIMIT,
  watchlistAutoRefreshTimerId: null,
  watchlistRefreshPreset: WATCHLIST_REFRESH_PRESET_DEFAULT,
  watchlistRefreshConfig: { ...WATCHLIST_REFRESH_PRESET_CONFIGS[WATCHLIST_REFRESH_PRESET_DEFAULT] },
  watchlistPanelMounted: true,
  watchlistWindowFocused: typeof document?.hasFocus === 'function' ? Boolean(document.hasFocus()) : true,
  watchlistFocusHandler: null,
  watchlistBlurHandler: null,
  watchlistVisibilityChangeHandler: null,
  watchlistTabActivatedHandler: null,
  watchlistPointerEnterHandler: null,
  watchlistClickHandler: null,
  watchlistLastResumeEventAt: 0,
  watchlistSectionSync: {
    inFlight: false,
    queued: false,
    lastStartedAt: 0,
    lastCompletedAt: 0,
    lastVisibleTickAt: 0,
    activeRequestId: '',
    pendingIgnoreCooldown: false,
    pendingReasons: [],
    pendingSources: {}
  },
  watchlistLifecycleToken: 0,
  watchlistResumeSourceAt: new Map(),
  favoritesStorageSignature: '',
  selectionIds: [],
  selectionIndex: -1,
  storageListener: null,
  runtimeListener: null,
  dragging: null,
  shortcutToggleHandler: null,
  recentRecords: [],
  filterPanelVisible: false,
  recordPinsCollapsed: false,
  recentRecordsCollapsed: false,
  appCatalog: [],
  appCatalogByHost: new Map(),
  appCatalogLoadedHosts: new Set(),
  appCatalogLastRequestedHosts: [],
  appCatalogInFlightHosts: new Set(),
  appCatalogLoadPromise: null,
  appCatalogSeq: 0,
  appCatalogError: false,
  appSearchOpen: false,
  appSearchQuery: '',
  appSearchMatches: [],
  appSearchActiveIndex: -1,
  pendingHostCacheRefreshHosts: new Set(),
  pendingHostCacheRefreshTimerId: 0,
  shortcutSearchOpenMode: SHORTCUT_SEARCH_OPEN_MODE_CURRENT_TAB,
  appSearchToggleHandler: null,
  appSearchInputHandler: null,
  appSearchInputKeydownHandler: null,
  appSearchOutsideHandler: null,
  settingsMenuOpen: false,
  settingsMenuOutsideHandler: null,
  activeTab: 'main',
  pinListObserver: null,
  uiLanguageSetting: DEFAULT_UI_LANGUAGE,
  currentLang: DEFAULT_LANGUAGE,
  hostOnboardingVisible: false,
  hostOnboardingHost: '',
  hostOnboardingBusy: false,
  overlayLaunchState: {
    pageType: 'unsupported',
    canEditOverlay: false
  }
};

const shortcutState = {
  entries: [],
  visible: true,
  warmedHosts: new Set()
};
const recordPinState = {
  visible: true,
  controller: null
};
const DEFAULT_ICON = 'file-text';
const DEFAULT_CATEGORY = 'Other';
const ICON_OPTIONS = [
  'clipboard', 'file-text', 'package', 'box', 'truck', 'factory', 'wrench', 'calendar',
  'list-checks', 'search', 'filter', 'chart-bar', 'receipt', 'users', 'settings', 'bookmark', 'star', 'history'
];
const DEFAULT_ICON_COLOR = 'gray';
const ICON_COLOR_OPTIONS = ['gray', 'blue', 'green', 'orange', 'red', 'purple'];
const APP_CANDIDATE_LIMIT = 10;
const SHORTCUT_MAX_VISIBLE = 16;
const CACHE_INVALIDATION_MESSAGE_TYPES = new Set([
  'CACHE_INVALIDATED',
  'PERMISSION_UPDATED',
  'HOST_PERMISSION_GRANTED',
  'HOST_PERMISSION_REMOVED'
]);

function normalizeUiLanguage(raw) {
  const value = String(raw || '').trim().toLowerCase();
  if (!value) return DEFAULT_LANGUAGE;
  if (value === 'ja' || value.startsWith('ja-')) return 'ja';
  return 'en';
}

function normalizeUiLanguageSetting(raw) {
  const value = String(raw || '').trim().toLowerCase();
  if (UI_LANGUAGE_VALUES.includes(value)) return value;
  return DEFAULT_UI_LANGUAGE;
}

function normalizeWatchlistRefreshPreset(raw) {
  const value = String(raw || '').trim().toLowerCase();
  if (WATCHLIST_REFRESH_PRESET_VALUES.includes(value)) return value;
  return WATCHLIST_REFRESH_PRESET_DEFAULT;
}

function normalizeWatchlistLimit(raw) {
  const value = Number(raw);
  if (WATCHLIST_LIMIT_VALUES.includes(value)) return value;
  return DEFAULT_WATCHLIST_LIMIT;
}

function isWatchlistQueryMissingValue(query) {
  if (query == null) return true;
  return String(query).trim() === '-';
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

async function getViewsForWatchlist(host, appId, cacheMap) {
  const cacheKey = `${String(host || '').trim()}::${String(appId || '').trim()}`;
  if (cacheMap?.has(cacheKey)) return cacheMap.get(cacheKey);
  const response = await sendRunInKintone(host, {
    type: 'LIST_VIEWS',
    payload: {
      appId: String(appId || '').trim(),
      __pbTrigger: 'watchlist_register',
      __pbSource: 'launcher_query_resolve'
    }
  });
  if (!response?.ok || !response?.views || typeof response.views !== 'object') {
    throw new Error(String(response?.error || 'LIST_VIEWS failed'));
  }
  if (cacheMap) cacheMap.set(cacheKey, response.views);
  return response.views;
}

async function resolveWatchlistSavedQuery(entry, viewsCache = new Map()) {
  const explicitRaw = entry?.query;
  const explicit = String(explicitRaw == null ? '' : explicitRaw).trim();
  const hasExplicitQuery = explicit.length > 0;
  const viewIdOrName = String(entry?.viewId || entry?.viewIdOrName || '').trim();
  const appId = String(entry?.appId || '').trim();
  const host = String(entry?.host || '').trim();
  if (!host || !appId) return { ok: false, query: '', viewId: '', viewName: '', reason: 'missing_host_or_app' };
  try {
    const views = await getViewsForWatchlist(host, appId, viewsCache);
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

async function migrateFavoritesQueryIfNeeded(list) {
  const source = Array.isArray(list) ? list.map((item) => ({ ...item })) : [];
  const targets = source.filter((item) => needsWatchlistQueryMigration(item));
  if (!targets.length) {
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
    await saveFavoritesWithStaleGuard(source, {
      source: 'query_migration',
      expectedSignature: buildFavoritesSignature(list)
    });
  }
  return { changed, items: source };
}

function buildWatchlistUrl(host, appId, viewId) {
  return buildKintoneUrl(host, appId, { viewId });
}

function getWatchlistRefreshPresetConfig(presetValue) {
  const preset = normalizeWatchlistRefreshPreset(presetValue);
  const config = WATCHLIST_REFRESH_PRESET_CONFIGS[preset] || WATCHLIST_REFRESH_PRESET_CONFIGS[WATCHLIST_REFRESH_PRESET_DEFAULT];
  return {
    preset,
    visibleTickMs: Number(config.visibleTickMs),
    cooldownMs: Number(config.cooldownMs),
    resumeThrottleMs: Number(config.resumeThrottleMs)
  };
}

function getWatchlistRefreshConfig() {
  return state.watchlistRefreshConfig || WATCHLIST_REFRESH_PRESET_CONFIGS[WATCHLIST_REFRESH_PRESET_DEFAULT];
}

async function loadWatchlistLimit() {
  try {
    const stored = await chrome.storage.local.get(WATCHLIST_LIMIT_KEY);
    const raw = stored?.[WATCHLIST_LIMIT_KEY];
    const normalized = normalizeWatchlistLimit(raw);
    state.watchlistLimit = normalized;
    if (raw !== normalized) {
      await chrome.storage.local.set({ [WATCHLIST_LIMIT_KEY]: normalized });
    }
  } catch (_err) {
    state.watchlistLimit = DEFAULT_WATCHLIST_LIMIT;
    try {
      await chrome.storage.local.set({ [WATCHLIST_LIMIT_KEY]: DEFAULT_WATCHLIST_LIMIT });
    } catch (_ignore) {
      // ignore
    }
  }
}

function applyWatchlistRefreshPreset(presetValue, { persist = false } = {}) {
  const next = getWatchlistRefreshPresetConfig(presetValue);
  state.watchlistRefreshPreset = next.preset;
  state.watchlistRefreshConfig = {
    visibleTickMs: next.visibleTickMs,
    cooldownMs: next.cooldownMs,
    resumeThrottleMs: next.resumeThrottleMs
  };
  if (persist) {
    return chrome.storage.local.set({ [WATCHLIST_REFRESH_PRESET_KEY]: next.preset });
  }
  return Promise.resolve();
}

async function loadWatchlistRefreshPreset() {
  try {
    const stored = await chrome.storage.local.get(WATCHLIST_REFRESH_PRESET_KEY);
    const rawPreset = stored?.[WATCHLIST_REFRESH_PRESET_KEY];
    const normalizedPreset = normalizeWatchlistRefreshPreset(rawPreset);
    await applyWatchlistRefreshPreset(normalizedPreset, { persist: false });
    if (rawPreset !== normalizedPreset) {
      await applyWatchlistRefreshPreset(normalizedPreset, { persist: true });
    }
  } catch (_err) {
    await applyWatchlistRefreshPreset(WATCHLIST_REFRESH_PRESET_DEFAULT, { persist: true });
  }
}

function getBrowserUiLanguage() {
  try {
    const browserLang = navigator.language || (Array.isArray(navigator.languages) ? navigator.languages[0] : '');
    return normalizeUiLanguage(browserLang);
  } catch (_err) {
    return DEFAULT_LANGUAGE;
  }
}

function resolveEffectiveUiLanguage(setting) {
  if (setting === 'ja' || setting === 'en') return setting;
  return getBrowserUiLanguage();
}

function t(key, vars) {
  const base = I18N_MESSAGES[state.currentLang]?.[key]
    ?? I18N_MESSAGES.ja?.[key]
    ?? key;
  if (!vars || typeof vars !== 'object') return base;
  return Object.keys(vars).reduce((text, name) => {
    return text.replaceAll(`{${name}}`, String(vars[name]));
  }, base);
}

function applyI18n(root = doc) {
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

function getSortLocale() {
  return state.currentLang === 'en' ? 'en' : DEFAULT_LOCALE;
}

async function initializeI18n() {
  let setting = DEFAULT_UI_LANGUAGE;
  try {
    const stored = await chrome.storage.local.get(UI_LANGUAGE_KEY);
    setting = normalizeUiLanguageSetting(stored?.[UI_LANGUAGE_KEY]);
  } catch (_err) {
    setting = DEFAULT_UI_LANGUAGE;
  }
  await applyUiLanguageSetting(setting, { persist: false, rerender: false });
}

async function applyUiLanguageSetting(settingValue, { persist = false, rerender = true } = {}) {
  const setting = normalizeUiLanguageSetting(settingValue);
  const nextLang = resolveEffectiveUiLanguage(setting);
  state.uiLanguageSetting = setting;
  state.currentLang = nextLang;
  doc.documentElement.lang = nextLang;
  applyI18n(doc);
  if (persist) {
    try {
      await chrome.storage.local.set({ [UI_LANGUAGE_KEY]: setting });
    } catch (_err) {
      // ignore
    }
  }
  if (rerender) {
    rerenderLocalizedUi();
  }
}

function rerenderLocalizedUi() {
  if (els.filter) {
    els.filter.placeholder = t('panel_search_placeholder');
  }
  if (els.collapsedTray) {
    els.collapsedTray.setAttribute('aria-label', t('panel_collapsed_sections_label'));
  }
  if (els.appSearchToggle) {
    els.appSearchToggle.title = t('panel_action_app_search');
    els.appSearchToggle.setAttribute('aria-label', t('panel_action_app_search'));
  }
  syncOverlayButtonLabel();
  if (els.appSearchInput) {
    els.appSearchInput.placeholder = t('panel_app_search_placeholder');
  }
  setFilterPanelVisible(state.filterPanelVisible);
  applyShortcutVisibility(shortcutState.visible);
  setWatchlistCollapsed(state.pinsOnly, { persist: false, source: 'i18n_rerender' });
  setRecordPinsCollapsed(state.recordPinsCollapsed, { persist: false });
  setRecentRecordsCollapsed(state.recentRecordsCollapsed, { persist: false });
  renderWatchlistUpdatedLabel();
  renderLists();
  renderShortcuts();
  renderRecentRecords();
  if (state.appSearchOpen) {
    refreshAppSearchMatches();
  } else {
    renderAppSearchResults();
  }
  renderHostOnboarding();
}

function normalizeIconName(value) {
  const name = typeof value === 'string' ? value.trim() : '';
  return ICON_OPTIONS.includes(name) ? name : DEFAULT_ICON;
}

function normalizeIconColor(value) {
  const color = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return ICON_COLOR_OPTIONS.includes(color) ? color : DEFAULT_ICON_COLOR;
}

function normalizeCategoryName(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function getCategoryLabel(value) {
  const name = normalizeCategoryName(value);
  return name || DEFAULT_CATEGORY;
}

function toPascalIconName(name) {
  return String(name || '')
    .trim()
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join('');
}

function iconToSvg(name, size = 16) {
  const lucide = globalThis.lucide;
  const icons = lucide?.icons;
  if (!icons) return '';
  // UI用アイコンはICON_OPTIONS(ユーザー選択用の許可リスト)に縛らず、
  // 指定名をそのまま解決し、見つからなければ既定アイコンに落とす
  const kebab = (typeof name === 'string' && name.trim()) || DEFAULT_ICON;
  const candidates = [kebab, toPascalIconName(kebab), DEFAULT_ICON, toPascalIconName(DEFAULT_ICON)];
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

function renderLucideIcons(root = doc) {
  const nodes = root.querySelectorAll('.lc[data-icon]');
  nodes.forEach((el) => {
    const svg = iconToSvg(String(el.dataset.icon || '').trim(), 16);
    el.innerHTML = svg;
  });
}

// 折りたたみトグルのアイコンを差し替える(Lucide、取得不可時は字形フォールバック)
function setCollapseIcon(el, collapsed) {
  if (!el) return;
  const svg = iconToSvg(collapsed ? 'chevron-right' : 'chevron-down', 14);
  if (svg) {
    el.innerHTML = svg;
  } else {
    el.textContent = collapsed ? '▶' : '▼';
  }
}

function escapeId(value) {
  if (value == null) return '';
  if (globalThis.CSS?.escape) return CSS.escape(String(value));
  return String(value).replace(/[^a-zA-Z0-9_-]/g, (ch) => `\\${ch}`);
}

function normalizeShortcutInitial(value) {
  if (value == null) return '';
  const str = String(value).trim();
  if (!str) return '';
  return Array.from(str).slice(0, MAX_SHORTCUT_INITIAL_LENGTH).join('');
}

function extractInitial(text) {
  const trimmed = text.trim();
  if (!trimmed) return '';
  const [first] = Array.from(trimmed);
  if (!first) return '';
  const upperCandidate = first.normalize('NFKC');
  if (/^[a-z]$/i.test(upperCandidate)) {
    return upperCandidate.toUpperCase();
  }
  return first;
}

function shortcutInitial(entry) {
  const custom = normalizeShortcutInitial(entry.initial);
  if (custom) return custom;
  const label = typeof entry.label === 'string' ? entry.label : '';
  const fallback = label.trim()
    || String(entry.appId || '').trim()
    || (entry.host || '').replace(/^https?:\/\//, '').trim();
  return extractInitial(fallback) || 'A';
}

function buildShortcutUrl(entry) {
  return buildKintoneUrl(entry.host, entry.appId, {
    mode: entry.type === 'create' ? 'create' : undefined,
    viewId: entry.type === 'view' ? entry.viewIdOrName : undefined
  });
}

function resolveShortcutIcon(entry) {
  return normalizeIconName(entry?.icon);
}

function resolveShortcutIconColor(entry) {
  return normalizeIconColor(entry?.iconColor);
}

function setNotice(message, options = {}) {
  const durationMs = Number.isFinite(options?.durationMs) ? Number(options.durationMs) : 4500;
  if (!els.notice) return;
  if (state.noticeTimerId) {
    window.clearTimeout(state.noticeTimerId);
    state.noticeTimerId = 0;
  }
  if (message) {
    els.notice.textContent = message;
    els.notice.classList.remove('hidden');
    if (durationMs > 0) {
      state.noticeTimerId = window.setTimeout(() => {
        state.noticeTimerId = 0;
        setNotice('');
      }, durationMs);
    }
  } else {
    els.notice.textContent = '';
    els.notice.classList.add('hidden');
  }
}

function setNoticeKey(key, vars, options) {
  setNotice(t(key, vars), options);
}

function openOptionsPage() {
  if (chrome?.runtime?.openOptionsPage) {
    chrome.runtime.openOptionsPage();
  } else {
    window.open(chrome.runtime.getURL('options.html'), '_blank');
  }
}

async function openManualPage() {
  if (chrome?.tabs?.create) {
    await chrome.tabs.create({ url: MANUAL_URL, active: true });
    return;
  }
  window.open(MANUAL_URL, '_blank', 'noopener');
}

function setSettingsMenuOpen(open) {
  state.settingsMenuOpen = Boolean(open);
  if (els.settingsMenu) {
    els.settingsMenu.classList.toggle('hidden', !state.settingsMenuOpen);
  }
  if (els.openOptions) {
    els.openOptions.setAttribute('aria-expanded', state.settingsMenuOpen ? 'true' : 'false');
  }
}

function formatHostForDisplay(origin) {
  return String(origin || '').replace(/^https?:\/\//, '');
}

function normalizeOnboardingDismissedHosts(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  return Object.fromEntries(
    Object.entries(raw)
      .map(([host, value]) => [normalizeHostOrigin(host), Boolean(value)])
      .filter(([host, value]) => host && value)
  );
}

async function loadDismissedHostOnboardingMap() {
  if (!chrome?.storage?.local) return {};
  try {
    const stored = await chrome.storage.local.get(HOST_ONBOARDING_DISMISSED_KEY);
    const normalized = normalizeOnboardingDismissedHosts(stored?.[HOST_ONBOARDING_DISMISSED_KEY]);
    if (JSON.stringify(normalized) !== JSON.stringify(stored?.[HOST_ONBOARDING_DISMISSED_KEY] || {})) {
      await chrome.storage.local.set({ [HOST_ONBOARDING_DISMISSED_KEY]: normalized });
    }
    return normalized;
  } catch (_err) {
    return {};
  }
}

async function saveDismissedHostOnboardingMap(map) {
  if (!chrome?.storage?.local) return;
  const normalized = normalizeOnboardingDismissedHosts(map);
  await chrome.storage.local.set({ [HOST_ONBOARDING_DISMISSED_KEY]: normalized });
}

async function resolveActiveKintoneHost() {
  const tab = await getActiveTab();
  if (!tab?.url || !isKintoneUrl(tab.url)) return '';
  try {
    return normalizeHostOrigin(new URL(tab.url).origin);
  } catch (_err) {
    return '';
  }
}

function setHostOnboardingVisible(visible) {
  state.hostOnboardingVisible = Boolean(visible);
  if (!els.hostOnboarding) return;
  els.hostOnboarding.classList.toggle('hidden', !state.hostOnboardingVisible);
}

function renderHostOnboarding() {
  if (!els.hostOnboarding) return;
  const hasHost = Boolean(state.hostOnboardingHost);
  if (els.hostOnboardingDesc) {
    els.hostOnboardingDesc.textContent = hasHost
      ? t('panel_host_onboarding_desc')
      : t('panel_host_onboarding_desc_no_host');
  }
  if (els.hostOnboardingHost) {
    els.hostOnboardingHost.classList.toggle('hidden', !hasHost);
  }
  if (els.hostOnboardingHostValue) {
    els.hostOnboardingHostValue.textContent = hasHost ? formatHostForDisplay(state.hostOnboardingHost) : '';
  }
  if (els.hostOnboardingAllow) {
    let label = t('panel_host_onboarding_allow');
    if (state.hostOnboardingBusy) {
      label = t('panel_host_onboarding_allowing');
    } else if (!hasHost) {
      label = t('panel_host_onboarding_detect');
    }
    els.hostOnboardingAllow.textContent = label;
    els.hostOnboardingAllow.disabled = state.hostOnboardingBusy;
  }
}

async function refreshHostOnboarding() {
  if (!els.hostOnboarding || !chrome?.storage?.local) return false;
  try {
    const host = await resolveActiveKintoneHost();
    state.hostOnboardingHost = host;
    if (!host) {
      state.hostOnboardingHost = '';
      state.hostOnboardingBusy = false;
      setHostOnboardingVisible(false);
      return false;
    }
    const dismissedMap = await loadDismissedHostOnboardingMap();
    const dismissed = Boolean(dismissedMap[host]);
    const granted = await hasHostPermission(host);
    if (dismissed || granted) {
      state.hostOnboardingBusy = false;
      setHostOnboardingVisible(false);
      return false;
    }
    renderHostOnboarding();
    setHostOnboardingVisible(true);
    return true;
  } catch (error) {
    console.warn('Failed to refresh host onboarding', error);
    setHostOnboardingVisible(false);
    return false;
  }
}

async function dismissHostOnboarding() {
  const host = normalizeHostOrigin(state.hostOnboardingHost);
  if (!chrome?.storage?.local || !host) {
    setHostOnboardingVisible(false);
    return;
  }
  try {
    const current = await loadDismissedHostOnboardingMap();
    current[host] = true;
    await saveDismissedHostOnboardingMap(current);
  } catch (_err) {
    // ignore
  }
  setHostOnboardingVisible(false);
}

async function clearHostOnboardingDismissedFlag() {
  const host = normalizeHostOrigin(state.hostOnboardingHost);
  if (!chrome?.storage?.local || !host) return;
  try {
    const current = await loadDismissedHostOnboardingMap();
    if (Object.prototype.hasOwnProperty.call(current, host)) {
      delete current[host];
      await saveDismissedHostOnboardingMap(current);
    }
  } catch (_err) {
    // ignore
  }
}

async function handleHostOnboardingAllow() {
  if (state.hostOnboardingBusy) return;
  state.hostOnboardingBusy = true;
  renderHostOnboarding();
  try {
    const host = await resolveActiveKintoneHost();
    state.hostOnboardingHost = host;
    renderHostOnboarding();
    if (!host) {
      setNoticeKey('panel_notice_open_kintone_first');
      return;
    }
    const granted = await ensureHostPermission(host);
    if (!granted) {
      setNoticeKey('panel_notice_permission_cancelled');
      return;
    }
    await clearHostOnboardingDismissedFlag();
    setNoticeKey('panel_notice_permission_granted', { host: formatHostForDisplay(host) });
    await refreshHostOnboarding();
    requestWatchListReconcile('permission_granted', {
      source: 'host_onboarding',
      ignoreCooldown: true
    }).catch(() => {});
    refreshOverlayLaunchState().catch(() => {});
  } finally {
    state.hostOnboardingBusy = false;
    renderHostOnboarding();
  }
}

function setFilterPanelVisible(visible, { focus = false } = {}) {
  state.filterPanelVisible = Boolean(visible);
  if (els.filterPanel) {
    els.filterPanel.classList.toggle('hidden', !state.filterPanelVisible);
  }
  if (els.toggleFilterPanel) {
    els.toggleFilterPanel.setAttribute('aria-pressed', state.filterPanelVisible ? 'true' : 'false');
    const label = state.filterPanelVisible ? t('panel_action_toggle_search_hide') : t('panel_action_toggle_search_show');
    els.toggleFilterPanel.title = label;
    els.toggleFilterPanel.setAttribute('aria-label', label);
  }
  if (focus && state.filterPanelVisible && els.filter) {
    setTimeout(() => {
      try {
        els.filter.focus();
        els.filter.select();
      } catch (_err) {
        // ignore
      }
    }, 0);
  }
}

function ensureRecentCollapseControl() {
  if (!els.recentSection) return;
  const head = els.recentSection.querySelector('.section-head');
  if (!head) return;

  let actions = head.querySelector('.section-actions');
  if (!actions) {
    actions = doc.createElement('div');
    actions.className = 'section-actions section-actions-icons';
    head.appendChild(actions);
  } else {
    actions.classList.add('section-actions-icons');
  }

  if (els.recentClear && !actions.contains(els.recentClear)) {
    actions.appendChild(els.recentClear);
  }

  if (!els.toggleRecentRecords) {
    const toggle = doc.createElement('button');
    toggle.id = 'toggleRecentRecords';
    toggle.type = 'button';
    toggle.className = 'icon-btn small collapse-btn';
    toggle.setAttribute('aria-pressed', 'false');
    actions.appendChild(toggle);
    els.toggleRecentRecords = toggle;
  }
}

function ensureCollapsedSectionsTray() {
  if (els.collapsedTray && els.collapsedTrayRow) return;
  if (!els.shortcutPanel) return;

  const tray = doc.createElement('section');
  tray.id = 'collapsedSectionsTray';
  tray.className = 'collapsed-sections-tray hidden';
  tray.setAttribute('aria-label', t('panel_collapsed_sections_label'));

  const row = doc.createElement('div');
  row.id = 'collapsedSectionsRow';
  row.className = 'collapsed-sections-row';
  tray.appendChild(row);

  if (els.notice?.parentElement) {
    els.notice.parentElement.insertBefore(tray, els.notice);
  } else if (els.shortcutPanel.parentElement) {
    els.shortcutPanel.parentElement.insertBefore(tray, els.shortcutPanel.nextSibling);
  }

  els.collapsedTray = tray;
  els.collapsedTrayRow = row;
}

function openCollapsedTrayTooltip(btn) {
  if (!btn) return;
  const tooltip = btn.querySelector('.collapsed-tray-tooltip');
  if (!tooltip || !tooltip.textContent) return;
  btn.classList.add('tray-tooltip-open');
  btn.classList.remove('tray-tooltip-align-left', 'tray-tooltip-align-right');
  const panelRect = (els.collapsedTray || els.shortcutPanel || doc.body).getBoundingClientRect();
  const tooltipRect = tooltip.getBoundingClientRect();
  if (tooltipRect.left < panelRect.left + 4) {
    btn.classList.add('tray-tooltip-align-left');
    return;
  }
  if (tooltipRect.right > panelRect.right - 4) {
    btn.classList.add('tray-tooltip-align-right');
  }
}

function closeCollapsedTrayTooltip(btn) {
  if (!btn) return;
  btn.classList.remove('tray-tooltip-open', 'tray-tooltip-align-left', 'tray-tooltip-align-right');
}

function createCollapsedTrayItem({ id, icon, label, count, onClick }) {
  const btn = doc.createElement('button');
  btn.type = 'button';
  btn.className = 'collapsed-tray-item';
  btn.dataset.section = id;
  btn.setAttribute('aria-label', label);
  btn.title = label;
  btn.addEventListener('click', onClick);
  btn.addEventListener('mouseenter', () => openCollapsedTrayTooltip(btn));
  btn.addEventListener('focus', () => openCollapsedTrayTooltip(btn));
  btn.addEventListener('mouseleave', () => closeCollapsedTrayTooltip(btn));
  btn.addEventListener('blur', () => closeCollapsedTrayTooltip(btn));

  const iconEl = doc.createElement('span');
  iconEl.className = 'collapsed-tray-icon lc';
  iconEl.dataset.icon = icon;
  iconEl.setAttribute('aria-hidden', 'true');

  const tooltip = doc.createElement('span');
  tooltip.className = 'collapsed-tray-tooltip';
  tooltip.textContent = label;
  tooltip.setAttribute('aria-hidden', 'true');

  btn.appendChild(iconEl);
  if (Number(count) > 0) {
    const badge = doc.createElement('span');
    badge.className = 'collapsed-tray-badge';
    badge.textContent = String(count);
    badge.setAttribute('aria-hidden', 'true');
    btn.appendChild(badge);
  }
  btn.appendChild(tooltip);
  return btn;
}

function renderCollapsedSectionsTray() {
  ensureCollapsedSectionsTray();
  if (!els.collapsedTray || !els.collapsedTrayRow) return;

  const items = [];
  if (state.pinsOnly) {
    items.push({
      id: 'watchlist',
      icon: 'bookmark',
      label: t('panel_collapsed_watchlist'),
      count: state.favorites.length,
      onClick: () => setWatchlistCollapsed(false, { source: 'collapsed_tray' })
    });
  }
  if (state.recordPinsCollapsed && recordPinState.visible) {
    const count = els.pinList ? els.pinList.querySelectorAll('li').length : 0;
    items.push({
      id: 'record-pins',
      icon: 'pin',
      label: t('panel_collapsed_record_pins'),
      count,
      onClick: () => setRecordPinsCollapsed(false)
    });
  }
  if (state.recentRecordsCollapsed && state.recentRecords.length > 0) {
    items.push({
      id: 'recent-records',
      icon: 'history',
      label: t('panel_collapsed_recent_records'),
      count: state.recentRecords.length,
      onClick: () => setRecentRecordsCollapsed(false)
    });
  }

  els.collapsedTrayRow.textContent = '';
  if (!items.length) {
    els.collapsedTray.classList.add('hidden');
    return;
  }
  items.forEach((item) => {
    els.collapsedTrayRow.appendChild(createCollapsedTrayItem(item));
  });
  els.collapsedTray.classList.remove('hidden');
  renderLucideIcons(els.collapsedTray);
}

function setRecordPinsCollapsed(collapsed, { persist = true } = {}) {
  state.recordPinsCollapsed = Boolean(collapsed);
  if (els.pinList) {
    els.pinList.classList.toggle('hidden', state.recordPinsCollapsed);
  }
  if (els.recordPinSection) {
    els.recordPinSection.classList.toggle('tray-collapsed', state.recordPinsCollapsed);
  }
  if (els.toggleRecordPins) {
    const isCollapsed = state.recordPinsCollapsed;
    setCollapseIcon(els.toggleRecordPins, isCollapsed);
    els.toggleRecordPins.setAttribute('aria-pressed', isCollapsed ? 'true' : 'false');
    const label = isCollapsed ? t('panel_action_toggle_record_pins_expand') : t('panel_action_toggle_record_pins_collapse');
    els.toggleRecordPins.title = label;
    els.toggleRecordPins.setAttribute('aria-label', label);
  }
  if (persist) {
    persistCollapsedSectionsState().catch(() => {});
  }
  renderCollapsedSectionsTray();
}

function setWatchlistCollapsed(collapsed, { persist = true, source = 'unknown' } = {}) {
  const wasCollapsed = state.pinsOnly;
  state.pinsOnly = Boolean(collapsed);
  if (els.togglePinsOnly) {
    els.togglePinsOnly.checked = state.pinsOnly;
    els.togglePinsOnly.setAttribute('aria-pressed', state.pinsOnly ? 'true' : 'false');
  }
  if (els.favCategories) {
    els.favCategories.classList.toggle('is-collapsed', state.pinsOnly);
  }
  if (els.favSection) {
    els.favSection.classList.toggle('tray-collapsed', state.pinsOnly);
  }
  if (els.togglePinsOnlyIcon) {
    const isCollapsed = state.pinsOnly;
    setCollapseIcon(els.togglePinsOnlyIcon, isCollapsed);
    const label = isCollapsed ? t('panel_action_toggle_watchlist_expand') : t('panel_action_toggle_watchlist_collapse');
    els.togglePinsOnlyIcon.title = label;
    els.togglePinsOnlyIcon.setAttribute('aria-label', label);
  }
  if (persist) {
    persistCollapsedSectionsState().catch(() => {});
  }
  renderCollapsedSectionsTray();
  syncWatchlistAutoRefreshTimer(`set_watchlist_collapsed:${source}`).catch(() => {});
  const expandedByAction = wasCollapsed && !state.pinsOnly;
  if (expandedByAction) {
    requestWatchListReconcile('expand', { source }).catch(() => {});
  }
}

function setRecentRecordsCollapsed(collapsed, { persist = true } = {}) {
  state.recentRecordsCollapsed = Boolean(collapsed);
  if (els.recentSection) {
    els.recentSection.classList.toggle('tray-collapsed', state.recentRecordsCollapsed);
  }
  if (els.toggleRecentRecords) {
    const isCollapsed = state.recentRecordsCollapsed;
    setCollapseIcon(els.toggleRecentRecords, isCollapsed);
    els.toggleRecentRecords.setAttribute('aria-pressed', isCollapsed ? 'true' : 'false');
    const label = isCollapsed ? t('panel_action_toggle_recent_records_expand') : t('panel_action_toggle_recent_records_collapse');
    els.toggleRecentRecords.title = label;
    els.toggleRecentRecords.setAttribute('aria-label', label);
  }
  if (persist) {
    persistCollapsedSectionsState().catch(() => {});
  }
  renderCollapsedSectionsTray();
}

function normalizeShortcutSearchOpenMode(value) {
  if (value === SHORTCUT_SEARCH_OPEN_MODE_NEW_TAB) return SHORTCUT_SEARCH_OPEN_MODE_NEW_TAB;
  return SHORTCUT_SEARCH_OPEN_MODE_CURRENT_TAB;
}

function normalizeCollapsedSections(value) {
  const source = value && typeof value === 'object' ? value : {};
  return {
    watchlist: Boolean(source.watchlist),
    recordPins: Boolean(source.recordPins),
    recentRecords: Boolean(source.recentRecords)
  };
}

async function loadCollapsedSectionsState() {
  try {
    const stored = await chrome.storage.local.get(COLLAPSED_SECTIONS_KEY);
    const normalized = normalizeCollapsedSections(stored?.[COLLAPSED_SECTIONS_KEY]);
    state.pinsOnly = normalized.watchlist;
    state.recordPinsCollapsed = normalized.recordPins;
    state.recentRecordsCollapsed = normalized.recentRecords;
  } catch (_err) {
    state.pinsOnly = false;
    state.recordPinsCollapsed = false;
    state.recentRecordsCollapsed = false;
  }
}

async function persistCollapsedSectionsState() {
  const payload = {
    watchlist: Boolean(state.pinsOnly),
    recordPins: Boolean(state.recordPinsCollapsed),
    recentRecords: Boolean(state.recentRecordsCollapsed)
  };
  try {
    await chrome.storage.local.set({ [COLLAPSED_SECTIONS_KEY]: payload });
  } catch (_err) {
    // ignore persistence errors
  }
}

function isSoftFresh(updatedAt, now = Date.now()) {
  const ts = Number(updatedAt);
  if (!Number.isFinite(ts) || ts <= 0) return false;
  return (now - ts) < WATCHLIST_SOFT_TTL_MS;
}

function isHardFresh(updatedAt, now = Date.now()) {
  const ts = Number(updatedAt);
  if (!Number.isFinite(ts) || ts <= 0) return false;
  return (now - ts) < WATCHLIST_HARD_TTL_MS;
}

function shouldRefreshOnExpand(entry, now = Date.now()) {
  if (!entry?.hasAnyCache) return true;
  return !isSoftFresh(entry.updatedAt, now);
}

function shouldRefreshOnFocus(entry, now = Date.now()) {
  if (!entry?.hasAnyCache) return true;
  return !isSoftFresh(entry.updatedAt, now);
}

function shouldPollVisible(entry, context, now = Date.now()) {
  if (!context?.isPanelVisible) return false;
  if (!context?.isWatchListExpanded) return false;
  if (!entry?.hasAnyCache) return true;
  return !isSoftFresh(entry.updatedAt, now);
}

function shouldRunResumeCatchup(entry, now = Date.now()) {
  if (!entry?.hasAnyCache) return true;
  const completedAt = Number(state.watchlistSectionSync?.lastCompletedAt || 0);
  const baseline = completedAt > 0 ? completedAt : Number(entry.updatedAt || 0);
  if (!Number.isFinite(baseline) || baseline <= 0) return true;
  const refresh = getWatchlistRefreshConfig();
  return (now - baseline) >= Number(refresh.visibleTickMs || 0);
}

function isWatchlistPanelVisible() {
  if (!state.watchlistPanelMounted) return false;
  if (document?.visibilityState === 'hidden') return false;
  return true;
}

async function getWatchlistRefreshContext() {
  let isKintoneTabActive = false;
  try {
    const tab = await getActiveTab();
    isKintoneTabActive = Boolean(tab?.id && isKintoneUrl(tab.url || ''));
  } catch (_err) {
    isKintoneTabActive = false;
  }
  return {
    isPanelVisible: isWatchlistPanelVisible(),
    isWatchListExpanded: !state.pinsOnly,
    isKintoneTabActive
  };
}

function getWatchlistRefreshingText() {
  return t('panel_watchlist_status_refreshing');
}

function getWatchlistStaleText() {
  return t('panel_watchlist_status_stale');
}

function getWatchlistQueuedText() {
  return t('panel_watchlist_status_queued');
}

function formatWatchlistRelativeAge(timestamp) {
  const value = Number(timestamp);
  if (!Number.isFinite(value) || value <= 0) return '';
  const deltaSeconds = Math.max(0, Math.floor((Date.now() - value) / 1000));
  const locale = state.currentLang === 'en' ? 'en' : 'ja';
  try {
    const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'always' });
    if (deltaSeconds < 60) return rtf.format(-deltaSeconds, 'second');
    const deltaMinutes = Math.floor(deltaSeconds / 60);
    if (deltaMinutes < 60) return rtf.format(-deltaMinutes, 'minute');
    const deltaHours = Math.floor(deltaMinutes / 60);
    if (deltaHours < 24) return rtf.format(-deltaHours, 'hour');
    const deltaDays = Math.floor(deltaHours / 24);
    return rtf.format(-deltaDays, 'day');
  } catch (_err) {
    return formatWatchlistTime(value);
  }
}

function normalizeWatchListReconcileReason(value) {
  const reason = String(value || '').trim().toLowerCase();
  if (reason === 'panel_open') return 'panel_open';
  if (reason === 'visible_tick') return 'visible_tick';
  if (reason === 'resume_catchup') return 'resume_catchup';
  if (reason === 'manual') return 'manual';
  if (reason === 'expand') return 'expand';
  if (reason === 'focus_resume') return 'focus_resume';
  if (reason === 'tab_resume') return 'tab_resume';
  return 'panel_open';
}

function mapWatchListReasonToTrigger(reason) {
  const normalized = normalizeWatchListReconcileReason(reason);
  if (normalized === 'panel_open') return 'watchlist_panel_open';
  if (normalized === 'visible_tick') return 'watchlist_visible_tick';
  if (normalized === 'resume_catchup') return 'watchlist_resume_catchup';
  if (normalized === 'manual') return 'watchlist_manual';
  if (normalized === 'expand') return 'watchlist_expand';
  if (normalized === 'focus_resume') return 'watchlist_focus_resume';
  if (normalized === 'tab_resume') return 'watchlist_tab_resume';
  return 'watchlist_bulk';
}

function pickWatchListReconcileReason(reasons) {
  const list = Array.isArray(reasons) ? reasons : [];
  const priority = ['manual', 'panel_open', 'resume_catchup', 'expand', 'focus_resume', 'tab_resume', 'visible_tick'];
  for (const name of priority) {
    if (list.includes(name)) return name;
  }
  return list[0] || 'panel_open';
}

function queueWatchListPendingReason(reason, source) {
  const syncState = state.watchlistSectionSync;
  const normalizedReason = normalizeWatchListReconcileReason(reason);
  if (!syncState.pendingReasons.includes(normalizedReason)) {
    syncState.pendingReasons.push(normalizedReason);
  }
  syncState.pendingSources[normalizedReason] = String(source || 'unknown');
  return normalizedReason;
}

function consumeWatchListPendingReasons() {
  const syncState = state.watchlistSectionSync;
  const reasons = syncState.pendingReasons.slice();
  const sources = { ...(syncState.pendingSources || {}) };
  syncState.pendingReasons = [];
  syncState.pendingSources = {};
  return { reasons, sources };
}

function getVisibleWatchListEntryIds() {
  const ids = new Set();
  const allEntries = Array.from(doc.querySelectorAll('.entry[data-id]'));
  allEntries.forEach((entryEl) => {
    if (!isSelectableEntry(entryEl)) return;
    const id = String(entryEl.dataset.id || '').trim();
    if (!id) return;
    ids.add(id);
  });
  return ids;
}

function buildWatchListReconcileTargets() {
  const now = Date.now();
  const visibleIds = getVisibleWatchListEntryIds();
  return state.favorites
    .map((item, index) => {
      const cached = state.watchlistCountCache.get(item.id);
      const updatedAt = Number(cached?.updatedAt || 0);
      const text = String(cached?.text || '').trim();
      const parsedCount = Number.parseInt(text, 10);
      const countValue = Number.isFinite(parsedCount) ? parsedCount : null;
      const stale = !isSoftFresh(updatedAt, now);
      const staleZero = stale && countValue === 0;
      const visible = visibleIds.has(item.id);
      let priority = 3;
      if (staleZero) priority = 0;
      else if (stale) priority = 1;
      else if (visible) priority = 2;
      return { item, index, priority };
    })
    .sort((a, b) => {
      if (a.priority !== b.priority) return a.priority - b.priority;
      return a.index - b.index;
    })
    .map((entry) => entry.item);
}

function shouldSkipReconcile(now, stateInput) {
  const reason = normalizeWatchListReconcileReason(stateInput?.reason);
  const context = stateInput?.context || {};
  const snapshot = stateInput?.snapshot || {};
  const ignoreCooldown = Boolean(stateInput?.ignoreCooldown);
  const syncState = state.watchlistSectionSync;

  if (!state.favorites.length) return { skip: true, reason: 'no_entries' };
  if (reason !== 'manual' && !context.isPanelVisible) return { skip: true, reason: 'panel_hidden' };
  if (reason !== 'manual' && !context.isWatchListExpanded) return { skip: true, reason: 'collapsed' };
  if (reason === 'panel_open') return { skip: true, reason: 'panel_open_disabled' };
  if ((reason === 'focus_resume' || reason === 'tab_resume') && !context.isKintoneTabActive) {
    return { skip: true, reason: 'inactive_tab' };
  }

  const completedAt = Number(syncState.lastCompletedAt || 0);
  const refresh = getWatchlistRefreshConfig();
  const cooldownMs = Number(refresh.cooldownMs || 0);
  if (!ignoreCooldown && completedAt > 0) {
    const elapsed = now - completedAt;
    if (elapsed >= 0 && elapsed < cooldownMs) {
      return { skip: true, reason: 'cooldown' };
    }
  }

  if (reason === 'visible_tick') {
    if (!shouldPollVisible(snapshot, context, now)) {
      return { skip: true, reason: 'ttl_fresh' };
    }
    const lastVisibleTickAt = Number(syncState.lastVisibleTickAt || 0);
    const visibleTickMs = Number(refresh.visibleTickMs || 0);
    if (lastVisibleTickAt > 0 && now - lastVisibleTickAt < visibleTickMs) {
      return { skip: true, reason: 'visible_interval' };
    }
  } else if (reason === 'resume_catchup') {
    if (!shouldRunResumeCatchup(snapshot, now)) {
      return { skip: true, reason: 'resume_not_due' };
    }
  } else if (reason === 'expand' && !shouldRefreshOnExpand(snapshot, now)) {
    return { skip: true, reason: 'ttl_fresh' };
  } else if ((reason === 'focus_resume' || reason === 'tab_resume') && !shouldRefreshOnFocus(snapshot, now)) {
    return { skip: true, reason: 'ttl_fresh' };
  }

  return { skip: false, reason: 'run' };
}

function stopWatchlistAutoRefreshTimer() {
  if (state.watchlistAutoRefreshTimerId == null) return;
  window.clearInterval(state.watchlistAutoRefreshTimerId);
  state.watchlistAutoRefreshTimerId = null;
}

async function syncWatchlistAutoRefreshTimer(source = 'unknown') {
  const context = await getWatchlistRefreshContext();
  const shouldRun = state.favorites.length > 0
    && context.isPanelVisible
    && context.isWatchListExpanded;
  if (!shouldRun) {
    stopWatchlistAutoRefreshTimer();
    return context;
  }
  if (state.watchlistAutoRefreshTimerId != null) return context;
  const refresh = getWatchlistRefreshConfig();
  const visibleTickMs = Number(refresh.visibleTickMs || 0);
  state.watchlistAutoRefreshTimerId = window.setInterval(() => {
    requestWatchListReconcile('visible_tick', {
      source: `visible_tick:${source}`
    }).catch(() => {});
  }, visibleTickMs);
  return context;
}

async function requestWatchListResumeCatchup(source = 'resume_event') {
  const now = Date.now();
  if (shouldThrottleResumeBySource(source, now)) {
    
    logWatchlistApiDebug('skip resume source throttle', `source=${source}`);
    return { queued: false, reason: 'resume_source_throttled' };
  }
  const refresh = getWatchlistRefreshConfig();
  const resumeThrottleMs = Number(refresh.resumeThrottleMs || 0);
  const lastResumeEventAt = Number(state.watchlistLastResumeEventAt || 0);
  if (lastResumeEventAt > 0 && (now - lastResumeEventAt) < resumeThrottleMs) {
    
    return { queued: false, reason: 'resume_event_throttled' };
  }
  const context = await getWatchlistRefreshContext();
  const snapshot = getWatchlistCacheSnapshot(now);
  if (!context.isPanelVisible) {
    
    return { queued: false, reason: 'panel_hidden' };
  }
  if (!context.isWatchListExpanded) {

    return { queued: false, reason: 'collapsed' };
  }
  state.watchlistLastResumeEventAt = now;
  return requestWatchListReconcile('resume_catchup', { source });
}

async function requestWatchListReconcile(reason, options = {}) {
  const normalizedReason = normalizeWatchListReconcileReason(reason);
  const source = String(options?.source || 'unknown');
  const ignoreCooldown = Boolean(options?.ignoreCooldown);
  const delayMsRaw = Number(options?.delayMs);
  const delayMs = Number.isFinite(delayMsRaw) && delayMsRaw > 0 ? Math.floor(delayMsRaw) : 0;
  const syncState = state.watchlistSectionSync;

  if (!state.favorites.length) {
    
    return { queued: false, reason: 'no_entries' };
  }

  queueWatchListPendingReason(normalizedReason, source);
  if (ignoreCooldown) {
    syncState.pendingIgnoreCooldown = true;
  }
  

  if (syncState.inFlight) {
    logWatchlistApiDebug('join in-flight', `feature=watchlist trigger=${normalizedReason}`);
    
    return { queued: true, reason: 'join_inflight' };
  }
  if (syncState.queued) {
    logWatchlistApiDebug('join queued', `feature=watchlist trigger=${normalizedReason}`);
    return { queued: true, reason: 'queued' };
  }

  syncState.queued = true;
  window.setTimeout(() => {
    syncState.queued = false;
    runWatchListReconcileJob().catch(() => {});
  }, delayMs);
  return { queued: true, reason: 'queued' };
}

async function runWatchListReconcileJob() {
  const syncState = state.watchlistSectionSync;
  if (syncState.inFlight) return { ok: false, reason: 'join_inflight' };

  while (syncState.pendingReasons.length) {
    const { reasons, sources } = consumeWatchListPendingReasons();
    const primaryReason = pickWatchListReconcileReason(reasons);
    const source = String(sources?.[primaryReason] || sources?.manual || 'watchlist_reconcile');
    const now = Date.now();
    const context = await syncWatchlistAutoRefreshTimer(`job:${primaryReason}`);
    const snapshot = getWatchlistCacheSnapshot(now);
    const ignoreCooldown = Boolean(syncState.pendingIgnoreCooldown || reasons.includes('manual'));
    syncState.pendingIgnoreCooldown = false;
    const skip = shouldSkipReconcile(now, {
      reason: primaryReason,
      context,
      snapshot,
      ignoreCooldown
    });
    if (skip.skip) {
      logWatchlistApiDebug('skip reconcile', `feature=watchlist trigger=${primaryReason} reason=${skip.reason}`);
      
      continue;
    }

    const trigger = mapWatchListReasonToTrigger(primaryReason);
    const targets = buildWatchListReconcileTargets();
    const requestId = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    const lifecycleToken = state.watchlistLifecycleToken;
    

    syncState.inFlight = true;
    syncState.activeRequestId = requestId;
    syncState.lastStartedAt = Date.now();
    state.watchlistRefreshInFlight = true;
    logWatchlistApiDebug('start', `feature=watchlist trigger=${primaryReason} requestId=${requestId}`);
    renderWatchlistUpdatedLabel();
    try {
      const results = await performWatchListBulkRefresh(targets, {
        reason: primaryReason,
        trigger,
        source: `watchlist_reconcile:${source}`,
        requestId,
        lifecycleToken
      });
      if (!isActiveWatchlistRequest(requestId, lifecycleToken)) {
        logWatchlistApiDebug('drop stale response', `feature=watchlist trigger=${primaryReason} requestId=${requestId}`);
        continue;
      }
      await applyWatchListResults(results, {
        reason: primaryReason,
        trigger,
        source
      });
      const completedAt = Date.now();
      syncState.lastCompletedAt = completedAt;
      if (primaryReason === 'visible_tick') {
        syncState.lastVisibleTickAt = completedAt;
      }
      const updatedCount = Number(results?.updatedCount || 0);
      const unchangedCount = Number(results?.unchangedCount || 0);
      
    } catch (_err) {
      syncState.lastCompletedAt = Date.now();
      
    } finally {
      syncState.inFlight = false;
      if (normalizeRequestId(syncState.activeRequestId) === requestId) {
        syncState.activeRequestId = '';
      }
      state.watchlistRefreshInFlight = false;
      renderWatchlistUpdatedLabel();
    }
  }
  return { ok: true };
}

async function performWatchListBulkRefresh(targets, context = {}) {
  return refreshCounts({
    trigger: String(context?.trigger || 'watchlist_bulk'),
    source: String(context?.source || 'watchlist_reconcile'),
    targets: Array.isArray(targets) ? targets : [],
    requestId: String(context?.requestId || ''),
    lifecycleToken: Number(context?.lifecycleToken || 0)
  });
}

async function applyWatchListResults(_results, _context = {}) {
  renderWatchlistUpdatedLabel();
}

function normalizeWatchlistCountCacheEntry(raw) {
  if (raw == null) return null;
  if (typeof raw === 'number' || typeof raw === 'string') {
    return {
      text: String(raw),
      updatedAt: 0
    };
  }
  if (typeof raw !== 'object') return null;
  const textSource = Object.prototype.hasOwnProperty.call(raw, 'text')
    ? raw.text
    : raw.count;
  if (textSource == null) return null;
  const text = String(textSource);
  if (!text) return null;
  const updatedAtRaw = Number(raw.updatedAt);
  return {
    text,
    updatedAt: Number.isFinite(updatedAtRaw) && updatedAtRaw > 0 ? Math.floor(updatedAtRaw) : 0
  };
}

function normalizeWatchlistCountCache(raw) {
  const map = new Map();
  const source = raw && typeof raw === 'object' ? raw : {};
  const entries = source && typeof source.entries === 'object' && source.entries
    ? source.entries
    : source;
  if (!entries || typeof entries !== 'object') return map;
  Object.entries(entries).forEach(([id, value]) => {
    const key = String(id || '');
    if (!key) return;
    const normalized = normalizeWatchlistCountCacheEntry(value);
    if (!normalized) return;
    map.set(key, normalized);
  });
  return map;
}

async function loadWatchlistCountCache() {
  if (!chrome?.storage?.local) {
    state.watchlistCountCache = new Map();
    return;
  }
  try {
    const stored = await chrome.storage.local.get(WATCHLIST_COUNT_CACHE_KEY);
    state.watchlistCountCache = normalizeWatchlistCountCache(stored?.[WATCHLIST_COUNT_CACHE_KEY]);
  } catch (_err) {
    state.watchlistCountCache = new Map();
  }
}

async function saveWatchlistCountCache() {
  if (!chrome?.storage?.local) return;
  const payload = {};
  const validIds = new Set(state.favorites.map((item) => String(item.id || '').trim()).filter(Boolean));
  const localMap = new Map();
  state.watchlistCountCache.forEach((entry, id) => {
    if (!entry || typeof entry !== 'object') return;
    const key = String(id || '').trim();
    if (!key || (validIds.size && !validIds.has(key))) return;
    localMap.set(key, {
      text: String(entry.text || ''),
      updatedAt: Number.isFinite(entry.updatedAt) && entry.updatedAt > 0
        ? Math.floor(entry.updatedAt)
        : 0
    });
  });
  try {
    const stored = await chrome.storage.local.get(WATCHLIST_COUNT_CACHE_KEY);
    const storedMap = normalizeWatchlistCountCache(stored?.[WATCHLIST_COUNT_CACHE_KEY]);
    const mergedMap = new Map();
    storedMap.forEach((entry, id) => {
      const key = String(id || '').trim();
      if (!key || (validIds.size && !validIds.has(key))) return;
      mergedMap.set(key, { text: String(entry.text || ''), updatedAt: Number(entry.updatedAt || 0) });
    });
    localMap.forEach((entry, id) => {
      const merged = mergeWatchlistCacheEntry(mergedMap.get(id), entry, true);
      if (merged) mergedMap.set(id, { text: String(merged.text || ''), updatedAt: Number(merged.updatedAt || 0) });
    });
    state.watchlistCountCache = mergedMap;
    mergedMap.forEach((entry, id) => {
      payload[id] = {
        text: String(entry.text || ''),
        updatedAt: Number.isFinite(entry.updatedAt) && entry.updatedAt > 0 ? Math.floor(entry.updatedAt) : 0
      };
    });
    logWatchlistApiDebug('storage save', `key=${WATCHLIST_COUNT_CACHE_KEY} entries=${Object.keys(payload).length}`);
    await chrome.storage.local.set({ [WATCHLIST_COUNT_CACHE_KEY]: { entries: payload } });
  } catch (_err) {
    // ignore persistence errors
  }
}

async function pruneWatchlistCountCache(validIds) {
  if (!(validIds instanceof Set)) return;
  let changed = false;
  Array.from(state.watchlistCountCache.keys()).forEach((id) => {
    if (validIds.has(id)) return;
    state.watchlistCountCache.delete(id);
    changed = true;
  });
  if (changed) {
    await saveWatchlistCountCache();
  }
}

function formatWatchlistTime(timestamp) {
  const value = Number(timestamp);
  if (!Number.isFinite(value) || value <= 0) return '--:--';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '--:--';
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

function getLatestWatchlistCacheTimestamp() {
  let latest = 0;
  state.favorites.forEach((item) => {
    const cached = state.watchlistCountCache.get(item.id);
    const ts = Number(cached?.updatedAt || 0);
    if (ts > latest) latest = ts;
  });
  return latest;
}
function getWatchlistCacheSnapshot(now = Date.now()) {
  const latest = getLatestWatchlistCacheTimestamp();
  return {
    updatedAt: latest,
    hasAnyCache: latest > 0,
    cacheAgeMs: latest > 0 ? Math.max(0, now - latest) : null
  };
}

function renderWatchlistUpdatedLabel() {
  if (!els.watchlistUpdatedAt) return;
  const lastSyncedAt = Number(state.watchlistSectionSync.lastCompletedAt || 0);
  const latestCache = getLatestWatchlistCacheTimestamp();
  const displayTs = lastSyncedAt > 0 ? lastSyncedAt : latestCache;
  const baseText = displayTs > 0
    ? t('panel_watchlist_last_updated', { time: formatWatchlistRelativeAge(displayTs) || formatWatchlistTime(displayTs) })
    : t('panel_watchlist_last_updated_none');
  let status = '';
  if (state.watchlistRefreshInFlight) {
    status = getWatchlistRefreshingText();
  } else if (state.watchlistSectionSync.pendingReasons.length > 0) {
    status = getWatchlistQueuedText();
  } else if (displayTs > 0 && !isHardFresh(displayTs, Date.now())) {
    status = getWatchlistStaleText();
  }
  els.watchlistUpdatedAt.textContent = status ? `${baseText} \u00b7 ${status}` : baseText;
}

function buildWatchlistBadgeTitle(updatedAt) {
  const ts = Number(updatedAt);
  if (!Number.isFinite(ts) || ts <= 0) return '';
  return t('panel_watchlist_last_updated', { time: formatWatchlistTime(ts) });
}

function applyWatchlistCountCacheToBadges() {
  state.favorites.forEach((item) => {
    const cached = state.watchlistCountCache.get(item.id);
    if (!cached) return;
    const text = String(cached.text);
    state.badgeStatus.set(item.id, {
      text,
      title: buildWatchlistBadgeTitle(cached.updatedAt),
      loading: false,
      status: text === '0' ? 'zero' : 'count'
    });
  });
  renderWatchlistUpdatedLabel();
}

function setWatchlistCountCacheValue(id, value, updatedAt) {
  const key = String(id || '');
  if (!key) return false;
  if (value == null) return false;
  const text = String(value);
  if (!text) return false;
  const ts = Number(updatedAt);
  const normalizedTs = Number.isFinite(ts) && ts > 0 ? Math.floor(ts) : 0;
  const prev = state.watchlistCountCache.get(key);
  if (prev && prev.text === text && Number(prev.updatedAt || 0) === normalizedTs) {
    return false;
  }
  state.watchlistCountCache.set(key, { text, updatedAt: normalizedTs });
  return true;
}

function removeWatchlistCountCacheValue(id) {
  const key = String(id || '');
  if (!key) return false;
  return state.watchlistCountCache.delete(key);
}

async function loadShortcutSearchOpenMode() {
  try {
    const stored = await chrome.storage.sync.get(SHORTCUT_SEARCH_OPEN_MODE_KEY);
    state.shortcutSearchOpenMode = normalizeShortcutSearchOpenMode(stored?.[SHORTCUT_SEARCH_OPEN_MODE_KEY]);
  } catch (_err) {
    state.shortcutSearchOpenMode = SHORTCUT_SEARCH_OPEN_MODE_CURRENT_TAB;
  }
}

async function openUrlByMode(url, mode) {
  if (!url) return;
  const normalizedMode = normalizeShortcutSearchOpenMode(mode);
  if (normalizedMode === SHORTCUT_SEARCH_OPEN_MODE_NEW_TAB) {
    await chrome.tabs.create({ url, active: true });
    return;
  }
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const activeTab = tabs && tabs[0] ? tabs[0] : null;
  if (activeTab?.id) {
    await chrome.tabs.update(activeTab.id, { url });
    return;
  }
  await chrome.tabs.create({ url, active: true });
}

function normalizeOverlayPageType(value) {
  const type = String(value || '').trim().toLowerCase();
  if (type === 'list' || type === 'detail') return type;
  return 'unsupported';
}

function getOverlayButtonLabel() {
  const pageType = normalizeOverlayPageType(state.overlayLaunchState?.pageType);
  if (pageType === 'unsupported') {
    return t('panel_action_open_overlay_unsupported');
  }
  if (state.overlayLaunchState?.canEditOverlay) {
    return t('panel_action_open_overlay');
  }
  return t('panel_action_open_overlay_view_only');
}

function syncOverlayButtonLabel() {
  const btn = els.openExcelOverlay;
  if (!btn) return;
  const label = getOverlayButtonLabel();
  btn.title = label;
  btn.setAttribute('aria-label', label);
}

async function sendMessageToActiveKintoneTab(message) {
  const tab = await getActiveTab();
  if (!tab?.id || !isKintoneUrl(tab.url || '')) {
    return { ok: false, reason: 'active_tab_not_kintone' };
  }
  try {
    const response = await chrome.tabs.sendMessage(tab.id, message);
    return response && typeof response === 'object'
      ? response
      : { ok: false, reason: 'empty_response' };
  } catch (error) {
    return { ok: false, reason: String(error?.message || error || 'send_message_failed') };
  }
}

async function refreshOverlayLaunchState() {
  const response = await sendMessageToActiveKintoneTab({ type: MESSAGE_GET_OVERLAY_STATE });
  if (response?.ok) {
    state.overlayLaunchState = {
      pageType: normalizeOverlayPageType(response.pageType),
      canEditOverlay: Boolean(response.canEditOverlay)
    };
  } else {
    state.overlayLaunchState = {
      pageType: 'unsupported',
      canEditOverlay: false
    };
  }
  syncOverlayButtonLabel();
  return response;
}

async function openOverlayFromSidePanel() {
  const response = await sendMessageToActiveKintoneTab({ type: MESSAGE_OPEN_OVERLAY });
  if (response?.ok) {
    state.overlayLaunchState = {
      pageType: normalizeOverlayPageType(response.pageType),
      canEditOverlay: Boolean(response.canEditOverlay)
    };
    syncOverlayButtonLabel();
    setNotice('');
    return;
  }
  if (response?.reason === 'unsupported_page') {
    state.overlayLaunchState = { pageType: 'unsupported', canEditOverlay: false };
    syncOverlayButtonLabel();
    setNoticeKey('panel_notice_overlay_unsupported');
  } else if (response?.reason === 'disabled_by_setting') {
    setNoticeKey('panel_notice_overlay_disabled');
  } else if (response?.reason === 'active_tab_not_kintone') {
    setNoticeKey('panel_notice_open_kintone_first');
  } else {
    setNoticeKey('panel_notice_overlay_open_failed');
  }
}

function formatRecentTime(value) {
  const ts = Number(value);
  if (!Number.isFinite(ts)) return '';
  try {
    const date = new Date(ts);
    return date.toLocaleString([], {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
  } catch (_err) {
    return '';
  }
}

function getRecentAppLabel(entry) {
  const appName = String(entry?.appName || '').trim();
  if (appName) return appName;
  const appId = String(resolveRecentRecordIdentity(entry).appId || '').trim();
  return appId ? `${t('panel_recent_app_prefix')} ${appId}` : t('panel_recent_app_fallback');
}

function normalizeRecentHost(host) {
  return normalizeHostOrigin(host);
}

function normalizeHostOrigin(host) {
  const raw = String(host || '').trim();
  if (!raw) return '';
  try {
    return new URL(raw).origin.replace(/\/$/, '').toLowerCase();
  } catch (_err) {
    return raw.replace(/\/$/, '').toLowerCase();
  }
}

function normalizeHostList(hosts) {
  return Array.from(new Set(
    (Array.isArray(hosts) ? hosts : [hosts])
      .map((host) => normalizeHostOrigin(host))
      .filter(Boolean)
  ));
}

function resolveRecentRecordIdentity(entry) {
  const parsed = parseKintoneUrl(String(entry?.url || ''));
  const host = normalizeRecentHost(parsed?.host || entry?.host || '');
  const appId = String(parsed?.appId || entry?.appId || '').trim();
  const recordId = String(parsed?.recordId || entry?.recordId || '').trim();
  return {
    host,
    appId,
    recordId
  };
}

function buildFavoriteAppKey(host, appId) {
  const safeHost = normalizeHostOrigin(host);
  const safeAppId = String(appId || '').trim();
  if (!safeHost || !safeAppId) return '';
  return `${safeHost}|${safeAppId}`;
}

function appSearchText(value) {
  return String(value || '').trim().toLowerCase();
}

function collectFavoriteHostAppIds(host) {
  const safeHost = normalizeHostOrigin(host);
  return state.favorites
    .filter((item) => normalizeHostOrigin(item.host) === safeHost)
    .map((item) => String(item.appId || '').trim())
    .filter((appId) => /^\d+$/.test(appId));
}

function buildFavoriteAppSet() {
  const set = new Set();
  state.favorites.forEach((item) => {
    const key = buildFavoriteAppKey(item.host, item.appId);
    if (key) set.add(key);
  });
  return set;
}

async function loadHostAppNameMap(host) {
  const safeHost = normalizeHostOrigin(host);
  if (!safeHost) return { map: {}, ok: false };
  let cached = { map: {}, fresh: false };
  try {
    cached = await loadAppNameMap(safeHost);
  } catch (_err) {
    cached = { map: {}, fresh: false };
  }
  const cachedMap = cached?.map && typeof cached.map === 'object' ? cached.map : {};
  if (cached.fresh && Object.keys(cachedMap).length) {
    return { map: cachedMap, ok: true };
  }
  const favoriteAppIds = collectFavoriteHostAppIds(safeHost);
  let metadataMap = {};
  if (favoriteAppIds.length) {
    metadataMap = await fetchAppNamesFromMetadataBundles(safeHost, favoriteAppIds, 'panel_open');
  }
  const mergedCached = { ...cachedMap, ...metadataMap };
  if (favoriteAppIds.length && favoriteAppIds.every((appId) => String(mergedCached[appId] || '').trim())) {
    return { map: mergedCached, ok: true };
  }
  try {
    const res = await chrome.runtime.sendMessage({
      type: 'GET_APPS_MAP',
      host: safeHost,
      appIds: favoriteAppIds
    });
    if (res?.ok && res?.map && typeof res.map === 'object') {
      return { map: { ...res.map, ...metadataMap }, ok: true };
    }
  } catch (_err) {
    // ignore
  }
  return { map: mergedCached, ok: false };
}

async function fetchAppNamesFromMetadataBundles(host, appIds, trigger = 'panel_open') {
  const safeHost = normalizeHostOrigin(host);
  const uniqueIds = Array.from(new Set((appIds || []).map((id) => String(id || '').trim()).filter((id) => /^\d+$/.test(id))));
  const out = {};
  if (!safeHost || !uniqueIds.length) return out;
  for (const appId of uniqueIds) {
    try {
      const res = await chrome.runtime.sendMessage({
        type: 'PB_GET_METADATA_BUNDLE',
        payload: {
          host: safeHost,
          appId,
          needApp: true,
          needViews: false,
          needFields: false,
          trigger,
          source: 'launcher_bootstrap',
          logGroup: 'bootstrap'
        }
      });
      const appName = String(res?.bundle?.app?.name || '').trim();
      if (res?.ok && appName) {
        out[appId] = appName;
      }
    } catch (_err) {
      // ignore single-app metadata failures
    }
  }
  return out;
}

function setRecentAppNameInState(host, appId, appName) {
  const safeHost = normalizeRecentHost(host);
  const safeAppId = String(appId || '').trim();
  const safeName = String(appName || '').trim();
  if (!safeHost || !safeAppId || !safeName) return false;
  let changed = false;
  state.recentRecords.forEach((item) => {
    const identity = resolveRecentRecordIdentity(item);
    if (identity.host === safeHost && identity.appId === safeAppId && String(item.appName || '').trim() !== safeName) {
      item.appName = safeName;
      changed = true;
    }
  });
  return changed;
}

async function fillRecentAppNamesFromCache() {
  const list = Array.isArray(state.recentRecords) ? state.recentRecords : [];
  if (!list.length) return false;
  const hosts = new Set();
  let changed = false;
  list.forEach((entry) => {
    const identity = resolveRecentRecordIdentity(entry);
    const host = normalizeRecentHost(identity.host);
    if (identity.host && identity.host !== normalizeRecentHost(entry.host || '')) {
      entry.host = identity.host;
    }
    if (identity.appId && identity.appId !== String(entry.appId || '').trim()) {
      entry.appId = identity.appId;
    }
    if (identity.recordId && identity.recordId !== String(entry.recordId || '').trim()) {
      entry.recordId = identity.recordId;
    }
    if (host) hosts.add(host);
  });
  for (const host of hosts.values()) {
    try {
      const { map } = await loadAppNameMap(host);
      Object.entries(map).forEach(([appId, appName]) => {
        if (setRecentAppNameInState(host, appId, appName)) {
          changed = true;
        }
      });
    } catch (_err) {
      // ignore
    }
  }
  return changed;
}

function collectRecentAppIdsForHost(host, { onlyMissing = true } = {}) {
  const safeHost = normalizeRecentHost(host);
  const appIds = new Set();
  state.recentRecords.forEach((entry) => {
    const identity = resolveRecentRecordIdentity(entry);
    if (identity.host !== safeHost || !identity.appId) return;
    const hasName = Boolean(String(entry.appName || '').trim());
    if (onlyMissing && hasName) return;
    appIds.add(identity.appId);
  });
  return Array.from(appIds);
}

function clearRecentAppNamesInState(hosts) {
  const targetHosts = new Set(normalizeHostList(hosts).map((host) => normalizeRecentHost(host)));
  if (!targetHosts.size) return false;
  let changed = false;
  state.recentRecords.forEach((entry) => {
    const identity = resolveRecentRecordIdentity(entry);
    if (!targetHosts.has(identity.host)) return;
    if (String(entry.appName || '').trim()) {
      entry.appName = '';
      changed = true;
    }
  });
  return changed;
}

async function fetchRecentAppNamesByIds(host, appIds, trigger = 'recent_records') {
  const safeHost = normalizeHostOrigin(host);
  const uniqueIds = Array.from(new Set((appIds || []).map((id) => String(id || '').trim()).filter((id) => /^\d+$/.test(id))));
  if (!safeHost || !uniqueIds.length) return {};
  try {
    const res = await chrome.runtime.sendMessage({
      type: 'GET_APP_NAMES_BY_IDS',
      payload: {
        host: safeHost,
        appIds: uniqueIds,
        trigger
      }
    });
    return res?.ok && res?.map && typeof res.map === 'object' ? res.map : {};
  } catch (_err) {
    return {};
  }
}

async function resolveRecentAppNames(options = {}) {
  const hosts = normalizeHostList(options?.hosts || []);
  const scopedHosts = hosts.length ? new Set(hosts.map((host) => normalizeRecentHost(host))) : null;
  const onlyMissing = options?.onlyMissing !== false;
  const trigger = String(options?.trigger || 'recent_records').trim() || 'recent_records';
  let changed = false;
  const recentHosts = new Set();
  state.recentRecords.forEach((entry) => {
    const identity = resolveRecentRecordIdentity(entry);
    if (!identity.host) return;
    if (scopedHosts && !scopedHosts.has(identity.host)) return;
    recentHosts.add(identity.host);
  });
  for (const host of recentHosts.values()) {
    const appIds = collectRecentAppIdsForHost(host, { onlyMissing });
    if (!appIds.length) continue;
    let permitted = false;
    try {
      permitted = await hasHostPermission(host);
    } catch (_err) {
      permitted = false;
    }
    if (!permitted) continue;
    const fetchedMap = await fetchRecentAppNamesByIds(host, appIds, trigger);
    Object.entries(fetchedMap).forEach(([appId, appName]) => {
      if (setRecentAppNameInState(host, appId, appName)) {
        changed = true;
      }
    });
  }
  if (changed && options?.render !== false) {
    renderRecentRecords();
  }
  return changed;
}

function renderRecentRecords() {
  if (!els.recentSection || !els.recentList) return;
  const list = Array.isArray(state.recentRecords) ? state.recentRecords : [];
  els.recentList.textContent = '';
  if (els.recentClear) {
    els.recentClear.disabled = list.length === 0;
  }
  if (!list.length) {
    els.recentSection.classList.add('hidden');
    renderCollapsedSectionsTray();
    applySearchVisibility();
    return;
  }
  list.forEach((item) => {
    const li = doc.createElement('li');
    li.className = 'recent-list-item';
    const btn = doc.createElement('button');
    btn.type = 'button';
    btn.className = 'recent-item';
    const identity = resolveRecentRecordIdentity(item);
    const safeHost = identity.host;
    const safeAppId = identity.appId;
    const safeRecordId = identity.recordId;
    const appLabel = getRecentAppLabel(item);
    btn.dataset.host = safeHost;
    btn.dataset.appId = safeAppId;
    btn.dataset.recordId = safeRecordId;
    btn.dataset.search = [
      appLabel,
      safeRecordId,
      item.url || '',
      safeHost
    ].join('\n').toLowerCase();
    btn.title = item.url || '';
    btn.addEventListener('click', () => openRecentRecord(item));

    const icon = doc.createElement('span');
    icon.className = 'recent-item-icon lc';
    icon.dataset.icon = 'history';
    icon.setAttribute('aria-hidden', 'true');

    const text = doc.createElement('div');
    text.className = 'recent-item-text';
    const title = doc.createElement('div');
    title.className = 'recent-title recent-item-title';
    const app = doc.createElement('span');
    app.className = 'recent-item-app';
    app.textContent = appLabel;
    title.appendChild(app);
    const sub = doc.createElement('div');
    sub.className = 'recent-sub recent-item-meta';
    sub.textContent = safeRecordId ? `#${safeRecordId}` : '';
    text.appendChild(title);
    text.appendChild(sub);

    const time = doc.createElement('span');
    time.className = 'recent-item-time';
    time.textContent = formatRecentTime(item.visitedAt || item.lastSeenAt);

    btn.appendChild(icon);
    btn.appendChild(text);
    btn.appendChild(time);
    li.appendChild(btn);
    els.recentList.appendChild(li);
  });
  els.recentSection.classList.remove('hidden');
  setRecentRecordsCollapsed(state.recentRecordsCollapsed, { persist: false });
  renderLucideIcons(els.recentSection);
  applySearchVisibility();
}

async function loadRecentAndRender() {
  try {
    state.recentRecords = await loadRecentRecords();
    await fillRecentAppNamesFromCache();
  } catch (error) {
    console.error('Failed to load recent records', error);
    state.recentRecords = [];
  }
  renderRecentRecords();
  resolveRecentAppNames({
    onlyMissing: true,
    trigger: 'panel_open',
    render: true
  }).catch((error) => {
    console.error('Failed to resolve recent app names', error);
  });
}

async function clearRecentRecords() {
  try {
    await saveRecentRecords([]);
    state.recentRecords = [];
    renderRecentRecords();
  } catch (error) {
    console.error('Failed to clear recent records', error);
  }
}

async function openRecentRecord(entry) {
  if (!entry?.url) return;
  try {
    if (chrome?.tabs?.create) {
      await chrome.tabs.create({ url: entry.url, active: true });
    } else {
      window.open(entry.url, '_blank', 'noopener');
    }
  } catch (_err) {
    window.open(entry.url, '_blank', 'noopener');
  }
}

function logAppSearchDebug(message, detail = {}) {
  try {
    console.debug(`[app-search] ${message}`, detail);
  } catch (_err) {
    // ignore debug log failures
  }
}

function clearAppSearchCatalogState(options = {}) {
  state.appCatalog = [];
  state.appCatalogByHost = new Map();
  state.appCatalogLoadedHosts = new Set();
  state.appCatalogLastRequestedHosts = [];
  state.appCatalogInFlightHosts = new Set();
  state.appCatalogLoadPromise = null;
  state.appCatalogError = false;
  state.appSearchMatches = [];
  state.appSearchActiveIndex = -1;
  if (options?.render) {
    renderAppSearchResults();
  }
}

async function collectAppSearchTargetHosts(affectedHosts = []) {
  const hostSet = new Set(normalizeHostList(affectedHosts));
  state.favorites
    .map((item) => normalizeHostOrigin(item.host))
    .filter(Boolean)
    .forEach((host) => hostSet.add(host));
  try {
    const tab = await getActiveTab();
    const tabUrl = String(tab?.url || '').trim();
    if (tabUrl && isKintoneUrl(tabUrl)) {
      const parsed = parseKintoneUrl(tabUrl);
      const activeHost = normalizeHostOrigin(parsed?.host || '');
      if (activeHost) hostSet.add(activeHost);
    }
  } catch (_err) {
    // ignore active tab lookup failures
  }
  return Array.from(hostSet);
}

function searchAppsByName(query, limit = APP_CANDIDATE_LIMIT) {
  const keyword = appSearchText(query);
  if (!keyword) return [];
  const prefix = [];
  const partial = [];
  state.appCatalog.forEach((item) => {
    const nameText = appSearchText(item.name);
    if (!nameText) return;
    if (nameText.startsWith(keyword)) {
      prefix.push(item);
      return;
    }
    if (nameText.includes(keyword)) {
      partial.push(item);
    }
  });
  const sorter = (a, b) => {
    const nameA = String(a.name || '');
    const nameB = String(b.name || '');
    return nameA.localeCompare(nameB, getSortLocale());
  };
  return [...prefix.sort(sorter), ...partial.sort(sorter)].slice(0, Math.max(1, Number(limit) || APP_CANDIDATE_LIMIT));
}

function normalizeAppSearchHost(host) {
  return normalizeHostOrigin(host);
}

function buildAppSearchUrl(appId, hostHint = '') {
  const safeAppId = String(appId || '').trim();
  if (!/^\d+$/.test(safeAppId)) return '';

  let host = normalizeAppSearchHost(hostHint);
  if (!host && state.appSearchMatches.length) {
    host = normalizeAppSearchHost(state.appSearchMatches[0]?.host || '');
  }
  if (!host && state.appCatalog.length) {
    host = normalizeAppSearchHost(state.appCatalog[0]?.host || '');
  }
  if (!host) {
    const activeHost = normalizeAppSearchHost(state.favorites[0]?.host || '');
    host = activeHost || '';
  }
  const normalizedHost = host;
  if (!normalizedHost) return '';
  return `${normalizedHost}/k/${encodeURIComponent(safeAppId)}/`;
}

async function openAppSearchCandidate(appId, hostHint = '') {
  try {
    const safeAppId = String(appId || '').trim();
    if (!/^\d+$/.test(safeAppId)) return;

    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const activeTab = tabs && tabs[0] ? tabs[0] : null;

    let normalizedHost = normalizeAppSearchHost(hostHint);
    const activeUrl = String(activeTab?.url || '').trim();
    if (!normalizedHost && activeUrl && isKintoneUrl(activeUrl)) {
      const parsed = parseKintoneUrl(activeUrl);
      normalizedHost = normalizeAppSearchHost(parsed?.host || '');
    }
    const currentOrigin = String(location.origin || '').trim();
    if (!normalizedHost && currentOrigin && isKintoneUrl(currentOrigin)) {
      normalizedHost = normalizeAppSearchHost(currentOrigin);
    }
    if (!normalizedHost) {
      console.warn('No host resolved for app search navigation');
      return;
    }

    const url = buildAppSearchUrl(safeAppId, normalizedHost);
    if (!url) return;

    await openUrlByMode(url, state.shortcutSearchOpenMode);
  } catch (err) {
    console.error('Failed to open app search candidate', err);
  }
}

function renderAppSearchResults() {
  if (!els.appSearchResults) return;
  els.appSearchResults.textContent = '';
  const query = appSearchText(state.appSearchQuery);
  if (!query) return;

  if (!state.appSearchMatches.length) {
    const empty = doc.createElement('li');
    empty.className = 'kp-app-search-empty';
    empty.textContent = state.appCatalogError && !state.appCatalog.length
      ? t('panel_app_search_load_failed')
      : t('panel_app_search_no_results');
    els.appSearchResults.appendChild(empty);
    return;
  }

  state.appSearchMatches.forEach((item, index) => {
    const li = doc.createElement('li');
    li.className = 'kp-app-search-row';

    const btn = doc.createElement('button');
    btn.type = 'button';
    btn.className = 'kp-app-search-item';
    if (index === state.appSearchActiveIndex) {
      btn.classList.add('is-active');
    }
    btn.title = item.url || '';
    btn.dataset.index = String(index);
    btn.dataset.appId = String(item.appId || '');
    btn.dataset.host = normalizeAppSearchHost(item.host || '');
    btn.addEventListener('mouseenter', () => {
      state.appSearchActiveIndex = index;
      updateAppSearchActiveDom();
    });
    btn.addEventListener('click', async () => {
      const appId = btn.dataset.appId || item.appId;
      const host = btn.dataset.host || item.host || '';
      await openAppSearchCandidate(appId, host);
      setAppSearchPopoverVisible(false);
    });

    const name = doc.createElement('div');
    name.className = 'kp-app-search-name';
    name.textContent = item.name;

    const meta = doc.createElement('div');
    meta.className = 'kp-app-search-meta';
    meta.textContent = `app:${item.appId}`;

    btn.appendChild(name);
    btn.appendChild(meta);
    li.appendChild(btn);
    els.appSearchResults.appendChild(li);
  });
}

function updateAppSearchActiveDom() {
  if (!els.appSearchResults) return;
  const items = els.appSearchResults.querySelectorAll('.kp-app-search-item');
  items.forEach((node, i) => {
    node.classList.toggle('is-active', i === state.appSearchActiveIndex);
  });
}

function refreshAppSearchMatches() {
  const query = appSearchText(state.appSearchQuery);
  if (!query) {
    state.appSearchMatches = [];
    state.appSearchActiveIndex = -1;
    logAppSearchDebug('query cleared', { totalAppCount: state.appCatalog.length });
    renderAppSearchResults();
    return;
  }
  state.appSearchMatches = searchAppsByName(query, 8);
  state.appSearchActiveIndex = state.appSearchMatches.length ? 0 : -1;
  logAppSearchDebug('query executed', {
    query,
    candidateCount: state.appSearchMatches.length,
    totalAppCount: state.appCatalog.length
  });
  renderAppSearchResults();
}

function setAppSearchPopoverVisible(visible) {
  state.appSearchOpen = Boolean(visible);
  if (els.appSearchPopover) {
    els.appSearchPopover.classList.toggle('hidden', !state.appSearchOpen);
  }
  if (els.appSearchToggle) {
    els.appSearchToggle.setAttribute('aria-pressed', state.appSearchOpen ? 'true' : 'false');
  }
  if (!state.appSearchOpen) {
    state.appSearchQuery = '';
    state.appSearchMatches = [];
    state.appSearchActiveIndex = -1;
    if (els.appSearchInput) els.appSearchInput.value = '';
    renderAppSearchResults();
    return;
  }
  refreshAppCatalog({ reason: 'app_search_open' }).catch(() => {});
  refreshAppSearchMatches();
  if (els.appSearchInput) {
    setTimeout(() => {
      try {
        els.appSearchInput.focus();
      } catch (_err) {
        // ignore
      }
    }, 0);
  }
}

function moveAppSearchSelection(delta) {
  const len = state.appSearchMatches.length;
  if (!len) return;
  const base = state.appSearchActiveIndex >= 0 ? state.appSearchActiveIndex : 0;
  const next = (base + delta + len) % len;
  state.appSearchActiveIndex = next;
  updateAppSearchActiveDom();
  const active = els.appSearchResults?.querySelector('.kp-app-search-item.is-active');
  if (active) {
    active.scrollIntoView({ block: 'nearest' });
  }
}

function openActiveOrFirstAppSearchResult() {
  if (!state.appSearchMatches.length) return;
  const index = state.appSearchActiveIndex >= 0 ? state.appSearchActiveIndex : 0;
  const item = state.appSearchMatches[index];
  if (!item) return;
  openAppSearchCandidate(item.appId, item.host).finally(() => {
    setAppSearchPopoverVisible(false);
  });
}

function handleAppSearchInputKeydown(event) {
  if (event.key === 'Enter' && isImeComposing(event)) {
    return;
  }
  if (event.key === 'ArrowDown') {
    event.preventDefault();
    moveAppSearchSelection(1);
    return;
  }
  if (event.key === 'ArrowUp') {
    event.preventDefault();
    moveAppSearchSelection(-1);
    return;
  }
  if (event.key === 'Enter') {
    event.preventDefault();
    openActiveOrFirstAppSearchResult();
    return;
  }
  if (event.key === 'Escape') {
    event.preventDefault();
    setAppSearchPopoverVisible(false);
  }
}

function isEditableTarget(target) {
  if (!target) return false;
  if (target instanceof HTMLTextAreaElement) return true;
  if (target instanceof HTMLInputElement) return true;
  if (target.isContentEditable) return true;
  if (typeof target.closest === 'function') {
    return Boolean(target.closest('textarea, input, [contenteditable="true"]'));
  }
  return false;
}

function isImeComposing(event) {
  return Boolean(event?.isComposing) || Number(event?.keyCode) === 229;
}

function ensureAppSearchUi() {
  const actions = els.shortcutPanel?.querySelector('.shortcut-head .section-actions');
  if (!actions || !els.shortcutPanel) return;

  if (!els.appSearchToggle) {
    const toggle = doc.createElement('button');
    toggle.id = 'kp-app-search-toggle';
    toggle.type = 'button';
    toggle.className = 'icon-btn small';
    toggle.setAttribute('aria-label', t('panel_action_app_search'));
    toggle.setAttribute('aria-pressed', 'false');
    toggle.title = t('panel_action_app_search');

    const icon = doc.createElement('span');
    icon.className = 'lc';
    icon.dataset.icon = 'search';
    icon.setAttribute('aria-hidden', 'true');
    toggle.appendChild(icon);

    const collapseButton = actions.querySelector('#toggleShortcuts');
    if (collapseButton) {
      actions.insertBefore(toggle, collapseButton);
    } else {
      actions.appendChild(toggle);
    }
    els.appSearchToggle = toggle;
    renderLucideIcons(toggle);
  }

  if (!els.appSearchPopover) {
    const popover = doc.createElement('div');
    popover.id = 'kp-app-search-popover';
    popover.className = 'kp-app-search-popover hidden';

    const head = doc.createElement('div');
    head.className = 'kp-app-search-head';

    const input = doc.createElement('input');
    input.id = 'kp-app-search-input';
    input.type = 'text';
    input.placeholder = t('panel_app_search_placeholder');
    input.autocomplete = 'off';

    const results = doc.createElement('ul');
    results.id = 'kp-app-search-results';
    results.className = 'kp-app-search-results';
    results.setAttribute('aria-live', 'polite');

    head.appendChild(input);
    popover.appendChild(head);
    popover.appendChild(results);
    els.shortcutPanel.appendChild(popover);

    els.appSearchPopover = popover;
    els.appSearchInput = input;
    els.appSearchResults = results;
  }

  if (!state.appSearchToggleHandler && els.appSearchToggle) {
    state.appSearchToggleHandler = () => {
      setAppSearchPopoverVisible(!state.appSearchOpen);
    };
    els.appSearchToggle.addEventListener('click', state.appSearchToggleHandler);
  }
  if (!state.appSearchInputHandler && els.appSearchInput) {
    state.appSearchInputHandler = (event) => {
      state.appSearchQuery = String(event.target?.value || '');
      refreshAppSearchMatches();
    };
    els.appSearchInput.addEventListener('input', state.appSearchInputHandler);
  }
  if (!state.appSearchInputKeydownHandler && els.appSearchInput) {
    state.appSearchInputKeydownHandler = handleAppSearchInputKeydown;
    els.appSearchInput.addEventListener('keydown', state.appSearchInputKeydownHandler);
  }
  if (!state.appSearchOutsideHandler) {
    state.appSearchOutsideHandler = (event) => {
      if (!state.appSearchOpen) return;
      const target = event.target;
      if (els.appSearchPopover?.contains(target) || els.appSearchToggle?.contains(target)) return;
      setAppSearchPopoverVisible(false);
    };
    document.addEventListener('mousedown', state.appSearchOutsideHandler);
  }
}

async function refreshAppCatalog(options = {}) {
  const seq = ++state.appCatalogSeq;
  const affectedHosts = normalizeHostList(options?.affectedHosts || []);
  logAppSearchDebug('rebuild requested', {
    reason: String(options?.reason || 'unknown'),
    affectedHosts
  });
  clearAppSearchCatalogState({ render: false });
  const hostList = await collectAppSearchTargetHosts(affectedHosts);
  logAppSearchDebug('rebuild target hosts', {
    reason: String(options?.reason || 'unknown'),
    targetHosts: hostList
  });

  state.appCatalogSeq = seq;
  state.appCatalogLastRequestedHosts = hostList.slice();
  state.appCatalogInFlightHosts = new Set(hostList);

  if (!hostList.length) {
    if (state.appSearchOpen) {
      refreshAppSearchMatches();
    }
    return;
  }

  const favoriteSet = buildFavoriteAppSet();
  const nextCatalog = [];
  const nextCatalogByHost = new Map();
  let hasFailure = false;

  for (const host of hostList) {
    if (seq !== state.appCatalogSeq) return;
    const normalizedHost = normalizeHostOrigin(host);
    let entryCount = 0;
    try {
      const { map, ok } = await loadHostAppNameMap(normalizedHost);
      if (!ok) hasFailure = true;
      const hostEntries = [];
      Object.entries(map || {}).forEach(([appIdRaw, nameRaw]) => {
        const appId = String(appIdRaw || '').trim();
        const name = String(nameRaw || '').trim();
        if (!appId || !name) return;
        const key = buildFavoriteAppKey(normalizedHost, appId);
        const entry = {
          host: normalizedHost,
          appId,
          name,
          nameLower: appSearchText(name),
          url: `${normalizedHost}/k/${encodeURIComponent(appId)}/`,
          isFavorite: key ? favoriteSet.has(key) : false
        };
        hostEntries.push(entry);
        nextCatalog.push(entry);
      });
      entryCount = hostEntries.length;
      nextCatalogByHost.set(normalizedHost, hostEntries);
      logAppSearchDebug('host app list fetched', {
        host: normalizedHost,
        appCount: entryCount,
        ok
      });
    } catch (error) {
      hasFailure = true;
      nextCatalogByHost.set(normalizedHost, []);
      logAppSearchDebug('host app list fetch failed', {
        host: normalizedHost,
        error: String(error?.message || error)
      });
    }
  }

  if (seq !== state.appCatalogSeq) return;

  nextCatalog.sort((a, b) => {
    const byName = String(a.name || '').localeCompare(String(b.name || ''), getSortLocale());
    if (byName !== 0) return byName;
    return String(a.appId || '').localeCompare(String(b.appId || ''), getSortLocale());
  });

  state.appCatalog = nextCatalog;
  state.appCatalogByHost = nextCatalogByHost;
  state.appCatalogLoadedHosts = new Set(hostList);
  state.appCatalogInFlightHosts = new Set();
  state.appCatalogLoadPromise = null;
  state.appCatalogError = hasFailure && nextCatalog.length === 0;
  logAppSearchDebug('rebuild completed', {
    targetHosts: hostList,
    totalAppCount: nextCatalog.length
  });
  if (state.appSearchOpen) {
    refreshAppSearchMatches();
  }
}

function normalizeFavorites(list) {
  return sortFavorites(
    (list || []).map((item, index) => {
      const title = String(item?.title || '').trim();
      const label = String(item?.label || '').trim();
      const viewIdOrName = String(item?.viewIdOrName || '').trim();
      const viewId = String(item?.viewId || '').trim() || (/^\d+$/.test(viewIdOrName) ? viewIdOrName : '');
      const queryRaw = item?.query;
      const query = queryRaw == null ? null : String(queryRaw).trim();
      return {
        id: item.id || createId(),
        label: label || title || t('panel_entry_no_label'),
        title: title || label || '',
        url: item.url || '',
        host: item.host || '',
        appId: item.appId || '',
        appName: item.appName || '',
        viewId,
        viewIdOrName: viewIdOrName || viewId,
        viewName: item.viewName || '',
        query,
        queryRepairRequired: Boolean(item?.queryRepairRequired),
        pinned: Boolean(item.pinned),
        order: typeof item.order === 'number' ? item.order : index,
        icon: normalizeIconName(item.icon),
        iconColor: normalizeIconColor(item.iconColor),
        category: normalizeCategoryName(item.category),
        // 通知しきい値（設定画面で管理）。正の数のみ保持する
        ...(Number(item?.notifyThreshold) > 0 ? { notifyThreshold: Math.floor(Number(item.notifyThreshold)) } : {})
      };
    })
  );
}

function buildFavoritesSignature(list) {
  const normalized = normalizeFavorites(list);
  return normalized.map((item) => {
    return [
      item.id || '',
      item.label || '',
      item.url || '',
      item.host || '',
      item.appId || '',
      item.viewId || '',
      item.query ?? '',
      item.queryRepairRequired ? '1' : '0',
      item.pinned ? '1' : '0',
      Number(item.order ?? 0),
      item.icon || '',
      item.iconColor || '',
      item.category || ''
    ].join('\u001f');
  }).join('\u001e');
}

function logWatchlistApiDebug(message, detail = '') {
  const suffix = detail ? ` ${detail}` : '';
  console.debug(`[PB API] ${message}${suffix}`);
}

function normalizeRequestId(value) {
  return String(value || '').trim();
}

function isActiveWatchlistRequest(requestId, lifecycleToken) {
  const req = normalizeRequestId(requestId);
  if (!req) return false;
  if (Number(lifecycleToken) !== Number(state.watchlistLifecycleToken)) return false;
  if (normalizeRequestId(state.watchlistSectionSync.activeRequestId) !== req) return false;
  return true;
}

function mergeWatchlistCacheEntry(prevEntry, nextEntry, preferNextWhenEqual = true) {
  const prev = normalizeWatchlistCountCacheEntry(prevEntry);
  const next = normalizeWatchlistCountCacheEntry(nextEntry);
  if (!prev) return next;
  if (!next) return prev;
  const prevTs = Number(prev.updatedAt || 0);
  const nextTs = Number(next.updatedAt || 0);
  if (nextTs > prevTs) return next;
  if (nextTs < prevTs) return prev;
  if (prev.text === next.text) return prev;
  return preferNextWhenEqual ? next : prev;
}

function mergeWatchlistCountCacheMap(sourceMap, { preferIncomingWhenEqual = true } = {}) {
  if (!(sourceMap instanceof Map)) return false;
  let changed = false;
  sourceMap.forEach((incomingEntry, id) => {
    const key = String(id || '').trim();
    if (!key) return;
    const merged = mergeWatchlistCacheEntry(
      state.watchlistCountCache.get(key),
      incomingEntry,
      preferIncomingWhenEqual
    );
    const prev = state.watchlistCountCache.get(key);
    if (!merged) return;
    if (!prev || prev.text !== merged.text || Number(prev.updatedAt || 0) !== Number(merged.updatedAt || 0)) {
      state.watchlistCountCache.set(key, { text: merged.text, updatedAt: Number(merged.updatedAt || 0) });
      changed = true;
    }
  });
  return changed;
}

function shouldThrottleResumeBySource(source, now = Date.now()) {
  const normalized = String(source || '').trim().toLowerCase();
  const isInteractive = normalized.includes('pointerenter') || normalized.includes('mouseenter') || normalized.includes('click');
  if (!isInteractive) return false;
  const previous = Number(state.watchlistResumeSourceAt.get(normalized) || 0);
  const guardMs = 1200;
  if (previous > 0 && (now - previous) < guardMs) {
    return true;
  }
  state.watchlistResumeSourceAt.set(normalized, now);
  return false;
}

function applyFilterText(value) {
  // #filter is local filter only for sidepanel items.
  state.filterText = value || '';
  renderLists();
}

function splitFavoritesByPin() {
  const pinned = [];
  const normal = [];
  state.favorites.forEach((item) => {
    if (item.pinned) pinned.push(item);
    else normal.push(item);
  });
  pinned.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  normal.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  return { pinned, normal };
}

function applySearchVisibility() {
  const keyword = state.filterText.trim().toLowerCase();
  const allEntries = Array.from(doc.querySelectorAll('.entry[data-id]'));
  allEntries.forEach((entryEl) => {
    const haystack = entryEl.dataset.search || '';
    const matched = !keyword || haystack.includes(keyword);
    entryEl.classList.toggle('entry-filter-hidden', !matched);
  });

  if (els.favCategories) {
    const blocks = els.favCategories.querySelectorAll('.category-block');
    blocks.forEach((block) => {
      const hasVisible = Array.from(block.querySelectorAll('.entry')).some((entryEl) => !entryEl.classList.contains('entry-filter-hidden'));
      block.classList.toggle('hidden-by-filter', !hasVisible);
    });
  }

  if (els.pinSection) {
    const hasPinned = Boolean(els.pinnedList?.querySelector('.entry'));
    els.pinSection.classList.toggle('hidden', !hasPinned);
  }

  const pinCards = Array.from(doc.querySelectorAll('#pinList .pin-card'));
  pinCards.forEach((cardEl) => {
    const title = cardEl.querySelector('.pin-title-input')?.value || '';
    const note = cardEl.querySelector('.pin-note-input')?.value || '';
    const recordTitle = cardEl.querySelector('.pin-record-title')?.textContent || '';
    const meta = cardEl.querySelector('.pin-meta')?.textContent || '';
    const url = cardEl.querySelector('.record-pin-open')?.getAttribute('href') || '';
    let host = '';
    try {
      host = new URL(url).origin;
    } catch (_err) {
      host = '';
    }
    const haystack = [title, note, recordTitle, meta, url, host].join('\n').toLowerCase();
    const matched = !keyword || haystack.includes(keyword);
    cardEl.classList.toggle('pin-filter-hidden', !matched);
  });

  const recentItems = Array.from(doc.querySelectorAll('#recentList .recent-item'));
  recentItems.forEach((itemEl) => {
    const haystack = itemEl.dataset.search || itemEl.textContent?.toLowerCase() || '';
    const matched = !keyword || haystack.includes(keyword);
    const row = itemEl.closest('.recent-list-item');
    if (row) {
      row.classList.toggle('recent-filter-hidden', !matched);
    } else {
      itemEl.classList.toggle('recent-filter-hidden', !matched);
    }
  });
}

function isSelectableEntry(entryEl) {
  if (!entryEl?.dataset?.id) return false;
  if (entryEl.classList.contains('entry-filter-hidden')) return false;
  if (entryEl.closest('.category-block.hidden-by-filter')) return false;
  if (entryEl.closest('.hidden')) return false;
  if (entryEl.closest('.tray-collapsed')) return false;
  if (entryEl.closest('#favCategories.is-collapsed')) return false;
  return true;
}

function syncSelectionState() {
  const previousId = state.selectionIds[state.selectionIndex] || null;
  const visibleEntries = Array.from(doc.querySelectorAll('.entry[data-id]')).filter(isSelectableEntry);
  state.selectionIds = visibleEntries.map((item) => item.dataset.id);
  if (!state.selectionIds.length) {
    state.selectionIndex = -1;
    return;
  }
  const keepIndex = previousId ? state.selectionIds.indexOf(previousId) : -1;
  state.selectionIndex = keepIndex >= 0 ? keepIndex : 0;
}

function renderLists() {
  const { pinned, normal } = splitFavoritesByPin();
  renderPinnedList(pinned);
  renderCategorySections(normal);
  setWatchlistCollapsed(state.pinsOnly, { persist: false, source: 'render_lists' });
  applySearchVisibility();
  renderCollapsedSectionsTray();
  updatePanelTourVisibility();
  renderLucideIcons();
  syncSelectionState();
  highlightSelection();
}

// ── 初回ツアー: ウォッチリストが空かつ未消去のときだけ表示する ─────────────
const PANEL_TOUR_DISMISSED_KEY = 'pbPanelTourDismissed';

function updatePanelTourVisibility() {
  if (!els.panelTour) return;
  // ロード完了前(undefined)は表示しない — 一瞬表示されるチラつきを防ぐ
  const show = state.panelTourDismissed === false && !state.favorites.length;
  els.panelTour.classList.toggle('hidden', !show);
}

async function loadPanelTourDismissed() {
  try {
    const stored = await chrome.storage.sync.get(PANEL_TOUR_DISMISSED_KEY);
    state.panelTourDismissed = Boolean(stored?.[PANEL_TOUR_DISMISSED_KEY]);
  } catch (_) {
    state.panelTourDismissed = false;
  }
}

async function dismissPanelTour() {
  state.panelTourDismissed = true;
  updatePanelTourVisibility();
  try {
    await chrome.storage.sync.set({ [PANEL_TOUR_DISMISSED_KEY]: true });
  } catch (_) { /* ignore */ }
}

async function showShortcutCheatsheetInActiveTab() {
  const response = await sendMessageToActiveKintoneTab({ type: 'PB_SHOW_SHORTCUT_CHEATSHEET' });
  if (!response?.ok) {
    setNoticeKey('panel_notice_open_kintone_first');
  }
}

function renderPinnedList(items) {
  if (!els.pinnedList) return [];
  els.pinnedList.textContent = '';
  if (!items.length) {
    const empty = doc.createElement('li');
    empty.className = 'empty-message';
    const hasFilter = state.filterText.trim().length > 0;
    empty.textContent = hasFilter
      ? t('panel_empty_pinned_no_match')
      : t('panel_empty_pinned');
    els.pinnedList.appendChild(empty);
    return [];
  }
  items.forEach((item) => {
    els.pinnedList.appendChild(createEntryElement(item, true));
  });
  return items.slice();
}

function groupByCategory(items) {
  const map = new Map();
  items.forEach((item) => {
    const key = getCategoryLabel(item.category);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(item);
  });
  return map;
}

function renderCategorySections(items) {
  const container = els.favCategories;
  if (!container) return [];
  container.textContent = '';
  if (!items.length) {
    const message = doc.createElement('div');
    message.className = 'empty-message';
    const hasFilter = state.filterText.trim().length > 0;
    message.textContent = hasFilter
      ? t('panel_empty_favorites_no_match')
      : t('panel_empty_favorites');
    container.appendChild(message);
    if (!hasFilter) {
      // 空状態から次の一歩に進める導線（現在のビューをそのまま登録）
      const cta = doc.createElement('button');
      cta.type = 'button';
      cta.className = 'empty-cta';
      const icon = doc.createElement('span');
      icon.className = 'lc';
      icon.dataset.icon = 'plus';
      icon.setAttribute('aria-hidden', 'true');
      const label = doc.createElement('span');
      label.textContent = t('panel_empty_favorites_cta');
      cta.append(icon, label);
      cta.addEventListener('click', () => quickAddFromActiveTab());
      container.appendChild(cta);
      const hint = doc.createElement('div');
      hint.className = 'empty-hint';
      hint.textContent = t('panel_empty_favorites_hint');
      container.appendChild(hint);
      renderLucideIcons(container);
    }
    return [];
  }
  const grouped = groupByCategory(items);
  const order = Array.from(grouped.keys()).sort((a, b) => {
    if (a === DEFAULT_CATEGORY) return 1;
    if (b === DEFAULT_CATEGORY) return -1;
    return a.localeCompare(b, getSortLocale());
  });
  const flattened = [];
  order.forEach((name) => {
    const block = doc.createElement('section');
    block.className = 'category-block';
    const title = doc.createElement('h3');
    title.className = 'category-title';
    title.textContent = name;
    const list = doc.createElement('ul');
    list.className = 'category-list';
    grouped.get(name).forEach((entry) => {
      list.appendChild(createEntryElement(entry, false));
      flattened.push(entry);
    });
    block.appendChild(title);
    block.appendChild(list);
    container.appendChild(block);
  });
  return flattened;
}

function createEntryElement(entry, pinned) {
  const iconName = normalizeIconName(entry.icon);
  const categoryLabel = getCategoryLabel(entry.category);
  const li = doc.createElement('li');
  li.className = 'entry';
  li.dataset.id = entry.id;
  li.dataset.pinned = String(pinned);
  li.dataset.category = categoryLabel;
  li.draggable = true;
  li.addEventListener('dragstart', handleDragStart);
  li.addEventListener('dragover', handleDragOver);
  li.addEventListener('dragleave', handleDragLeave);
  li.addEventListener('drop', handleDrop);
  li.addEventListener('dragend', handleDragEnd);

  const button = doc.createElement('button');
  button.type = 'button';
  button.className = 'entry-main';
  button.dataset.id = entry.id;
  button.addEventListener('click', () => {
    const useSearchMode = Boolean(state.filterText.trim());
    openEntry(entry, { useSearchMode });
  });
  button.addEventListener('focus', () => setSelectionById(entry.id));
  button.addEventListener('mouseenter', () => setSelectionById(entry.id));

  const left = doc.createElement('div');
  left.className = 'entry-left';

  const icon = doc.createElement('span');
  icon.className = 'entry-icon kp-ico lc';
  icon.dataset.icon = iconName;
  icon.dataset.icoColor = normalizeIconColor(entry.iconColor);
  icon.setAttribute('aria-hidden', 'true');

  const text = doc.createElement('div');
  text.className = 'entry-text';
  const title = doc.createElement('div');
  title.className = 'entry-title';
  title.textContent = entry.label || t('panel_entry_no_label');
  const sub = doc.createElement('div');
  sub.className = 'entry-sub hidden';
  li.dataset.search = [
    entry.label || '',
    entry.url || '',
    entry.host || '',
    entry.appId || '',
    entry.appName || '',
    categoryLabel,
    entry.viewIdOrName || '',
    entry.viewName || '',
    entry.query || ''
  ].join('\n').toLowerCase();
  text.appendChild(title);
  text.appendChild(sub);
  left.appendChild(icon);
  left.appendChild(text);

  const badge = doc.createElement('div');
  badge.className = 'entry-badge';
  badge.dataset.id = entry.id;
  syncBadgeToElement(entry.id, badge);

  const right = doc.createElement('div');
  right.className = 'entry-right';
  right.appendChild(badge);

  button.appendChild(left);
  button.appendChild(right);

  li.appendChild(button);

  // ホバー/フォーカスで現れる行内操作（行本体がbuttonなので外側に重ねる）
  const actions = doc.createElement('div');
  actions.className = 'entry-actions';
  const makeEntryAction = (iconName2, label, onClick, extraClass = '') => {
    const btn = doc.createElement('button');
    btn.type = 'button';
    btn.className = `entry-action-btn${extraClass ? ` ${extraClass}` : ''}`;
    btn.title = label;
    btn.setAttribute('aria-label', label);
    const svg = iconToSvg(iconName2, 13);
    if (svg) btn.innerHTML = svg;
    btn.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      onClick();
    });
    return btn;
  };
  actions.appendChild(makeEntryAction(
    pinned ? 'star-off' : 'star',
    pinned ? t('panel_action_unpin_entry') : t('panel_action_pin_entry'),
    () => { togglePin(entry.id, !pinned).catch(() => {}); },
    pinned ? 'entry-action-btn--active' : ''
  ));
  actions.appendChild(makeEntryAction(
    'pencil',
    t('panel_action_rename_entry'),
    () => { renameEntry(entry).catch(() => {}); }
  ));
  actions.appendChild(makeEntryAction(
    'trash-2',
    t('panel_action_delete_entry'),
    () => { confirmDeleteEntry(entry).catch(() => {}); },
    'entry-action-btn--danger'
  ));
  li.appendChild(actions);
  return li;
}

function highlightSelection() {
  const buttons = doc.querySelectorAll('.entry-main');
  buttons.forEach((btn) => btn.classList.remove('active'));
  if (state.selectionIndex < 0 || state.selectionIndex >= state.selectionIds.length) return;
  const id = state.selectionIds[state.selectionIndex];
  const active = doc.querySelector(`.entry-main[data-id="${escapeId(id)}"]`);
  if (active) {
    active.classList.add('active');
  }
}

function moveSelection(delta) {
  if (!state.selectionIds.length) return;
  const next = (state.selectionIndex + delta + state.selectionIds.length) % state.selectionIds.length;
  state.selectionIndex = next;
  highlightSelection();
  scrollSelectionIntoView();
}

function scrollSelectionIntoView() {
  if (state.selectionIndex < 0 || state.selectionIndex >= state.selectionIds.length) return;
  const id = state.selectionIds[state.selectionIndex];
  const active = doc.querySelector(`.entry-main[data-id="${escapeId(id)}"]`);
  if (active) {
    active.scrollIntoView({ block: 'nearest' });
  }
}

function setSelectionById(id) {
  const index = state.selectionIds.indexOf(id);
  if (index >= 0) {
    state.selectionIndex = index;
    highlightSelection();
  }
}

function openSelection() {
  if (state.selectionIndex < 0 || state.selectionIndex >= state.selectionIds.length) return;
  const id = state.selectionIds[state.selectionIndex];
  const entry = state.favorites.find((item) => item.id === id);
  if (entry) openEntry(entry, { useSearchMode: true });
}

async function openEntry(entry, options = {}) {
  if (!entry?.url) return;
  const useSearchMode = Boolean(options.useSearchMode);
  const openMode = useSearchMode ? state.shortcutSearchOpenMode : SHORTCUT_SEARCH_OPEN_MODE_NEW_TAB;
  try {
    await openUrlByMode(entry.url, openMode);
  } catch (error) {
    console.error('Failed to open entry', error);
    window.open(entry.url, '_blank', 'noopener,noreferrer');
  }
}

function syncBadgeToElement(id, el) {
  const stateItem = state.badgeStatus.get(id) || { text: '-', title: t('panel_badge_not_fetched'), loading: false, status: 'none' };
  el.title = stateItem.title || '';
  el.classList.toggle('loading', Boolean(stateItem.loading));
  const isError = !stateItem.loading && stateItem.status === 'error';
  const isZero = !stateItem.loading && stateItem.status === 'zero';
  el.classList.toggle('entry-badge--error', isError);
  el.classList.toggle('entry-badge--zero', isZero);
  if (isError) {
    const svg = iconToSvg('triangle-alert', 12);
    if (svg) {
      el.innerHTML = svg;
      el.setAttribute('role', 'img');
      el.setAttribute('aria-label', stateItem.title || t('panel_badge_fetch_failed'));
      return;
    }
  }
  el.removeAttribute('role');
  el.removeAttribute('aria-label');
  el.textContent = stateItem.text ?? '-';
}

function updateBadgeDom(id) {
  const el = doc.querySelector(`.entry-badge[data-id="${escapeId(id)}"]`);
  if (el) syncBadgeToElement(id, el);
}

function setBadgeLoading(id, loading) {
  const prev = state.badgeStatus.get(id) || { text: '-', title: t('panel_badge_not_fetched'), loading: false };
  const nextLoading = Boolean(loading);
  if (Boolean(prev.loading) === nextLoading) return;
  state.badgeStatus.set(id, { ...prev, loading: nextLoading });
  updateBadgeDom(id);
}

function setBadgeValue(id, value, title = '') {
  const text = value == null ? '-' : String(value);
  const status = value == null ? 'error' : (Number(value) === 0 ? 'zero' : 'count');
  const next = { text, title: title || '', loading: false, status };
  const prev = state.badgeStatus.get(id);
  if (prev && prev.text === next.text && prev.title === next.title && Boolean(prev.loading) === next.loading && prev.status === next.status) {
    return;
  }
  state.badgeStatus.set(id, next);
  updateBadgeDom(id);
}

async function loadFavoritesAndRender() {
  const loaded = await loadFavorites();
  const migrated = await migrateFavoritesQueryIfNeeded(loaded);
  state.favorites = normalizeFavorites(migrated.items);
  state.favoritesStorageSignature = buildFavoritesSignature(state.favorites);
  if (!state.favorites.length) {
    const syncState = state.watchlistSectionSync;
    syncState.pendingReasons = [];
    syncState.pendingSources = {};
    syncState.pendingIgnoreCooldown = false;
    syncState.inFlight = false;
    state.watchlistRefreshInFlight = false;
  }
  const validIds = new Set(state.favorites.map((item) => item.id));
  for (const key of Array.from(state.badgeStatus.keys())) {
    if (!validIds.has(key)) state.badgeStatus.delete(key);
  }
  await pruneWatchlistCountCache(validIds);
  applyWatchlistCountCacheToBadges();
  renderLists();
  await refreshAppCatalog({ reason: 'load_favorites' });
  renderShortcuts();
  await syncWatchlistAutoRefreshTimer('load_favorites');
  const hosts = new Set(state.favorites.map((item) => item.host).filter(Boolean));
  for (const host of hosts) {
    try {
      await chrome.runtime.sendMessage({ type: 'WARMUP_CONNECTOR', host });
    } catch (_err) {
      // ignore
    }
  }
}

function groupByHost(items) {
  const map = new Map();
  for (const item of items) {
    if (!item.host) continue;
    if (!map.has(item.host)) map.set(item.host, []);
    map.get(item.host).push(item);
  }
  return map;
}

async function refreshCounts({
  trigger = 'watchlist_bulk',
  source = 'watchlist',
  targets = [],
  requestId = '',
  lifecycleToken = state.watchlistLifecycleToken
} = {}) {
  const normalizedRequestId = normalizeRequestId(requestId);
  const targetItems = Array.isArray(targets) && targets.length ? targets : state.favorites;
  if (!targetItems.length) {
    return { ok: true, skipped: 'no_entries' };
  }
  if (normalizedRequestId && !isActiveWatchlistRequest(normalizedRequestId, lifecycleToken)) {
    logWatchlistApiDebug('skip stale before request', `feature=watchlist trigger=${trigger} requestId=${normalizedRequestId}`);
    return { ok: false, skipped: 'stale_request' };
  }
  
  setNotice('');
  targetItems.forEach((item) => setBadgeLoading(item.id, true));
  const grouped = groupByHost(targetItems);
  const missingPerm = new Set();
  const failedHosts = new Set();
  const refreshedAt = Date.now();
  let cacheChanged = false;
  let updatedCount = 0;
  let unchangedCount = 0;
  for (const [host, items] of grouped.entries()) {
    try {
      if (normalizedRequestId && !isActiveWatchlistRequest(normalizedRequestId, lifecycleToken)) {
        logWatchlistApiDebug('drop stale before host', `feature=watchlist trigger=${trigger} requestId=${normalizedRequestId}`);
        return { ok: false, skipped: 'stale_request' };
      }
      const permitted = await hasHostPermission(host);
      if (!permitted) {
        items.forEach((item) => setBadgeValue(item.id, null, t('panel_badge_permission_required')));
        missingPerm.add(host);
        continue;
      }
      try {
        await chrome.runtime.sendMessage({ type: 'WARMUP_CONNECTOR', host });
      } catch (_warmErr) {
        // ignore
      }
      const payloadItems = items.map((item) => ({
        id: item.id,
        appId: item.appId,
        viewIdOrName: item.viewIdOrName || '',
        query: item.query || ''
      }));
      const res = await sendCountBulk(host, payloadItems, {
        trigger,
        source
      });
      if (normalizedRequestId && !isActiveWatchlistRequest(normalizedRequestId, lifecycleToken)) {
        logWatchlistApiDebug('drop stale after host', `feature=watchlist trigger=${trigger} requestId=${normalizedRequestId}`);
        return { ok: false, skipped: 'stale_request' };
      }
      if (res?.ok) {
        const counts = res.counts || {};
        const errors = res.errors || {};
        for (const item of items) {
          if (errors[item.id]) {
            setBadgeValue(item.id, null, errors[item.id]);
            failedHosts.add(host);
          } else if (Object.prototype.hasOwnProperty.call(counts, item.id)) {
            const changed = setWatchlistCountCacheValue(item.id, counts[item.id], refreshedAt);
            if (changed) {
              setBadgeValue(item.id, counts[item.id], buildWatchlistBadgeTitle(refreshedAt));
              cacheChanged = true;
              updatedCount += 1;
            } else {
              const cached = state.watchlistCountCache.get(item.id);
              setBadgeValue(item.id, counts[item.id], buildWatchlistBadgeTitle(cached?.updatedAt || refreshedAt));
              unchangedCount += 1;
            }
          } else {
            setBadgeValue(item.id, null, t('panel_badge_missing_result'));
            failedHosts.add(host);
          }
        }
      } else {
        const message = res?.error || t('panel_badge_fetch_failed');
        items.forEach((item) => setBadgeValue(item.id, null, message));
        failedHosts.add(host);
      }
    } catch (error) {
      const message = String(error?.message || error);
      items.forEach((item) => setBadgeValue(item.id, null, message));
      failedHosts.add(host);
    }
  }
  if (missingPerm.size) {
    setNoticeKey('panel_notice_permission_missing_hosts', { hosts: Array.from(missingPerm).join(', ') });
  } else if (failedHosts.size) {
    setNoticeKey('panel_notice_counts_failed');
  }
  if (cacheChanged) {
    await saveWatchlistCountCache();
  }
  renderWatchlistUpdatedLabel();
  return {
    ok: missingPerm.size === 0 && failedHosts.size === 0,
    missingPermissionHosts: missingPerm.size,
    failedHosts: failedHosts.size,
    targetCount: targetItems.length,
    updatedCount,
    unchangedCount
  };
}

function attachStorageListener() {
  if (!chrome?.storage?.onChanged) return;
  const listener = (changes, area) => {
    if (area === 'local' && Object.prototype.hasOwnProperty.call(changes, WATCHLIST_COUNT_CACHE_KEY)) {
      const incoming = normalizeWatchlistCountCache(changes[WATCHLIST_COUNT_CACHE_KEY]?.newValue);
      const changed = mergeWatchlistCountCacheMap(incoming, { preferIncomingWhenEqual: true });
      if (changed) {
        applyWatchlistCountCacheToBadges();
        renderLists();
      }
    }
    if (area === 'local' && Object.prototype.hasOwnProperty.call(changes, UI_LANGUAGE_KEY)) {
      const nextSetting = normalizeUiLanguageSetting(changes[UI_LANGUAGE_KEY]?.newValue);
      applyUiLanguageSetting(nextSetting, { persist: false, rerender: true }).catch((error) => {
        console.error('Failed to apply launcher language', error);
      });
      return;
    }
    if (area === 'local' && Object.prototype.hasOwnProperty.call(changes, WATCHLIST_REFRESH_PRESET_KEY)) {
      applyWatchlistRefreshPreset(changes[WATCHLIST_REFRESH_PRESET_KEY]?.newValue, { persist: false })
        .then(() => {
          stopWatchlistAutoRefreshTimer();
          return syncWatchlistAutoRefreshTimer('watchlist_preset_changed');
        })
        .catch(() => {});
      return;
    }
    if (area === 'local' && Object.prototype.hasOwnProperty.call(changes, WATCHLIST_LIMIT_KEY)) {
      state.watchlistLimit = normalizeWatchlistLimit(changes[WATCHLIST_LIMIT_KEY]?.newValue);
      return;
    }
    if (area !== 'sync') return;
    if (changes.kintoneFavorites) {
      loadFavoritesAndRender().catch((error) => {
        console.error('Failed to reload favorites', error);
      });
    }
    if (Object.prototype.hasOwnProperty.call(changes, 'kfavShortcuts')) {
      refreshShortcutEntries().catch((error) => {
        console.error('Failed to reload shortcuts', error);
      });
    }
    if (Object.prototype.hasOwnProperty.call(changes, 'kfavRecentRecords')) {
      loadRecentAndRender().catch((error) => {
        console.error('Failed to reload recent records', error);
      });
    }
    // kfavPins is handled by pins.js own storage listener to avoid
    // input-time focus loss caused by duplicated reloads.
    if (Object.prototype.hasOwnProperty.call(changes, 'kfavShortcutsVisible')) {
      const next = typeof changes.kfavShortcutsVisible.newValue === 'boolean'
        ? changes.kfavShortcutsVisible.newValue
        : true;
      applyShortcutVisibility(next);
    }
    if (Object.prototype.hasOwnProperty.call(changes, 'kfavRecordPinsVisible')) {
      const nextRecordPins = typeof changes.kfavRecordPinsVisible.newValue === 'boolean'
        ? changes.kfavRecordPinsVisible.newValue
        : true;
      applyRecordPinVisibility(nextRecordPins);
    }
    if (Object.prototype.hasOwnProperty.call(changes, SHORTCUT_SEARCH_OPEN_MODE_KEY)) {
      state.shortcutSearchOpenMode = normalizeShortcutSearchOpenMode(
        changes[SHORTCUT_SEARCH_OPEN_MODE_KEY]?.newValue
      );
    }
  };
  chrome.storage.onChanged.addListener(listener);
  state.storageListener = listener;
}

function queueHostCacheRefresh(hosts) {
  const normalizedHosts = normalizeHostList(hosts);
  normalizedHosts.forEach((host) => {
    state.pendingHostCacheRefreshHosts.add(host);
  });
  if (state.pendingHostCacheRefreshTimerId) return;
  state.pendingHostCacheRefreshTimerId = window.setTimeout(() => {
    state.pendingHostCacheRefreshTimerId = 0;
    const targetHosts = Array.from(state.pendingHostCacheRefreshHosts);
    state.pendingHostCacheRefreshHosts.clear();
    if (!targetHosts.length) return;
    refreshAfterHostCacheInvalidation(targetHosts).catch((error) => {
      console.error('Failed to refresh launcher after cache invalidation', error);
    });
  }, 60);
}

async function refreshAfterHostCacheInvalidation(hosts) {
  const targetHosts = normalizeHostList(hosts);
  if (!targetHosts.length) return;
  state.appCatalogSeq += 1;
  const recentChanged = clearRecentAppNamesInState(targetHosts);
  clearAppSearchCatalogState({ render: state.appSearchOpen });
  if (recentChanged) {
    renderRecentRecords();
  }
  await Promise.allSettled([
    resolveRecentAppNames({
      hosts: targetHosts,
      onlyMissing: false,
      trigger: 'permission_change',
      render: true
    }),
    refreshAppCatalog({
      affectedHosts: targetHosts,
      reason: 'permission_change'
    })
  ]);
}

function attachRuntimeListener() {
  if (!chrome?.runtime?.onMessage || state.runtimeListener) return;
  const listener = (message) => {
    const messageType = String(message?.type || '').trim();
    if (!CACHE_INVALIDATION_MESSAGE_TYPES.has(messageType)) return;
    const payload = message?.payload && typeof message.payload === 'object' ? message.payload : {};
    const hosts = normalizeHostList(payload?.hosts || message?.hosts || payload?.host || message?.host);
    if (!hosts.length) return;
    logAppSearchDebug('permission event received', {
      messageType,
      affectedHosts: hosts
    });
    queueHostCacheRefresh(hosts);
    refreshHostOnboarding().catch(() => {});
  };
  chrome.runtime.onMessage.addListener(listener);
  state.runtimeListener = listener;
}

function detachStorageListener() {
  if (state.storageListener && chrome?.storage?.onChanged) {
    chrome.storage.onChanged.removeListener(state.storageListener);
    state.storageListener = null;
  }
}

function applyShortcutVisibility(visible) {
  shortcutState.visible = visible;
  if (els.shortcutPanel) {
    els.shortcutPanel.classList.toggle('collapsed', !visible);
  }
  if (els.toggleShortcuts) {
    els.toggleShortcuts.setAttribute('aria-pressed', visible ? 'true' : 'false');
    setCollapseIcon(els.toggleShortcuts, !visible);
    const label = visible ? t('panel_action_toggle_shortcuts_collapse') : t('panel_action_toggle_shortcuts_expand');
    els.toggleShortcuts.title = label;
    els.toggleShortcuts.setAttribute('aria-label', label);
  }
}

function openShortcutTooltip(btn) {
  if (!btn) return;
  const tooltip = btn.querySelector('.shortcut-tooltip');
  if (!tooltip || !tooltip.textContent) return;
  btn.classList.add('tooltip-open');
  btn.classList.remove('tooltip-align-left', 'tooltip-align-right');
  const panelRect = (els.shortcutPanel || els.shortcutRow || doc.body).getBoundingClientRect();
  const tooltipRect = tooltip.getBoundingClientRect();
  if (tooltipRect.left < panelRect.left + 4) {
    btn.classList.add('tooltip-align-left');
    return;
  }
  if (tooltipRect.right > panelRect.right - 4) {
    btn.classList.add('tooltip-align-right');
  }
}

function closeShortcutTooltip(btn) {
  if (!btn) return;
  btn.classList.remove('tooltip-open', 'tooltip-align-left', 'tooltip-align-right');
}

function switchTab(tabName, { focus = false } = {}) {
  state.activeTab = tabName;
  els.panelTabBtns.forEach((btn) => {
    const isActive = btn.dataset.tab === tabName;
    btn.classList.toggle('is-active', isActive);
    btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
    // roving tabindex: アクティブなタブだけをTab順に含める
    btn.setAttribute('tabindex', isActive ? '0' : '-1');
    if (isActive && focus) btn.focus();
  });
  if (els.mainTabPane) els.mainTabPane.classList.toggle('is-active', tabName === 'main');
  if (els.pinsTabPane) els.pinsTabPane.classList.toggle('is-active', tabName === 'pins');
}

function initPanelTabs() {
  const tabs = els.panelTabBtns;
  tabs.forEach((btn, index) => {
    btn.setAttribute('tabindex', btn.classList.contains('is-active') ? '0' : '-1');
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
    btn.addEventListener('keydown', (event) => {
      let nextIndex = null;
      if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
        nextIndex = (index + 1) % tabs.length;
      } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
        nextIndex = (index - 1 + tabs.length) % tabs.length;
      } else if (event.key === 'Home') {
        nextIndex = 0;
      } else if (event.key === 'End') {
        nextIndex = tabs.length - 1;
      }
      if (nextIndex === null) return;
      event.preventDefault();
      switchTab(tabs[nextIndex].dataset.tab, { focus: true });
    });
  });
}

function renderShortcuts() {
  if (!els.shortcutRow) return;
  els.shortcutRow.textContent = '';
  const entries = shortcutState.entries.slice(0, SHORTCUT_MAX_VISIBLE);
  if (!entries.length) {
    const empty = doc.createElement('button');
    empty.type = 'button';
    empty.className = 'shortcut-button shortcut-empty';
    empty.textContent = '+';
    empty.title = t('panel_empty_shortcuts');
    empty.setAttribute('aria-label', t('panel_empty_shortcuts'));
    empty.addEventListener('click', () => {
      openOptionsPage();
    });
    els.shortcutRow.appendChild(empty);
    return;
  }
  entries.forEach((entry) => {
    const btn = doc.createElement('button');
    btn.type = 'button';
    const type = entry.type || 'appTop';
    const label = (entry.label || '').trim();
    const displayLabel = label || t('panel_entry_no_label');
    const iconColor = resolveShortcutIconColor(entry);
    btn.className = `shortcut-button shortcut-${type}`;
    btn.setAttribute('aria-label', displayLabel);
    const url = buildShortcutUrl(entry);
    if (!url) {
      btn.disabled = true;
      btn.classList.add('disabled');
    }
    const icon = doc.createElement('span');
    icon.className = 'shortcut-icon lc';
    icon.dataset.icon = resolveShortcutIcon(entry);
    icon.dataset.icoColor = iconColor;
    icon.setAttribute('aria-hidden', 'true');

    const text = doc.createElement('span');
    text.className = 'shortcut-text';
    text.textContent = displayLabel;
    text.setAttribute('aria-hidden', 'true');

    const dot = doc.createElement('span');
    dot.className = 'shortcut-dot';
    dot.dataset.icoColor = iconColor;
    dot.setAttribute('aria-hidden', 'true');

    btn.appendChild(icon);
    btn.appendChild(text);
    btn.appendChild(dot);
    btn.addEventListener('click', () => openShortcut(entry));
    els.shortcutRow.appendChild(btn);
  });
  renderLucideIcons(els.shortcutRow);
}
async function openShortcut(entry) {
  const url = buildShortcutUrl(entry);
  if (!url) {
    setNoticeKey('panel_notice_shortcut_url_missing');
    return;
  }
  if (entry.host) {
    try {
      await chrome.runtime.sendMessage({ type: 'WARMUP_CONNECTOR', host: entry.host });
    } catch (_err) {}
  }
  try {
    await openUrlByMode(url, state.shortcutSearchOpenMode);
  } catch (error) {
    console.error('Failed to open shortcut', error);
    window.open(url, '_blank', 'noopener,noreferrer');
  }
}

async function warmShortcutHosts(entries) {
  for (const entry of entries) {
    const host = entry.host;
    if (!host || shortcutState.warmedHosts.has(host)) continue;
    shortcutState.warmedHosts.add(host);
    try {
      await chrome.runtime.sendMessage({ type: 'WARMUP_CONNECTOR', host });
    } catch (_err) {}
  }
}

async function refreshShortcutEntries() {
  try {
    const [list, visible] = await Promise.all([
      loadShortcuts(),
      loadShortcutVisibility()
    ]);
    shortcutState.entries = sortShortcuts(list);
    applyShortcutVisibility(typeof visible === 'boolean' ? visible : true);
    renderShortcuts();
    await warmShortcutHosts(shortcutState.entries);
  } catch (error) {
    console.error('Failed to refresh shortcuts', error);
  }
}

async function toggleShortcutVisibility() {
  const next = !shortcutState.visible;
  applyShortcutVisibility(next);
  try {
    await saveShortcutVisibility(next);
  } catch (_err) {}
}

async function saveFavoritesWithStaleGuard(nextFavorites, { source = 'unknown', expectedSignature = '' } = {}) {
  const normalizedNext = normalizeFavorites(nextFavorites);
  const latest = normalizeFavorites(await loadFavorites());
  const latestSignature = buildFavoritesSignature(latest);
  const expected = String(expectedSignature || state.favoritesStorageSignature || '').trim();
  if (expected && latestSignature !== expected) {
    logWatchlistApiDebug('storage skip stale write', `key=kintoneFavorites source=${source}`);
    state.favorites = latest;
    state.favoritesStorageSignature = latestSignature;
    renderLists();
    setNoticeKey('panel_notice_favorites_stale');
    return { ok: false, stale: true };
  }
  await saveFavorites(normalizedNext);
  state.favorites = normalizedNext;
  state.favoritesStorageSignature = buildFavoritesSignature(normalizedNext);
  logWatchlistApiDebug('storage save', `key=kintoneFavorites source=${source}`);
  return { ok: true, stale: false };
}

async function quickAddFromActiveTab() {
  try {
    const tab = await getActiveTab();
    if (!tab || !isKintoneUrl(tab.url || '')) {
      setNoticeKey('panel_notice_open_kintone_first');
      return;
    }
    const parsed = parseKintoneUrl(tab.url);
    if (!parsed.host) {
      setNoticeKey('panel_notice_parse_url_failed');
      return;
    }
    const existing = await loadFavorites();
    const watchlistLimit = normalizeWatchlistLimit(state.watchlistLimit);
    if (existing.length >= watchlistLimit) {
      setNoticeKey('panel_notice_watchlist_limit_reached', { limit: watchlistLimit });
      return;
    }
    const queryResolved = await resolveWatchlistSavedQuery({
      host: parsed.host,
      appId: parsed.appId,
      viewId: parsed.viewId,
      viewIdOrName: parsed.viewIdOrName,
      url: parsed.url,
      query: ''
    });
    if (!queryResolved.ok) {
      setNoticeKey('panel_notice_watchlist_query_resolve_failed');
      return;
    }
    const canonicalUrl = buildWatchlistUrl(parsed.host, parsed.appId, queryResolved.viewId);
    if (!canonicalUrl) {
      setNoticeKey('panel_notice_watchlist_query_resolve_failed');
      return;
    }
    if (existing.some((item) => item.url === canonicalUrl)) {
      setNoticeKey('panel_notice_already_registered');
      return;
    }
    const label = (tab.title || '').replace(/ - kintone.*/, '') || t('panel_entry_no_label');
    const orderBase = existing.filter((item) => !item.pinned).length;
    const entry = {
      id: createId(),
      label,
      title: label,
      url: canonicalUrl,
      host: parsed.host,
      appId: parsed.appId,
      viewId: String(queryResolved.viewId || '').trim(),
      viewIdOrName: String(queryResolved.viewId || '').trim(),
      viewName: queryResolved.viewName || '',
      query: String(queryResolved.query || ''),
      queryRepairRequired: false,
      icon: DEFAULT_ICON,
      iconColor: DEFAULT_ICON_COLOR,
      category: DEFAULT_CATEGORY,
      order: orderBase,
      pinned: false
    };
    const next = [...existing, entry];
    const saved = await saveFavoritesWithStaleGuard(next, {
      source: 'quick_add',
      expectedSignature: buildFavoritesSignature(existing)
    });
    if (!saved.ok) return;
    state.badgeStatus.set(entry.id, { text: '-', title: t('panel_badge_not_fetched'), loading: false });
    renderLists();
    setNoticeKey('panel_notice_added');
  } catch (error) {
    console.error('Failed to add favorite', error);
    setNoticeKey('panel_notice_add_failed');
  }
}

// ── パネル内ダイアログ（prompt/confirm の代替。i18n・キーボード対応） ────────
function showPanelDialog(options = {}) {
  return new Promise((resolve) => {
    const overlay = doc.createElement('div');
    overlay.className = 'panel-dialog';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    if (options.title) overlay.setAttribute('aria-label', options.title);

    const card = doc.createElement('div');
    card.className = 'panel-dialog__card';

    if (options.title) {
      const title = doc.createElement('h2');
      title.className = 'panel-dialog__title';
      title.textContent = options.title;
      card.appendChild(title);
    }
    if (options.message) {
      const message = doc.createElement('p');
      message.className = 'panel-dialog__message';
      message.textContent = options.message;
      card.appendChild(message);
    }

    let inputEl = null;
    if (options.inputValue !== undefined) {
      inputEl = doc.createElement('input');
      inputEl.type = 'text';
      inputEl.className = 'panel-dialog__input';
      inputEl.value = String(options.inputValue ?? '');
      card.appendChild(inputEl);
    }

    const actions = doc.createElement('div');
    actions.className = 'panel-dialog__actions';
    const cancelBtn = doc.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'panel-dialog__btn';
    cancelBtn.textContent = options.cancelLabel || t('panel_dialog_cancel');
    const confirmBtn = doc.createElement('button');
    confirmBtn.type = 'button';
    confirmBtn.className = 'panel-dialog__btn panel-dialog__btn--primary'
      + (options.danger ? ' panel-dialog__btn--danger' : '');
    confirmBtn.textContent = options.confirmLabel || t('panel_dialog_save');
    actions.append(cancelBtn, confirmBtn);
    card.appendChild(actions);
    overlay.appendChild(card);

    const close = (result) => {
      doc.removeEventListener('keydown', onKeydown, true);
      overlay.remove();
      resolve(result);
    };
    const onKeydown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        close(null);
        return;
      }
      if (event.key === 'Enter' && (event.target === inputEl || event.target === confirmBtn)) {
        event.preventDefault();
        event.stopPropagation();
        close(inputEl ? inputEl.value : true);
        return;
      }
      if (event.key === 'Tab') {
        const focusables = [inputEl, cancelBtn, confirmBtn].filter(Boolean);
        const idx = focusables.indexOf(doc.activeElement);
        const next = idx === -1 ? 0 : (idx + (event.shiftKey ? -1 : 1) + focusables.length) % focusables.length;
        event.preventDefault();
        event.stopPropagation();
        focusables[next].focus();
      }
    };
    overlay.addEventListener('mousedown', (event) => {
      if (event.target === overlay) close(null);
    });
    cancelBtn.addEventListener('click', () => close(null));
    confirmBtn.addEventListener('click', () => close(inputEl ? inputEl.value : true));
    doc.addEventListener('keydown', onKeydown, true);

    doc.body.appendChild(overlay);
    try {
      if (inputEl) {
        inputEl.focus();
        inputEl.select();
      } else {
        confirmBtn.focus();
      }
    } catch (_e) { /* noop */ }
  });
}

async function renameEntry(entry) {
  const next = await showPanelDialog({
    title: t('panel_dialog_rename_title'),
    inputValue: entry.label || '',
    confirmLabel: t('panel_dialog_save')
  });
  if (next == null) return;
  const label = String(next).trim();
  if (!label || label === entry.label) return;
  entry.label = label;
  entry.title = label;
  await persistFavorites();
  renderLists();
  setNoticeKey('panel_notice_updated');
}

async function confirmDeleteEntry(entry) {
  const ok = await showPanelDialog({
    title: t('panel_dialog_delete_title'),
    message: t('panel_dialog_delete_message', { label: entry.label || '' }),
    confirmLabel: t('panel_dialog_delete_confirm'),
    danger: true
  });
  if (!ok) return;
  state.favorites = state.favorites.filter((item) => item.id !== entry.id);
  reindexOrders();
  await persistFavorites();
  state.badgeStatus.delete(entry.id);
  if (removeWatchlistCountCacheValue(entry.id)) {
    saveWatchlistCountCache().catch(() => {});
    renderWatchlistUpdatedLabel();
  }
  renderLists();
}

async function togglePin(id, pinned) {
  const entry = state.favorites.find((item) => item.id === id);
  if (!entry) return;
  entry.pinned = pinned;
  if (pinned) {
    const max = Math.max(-1, ...state.favorites.filter((item) => item.pinned).map((item) => item.order ?? 0));
    entry.order = max + 1;
  } else {
    const max = Math.max(-1, ...state.favorites.filter((item) => !item.pinned).map((item) => item.order ?? 0));
    entry.order = max + 1;
  }
  reindexOrders();
  await persistFavorites();
  renderLists();
}

function reindexOrders() {
  const pinned = state.favorites.filter((item) => item.pinned).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  pinned.forEach((item, index) => { item.order = index; });
  const normal = state.favorites.filter((item) => !item.pinned).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  normal.forEach((item, index) => { item.order = index; });
}

async function persistFavorites() {
  const saved = await saveFavoritesWithStaleGuard(state.favorites, {
    source: 'persist_favorites'
  });
  if (!saved.ok) return;
  renderLists();
}

function handleDragStart(event) {
  const li = event.currentTarget;
  const id = li.dataset.id;
  if (!id) return;
  state.dragging = { id, pinned: li.dataset.pinned === 'true' };
  li.classList.add('is-dragging');
  event.dataTransfer.effectAllowed = 'move';
}

function handleDragOver(event) {
  if (!state.dragging) return;
  const li = event.currentTarget;
  if (li.dataset.pinned !== String(state.dragging.pinned)) return;
  event.preventDefault();
  const rect = li.getBoundingClientRect();
  const before = event.clientY < rect.top + rect.height / 2;
  li.classList.toggle('drop-before', before);
  li.classList.toggle('drop-after', !before);
}

function handleDragLeave(event) {
  event.currentTarget.classList.remove('drop-before', 'drop-after');
}

function handleDrop(event) {
  if (!state.dragging) return;
  const target = event.currentTarget;
  if (target.dataset.pinned !== String(state.dragging.pinned)) return;
  event.preventDefault();
  const rect = target.getBoundingClientRect();
  const before = event.clientY < rect.top + rect.height / 2;
  target.classList.remove('drop-before', 'drop-after');
  reorderWithinGroup(state.dragging.id, target.dataset.id, before, state.dragging.pinned);
}

function handleDragEnd(event) {
  event.currentTarget.classList.remove('is-dragging', 'drop-before', 'drop-after');
  state.dragging = null;
}

async function reorderWithinGroup(sourceId, targetId, before, pinned) {
  if (!sourceId || !targetId || sourceId === targetId) return;
  const subset = state.favorites.filter((item) => item.pinned === pinned).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const movingIndex = subset.findIndex((item) => item.id === sourceId);
  const targetIndex = subset.findIndex((item) => item.id === targetId);
  if (movingIndex === -1 || targetIndex === -1) return;
  const [moving] = subset.splice(movingIndex, 1);
  const insertIndex = before ? targetIndex : targetIndex + 1;
  subset.splice(insertIndex > subset.length ? subset.length : insertIndex, 0, moving);
  subset.forEach((item, index) => {
    item.order = index;
  });
  await persistFavorites();
}

function handleFilterKeydown(event) {
  if (isEditableTarget(event.target) && event.target !== els.filter) {
    return;
  }
  if (event.key === 'Enter' && isImeComposing(event)) {
    return;
  }
  if (event.key === 'Enter') {
    event.preventDefault();
    openSelection();
  } else if (event.key === 'ArrowDown') {
    event.preventDefault();
    moveSelection(1);
  } else if (event.key === 'ArrowUp') {
    event.preventDefault();
    moveSelection(-1);
  } else if (event.key === 'Escape') {
    event.preventDefault();
    els.filter.value = '';
    applyFilterText('');
  }
}

function disposeRecordPins() {
  if (recordPinState.controller?.dispose) {
    recordPinState.controller.dispose();
  }
  recordPinState.controller = null;
}

function applyRecordPinVisibility(visible) {
  const flag = Boolean(visible);
  recordPinState.visible = flag;
  if (els.recordPinSection) {
    els.recordPinSection.classList.toggle('hidden', !flag);
  }
  if (!els.recordPinSection) return;
  if (flag) {
    if (!recordPinState.controller) {
      recordPinState.controller = initPins({ translate: t });
    }
    setRecordPinsCollapsed(state.recordPinsCollapsed, { persist: false });
  } else {
    disposeRecordPins();
    renderCollapsedSectionsTray();
  }
}

async function initializeRecordPins() {
  if (!els.recordPinSection) return;
  try {
    const visible = await loadRecordPinVisibility();
    applyRecordPinVisibility(visible);
  } catch (error) {
    console.error('Failed to load record pin visibility', error);
    applyRecordPinVisibility(true);
  }
}

function focusFilterSoon() {
  if (!els.filter || !state.filterPanelVisible) return;
  setTimeout(() => {
    try {
      els.filter.focus();
      els.filter.select();
    } catch (_err) {
      // ignore
    }
  }, 50);
}

function wireEvents() {
  setFilterPanelVisible(false);
  setSettingsMenuOpen(false);
  ensureRecentCollapseControl();
  ensureCollapsedSectionsTray();
  renderHostOnboarding();
  setRecordPinsCollapsed(state.recordPinsCollapsed, { persist: false });
  setWatchlistCollapsed(state.pinsOnly, { persist: false, source: 'wire_events_init' });
  setRecentRecordsCollapsed(state.recentRecordsCollapsed, { persist: false });
  els.toggleShortcuts?.classList.add('collapse-btn');
  els.toggleRecordPins?.classList.add('collapse-btn');
  els.togglePinsOnlyIcon?.classList.add('collapse-btn');
  els.toggleRecentRecords?.classList.add('collapse-btn');
  ensureAppSearchUi();
  if (els.pinList && !state.pinListObserver) {
    state.pinListObserver = new MutationObserver(() => {
      if (state.recordPinsCollapsed) {
        renderCollapsedSectionsTray();
      }
      applySearchVisibility();
    });
    state.pinListObserver.observe(els.pinList, { childList: true, subtree: false });
  }
  if (els.filter) {
    els.filter.placeholder = t('panel_search_placeholder');
  }
  els.hostOnboardingAllow?.addEventListener('click', () => {
    handleHostOnboardingAllow().catch((error) => {
      console.error('Failed to request host permission from onboarding', error);
      setNoticeKey('panel_notice_permission_cancelled');
    });
  });
  els.hostOnboardingOpenSettings?.addEventListener('click', () => {
    openOptionsPage();
  });
  els.hostOnboardingLater?.addEventListener('click', () => {
    dismissHostOnboarding().catch(() => {});
  });
  els.toggleFilterPanel?.addEventListener('click', () => {
    const next = !state.filterPanelVisible;
    setFilterPanelVisible(next, { focus: next });
  });
  els.openExcelOverlay?.addEventListener('click', () => {
    openOverlayFromSidePanel().catch(() => {
      setNoticeKey('panel_notice_overlay_open_failed');
    });
  });
  els.openExcelOverlay?.addEventListener('mouseenter', () => {
    refreshOverlayLaunchState().catch(() => {});
  });
  els.openExcelOverlay?.addEventListener('focus', () => {
    refreshOverlayLaunchState().catch(() => {});
  });
  els.filter?.addEventListener('input', (event) => applyFilterText(event.target.value));
  els.filter?.addEventListener('keydown', handleFilterKeydown);
  els.clearFilter?.addEventListener('click', () => {
    if (els.filter) {
      els.filter.value = '';
      applyFilterText('');
      els.filter.focus();
    }
  });
  els.togglePinsOnly?.addEventListener('change', (event) => {
    setWatchlistCollapsed(Boolean(event.target.checked), { source: 'watchlist_toggle' });
    syncSelectionState();
    highlightSelection();
  });
  els.refreshCounts?.addEventListener('click', () => {
    requestWatchListReconcile('manual', {
      source: 'watchlist_refresh_button',
      ignoreCooldown: true
    }).catch(() => {});
  });
  els.quickAdd?.addEventListener('click', () => quickAddFromActiveTab());
  els.toggleRecordPins?.addEventListener('click', () => {
    setRecordPinsCollapsed(!state.recordPinsCollapsed);
  });
  els.toggleRecentRecords?.addEventListener('click', () => {
    setRecentRecordsCollapsed(!state.recentRecordsCollapsed);
  });
  els.openOptions?.addEventListener('click', () => {
    setSettingsMenuOpen(!state.settingsMenuOpen);
  });
  els.openOptionsPageMenuItem?.addEventListener('click', () => {
    setSettingsMenuOpen(false);
    openOptionsPage();
  });
  els.openManualMenuItem?.addEventListener('click', () => {
    setSettingsMenuOpen(false);
    openManualPage().catch((error) => {
      console.error('Failed to open manual page', error);
    });
  });
  els.openCheatsheet?.addEventListener('click', () => {
    showShortcutCheatsheetInActiveTab().catch(() => {});
  });
  els.panelTourDismiss?.addEventListener('click', () => {
    dismissPanelTour().catch(() => {});
  });
  els.panelTourAddView?.addEventListener('click', () => quickAddFromActiveTab());
  els.panelTourOpenOverlay?.addEventListener('click', () => {
    openOverlayFromSidePanel().catch(() => {});
  });
  els.panelTourShowKeys?.addEventListener('click', () => {
    showShortcutCheatsheetInActiveTab().catch(() => {});
  });
  els.recentClear?.addEventListener('click', () => {
    clearRecentRecords().catch(() => {});
  });
  if (els.toggleShortcuts) {
    const handler = () => {
      toggleShortcutVisibility().catch(() => {});
    };
    els.toggleShortcuts.addEventListener('click', handler);
    state.shortcutToggleHandler = handler;
  }
  if (!state.watchlistFocusHandler) {
    state.watchlistFocusHandler = () => {
      state.watchlistWindowFocused = true;
      requestWatchListResumeCatchup('window_focus').catch(() => {});
    };
    window.addEventListener('focus', state.watchlistFocusHandler);
  }
  if (!state.watchlistBlurHandler) {
    state.watchlistBlurHandler = () => {
      state.watchlistWindowFocused = false;
      syncWatchlistAutoRefreshTimer('window_blur').catch(() => {});
    };
    window.addEventListener('blur', state.watchlistBlurHandler);
  }
  if (!state.watchlistVisibilityChangeHandler) {
    state.watchlistVisibilityChangeHandler = () => {
      if (document.visibilityState === 'visible') {
        state.watchlistWindowFocused = typeof document.hasFocus === 'function'
          ? Boolean(document.hasFocus())
          : true;
        requestWatchListResumeCatchup('visibilitychange_visible').catch(() => {});
      } else {
        state.watchlistWindowFocused = false;
        syncWatchlistAutoRefreshTimer('visibility_hidden').catch(() => {});
      }
    };
    document.addEventListener('visibilitychange', state.watchlistVisibilityChangeHandler);
  }
  if (!state.watchlistTabActivatedHandler && chrome?.tabs?.onActivated?.addListener) {
    state.watchlistTabActivatedHandler = () => {
      requestWatchListResumeCatchup('tabs.onActivated').catch(() => {});
    };
    chrome.tabs.onActivated.addListener(state.watchlistTabActivatedHandler);
  }
  if (!state.watchlistPointerEnterHandler) {
    state.watchlistPointerEnterHandler = () => {
      requestWatchListResumeCatchup('sidepanel_pointerenter').catch(() => {});
    };
    document.addEventListener('pointerenter', state.watchlistPointerEnterHandler, true);
    document.addEventListener('mouseenter', state.watchlistPointerEnterHandler, true);
  }
  if (!state.watchlistClickHandler) {
    state.watchlistClickHandler = () => {
      requestWatchListResumeCatchup('sidepanel_click').catch(() => {});
    };
    document.addEventListener('click', state.watchlistClickHandler, true);
  }
  if (!state.settingsMenuOutsideHandler) {
    state.settingsMenuOutsideHandler = (event) => {
      if (!state.settingsMenuOpen) return;
      const target = event.target;
      if (els.settingsMenu?.contains(target) || els.openOptions?.contains(target)) return;
      setSettingsMenuOpen(false);
    };
    document.addEventListener('mousedown', state.settingsMenuOutsideHandler);
  }
}

function dispose() {
  state.watchlistPanelMounted = false;
  state.watchlistLifecycleToken += 1;
  state.watchlistLastResumeEventAt = 0;
  state.watchlistResumeSourceAt.clear();
  state.watchlistSectionSync.activeRequestId = '';
  if (state.pendingHostCacheRefreshTimerId) {
    window.clearTimeout(state.pendingHostCacheRefreshTimerId);
    state.pendingHostCacheRefreshTimerId = 0;
  }
  if (state.noticeTimerId) {
    window.clearTimeout(state.noticeTimerId);
    state.noticeTimerId = 0;
  }
  state.pendingHostCacheRefreshHosts.clear();
  detachStorageListener();
  if (state.runtimeListener && chrome?.runtime?.onMessage) {
    chrome.runtime.onMessage.removeListener(state.runtimeListener);
    state.runtimeListener = null;
  }
  stopWatchlistAutoRefreshTimer();
  if (state.watchlistFocusHandler) {
    window.removeEventListener('focus', state.watchlistFocusHandler);
    state.watchlistFocusHandler = null;
  }
  if (state.watchlistBlurHandler) {
    window.removeEventListener('blur', state.watchlistBlurHandler);
    state.watchlistBlurHandler = null;
  }
  if (state.watchlistVisibilityChangeHandler) {
    document.removeEventListener('visibilitychange', state.watchlistVisibilityChangeHandler);
    state.watchlistVisibilityChangeHandler = null;
  }
  if (state.watchlistTabActivatedHandler && chrome?.tabs?.onActivated?.removeListener) {
    chrome.tabs.onActivated.removeListener(state.watchlistTabActivatedHandler);
    state.watchlistTabActivatedHandler = null;
  }
  if (state.watchlistPointerEnterHandler) {
    document.removeEventListener('pointerenter', state.watchlistPointerEnterHandler, true);
    document.removeEventListener('mouseenter', state.watchlistPointerEnterHandler, true);
    state.watchlistPointerEnterHandler = null;
  }
  if (state.watchlistClickHandler) {
    document.removeEventListener('click', state.watchlistClickHandler, true);
    state.watchlistClickHandler = null;
  }
  disposeRecordPins();
  if (state.pinListObserver) {
    state.pinListObserver.disconnect();
    state.pinListObserver = null;
  }
  if (els.appSearchToggle && state.appSearchToggleHandler) {
    els.appSearchToggle.removeEventListener('click', state.appSearchToggleHandler);
    state.appSearchToggleHandler = null;
  }
  if (els.appSearchInput && state.appSearchInputHandler) {
    els.appSearchInput.removeEventListener('input', state.appSearchInputHandler);
    state.appSearchInputHandler = null;
  }
  if (els.appSearchInput && state.appSearchInputKeydownHandler) {
    els.appSearchInput.removeEventListener('keydown', state.appSearchInputKeydownHandler);
    state.appSearchInputKeydownHandler = null;
  }
  if (state.appSearchOutsideHandler) {
    document.removeEventListener('mousedown', state.appSearchOutsideHandler);
    state.appSearchOutsideHandler = null;
  }
  if (state.settingsMenuOutsideHandler) {
    document.removeEventListener('mousedown', state.settingsMenuOutsideHandler);
    state.settingsMenuOutsideHandler = null;
  }
  if (els.toggleShortcuts && state.shortcutToggleHandler) {
    els.toggleShortcuts.removeEventListener('click', state.shortcutToggleHandler);
    state.shortcutToggleHandler = null;
  }
}

async function init() {
  state.watchlistPanelMounted = true;
  state.watchlistLifecycleToken += 1;
  state.watchlistLastResumeEventAt = 0;
  state.watchlistResumeSourceAt.clear();
  state.watchlistSectionSync.activeRequestId = '';
  await initializeI18n();
  await loadWatchlistLimit();
  await loadShortcutSearchOpenMode();
  await loadCollapsedSectionsState();
  await loadWatchlistRefreshPreset();
  await loadWatchlistCountCache();
  await loadPanelTourDismissed();
  initPanelTabs();
  wireEvents();
  attachStorageListener();
  attachRuntimeListener();
  await refreshHostOnboarding();
  await initializeRecordPins();
  await refreshShortcutEntries();
  await loadRecentAndRender();
  await loadFavoritesAndRender();
  await refreshOverlayLaunchState();
  focusFilterSoon();
}

init().catch((error) => {
  console.error('Failed to initialize launcher', error);
  setNoticeKey('panel_notice_initialization_failed');
});

window.addEventListener('beforeunload', dispose);
