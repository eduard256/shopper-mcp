import assert from 'node:assert/strict';
import {productUrl, productSite, requestAllowed, shareLink} from '../src/urls.js';
import {compare} from '../src/compare.js';
import {details, reviews} from '../src/ozon.js';
import {dnsProduct, dnsReviews} from '../src/dns.js';
import {yandexCard, yandexReviews} from '../src/yandex.js';

const good = {
  ozon: 'https://www.ozon.ru/product/stol-1185261285/',
  dns: 'https://www.dns-shop.ru/product/1234567890abcdef/stol/',
  yandex: 'https://market.yandex.ru/card/stol/4671788663',
};
for (const [site, url] of Object.entries(good)) {
  assert.equal(productSite(url), site);
  assert.equal(productUrl(site, url + '?tracking=abc%20def#x'), url);
}
assert.equal(productUrl('ozon', '1185261285'), 'https://www.ozon.ru/product/1185261285/');
assert.equal(productUrl('dns', '1234567890abcdef'), 'https://www.dns-shop.ru/product/1234567890abcdef/');
assert.equal(productUrl('ozon', 'https://ozon.ru/product/stol-1185261285/reviews/'), good.ozon);
assert.equal(productUrl('dns', '/product/characteristics/1234567890abcdef/stol/'), good.dns);

for (const product of [
  'http://127.0.0.1/product/stol-1185261285/', 'https://localhost/product/stol-1185261285/',
  'https://[::1]/product/stol-1185261285/', 'https://2130706433/product/stol-1185261285/',
  'https://evil.test/product/stol-1185261285/', '//ozon.ru/product/stol-1185261285/',
  'https://www.ozon.ru.evil.test/product/stol-1185261285/',
  'https://www.ozon.ru@evil.test/product/stol-1185261285/',
  'https://user:pass@www.ozon.ru/product/stol-1185261285/',
  'https://www.ozon.ru:443/product/stol-1185261285/', 'https://www.ozon.ru:8080/product/stol-1185261285/',
  '/product/../product/stol-1185261285/', '/product/stol%2f..-1185261285/',
  '/product/stol\\evil-1185261285/', 'file:///etc/passwd', 'javascript:alert(1)',
]) {
  for (const site of Object.keys(good)) assert.throws(() => productUrl(site, product));
  for (const fn of [details, reviews, dnsProduct, dnsReviews, yandexCard, yandexReviews]) {
    await assert.rejects(fn({product}));
  }
  await assert.rejects(compare({products: [good.yandex, product]}));
}
assert.deepEqual(shareLink('https://ozon.ru/t/cF6viV9'), {site: 'ozon', url: 'https://ozon.ru/t/cF6viV9'});
assert.deepEqual(shareLink(' http://www.ozon.ru/t/cF6viV9/?utm=app '), {site: 'ozon', url: 'https://www.ozon.ru/t/cF6viV9/'});
assert.deepEqual(shareLink('https://market.yandex.ru/cc/BGpXgU'), {site: 'yandex', url: 'https://market.yandex.ru/cc/BGpXgU'});
assert.equal(productSite('https://ozon.ru/t/cF6viV9'), 'ozon');
assert.equal(productSite('https://market.yandex.ru/cc/BGpXgU'), 'yandex');
for (const link of ['https://evil.test/t/cF6viV9', 'https://ozon.ru.evil.test/t/cF6viV9', 'https://user@ozon.ru/t/cF6viV9',
  'https://ozon.ru:8443/t/cF6viV9', 'https://ozon.ru/t/../product/1', 'https://ozon.ru/t/a', 'https://ozon.ru/cc/BGpXgU',
  'https://market.yandex.ru/t/cF6viV9', 'https://dns-shop.ru/t/cF6viV9', 'ftp://ozon.ru/t/cF6viV9', good.ozon, 'cF6viV9']) {
  assert.equal(shareLink(link), null, link);
}
for (const fn of [details, reviews]) await assert.rejects(fn({product: 'https://market.yandex.ru/cc/BGpXgU'}), /Invalid ozon product URL/);
for (const fn of [yandexCard, yandexReviews]) await assert.rejects(fn({product: 'https://ozon.ru/t/cF6viV9'}), /Invalid Yandex Market product URL/);
assert(requestAllowed(good.yandex, 'yandex', true));
assert(!requestAllowed(good.ozon, 'yandex', true));
assert(!requestAllowed('https://evil.test/x', 'yandex', true));
assert(requestAllowed('https://yastatic.net/image.png', 'yandex', false));
for (const url of ['http://127.0.0.1:8000', 'https://[::1]/', 'https://10.0.0.1/',
  'https://localhost/', 'https://localhost./', 'https://router.local./', 'https://router.local/', 'https://singlehost/', 'https://user:pass@yastatic.net/x']) {
  assert(!requestAllowed(url, 'yandex', false));
}
console.log('Marketplace URL and request policy tests passed');

const {chromium} = await import('playwright');
const {protectContext, protectPage} = await import('../src/browser.js');
const browser = await chromium.launch({headless: true});
try {
  const context = await browser.newContext({serviceWorkers: 'block'});
  const reached = [], scopes = new WeakMap();
  await context.route('**/*', route => {
    const url = route.request().url();
    reached.push(url);
    if (url.endsWith('/resource-redirect.js')) return route.fulfill({status: 302, headers: {location: 'https://127.0.0.1/leak.js'}});
    if (url.endsWith('/redirect')) return route.fulfill({status: 302, headers: {location: good.ozon}});
    if (url.startsWith('https://yastatic.net/')) return route.fulfill({contentType: 'text/javascript', body: 'window.cdnLoaded=true'});
    return route.fulfill({contentType: 'text/html', body: '<script src="https://yastatic.net/public.js"></script><script src="https://127.0.0.1/private.js"></script><script src="https://yastatic.net/resource-redirect.js"></script>'});
  });
  await protectContext(context, scopes);
  const page = await context.newPage();
  scopes.set(page, 'yandex');
  await protectPage(context, page, scopes);
  await page.goto('https://market.yandex.ru/fixture');
  assert.equal(await page.evaluate(() => window.cdnLoaded), true);
  assert(!reached.some(url => url.includes('127.0.0.1')));
  await assert.rejects(page.goto('https://market.yandex.ru/redirect'));
  assert(!reached.some(url => url.includes('127.0.0.1')));
  assert(!reached.includes(good.ozon));
  const unscoped = await context.newPage();
  await protectPage(context, unscoped, scopes); // guard from the page listener, awaited for determinism
  await assert.rejects(unscoped.goto(good.yandex));
  assert(!reached.includes(good.yandex));
  console.log('Browser redirects blocked before downstream request; CDN resources retained');

  // a share link: the tab follows its redirects to the card and hands back the card's URL; a hop off the site is blocked
  const {followShare} = await import('../src/browser.js');
  await context.route('https://ozon.ru/t/**', route => route.request().url().endsWith('/nowhere')
    ? route.fulfill({contentType: 'text/html', body: 'Antibot Captcha'})
    : route.fulfill({status: 302, headers: {location: route.request().url().endsWith('/leak')
      ? 'https://127.0.0.1/product/stol-1185261285/' : 'https://www.ozon.ru/product/stol-1185261285/?from=share'}}));
  const tab = async () => {  // each share link gets its own tab, as in shareTarget
    const page = await context.newPage();
    scopes.set(page, 'ozon');
    await protectPage(context, page, scopes);
    return page;
  };
  assert.equal(await followShare(await tab(), {site: 'ozon', url: 'https://ozon.ru/t/cF6viV9'}, 2000), good.ozon);
  await assert.rejects(followShare(await tab(), {site: 'ozon', url: 'https://ozon.ru/t/leak'}, 1000));
  assert(!reached.some(url => url.includes('127.0.0.1')));
  await assert.rejects(followShare(await tab(), {site: 'ozon', url: 'https://ozon.ru/t/nowhere'}, 1000), /did not lead to a product card/);
  console.log('Share links followed to the card on the site only');
} finally {
  await browser.close();
}
