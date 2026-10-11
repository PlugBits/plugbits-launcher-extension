// kintoneプラグイン3本(サブテーブルギャラリー化・PlugBits ListKit・文字列条件分岐ビルダー)用の
// product/domain対応をローカルで通す(2026-10-11)。Stripe・Brevoには出ない(fetchを差し替える)。
// 実行: node workers/tests/product.test.mjs
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
const licenseKeys = () => [...store.keys()].filter((k) => k.startsWith('lic_')).map((k) => k.slice(4));

const checkout = (pi, extra = {}) => ({ id: 'evt_' + pi, type: 'checkout.session.completed', created: 1790700000,
  data: { object: { mode: 'payment', payment_status: 'paid', payment_intent: pi, customer: 'cus_test1', customer_details: { email: 'buyer@example.com' }, ...extra } } });

// 1. 旧レコード(productフィールド無し)は product パラメータ無しなら今までどおり検証できる
const legacyKey = 'legacy-0000-0000-0000-000000000000';
store.set('lic_' + legacyKey, JSON.stringify({ email: 'old@example.com', status: 'active', kind: 'lifetime', stripe_customer_id: 'cus_old', expiry: '' }));
let v = await verify({ key: legacyKey });
assert.deepEqual([v.status, v.body.ok, v.body.status], [200, true, 'active']);
assert.equal(v.body.product, undefined, '旧クライアント向けレスポンスは新フィールドを追加しない');

// 2. metadata.product=kintone-listkit + custom_fields.kintonedomain → product/domain を保存
let r = await webhook(checkout('pi_listkit', {
  metadata: { product: 'kintone-listkit' },
  custom_fields: [{ key: 'kintonedomain', text: { value: 'https://Acme.cybozu.com/k/1' } }]
}));
assert.deepEqual([r.status, r.body.action, r.body.kind], [200, 'key_issued', 'lifetime']);
let newKeys = licenseKeys().filter((k) => k !== legacyKey);
assert.equal(newKeys.length, 1);
const listkitKey = newKeys[0];
let rec = JSON.parse(store.get('lic_' + listkitKey));
assert.equal(rec.product, 'kintone-listkit');
assert.equal(rec.domain, 'acme.cybozu.com', 'スキーム・パスを除去して正規化される');
const mail = sent.find((x) => x.url.includes('brevo') && x.body.includes(listkitKey));
assert.ok(mail && mail.body.includes('ライセンス」欄'), 'kintone向けメールは設定画面のライセンス欄を案内する');

// 3. metadataが無いPayment Link(既存のLauncher用)は grid-edit-pro になる
r = await webhook(checkout('pi_plain'));
newKeys = licenseKeys().filter((k) => k !== legacyKey && k !== listkitKey);
assert.equal(newKeys.length, 1);
const plainKey = newKeys[0];
rec = JSON.parse(store.get('lic_' + plainKey));
assert.equal(rec.product, 'grid-edit-pro');
assert.equal(rec.domain, undefined, 'grid-edit-proはdomainフィールドを持たない');

// 4. /verify?product=... で product_mismatch
v = await verify({ key: plainKey, product: 'kintone-gallery' });
assert.deepEqual([v.body.ok, v.body.status, v.body.reason], [false, 'product_mismatch', 'product_mismatch']);
assert.equal(v.body.email, undefined, '不一致時は他のフィールドを漏らさない');

// 5. kintone-listkitキーの最初の /verify でドメインが束縛され、別ドメインからは domain_mismatch
v = await verify({ key: listkitKey, product: 'kintone-listkit', domain: 'acme.cybozu.com' });
assert.deepEqual([v.body.ok, v.body.status, v.body.domain, v.body.product], [true, 'active', 'acme.cybozu.com', 'kintone-listkit']);
assert.equal(v.body.email, undefined, 'kintone向けレスポンスはemail/stripe idを含まない');
assert.equal(v.body.stripe_customer_id, undefined);

v = await verify({ key: listkitKey, product: 'kintone-listkit', domain: 'other-corp.cybozu.com' });
assert.deepEqual([v.body.ok, v.body.status, v.body.reason], [false, 'domain_mismatch', 'domain_mismatch']);

// 6. ドメイン未指定/不正なドメインは 400 missing_domain
v = await verify({ key: listkitKey, product: 'kintone-listkit' });
assert.deepEqual([v.status, v.body.reason], [400, 'missing_domain']);
v = await verify({ key: listkitKey, product: 'kintone-listkit', domain: 'not-a-kintone-host.example.com' });
assert.deepEqual([v.status, v.body.reason], [400, 'missing_domain']);

// 7. /trial: ドメインが無効なら400
r = await trial({ product: 'kintone-rule-builder', domain: 'https://evil.example.com' });
assert.deepEqual([r.status, r.body.reason], [400, 'invalid_domain']);

// 8. /trial: kintone系はドメイン単位で1回だけ発行・2回目は同じキーで reused:true
r = await trial({ product: 'kintone-rule-builder', domain: 'https://tenant1.cybozu.com/k/5' });
assert.deepEqual([r.status, r.body.ok, r.body.status, r.body.reused], [200, true, 'active', false]);
const trialKey = r.body.license_key;
assert.ok(trialKey, 'license_keyが返る');
const trialRec = JSON.parse(store.get('lic_' + trialKey));
assert.equal(trialRec.product, 'kintone-rule-builder');
assert.equal(trialRec.domain, 'tenant1.cybozu.com');
assert.equal(trialRec.email, '');
assert.equal(trialRec.kind, 'trial');

r = await trial({ product: 'kintone-rule-builder', domain: 'tenant1.cybozu.com' });
assert.deepEqual([r.body.ok, r.body.status, r.body.reused, r.body.license_key], [true, 'active', true, trialKey]);

// 他プロダクト・ドメインなら別キーが発行される(同じdomainでもproductが違えば独立)
r = await trial({ product: 'kintone-listkit', domain: 'tenant1.cybozu.com' });
assert.notEqual(r.body.license_key, trialKey);

// 9. 期限切れのkintoneトライアルは /verify が trial_expired を返す
const expiredRec = { ...trialRec, expiry: new Date(Date.now() - 1000).toISOString() };
store.set('lic_' + trialKey, JSON.stringify(expiredRec));
v = await verify({ key: trialKey, product: 'kintone-rule-builder', domain: 'tenant1.cybozu.com' });
assert.deepEqual([v.body.ok, v.body.status, v.body.reason], [false, 'trial_expired', 'trial_expired']);

// 10. 期限切れkintoneトライアルの2回目 /trial も trial_expired を reused:true で返す
r = await trial({ product: 'kintone-rule-builder', domain: 'tenant1.cybozu.com' });
assert.deepEqual([r.body.ok, r.body.status, r.body.reused, r.body.license_key], [false, 'trial_expired', true, trialKey]);

// 11. grid-edit-pro(product無し)の既存トライアル経路は影響を受けない(メール必須のまま)
r = await trial({ email: 'notkintone@example.com' });
assert.equal(r.body.ok, true);
assert.equal(r.body.key !== undefined, true);

console.log('product.test.mjs: 全部通りました');
