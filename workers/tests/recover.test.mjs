// POST /recover（ライセンスキーの再送）をローカルで通す(2026-10-21)。
// Stripe・Brevoには出ない(fetchを差し替える)。署名はテスト用の秘密で自分で付ける。
// 実行: node workers/tests/recover.test.mjs
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
const brevoCallsSince = (idx) => sent.slice(idx).filter((x) => x.url.includes('brevo'));

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
async function recover(body, ip = '9.9.9.9') {
  const res = await worker.fetch(new Request('http://x/recover', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'CF-Connecting-IP': ip }
  }), env);
  return { status: res.status, body: await res.json() };
}
const checkout = (pi, extra = {}) => ({ id: 'evt_' + pi, type: 'checkout.session.completed', created: 1790700000,
  data: { object: { mode: 'payment', payment_status: 'paid', payment_intent: pi, customer: 'cus_' + pi, customer_details: { email: 'carol@example.com' }, ...extra } } });

// 1. index経由で見つかる(lifetimeのactiveレコード) → ok:true・登録メールへ1通・キーを含む
{
  const key = 'case1-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  store.set('lic_' + key, JSON.stringify({ email: 'alice@example.com', status: 'active', kind: 'lifetime', product: 'grid-edit-pro' }));
  store.set('licemail_alice@example.com', JSON.stringify([key]));
  const before = sent.length;
  const r = await recover({ email: 'alice@example.com' }, 'ip-case1');
  assert.deepEqual([r.status, r.body.ok], [200, true]);
  const mail = brevoCallsSince(before)[0];
  assert.ok(mail && mail.body.includes(key), 'case1: 登録メールへキーを含むメールが1通送られる');
}

// 2. index無し・全件走査のフォールバックで見つかる → メール送信される
{
  const key = 'case2-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  store.set('lic_' + key, JSON.stringify({ email: 'bob@example.com', status: 'active', kind: 'lifetime', product: 'grid-edit-pro' }));
  // licemail_ index は意図的に作らない(フォールバック経路を通す)
  const before = sent.length;
  const r = await recover({ email: 'bob@example.com' }, 'ip-case2');
  assert.equal(r.body.ok, true);
  const mail = brevoCallsSince(before)[0];
  assert.ok(mail && mail.body.includes(key), 'case2: フォールバック経由でも見つかりメール送信される');
  assert.equal(store.get('licemail_bob@example.com'), undefined, 'case2: フォールバックはindexを書き込まない');
}

// 3. 見つからない → ok:true・メール無し
{
  const before = sent.length;
  const r = await recover({ email: 'nobody@example.com' }, 'ip-case3');
  assert.equal(r.body.ok, true);
  assert.equal(brevoCallsSince(before).length, 0, 'case3: 該当レコードが無ければメールを送らない');
}

// 4. トライアルのレコードしかない → メール無し
{
  const key = 'case4-cccc-cccc-cccc-cccccccccccc';
  store.set('lic_' + key, JSON.stringify({ email: 'trial@example.com', status: 'active', kind: 'trial', product: 'grid-edit-pro' }));
  const before = sent.length;
  const r = await recover({ email: 'trial@example.com' }, 'ip-case4');
  assert.equal(r.body.ok, true);
  assert.equal(brevoCallsSince(before).length, 0, 'case4: トライアルは再送の対象外');
}

// 5. 返金済みのレコードしかない → メール無し
{
  const key = 'case5-dddd-dddd-dddd-dddddddddddd';
  store.set('lic_' + key, JSON.stringify({ email: 'refunded@example.com', status: 'refunded', kind: 'lifetime', product: 'grid-edit-pro' }));
  const before = sent.length;
  const r = await recover({ email: 'refunded@example.com' }, 'ip-case5');
  assert.equal(r.body.ok, true);
  assert.equal(brevoCallsSince(before).length, 0, 'case5: refundedは再送の対象外');
}

// 6. メール単位のレート制限: 4回目(同じ時間内)はok:trueのまま送らない(最初の3回は送る)
{
  const key = 'case6-eeee-eeee-eeee-eeeeeeeeeeee';
  store.set('lic_' + key, JSON.stringify({ email: 'limituser@example.com', status: 'active', kind: 'lifetime', product: 'grid-edit-pro' }));
  for (let i = 0; i < 3; i++) {
    const before = sent.length;
    const r = await recover({ email: 'limituser@example.com' }, 'ip-case6');
    assert.equal(r.body.ok, true);
    assert.equal(brevoCallsSince(before).length, 1, `case6: ${i + 1}回目は送信される`);
  }
  const before4 = sent.length;
  const r4 = await recover({ email: 'limituser@example.com' }, 'ip-case6');
  assert.equal(r4.body.ok, true);
  assert.equal(brevoCallsSince(before4).length, 0, 'case6: 4回目はメール単位のレート制限で送らない');
}

// 7. IP単位のレート制限を超えると送らない(5回まで・6回目は別メールでもブロックされる)
{
  const ip = 'ip-case7';
  for (let i = 0; i < 5; i++) {
    const key = `case7-${i}-aaaa-aaaa-aaaa-aaaaaaaaaaaa`;
    const email = `ip7-${i}@example.com`;
    store.set('lic_' + key, JSON.stringify({ email, status: 'active', kind: 'lifetime', product: 'grid-edit-pro' }));
    const before = sent.length;
    const r = await recover({ email }, ip);
    assert.equal(r.body.ok, true);
    assert.equal(brevoCallsSince(before).length, 1, `case7: ${i + 1}回目(IP制限内)は送信される`);
  }
  const key6 = 'case7-5-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  const email6 = 'ip7-5@example.com';
  store.set('lic_' + key6, JSON.stringify({ email: email6, status: 'active', kind: 'lifetime', product: 'grid-edit-pro' }));
  const before6 = sent.length;
  const r6 = await recover({ email: email6 }, ip);
  assert.equal(r6.body.ok, true);
  assert.equal(brevoCallsSince(before6).length, 0, 'case7: 6回目はIP単位のレート制限で送らない');
}

// 8. webhook(買い切り発行)がlicemail_indexを書く → /recoverがそれで見つける
{
  const wr = await webhook(checkout('pi_case8'));
  assert.equal(wr.body.action, 'key_issued');
  const idxRaw = store.get('licemail_carol@example.com');
  assert.ok(idxRaw, 'case8: webhookの発行でlicemail_indexが書かれる');
  const issuedKey = JSON.parse(idxRaw)[0];

  const before = sent.length;
  const r = await recover({ email: 'carol@example.com' }, 'ip-case8');
  assert.equal(r.body.ok, true);
  const mail = brevoCallsSince(before)[0];
  assert.ok(mail && mail.body.includes(issuedKey), 'case8: webhookで発行したキーが再送メールに入る');
}

// 9. product指定が一致しない → メール無し(未知のproductでも同様にok:trueのまま何もしない)
{
  const key = 'case9-ffff-ffff-ffff-ffffffffffff';
  store.set('lic_' + key, JSON.stringify({ email: 'dave@example.com', status: 'active', kind: 'lifetime', product: 'kintone-gallery' }));
  const before = sent.length;
  const r = await recover({ email: 'dave@example.com', product: 'kintone-listkit' }, 'ip-case9a');
  assert.equal(r.body.ok, true);
  assert.equal(brevoCallsSince(before).length, 0, 'case9: productが一致しなければ送らない');

  const before2 = sent.length;
  const r2 = await recover({ email: 'dave@example.com', product: 'no-such-product' }, 'ip-case9b');
  assert.equal(r2.body.ok, true);
  assert.equal(brevoCallsSince(before2).length, 0, 'case9: 未知のproductでもok:trueのまま何もしない');
}

// 10. 複数プロダクトの複数キー → 1通にまとめて両方のキーが入る
{
  const keyA = 'case10-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  const keyB = 'case10-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  store.set('lic_' + keyA, JSON.stringify({ email: 'erin@example.com', status: 'active', kind: 'lifetime', product: 'grid-edit-pro' }));
  store.set('lic_' + keyB, JSON.stringify({ email: 'erin@example.com', status: 'active', kind: 'lifetime', product: 'kintone-listkit' }));
  store.set('licemail_erin@example.com', JSON.stringify([keyA, keyB]));
  const before = sent.length;
  const r = await recover({ email: 'erin@example.com' }, 'ip-case10');
  assert.equal(r.body.ok, true);
  const mail = brevoCallsSince(before)[0];
  assert.ok(mail && mail.body.includes(keyA) && mail.body.includes(keyB), 'case10: 1通に両方のキーが入る');
}

// 11. +エイリアス・大文字小文字の揺れは同じレコードに正規化される
{
  const key = 'case11-cccc-cccc-cccc-cccccccccccc';
  store.set('lic_' + key, JSON.stringify({ email: 'frank@example.com', status: 'active', kind: 'lifetime', product: 'grid-edit-pro' }));
  store.set('licemail_frank@example.com', JSON.stringify([key]));
  const before = sent.length;
  const r = await recover({ email: 'Frank+test@Example.com' }, 'ip-case11');
  assert.equal(r.body.ok, true);
  const mail = brevoCallsSince(before)[0];
  assert.ok(mail && mail.body.includes(key), 'case11: +エイリアス/大文字小文字が同じレコードに正規化される');
}

// 12. 不正なメール・壊れたJSONボディでもok:true(500にしない)
{
  const r = await recover({ email: 'not-an-email' }, 'ip-case12a');
  assert.equal(r.body.ok, true);
  const res = await worker.fetch(new Request('http://x/recover', { method: 'POST', body: '{not json', headers: { 'CF-Connecting-IP': 'ip-case12b' } }), env);
  assert.deepEqual([res.status, (await res.json()).ok], [200, true]);
}

console.log('recover.test.mjs: 全部通りました');
