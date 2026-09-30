// 買い切り(¥1,980)の webhook → ライセンス発行 → /verify → 返金で無効、をローカルで通す(2026-09-29)。
// Stripe・Brevo には出ない(fetch を差し替える)。署名はテスト用の秘密で自分で付ける。
// 実行: node workers/tests/lifetime.test.mjs
import worker from '../src/index.js';
import assert from 'node:assert/strict';

const store = new Map();
const LICENSES = {
  async get(k) { return store.has(k) ? store.get(k) : null; },
  async put(k, v) { store.set(k, v); },
  async delete(k) { store.delete(k); },
  async list({ prefix = '' } = {}) { return { keys: [...store.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })), list_complete: true }; }
};
const env = { LICENSES, STRIPE_WEBHOOK_SECRET: 'whsec_localtest', STRIPE_SECRET_KEY: 'sk_test_dummy', BREVO_API_KEY: 'dummy', ALLOWED_ORIGIN: '*' };

const sent = [];
globalThis.fetch = async (url, init = {}) => {
  sent.push({ url: String(url), body: init.body });
  if (String(url).includes('/billing_portal/sessions')) return new Response(JSON.stringify({ url: 'https://billing.stripe.com/p/session/test' }), { status: 200 });
  return new Response('{}', { status: 200 });
};

async function sign(body) {
  const t = Math.floor(Date.now() / 1000);
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.STRIPE_WEBHOOK_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${t}.${body}`));
  return `t=${t},v1=${Buffer.from(mac).toString('hex')}`;
}
async function webhook(event, badSig = false) {
  const body = JSON.stringify(event);
  const res = await worker.fetch(new Request('http://x/webhook', { method: 'POST', body, headers: { 'Stripe-Signature': badSig ? 't=1,v1=00' : await sign(body) } }), env);
  return { status: res.status, body: await res.json() };
}
async function verify(key) {
  const res = await worker.fetch(new Request('http://x/verify?key=' + encodeURIComponent(key)), env);
  return { status: res.status, body: await res.json() };
}
const licenseKeys = () => [...store.keys()].filter((k) => k.startsWith('lic_')).map((k) => k.slice(4));

const checkout = (pi, extra = {}) => ({ id: 'evt_' + pi, type: 'checkout.session.completed', created: 1790700000,
  data: { object: { mode: 'payment', payment_status: 'paid', payment_intent: pi, customer: 'cus_test1', customer_details: { email: 'buyer@example.com' }, ...extra } } });

// 1. 署名が合わないものは弾く
assert.equal((await webhook(checkout('pi_bad'), true)).status, 400);
assert.equal(licenseKeys().length, 0);

// 2. 支払い済みの買い切り → ライセンス発行(kind:lifetime・expiry 空)・メール送信
let r = await webhook(checkout('pi_1'));
assert.deepEqual([r.status, r.body.action, r.body.kind], [200, 'key_issued', 'lifetime']);
assert.equal(licenseKeys().length, 1);
const key = licenseKeys()[0];
const rec = JSON.parse(store.get('lic_' + key));
assert.equal(rec.status, 'active'); assert.equal(rec.kind, 'lifetime'); assert.equal(rec.expiry, '');
assert.equal(rec.stripe_payment_intent, 'pi_1'); assert.equal(rec.email, 'buyer@example.com');
const mail = sent.find((x) => x.url.includes('brevo'));
assert.ok(mail && mail.body.includes(key) && mail.body.includes('買い切り'), 'ライセンスのメールに鍵と「買い切り」');

// 3. 同じ支払いの再送では二重に発行しない
r = await webhook(checkout('pi_1'));
assert.equal(r.body.skipped, 'already_issued'); assert.equal(licenseKeys().length, 1);

// 4. 未払い(payment_status != paid)は発行しない
r = await webhook(checkout('pi_unpaid', { payment_status: 'unpaid' }));
assert.equal(r.body.skipped, 'not_paid'); assert.equal(licenseKeys().length, 1);

// 5. /verify: 有効(lic_ 付きでも可)
let v = await verify('lic_' + key);
assert.deepEqual([v.status, v.body.ok, v.body.status, v.body.kind], [200, true, 'active', 'lifetime']);

// 6. 一部返金では無効にしない
r = await webhook({ type: 'charge.refunded', data: { object: { payment_intent: 'pi_1', refunded: false, amount_refunded: 500 } } });
assert.equal(r.body.skipped, 'partial_refund');
assert.equal((await verify(key)).body.status, 'active');

// 7. 全額返金 → refunded(/verify は ok:false)
r = await webhook({ type: 'charge.refunded', data: { object: { payment_intent: 'pi_1', refunded: true } } });
assert.equal(r.body.action, 'license_refunded');
v = await verify(key);
assert.deepEqual([v.body.ok, v.body.status, v.body.reason], [false, 'refunded', 'refunded']);

// 8. 知らない支払いの返金は何もしない
r = await webhook({ type: 'charge.refunded', data: { object: { payment_intent: 'pi_unknown', refunded: true } } });
assert.equal(r.body.skipped, 'license_not_found');

// 9. 旧サブスク(mode=subscription)の分岐は今までどおり(subscription が無ければ素通り)
r = await webhook({ type: 'checkout.session.completed', data: { object: { mode: 'subscription', customer: 'cus_x' } } });
assert.equal(r.body.skipped, 'missing_ids');

console.log('lifetime.test.mjs: 全部通りました');
