// protectPage блокирует/пропускает запросы через CDP Fetch сам по себе; protectContext больше
// не ставит контекстный ctx.route (он давал 403 на composer-api Ozon).
import assert from 'node:assert/strict';
import { protectContext, protectPage } from '../src/browser.js';

function fakeSession() {
  const handlers = {};
  const sent = [];
  return {
    on(event, cb) { handlers[event] = cb; },
    send(method, params) { sent.push({ method, params }); return Promise.resolve(); },
    fire(event, payload) { handlers[event](payload); },
    sent,
  };
}

const scopes = new WeakMap();
const page = {};
scopes.set(page, 'yandex');

const session = fakeSession();
await protectPage({ newCDPSession: async () => session }, page, scopes);

assert.equal(session.sent[0].method, 'Fetch.enable');
assert.deepEqual(session.sent[0].params, { patterns: [{ urlPattern: '*', requestStage: 'Request' }] });

session.fire('Fetch.requestPaused', {
  requestId: 'nav-1', request: { url: 'https://market.yandex.ru/card/x/123' }, resourceType: 'Document',
});
session.fire('Fetch.requestPaused', {
  requestId: 'nav-2', request: { url: 'https://evil.example.com/redirect' }, resourceType: 'Document',
});
session.fire('Fetch.requestPaused', {
  requestId: 'img-1', request: { url: 'https://some-cdn.example.net/pic.jpg' }, resourceType: 'Image',
});
await new Promise((r) => setTimeout(r, 0));

const byId = Object.fromEntries(session.sent.slice(1).map((c) => [c.params.requestId, c]));
assert.equal(byId['nav-1'].method, 'Fetch.continueRequest', 'allowed navigation continues');
assert.equal(byId['nav-2'].method, 'Fetch.failRequest', 'off-site navigation blocked');
assert.equal(byId['nav-2'].params.errorReason, 'BlockedByClient');
assert.equal(byId['img-1'].method, 'Fetch.continueRequest', 'public CDN resource allowed');

const calls = [];
const listeners = {};
const popupSession = fakeSession();
const ctx = {
  route: async () => calls.push('route'),
  routeWebSocket: async () => calls.push('routeWebSocket'),
  on: (event, cb) => { listeners[event] = cb; },
  newCDPSession: async () => popupSession,
};
await protectContext(ctx, scopes);
assert.ok(!calls.includes('route'), 'protectContext must not install context-wide ctx.route');

// Pages the site opens itself (popups) get the same CDP guard; with no scope, navigation is denied.
const popup = {};
listeners.page(popup);
await protectPage(ctx, popup, scopes); // idempotent: returns the guard already installed
assert.equal(popupSession.sent.filter((c) => c.method === 'Fetch.enable').length, 1, 'one guard per page');
popupSession.fire('Fetch.requestPaused', {
  requestId: 'pop-1', request: { url: 'https://market.yandex.ru/card/x/123' }, resourceType: 'Document',
});
await new Promise((r) => setTimeout(r, 0));
assert.equal(popupSession.sent.at(-1).method, 'Fetch.failRequest', 'unscoped page navigation blocked');

console.log('protectPage CDP interception (no ctx.route) passed');

// Without a window manager (server Xvfb) Chromium sits at (10,10), which Ozon's anti-bot rejects
// (verified 2026-09-22). Off macOS the window gets an ordinary desktop position.
const { launchArgs } = await import('../src/browser.js');
assert.ok(launchArgs('linux', false).includes('--window-position=76,42'));
assert.ok(launchArgs('darwin', true).includes('--window-position=20000,20000'), 'macOS hides the window off-screen');
assert.ok(!launchArgs('darwin', false).some((a) => a.startsWith('--window-position')), 'visible macOS window keeps OS placement');
console.log('launch window position passed');
