import {readFileSync} from 'node:fs';
import {chromium} from 'playwright';
const forbidden = readFileSync(new URL('./dns-forbidden.html', import.meta.url), 'utf8');
const launch = chromium.launchPersistentContext.bind(chromium);
chromium.launchPersistentContext = async (...args) => {
  const context = await launch(...args);
  const newPage = context.newPage.bind(context);
  context.newPage = async (...args) => {
    const page = await newPage(...args);
    await page.route('**/*', route => {
      const url = route.request().url();
      if (!url.startsWith('https://www.dns-shop.ru/') && !url.startsWith('https://market.yandex.ru/')) return route.abort();
      let body = url.startsWith("https://market.yandex.ru/") ? "<title>403</title><h1>Forbidden</h1>" : forbidden;
      if (url.includes('/russian-robot/')) body = '<title>Яндекс Маркет</title><h1>Вы не робот?</h1>';
      if (url.includes('/captcha-url/')) body = "<title>Яндекс</title><main>Продолжить</main><script>history.replaceState({}, '', '/showcaptcha?retpath=fixture')</script>";
      if (url.includes('/russian-title/')) body = '<title>Вы не робот?</title><main>Продолжить</main>';
      if (url.includes('/captcha/')) body = '<title>DNS</title><p>Подтвердите, что вы не робот</p><p>captcha</p>';
      if (url.includes('/good/')) body = '<title>Технические характеристики Xiaomi Air Fryer | DNS</title><meta property="og:image" content="https://dns-shop.ru/img/af.jpg"><p>8999 ₽</p><h2>Характеристики</h2><div>Ширина</div><div>389 мм</div><div>Высота</div><div>326 мм</div><div>Глубина</div><div>320 мм</div><h2>Аксессуары</h2>';
      if (url.includes('/embed-only/')) body = '<title>Технические характеристики Встраиваемая панель | DNS</title><p>15999 ₽</p><h2>Характеристики</h2><div>Ширина встраивания</div><div>560 мм</div><h2>Аксессуары</h2>';
      if (url.includes('/yandex-good/')) body = '<title>Стол кухонный — купить на Яндекс Маркете</title><meta property="og:image" content="https://avatars.mds.yandex.net/table.jpg"><h1>Стол кухонный</h1><div data-auto="specs-list-minimal"><div aria-label="Характеристики"><div><div><div><span data-auto="product-spec">Артикул Маркета</span></div><div></div><div><span>4707220787</span></div></div></div><div><label><div><span>Размеры (ДхШхВ)</span></div><div></div><div><span>90x150x75 см</span></div></label></div></div></div>';
      if (url.includes('/empty/')) body = '<title>Xiaomi | DNS</title><p>Нет описания</p><p>389 мм</p>';
      // Qrator: the first visit answers 401 with a JS challenge that reloads into the real page.
      if (url.includes('/js-reload/') && !url.includes('passed=1')) {
        return route.fulfill({status: 401, contentType: 'text/html; charset=utf-8',
          body: "<title>DNS</title><script>setTimeout(() => location.replace(location.pathname + '?passed=1'), 300)</script>"});
      }
      if (url.includes('/js-reload/')) body = '<title>Технические характеристики Reload Fridge | DNS</title><p>11999 ₽</p><h2>Характеристики</h2><div>Ширина</div><div>480 мм</div><h2>Аксессуары</h2>';
      return route.fulfill({status: url.includes('/status403/') ? 403 : 200, contentType: 'text/html; charset=utf-8', body});
    });
    return page;
  };
  return context;
};
