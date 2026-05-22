# PlugBits API – Cloudflare Workers

## デプロイ手順

### 1. KV Namespace 作成

```bash
wrangler kv:namespace create LICENSES
wrangler kv:namespace create LICENSES --preview
```

出力された `id` と `preview_id` を `wrangler.toml` に記入。

### 2. Secrets 登録

```bash
wrangler secret put STRIPE_SECRET_KEY        # sk_live_...
wrangler secret put STRIPE_WEBHOOK_SECRET    # whsec_...
wrangler secret put BREVO_API_KEY            # xkeysib-...
wrangler secret put BREVO_SENDER_EMAIL       # no-reply@plugbits.app
wrangler secret put BREVO_SENDER_NAME        # PlugBits Launcher
```

### 3. wrangler.toml の ALLOWED_ORIGIN を設定

Chrome拡張のID を入れる（`chrome://extensions` で確認）:

```toml
[vars]
ALLOWED_ORIGIN = "chrome-extension://xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
```

### 4. デプロイ

```bash
cd workers
npx wrangler deploy
```

## エンドポイント

### POST /webhook

Stripe Webhook を受信。`STRIPE_WEBHOOK_SECRET` で署名検証後、KV を更新。

購読イベント:
- `checkout.session.completed` → UUIDv4 ライセンスキー発行 → KV保存 → Brevoメール送信
- `invoice.payment_succeeded` → KV の expiry 更新
- `invoice.payment_failed` → status を `past_due` に更新
- `customer.subscription.deleted` → status を `canceled` に更新

### GET /verify?key={licenseKey}

レスポンス（active時）:

```json
{
  "ok": true,
  "status": "active",
  "email": "user@example.com",
  "expiry": "2026-06-20T00:00:00Z",
  "stripe_customer_id": "cus_xxx",
  "stripe_subscription_id": "sub_xxx",
  "portal_url": "https://billing.stripe.com/session/..."
}
```

## KV スキーマ

Key: `lic_{licenseKey}`

```json
{
  "email": "user@example.com",
  "status": "active",
  "stripe_customer_id": "cus_xxx",
  "stripe_subscription_id": "sub_xxx",
  "expiry": "2026-06-20T00:00:00Z"
}
```

TTL: 86400秒（24h）、webhook 受信ごとにリセット。

## Stripe 設定

1. 商品「PlugBits Launcher Pro」（月額サブスク）を作成
2. Customer Portal を有効化
3. Webhook エンドポイント `https://api.plugbits.app/webhook` を追加
4. 購読イベント:
   - `checkout.session.completed`
   - `invoice.payment_succeeded`
   - `invoice.payment_failed`
   - `customer.subscription.deleted`
