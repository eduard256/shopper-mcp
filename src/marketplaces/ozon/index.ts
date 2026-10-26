import { fileURLToPath } from 'node:url';
import { isObject, tryParseJson } from '../../shared/json.js';
import type { Block, InfoProvider, Marketplace, SiteResponse } from '../types.js';

const origin = 'https://www.ozon.ru';
const pageApi = '/api/entrypoint-api.bx/page/json/v2?url=';

// Ordering and payment must never happen; logout would break the session.
const forbidden = /checkout|payment|createorder|logout/i;

function toRelative(path: string): string {
  if (!/^https?:\/\//i.test(path)) return path;
  const url = new URL(path);
  if (url.hostname !== 'ozon.ru' && !url.hostname.endsWith('.ozon.ru')) {
    throw new Error(`Not an ozon.ru URL: ${path}`);
  }
  return url.pathname + url.search;
}

// "/api/..." goes as is; any other path is a site page and is wrapped into the page API.
export function buildUrl(path: string): string {
  const relative = toRelative(path);
  if (!relative.startsWith('/')) throw new Error(`Path must start with "/": ${path}`);
  if (relative.startsWith('/api/')) return origin + relative;
  const inner = new URL(relative, origin); // normalises spaces and Cyrillic, keeps %3B
  return origin + pageApi + encodeURIComponent(inner.pathname + inner.search);
}

export function parse(body: unknown): unknown {
  if (!isObject(body)) return body;
  if (isObject(body.widgetStates)) {
    const { widgetStates, ...rest } = body;
    return { ...rest, widgets: unpackWidgets(widgetStates) };
  }
  if (typeof body.state === 'string') return { ...body, state: tryParseJson(body.state) };
  return body;
}

// "tileGridDesktop-3121879-default-1" -> "tileGridDesktop"; repeated names get "#2", "#3".
function unpackWidgets(states: Record<string, unknown>): Record<string, unknown> {
  const widgets: Record<string, unknown> = {};
  for (const [key, state] of Object.entries(states)) {
    const base = key.replace(/-\d+-\w+-\d+$/, '');
    let name = base;
    for (let n = 2; name in widgets; n++) name = `${base}#${n}`;
    widgets[name] = typeof state === 'string' ? tryParseJson(state) : state;
  }
  return widgets;
}

function safeDecode(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

export function isForbidden(path: string, body: unknown): boolean {
  // Search text may contain these words legitimately, so it is not checked.
  const target = safeDecode(path).replace(/[?&]text=[^&]*/g, '');
  const action = isObject(body) && typeof body.name === 'string' ? body.name : '';
  return forbidden.test(target) || forbidden.test(action);
}

export function detectBlock({ status, body }: SiteResponse): Block | null {
  if (isObject(body)) {
    const captcha = body.captchaURL ?? body.captchaUrl;
    if (typeof captcha === 'string') return { kind: 'captcha', url: captcha };
    if (typeof body.challengeURL === 'string') return { kind: 'challenge', url: body.challengeURL };
    if (typeof body.incidentId === 'string' && typeof body.timeoutSec === 'number') {
      return { kind: 'blocked', seconds: body.timeoutSec };
    }
  }
  if (status === 403 && typeof body === 'string' && /antibot/i.test(body)) return { kind: 'captcha' };
  return null;
}

interface AddressBar {
  customCell?: { cells?: { button?: { text?: string }; text?: { text?: string } }[] };
}

// Header address bar, e.g. "Москва • Укажите адрес" (no pickup point) or "Пункт Ozon • наб. канала Грибоедова, 12".
export function readAddress(bar: AddressBar | undefined): string | null {
  const texts = (bar?.customCell?.cells ?? [])
    .map((cell) => (cell.button?.text ?? cell.text?.text ?? '').replace(/\s*•\s*$/, ''))
    .filter(Boolean);
  return texts.join(' • ') || null;
}

// One page gives both login state (header widgets) and the delivery address (address bar).
const account: InfoProvider = async (request) => {
  const page = parse((await request('/my/main')).body);
  const widgets = (isObject(page) && isObject(page.widgets) ? page.widgets : {}) as Record<string, unknown>;
  const loggedIn = !('profileMenuAnonymous' in widgets) && ('profileMenu' in widgets || 'userAvatar' in widgets);
  const address = readAddress(widgets.addressBookBarWeb as AddressBar | undefined);

  if (loggedIn) return { facts: { loggedIn, address }, tellUser: [] };
  return {
    facts: { loggedIn, loginPath: '/my/main', address },
    tellUser: [
      'Not logged in to Ozon. Without login Ozon shows captchas more often and share lists cannot be created. Offer to log in via shop_show.',
    ],
  };
};

export const ozon: Marketplace = {
  id: 'ozon.ru',
  origin,
  pauseMs: { get: [1000, 2000], post: [3000, 5000] },
  headers: { accept: 'application/json', 'content-type': 'application/json', 'x-o3-app-name': 'dweb_client' },
  loginPath: '/my/main',
  docsDir: fileURLToPath(new URL('./docs/', import.meta.url)),
  buildUrl,
  parse,
  isForbidden,
  detectBlock,
  info: [account],
};
