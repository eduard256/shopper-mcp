// Шорт-лист: по списку товаров с любых площадок одним вызовом собрать рейтинг, число отзывов,
// распределение по звёздам, долю 1-2 звёзд, худшие отзывы и свежие плохие. Площадка определяется по url.
import { details, reviews } from "./ozon.js";
import { dnsProduct, dnsReviews } from "./dns.js";
import { yandexCard, yandexReviews } from "./yandex.js";
import { lowShare, bayes } from "./rank.js";
import { productSite as site } from "./urls.js";

/** Promise.all, но без "unhandled rejection" у остальных промисов при первой ошибке. */
async function all(promises) {
  const res = await Promise.allSettled(promises);
  const bad = res.find((r) => r.status === "rejected");
  if (bad) throw bad.reason;
  return res.map((r) => r.value);
}

const brief = (r) => ({ score: r.score, date: r.date, useful: r.useful ?? undefined, text: [r.cons, r.comment, r.pros].filter(Boolean).join(" | ").slice(0, 400) });

async function one(product, { worst, recentMonths }) {
  const s = site(product);
  if (s === "ozon") {
    const [d, w, recent] = await all([
      details({ product, description: false }),
      reviews({ product, sort: "worst", limit: worst }),
      reviews({ product, sinceMonths: recentMonths, maxScore: 2, limit: 10, maxPages: 3 }),
    ]);
    return {
      site: s, name: d.name, url: d.url, price: d.price, rating: d.rating, reviews: d.reviews,
      aggregated: d.variants > 1 ? `Ozon card has ${d.variants} variants: rating and reviews are shared across them` : null,
      distribution: w.distribution, worst: w.reviews.map(brief),
      recentLow: { months: recentMonths, scanned: recent.scanned, count: recent.reviews.length, reviews: recent.reviews.map(brief) },
    };
  }
  if (s === "dns") {
    const [d, r] = await all([dnsProduct({ product }), dnsReviews({ product, limit: 200 })]);
    const sorted = [...r.reviews].sort((a, b) => (a.score ?? 6) - (b.score ?? 6));
    const cutoff = new Date(Date.now() - recentMonths * 30.44 * 86400e3).toISOString().slice(0, 10);
    const recent = r.reviews.filter((x) => x.date >= cutoff && x.score != null && x.score <= 2);
    return {
      site: s, name: d.name, url: d.url, price: d.price, rating: d.rating ?? r.rating, reviews: d.reviews ?? r.totalReviews,
      aggregated: null, distribution: r.distribution, worst: sorted.slice(0, worst).map(brief),
      recentLow: { months: recentMonths, scanned: r.reviews.length, count: recent.length, reviews: recent.slice(0, 10).map(brief) },
    };
  }
  // Маркет не отдаёт оценки отдельных отзывов: вместо худших - отзывы с заполненными "Недостатки"
  const [c, r] = await all([yandexCard({ product }), yandexReviews({ product, limit: 200 })]);
  const withCons = r.reviews.filter((x) => x.cons && !/^(нет|не выявил|не обнаружил|пока нет)/i.test(x.cons));
  return {
    site: s, name: c.name, url: c.url, price: c.price, rating: r.rating, reviews: r.totalRatings,
    aggregated: null, distribution: null, noReviews: r.noReviews || undefined, hint: r.hint,
    worst: withCons.slice(0, worst).map(brief),
    recentLow: { months: recentMonths, scanned: r.reviews.length, count: null, reviews: [], note: "Yandex exposes no per-review scores" },
  };
}

/** products: список url/sku/id (до 6). worst: сколько худших отзывов на товар. recentMonths: окно свежих плохих. */
export async function compare({ products, worst = 8, recentMonths = 12 }) {
  if (!Array.isArray(products) || !products.length) throw new Error("products[] is required");
  products.slice(0, 6).forEach(site); // Validate the entire batch before opening any page.
  const results = await Promise.all(
    products.slice(0, 6).map((p) => one(p, { worst, recentMonths }).catch((e) => ({ site: site(p), product: p, error: e.message })))
  );
  const rows = results.map((r) => (r.error ? r : { ...r, lowSharePct: lowShare(r.distribution), score: bayes(r.rating, r.reviews) }));
  const ranked = [...rows].sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
  return {
    criteria: "score = Bayesian rating (few reviews pull towards 4.3); lowSharePct = share of 1-2 star ratings; read worst[] and recentLow[] before choosing",
    count: rows.length,
    items: ranked,
  };
}
