// DNS (dns-shop.ru): поиск, характеристики и отзывы. Сайт за Qrator, JSON-API нет, читаем
// отрендеренные страницы из общего браузера: списки по DOM, отзывы и характеристики по innerText.
import { openPage, queued } from "./browser.js";
import { parseDnsOpinions } from "./parse_dns.js";
import { parseCardSpecs, refine } from "./rank.js";
import { productUrl } from "./urls.js";
import { withItemDimensions } from "./dimensions.js";

const BASE = "https://www.dns-shop.ru";
const SORT_MAP = { popular: "", rating: "rating", price: "price-asc", price_desc: "price-desc", new: "new", discount: "discount" };

/** Принимает url карточки DNS, путь "/product/<id>/<slug>/" или голый id; отдаёт "<id>/<slug>/" или "<id>/". */
function productKey(product) {
  return new URL(productUrl('dns', product)).pathname.slice('/product/'.length);
}

function withPage(url, label, fn, settleMs = 4000) {
  return queued("dns", async () => {
    const page = await openPage(url, { label, settleMs });
    try {
      return await fn(page);
    } finally {
      await page.close().catch(() => {});
    }
  });
}

/** Карточки выдачи DNS на текущей странице: название, цена, рейтинг, отзывы, короткие характеристики, надёжность. */
function readCards(page, lim) {
  return page.evaluate((lim) => {
    const cards = [...document.querySelectorAll("[data-id='product'], .catalog-product")];
    const out = [];
    for (const c of cards) {
      const a = c.querySelector("a.catalog-product__name");
      if (!a) continue;
      const rating = c.querySelector(".catalog-product__rating");
      const price = c.querySelector(".product-buy__price");
      const rt = (rating?.innerText || "").replace(/\s+/g, " ").trim();
      const rm = rt.match(/(\d[.,]\d+)\s*\|\s*([\d.,]+)\s*([kк])?/i);
      const pm = (price?.innerText || "").replace(/\s/g, "").match(/(\d+)₽/);
      const text = c.innerText || "";
      const name = (a.innerText || "").trim();
      out.push({
        name,
        brand: (name.match(/(?:поверхность|панель|машина|шкаф|холодильник|духовой шкаф|вытяжка|мойка|смеситель)\s+([A-Za-zА-Яа-я&\-]+)/) || [])[1] || null,
        url: new URL(a.getAttribute("href"), location.origin).href.split("?")[0],
        price: pm ? Number(pm[1]) : null,
        rating: rm ? Number(rm[1].replace(",", ".")) : null,
        reviews: rm ? Math.round(Number(rm[2].replace(",", ".")) * (rm[3] ? 1000 : 1)) : /нет отзывов/i.test(rt) ? 0 : null,
        reliability: (text.match(/(Отличная|Хорошая|Низкая|Средняя) надежность/) || [])[0] || null,
        specsText: text,
      });
      if (out.length >= lim) break;
    }
    const total = (document.body.innerText.match(/Найдено\s+(\d[\d\s]*)\s+товар/) || [])[1];
    return { items: out, nothingFound: /ничего не найдено/i.test(document.body.innerText), total: total ? Number(total.replace(/\s/g, "")) : null, url: location.href };
  }, lim);
}

/**
 * Поиск DNS: серверная сортировка (order=rating|price-asc|price-desc|new|discount), обход pages страниц
 * (p=N) и общий клиентский фильтр. В карточках есть короткие характеристики (specs), по ним работает include/exclude.
 */
export async function dnsSearch({ query, limit = 12, sort = "popular", pages = 1, ...opts }) {
  if (!query || !String(query).trim()) throw new Error("query is required");
  const order = SORT_MAP[sort] ? `&order=${SORT_MAP[sort]}` : "";
  const base = `${BASE}/search/?q=${encodeURIComponent(query)}${order}`;
  const all = [];
  let meta = null;
  for (let n = 1; n <= pages; n++) {
    // после первой страницы DNS переходит в категорию (&category=...): дальше ходим по её url
    const url = n === 1 ? base : `${meta.url.split("&p=")[0]}${meta.url.includes("?") ? "&" : "?"}p=${n}`;
    const data = await withPage(url, "dns-search", (page) => readCards(page, 100));
    if (!meta) meta = data;
    if (!data.items.length) break;
    all.push(...data.items);
    if (meta.total != null && all.length >= meta.total) break;
  }
  const items = refine(all.map(({ specsText, ...it }) => ({ ...it, specs: parseCardSpecs(specsText) })), opts, limit);
  return { query, sort, scanned: all.length, totalOnSite: meta?.total ?? null, nothingFound: meta?.nothingFound ?? false, count: items.length, items };
}

export async function dnsProduct({ product }) {
  const key = productKey(product);
  return withPage(`${BASE}/product/characteristics/${key}`, "dns-characteristics", async (page) => {
    // полный список характеристик раскрывается кнопкой
    const btn = page.getByText("Все характеристики", { exact: true }).first();
    if (await btn.count()) {
      await btn.click().catch(() => {});
      await page.waitForTimeout(1500);
    }
    const data = await page.evaluate(() => {
      const t = document.body.innerText.replace(/[   ]/g, " ");
      const pm = t.replace(/\s/g, "").match(/(\d{3,7})₽/);
      const rm = t.match(/(\d[.,]\d+)\s*\n\s*(\d+)\s*отзыв/);
      const characteristics = {};
      let group = "";
      for (const el of document.querySelectorAll(".product-characteristics__group-title, .product-characteristics__spec-title, .product-characteristics__spec-value")) {
        const txt = (el.innerText || "").replace(/\s+/g, " ").trim();
        if (!txt) continue;
        if (el.classList.contains("product-characteristics__group-title")) group = txt;
        else if (el.classList.contains("product-characteristics__spec-title")) characteristics[(group ? group + " / " : "") + txt] = null;
        else {
          const k = Object.keys(characteristics).findLast((x) => characteristics[x] === null);
          if (k) characteristics[k] = txt;
        }
      }
      if (!Object.keys(characteristics).length) {
        // запасной путь по тексту: пары строк между "Характеристики" и "Все характеристики"/"Аксессуары"
        const lines = t.split("\n").map((l) => l.trim()).filter(Boolean);
        const start = lines.lastIndexOf("Характеристики");
        for (let i = start + 1; start >= 0 && i + 1 < lines.length; i += 2) {
          if (/^(Все характеристики|Аксессуары)$/.test(lines[i])) break;
          characteristics[lines[i]] = lines[i + 1];
        }
      }
      const image = document.querySelector('meta[property="og:image"]')?.content || null;
      return { price: pm ? Number(pm[1]) : null, rating: rm ? Number(rm[1].replace(",", ".")) : null, reviews: rm ? Number(rm[2]) : null, characteristics, image };
    });
    const title = await page.title();
    const { image, ...card } = data;
    return withItemDimensions({ url: `${BASE}/product/${key}`, name: title.replace(/^Технические характеристики\s*/i, "").split("|")[0].trim(), ...card }, image);
  });
}

/**
 * Отзывы DNS (новые первыми). Страница показывает первые несколько, остальные подгружаются кнопкой
 * "Показать ещё": жмём её, пока отзывов меньше want (limit, для sinceMonths/maxScore до 200).
 * sinceMonths / maxScore отбирают свежие и плохие из загруженных.
 */
export async function dnsReviews({ product, limit = 20, sinceMonths, maxScore }) {
  const key = productKey(product);
  const want = sinceMonths != null || maxScore != null ? 200 : limit;
  return withPage(`${BASE}/product/opinion/${key}`, "dns-opinions", async (page) => {
    const count = () => page.evaluate(() => (document.body.innerText.match(/Dns-shop\.ru/g) || []).length);
    let have = await count();
    for (let i = 0; i < 12 && have < want; i++) {
      const btn = page.getByRole("button", { name: /Показать ещё/i }).first();
      if (!(await btn.count())) break;
      await btn.scrollIntoViewIfNeeded().catch(() => {});
      await btn.click().catch(() => {});
      await page.waitForTimeout(1500);
      const now = await count();
      if (now <= have) break;
      have = now;
    }
    const text = await page.evaluate(() => document.body.innerText);
    const parsed = parseDnsOpinions(text, 200);
    let list = parsed.reviews;
    const scanned = list.length;
    if (sinceMonths != null) {
      const cutoff = new Date(Date.now() - sinceMonths * 30.44 * 86400e3).toISOString().slice(0, 10);
      list = list.filter((r) => r.date && r.date >= cutoff);
    }
    if (maxScore != null) list = list.filter((r) => typeof r.score === "number" && r.score <= maxScore);
    return { url: `${BASE}/product/opinion/${key}`, ...parsed, sinceMonths: sinceMonths ?? null, maxScore: maxScore ?? null, scanned, count: Math.min(list.length, limit), reviews: list.slice(0, limit) };
  }, 5000);
}

export const _internal = { productKey };
