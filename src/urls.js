// Product URLs are canonical marketplace paths, never arbitrary browser targets.
import {isIP} from 'node:net';

const SITES = {
  ozon: {base: 'https://www.ozon.ru', hosts: ['ozon.ru', 'www.ozon.ru']},
  dns: {base: 'https://www.dns-shop.ru', hosts: ['dns-shop.ru', 'www.dns-shop.ru']},
  yandex: {base: 'https://market.yandex.ru', hosts: ['market.yandex.ru']},
};

export function navigationSite(input) {
  const url = new URL(input);
  if (url.protocol !== 'https:' || url.username || url.password || url.port) throw new Error('Invalid marketplace URL');
  const site = Object.keys(SITES).find(key => SITES[key].hosts.includes(url.hostname));
  if (!site) throw new Error('Invalid marketplace host');
  return site;
}

export function productUrl(site, product) {
  const text = String(product || '').trim();
  const fail = () => { throw new Error(`Invalid ${site === 'yandex' ? 'Yandex Market' : site} product URL`); };
  if (!SITES[site] || !text || /[\\\s]/.test(text) || text.startsWith('//')) return fail();
  let value = text;
  if (site === 'ozon' && /^(?:[a-z0-9_-]+-)?\d+$/i.test(value)) value = '/product/' + value;
  if (site === 'dns' && /^[0-9a-f]{16}$/i.test(value)) value = '/product/' + value;
  if (site === 'yandex' && /^(card\/|product--)/.test(value)) value = '/' + value;
  const rawPath = value.split(/[?#]/)[0];
  if (rawPath.includes('%') || /\/(?:\.|\.\.)(?:\/|$)/.test(rawPath)) return fail();
  if (!value.startsWith('/') && !/^https:\/\//i.test(value)) return fail();
  // URL.port normalizes :443 away, so reject explicit ports before parsing too.
  const authority = value.match(/^https:\/\/([^/?#]+)/i)?.[1];
  if (authority?.includes(':') || authority?.includes('@')) return fail();
  let url;
  try {
    url = new URL(value, SITES[site].base);
    if (navigationSite(url.href) !== site) return fail();
  } catch { return fail(); }
  const path = url.pathname;
  let match;
  if (site === 'ozon') {
    match = path.match(/^\/product\/((?:[a-z0-9_-]+-)?\d+)(?:\/(?:reviews|features))?\/?$/i);
    if (match) return SITES[site].base + '/product/' + match[1] + '/';
  } else if (site === 'dns') {
    match = path.match(/^\/product\/(?:opinion\/|characteristics\/|analog\/)?([0-9a-f]{16})(?:\/([a-z0-9_-]+))?\/?$/i);
    if (match) return SITES[site].base + '/product/' + match[1] + '/' + (match[2] ? match[2] + '/' : '');
  } else {
    match = path.match(/^(\/(?:card\/[a-z0-9_-]+|product--[a-z0-9_-]+)\/\d{6,})(?:\/reviews)?\/?$/i);
    if (match) return SITES[site].base + match[1];
  }
  return fail();
}

// Share links of the marketplace apps: redirects to a product card. Yandex Market answers plain HTTP clients on them with
// a captcha, so a browser follows them (browser.js shareTarget); the card URL it lands on is checked by productUrl.
const SHARE = {ozon: /^\/t\/[A-Za-z0-9_-]{3,32}\/?$/, yandex: /^\/cc\/[A-Za-z0-9_-]{3,32}\/?$/};
export function shareLink(input) {
  let url;
  try { url = new URL(String(input || '').trim()); } catch { return null; }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.port) return null;
  const site = Object.keys(SHARE).find(key => SITES[key].hosts.includes(url.hostname) && SHARE[key].test(url.pathname));
  return site ? {site, url: `https://${url.hostname}${url.pathname}`} : null;
}
export function productSite(product) {
  const text = String(product || '').trim();
  const share = shareLink(text);
  if (share) return share.site;
  for (const site of ['dns', 'yandex', 'ozon']) {
    try { productUrl(site, text); return site; } catch { /* Try the next supported path/id format. */ }
  }
  throw new Error('Invalid marketplace product');
}

export function requestAllowed(input, site, navigation) {
  try {
    const url = new URL(input), host = url.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '');
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return false;
    if (navigation) return SITES[site]?.hosts.includes(host) || false;
    // Public CDN resources are needed. This is not a DNS/OS egress sandbox:
    // a permitted DNS name could still resolve to a private address.
    return !isIP(host) && host.includes('.') && !/\.(localhost|local|internal|home|lan|test|invalid|example|onion)$/.test(host);
  } catch { return false; }
}
