// Entirely synthetic, local test data. NOT production observations or registry state.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createLiveNetworkReader, parseBoundedJson, LiveNetworkError } from '../web/live-network.js';
const T = 1800000000000;
const BASE = 'https://minepoa.com/chain/poa-mainnet-1/api/';
const enc = new TextEncoder();
const clone = x => JSON.parse(JSON.stringify(x));
const goodStatus = () => ({ chain_id: 'poa-mainnet-1', checkpoint: { height: 100, cutoff_ts: T / 1000 - 21600 }, epochs_closed: 57, agents_joined: 99, txs: 20, final: 19, K: 5 });
const goodFacts = () => ({ chain_id: 'poa-mainnet-1', open_epoch: 57, engine_sha256: 'a'.repeat(64), params_sha256: 'b'.repeat(64), economics: { K: 5, rate: 0.25 } });
function response(data, url, settings = {}) {
  const bytes = settings.bytes ?? enc.encode(typeof data === 'string' ? data : JSON.stringify(data));
  const headers = new Headers({ 'Content-Type': 'application/json; charset=utf-8', ...settings.headers });
  return {
    status: settings.status ?? 200, redirected: settings.redirected ?? false,
    url: settings.url ?? url, headers,
    body: settings.body ?? new ReadableStream({ start(c) { c.enqueue(bytes); c.close(); } }),
  };
}
function setup({ status = goodStatus(), facts = goodFacts(), now = () => T, handler } = {}) {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url, init });
    return handler ? handler(url, init, calls.length) : response(url.endsWith('/status') ? status : facts, url);
  };
  return { reader: createLiveNetworkReader({ fetch, now }), calls };
}
async function code(promise, expected) {
  await assert.rejects(promise, e => {
    assert.ok(e instanceof LiveNetworkError); assert.equal(e.code, expected);
    assert.ok(!e.message.includes('SECRET')); assert.equal(Object.isFrozen(e), true); return true;
  });
}
function parse(text) { return parseBoundedJson(enc.encode(text)); }

test('good shape, exact contract, frozen output and fixed request capabilities', async () => {
  const { reader, calls } = setup(); const o = await reader.observe();
  assert.deepEqual(o, {
    kind: 'native-network-observation', source: 'https://minepoa.com', chainId: 'poa-mainnet-1',
    observedAt: T, expiresAt: T + 900000, verification: 'node-reported-unverified', finalityVerified: false, registryReady: false,
    checkpoint: { height: 100, cutoffTs: T / 1000 - 21600 }, epochsClosed: 57, agentsJoined: 99,
    transactions: 20, reportedFinalTransactions: 19, attestationThreshold: 5,
    engineSha256: 'a'.repeat(64), paramsSha256: 'b'.repeat(64),
  });
  assert.equal(Object.isFrozen(o), true); assert.equal(Object.isFrozen(o.checkpoint), true);
  assert.deepEqual(calls.map(x => x.url), [BASE + 'status', BASE + 'network-facts']);
  for (const { init } of calls) {
    assert.deepEqual(Object.keys(init).sort(), ['cache', 'credentials', 'headers', 'method', 'redirect', 'signal']);
    assert.deepEqual(init.headers, { Accept: 'application/json' });
    assert.equal(init.method, 'GET'); assert.equal(init.credentials, 'omit'); assert.equal(init.redirect, 'error'); assert.equal(init.cache, 'no-store');
    assert.ok(init.signal instanceof AbortSignal);
  }
});
test('coalesces parallel observations to the exact same promise; later refresh makes two new GETs', async () => {
  const { reader, calls } = setup(); const a = reader.observe(); const b = reader.observe();
  assert.equal(a, b); await a; assert.equal(calls.length, 2); await reader.observe(); assert.equal(calls.length, 4);
});
for (const options of [{ url: 'https://evil.invalid' }, { endpoint: BASE }, { timeoutMs: 1 }, { fetch: 42 }, { now: 1 }, null, []]) {
  test(`refuses unsupported dependency options ${JSON.stringify(options)}`, () => assert.throws(() => createLiveNetworkReader(options), { code: 'INVALID_OPTIONS' }));
}
const transportCases = [
  ['redirected flag', { redirected: true }, 'REDIRECT_REFUSED'],
  ['different exact URL', { url: BASE + 'status?SECRET=x' }, 'REDIRECT_REFUSED'],
  ['blank response URL', { url: '' }, 'REDIRECT_REFUSED'],
  ['redirect response status', { status: 302 }, 'REDIRECT_REFUSED'],
  ['HTTP429', { status: 429 }, 'HTTP_RATE_LIMITED'],
  ['HTTP503', { status: 503 }, 'HTTP_UNAVAILABLE'],
  ['HTTP500', { status: 500 }, 'HTTP_ERROR'],
  ['nonfinal HTTP202', { status: 202 }, 'HTTP_ERROR'],
  ['HTML content', { headers: { 'Content-Type': 'text/html' } }, 'INVALID_CONTENT_TYPE'],
  ['unrelated JSON prefix', { headers: { 'Content-Type': 'application/jsonp' } }, 'INVALID_CONTENT_TYPE'],
  ['oversized declared length', { headers: { 'Content-Length': '65537' } }, 'RESPONSE_TOO_LARGE'],
  ['invalid declared length', { headers: { 'Content-Length': '-1' } }, 'RESPONSE_TOO_LARGE'],
  ['unsafe declared length', { headers: { 'Content-Length': '9007199254740992' } }, 'RESPONSE_TOO_LARGE'],
  ['excessive age', { headers: { Age: '301' } }, 'STALE_RESPONSE'],
  ['invalid age', { headers: { Age: 'no' } }, 'STALE_RESPONSE'],
  ['negative age', { headers: { Age: '-1' } }, 'STALE_RESPONSE'],
  ['fractional age', { headers: { Age: '0.1' } }, 'STALE_RESPONSE'],
  ['unsafe age', { headers: { Age: '9007199254740992' } }, 'STALE_RESPONSE'],
  ['invalid UTF8', { bytes: new Uint8Array([0xc3, 0x28]) }, 'INVALID_UTF8'],
  ['JSON trailing content', { bytes: enc.encode('{}SECRET') }, 'INVALID_JSON'],
];
for (const [name, settings, expected] of transportCases) {
  test(name, async () => {
    const { reader } = setup({ handler: (url) => response(url.endsWith('/status') ? goodStatus() : goodFacts(), url, settings) });
    await code(reader.observe(), expected);
  });
}
test('accepts exact Age boundary and application/*+json', async () => {
  const { reader } = setup({ handler: url => response(url.endsWith('/status') ? goodStatus() : goodFacts(), url, { headers: { Age: '300', 'Content-Type': 'application/problem+json' } }) });
  await reader.observe();
});
test('response without a URL property is permitted, not a configurable target', async () => {
  const { reader } = setup({ handler: url => { const r = response(url.endsWith('/status') ? goodStatus() : goodFacts(), url); delete r.url; return r; } }); await reader.observe();
});
test('stream oversize without trustworthy declared size is rejected and canceled', async () => {
  let canceled = 0;
  const { reader } = setup({ handler: url => response({}, url, { headers: { 'Content-Length': '1' }, body: new ReadableStream({ start(c) { c.enqueue(new Uint8Array(32768)); c.enqueue(new Uint8Array(32769)); }, cancel() { canceled++; } }) }) });
  await code(reader.observe(), 'RESPONSE_TOO_LARGE'); assert.ok(canceled > 0);
});
test('zero-byte infinite streams have a finite read-count limit', async () => {
  const { reader } = setup({ handler: url => response({}, url, { body: new ReadableStream({ pull(c) { c.enqueue(new Uint8Array()); } }) }) });
  await code(reader.observe(), 'INVALID_RESPONSE');
});
test('exact 65536 byte JSON body can be parsed; 65537 cannot', () => {
  const text = '"' + 'a'.repeat(65534) + '"'; assert.equal(parse(text).length, 65534);
  assert.throws(() => parse(text + ' '), { code: 'RESPONSE_TOO_LARGE' });
});
for (const [name, raw, expected] of [
  ['duplicate key', '{"a":1,"a":2}', 'DUPLICATE_JSON_KEY'],
  ['escaped duplicate key', '{"a":1,"\\u0061":2}', 'DUPLICATE_JSON_KEY'],
  ['nested duplicate key', '{"x":[{"a":1,"a":2}]}', 'DUPLICATE_JSON_KEY'],
  ['proto key', '{"__proto__":1}', 'UNSAFE_JSON_KEY'],
  ['escaped unsafe key', '{"\\u0063onstructor":1}', 'UNSAFE_JSON_KEY'],
  ['nested unsafe key', '{"x":{"prototype":1}}', 'UNSAFE_JSON_KEY'],
  ['depth over24', '['.repeat(25) + '0' + ']'.repeat(25), 'JSON_LIMIT'],
  ['array over256', JSON.stringify(Array(257).fill(0)), 'JSON_LIMIT'],
  ['object over256', JSON.stringify(Object.fromEntries(Array.from({ length: 257 }, (_, i) => ['k' + i, 0]))), 'JSON_LIMIT'],
  ['overflow number', '1e9999', 'INVALID_JSON'],
  ['unsafe integer', '9007199254740992', 'INVALID_JSON'],
  ['fraction rounded to integer', '1.000000000000000001', 'INVALID_JSON'],
  ['underflow rounded to zero', '1e-9999', 'INVALID_JSON'],
  ['NaN', 'NaN', 'INVALID_JSON'],
  ['trailing comma', '{"a":1,}', 'INVALID_JSON'],
  ['missing separator', '[1 2]', 'INVALID_JSON'],
  ['invalid escape', '"\\x00"', 'INVALID_JSON'],
  ['control character', '"\n"', 'INVALID_JSON'],
  ['leading zero', '01', 'INVALID_JSON'],
]) {
  test('parser: ' + name, () => assert.throws(() => parse(raw), { code: expected }));
}
test('parser accepts boundary structures and ordinary numeric notation', () => {
  assert.equal(parse('['.repeat(24) + '0' + ']'.repeat(24)).length, 1);
  assert.equal(parse(JSON.stringify(Array(256).fill(0))).length, 256);
  assert.equal(Object.keys(parse(JSON.stringify(Object.fromEntries(Array.from({ length: 256 }, (_, i) => ['k' + i, 0]))))).length, 256);
  assert.equal(parse('1e3'), 1000); assert.equal(parse('1.0'), 1); assert.equal(parse('0.25'), 0.25);
});
const schemaCases = [
  ['wrong status chain', s => { s.chain_id = 'SECRET'; }, null, 'CHAIN_MISMATCH'],
  ['wrong facts chain', null, f => { f.chain_id = 'other'; }, 'CHAIN_MISMATCH'],
  ['missing chain', s => { delete s.chain_id; }, null, 'INVALID_SCHEMA'],
  ['missing checkpoint', s => { delete s.checkpoint; }, null, 'INVALID_SCHEMA'],
  ['array checkpoint', s => { s.checkpoint = []; }, null, 'INVALID_SCHEMA'],
  ['negative height', s => { s.checkpoint.height = -1; }, null, 'INVALID_SCHEMA'],
  ['fractional count', s => { s.txs = 1.2; }, null, 'INVALID_SCHEMA'],
  ['string count', s => { s.agents_joined = '99'; }, null, 'INVALID_SCHEMA'],
  ['null count', s => { s.final = null; }, null, 'INVALID_SCHEMA'],
  ['boolean count', s => { s.epochs_closed = true; }, null, 'INVALID_SCHEMA'],
  ['unsafe count', s => { s.txs = Number.MAX_SAFE_INTEGER + 1; }, null, 'INVALID_JSON'],
  ['zero K', s => { s.K = 0; }, null, 'INVALID_SCHEMA'],
  ['K over256', s => { s.K = 257; }, null, 'INVALID_SCHEMA'],
  ['facts K over256', null, f => { f.economics.K = 257; }, 'INVALID_SCHEMA'],
  ['K mismatch', null, f => { f.economics.K = 6; }, 'CONSISTENCY_MISMATCH'],
  ['epoch mismatch', null, f => { f.open_epoch = 58; }, 'CONSISTENCY_MISMATCH'],
  ['final exceeds txs', s => { s.final = 21; }, null, 'CONSISTENCY_MISMATCH'],
  ['uppercase digest', null, f => { f.engine_sha256 = 'A'.repeat(64); }, 'INVALID_SCHEMA'],
  ['short digest', null, f => { f.params_sha256 = 'b'.repeat(63); }, 'INVALID_SCHEMA'],
  ['future checkpoint', s => { s.checkpoint.cutoff_ts = T / 1000 + 301; }, null, 'FUTURE_CHECKPOINT'],
  ['negative cutoff', s => { s.checkpoint.cutoff_ts = -1; }, null, 'INVALID_SCHEMA'],
];
for (const [name, changeS, changeF, expected] of schemaCases) {
  test('schema: ' + name, async () => {
    const status = goodStatus(), facts = goodFacts(); changeS?.(status); changeF?.(facts);
    await code(setup({ status, facts }).reader.observe(), expected);
  });
}
test('safe count limits, K256, and future cutoff tolerance boundary', async () => {
  const status = goodStatus(), facts = goodFacts();
  status.txs = status.final = status.agents_joined = Number.MAX_SAFE_INTEGER;
  status.K = facts.economics.K = 256; status.checkpoint.cutoff_ts = T / 1000 + 300;
  await setup({ status, facts }).reader.observe();
});
for (const [name, modify, expected] of [
  ['checkpoint height rollback', (s) => { s.checkpoint.height--; }, 'CHECKPOINT_ROLLBACK'],
  ['checkpoint cutoff rollback', (s) => { s.checkpoint.height++; s.checkpoint.cutoff_ts--; }, 'CHECKPOINT_ROLLBACK'],
  ['epoch rollback', (s, f) => { s.epochs_closed--; f.open_epoch--; }, 'EPOCH_ROLLBACK'],
  ['engine drift', (_, f) => { f.engine_sha256 = 'c'.repeat(64); }, 'HASH_DRIFT'],
  ['params drift', (_, f) => { f.params_sha256 = 'd'.repeat(64); }, 'HASH_DRIFT'],
]) {
  test(name + ' is sticky and never returns a previous result', async () => {
    const status = goodStatus(), facts = goodFacts(); const { reader, calls } = setup({ status, facts });
    const first = await reader.observe(); modify(status, facts); await code(reader.observe(), expected);
    Object.assign(status, goodStatus()); Object.assign(facts, goodFacts()); await code(reader.observe(), expected);
    assert.equal(calls.length, 4); assert.equal(first.registryReady, false);
  });
}
test('chain incident is sticky even without previous success', async () => {
  const status = goodStatus(); status.chain_id = 'other'; const { reader, calls } = setup({ status });
  await code(reader.observe(), 'CHAIN_MISMATCH'); status.chain_id = 'poa-mainnet-1'; await code(reader.observe(), 'CHAIN_MISMATCH'); assert.equal(calls.length, 2);
});
test('clock rollback is sticky before a second network request', async () => {
  let t = T; const { reader, calls } = setup({ now: () => t }); await reader.observe();
  t--; await code(reader.observe(), 'CLOCK_ROLLBACK'); t = T + 100; await code(reader.observe(), 'CLOCK_ROLLBACK'); assert.equal(calls.length, 2);
});
test('clock rollback within one observation fails closed', async () => {
  let n = 0; const { reader } = setup({ now: () => n++ ? T - 1 : T }); await code(reader.observe(), 'CLOCK_ROLLBACK');
});
test('overall wall clock jump beyond22 seconds is sticky', async () => {
  let n = 0; const { reader } = setup({ now: () => n++ ? T + 22001 : T }); await code(reader.observe(), 'CLOCK_JUMP'); await code(reader.observe(), 'CLOCK_JUMP');
});
for (const n of [NaN, Infinity, -1, T + 0.5, Number.MAX_SAFE_INTEGER]) {
  test('invalid clock ' + n, async () => code(setup({ now: () => n }).reader.observe(), 'CLOCK_INVALID'));
}
test('throwing clock is sanitized', async () => code(setup({ now: () => { throw new Error('SECRET'); } }).reader.observe(), 'CLOCK_INVALID'));
test('transient failures do not return prior data and a later clean retry remains possible', async () => {
  let broken = false;
  const { reader } = setup({ handler: url => { if (broken) throw new Error('SECRET URL'); return response(url.endsWith('/status') ? goodStatus() : goodFacts(), url); } });
  await reader.observe(); broken = true; await code(reader.observe(), 'NETWORK_ERROR'); broken = false; await reader.observe();
});
test('network AbortError has fixed safe public error', async () => {
  const { reader } = setup({ handler: () => { throw new DOMException('SECRET', 'AbortError'); } }); await code(reader.observe(), 'ABORTED');
});
test('early failure explicitly cancels a sibling ignoring AbortSignal and hanging cancel', async () => {
  let canceled = 0, aborted = false;
  const { reader } = setup({ handler: (url, init) => {
    if (url.endsWith('/status')) return response({}, url, { status: 503 });
    init.signal.addEventListener('abort', () => { aborted = true; });
    return response({}, url, { body: { getReader() { return { read: () => new Promise(() => {}), cancel() { canceled++; return new Promise(() => {}); }, releaseLock() {} }; } } });
  } });
  await code(reader.observe(), 'HTTP_UNAVAILABLE'); await new Promise(r => setImmediate(r)); assert.ok(canceled); assert.equal(aborted, true);
});
test('hard deadlines cover ignored fetch abort, hanging reads/cancel, and late response cleanup', { timeout: 14000 }, async () => {
  const signals = []; let canceled = 0, resolveLate;
  const neverFetch = setup({ handler: (_, init) => { signals.push(init.signal); return new Promise(() => {}); } });
  const neverRead = setup({ handler: (url, init) => { signals.push(init.signal); return response({}, url, { body: { getReader() { return { read: () => new Promise(() => {}), cancel() { canceled++; return new Promise(() => {}); }, releaseLock() {} }; } } }); } });
  const late = setup({ handler: (url, init) => {
    signals.push(init.signal);
    if (url.endsWith('/status')) return new Promise(resolve => { resolveLate = () => resolve(response({}, url, { body: { cancel() { canceled++; return new Promise(() => {}); } } })); });
    return response(goodFacts(), url);
  } });
  const started = performance.now();
  await Promise.all([code(neverFetch.reader.observe(), 'TIMEOUT'), code(neverRead.reader.observe(), 'TIMEOUT'), code(late.reader.observe(), 'TIMEOUT')]);
  assert.ok(performance.now() - started < 13000); assert.ok(signals.every(s => s.aborted)); assert.ok(canceled > 0);
  const before = canceled; resolveLate(); await new Promise(r => setImmediate(r)); assert.ok(canceled > before);
});
test('hostile rejection properties cannot escape as raw errors', async () => {
  const { reader } = setup({ handler: () => Promise.reject({ get name() { throw new Error('SECRET'); } }) });
  await code(reader.observe(), 'NETWORK_ERROR');
});
test('empty body and malformed stream chunks fail closed', async () => {
  const empty = setup({ handler: url => response('', url) }); await code(empty.reader.observe(), 'INVALID_JSON');
  const bad = setup({ handler: url => response({}, url, { body: { getReader() { return { read: async () => ({ done: false, value: 'SECRET' }), cancel() {}, releaseLock() {} }; } } }) });
  await code(bad.reader.observe(), 'INVALID_RESPONSE');
});
test('root arrays, scalars, and missing economics cannot form observations', async () => {
  for (const status of [[], null, 0, '"text"']) await code(setup({ status }).reader.observe(), 'INVALID_SCHEMA');
  const facts = goodFacts(); delete facts.economics; await code(setup({ facts }).reader.observe(), 'INVALID_SCHEMA');
});
test('untrusted optional strings and flags cannot escape the exact safe output contract', async () => {
  const status = goodStatus(), facts = goodFacts();
  status.registryReady = true; status.finalityVerified = true;
  status.html = '<img src=x onerror=SECRET>'; facts.note = '<script>SECRET</script>';
  const result = await setup({ status, facts }).reader.observe();
  assert.equal(result.registryReady, false); assert.equal(result.finalityVerified, false);
  assert.equal(JSON.stringify(result).includes('SECRET'), false);
  assert.equal(Object.hasOwn(result, 'html'), false); assert.equal(Object.hasOwn(result, 'note'), false);
});

test('same-height changed cutoff is a sticky checkpoint incident in either direction', async () => {
  for (const delta of [-1, 1]) {
    const status = goodStatus(); const { reader, calls } = setup({ status }); await reader.observe();
    status.checkpoint.cutoff_ts += delta; await code(reader.observe(), 'CHECKPOINT_MISMATCH');
    status.checkpoint.cutoff_ts -= delta; await code(reader.observe(), 'CHECKPOINT_MISMATCH'); assert.equal(calls.length, 4);
  }
});
test('unchanged checkpoint is accepted across refresh; newer height with unchanged cutoff is monotonic', async () => {
  const status = goodStatus(); const { reader } = setup({ status }); await reader.observe(); await reader.observe();
  status.checkpoint.height++; await reader.observe();
});
test('observation and expiry stay within exact safe numbers and representable Date range', async () => {
  const limit = 8640000000000000 - 900000;
  const result = await setup({ now: () => limit }).reader.observe();
  assert.equal(result.expiresAt, 8640000000000000);
  assert.equal(Number.isSafeInteger(result.observedAt), true); assert.equal(Number.isSafeInteger(result.expiresAt), true);
  assert.ok(Number.isFinite(new Date(result.expiresAt).getTime()));
  await code(setup({ now: () => limit + 1 }).reader.observe(), 'CLOCK_INVALID');
});
