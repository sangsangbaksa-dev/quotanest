/* Licence check for Quotanest, used by functions/api/license.js (Cloudflare Pages Function).
   check({ method, body, env, fetchFn }) -> { status, body }. The only I/O is the Lemon Squeezy License API
   (POST https://api.lemonsqueezy.com/v1/licenses/validate). It sends only the key; nothing is stored or logged.
   Optional env LEMONSQUEEZY_PRODUCT_ID pins keys to Quotanest. LEMONSQUEEZY_DISABLED=1 answers { configured: false }. */
const LS_VALIDATE = 'https://api.lemonsqueezy.com/v1/licenses/validate';
const KEY_RE = /^[A-Za-z0-9-]{8,80}$/;

async function check({ method, body, env, fetchFn }) {
  const disabled = !!(env && env.LEMONSQUEEZY_DISABLED);
  const product = env && env.LEMONSQUEEZY_PRODUCT_ID;
  if (method !== 'POST') return { status: 405, body: { ok: false, reason: 'method' } };
  if (disabled) return { status: 200, body: { configured: false } };
  if (!body || typeof body.key !== 'string' || !KEY_RE.test(body.key.trim())) return { status: 400, body: { configured: true, ok: false, reason: 'bad_request' } };
  const key = body.key.trim();
  let j, status;
  try {
    const r = await fetchFn(LS_VALIDATE, {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ license_key: key }).toString()
    });
    status = r.status;
    j = await r.json();
  } catch (e) { return { status: 502, body: { configured: true, ok: false, reason: 'unreachable' } }; }
  if (status >= 500 || status === 429) return { status: 502, body: { configured: true, ok: false, reason: 'unreachable' } };
  if (!j || j.valid !== true) return { status: 200, body: { configured: true, ok: false, reason: 'invalid' } };
  if (product && String(j.meta && j.meta.product_id) !== String(product)) return { status: 200, body: { configured: true, ok: false, reason: 'invalid' } };
  // Refunds disable the key; only an active (or not yet activated) key unlocks the app.
  const st = j.license_key && j.license_key.status;
  if (st !== 'active' && st !== 'inactive') return { status: 200, body: { configured: true, ok: false, reason: 'refunded' } };
  return { status: 200, body: { configured: true, ok: true, instanceId: '' } };
}
module.exports = { check, KEY_RE };
