import assert from 'node:assert/strict';
import {cardUrl, yandexCard, yandexReviews} from '../src/yandex.js';

const canonical = 'https://market.yandex.ru/card/table/4671788663';
for (const value of [canonical, '/card/table/4671788663', 'card/table/4671788663', canonical + '?sku=123#specs']) {
  assert.equal(cardUrl(value), canonical);
}
assert.equal(cardUrl('https://market.yandex.ru/product--table/4671788663/reviews?hid=1'),
  'https://market.yandex.ru/product--table/4671788663');
for (const product of [
  'http://127.0.0.1/card/table/4671788663', 'https://evil.test/card/table/4671788663',
  'https://market.yandex.ru.evil.test/card/table/4671788663', 'https://market.yandex.ru@evil.test/card/table/4671788663',
  'https://user:pass@market.yandex.ru/card/table/4671788663', '//127.0.0.1/card/table/4671788663',
  'https://market.yandex.ru:8443/card/table/4671788663', 'http://market.yandex.ru/card/table/4671788663',
  'https://market.yandex.ru/redirect?url=http://127.0.0.1', 'file:///etc/passwd', '',
  '/card/table%2f..%2f..%2fredirect/4671788663', '/card/table\\evil/4671788663',
]) {
  assert.throws(() => cardUrl(product), /Invalid Yandex Market/);
  await assert.rejects(yandexCard({product}), /Invalid Yandex Market/);
  await assert.rejects(yandexReviews({product}), /Invalid Yandex Market/);
}
console.log('Yandex URL tests passed');

const {readFileSync} = await import('node:fs');
const {chromium} = await import('playwright');
const {parseYandexCharacteristics, parseYandexGallery} = await import('../src/yandex.js');
// Disposable offline browser, never the persistent marketplace/user profile.
const browser = await chromium.launch({headless: true});
try {
  const page = await browser.newPage();
  await page.route('**/*', route => route.abort());
  await page.setContent(readFileSync(new URL('../samples/yandex_card_specs.html', import.meta.url), 'utf8'));
  const parse = id => page.evaluate(([source, id]) => new Function(`return (${source})`)()(id),
    [parseYandexCharacteristics.toString(), id]);
  assert.deepEqual(await parse('4671788663'), {
    'Артикул Маркета': '4671788663', 'Конструкция': 'раздвижной', 'Размеры (ДхШхВ)': '90x150x75 см',
    'Длина в разложенном виде': '150 см', 'Материал столешницы': 'МДФ, шпон',
  });
  assert.deepEqual(await parse('1234567890'), {});
  await page.setContent('<h1>Стол 90 см</h1><div>Длина: 100 см</div><div>Акция: HardFest26</div>');
  assert.deepEqual(await parse('4671788663'), {});
  console.log('Yandex target-card fixture tests passed');
  // The card's own gallery strip, full size, in order, once each; not the related products' pictures.
  await page.setContent(readFileSync(new URL('../samples/yandex_card_gallery.html', import.meta.url), 'utf8'));
  const gallery = () => page.evaluate(source => new Function(`return (${source})`)()(), parseYandexGallery.toString());
  assert.deepEqual(await gallery(), [
    'https://avatars.mds.yandex.net/get-mpic/5209485/2a000001967148fbe59a0ba92f7432f6c9e1/orig',
    'https://avatars.mds.yandex.net/get-mpic/16055235/2a000001967148fbe573e08a0535963c052f/orig',
    'https://avatars.mds.yandex.net/get-mpic/12363834/2a000001967148fbe5b1887a5000982f763c/orig',
    'https://avatars.mds.yandex.net/get-mpic/15521812/2a000001967148fbe51e5ac8a7c5cb011f0d/orig',
  ]);
  // A card with one photo has no strip: its main picture is the gallery.
  await page.setContent('<div data-auto="media-viewer-gallery"><img src="https://avatars.mds.yandex.net/get-mpic/1/2a00ab/450x600"></div>');
  assert.deepEqual(await gallery(), ['https://avatars.mds.yandex.net/get-mpic/1/2a00ab/orig']);
  await page.setContent('<h1>Нет фото</h1>');
  assert.deepEqual(await gallery(), []);
  console.log('Yandex gallery fixture tests passed');
} finally {
  await browser.close();
}
