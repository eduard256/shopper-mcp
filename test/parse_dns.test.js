// Офлайн-тест парсера отзывов DNS на сохранённом innerText.
import { readFileSync } from "fs";
import { parseDnsOpinions } from "../src/parse_dns.js";
let failed = 0;
const check = (c, m) => { console.error(`${c ? "  ok " : " FAIL"}  ${m}`); if (!c) failed++; };
const t = readFileSync(new URL("../samples/dns_opinions.txt", import.meta.url), "utf8");
const r = parseDnsOpinions(t, 10);
console.error("   ", JSON.stringify({ rating: r.rating, total: r.totalReviews, distribution: r.distribution, count: r.count, first: r.reviews[0] }));
check(r.rating === 4.33, "rating 4.33");
check(r.totalReviews === 2, "total 2");
check(r.distribution && r.distribution[5] === 1 && r.distribution[4] === 1, "distribution 5:1 4:1");
check(r.count === 2, "two reviews parsed");
check(r.reviews[0].score === 5 && r.reviews[0].date === "2022-11-26", "first review score/date");
check(/импульсной/.test(r.reviews[0].comment) && /тихая/i.test(r.reviews[0].pros), "first review pros/comment text");
check(r.reviews[1].score === 4 && r.reviews[1].comment === "", "second review score 4, empty text");
if (failed) { console.error(`\n${failed} FAILED`); process.exit(1); } else console.error("\nALL PASSED");
