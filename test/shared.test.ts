import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyJq } from '../src/shared/jq.js';
import { fit, overview } from '../src/shared/limit.js';
import { clearPause, describePause, enqueue, getPause, setPause } from '../src/shared/queue.js';

test('jq returns one output as is and several as an array', async () => {
  assert.equal(await applyJq({ a: 1 }, '.a'), 1);
  assert.deepEqual(await applyJq({ a: [1, 2] }, '.a[]'), [1, 2]);
  assert.deepEqual(await applyJq({ a: [] }, '.a[]'), []);
  await assert.rejects(applyJq({ a: 1 }, '.a | nope'), /nope\/0 is not defined/);
});

test('fit passes small bodies and turns big ones into an overview', () => {
  assert.deepEqual(fit({ a: 1 }), { body: { a: 1 } });
  const big = { pageInfo: { url: '/x' }, widgets: { tileGridDesktop: { items: 'x'.repeat(30_000) }, header: { a: 1 } } };
  const result = fit(big);
  assert.ok('overview' in result);
  assert.deepEqual(result.overview, { pageInfo: { url: '/x' }, widgets: { tileGridDesktop: 'object with 1 keys, 29 KB', header: { a: 1 } } });
  assert.match(result.note, /Repeat the call with jq/);
});

test('overview keeps links whole and summarises long arrays', () => {
  const link = '/category/x/?page=2&paginator_token=' + 't'.repeat(900);
  assert.equal(overview(link), link);
  assert.deepEqual(overview(['a'.repeat(3000), 'b'], 1), ['string, 3 KB', '... 2 items, 3 KB']);
});

test('queue runs tasks of one site in order with a gap', async () => {
  const order: number[] = [];
  const started = Date.now();
  await Promise.all([1, 2, 3].map((n) => enqueue('test-order', [50, 50], async () => order.push(n))));
  assert.deepEqual(order, [1, 2, 3]);
  assert.ok(Date.now() - started >= 100, 'two gaps of 50 ms');
});

test('a failed task does not stop the queue', async () => {
  await assert.rejects(enqueue('test-fail', [0, 0], async () => Promise.reject(new Error('boom'))), /boom/);
  assert.equal(await enqueue('test-fail', [0, 0], async () => 'next'), 'next');
});

test('pause expires, can be cleared and describes the relay link', () => {
  setPause('test-pause', { until: Date.now() + 60_000, reason: 'captcha', relay: 'http://127.0.0.1:1/s/x' });
  const pause = getPause('test-pause');
  assert.ok(pause);
  assert.match(describePause('test-pause', pause), /paused for 60 s \(captcha\).*http:\/\/127\.0\.0\.1:1\/s\/x/);
  clearPause('test-pause');
  assert.equal(getPause('test-pause'), null);
  setPause('test-pause', { until: Date.now() - 1, reason: 'old' });
  assert.equal(getPause('test-pause'), null);
});
