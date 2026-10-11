// Pure parsers over Ozon's composer-api JSON. No browser, no network here —
// every function takes a parsed composer-api response object and returns plain data.
// Kept side-effect-free so it can be unit-tested against saved samples.

/**
 * widgetStates keys look like "webPrice-3121879-default-1". Match by the exact widget NAME
 * (the part before the first "-"), so "webPrice" doesn't also match "webPriceDecreasedCompact".
 */
function widgetName(key) {
  return String(key).split("-")[0];
}

function widget(page, name) {
  const ws = page?.widgetStates || {};
  const key = Object.keys(ws).find((k) => widgetName(k) === name);
  if (!key) return null;
  try {
    return JSON.parse(ws[key]);
  } catch {
    return null;
  }
}

/** All widgets with the given exact widget name, parsed. */
function widgets(page, name) {
  const ws = page?.widgetStates || {};
  return Object.keys(ws)
    .filter((k) => widgetName(k) === name)
    .map((k) => {
      try {
        return JSON.parse(ws[k]);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

/** "53 022 ₽" -> 53022 ; null/garbage -> null */
function priceToNumber(text) {
  if (typeof text !== "string") return null;
  const digits = text.replace(/[^\d]/g, "");
  return digits ? parseInt(digits, 10) : null;
}

/** strip ?at=... tracking and make absolute */
function cleanUrl(link) {
  if (!link) return null;
  const path = String(link).split("?")[0];
  return path.startsWith("http") ? path : `https://www.ozon.ru${path}`;
}

/** pull the numeric sku out of a product url/slug: ...-1185261285/ -> "1185261285" */
function skuFromUrl(url) {
  const m = String(url || "").match(/-(\d+)\/?(?:\?|$)/) || String(url || "").match(/(\d{6,})/);
  return m ? m[1] : null;
}

// ── search ─────────────────────────────────────────────────────────────────────
// Products live in the `tileGridDesktop-*` widget as `items[]`. Each item carries a
// `mainState[]` array of typed blocks (priceV2 / textDS name / labelListV2 rating).

function parseSearchItem(it) {
  if (!it) return null;
  const ms = Array.isArray(it.mainState) ? it.mainState : [];

  // price block
  const priceBlock = ms.find((s) => s.type === "priceV2")?.priceV2;
  const prices = priceBlock?.price || [];
  const price = priceToNumber(prices.find((p) => p.textStyle === "PRICE")?.text);
  const oldPrice = priceToNumber(prices.find((p) => p.textStyle === "ORIGINAL_PRICE")?.text);

  // name block (id === "name")
  const name = ms.find((s) => s.id === "name")?.textDS?.text || null;

  // rating block: a labelListV2 that contains a star icon
  let rating = null;
  let reviews = null;
  const ratingList = ms.find(
    (s) => s.labelListV2 && JSON.stringify(s.labelListV2).includes("ic_s_star")
  )?.labelListV2?.items;
  if (Array.isArray(ratingList)) {
    const texts = ratingList.filter((x) => x.type === "text").map((x) => x.text?.text);
    // first text after the star = rating, the one after the dialog icon = review count
    if (texts[0]) rating = parseFloat(String(texts[0]).replace(",", "."));
    if (texts[1]) reviews = priceToNumber(texts[1]);
  }

  // brand: a labelListV2 that is not the rating block; take its first text item, but skip
  // marketing badges ("Стало дешевле", "Оригинал", "Хит", price-drop labels, etc.)
  const BADGE = /^(стало дешевле|оригинал|хит|новинка|акция|распродажа|выбор|бестселлер|ozon|premium|самовывоз|скидка|бренд проверен|официальн)/i;
  let brand = null;
  const labelLists = ms
    .filter((s) => s.labelListV2 && !JSON.stringify(s.labelListV2).includes("ic_s_star"))
    .map((s) => s.labelListV2);
  for (const ll of labelLists) {
    const cand = (ll.items || []).find((x) => x.type === "text")?.text?.text?.trim();
    if (cand && !BADGE.test(cand)) {
      brand = cand;
      break;
    }
  }

  const url = cleanUrl(it.action?.link);
  const sku = String(it.sku || it.id || skuFromUrl(url) || "") || null;

  // first image
  const image =
    it.tileImage?.items?.find((x) => x.image?.link)?.image?.link ||
    it.tileImage?.coverImage ||
    null;

  if (!sku || !price) return null; // a real product always has both
  return {
    sku,
    name,
    price,
    oldPrice: oldPrice && oldPrice > price ? oldPrice : null,
    discount: priceBlock?.discount || null,
    rating,
    reviews,
    brand,
    url,
    image,
  };
}

export function parseSearch(page, limit = 12) {
  const grid = widget(page, "tileGridDesktop");
  const raw = grid?.items || [];
  const items = raw.map(parseSearchItem).filter(Boolean).slice(0, limit);
  const hasNext = !!widget(page, "infiniteVirtualPaginator")?.nextPage;
  return { count: items.length, hasNext, items };
}

// ── search filters ──────────────────────────────────────────────────────────────
// filtersDesktop.sections[].filters[]: {type, key, boolFilter|checkboxesFilter|rangeFilter|
// multipleRangesFilter|colorFilter|categoryFilter}. В URL: bool -> key=t, checkboxes -> key=id1,id2,
// range -> key=min.000;max.000. Категория задаётся отдельным путём /category/<slug>/.

function filterOptions(f) {
  const cb = f.checkboxesFilter || f.colorFilter;
  if (cb) return (cb.sections || []).flatMap((s) => s.items || []).map((i) => ({ key: String(i.key), title: i.title?.text || i.title || i.name || String(i.key), selected: !!i.isSelected })).filter((o) => o.title);
  if (f.categoryFilter) return (f.categoryFilter.categories || []).map((c) => ({ key: c.urlValue || c.key, title: c.title, level: c.level }));
  return [];
}

function filterRange(f) {
  const r = f.rangeFilter || f.multipleRangesFilter?.rangeFilter;
  if (!r) return null;
  const num = (x) => (x == null ? null : Number(String(x).replace(/[^\d.]/g, "")) || null);
  return { min: num(r.minValue ?? r.min ?? r.leftBound), max: num(r.maxValue ?? r.max ?? r.rightBound) };
}

/** Все фильтры страницы поиска/каталога: [{key, title, type, options[], range}]. */
export function parseFilters(page) {
  const out = [];
  for (const w of widgets(page, "filtersDesktop")) {
    for (const s of w.sections || []) {
      for (const f of s.filters || []) {
        const body = f.boolFilter || f.checkboxesFilter || f.colorFilter || f.rangeFilter || f.multipleRangesFilter?.rangeFilter || f.categoryFilter || {};
        const type = f.type === "boolFilter" ? "bool" : /checkboxes|color/.test(f.type) ? "checkboxes" : /range/i.test(f.type) ? "range" : f.type === "categoryFilter" ? "category" : f.type;
        const entry = { key: f.key, title: (body.title || "").replace(/\s+/g, " ").trim(), type };
        if (body.description?.text) entry.description = body.description.text.replace(/<[^>]+>/g, "").trim();
        const options = filterOptions(f);
        if (options.length) entry.options = options;
        const range = filterRange(f);
        if (range) entry.range = range;
        if (!out.some((e) => e.key === entry.key)) out.push(entry);
      }
    }
  }
  return out;
}

// ── product details ─────────────────────────────────────────────────────────────
// Base PDP page carries webPrice / webProductHeading / webGallery / webReviewProductScore /
// webShortCharacteristics / webCurrentSeller. The description (webDescription) lives on
// the `pdpPage2column` page (page index 2), so details merges two pages.

/** join an array of rich-text nodes ({text}|{content}) into a plain string */
function rsText(arr) {
  return (arr || [])
    .map((v) => v.text || v.content)
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseShortCharacteristics(page) {
  const w = widget(page, "webShortCharacteristics");
  const out = {};
  // characteristics[] is a flat list; title.textRs[] = name, values[] = value(s)
  for (const c of w?.characteristics || []) {
    const title = rsText(c.title?.textRs) || (typeof c.title === "string" ? c.title : null);
    const value = rsText(c.values || c.contentRS || c.valueRs);
    if (title && value) out[title] = value;
  }
  return out;
}

/** product's own rating + review count, from webSingleProductScore: "4.9 • 819 отзывов" */
function parseProductScore(page) {
  const w = widget(page, "webSingleProductScore") || widget(page, "webReviewProductScore");
  const text = w?.text || JSON.stringify(w || {});
  let rating = null;
  let reviews = null;
  const rm = text.match(/(\d[.,]\d)/);
  if (rm) rating = parseFloat(rm[1].replace(",", "."));
  const cm = text.match(/(\d[\d\s]*)\s*отзыв/);
  if (cm) reviews = priceToNumber(cm[1]);
  return { rating, reviews };
}

function parseSeller(page) {
  const w = widget(page, "webCurrentSeller");
  if (!w) return null;
  const name = w.sellerCell?.centerBlock?.title?.text || w.title?.text || null;
  const rating = parseFloat(String(w.rating?.title?.text || "").replace(",", ".")) || null;
  const url = cleanUrl(w.sellerCell?.common?.action?.link);
  if (!name) return null;
  return { name, rating, url };
}

/**
 * Полные характеристики со страницы /features/ (composer): webCharacteristics.characteristics[].short[]/long[]
 * -> {name: "значение, значение"}. Берём виджет с наибольшим числом позиций (второй дублирует первые пять).
 */
export function parseFullCharacteristics(featuresPage) {
  let best = {};
  for (const w of widgets(featuresPage, "webCharacteristics")) {
    const out = {};
    for (const g of w.characteristics || []) {
      for (const c of [...(g.short || []), ...(g.long || [])]) {
        const name = c.name || c.key;
        const value = (c.values || []).map((v) => v.text).filter(Boolean).join(", ");
        if (name && value) out[name] = value;
      }
    }
    if (Object.keys(out).length > Object.keys(best).length) best = out;
  }
  return best;
}

export function parseDetails(basePage) {
  const heading = widget(basePage, "webProductHeading");
  const price = widget(basePage, "webPrice");
  const gallery = widget(basePage, "webGallery");

  const sku =
    String(gallery?.sku || basePage?.layoutTrackingInfo && JSON.parse(basePage.layoutTrackingInfo || "{}").sku || "") ||
    skuFromUrl(basePage?.seo?.link?.[0]?.href) ||
    null;

  const url =
    cleanUrl(basePage?.seo?.link?.[0]?.href) ||
    (sku ? `https://www.ozon.ru/product/${sku}/` : null);

  const { rating, reviews } = parseProductScore(basePage);
  // webAspects: варианты (цвет, размер) одной карточки. Отзывы и рейтинг у вариантов общие,
  // поэтому variants > 1 значит "рейтинг агрегирован по нескольким моделям/цветам".
  const aspects = widget(basePage, "webAspects")?.aspects || [];
  const variants = aspects.reduce((m, a) => Math.max(m, Number(a.aspectModalInfo?.realNumberOfVariants) || (a.variants || []).length || 0), 0) || null;

  const images = [];
  if (gallery?.coverImage) images.push(gallery.coverImage);
  for (const im of gallery?.images || []) {
    const src = im?.src || im?.image || im;
    if (typeof src === "string") images.push(src);
  }

  return {
    sku,
    name: heading?.title || basePage?.seo?.title || null,
    url,
    price: priceToNumber(price?.cardPrice) ?? priceToNumber(price?.price),
    priceRegular: priceToNumber(price?.price),
    oldPrice: priceToNumber(price?.originalPrice),
    available: price?.isAvailable ?? null,
    rating,
    reviews,
    variants,
    seller: parseSeller(basePage),
    images: [...new Set(images)].slice(0, 10),
    characteristics: parseShortCharacteristics(basePage),
  };
}

// ── reviews ─────────────────────────────────────────────────────────────────────
// webListReviews holds reviews[]; each has content.{comment,positive,negative,score},
// author, publishedAt (unix), usefulness, isItemPurchased.

function unixToDate(ts) {
  if (!ts) return null;
  const d = new Date(ts * 1000);
  if (isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

export function parseReviews(page, limit = 10) {
  const w = widget(page, "webListReviews");
  const raw = w?.reviews || w?.items || [];
  const { rating, reviews: total } = parseProductScore(page);

  const reviews = raw.slice(0, limit).map((r) => {
    const c = r.content || {};
    const author =
      r.author?.title ||
      [r.author?.firstName, r.author?.lastName].filter(Boolean).join(" ") ||
      (r.isAnonymous ? "Аноним" : null);
    return {
      author: author || null,
      score: typeof c.score === "number" ? c.score : null,
      comment: c.comment || "",
      pros: c.positive || "",
      cons: c.negative || "",
      date: unixToDate(r.publishedAt || r.createdAt),
      useful: r.usefulness?.useful ?? null,
      purchased: r.isItemPurchased ?? null,
      hasPhotos: Array.isArray(c.photos) && c.photos.length > 0,
    };
  });

  const scoreW = widget(page, "webReviewProductScore");
  const distribution = Array.isArray(scoreW?.score)
    ? Object.fromEntries(scoreW.score.map((x) => [String(x.title).match(/\d/)?.[0] ?? x.title, x.value]))
    : null;
  const paging = w?.paging ? { page: w.paging.page, perPage: w.paging.perPage, total: w.paging.total } : null;
  const sortings = Array.isArray(w?.sortings) ? w.sortings.map((x) => x.value) : null;
  return { rating, totalReviews: total, distribution, paging, sortings, count: reviews.length, reviews };
}

export const _internal = { priceToNumber, cleanUrl, skuFromUrl, widget };
