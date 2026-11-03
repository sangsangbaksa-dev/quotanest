const test = require('node:test');
const assert = require('node:assert/strict');
const { check } = require('../lib/license-core.js');

const fakeFetch = (status, json) => async () => ({ status, json: async () => json });
const call = (body, env, fetchFn) => check({ method: 'POST', body, env: env || {}, fetchFn: fetchFn || fakeFetch(200, {}) });

test('licence: GET is refused, disabled config reports not configured', async () => {
  assert.equal((await check({ method: 'GET', body: null, env: {}, fetchFn: fakeFetch(200, {}) })).status, 405);
  const r = await call({ key: 'ABCDEFGH-1234' }, { LEMONSQUEEZY_DISABLED: '1' });
  assert.deepEqual(r.body, { configured: false });
});

test('licence: bad key shape is rejected before any network call', async () => {
  let called = false;
  const r = await call({ key: 'no' }, {}, async () => { called = true; return {}; });
  assert.equal(r.status, 400);
  assert.equal(called, false);
});

test('licence: valid active key unlocks; wrong product or refund does not', async () => {
  const good = { valid: true, meta: { product_id: 42 }, license_key: { status: 'active' } };
  assert.equal((await call({ key: 'ABCDEFGH-1234' }, { LEMONSQUEEZY_PRODUCT_ID: '42' }, fakeFetch(200, good))).body.ok, true);
  assert.equal((await call({ key: 'ABCDEFGH-1234' }, { LEMONSQUEEZY_PRODUCT_ID: '7' }, fakeFetch(200, good))).body.reason, 'invalid');
  const refunded = { valid: true, meta: { product_id: 42 }, license_key: { status: 'expired' } };
  assert.equal((await call({ key: 'ABCDEFGH-1234' }, { LEMONSQUEEZY_PRODUCT_ID: '42' }, fakeFetch(200, refunded))).body.reason, 'refunded');
});

test('licence: upstream outage maps to unreachable', async () => {
  const r = await call({ key: 'ABCDEFGH-1234' }, {}, fakeFetch(503, {}));
  assert.equal(r.status, 502);
  assert.equal(r.body.reason, 'unreachable');
});
