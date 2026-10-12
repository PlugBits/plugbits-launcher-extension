/**
 * PlugBits API – Cloudflare Workers
 *
 * Routes:
 *   POST /webhook       – Stripe webhook（署名検証 → KV更新 → Brevoメール）
 *   GET  /verify        – ライセンスキー認証（KVキャッシュ → Stripe確認）
 *                          ?product= を付けるkintoneプラグインは product不一致/domain不一致を追加で検証する
 *   POST /trial         – 14日トライアルキー発行（メール単位・即時有効）
 *                          body.product がkintone系プラグインの場合はドメイン単位の即時発行（メール確認無し）
 *   GET  /trial/verify  – トライアルのメール確認（48時間以内・後追い検証。kintone系は対象外）
 *
 * 2026-09-29 買い切り(¥1,980)に切り替え: Payment Link は mode=payment(サブスクリプション無し)。
 * checkout.session.completed の mode=payment でライセンスを発行(kind:'lifetime'・expiry 空)、
 * charge.refunded(全額)でそのライセンスを status:'refunded' にする。サブスクの分岐は旧契約用に残す。
 *
 * 2026-10-11 複数プロダクト対応: Grid Edit Pro（Chrome拡張）に加え、kintoneプラグイン3本
 * （サブテーブルギャラリー化・PlugBits ListKit・文字列条件分岐ビルダー）をこのWorker1本で束ねる。
 * レコードの `product` フィールドで判別する（無ければ grid-edit-pro とみなす・下記 productOf）。
 * kintone系は購入・トライアルの単位が「kintoneドメイン」なので、レコードに `domain` を持ち、
 * 最初の /verify でそのドメインに束縛する（ドメイン固定・移転不可）。
 *   trialdom_{product}_{domain} … kintone系トライアルの重複発行防止index → key
 */

const CORS_HEADERS = {
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age': '86400'
};

function corsHeaders(env) {
  return {
    ...CORS_HEADERS,
    'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN || '*'
  };
}

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...extraHeaders }
  });
}

// ── 対象プロダクト ───────────────────────────────────────────────────────────
// kind: 'extension' … Chrome拡張（Grid Edit Pro）。/verify・/trial に product を送らない旧クライアント
//       'kintone'   … kintoneプラグイン。kintone.proxy 経由で product・domain を送ってくる

const PRODUCTS = {
  'grid-edit-pro': { name: 'PlugBits Launcher Pro', kind: 'extension' },
  'kintone-gallery': { name: 'サブテーブルギャラリー化', kind: 'kintone' },
  'kintone-listkit': { name: 'PlugBits ListKit', kind: 'kintone' },
  'kintone-rule-builder': { name: '文字列条件分岐ビルダー', kind: 'kintone' },
  'kintone-excel-report': { name: 'Excel帳票一括生成', kind: 'kintone' },
  'kintone-signage': { name: 'AutoSignage', kind: 'kintone' }
};

// Payment Link(plink_…)→ product。Payment Link の metadata は Checkout Session に
// 引き継がれないことがある(2026-10-12 の本番購入で確認)ため、session.payment_link で判別する。
// 価格だけでは ¥3,980 が2本あり区別できない。ID は Stripe の管理画面の値(オケオ)。
// env.PAYMENT_LINK_PRODUCTS(JSON)があれば上書きで足す(テスト・一時的な追加用)。
const PAYMENT_LINK_PRODUCTS = {
  plink_1UPn9dPGpisACJ9dImrLfbzU: 'kintone-excel-report',
  plink_1UPnC3PGpisACJ9duHkE6TQZ: 'kintone-signage',
  plink_1UPnEBPGpisACJ9dykum0J5b: 'kintone-rule-builder',
  plink_1UPnGHPGpisACJ9dOZbMtypq: 'kintone-listkit',
  plink_1UPnHjPGpisACJ9d3lk2w77g: 'kintone-gallery'
};

function paymentLinkProducts(env) {
  let extra = {};
  try {
    if (env?.PAYMENT_LINK_PRODUCTS) extra = JSON.parse(env.PAYMENT_LINK_PRODUCTS);
  } catch (_err) {
    extra = {};
  }
  return { ...PAYMENT_LINK_PRODUCTS, ...extra };
}

// Checkout Session から product を決める: metadata.product → payment_link の対応表 → grid-edit-pro
function resolveCheckoutProduct(obj, env) {
  const metaProduct = obj?.metadata?.product;
  if (PRODUCTS[metaProduct]) return metaProduct;
  const linkProduct = paymentLinkProducts(env)[obj?.payment_link];
  if (PRODUCTS[linkProduct]) return linkProduct;
  return 'grid-edit-pro';
}

// レコードに product が無い(旧データ)場合は grid-edit-pro とみなす
function productOf(record) {
  return record?.product || 'grid-edit-pro';
}

// kintoneドメインの正規化: 小文字化 + スキーム/パス/ポート除去。
// xxx.cybozu.com 系サブドメインのみ許可し、裸のサフィックスや他ドメインは無効にする。
const KINTONE_DOMAIN_SUFFIXES = ['.cybozu.com', '.kintone.com', '.cybozu.cn', '.cybozu-dev.com', '.kintone-dev.com'];

function normalizeKintoneDomain(raw) {
  let s = String(raw || '').trim().toLowerCase();
  if (!s) return null;
  s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//, ''); // スキーム除去
  s = s.split(/[/?#]/)[0]; // パス・クエリ・フラグメント除去
  s = s.split(':')[0]; // ポート除去
  if (!s || !/^[a-z0-9.-]+$/.test(s)) return null;
  if (!KINTONE_DOMAIN_SUFFIXES.some((suffix) => s.endsWith(suffix))) return null;
  return s;
}

// ── KV ─────────────────────────────────────────────────────────────────────
//
// ライセンスレコードは明示的な削除以外では消えない(TTLなし)。有効性は
// status(active/past_due/canceled)フィールドで管理し、webhookイベントの
// 到着頻度(請求サイクルごと、月1回程度)に依存させない。以前はTTL付きで
// 書き込んでいたため、次の請求イベントが来るまでの間にレコードが自動失効し、
// 全ての契約者が購入後24〜48時間でPro判定に失敗する不具合があった。

const KV_PREFIX = 'lic_';

function kvKey(licenseKey) {
  return `${KV_PREFIX}${licenseKey}`;
}

async function kvGet(env, licenseKey) {
  try {
    const raw = await env.LICENSES.get(kvKey(licenseKey));
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (_err) {
    return null;
  }
}

async function kvSet(env, licenseKey, data) {
  await env.LICENSES.put(kvKey(licenseKey), JSON.stringify(data));
}

// ── subscription → licenseKey[] 逆引きindex ──────────────────────────────────
// webhook処理のたびに全ライセンスをlist走査しないための索引。
// index未整備の旧レコードのために、フォールバックとして従来のプレフィックス
// 走査も残し、見つかったキーはその場でindexへ登録する（読み時マイグレーション）。

const SUB_INDEX_PREFIX = 'sub_';

async function getKeysForSubscription(env, subscriptionId) {
  try {
    const raw = await env.LICENSES.get(SUB_INDEX_PREFIX + subscriptionId);
    if (raw) {
      const keys = JSON.parse(raw);
      if (Array.isArray(keys) && keys.length) return keys;
    }
  } catch (_err) { /* fall through */ }

  // フォールバック: 旧データ向けの全走査 + index構築
  const found = [];
  const list = await env.LICENSES.list({ prefix: KV_PREFIX });
  for (const key of list.keys) {
    const licenseKey = key.name.slice(KV_PREFIX.length);
    const record = await kvGet(env, licenseKey);
    if (record?.stripe_subscription_id === subscriptionId) found.push(licenseKey);
  }
  if (found.length) {
    await env.LICENSES.put(SUB_INDEX_PREFIX + subscriptionId, JSON.stringify(found));
  }
  return found;
}

async function addKeyToSubscriptionIndex(env, subscriptionId, licenseKey) {
  let keys = [];
  try {
    const raw = await env.LICENSES.get(SUB_INDEX_PREFIX + subscriptionId);
    if (raw) keys = JSON.parse(raw);
  } catch (_err) { /* ignore */ }
  if (!Array.isArray(keys)) keys = [];
  if (!keys.includes(licenseKey)) keys.push(licenseKey);
  await env.LICENSES.put(SUB_INDEX_PREFIX + subscriptionId, JSON.stringify(keys));
}

// ── payment_intent → licenseKey 逆引き(買い切り) ─────────────────────────────
// 返金(charge.refunded)でライセンスを探すため、と、webhook の再送で二重発行しないための索引。
const PI_INDEX_PREFIX = 'pi_';

async function getKeyForPaymentIntent(env, paymentIntentId) {
  return (await env.LICENSES.get(PI_INDEX_PREFIX + paymentIntentId)) || '';
}

async function updateRecordsForSubscription(env, subscriptionId, patch) {
  const keys = await getKeysForSubscription(env, subscriptionId);
  for (const licenseKey of keys) {
    const record = await kvGet(env, licenseKey);
    if (record) await kvSet(env, licenseKey, { ...record, ...patch });
  }
  return keys.length;
}

// ── Stripe ──────────────────────────────────────────────────────────────────

async function stripeRequest(env, path, method = 'GET', body = null) {
  const url = `https://api.stripe.com/v1${path}`;
  const opts = {
    method,
    headers: {
      Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    }
  };
  if (body) opts.body = body;
  const resp = await fetch(url, opts);
  return resp.json();
}

async function getSubscription(env, subscriptionId) {
  return stripeRequest(env, `/subscriptions/${subscriptionId}`);
}

async function getCustomer(env, customerId) {
  return stripeRequest(env, `/customers/${customerId}`);
}

// Stripe webhook 署名検証
async function verifyStripeSignature(env, rawBody, signatureHeader) {
  const secret = env.STRIPE_WEBHOOK_SECRET;
  if (!secret) throw new Error('STRIPE_WEBHOOK_SECRET not configured');

  const parts = signatureHeader.split(',');
  const tPart = parts.find((p) => p.startsWith('t='));
  const v1Part = parts.find((p) => p.startsWith('v1='));
  if (!tPart || !v1Part) throw new Error('Invalid Stripe-Signature header');

  const timestamp = tPart.slice(2);
  const expectedSig = v1Part.slice(3);
  const signedPayload = `${timestamp}.${rawBody}`;

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(signedPayload));
  const computed = Array.from(new Uint8Array(mac)).map((b) => b.toString(16).padStart(2, '0')).join('');

  if (computed !== expectedSig) throw new Error('Signature mismatch');

  // タイムスタンプが5分以上古い場合はリプレイ攻撃と見なす
  const tolerance = 300;
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > tolerance) {
    throw new Error('Request timestamp too old');
  }
}

// ── UUIDv4 ─────────────────────────────────────────────────────────────────

function generateLicenseKey() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant
  const hex = Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

// ── Trial ────────────────────────────────────────────────────────────────────
//
// 個人（メールアドレス）単位で14日トライアルを1回だけ発行する。
// キーは応答で即時返却して拡張内で自動有効化し、同時に確認リンク付きの
// メールを送る。48時間以内にリンクが開かれなければ /verify が
// trial_unverified を返してトライアルは停止する（後追い検証）。
//
// kintone系プラグインはメールアドレスを持たない（kintone.proxy 経由でメール確認が
// できない）ため、ドメイン単位で即時有効化するだけの別経路を用いる
// （handleKintoneTrialStart・email:'' のまま・確認メールは送らない）。
//
// KVレイアウト:
//   lic_{key}             … ライセンス本体（kind:'trial' を含む）
//   trial_{email}         … 正規化メール → key（Grid Edit Pro。重複取得の防止）
//   trialtok_{token}      … 確認トークン → key（確認後に削除）
//   trialdom_{product}_{domain} … kintone系: ドメイン単位の重複発行防止index → key

const TRIAL_EMAIL_PREFIX = 'trial_';
const TRIAL_TOKEN_PREFIX = 'trialtok_';
const KINTONE_TRIAL_DOMAIN_PREFIX = 'trialdom_';
const TRIAL_DURATION_MS = 14 * 24 * 60 * 60 * 1000;
const TRIAL_VERIFY_WINDOW_MS = 48 * 60 * 60 * 1000;

// メール正規化: 小文字化 + ローカル部の +エイリアス除去
function normalizeTrialEmail(raw) {
  const s = String(raw || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) return null;
  const at = s.lastIndexOf('@');
  const local = s.slice(0, at).split('+')[0];
  const domain = s.slice(at + 1);
  if (!local) return null;
  return `${local}@${domain}`;
}

// IP単位の簡易レート制限（KVのTTL付きカウンタ）。悪戯POSTによる
// KV書き込みとメール送信の浪費を防ぐ。
const TRIAL_RATE_LIMIT_PER_HOUR = 5;

async function isTrialRateLimited(request, env) {
  try {
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    const key = `ratelimit_trial_${ip}`;
    const current = Number(await env.LICENSES.get(key)) || 0;
    if (current >= TRIAL_RATE_LIMIT_PER_HOUR) return true;
    await env.LICENSES.put(key, String(current + 1), { expirationTtl: 3600 });
    return false;
  } catch (_err) {
    return false; // 制限機構の障害でトライアル自体を止めない
  }
}

// kintone系プラグインのドメイン単位レート制限（KVのTTL付きカウンタ）。
// kintone.proxy のリクエストは Cybozu 側の共有IPから来るため、IP単位の
// isTrialRateLimited は使えない（1社の乱打で全社が止まる）。
const KINTONE_TRIAL_RATE_LIMIT_PER_HOUR = 5;

async function isKintoneTrialRateLimited(env, product, domain) {
  try {
    const key = `ratelimit_ktrial_${product}_${domain}`;
    const current = Number(await env.LICENSES.get(key)) || 0;
    if (current >= KINTONE_TRIAL_RATE_LIMIT_PER_HOUR) return true;
    await env.LICENSES.put(key, String(current + 1), { expirationTtl: 3600 });
    return false;
  } catch (_err) {
    return false; // 制限機構の障害でトライアル自体を止めない
  }
}

// kintone系トライアル: メール確認は行わず、ドメイン単位で即時有効化する。
// 同じ product+domain からの再呼び出しは同じキーを reused:true で返す
// （拡張機能の初回アクセスを想定してキーを探しに来るケースも含む）。
async function handleKintoneTrialStart(env, product, body) {
  const domain = normalizeKintoneDomain(body?.domain);
  if (!domain) return json({ ok: false, reason: 'invalid_domain' }, 400);

  const indexKey = `${KINTONE_TRIAL_DOMAIN_PREFIX}${product}_${domain}`;
  const existingKey = await env.LICENSES.get(indexKey);
  if (existingKey) {
    const record = await kvGet(env, existingKey);
    if (record) {
      const expiryMs = Date.parse(record.expiry || '') || 0;
      const status = expiryMs && Date.now() > expiryMs ? 'trial_expired' : 'active';
      return json({ ok: status === 'active', license_key: existingKey, expiry: record.expiry, status, reused: true });
    }
  }

  if (await isKintoneTrialRateLimited(env, product, domain)) {
    return json({ ok: false, reason: 'rate_limited' }, 429);
  }

  const licenseKey = generateLicenseKey();
  const now = Date.now();
  const expiry = new Date(now + TRIAL_DURATION_MS).toISOString();
  const record = {
    email: '',
    status: 'active',
    kind: 'trial',
    product,
    domain,
    trial_verified: true,
    started_at: new Date(now).toISOString(),
    expiry
  };
  await kvSet(env, licenseKey, record);
  await env.LICENSES.put(indexKey, licenseKey);

  return json({ ok: true, license_key: licenseKey, expiry, status: 'active', reused: false });
}

async function handleTrialStart(request, env) {
  let body;
  try {
    body = await request.json();
  } catch (_err) {
    return json({ ok: false, reason: 'bad_request' }, 400);
  }

  // body.product がkintone系プラグインなら、メール単位の既存経路ではなく
  // ドメイン単位の即時発行経路に振る（IP単位レート制限もここでは使わない）
  const requestedProduct = typeof body?.product === 'string' ? body.product : '';
  if (requestedProduct && PRODUCTS[requestedProduct]?.kind === 'kintone') {
    return handleKintoneTrialStart(env, requestedProduct, body);
  }

  if (await isTrialRateLimited(request, env)) {
    return json({ ok: false, reason: 'rate_limited' }, 429);
  }
  const email = String(body?.email || '').trim();
  const normalized = normalizeTrialEmail(email);
  if (!normalized) return json({ ok: false, reason: 'invalid_email' }, 400);

  const existing = await env.LICENSES.get(TRIAL_EMAIL_PREFIX + normalized);
  if (existing) return json({ ok: false, reason: 'trial_already_used' }, 409);

  const licenseKey = generateLicenseKey();
  const verifyToken = generateLicenseKey();
  const now = Date.now();
  const record = {
    email,
    kind: 'trial',
    status: 'active',
    expiry: new Date(now + TRIAL_DURATION_MS).toISOString(),
    trial_verified: false,
    trial_verify_deadline: new Date(now + TRIAL_VERIFY_WINDOW_MS).toISOString()
  };
  await kvSet(env, licenseKey, record);
  await env.LICENSES.put(TRIAL_EMAIL_PREFIX + normalized, licenseKey);
  await env.LICENSES.put(TRIAL_TOKEN_PREFIX + verifyToken, licenseKey);

  const origin = new URL(request.url).origin;
  await sendTrialEmail(env, { email, licenseKey, verifyToken, origin, record });

  return json({ ok: true, key: licenseKey, ...record });
}

async function handleTrialVerify(request, env) {
  const url = new URL(request.url);
  const token = url.searchParams.get('token')?.trim() || '';
  const page = (title, message, ok) => new Response(
    `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title></head>` +
    `<body style="margin:0;background:#f6f8fb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Hiragino Sans',sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh">` +
    `<div style="background:#fff;border:1px solid #e4e9f0;border-radius:14px;padding:32px 36px;max-width:420px;text-align:center;box-shadow:0 14px 34px rgba(10,20,40,.08)">` +
    `<div style="font-size:34px;margin-bottom:8px">${ok ? '✅' : '⚠️'}</div>` +
    `<h1 style="font-size:18px;margin:0 0 8px;color:#101828">${title}</h1>` +
    `<p style="font-size:14px;line-height:1.7;color:#5c6b84;margin:0">${message}</p>` +
    `</div></body></html>`,
    { status: ok ? 200 : 404, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
  );

  if (!token) return page('リンクが無効です', 'URLが正しくありません。メールのリンクをもう一度開いてください。', false);
  const licenseKey = await env.LICENSES.get(TRIAL_TOKEN_PREFIX + token);
  if (!licenseKey) return page('リンクが無効です', 'このリンクは使用済みか、期限切れです。', false);
  const record = await kvGet(env, licenseKey);
  if (!record) return page('リンクが無効です', 'トライアル情報が見つかりませんでした。', false);

  await kvSet(env, licenseKey, { ...record, trial_verified: true });
  await env.LICENSES.delete(TRIAL_TOKEN_PREFIX + token);
  return page(
    'メール確認が完了しました',
    'PlugBits Launcher Pro の14日間トライアルが継続されます。このページは閉じて構いません。',
    true
  );
}

async function sendTrialEmail(env, { email, licenseKey, verifyToken, origin, record }) {
  if (!env.BREVO_API_KEY) return; // 未設定時はスキップ
  const verifyUrl = `${origin}/trial/verify?token=${encodeURIComponent(verifyToken)}`;
  const expiryDate = new Date(record.expiry).toLocaleDateString('ja-JP');
  await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'api-key': env.BREVO_API_KEY,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      sender: {
        email: env.BREVO_SENDER_EMAIL || 'no-reply@plugbits.app',
        name: env.BREVO_SENDER_NAME || 'PlugBits Launcher'
      },
      to: [{ email }],
      subject: '【要確認】PlugBits Launcher Pro 14日間トライアル開始のご案内',
      htmlContent: `
        <h2>PlugBits Launcher Pro トライアルへようこそ！</h2>
        <p>14日間の無料トライアルはすでに拡張機能内で有効になっています（${expiryDate} まで）。</p>
        <p style="background:#fff7ed;border:1px solid #fed7aa;padding:12px;border-radius:6px;">
          <strong>トライアルを継続するには、48時間以内に下のボタンでメールアドレスの確認をお願いします。</strong>
        </p>
        <p style="text-align:center;margin:24px 0;">
          <a href="${verifyUrl}"
             style="display:inline-block;background:#2563eb;color:#fff;text-decoration:none;padding:12px 28px;border-radius:8px;font-weight:bold;">
            メールアドレスを確認する
          </a>
        </p>
        <p>ライセンスキー（控え）:</p>
        <p style="font-family:monospace;font-size:16px;background:#f3f4f6;padding:12px;border-radius:6px;">
          ${licenseKey}
        </p>
        <p style="font-size:12px;color:#6b7280;">
          このキーは個人のものです。別のPCや転職先でも、設定画面の「Pro ライセンス」に入力すれば引き続き利用できます。
        </p>
        <hr/>
        <p style="font-size:12px;color:#6b7280;">
          トライアル終了後も継続する場合は <a href="https://plugbits.app/pro">plugbits.app/pro</a> からアップグレードできます（¥1,980 の買い切り・一度の支払いでずっと使えます）。
        </p>
      `
    })
  });
}

// ── Brevo メール送信 ────────────────────────────────────────────────────────

async function sendLicenseEmail(env, { email, licenseKey, lifetime = false, product = 'grid-edit-pro' }) {
  if (!env.BREVO_API_KEY) return; // 未設定時はスキップ
  const meta = PRODUCTS[product] || PRODUCTS['grid-edit-pro'];
  const isKintone = meta.kind === 'kintone';
  await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'api-key': env.BREVO_API_KEY,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      sender: {
        email: env.BREVO_SENDER_EMAIL || 'no-reply@plugbits.app',
        // 送信者名の secret は Launcher 用なので、kintone プラグインは PlugBits 名義にする
        name: isKintone ? 'PlugBits' : (env.BREVO_SENDER_NAME || 'PlugBits Launcher')
      },
      to: [{ email }],
      subject: `${meta.name} ライセンスキーのご案内`,
      htmlContent: isKintone
        ? kintoneLicenseEmailHtml(meta, licenseKey)
        : `
        <h2>${meta.name} へようこそ！</h2>
        <p>ご購入ありがとうございます。下記のライセンスキーを拡張機能の設定画面に入力してください。</p>
        <p style="font-family:monospace;font-size:18px;background:#f3f4f6;padding:12px;border-radius:6px;">
          ${licenseKey}
        </p>
        <p>設定画面: Chrome 拡張アイコン → 設定 → Pro ライセンス</p>
        <hr/>
        <p style="font-size:12px;color:#6b7280;">
          ${lifetime
            ? '買い切りのライセンスです。一度のお支払いで、ずっとお使いいただけます。領収書は Stripe からのメールでお送りしています。'
            : 'サブスクリプションの管理・解約・領収書は <a href="https://billing.stripe.com/p/login/plugbits">Stripe Customer Portal</a> から行えます。'}
        </p>
      `
    })
  });
}

// kintone プラグイン(買い切り・会社ドメイン単位)のキーのメール本文
function kintoneLicenseEmailHtml(meta, licenseKey) {
  return `
        <h2>${meta.name}(kintone プラグイン)をご購入いただきありがとうございます</h2>
        <p>ライセンスキーは次のとおりです。</p>
        <p style="font-family:monospace;font-size:18px;background:#f3f4f6;padding:12px;border-radius:6px;">
          ${licenseKey}
        </p>
        <p><b>キーの入れ方</b></p>
        <ol>
          <li>kintone でプラグインを入れたアプリを開き、アプリの設定 → プラグイン から ${meta.name} の設定画面を開きます。</li>
          <li>いちばん上の「ライセンス」欄にキーを貼り付けて「確認」を押します。「有効です」と出れば完了です。</li>
          <li>設定を保存し、アプリを更新してください。</li>
        </ol>
        <p>このキーは会社の kintone ドメイン(例: example.cybozu.com)単位で 1 つです。最初に確認したドメインに結び付き、同じドメインのほかのアプリにも同じキーを入れられます。</p>
        <hr/>
        <p style="font-size:12px;color:#6b7280;">
          買い切りのライセンスです。<br/>
          領収書は Stripe からのメールでお送りしています。利用規約: <a href="https://plugbits.app/kintone/terms/">https://plugbits.app/kintone/terms/</a><br/>
          ドメインの移行やご不明な点は <a href="mailto:support@plugbits.app">support@plugbits.app</a> までご連絡ください。
        </p>
      `;
}

// ── Stripe Portalセッション URL 生成 ───────────────────────────────────────

async function createPortalSession(env, customerId) {
  try {
    const params = new URLSearchParams({
      customer: customerId,
      return_url: 'https://plugbits.app'
    });
    const resp = await stripeRequest(env, '/billing_portal/sessions', 'POST', params.toString());
    return resp?.url || '';
  } catch (_err) {
    return '';
  }
}

// ── /webhook ────────────────────────────────────────────────────────────────

async function handleWebhook(request, env) {
  const rawBody = await request.text();
  const sig = request.headers.get('Stripe-Signature') || '';

  try {
    await verifyStripeSignature(env, rawBody, sig);
  } catch (err) {
    return json({ ok: false, error: err.message }, 400);
  }

  const event = JSON.parse(rawBody);
  const type = event.type;
  const obj = event.data?.object;

  if (type === 'checkout.session.completed' && obj?.mode === 'payment') {
    // 買い切り: サブスクリプションは無い。支払い済みのときだけ発行する
    const paymentIntentId = obj?.payment_intent;
    const email = obj?.customer_email || obj?.customer_details?.email || '';
    if (!paymentIntentId) return json({ ok: true, skipped: 'missing_ids' });
    if (obj?.payment_status !== 'paid') return json({ ok: true, skipped: 'not_paid' });
    // webhook の再送(同じ支払い)では二重に発行しない
    if (await getKeyForPaymentIntent(env, paymentIntentId)) return json({ ok: true, skipped: 'already_issued' });

    // metadata.product か payment_link の対応表で判別。どちらも無い既存の Launcher 用
    // Payment Link は grid-edit-pro になる
    const product = resolveCheckoutProduct(obj, env);
    const isKintone = PRODUCTS[product].kind === 'kintone';

    const licenseKey = generateLicenseKey();
    const record = {
      email,
      status: 'active',
      kind: 'lifetime',
      product,
      stripe_customer_id: obj?.customer || '',
      stripe_payment_intent: paymentIntentId,
      purchased_at: new Date((event.created || Date.now() / 1000) * 1000).toISOString(),
      expiry: ''
    };
    if (isKintone) {
      // Payment Link のカスタムフィールド(kintonedomain)。無ければ空のまま保存し、
      // 最初の /verify でドメインに束縛する
      const customFields = Array.isArray(obj?.custom_fields) ? obj.custom_fields : [];
      const domainField = customFields.find((f) => f?.key === 'kintonedomain');
      record.domain = normalizeKintoneDomain(domainField?.text?.value) || '';
    }
    await kvSet(env, licenseKey, record);
    await env.LICENSES.put(PI_INDEX_PREFIX + paymentIntentId, licenseKey);
    await sendLicenseEmail(env, { email, licenseKey, lifetime: true, product });
    return json({ ok: true, action: 'key_issued', kind: 'lifetime' });
  }

  if (type === 'charge.refunded') {
    // 買い切りの返金: 全額返金ならライセンスを無効に(一部返金は何もしない)
    const paymentIntentId = obj?.payment_intent;
    if (!paymentIntentId) return json({ ok: true, skipped: 'missing_ids' });
    if (!obj?.refunded) return json({ ok: true, skipped: 'partial_refund' });
    const licenseKey = await getKeyForPaymentIntent(env, paymentIntentId);
    if (!licenseKey) return json({ ok: true, skipped: 'license_not_found' });
    const record = await kvGet(env, licenseKey);
    if (!record) return json({ ok: true, skipped: 'license_not_found' });
    await kvSet(env, licenseKey, { ...record, status: 'refunded', refunded_at: new Date().toISOString() });
    return json({ ok: true, action: 'license_refunded' });
  }

  if (type === 'checkout.session.completed') {
    // 旧: 月額サブスク(mode=subscription)。既存契約のために残す
    const customerId = obj?.customer;
    const subscriptionId = obj?.subscription;
    const email = obj?.customer_email || obj?.customer_details?.email || '';
    if (!customerId || !subscriptionId) return json({ ok: true, skipped: 'missing_ids' });

    const licenseKey = generateLicenseKey();
    const sub = await getSubscription(env, subscriptionId);
    const expiry = sub?.current_period_end
      ? new Date(sub.current_period_end * 1000).toISOString()
      : '';

    const record = {
      email,
      status: 'active',
      stripe_customer_id: customerId,
      stripe_subscription_id: subscriptionId,
      expiry
    };
    await kvSet(env, licenseKey, record);
    await addKeyToSubscriptionIndex(env, subscriptionId, licenseKey);
    await sendLicenseEmail(env, { email, licenseKey });
    return json({ ok: true, action: 'key_issued' });
  }

  if (type === 'invoice.payment_succeeded') {
    const subscriptionId = obj?.subscription;
    const customerId = obj?.customer;
    if (!subscriptionId || !customerId) return json({ ok: true, skipped: 'missing_ids' });

    const periodEnd = obj.lines?.data?.[0]?.period?.end;
    const expiry = periodEnd ? new Date(periodEnd * 1000).toISOString() : '';

    // そのサブスクに紐づく全ライセンスキーを逆引きindex経由で更新
    await updateRecordsForSubscription(env, subscriptionId, { status: 'active', expiry });
    return json({ ok: true, action: 'subscription_renewed' });
  }

  if (type === 'invoice.payment_failed') {
    const subscriptionId = obj?.subscription;
    if (!subscriptionId) return json({ ok: true, skipped: 'missing_ids' });

    await updateRecordsForSubscription(env, subscriptionId, { status: 'past_due' });
    return json({ ok: true, action: 'marked_past_due' });
  }

  if (type === 'customer.subscription.deleted') {
    const subscriptionId = obj?.id;
    if (!subscriptionId) return json({ ok: true, skipped: 'missing_ids' });

    await updateRecordsForSubscription(env, subscriptionId, { status: 'canceled' });
    return json({ ok: true, action: 'subscription_canceled' });
  }

  return json({ ok: true, skipped: 'unhandled_event' });
}

// ── /verify ─────────────────────────────────────────────────────────────────

// /verify の応答に載せる項目を絞る(KV のレコードをそのまま返さない)。
// メールアドレスと Stripe の ID(pi_/cus_)はキーを知っていれば誰でも見えてしまうため出さない。
// kintone 製品: ok・status・reason・kind・product・domain・expiry だけ。
// Chrome 拡張(grid-edit-pro): 設定画面が使う status・email・expiry・kind・trial_verified・portal_url。
// email は伏せ字(o***@example.com)にして返す(拡張は「登録メール」の表示にだけ使う)。
function maskEmail(email) {
  const s = String(email || '');
  const at = s.lastIndexOf('@');
  if (at < 1) return '';
  return `${s[0]}***${s.slice(at)}`;
}

function verifyResponseBody(record, status, portalUrl) {
  const product = productOf(record);
  const base = { ok: status === 'active', status, reason: status === 'active' ? undefined : status, kind: record.kind };
  if (PRODUCTS[product]?.kind === 'kintone') {
    return { ...base, product, domain: record.domain || '', expiry: record.expiry };
  }
  const body = { ...base, email: maskEmail(record.email), expiry: record.expiry, portal_url: portalUrl || '' };
  if (record.kind === 'trial') body.trial_verified = !!record.trial_verified;
  return body;
}

async function handleVerify(request, env) {
  const url = new URL(request.url);
  const licenseKey = url.searchParams.get('key')?.trim() || '';
  if (!licenseKey) return json({ ok: false, reason: 'missing_key' }, 400);

  // product を送ってくるのはkintoneプラグイン(新クライアント)。
  // 旧Chrome拡張は product を送らないため、下の分岐は丸ごと素通りして挙動不変
  const requestedProduct = url.searchParams.get('product')?.trim() || '';

  const rawKey = licenseKey.startsWith('lic_') ? licenseKey.slice(4) : licenseKey;

  // 1. KVキャッシュ確認
  let cached = await kvGet(env, rawKey);
  if (!cached) {
    // 2. KV miss → Stripe から直接サブスクを調べる術がないため not_found
    // （KVへの書き込みは checkout.session.completed webhook 経由のみ）
    return json({ ok: false, status: 'not_found', reason: 'key_not_found' }, 404);
  }

  let isKintoneRequest = false;
  if (requestedProduct) {
    if (productOf(cached) !== requestedProduct) {
      return json({ ok: false, status: 'product_mismatch', reason: 'product_mismatch' });
    }
    isKintoneRequest = PRODUCTS[requestedProduct]?.kind === 'kintone';
    if (isKintoneRequest) {
      const domain = normalizeKintoneDomain(url.searchParams.get('domain'));
      if (!domain) return json({ ok: false, reason: 'missing_domain' }, 400);
      if (!cached.domain) {
        // 初回アクセスでこのライセンスをドメインに束縛する
        cached = { ...cached, domain, domain_bound_at: new Date().toISOString() };
        await kvSet(env, rawKey, cached);
      } else if (cached.domain !== domain) {
        return json({ ok: false, status: 'domain_mismatch', reason: 'domain_mismatch' });
      }
    }
  }

  // トライアルは有効期限と後追い検証（48時間）を評価してstatusを決める
  // （kintone系トライアルは trial_verify_deadline を持たないのでこの分岐には来ない）
  if (cached.kind === 'trial') {
    const now = Date.now();
    const expiryMs = Date.parse(cached.expiry || '') || 0;
    const verifyDeadlineMs = Date.parse(cached.trial_verify_deadline || '') || 0;
    let status = cached.status || 'active';
    if (status === 'active') {
      if (expiryMs && now > expiryMs) {
        status = 'trial_expired';
      } else if (!cached.trial_verified && verifyDeadlineMs && now > verifyDeadlineMs) {
        status = 'trial_unverified';
      }
    }
    if (isKintoneRequest) {
      return json({
        ok: status === 'active',
        status,
        reason: status === 'active' ? undefined : status,
        kind: cached.kind,
        product: productOf(cached),
        domain: cached.domain || '',
        expiry: cached.expiry
      });
    }
    return json(verifyResponseBody(cached, status, ''));
  }

  // 返金済み(refunded)・解約(canceled)などは ok:false(拡張は status==='active' だけを Pro とみなす)
  const status = cached.status || 'active';
  if (isKintoneRequest) {
    return json({
      ok: status === 'active',
      status,
      reason: status === 'active' ? undefined : status,
      kind: cached.kind,
      product: productOf(cached),
      domain: cached.domain || '',
      expiry: cached.expiry
    });
  }
  const portalUrl = cached.stripe_customer_id
    ? await createPortalSession(env, cached.stripe_customer_id)
    : '';
  return json(verifyResponseBody(cached, status, portalUrl));
}

// ── トライアル リマインダー（Cron） ─────────────────────────────────────────
//
// 毎日1回、トライアルレコードを走査して転換メールを送る:
//   - 終了3日前（確認済み・有効なもの）
//   - 終了時
//   - メール未確認のまま停止したとき
// 送信済みフラグをレコードに立てて二重送信を防ぐ。
// トライアル件数が数千を超えたら日付バケットのindexに切り替えること。

async function sendTrialLifecycleEmail(env, { email, type, expiry }) {
  if (!env.BREVO_API_KEY || !email) return;
  const expiryDate = expiry ? new Date(expiry).toLocaleDateString('ja-JP') : '';
  const upgradeBlock = `
    <p style="text-align:center;margin:24px 0;">
      <a href="https://plugbits.app/pro"
         style="display:inline-block;background:#2563eb;color:#fff;text-decoration:none;padding:12px 28px;border-radius:8px;font-weight:bold;">
        Pro にアップグレード（¥1,980 買い切り）
      </a>
    </p>
    <p style="font-size:12px;color:#6b7280;">一度のお支払いで、ずっと使えます。ライセンスは個人のものなので、転職先でもそのまま使えます。</p>`;
  const contents = {
    ending_soon: {
      subject: 'PlugBits Launcher Pro トライアル終了まであと3日です',
      html: `
        <h2>トライアル終了まであと3日です</h2>
        <p>PlugBits Launcher Pro の14日間トライアルは <strong>${expiryDate}</strong> に終了します。</p>
        <p>一覧でのセル編集・コピー&貼り付け・一括保存を続けてお使いいただくには、Pro へのアップグレードをご検討ください。</p>
        ${upgradeBlock}`
    },
    ended: {
      subject: 'PlugBits Launcher Pro トライアルが終了しました',
      html: `
        <h2>トライアルが終了しました</h2>
        <p>14日間のトライアルをご利用いただきありがとうございました。現在は無料プラン（閲覧・単票編集）に戻っています。</p>
        <p>一覧の一括編集をもう一度使うには、Pro へのアップグレードをどうぞ。</p>
        ${upgradeBlock}`
    },
    unverified: {
      subject: '【ご確認ください】PlugBits Launcher Pro トライアルが一時停止しました',
      html: `
        <h2>メール確認が完了していません</h2>
        <p>48時間以内にメールアドレスの確認が完了しなかったため、トライアルを一時停止しました。</p>
        <p>以前お送りした確認メールのリンクを開くと、トライアルを再開できます（メールが見つからない場合はこのメールにご返信ください）。</p>`
    }
  };
  const content = contents[type];
  if (!content) return;
  await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': env.BREVO_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sender: {
        email: env.BREVO_SENDER_EMAIL || 'no-reply@plugbits.app',
        name: env.BREVO_SENDER_NAME || 'PlugBits Launcher'
      },
      to: [{ email }],
      subject: content.subject,
      htmlContent: content.html
    })
  });
}

async function runTrialReminderSweep(env) {
  const now = Date.now();
  const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;
  let cursor;
  do {
    const page = await env.LICENSES.list({ prefix: KV_PREFIX, cursor });
    cursor = page.list_complete ? undefined : page.cursor;
    for (const key of page.keys) {
      const licenseKey = key.name.slice(KV_PREFIX.length);
      const record = await kvGet(env, licenseKey);
      // kintone系トライアルは email:'' なのでここで素通りする(メール送信対象外)
      if (!record || record.kind !== 'trial' || !record.email) continue;

      const expiryMs = Date.parse(record.expiry || '') || 0;
      const deadlineMs = Date.parse(record.trial_verify_deadline || '') || 0;
      const isExpired = expiryMs && now > expiryMs;
      const isUnverifiedStopped = !record.trial_verified && deadlineMs && now > deadlineMs;

      if (isUnverifiedStopped && !isExpired && !record.trial_unverified_mail_sent) {
        await sendTrialLifecycleEmail(env, { email: record.email, type: 'unverified', expiry: record.expiry });
        await kvSet(env, licenseKey, { ...record, trial_unverified_mail_sent: true });
        continue;
      }
      if (isExpired && !record.trial_ended_mail_sent) {
        await sendTrialLifecycleEmail(env, { email: record.email, type: 'ended', expiry: record.expiry });
        await kvSet(env, licenseKey, { ...record, trial_ended_mail_sent: true });
        continue;
      }
      if (
        !isExpired && !isUnverifiedStopped && record.trial_verified
        && expiryMs && expiryMs - now <= THREE_DAYS_MS
        && !record.trial_reminder_mail_sent
      ) {
        await sendTrialLifecycleEmail(env, { email: record.email, type: 'ending_soon', expiry: record.expiry });
        await kvSet(env, licenseKey, { ...record, trial_reminder_mail_sent: true });
      }
    }
  } while (cursor);
}

// ── Router ──────────────────────────────────────────────────────────────────

export default {
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(runTrialReminderSweep(env));
  },

  async fetch(request, env) {
    const url = new URL(request.url);
    const cors = corsHeaders(env);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }

    let response;
    if (request.method === 'POST' && url.pathname === '/webhook') {
      response = await handleWebhook(request, env);
    } else if (request.method === 'GET' && url.pathname === '/verify') {
      response = await handleVerify(request, env);
    } else if (request.method === 'POST' && url.pathname === '/trial') {
      response = await handleTrialStart(request, env);
    } else if (request.method === 'GET' && url.pathname === '/trial/verify') {
      response = await handleTrialVerify(request, env);
    } else {
      response = json({ ok: false, error: 'Not found' }, 404);
    }

    // CORS ヘッダーを全レスポンスに付与
    const headers = new Headers(response.headers);
    Object.entries(cors).forEach(([k, v]) => headers.set(k, v));
    return new Response(response.body, { status: response.status, headers });
  }
};
