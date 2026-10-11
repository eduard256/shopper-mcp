// Живая проверка всех площадок: node scripts/probe.mjs ["запрос"]. Открывает окно браузера, закрывает в конце.
// Для проверки параллельно с работающим MCP: MARKET_PROFILE_DIR=~/.market-mcp/profile-dev (копия профиля).
import { search, reviews, filters } from "../src/ozon.js";
import { dnsSearch, dnsProduct, dnsReviews } from "../src/dns.js";
import { yandexSearch, yandexCard, yandexReviews } from "../src/yandex.js";
import { compare } from "../src/compare.js";
import { shutdown } from "../src/browser.js";
const q = process.argv[2] || "индукционная варочная панель 30 см";
const brief = (o) => JSON.stringify(o, null, 1).slice(0, 1800);
const row = (i) => [i.brand, i.name?.slice(0, 45), i.price, i.rating, i.reviews, i.score].join(" | ");
const t0 = Date.now(); const lap = (l) => console.log(`--- ${l} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
try {
  const f = await filters({ query: q });
  lap("ozon_filters"); console.log(f.filters.map((x) => `${x.key}[${x.type}]${x.options ? " " + x.options.length + " opts" : ""}`).join(", "));
  const s = await search({ query: q, pages: 3, brand: "Bosch", ratingMin: 4.5, reviewsMin: 10, sortBy: "score", limit: 5 });
  lap("ozon_search brand+pages"); console.log("serverBrand:", s.serverBrand, "scanned:", s.scanned); console.log(s.items.map(row).join("\n"));
  const s2 = await search({ query: q, pages: 2, highRating: true, include: ["30 см"], reviewsMin: 100, sortBy: "score", limit: 6 });
  lap("ozon_search highRating+include"); console.log("scanned:", s2.scanned); console.log(s2.items.map(row).join("\n"));
  const rr = await reviews({ product: "3486517156", sinceMonths: 12, maxScore: 2, limit: 5, maxPages: 3 });
  lap("ozon_reviews recent low"); console.log(brief({ scanned: rr.scanned, count: rr.count, first: rr.reviews[0] }));
  const d = await dnsSearch({ query: "индукционная варочная панель", sort: "rating", pages: 2, include: ["2 шт"], reviewsMin: 50, sortBy: "score", limit: 6 });
  lap("dns_search sort+pages+include"); console.log("scanned:", d.scanned, "total:", d.totalOnSite); console.log(d.items.map((i) => row(i) + " | " + i.reliability + " | " + JSON.stringify(i.specs).slice(0, 80)).join("\n"));
  const dr = d.items[0] ? await dnsReviews({ product: d.items[0].url, sinceMonths: 12, maxScore: 3, limit: 3 }) : null;
  lap("dns_reviews recent low"); console.log(brief({ scanned: dr?.scanned, count: dr?.count, first: dr?.reviews[0] }));
  const y = await yandexSearch({ query: q, pages: 2, priceMax: 30000, include: ["2 конфорки"], sortBy: "price", limit: 5 });
  lap("yandex_search pages+filter"); console.log("scanned:", y.scanned); console.log(y.items.map(row).join("\n"));
  const yr = y.items[0] ? await yandexReviews({ product: y.items[0].url, limit: 2 }) : null;
  lap("yandex_reviews"); console.log(brief({ noReviews: yr?.noReviews, count: yr?.count, hint: yr?.hint }));
  const c = await compare({ products: ["3486517156", d.items[0]?.url, y.items[0]?.url].filter(Boolean), worst: 3, recentMonths: 12 });
  lap("compare"); console.log(brief(c.items.map((i) => ({ site: i.site, name: i.name?.slice(0, 40), rating: i.rating, reviews: i.reviews, score: i.score, lowSharePct: i.lowSharePct, aggregated: i.aggregated, worst: i.worst?.length, recentLow: i.recentLow?.count, error: i.error }))));
} catch (e) { console.log("ERR", e.stack); } finally { await shutdown(); }
