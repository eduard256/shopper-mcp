// One long-lived Chromium with a persistent profile (~/.market-mcp/profile) shared by all
// marketplaces. Headed by default: Ozon (Variti), DNS (Qrator) and Yandex (SmartCaptcha)
// pass a visible browser but hand a headless one a real captcha. Cookies survive restarts,
// so the anti-bot challenge is paid once. If a captcha still shows up, the window stays open
// and we wait for the user to solve it (MARKET_CAPTCHA_WAIT_S, default 120).
//
//  - lazy init on first call; context 'close' -> relaunch on next call
//  - Ozon: fetch() to composer-api from a page that stays on ozon.ru (cookies + origin apply)
//  - other sites: openPage() navigates a fresh tab and hands back a page for evaluate()
//  - idle timer closes the browser after MARKET_IDLE_MIN (default 10) minutes
//  - all logs go to stderr (stdout is the MCP JSON-RPC wire)

import { chromium } from "playwright";
import { homedir } from "os";
import { join } from "path";
import { execFile } from "child_process";
import { navigationSite, productUrl, requestAllowed, shareLink } from "./urls.js";

const OZON_HOME = "https://www.ozon.ru/";
const OZON_API = "https://www.ozon.ru/api/composer-api.bx/page/json/v2?url=";
const PROFILE = process.env.MARKET_PROFILE_DIR || join(homedir(), ".market-mcp", "profile");
const HEADLESS = process.env.MARKET_HEADLESS === "true";
const CAPTCHA_WAIT_MS = 1000 * Number(process.env.MARKET_CAPTCHA_WAIT_S || 120);
const IDLE_TIMEOUT_MS = 60 * 1000 * Number(process.env.MARKET_IDLE_MIN || 720);
const NAV_TIMEOUT_MS = 90000;
const CHALLENGE_RELOAD_MS = 1000 * Number(process.env.MARKET_CHALLENGE_RELOAD_S || 15);

// Титулы страниц-заглушек антибота у всех площадок.
const CHALLENGE = /antibot|доступ ограничен|нет соединения|captcha|проверка браузера|qrator|robot|вы\s+не\s+робот|attention required|access denied/i;

// Окно нужно антиботам, но пользователю не нужно. Уводить его за экран macOS не даёт (возвращает
// на экран), поэтому после запуска прячем процесс Chromium как по Cmd+H через System Events
// (MARKET_HIDE_WINDOW=0 выключает; окно понадобится, чтобы решить капчу руками).
const HIDE_WINDOW = process.env.MARKET_HIDE_WINDOW !== "0" && process.platform === "darwin";
// Окно всё равно создаётся на долю секунды до скрытия: делаем его маленьким и просим положить
// в дальний угол (macOS подтянет к краю экрана). На вёрстку не влияет: вьюпорт задаёт Playwright.
// Без оконного менеджера (серверный Xvfb) окно встаёт в (10,10), и антибот Ozon такой браузер не
// пропускает (проверено 2026-09-22); вне macOS ставим окну обычную позицию на рабочем столе.
export function launchArgs(platform, hideWindow) {
  const position = hideWindow ? ["--window-position=20000,20000", "--window-size=320,240"]
    : platform === "darwin" ? [] : ["--window-position=76,42"];
  return ["--disable-blink-features=AutomationControlled", "--no-first-run", "--no-default-browser-check", "--mute-audio", ...position];
}
const LAUNCH_ARGS = launchArgs(process.platform, HIDE_WINDOW);

const BROWSER_PROC = '(every process whose name contains "Chrome for Testing" or name is "Chromium")';

function setWindowVisible(visible) {
  if (!HIDE_WINDOW) return Promise.resolve();
  const script = `tell application "System Events" to set visible of ${BROWSER_PROC} to ${visible}`;
  return new Promise((res) => execFile("osascript", ["-e", script], (err) => { if (err) log("window:", err.message); res(); }));
}

/** Прячем приложение с первых миллисекунд запуска, пока окно ещё не показано: опрос каждые 100 мс до 5 с. */
function hideEarly() {
  if (!HIDE_WINDOW) return;
  const t0 = Date.now();
  const tick = () => setWindowVisible(false).then(() => { if (Date.now() - t0 < 5000) setTimeout(tick, 100); });
  tick();
}

const log = (...a) => console.error("[browser]", ...a);

let context = null;
let ozonPage = null; // stays on ozon.ru, all composer fetches run from it
let ozonReady = false;
let initPromise = null;
let idleTimer = null;
const pageSites = new WeakMap();

const guards = new WeakMap();

// Playwright routes only intercept the first HTTP redirect hop. CDP checks every hop.
// Idempotent: a page already guarded (e.g. by protectContext's page listener) is not guarded twice.
export function protectPage(ctx, page, scopes) {
  if (!guards.has(page)) guards.set(page, guard(ctx, page, scopes));
  return guards.get(page);
}

async function guard(ctx, page, scopes) {
  const session = await ctx.newCDPSession(page);
  session.on('Fetch.requestPaused', event => {
    const allowed = requestAllowed(event.request.url, scopes.get(page), event.resourceType === 'Document');
    session.send(allowed ? 'Fetch.continueRequest' : 'Fetch.failRequest', {
      requestId: event.requestId, ...(allowed ? {} : {errorReason: 'BlockedByClient'}),
    }).catch(() => {});
  });
  await session.send('Fetch.enable', {patterns: [{urlPattern: '*', requestStage: 'Request'}]});
}

// Every page, including ones the site opens itself, gets the CDP guard; unscoped pages cannot
// navigate. A context-wide ctx.route here made Ozon's composer-api answer 403 (verified on the
// GPU host 2026-09-22), so it is intentionally absent.
export async function protectContext(ctx, scopes) {
  ctx.on('page', page => { protectPage(ctx, page, scopes).catch(() => {}); });
  await ctx.routeWebSocket('**/*', socket => socket.close());
}

function resetIdle() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => shutdown().catch(() => {}), IDLE_TIMEOUT_MS);
  idleTimer.unref?.();
}

async function launch() {
  log(`launching chromium (${HEADLESS ? "headless" : "headed"}), profile ${PROFILE}`);
  hideEarly();
  context = await chromium.launchPersistentContext(PROFILE, {
    headless: HEADLESS,
    ...(process.env.MARKET_PROXY_SERVER ? {proxy: {server: process.env.MARKET_PROXY_SERVER}} : {}),
    serviceWorkers: 'block',
    args: LAUNCH_ARGS,
    locale: "ru-RU",
    viewport: HIDE_WINDOW ? null : { width: 1280, height: 860 }, // при скрытии окно 320x240, вьюпорт страниц задаётся ниже
  });
  await protectContext(context, pageSites);
  context.on("close", () => {
    context = null;
    ozonPage = null;
    ozonReady = false;
  });
  ozonReady = false;
}

export async function ensureContext() {
  if (context) return context;
  if (initPromise) return initPromise;
  initPromise = launch().finally(() => (initPromise = null));
  await initPromise;
  return context;
}

/** Ждёт, пока страница перестанет быть заглушкой антибота (JS-проверка проходит сама, капчу решает человек). */
export async function waitChallenge(page, label) {
  const t0 = Date.now();
  let title = await page.title().catch(() => "");
  let warned = false;
  while (CHALLENGE.test(title) && Date.now() - t0 < CAPTCHA_WAIT_MS) {
    if (!warned && Date.now() - t0 > 15000) {
      log(`${label}: still on "${title.slice(0, 40)}", solve the captcha in the browser window (waiting up to ${CAPTCHA_WAIT_MS / 1000}s)`);
      await setWindowVisible(true);
      await page.bringToFront().catch(() => {});
      warned = true;
    }
    await page.waitForTimeout(1000);
    title = await page.title().catch(() => "");
  }
  if (CHALLENGE.test(title)) throw new Error(`${label}: challenge not passed in ${CAPTCHA_WAIT_MS / 1000}s (title: ${title.slice(0, 60)})`);
  if (warned) setWindowVisible(false);
  return title;
}

async function ensureOzon() {
  await ensureContext();
  if (ozonReady && ozonPage && !ozonPage.isClosed()) return ozonPage;
  ozonPage = await context.newPage();
  pageSites.set(ozonPage, 'ozon');
  await protectPage(context, ozonPage, pageSites);
  if (HIDE_WINDOW) await ozonPage.setViewportSize({ width: 1280, height: 860 });
  await ozonPage.goto(OZON_HOME, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT_MS });
  const title = await waitChallenge(ozonPage, "ozon");
  // после проверки страница перезагружается сама: дождаться конца навигации, иначе evaluate попадёт в её середину
  await ozonPage.waitForLoadState("load", { timeout: NAV_TIMEOUT_MS }).catch(() => {});
  await ozonPage.waitForTimeout(1000);
  ozonReady = true;
  log("ozon ready:", title.slice(0, 40));
  return ozonPage;
}

// Очередь на площадку: параллельные запросы к одному сайту (compare, обход страниц) ловят 403 у
// Ozon и обрыв навигации у DNS. Разные площадки идут параллельно, внутри одной - по очереди.
const queues = new Map();
export function queued(key, fn) {
  const prev = queues.get(key) || Promise.resolve();
  const run = prev.catch(() => {}).then(fn);
  queues.set(key, run);
  run.then(() => {}, () => {}).finally(() => { if (queues.get(key) === run) queues.delete(key); });
  return run;
}

const DEAD = /Target page, context or browser has been closed|Session closed|Connection closed|browser has been closed/i;
const NAVIGATED = /Execution context was destroyed|Cannot find context|Frame was detached/i;

/** Ozon composer-api как JSON по пути сайта ("/search/?text=..."). Повтор один раз при 403/307 или мёртвом браузере. */
export function fetchJson(path, opts) {
  return queued("ozon", () => fetchJsonNow(path, opts));
}

async function fetchJsonNow(path, { retries = 2 } = {}) {
  for (let attempt = 0; ; attempt++) {
    try {
      resetIdle();
      const page = await ensureOzon();
      const body = await page.evaluate(async (url) => {
        const r = await fetch(url, { headers: { accept: "application/json" } });
        return { status: r.status, text: await r.text() };
      }, OZON_API + encodeURIComponent(path));
      if (body.status !== 200) {
        if ((body.status === 403 || body.status === 307) && attempt < retries) {
          log(`ozon HTTP ${body.status} on ${path.slice(0, 60)}, retry ${attempt + 1}`);
          ozonReady = false;
          await ozonPage?.close().catch(() => {});
          await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
          continue;
        }
        throw new Error(`Ozon returned HTTP ${body.status}`);
      }
      return JSON.parse(body.text);
    } catch (err) {
      const msg = String(err?.message);
      if (NAVIGATED.test(msg) && attempt < retries + 1) {
        ozonReady = false; // страница ушла в навигацию (редирект антибота): пересоздать вкладку
        await ozonPage?.close().catch(() => {});
        continue;
      }
      if (DEAD.test(msg) && attempt < retries) {
        await shutdown();
        continue;
      }
      throw err;
    }
  }
}

/**
 * Открыть URL в новой вкладке общего профиля, дождаться прохождения антибота и отдать страницу.
 * Вызывающий обязан закрыть страницу (page.close()) в finally.
 */
export async function openPage(url, { label = "page", waitUntil = "domcontentloaded", settleMs = 0 } = {}) {
  const site = navigationSite(url);
  resetIdle();
  await ensureContext();
  const page = await context.newPage();
  pageSites.set(page, site);
  await protectPage(context, page, pageSites);
  setWindowVisible(false);
  if (HIDE_WINDOW) await page.setViewportSize({ width: 1280, height: 860 });
  // Qrator (DNS) answers the first visit with 401 and a JS challenge that reloads into the real page;
  // only an error status that never turns into a normal document is a block.
  const recovered = page.waitForResponse((r) => r.request().isNavigationRequest() && r.frame() === page.mainFrame() && r.status() < 400,
    { timeout: NAV_TIMEOUT_MS + CHALLENGE_RELOAD_MS });
  recovered.catch(() => {});
  try {
    const response = await page.goto(url, { waitUntil, timeout: NAV_TIMEOUT_MS });
    if (["dns", "yandex"].includes(site) && response && response.status() >= 400) {
      const reload = await Promise.race([recovered, page.waitForTimeout(CHALLENGE_RELOAD_MS).then(() => null)]);
      if (!reload) throw new Error(`${label}: HTTP ${response.status()}`);
      await page.waitForLoadState(waitUntil, { timeout: NAV_TIMEOUT_MS });
    }
    await waitChallenge(page, label);
    if (settleMs) await page.waitForTimeout(settleMs);
    if (["dns", "yandex"].includes(site)) {
      const title = await page.title();
      const text = await page.locator("body").innerText();
      if (/^\/showcaptcha(?:\/|$)/.test(new URL(page.url()).pathname)
          || /^(?:HTTP\s*)?[45]\d\d\b|forbidden|access denied|captcha|доступ.*(?:запрещен|ограничен)/i.test(title)
          || /доступ к сайту[^\n]*(?:запрещен|ограничен)|подтвердите,? что вы не робот|^\s*вы\s+не\s+робот\?\s*$|проверка браузера|^\s*(?:Forbidden|Access Denied|captcha)\s*$/im.test(text)) {
        throw new Error(`${label}: blocked or challenge page`);
      }
    }
    return page;
  } catch (err) {
    await page.close().catch(() => {});
    throw err;
  }
}

/**
 * The card a share link leads to (ozon.ru/t/…, market.yandex.ru/cc/…), or the product itself when it is not one.
 * The tab follows the redirects (the guard keeps every hop on the site's own hosts) until its address is a card;
 * an anti-bot page shown at the card's address does not matter, only the address is read.
 */
export async function shareTarget(site, product) {
  const share = shareLink(product);
  if (!share) return product;
  if (share.site !== site) throw new Error(`Invalid ${site === 'yandex' ? 'Yandex Market' : site} product URL`);
  resetIdle();
  // Ozon's anti-bot passes a fresh profile on the home page; a tab that lands on a card first keeps the challenge
  // unsolved and the home page then fails it too (4 of 4 runs on the GPU host, 10.10)
  if (site === "ozon") await queued("ozon", ensureOzon);
  await ensureContext();
  const page = await context.newPage();
  pageSites.set(page, site);
  await protectPage(context, page, pageSites);
  setWindowVisible(false);
  try {
    return await followShare(page, share, CAPTCHA_WAIT_MS);
  } finally {
    await page.close().catch(() => {});
  }
}

export async function followShare(page, share, waitMs) {
  const deadline = Date.now() + waitMs;
  await page.goto(share.url, { waitUntil: "commit", timeout: NAV_TIMEOUT_MS });
  for (;;) {
    try { return productUrl(share.site, page.url()); } catch { /* not at a card yet */ }
    if (Date.now() > deadline) {
      const stop = new URL(page.url());
      throw new Error(`share link ${share.url} did not lead to a product card (stopped at ${stop.hostname}${stop.pathname.slice(0, 40)})`);
    }
    await page.waitForTimeout(250);
  }
}

export async function shutdown() {
  clearTimeout(idleTimer);
  ozonReady = false;
  ozonPage = null;
  const ctx = context;
  context = null;
  try {
    const b = ctx?.browser();
    await ctx?.close();
    await b?.close(); // persistent context не всегда гасит процесс Chromium
  } catch {}
}
