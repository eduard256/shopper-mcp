import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { chromium, type BrowserContext, type Page } from 'patchright';
import { config } from '../config.js';
import { log } from '../log.js';

let contextPromise: Promise<BrowserContext> | null = null;
const siteTabs = new Map<string, { page: Page; idleTimer?: NodeJS.Timeout }>();

function ensureChromium(): void {
  if (existsSync(chromium.executablePath())) return;
  log('Chromium not found, downloading it once...');
  const packageDir = path.dirname(createRequire(import.meta.url).resolve('patchright/package.json'));
  const result = spawnSync(process.execPath, [path.join(packageDir, 'cli.js'), 'install', 'chromium', '--no-shell'], {
    stdio: ['ignore', 2, 2], // stdout belongs to MCP
  });
  if (result.status !== 0) throw new Error('Chromium download failed, see the server log');
}

async function launch(): Promise<BrowserContext> {
  ensureChromium();
  const options = { channel: 'chromium', headless: config.headless, viewport: { width: 1280, height: 800 } };
  let context = await chromium.launchPersistentContext(config.profileDir, options);

  // Headless Chromium puts "HeadlessChrome" into its User-Agent and sites block it.
  const firstPage = context.pages()[0] ?? (await context.newPage());
  const userAgent = await firstPage.evaluate(() => navigator.userAgent, undefined, undefined, false);
  if (userAgent.includes('HeadlessChrome')) {
    await context.close();
    const args = [`--user-agent=${userAgent.replace('HeadlessChrome', 'Chrome')}`];
    context = await chromium.launchPersistentContext(config.profileDir, { ...options, args });
  }

  context.on('close', () => {
    contextPromise = null;
    siteTabs.clear();
  });
  log('browser started:', config.headless ? 'headless' : 'visible', config.profileDir);
  return context;
}

function browserContext(): Promise<BrowserContext> {
  contextPromise ??= launch().catch((error) => {
    contextPromise = null;
    throw error;
  });
  return contextPromise;
}

// Antibot pages answer 4xx and reload themselves; wait for a successful document.
async function openPastAntibot(page: Page, url: string): Promise<void> {
  const passed = page
    .waitForResponse(
      (r) => r.request().isNavigationRequest() && r.frame() === page.mainFrame() && r.status() < 400,
      { timeout: config.navigationTimeoutMs },
    )
    .then(
      () => true,
      () => false,
    );
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: config.navigationTimeoutMs });
  if (!(await passed)) {
    throw new Error(`${url} did not pass the site check (page title: "${await page.title()}"). Use shop_show to let the user see it.`);
  }
  await page.waitForLoadState('load', { timeout: config.navigationTimeoutMs }).catch(() => undefined);
  await page.waitForTimeout(1500); // let site scripts settle, as a person would before the first click
}

// A JS challenge passes by itself in a real browser: open it, wait until it moves on, come back.
export async function passChallenge(page: Page, url: string, origin: string): Promise<void> {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: config.navigationTimeoutMs }).catch(() => undefined);
  await page.waitForURL((current) => current.href !== url, { timeout: 15_000 }).catch(() => undefined);
  await openPastAntibot(page, origin + '/');
}

// One tab per site; all API requests of that site run inside it. Closed after idling.
export async function siteTab(id: string, origin: string): Promise<Page> {
  let tab = siteTabs.get(id);
  if (!tab || tab.page.isClosed()) {
    const context = await browserContext();
    const used = new Set([...siteTabs.values()].map((t) => t.page));
    const page = context.pages().find((p) => p.url() === 'about:blank' && !used.has(p)) ?? (await context.newPage());
    try {
      await openPastAntibot(page, origin + '/');
    } catch (error) {
      await page.close().catch(() => undefined);
      throw error;
    }
    tab = { page };
    siteTabs.set(id, tab);
    log(id, 'tab opened');
  }

  const current = tab;
  clearTimeout(current.idleTimer);
  current.idleTimer = setTimeout(() => {
    siteTabs.delete(id);
    current.page.close().catch(() => undefined);
    log(id, 'tab closed after idling');
  }, config.tabIdleMs).unref();
  return current.page;
}

// A separate tab for the user (relay): no antibot waiting, the user sees whatever loads.
export async function openTab(url: string): Promise<Page> {
  const page = await (await browserContext()).newPage();
  await page
    .goto(url, { waitUntil: 'domcontentloaded', timeout: config.navigationTimeoutMs })
    .catch((error: Error) => log('open tab:', error.message));
  return page;
}

export async function closeBrowser(): Promise<void> {
  const pending = contextPromise;
  contextPromise = null;
  const context = await pending?.catch(() => null);
  await context?.close().catch(() => undefined);
}
