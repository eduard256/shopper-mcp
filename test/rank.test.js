// Офлайн-тесты фильтров/ранжирования и парсера фильтров Ozon.
import { readFileSync } from "fs";
import { bayes, lowShare, filterItems, sortItems, dedupe, parseCardSpecs, refine } from "../src/rank.js";
import { parseFilters, parseSearch } from "../src/parse.js";
import { parseYandexReviews } from "../src/yandex.js";
import { _internal } from "../src/ozon.js";

let failed = 0;
const check = (cond, msg) => { console.error(`${cond ? "  ok " : " FAIL"}  ${msg}`); if (!cond) failed++; };

console.error("── rank ──");
check(bayes(5, 1) < 4.4, `bayes(5,1)=${bayes(5, 1)} pulls towards prior`);
check(bayes(4.8, 3000) > 4.79, `bayes(4.8,3000)=${bayes(4.8, 3000)} keeps rating`);
check(bayes(null, 10) === null, "bayes without rating is null");
check(lowShare({ 5: 90, 4: 5, 3: 0, 2: 2, 1: 3 }) === 5, `lowShare=${lowShare({ 5: 90, 4: 5, 3: 0, 2: 2, 1: 3 })}`);
check(lowShare(null) === null, "lowShare(null)");
const items = [
  { name: "Bosch PIB375FB1E панель 30 см", brand: "Bosch", price: 46000, rating: 4.9, reviews: 3340, url: "a" },
  { name: "Weissgauff HI 32 BFZC", brand: "Weissgauff", price: 19000, rating: 4.8, reviews: 3924, url: "b" },
  { name: "Libhof MB-302I", brand: null, price: 9500, rating: 4.9, reviews: 395, url: "c" },
  { name: "NoName", brand: null, price: 5000, rating: null, reviews: null, url: "d" },
  { name: "Bosch PIB375FB1E панель 30 см", brand: "Bosch", price: 46000, rating: 4.9, reviews: 3340, url: "a" },
];
check(dedupe(items).length === 4, "dedupe by url");
check(filterItems(items, { brand: "bosch" }).length === 2, "brand filter case-insensitive");
check(filterItems(items, { brand: "libhof" }).length === 1, "brand falls back to name");
check(filterItems(items, { ratingMin: 4.9 }).length === 3 && filterItems(items, { ratingMin: 4.9 }).every((i) => i.rating >= 4.9), "ratingMin drops lower and unrated");
check(filterItems(items, { reviewsMin: 1000 }).length === 3, "reviewsMin");
check(filterItems(items, { priceMax: 20000, priceMin: 6000 }).length === 2, "price range");
check(filterItems(items, { include: ["30 см", "bosch"] }).length === 2, "include all words");
check(filterItems(items, { exclude: ["weissgauff"] }).length === 4, "exclude");
check(filterItems(items, { include: ["панель"], specsOnly: false }).length === 2, "include matches name");
check(filterItems([{ name: "x", specs: { "Диаметр конфорки": "17 см" } }], { include: ["17 см"] }).length === 1, "include matches specs object");
const byScore = sortItems(dedupe(items), "score");
check(byScore[0].url === "a" && byScore[0].score > byScore[2].score, `score order: ${byScore.map((i) => i.url + ":" + i.score).join(" ")}`);
check(sortItems(items, "price")[0].url === "d", "sort price asc");
check(sortItems(items, "reviews")[0].url === "b", "sort reviews desc");
check(refine(items, { ratingMin: 4.85, sortBy: "reviews" }, 1)[0].url === "a", "refine: dedupe+filter+sort+limit");
const specs = parseCardSpecs("Гориzонт\nГабариты:\n29 см x 52 см x 6.1 см\nТип:\nиндукционная\n15 999 ₽");
check(specs["Габариты"] === "29 см x 52 см x 6.1 см" && specs["Тип"] === "индукционная", "parseCardSpecs");
check(_internal.filterParams({ brand: "7577796", is_high_rating: true, country: ["20", "21"], x: null }) === "&brand=7577796&is_high_rating=t&country=20,21", "ozon filterParams");

console.error("── parseFilters ──");
const page = JSON.parse(readFileSync(new URL("../samples/search_filters.json", import.meta.url), "utf8"));
const f = parseFilters(page);
console.error("   keys:", f.map((x) => x.key).join(", "));
check(f.length > 8, `filters: ${f.length}`);
const brand = f.find((x) => x.key === "brand");
check(brand?.type === "checkboxes" && brand.options.some((o) => o.title === "Bosch" && /^\d+$/.test(o.key)), "brand options with numeric keys");
check(f.find((x) => x.key === "is_high_rating")?.type === "bool", "is_high_rating is bool");
const price = f.find((x) => x.key === "currency_price");
check(price?.type === "range" && price.range.min >= 0 && price.range.max > 1000, `price range ${JSON.stringify(price?.range)}`);
const s = parseSearch(page, 50);
check(s.hasNext === true, "search page reports hasNext");
check(s.items.every((i) => i.brand !== "Бренд проверен"), "badge 'Бренд проверен' is not a brand");

console.error("── parseYandexReviews ──");
const anon = parseYandexReviews(readFileSync(new URL("../samples/yandex_reviews_anon.txt", import.meta.url), "utf8"));
check(anon.noReviews === true && anon.count === 0, "seller card -> noReviews");
const yr = parseYandexReviews(readFileSync(new URL("../samples/yandex_reviews.txt", import.meta.url), "utf8"), 20, new Date("2026-09-19"));
console.error("   ", JSON.stringify({ rating: yr.rating, totalRatings: yr.totalRatings, totalReviews: yr.totalReviews, ratingsOnly: yr.ratingsOnly, count: yr.count, first: yr.reviews[0] }));
check(yr.rating === 4.9 && yr.totalRatings === 18 && yr.totalReviews === 6, "yandex head: rating, ratings, reviews");
check(yr.count === 6 && yr.ratingsOnly === 12, `6 text reviews + 12 ratings-only (${yr.count}/${yr.ratingsOnly})`);
const y0 = yr.reviews[0];
check(y0.author === "Николай Трихалкин" && y0.date === "2025-11-14" && y0.pros.startsWith("всё круто") && y0.cons.startsWith("не флекса") && y0.comment.startsWith("можно брать") && y0.useful === 1 && y0.variant === "черный. чёрный", "yandex review 1 fields");
check(yr.reviews[1].date === "2026-09-11" && yr.reviews[2].date === "2026-04-01", "dates without year -> current year");
check(yr.reviews.every((r) => r.score === null), "yandex reviews carry no per-review score");

if (failed) { console.error(`\n${failed} check(s) failed`); process.exit(1); }
console.error("\nall rank/filters checks passed");
