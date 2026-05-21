/**
 * PlugBits API – Cloudflare Workers
 *
 * Routes:
 *   POST /webhook   – Stripe webhook（署名検証 → KV更新 → Brevoメール）
 *   GET  /verify    – ライセンスキー認証（KVキャッシュ → Stripe確認）
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

const KV_TTL_SECONDS = 86400; // 24h
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
  await env.LICENSES.put(kvKey(licenseKey), JSON.stringify(data), {
    expirationTtl: KV_TTL_SECONDS
  });
}

async function kvDelete(env, licenseKey) {
  await env.LICENSES.delete(kvKey(licenseKey));
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

    const sub = await getSubscription(env, subscriptionId);
    const expiry = sub?.current_period_end
      ? new Date(sub.current_period_end * 1000).toISOString()
      : '';

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
    } else {
      response = json({ ok: false, error: 'Not found' }, 404);
    }

    // CORS ヘッダーを全レスポンスに付与
    const headers = new Headers(response.headers);
    Object.entries(cors).forEach(([k, v]) => headers.set(k, v));
    return new Response(response.body, { status: response.status, headers });
  }
};
