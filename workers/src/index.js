/**
 * PlugBits API – Cloudflare Workers
 *
 * Routes:
 *   POST /webhook       – Stripe webhook（署名検証 → KV更新 → Brevoメール）
 *   GET  /verify        – ライセンスキー認証（KVキャッシュ → Stripe確認）
 *   POST /trial         – 14日トライアルキー発行（メール単位・即時有効）
 *   GET  /trial/verify  – トライアルのメール確認（48時間以内・後追い検証）
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
// KVレイアウト:
//   lic_{key}        … ライセンス本体（kind:'trial' を含む）
//   trial_{email}    … 正規化メール → key（重複取得の防止）
//   trialtok_{token} … 確認トークン → key（確認後に削除）

const TRIAL_EMAIL_PREFIX = 'trial_';
const TRIAL_TOKEN_PREFIX = 'trialtok_';
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

async function handleTrialStart(request, env) {
  let body;
  try {
    body = await request.json();
  } catch (_err) {
    return json({ ok: false, reason: 'bad_request' }, 400);
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
          トライアル終了後も継続する場合は <a href="https://plugbits.app/pro">plugbits.app/pro</a> からアップグレードできます（¥980/月・いつでも解約可）。
        </p>
      `
    })
  });
}

// ── Brevo メール送信 ────────────────────────────────────────────────────────

async function sendLicenseEmail(env, { email, licenseKey }) {
  if (!env.BREVO_API_KEY) return; // 未設定時はスキップ
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
      subject: 'PlugBits Launcher Pro ライセンスキーのご案内',
      htmlContent: `
        <h2>PlugBits Launcher Pro へようこそ！</h2>
        <p>ご購入ありがとうございます。下記のライセンスキーを拡張機能の設定画面に入力してください。</p>
        <p style="font-family:monospace;font-size:18px;background:#f3f4f6;padding:12px;border-radius:6px;">
          ${licenseKey}
        </p>
        <p>設定画面: Chrome 拡張アイコン → 設定 → Pro ライセンス</p>
        <hr/>
        <p style="font-size:12px;color:#6b7280;">
          サブスクリプションの管理・解約・領収書は
          <a href="https://billing.stripe.com/p/login/plugbits">Stripe Customer Portal</a> から行えます。
        </p>
      `
    })
  });
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

  if (type === 'checkout.session.completed') {
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
    await sendLicenseEmail(env, { email, licenseKey });
    return json({ ok: true, action: 'key_issued' });
  }

  if (type === 'invoice.payment_succeeded') {
    const subscriptionId = obj?.subscription;
    const customerId = obj?.customer;
    if (!subscriptionId || !customerId) return json({ ok: true, skipped: 'missing_ids' });

    const periodEnd = obj.lines?.data?.[0]?.period?.end;
    const expiry = periodEnd ? new Date(periodEnd * 1000).toISOString() : '';

    // そのサブスクに紐づく全ライセンスキーを更新
    const list = await env.LICENSES.list({ prefix: KV_PREFIX });
    for (const key of list.keys) {
      const record = await kvGet(env, key.name.slice(KV_PREFIX.length));
      if (record?.stripe_subscription_id === subscriptionId) {
        await kvSet(env, key.name.slice(KV_PREFIX.length), {
          ...record,
          status: 'active',
          expiry
        });
      }
    }
    return json({ ok: true, action: 'subscription_renewed' });
  }

  if (type === 'invoice.payment_failed') {
    const subscriptionId = obj?.subscription;
    if (!subscriptionId) return json({ ok: true, skipped: 'missing_ids' });

    const list = await env.LICENSES.list({ prefix: KV_PREFIX });
    for (const key of list.keys) {
      const record = await kvGet(env, key.name.slice(KV_PREFIX.length));
      if (record?.stripe_subscription_id === subscriptionId) {
        await kvSet(env, key.name.slice(KV_PREFIX.length), { ...record, status: 'past_due' });
      }
    }
    return json({ ok: true, action: 'marked_past_due' });
  }

  if (type === 'customer.subscription.deleted') {
    const subscriptionId = obj?.id;
    if (!subscriptionId) return json({ ok: true, skipped: 'missing_ids' });

    const list = await env.LICENSES.list({ prefix: KV_PREFIX });
    for (const key of list.keys) {
      const record = await kvGet(env, key.name.slice(KV_PREFIX.length));
      if (record?.stripe_subscription_id === subscriptionId) {
        await kvSet(env, key.name.slice(KV_PREFIX.length), { ...record, status: 'canceled' });
      }
    }
    return json({ ok: true, action: 'subscription_canceled' });
  }

  return json({ ok: true, skipped: 'unhandled_event' });
}

// ── /verify ─────────────────────────────────────────────────────────────────

async function handleVerify(request, env) {
  const url = new URL(request.url);
  const licenseKey = url.searchParams.get('key')?.trim() || '';
  if (!licenseKey) return json({ ok: false, reason: 'missing_key' }, 400);

  const rawKey = licenseKey.startsWith('lic_') ? licenseKey.slice(4) : licenseKey;

  // 1. KVキャッシュ確認
  const cached = await kvGet(env, rawKey);
  if (cached) {
    // トライアルは有効期限と後追い検証（48時間）を評価してstatusを決める
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
      return json({ ok: status === 'active', ...cached, status, reason: status === 'active' ? undefined : status, portal_url: '' });
    }
    const portalUrl = cached.stripe_customer_id
      ? await createPortalSession(env, cached.stripe_customer_id)
      : '';
    return json({ ok: true, ...cached, portal_url: portalUrl });
  }

  // 2. KV miss → Stripe から直接サブスクを調べる術がないため not_found
  // （KVへの書き込みは checkout.session.completed webhook 経由のみ）
  return json({ ok: false, status: 'not_found', reason: 'key_not_found' }, 404);
}

// ── Router ──────────────────────────────────────────────────────────────────

export default {
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
