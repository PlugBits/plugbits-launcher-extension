# E2E テスト

Playwright（ヘッドレスChromium）でサイドパネル・コマンドパレット・設定画面を検証します。
`chrome.*` API は `helpers/chrome-stub.mjs` のスタブに置き換え、`src/` を静的サーバで配信して実行します。

## 実行

```bash
npm install          # 初回のみ（playwright を導入）
npx playwright install chromium   # 初回のみ（ブラウザ本体）
npm test             # 全スイート実行
node tests/run-all.mjs palette    # 名前でフィルタ
```

Chromium のパスを固定したい環境では `PB_TEST_CHROMIUM=/path/to/chromium npm test`。

## スイート

| ファイル | 内容 |
|---|---|
| `sidepanel.test.mjs` | ウォッチリスト行のホバー操作（固定切替・名前変更・削除、ダイアログのEsc/確定） |
| `palette.test.mjs` | コマンドパレットのi18n切替・ARIA・Tabフォーカストラップ、チートシートの開閉全経路 |
| `palette-settings.test.mjs` | コマンドパレット: 拡張機能設定ジャンプコマンド・フィールド一覧コピーのアプリID行 |
| `trial.test.mjs` | 14日トライアルの開始フロー（`/trial` をモック。不正メール拒否・即時有効化・状態表示） |
| `options-api-usage.test.mjs` | 設定画面のAPI使用量表示 |
| `api-usage-tracking.test.mjs` | API使用量トラッキング |

### Excel Overlay E2E

chrome-stub + Proライセンス投入 + route偽装(demo.cybozu.com偽装) + permission-service.js/
pro-service.js/content.jsをmanifest順に注入 + Ctrl+Shift+Eで起動、というフル起動の系。
共通ボイラープレートは `helpers/overlay-page.mjs`(`openOverlay`/`openOverlayContext`)に
まとまっており、page-bridge.js の応答内容(fields/records/各種ハンドラ)はテストごとに
固有性が高いため各テストファイルが持つ。

| ファイル | 内容 |
|---|---|
| `overlay-lookup-grid.test.mjs` | ルックアップキー列編集・候補操作・保存・一括再取得・救済リトライ |
| `lookup-cache-e2e.test.mjs` | ルックアップ候補の3階層キャッシュ（頻出/タブキャッシュ/再読込） |
| `dblclick-blur.test.mjs` | 別セルのblurがダブルクリック編集を巻き込んで終了させるバグの回帰 |
| `newrow-defaults-e2e.test.mjs` | 新規行の初期値プレフィル・サブテーブル空行POST |
| `toolbar-menu.test.mjs` | ツール▾メニュー(列順/再計算/ルックアップ再取得の集約) |
| `grid-kbd-hostile.test.mjs` | 敵対的captureリスナー下での候補キー操作 |
| `picker-layout.test.mjs` | 頻出セクションのリスト内統合・ハイライト視認性 |
| `paste-verify-e2e.test.mjs` | 貼り付けルックアップ照合・タイプ先行時のAPI削減 |
| `verify-all-paths.test.mjs` | ルックアップ照合の全経路（ピッカー/頻出/手打ち/貼り付け）・赤/緑表示 |
| `type-replace-firstchar.test.mjs` | type-to-replaceの1文字目消失バグの回帰 |

### Quick New Record (QNR) E2E

chrome-stub + route偽装 + content.js注入 + Shift+Alt+Nで起動。Standardモードでも使える
ためProライセンスもpermission-service.js/pro-service.jsも不要(`helpers/overlay-page.mjs`の
`openQnr`/`openQnrContext`)。

| ファイル | 内容 |
|---|---|
| `qnr-lookup-combo.test.mjs` | 候補コンボボックス（全件ローカル/サーバー検索モード） |
| `qnr-lookup-kbd.test.mjs` | キーボード操作＋🔍ボタン直後の即時操作 |
| `qnr-modal-flow.test.mjs` | モーダル基本フロー（必須/サーバーエラー・保存して次へ・破棄確認・Ctrl+Enter） |

### 単体テスト(抽出パターン)

content.js / page-bridge.js から対象の関数・メソッドを文字列として切り出し、ブレース深度
カウントで本体を抽出してevalし、純関数として直接検証する系。共通の抽出ユーティリティは
`helpers/extract-src.mjs`、actual/expected比較は `helpers/assert.mjs` の `checkEqual`。

| ファイル | 内容 |
|---|---|
| `overlay-lookup-unit.test.mjs` | 権限ゲート・ルックアップ再取得ターゲット構築・エラーindex解析 |
| `lookup-cache-unit.test.mjs` | ルックアップキャッシュのTTL/LRU・頻度集計 |
| `newrow-defaults-unit.test.mjs` | resolveFieldDefaultValue（新規行初期値）のマトリクス |
| `paste-verify-unit.test.mjs` | verifyLookupValuesExist・in句クエリ組み立て |
| `overlay-quality-unit.test.mjs` | validate()のNUMBER正規化・collectSaveErrorTargets() |

## 注意

- スタブの `storage.get/set` は必ずディープコピーを返すこと（実際の chrome.storage と同じ挙動。
  参照を共有すると launcher の鮮度ガードが誤検知します）。
- テストデータは各スイートが独立して持つため、実行順に依存しません。
- Excel Overlay / QNR 系はブラウザコンテキストを都度 `browser.newContext()` で作るため、
  各テストは `try/finally` で必ず `ctx.close()` すること（リーク防止）。
