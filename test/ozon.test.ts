import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildUrl, detectBlock, isForbidden, parse, readAddress } from '../src/marketplaces/ozon/index.js';

const pageApi = 'https://www.ozon.ru/api/entrypoint-api.bx/page/json/v2?url=';

test('buildUrl wraps page paths and keeps %3B encoded once more', () => {
  assert.equal(
    buildUrl('/search/?text=esp32&currency_price=100%3B400'),
    pageApi + encodeURIComponent('/search/?text=esp32&currency_price=100%3B400'),
  );
});

test('buildUrl normalises spaces and Cyrillic in page paths', () => {
  const inner = decodeURIComponent(buildUrl('/search/?text=драйвер моторов').slice(pageApi.length));
  assert.equal(inner, '/search/?text=%D0%B4%D1%80%D0%B0%D0%B9%D0%B2%D0%B5%D1%80%20%D0%BC%D0%BE%D1%82%D0%BE%D1%80%D0%BE%D0%B2');
});

test('buildUrl sends API paths and site URLs correctly', () => {
  assert.equal(buildUrl('/api/composer-api.bx/_action/suggest'), 'https://www.ozon.ru/api/composer-api.bx/_action/suggest');
  assert.equal(buildUrl('https://www.ozon.ru/product/123/'), pageApi + encodeURIComponent('/product/123/'));
  assert.throws(() => buildUrl('https://example.com/'), /Not an ozon.ru URL/);
  assert.throws(() => buildUrl('product/123/'), /must start with/);
});

test('parse unpacks widget states, strips ids and numbers repeats', () => {
  const parsed = parse({
    pageInfo: { pageType: 'pdp' },
    widgetStates: {
      'webPrice-3121879-default-1': '{"price":"1 ₽"}',
      'webCharacteristics-1-pdpPage2column-2': '{"a":1}',
      'webCharacteristics-2-pdpPage2column-3': '{"a":2}',
      'broken-1-default-1': 'not json',
    },
  });
  assert.deepEqual(parsed, {
    pageInfo: { pageType: 'pdp' },
    widgets: {
      webPrice: { price: '1 ₽' },
      webCharacteristics: { a: 1 },
      'webCharacteristics#2': { a: 2 },
      broken: 'not json',
    },
  });
});

test('parse unpacks an async widget state and leaves other bodies alone', () => {
  assert.deepEqual(parse({ state: '{"title":"x"}' }), { state: { title: 'x' } });
  assert.deepEqual(parse({ data: 1 }), { data: 1 });
  assert.equal(parse('text'), 'text');
});

test('isForbidden blocks ordering and payment but not search text', () => {
  assert.equal(isForbidden('/api/composer-api.bx/_action/initCheckoutState', {}), true);
  assert.equal(isForbidden('/gocheckout', undefined), true);
  assert.equal(isForbidden('/api/composer-api.bx/_action/logoutV1', {}), true);
  assert.equal(isForbidden('/cart', { name: 'checkoutAction' }), true);
  assert.equal(isForbidden('/search/?text=payment terminal', undefined), false);
  assert.equal(isForbidden('/cart?page_changed=true', { name: 'deleteItems' }), false);
});

test('detectBlock tells challenge, captcha and block apart', () => {
  assert.deepEqual(detectBlock({ status: 403, body: { incidentId: 'fab_chlg_1', challengeURL: 'https://www.ozon.ru/challenge.html', timeoutSec: 180 } }), {
    kind: 'challenge',
    url: 'https://www.ozon.ru/challenge.html',
  });
  assert.deepEqual(detectBlock({ status: 403, body: { captchaURL: '/captcha' } }), { kind: 'captcha', url: '/captcha' });
  assert.deepEqual(detectBlock({ status: 403, body: { incidentId: 'fab_1', timeoutSec: 180 } }), { kind: 'blocked', seconds: 180 });
  assert.deepEqual(detectBlock({ status: 403, body: '<title>Antibot Challenge Page</title>' }), { kind: 'captcha' });
  assert.equal(detectBlock({ status: 200, body: { widgetStates: {} } }), null);
  assert.equal(detectBlock({ status: 404, body: { pageInfo: {} } }), null);
});

test('readAddress joins the header address bar', () => {
  const city = { customCell: { cells: [{ button: { text: 'Москва' } }, { button: { text: 'Укажите адрес' } }] } };
  const point = { customCell: { cells: [{ button: { text: 'Пункт Ozon •' } }, { text: { text: 'наб. канала Грибоедова, 12' } }] } };
  assert.equal(readAddress(city), 'Москва • Укажите адрес');
  assert.equal(readAddress(point), 'Пункт Ozon • наб. канала Грибоедова, 12');
  assert.equal(readAddress(undefined), null);
});
