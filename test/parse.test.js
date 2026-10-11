// Offline parser tests against saved composer-api samples. No browser/network.
import { readFileSync } from "fs";
import { parseSearch, parseDetails, parseReviews, parseFullCharacteristics } from "../src/parse.js";

const load = (f) => JSON.parse(readFileSync(new URL(`../samples/${f}`, import.meta.url), "utf8"));
let failed = 0;
const check = (cond, msg) => {
  console.error(`${cond ? "  ok " : " FAIL"}  ${msg}`);
  if (!cond) failed++;
};

console.error("── parseSearch ──");
const s = parseSearch(load("search.json"), 12);
check(s.items.length > 0, `items: ${s.items.length}`);
const it = s.items[0];
console.error("   first:", JSON.stringify({ sku: it.sku, name: it.name?.slice(0, 40), price: it.price, rating: it.rating, reviews: it.reviews, url: !!it.url }));
check(!!it.sku, "item has sku");
check(typeof it.price === "number", "item price is number");
check(it.url?.startsWith("https://") && !it.url.includes("?"), "item url clean+absolute");
check(s.items.every((x) => x.price), "every item has a price");

console.error("── parseDetails ──");
const d = parseDetails(load("pdp.json"));
console.error("   ", JSON.stringify({ sku: d.sku, name: d.name?.slice(0, 40), price: d.price, priceRegular: d.priceRegular, oldPrice: d.oldPrice, available: d.available, seller: d.seller?.name, chars: Object.keys(d.characteristics).length, imgs: d.images.length }));
check(!!d.sku, "details has sku");
check(typeof d.price === "number", "details price is number");
check(!!d.name, "details has name");
check(d.images.length > 0, "details has images");
check(Object.keys(d.characteristics).length > 0, "details has characteristics");
check(d.variants === null || typeof d.variants === "number", `details variants: ${d.variants}`);

console.error("── parseFullCharacteristics ──");
const fc = parseFullCharacteristics(load("pdp_features.json"));
console.error("   ", Object.keys(fc).length, "chars, e.g.", JSON.stringify(Object.entries(fc).slice(0, 3)));
check(Object.keys(fc).length >= 20, "features page gives 20+ characteristics");
check(fc["Количество конфорок"] === "2" && fc["Системы защиты"]?.includes("Защита от перегрева"), "short and long values joined");

console.error("── ozon card dimensions (details() merge) ──");
const { withItemDimensions } = await import("../src/dimensions.js");
const card = withItemDimensions({ ...d, characteristics: fc }, d.images[0]);
check(JSON.stringify(card.dimensions_mm) === JSON.stringify({ width: 306, depth: 527, height: 51 }), `ozon dimensions_mm ${JSON.stringify(card.dimensions_mm)}`);
check(card.image_url === d.images[0] && !!card.image_url, "ozon image_url is the first product image");

console.error("── parseReviews ──");
const r = parseReviews(load("reviews.json"), 10);
console.error("   ", JSON.stringify({ rating: r.rating, total: r.totalReviews, count: r.count }));
check(r.reviews.length > 0, `reviews: ${r.reviews.length}`);
const rv = r.reviews.find((x) => x.comment) || r.reviews[0];
console.error("   sample:", JSON.stringify({ author: rv.author, score: rv.score, comment: rv.comment?.slice(0, 50), date: rv.date, purchased: rv.purchased }));
check(r.reviews.some((x) => typeof x.score === "number"), "reviews have scores");
check(r.reviews.some((x) => x.comment || x.pros || x.cons), "reviews have text");

console.error(failed ? `\n${failed} FAILED` : "\nALL PASSED");
process.exit(failed ? 1 : 0);
