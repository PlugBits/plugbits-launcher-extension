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
| `trial.test.mjs` | 14日トライアルの開始フロー（`/trial` をモック。不正メール拒否・即時有効化・状態表示） |

## 注意

- スタブの `storage.get/set` は必ずディープコピーを返すこと（実際の chrome.storage と同じ挙動。
  参照を共有すると launcher の鮮度ガードが誤検知します）。
- テストデータは各スイートが独立して持つため、実行順に依存しません。
