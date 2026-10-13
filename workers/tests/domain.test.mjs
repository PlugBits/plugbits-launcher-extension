// GET /domain-status（キー無しのドメイン有効性確認）をローカルで通す(2026-10-13)。
// Stripe・Brevoには出ない(fetchを差し替える)。実行: node workers/tests/domain.test.mjs
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
async function webhook(event) {
  const body = JSON.stringify(event);
  const res = await worker.fetch(new Request('http://x/webhook', { method: 'POST', body, headers: { 'Stripe-Signature': await sign(body) } }), env);
  return { status: res.status, body: await res.json() };
}
async function verify(params) {
  const res = await worker.fetch(new Request('http://x/verify?' + new URLSearchParams(params).toString()), env);
  return { status: res.status, body: await res.json() };
}
async function trial(body) {
  const res = await worker.fetch(new Request('http://x/trial', { method: 'POST', body: JSON.stringify(body) }), env);
  return { status: res.status, body: await res.json() };
}
async function domainStatus(params) {
  const res = await worker.fetch(new Request('http://x/domain-status?' + new URLSearchParams(params).toString()), env);
  const text = await res.text();
  return { status: res.status, body: JSON.parse(text), text };
}
const licenseKeys = () => [...store.keys()].filter((k) => k.startsWith('lic_')).map((k) => k.slice(4));
const newKeysSince = (before) => licenseKeys().filter((k) => !before.includes(k));

const checkout = (pi, extra = {}) => ({ id: 'evt_' + pi, type: 'checkout.session.completed', created: 1790700000,
  data: { object: { mode: 'payment', payment_status: 'paid', payment_intent: pi, customer: 'cus_test1', customer_details: { email: 'buyer@example.com' }, ...extra } } });

// 1. ライセンスが何も無いドメインは no_license
let d = await domainStatus({ product: 'kintone-listkit', domain: 'nolicense-corp.cybozu.com' });
assert.deepEqual([d.status, d.body.ok, d.body.status, d.body.reason], [200, false, 'no_license', 'no_license']);
assert.deepEqual(d.body.product, 'kintone-listkit');
assert.deepEqual(d.body.domain, 'nolicense-corp.cybozu.com');

// 2. 不正なproduct → 400
d = await domainStatus({ product: 'not-a-product', domain: 'acme.cybozu.com' });
assert.deepEqual([d.status, d.body.ok, d.body.reason], [400, false, 'unknown_product']);
d = await domainStatus({ product: 'grid-edit-pro', domain: 'acme.cybozu.com' }); // kind:extensionも弾く
assert.deepEqual([d.status, d.body.reason], [400, 'unknown_product']);

// 3. 不正なdomain → 400
d = await domainStatus({ product: 'kintone-listkit', domain: 'not-a-kintone-host.example.com' });
assert.deepEqual([d.status, d.body.reason], [400, 'missing_domain']);

// 4. /trial でドメインAにトライアル開始 → /domain-status Aはtrial active、Bはno_license
let r = await trial({ product: 'kintone-rule-builder', domain: 'tenanta.cybozu.com' });
assert.equal(r.body.ok, true);
d = await domainStatus({ product: 'kintone-rule-builder', domain: 'tenanta.cybozu.com' });
assert.deepEqual([d.body.ok, d.body.status, d.body.kind, d.body.product, d.body.domain], [true, 'active', 'trial', 'kintone-rule-builder', 'tenanta.cybozu.com']);
assert.ok(d.body.expiry, 'トライアルはexpiryを返す');
d = await domainStatus({ product: 'kintone-rule-builder', domain: 'tenantb.cybozu.com' });
assert.deepEqual([d.body.ok, d.body.status, d.body.reason], [false, 'no_license', 'no_license']);

// 5. webhookの買い切り購入(kintonedomainカスタムフィールド有り)→最初の/verifyでドメイン束縛→domain-status ok
let before = licenseKeys();
r = await webhook(checkout('pi_withdomain', {
  metadata: { product: 'kintone-listkit' },
  custom_fields: [{ key: 'kintonedomain', text: { value: 'https://WithDomain.cybozu.com/k/1' } }]
}));
assert.equal(r.body.action, 'key_issued');
const withDomainKey = newKeysSince(before)[0];
// webhookの時点でkintonedomainが分かっているので、/verifyを待たずにdomain-statusで見つかる
d = await domainStatus({ product: 'kintone-listkit', domain: 'withdomain.cybozu.com' });
assert.deepEqual([d.body.ok, d.body.status, d.body.kind, d.body.product, d.body.domain], [true, 'active', 'lifetime', 'kintone-listkit', 'withdomain.cybozu.com']);
assert.ok(d.body.purchased_at, '購入ライセンスはpurchased_atを返す');
assert.equal(d.text.includes(withDomainKey), false, 'JSON本文にライセンスキーが出ない');
assert.equal(d.text.includes('@'), false, 'JSON本文にメールが出ない');

// 6. kintonedomainカスタムフィールド無し → webhook時点ではindex登録されない。最初の/verifyでドメインに束縛され、
//    その後ならdomain-statusで見つかる(自己修復とは別経路・通常の初回束縛)
before = licenseKeys();
r = await webhook(checkout('pi_nodomain', { metadata: { product: 'kintone-listkit' } }));
assert.equal(r.body.action, 'key_issued');
const noDomainKey = newKeysSince(before)[0];
d = await domainStatus({ product: 'kintone-listkit', domain: 'nodomain-corp.cybozu.com' });
assert.deepEqual([d.body.ok, d.body.status], [false, 'no_license']);
const v = await verify({ key: noDomainKey, product: 'kintone-listkit', domain: 'nodomain-corp.cybozu.com' });
assert.deepEqual([v.body.ok, v.body.domain], [true, 'nodomain-corp.cybozu.com']);
d = await domainStatus({ product: 'kintone-listkit', domain: 'nodomain-corp.cybozu.com' });
assert.deepEqual([d.body.ok, d.body.status, d.body.purchased_at !== undefined], [true, 'active', true]);

// 7. 購入が trial より優先される(同一ドメイン・同一productで両方valid)
before = licenseKeys();
r = await webhook(checkout('pi_both_kinds', {
  metadata: { product: 'kintone-gallery' },
  custom_fields: [{ key: 'kintonedomain', text: { value: 'bothkinds.cybozu.com' } }]
}));
const bothKey = newKeysSince(before)[0];
await trial({ product: 'kintone-gallery', domain: 'bothkinds.cybozu.com' }); // 購入済みドメインでもトライアルindexは作れる想定
d = await domainStatus({ product: 'kintone-gallery', domain: 'bothkinds.cybozu.com' });
assert.deepEqual([d.body.ok, d.body.status, d.body.kind], [true, 'active', 'lifetime'], '購入がトライアルより優先される');

// 8. 返金済みでトライアルが無い場合は ok:false status:refunded
const refundedRec = JSON.parse(store.get('lic_' + bothKey));
store.set('lic_' + bothKey, JSON.stringify({ ...refundedRec, status: 'refunded', refunded_at: new Date().toISOString() }));
// 同ドメインのトライアルindexも消して「トライアルが無い」状態にする
store.delete(`trialdom_kintone-gallery_bothkinds.cybozu.com`);
d = await domainStatus({ product: 'kintone-gallery', domain: 'bothkinds.cybozu.com' });
assert.deepEqual([d.body.ok, d.body.status, d.body.reason, d.body.kind], [false, 'refunded', 'refunded', 'lifetime']);

// 9. 自己修復: このindex導入前に直接KVへ書かれた(indexに登録されていない)束縛済みレコードが
//    1回の/verifyでdomain-statusから見つかるようになる
const legacyKey = 'legacy-domain-0000-0000-000000000009';
store.set('lic_' + legacyKey, JSON.stringify({ email: 'old@example.com', status: 'active', kind: 'lifetime', product: 'kintone-signage', domain: 'legacy-bound.cybozu.com', expiry: '' }));
d = await domainStatus({ product: 'kintone-signage', domain: 'legacy-bound.cybozu.com' });
assert.deepEqual([d.body.ok, d.body.status], [false, 'no_license'], 'index登録前は見つからない');
const v9 = await verify({ key: legacyKey, product: 'kintone-signage', domain: 'legacy-bound.cybozu.com' });
assert.equal(v9.body.ok, true);
d = await domainStatus({ product: 'kintone-signage', domain: 'legacy-bound.cybozu.com' });
assert.deepEqual([d.body.ok, d.body.status, d.body.kind], [true, 'active', 'lifetime'], '1回の/verifyで自己修復されindexから見つかる');

// 10. productを取り違えると見つからない(別productからの照会はno_license)
d = await domainStatus({ product: 'kintone-rule-builder', domain: 'legacy-bound.cybozu.com' });
assert.deepEqual([d.body.ok, d.body.status], [false, 'no_license']);

// 11. レート制限: 120回まではOK、121回目で429
for (let i = 0; i < 120; i++) {
  const ratelimited = await domainStatus({ product: 'kintone-listkit', domain: 'ratelimit-test.cybozu.com' });
  assert.notEqual(ratelimited.status, 429, `${i}回目`);
}
d = await domainStatus({ product: 'kintone-listkit', domain: 'ratelimit-test.cybozu.com' });
assert.deepEqual([d.status, d.body.ok, d.body.status, d.body.reason], [429, false, 'rate_limited', 'rate_limited']);

// 12. 旧Chrome拡張(grid-edit-pro)の/verifyは今までどおり(/domain-statusの追加で壊れていない)
before = licenseKeys();
r = await webhook(checkout('pi_extension_check'));
const extKey = newKeysSince(before)[0];
const ve = await verify({ key: extKey });
assert.deepEqual([ve.status, ve.body.ok, ve.body.status, ve.body.kind], [200, true, 'active', 'lifetime']);
assert.equal(ve.body.product, undefined, '旧クライアント向けレスポンスは新フィールドを追加しない');
assert.equal(ve.body.purchased_at, undefined, '拡張向けレスポンスにpurchased_atは追加しない');

console.log('domain.test.mjs: 全部通りました');
