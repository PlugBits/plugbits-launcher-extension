# Chrome Web Store 掲載文言 v3.0.0（アップデート申請用）

ダッシュボードの各フィールドにそのまま貼り付けられる形式です。
Chrome Web Store の説明欄はプレーンテキスト表示のため、記号（■・◦）で整形しています。

---

## 1. 基本情報

| フィールド | 内容 |
|---|---|
| 名前 | PlugBits Launcher for kintone |
| カテゴリ | 仕事効率化 (Productivity) |
| バージョン | 3.0.0 |

### 簡単な説明（132文字以内 / ja）

```
kintoneを高速化するランチャー。サイドパネル・ビュー件数ウォッチ・レコードピン・コマンドパレット。Proなら一覧をExcelのように編集。14日間無料トライアル対応。
```

### Summary（English）

```
Speed up kintone: side-panel launcher, view-count watch, record pins, command palette. Pro edits list views like Excel. 14-day free trial.
```

---

## 2. 詳細説明（ja）

```
PlugBits Launcher は、kintone の日常操作を高速化する Chrome 拡張です。
サイドパネルのランチャーと Excel ライクな一覧編集で、画面遷移と繰り返し作業を減らします。

━━━━━━━━━━━━━━━━━━━━
主な機能
━━━━━━━━━━━━━━━━━━━━

■ サイドパネルランチャー
よく使うアプリ・ビューをワンクリックで開ける作業ハブ。
◦ カテゴリ分け・ピン留め・検索・キーボード並び替え（Alt+↑↓）
◦ WatchList: 登録したビューの件数をバッジ表示。しきい値を超えたらデスクトップ通知（任意）
◦ Record Pin: 重要なレコードをコメント付きで固定（API消費ゼロ・ローカル保存）
◦ Recent Records: 最近開いたレコードを自動記録

■ Excel Overlay（Pro）
kintone の一覧を Excel のような表形式で開いて、セルを直接編集・保存。
◦ セル編集・Excelからの貼り付け・入力即置換・一括保存（Pro限定）
◦ ルックアップ列も直接編集: 候補ピッカー・手入力・貼り付けに対応。参照先と自動照合し、一致は緑・不一致は赤で保存前にわかります
◦ ルックアップ一括再取得・計算フィールドの再計算ボタン（表示中ページ／アプリ全体を選択）
◦ 行追加時に kintone の初期値（文字・数値・選択肢・日付）を自動セット
◦ 日付のスマート入力（t=今日、+3=3日後、end=月末 など）
◦ 列レイアウトのプリセット保存、サブテーブル編集、ページ送り
◦ Free版でも表示・フィルタ・ソート・範囲選択・コピーは無料でご利用いただけます
◦ ショートカット: Ctrl+Shift+E

■ コマンドパレット（Ctrl+/）
移動・新規作成・URLコピーなどをキーボードだけで実行。
「?」キーでショートカット一覧（チートシート）を表示。

■ クイック新規レコード（Shift+Alt+N）
一覧画面から離れずにレコードを追加。保存後も元のスクロール位置を保持。
ルックアップは候補から選択も手入力もでき、候補はタブ内キャッシュで API 消費を節約します。

■ クイックランチャードック
kintone ページの隅に小さな起動ドックを表示（ワンクリックで非表示にできます）。

■ API 使用量モニター
kintone REST API の使用状況を Today / 7日 / 30日 で可視化。
拡張自体も API 消費を最小化した設計です（Record Pin・Recent Records は API 0）。

■ そのほか
◦ 日本語 / 英語 UI
◦ ダークモード対応
◦ キーボード操作・スクリーンリーダーに配慮したアクセシビリティ

━━━━━━━━━━━━━━━━━━━━
Free と Pro
━━━━━━━━━━━━━━━━━━━━

Free: ランチャー・WatchList・Record Pin・コマンドパレット・Excel Overlay（表示・フィルタ・ソート・コピー）
Pro（¥980/月）: Excel Overlay でのセル編集・貼り付け・一括保存

Pro は 14日間の無料トライアルに対応。
メールアドレスを入力するだけで、その場で全機能を試せます（クレジットカード不要）。

━━━━━━━━━━━━━━━━━━━━
プライバシーと権限
━━━━━━━━━━━━━━━━━━━━

◦ お気に入り・設定・キャッシュはすべてブラウザ内（chrome.storage）に保存されます
◦ 外部送信は Pro ライセンス認証／トライアル開始時のメールアドレスとライセンスキーのみ（api.plugbits.app）
◦ kintone ドメインへのアクセス権限は「オプション」です。あなたが明示的に許可したドメインでのみ動作します
◦ デスクトップ通知の権限は、WatchList のしきい値通知を設定したときに初めて要求されます

対応ページ: レコード一覧 / 詳細 / 編集 / 作成
対応サービス: kintone（kintone.com / cybozu.com）
```

---

## 3. 「このバージョンの新機能」段落（詳細説明の冒頭に置く用）

```
【v3.0 の新機能】
◦ デザインを全面刷新（ダークモード対応・視認性の高い新アイコン・英語 UI）
◦ Excel Overlay: ルックアップ列の直接編集に対応（候補ピッカー・手入力・貼り付け）。
　入力値を参照先と自動照合し、一致は緑・不一致は赤で保存前に表示
◦ ルックアップ一括再取得・計算フィールドの再計算ボタン（表示中ページ／アプリ全体）
◦ 行追加時に kintone のフィールド初期値を自動セット
◦ Excel Overlay: 入力即置換・Delete で範囲クリア・未保存ガード・ツールメニューなど操作性向上
◦ クイック新規レコード（Shift+Alt+N）とクイックランチャードック
◦ コマンドパレットのチートシート（? キー）・拡張機能設定ジャンプ・フィールド一覧コピー
◦ WatchList しきい値通知: 件数が設定値を超えたらデスクトップ通知（任意・実行時許可）
◦ Pro の 14日間無料トライアル（メールだけで開始・クレカ不要）
◦ ルックアップ候補のタブ内キャッシュ等、API 消費を最小化する改善
◦ 多数の不具合修正と安定性向上
```

---

## 4. Detailed description（English）

```
PlugBits Launcher speeds up your everyday kintone work.
A side-panel launcher and Excel-like list editing cut down page navigation and repetitive tasks.

━━━━━━━━━━━━━━━━━━━━
Features
━━━━━━━━━━━━━━━━━━━━

■ Side-panel launcher
One-click access to your frequently used apps and views.
◦ Categories, pinning, search, keyboard reordering (Alt+↑/↓)
◦ WatchList: shows record counts of registered views as badges, with optional desktop notifications when a threshold is exceeded
◦ Record Pin: keep important records at hand with comments (zero API calls, stored locally)
◦ Recent Records: automatic history of recently opened records

■ Excel Overlay (Pro)
Open any kintone list view as an Excel-like grid and edit cells in place.
◦ Cell editing, pasting from Excel, type-to-replace, bulk save (Pro only)
◦ Edit lookup columns directly — pick from suggestions, type or paste; values are checked against the source app before saving (green = match, red = not found)
◦ Bulk lookup refresh & calc-field recalculation (current page or entire app)
◦ New rows are pre-filled with kintone's default field values
◦ Smart date input (t = today, +3 = in 3 days, end = end of month, ...)
◦ Column layout presets, subtable editing, paging
◦ Free plan already includes viewing, filtering, sorting, range selection and copy
◦ Shortcut: Ctrl+Shift+E

■ Command palette (Ctrl+/)
Navigate, create records, and copy URLs from the keyboard.
Press "?" for the shortcut cheat sheet.

■ Quick new record (Shift+Alt+N)
Add a record without leaving the list view; your scroll position is preserved.
Lookup fields support both suggestions and manual input, with in-tab caching to save API calls.

■ Quick launcher dock
A small dock in the corner of kintone pages (can be hidden in one click).

■ API usage monitor
Visualize kintone REST API usage for Today / 7 days / 30 days.
The extension itself is designed to minimize API consumption.

■ And more
◦ Japanese / English UI
◦ Dark mode
◦ Keyboard and screen-reader friendly

━━━━━━━━━━━━━━━━━━━━
Free vs Pro
━━━━━━━━━━━━━━━━━━━━

Free: launcher, WatchList, Record Pin, command palette, Excel Overlay (view, filter, sort, copy)
Pro (JPY 980/month): cell editing, pasting and bulk save in Excel Overlay

Pro offers a 14-day free trial — just enter your email address.
No credit card required.

━━━━━━━━━━━━━━━━━━━━
Privacy & permissions
━━━━━━━━━━━━━━━━━━━━

◦ Favorites, settings and caches are stored inside your browser (chrome.storage)
◦ The only external communication is your email address / license key sent to api.plugbits.app when activating Pro or starting a trial
◦ Access to kintone domains is an OPTIONAL permission — the extension only works on domains you explicitly allow
◦ Notification permission is requested only when you set up a WatchList threshold alert

Works on: record list / detail / edit / create pages
Service: kintone (kintone.com / cybozu.com)
```

---

## 5. 審査用: 権限の使用目的（Privacy practices タブ）

各権限の「justification」欄にそのまま使えます（英語推奨のため英語で用意、日本語併記）。

| 権限 | Justification (EN) | 説明 (ja) |
|---|---|---|
| storage | Stores the user's favorites, watch list, pinned records, UI settings and metadata caches locally. Nothing is synced to external servers. | お気に入り・WatchList・ピン・設定・メタデータキャッシュのローカル保存 |
| scripting | Injects the launcher dock, command palette and Excel-like overlay into kintone pages after the user grants optional host permission. | ユーザーがホスト権限を許可した kintone ページへ機能 UI を注入 |
| tabs | Detects open kintone tabs to open/focus the right tab from the launcher and to fetch view counts through an existing kintone session. | ランチャーからの適切なタブ起動と、既存 kintone タブ経由の件数取得 |
| alarms | Periodically refreshes WatchList view counts and checks user-defined thresholds in the background. | WatchList 件数の定期更新としきい値チェック |
| contextMenus | Adds a right-click menu item to register the current kintone page to the launcher. | 現在のページをランチャーへ登録する右クリックメニュー |
| sidePanel | Provides the main launcher UI in Chrome's side panel. | サイドパネルにランチャー UI を表示 |
| notifications (optional) | Shows a desktop notification when a watched view's record count exceeds the threshold the user configured. Requested at runtime only when the user sets a threshold. | WatchList しきい値超過時のデスクトップ通知。しきい値設定時にのみ実行時要求 |
| optional host permissions (kintone.com / cybozu.com / kintone-dev.com) | All features operate on kintone pages only. Host access is optional and requested per domain with explicit user consent. | 全機能が kintone ページ専用。ドメインごとにユーザーの明示同意で要求 |

### Single purpose description

```
This extension has a single purpose: making kintone (a business app platform) faster to operate — quick navigation to apps/views/records via a side-panel launcher, and Excel-like viewing/editing of kintone list views.
```

### リモートコード

なし（Remote code: No）。すべてのスクリプトはパッケージに同梱。

### データ収集の申告（Data usage）

- 「個人を特定できる情報（メールアドレス）」= 収集する（Pro ライセンス認証・トライアル開始時のみ、認証目的）
- 用途: アカウント認証（ライセンス管理）のみ。第三者への販売・共有なし、信用情報・広告目的なし
- それ以外（閲覧履歴・ユーザーアクティビティ・位置情報など）= 収集しない
- ※ kintone 内の業務データは拡張のローカル処理のみで、外部送信されません

---

## 6. 審査への影響と提出手順メモ

1. **必須権限の追加なし** — 公開中の v2.0.0 と比べて追加した権限は `notifications` のみで、
   これは optional_permissions（しきい値通知を設定したときだけ実行時要求）のため、
   既存ユーザーの拡張が無効化される「再有効化警告」は発生しません。
   ホスト権限も従来どおりオプションのままです。
   ※ 公開中の 2.0.0 は旧世代のビルドで、本申請（v3.0.0）は開発版 v2.0/v2.1 相当の
   変更を統合したメジャーアップデートです。
2. **審査前に Cloudflare Worker を先にデプロイ**（`cd workers && npx wrangler deploy`）。
   トライアル API（api.plugbits.app/trial）が動いていないと、審査員がトライアル導線を
   試した場合にエラーになります。Brevo の送信元ドメイン認証も確認。
3. 提出 zip は `npm run build` の成果物（lucide.umd.js は除外済み）。
4. 審査員向けメモ（Review notes）例:

```
This major update (v3.0.0, first update since the currently published 2.0.0) adds:
- An optional desktop-notification feature: "notifications" is added as an OPTIONAL
  permission, requested at runtime only when the user sets a record-count threshold
  in the options page. No new REQUIRED permissions are added.
- A 14-day Pro trial: the user's email address is sent to our licensing API
  (https://api.plugbits.app) solely for license issuance and verification.
- Lookup-column editing in the Excel Overlay (a Pro feature): users can pick from
  suggestions fetched from the related kintone app, type manually, or paste values;
  the extension pre-validates values against the related app and shows a green/red
  indicator before saving.
- All kintone data continues to be processed locally in the browser. The only external
  communication is license/trial activation to https://api.plugbits.app.
- All features require the user to grant optional host permission for their own
  kintone domain first. Test account for kintone is available on request.
```
