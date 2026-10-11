// Общие фильтры и ранжирование выдачи. Чистые функции над массивами товаров {name, brand, price,
// rating, reviews, specs}: одни и те же параметры для Ozon, DNS и Маркета, площадка отдаёт сырую
// выдачу, а отбор по бренду / рейтингу / числу отзывов / цене / словам делается здесь.

/** Байесовская оценка: рейтинг, "притянутый" к среднему по рынку при малом числе отзывов. */
export function bayes(rating, reviews, { prior = 4.3, weight = 30 } = {}) {
  if (typeof rating !== "number") return null;
  const n = Math.max(0, Number(reviews) || 0);
  return Math.round(((n * rating + weight * prior) / (n + weight)) * 100) / 100;
}

/** Доля оценок 1-2 звезды по распределению {5:n,4:n,3:n,2:n,1:n}. */
export function lowShare(distribution) {
  if (!distribution) return null;
  const total = Object.values(distribution).reduce((a, b) => a + (Number(b) || 0), 0);
  if (!total) return null;
  return Math.round(((Number(distribution[1]) || 0) + (Number(distribution[2]) || 0)) / total * 1000) / 10;
}

const norm = (s) => String(s || "").toLowerCase().replace(/ё/g, "е");

function haystack(item) {
  const specs = item.specs && typeof item.specs === "object" ? Object.entries(item.specs).map(([k, v]) => `${k}: ${v}`).join("\n") : Array.isArray(item.specs) ? item.specs.join("\n") : item.specs;
  return norm([item.name, item.brand, specs].filter(Boolean).join("\n"));
}

/**
 * Оставить товары, прошедшие все заданные условия. Незаданные условия пропускают всё.
 *  brand      - бренд (по полю brand или по названию), без учёта регистра
 *  ratingMin  - рейтинг не ниже; товары без рейтинга отсеиваются
 *  reviewsMin - отзывов не меньше; без отзывов отсеиваются
 *  priceMin / priceMax
 *  include    - каждое слово должно встретиться в названии или характеристиках
 *  exclude    - ни одно слово не должно встретиться
 */
export function filterItems(items, { brand, ratingMin, reviewsMin, priceMin, priceMax, include = [], exclude = [] } = {}) {
  const b = norm(brand);
  const inc = include.map(norm).filter(Boolean);
  const exc = exclude.map(norm).filter(Boolean);
  return items.filter((it) => {
    if (b && !norm(it.brand).includes(b) && !norm(it.name).includes(b)) return false;
    if (ratingMin != null && !(typeof it.rating === "number" && it.rating >= ratingMin)) return false;
    if (reviewsMin != null && !(typeof it.reviews === "number" && it.reviews >= reviewsMin)) return false;
    if (priceMin != null && !(typeof it.price === "number" && it.price >= priceMin)) return false;
    if (priceMax != null && !(typeof it.price === "number" && it.price <= priceMax)) return false;
    if (inc.length || exc.length) {
      const h = haystack(it);
      if (inc.some((w) => !h.includes(w))) return false;
      if (exc.some((w) => h.includes(w))) return false;
    }
    return true;
  });
}

const SORTERS = {
  rating: (a, b) => (b.rating ?? -1) - (a.rating ?? -1) || (b.reviews ?? 0) - (a.reviews ?? 0),
  reviews: (a, b) => (b.reviews ?? -1) - (a.reviews ?? -1),
  price: (a, b) => (a.price ?? Infinity) - (b.price ?? Infinity),
  price_desc: (a, b) => (b.price ?? -1) - (a.price ?? -1),
  score: (a, b) => (b.score ?? -1) - (a.score ?? -1),
};

/** Отсортировать копию; sortBy: rating | reviews | price | price_desc | score (байесовский). Иное - порядок площадки. */
export function sortItems(items, sortBy) {
  const withScore = items.map((it) => ({ ...it, score: bayes(it.rating, it.reviews) }));
  const cmp = SORTERS[sortBy];
  return cmp ? [...withScore].sort(cmp) : withScore;
}

/** Убрать дубли по url (при обходе нескольких страниц площадки повторяют товары). */
export function dedupe(items) {
  const seen = new Set();
  return items.filter((it) => {
    const k = it.url || it.sku || it.name;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** Короткие характеристики карточки DNS: строки вида "Габариты:" + "29 см x 52 см" -> объект. */
export function parseCardSpecs(text) {
  const lines = String(text || "").split("\n").map((l) => l.trim()).filter(Boolean);
  const out = {};
  for (let i = 0; i + 1 < lines.length; i++) {
    if (/:$/.test(lines[i]) && !/:$/.test(lines[i + 1])) out[lines[i].slice(0, -1)] = lines[i + 1];
  }
  return out;
}

/** Общие параметры фильтра для zod-схем инструментов поиска (описания на английском, как остальные схемы). */
export function filterSchema(z) {
  return {
    brand: z.string().optional().describe("Keep only this brand (matched against brand or name, case-insensitive)"),
    ratingMin: z.number().min(0).max(5).optional().describe("Minimum product rating, e.g. 4.7"),
    reviewsMin: z.number().int().nonnegative().optional().describe("Minimum number of reviews, e.g. 100"),
    priceMin: z.number().int().nonnegative().optional().describe("Minimum price in RUB"),
    priceMax: z.number().int().nonnegative().optional().describe("Maximum price in RUB"),
    include: z.array(z.string()).optional().describe('Every word must appear in name or specs, e.g. ["30 см", "2 конфорки"]'),
    exclude: z.array(z.string()).optional().describe("None of these words may appear in name or specs"),
    sortBy: z.enum(["rating", "reviews", "price", "price_desc", "score"]).optional().describe("Client-side order of the merged pages: rating, reviews, price, price_desc, score (Bayesian rating that discounts few reviews). Default: marketplace order"),
    pages: z.number().int().min(1).max(5).default(1).describe("How many result pages to walk (1-5). Use 2-3 with filters: each page is small"),
  };
}

/** Применить общий фильтр к собранной выдаче: дедуп -> фильтр -> сортировка -> лимит. */
export function refine(items, opts, limit) {
  const filtered = filterItems(dedupe(items), opts);
  return sortItems(filtered, opts.sortBy).slice(0, limit);
}
