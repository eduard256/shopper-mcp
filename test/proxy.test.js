import assert from 'node:assert/strict';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import {chromium} from 'playwright';

const folder = await mkdtemp(join(tmpdir(), 'market-proxy-test-'));
const sockets = new Set();
const track = server => server.on('connection', socket => {
  sockets.add(socket); socket.on('close', () => sockets.delete(socket));
});
const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let target, proxy, shutdown;
try {
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
    '-subj', '/CN=localhost', '-keyout', join(folder, 'key.pem'), '-out', join(folder, 'cert.pem')], {stdio: 'ignore'});
  let hits = 0, rejected = 0;
  const connects = [];
  target = track(https.createServer({key: await readFile(join(folder, 'key.pem')), cert: await readFile(join(folder, 'cert.pem'))},
    (_req, res) => { hits++; res.end('local proxy fixture'); }));
  await listen(target);
  const authority = `127.0.0.1:${target.address().port}`;
  let deny = false;
  proxy = track(http.createServer((_req, res) => res.writeHead(403).end()));
  proxy.on('connect', (req, socket, head) => {
    connects.push(req.url);
    if (deny || req.url !== authority) {
      rejected++; socket.end('HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n'); return;
    }
    const upstream = net.connect(target.address().port, '127.0.0.1', () => {
      socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head.length) upstream.write(head);
      socket.pipe(upstream); upstream.pipe(socket);
    });
    sockets.add(upstream); upstream.on('close', () => sockets.delete(upstream));
    upstream.on('error', () => socket.destroy()); socket.on('error', () => upstream.destroy());
    socket.on('close', () => upstream.destroy());
  });
  await listen(proxy);
  process.env.MARKET_PROXY_SERVER = `http://127.0.0.1:${proxy.address().port}`;
  process.env.MARKET_PROFILE_DIR = join(folder, 'profile');
  process.env.MARKET_HEADLESS = 'true';
  process.env.MARKET_HIDE_WINDOW = '0';
  // Keep production launch/proxy options. Only trust this temporary test certificate.
  const launch = chromium.launchPersistentContext.bind(chromium);
  chromium.launchPersistentContext = (profile, options) => launch(profile, {...options, ignoreHTTPSErrors: true});
  const browser = await import('../src/browser.js');
  shutdown = browser.shutdown;
  async function page() {
    const context = await browser.ensureContext();
    // Transport test uses loopback fixtures, outside the production marketplace URL policy.
    await context.unrouteAll();
    return context.newPage();
  }
  // WB uses direct transport unless MARKET_PROXY_SERVER is explicitly set.
  const {readPublic} = await import('../src/wildberries.js');
  const nativeRequest = https.request;
  https.request = (url, options, callback) => nativeRequest(url, {...options, rejectUnauthorized:false}, callback);
  const savedProxy = process.env.MARKET_PROXY_SERVER, savedHttps = process.env.HTTPS_PROXY;
  try {
    delete process.env.MARKET_PROXY_SERVER;
    process.env.HTTPS_PROXY = savedProxy;
    deny = true;
    const ambientConnects = connects.length;
    assert.equal((await readPublic(`https://${authority}/wb-direct`)).body, 'local proxy fixture');
    assert.equal(connects.length, ambientConnects, 'WB inherited ambient HTTPS_PROXY');
    process.env.MARKET_PROXY_SERVER = savedProxy;
    deny = false;
    assert.equal((await readPublic(`https://${authority}/wb-gateway`)).body, 'local proxy fixture');
    assert(connects.length > ambientConnects, 'WB ignored explicitly configured CONNECT gateway');
    deny = true;
    const wbHits = hits;
    await assert.rejects(readPublic(`https://${authority}/wb-denied`));
    assert.equal(hits, wbHits, 'WB fell back to direct after gateway rejection');
  } finally {
    https.request = nativeRequest;
    process.env.MARKET_PROXY_SERVER = savedProxy;
    if (savedHttps === undefined) delete process.env.HTTPS_PROXY; else process.env.HTTPS_PROXY = savedHttps;
    deny = false;
  }
  const first = await page();
  await first.goto(`https://${authority}/success`);
  assert.equal(await first.textContent('body'), 'local proxy fixture');
  assert(connects.includes(authority), 'Chromium bypassed configured CONNECT proxy');
  await shutdown();
  deny = true;
  const hitsBefore = hits, rejectedBefore = rejected;
  const second = await page();
  await assert.rejects(second.goto(`https://${authority}/denied`, {timeout: 5000}));
  assert(rejected > rejectedBefore, 'Proxy did not receive failed request');
  assert.equal(hits, hitsBefore, 'Chromium fell back to a direct connection');
  console.log('Chromium CONNECT proxy used; rejection has no direct fallback');
} finally {
  await shutdown?.();
  for (const socket of sockets) socket.destroy();
  for (const server of [proxy, target]) if (server) await new Promise(resolve => server.close(resolve));
  await rm(folder, {recursive: true, force: true});
}
