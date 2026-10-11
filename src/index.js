#!/usr/bin/env node
// market-mcp server (stdio): Ozon, DNS, Yandex Market tools + cross-marketplace compare.
// CRITICAL: stdout is the JSON-RPC wire — never write to it. All logs go to stderr.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { search, details, reviews, filters } from "./ozon.js";
import { dnsSearch, dnsProduct, dnsReviews } from "./dns.js";
import { yandexSearch, yandexCard, yandexReviews } from "./yandex.js";
import { wbCard } from "./wildberries.js";
import { compare } from "./compare.js";
import { filterSchema } from "./rank.js";
import { shutdown } from "./browser.js";

const log = (...a) => console.error("[market-mcp]", ...a);
const TOOL_TIMEOUT_MS = 110000; // multi-page walks and compare need more than one page load
const MAX_TEXT = 60000; // cap JSON-RPC payload size

// Компактный вывод (MARKET_COMPACT=0 выключает): JSON без отступов, только строки длиннее MAX_STR (описания, редкие длинные отзывы)
// обрезаются, пустые поля и ссылки на картинки убираются. Тексты отзывов до 600 символов идут целиком.
const COMPACT = process.env.MARKET_COMPACT !== "0";
const MAX_STR = Number(process.env.MARKET_MAX_STR || 600);
const DROP_KEYS = new Set(["images", "specsText"]);
// Explicit nulls are meaningful here: an unknown axis must stay visible, not vanish.
const KEEP_AS_IS = new Set(["dimensions_mm"]);

function shrink(v) {
  if (typeof v === "string") return v.length > MAX_STR ? v.slice(0, MAX_STR) + "…" : v;
  if (Array.isArray(v)) return v.map(shrink);
  if (v && typeof v === "object") {
    const out = {};
    for (const [k, x] of Object.entries(v)) {
      if (KEEP_AS_IS.has(k)) { out[k] = x; continue; }
      if (DROP_KEYS.has(k) || x == null || x === "" || (Array.isArray(x) && !x.length)) continue;
      out[k] = shrink(x);
    }
    return out;
  }
  return v;
}

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
    ),
  ]);
}

/** Wrap a tool body: run with timeout, serialize result, convert any failure to isError. */
function tool(label, fn, withImage = false) {
  return async (args) => {
    try {
      const result = await withTimeout(fn(args), TOOL_TIMEOUT_MS, label);
      const image = withImage ? result.imageContent : undefined;
      if (withImage) delete result.imageContent;
      let text = JSON.stringify(COMPACT ? shrink(result) : result, null, COMPACT ? 0 : 2);
      if (text.length > MAX_TEXT) text = text.slice(0, MAX_TEXT) + "\n…(truncated)";
      return { content: [{ type: "text", text }, ...(image ? [image] : [])] };
    } catch (err) {
      log(`${label} error:`, err?.message);
      return {
        content: [{ type: "text", text: `Error: ${err?.message || String(err)}` }],
        isError: true,
      };
    }
  };
}

const server = new McpServer({ name: "market-mcp", version: "0.1.0" });

server.registerTool(
  "ozon_search",
  {
    title: "Search Ozon products",
    description:
      "Search products on the Ozon marketplace (ozon.ru): name, price (RUB), old price, discount, rating, review count, brand, URL. " +
      "Server-side: sort, price range, highRating, brand (matched to Ozon's brand filter), any filters from ozon_filters. " +
      "Client-side over the walked pages: ratingMin, reviewsMin, include/exclude words, sortBy (score = Bayesian rating). " +
      "To find the best product: pages=3, reviewsMin=100, ratingMin=4.7, sortBy=score, then compare() the top candidates.",
    inputSchema: {
      query: z.string().min(1).describe('Search query, e.g. "индукционная варочная панель 30 см"'),
      sort: z
        .enum(["popular", "price", "price_desc", "rating", "new", "discount"])
        .default("popular")
        .describe("Ozon sort order: popular (default), price, price_desc, rating, new, discount"),
      highRating: z.boolean().optional().describe("Ozon's own 'high rating' filter (4-5 stars only)"),
      filters: z.record(z.union([z.boolean(), z.string(), z.number(), z.array(z.string())])).optional().describe("Raw Ozon filters by key from ozon_filters, e.g. {brand: '7577796', country: '20', is_official_brand_seller: true}"),
      ...filterSchema(z),
      limit: z.number().int().min(1).max(50).default(12).describe("Max number of results after filtering (1–50, default 12)"),
    },
    annotations: { readOnlyHint: true, openWorldHint: true, idempotentHint: true },
  },
  tool("ozon_search", search)
);

server.registerTool(
  "ozon_filters",
  {
    title: "List Ozon search filters",
    description:
      "Filters Ozon offers for a query: brands with their ids, type, country, colour, price range, boolean flags (high rating, official brand seller, ...). " +
      "Pass the keys/option keys into ozon_search.filters to filter on the server side.",
    inputSchema: { query: z.string().min(1).describe("The same search query you will pass to ozon_search") },
    annotations: { readOnlyHint: true, openWorldHint: true, idempotentHint: true },
  },
  tool("ozon_filters", filters)
);

server.registerTool(
  "wb_card",
  {
    title: "Get Wildberries public product card",
    description: "Read anonymous public WB card JSON: name, item dimensions in millimetres with source values, and a verified image URL. Accepts SKU or canonical wildberries.ru product URL. Missing item dimensions remain unknown; package dimensions are never substituted. CDN routing failures are errors, with no host scanning. Use include_image=true for visual modeling: attaches the first verified photo as MCP image content (max 8MiB JPEG/WebP). Does not provide price or reviews.",
    inputSchema: {product: z.string().min(1).describe("Wildberries SKU or full product URL"), include_image:z.boolean().default(false)},
    annotations: {readOnlyHint: true, openWorldHint: true, idempotentHint: true},
  },
  tool("wb_card", wbCard, true)
);

server.registerTool(
  "ozon_product_details",
  {
    title: "Get Ozon product details",
    description:
      "Get full details for one Ozon product: name, price (card/regular/old), availability, product " +
      "rating, seller (name + rating), images, key characteristics, and the product description " +
      "(text and/or banner image URLs). Full characteristics come from the /features/ page; the description is read from the rendered card (adds ~5 s), " +
      "pass description=false to skip it. variants > 1 means the card groups several models/colours and the rating is shared. Accepts an SKU, a full product URL, or a slug.",
    inputSchema: {
      product: z
        .string()
        .min(1)
        .describe('Product SKU (e.g. "1185261285"), full ozon.ru product URL, share link from the Ozon app (ozon.ru/t/...), or product slug'),
      description: z.boolean().default(true).describe("Load the description text/images from the product page (default true, ~5 s extra)"),
    },
    annotations: { readOnlyHint: true, openWorldHint: true, idempotentHint: true },
  },
  tool("ozon_product_details", details)
);

server.registerTool(
  "ozon_product_reviews",
  {
    title: "Get Ozon product reviews",
    description:
      "Read real customer reviews for an Ozon product: author, score (1–5), comment, pros, cons, " +
      "date, usefulness, purchased flag, photos flag; plus the star distribution (5..1 counts) and paging. " +
      "With sinceMonths and/or maxScore it walks the newest reviews (up to maxPages) and returns only recent/low ones: " +
      "use sinceMonths=12, maxScore=2 to see what breaks in recent batches. Accepts an SKU, a full product URL, or a slug.",
    inputSchema: {
      product: z
        .string()
        .min(1)
        .describe('Product SKU (e.g. "1185261285"), full ozon.ru product URL, or product slug'),
      sort: z.enum(["newest", "best", "worst"]).default("newest").describe("newest (default), best (5 stars first), worst (1 star first) — read worst first to see real problems"),
      page: z.number().int().min(1).max(50).default(1).describe("Page of 30 reviews"),
      limit: z.number().int().min(1).max(30).default(30).describe("Max number of reviews from the page (1–30, default 30)"),
      sinceMonths: z.number().int().min(1).max(60).optional().describe("Only reviews not older than N months (walks newest first)"),
      maxScore: z.number().int().min(1).max(5).optional().describe("Only reviews with score <= this (e.g. 2)"),
      maxPages: z.number().int().min(1).max(10).default(5).describe("How many newest pages of 30 to walk for sinceMonths/maxScore"),
    },
    annotations: { readOnlyHint: true, openWorldHint: true, idempotentHint: true },
  },
  tool("ozon_product_reviews", reviews)
);

// ── DNS ─────────────────────────────────────────────────────────────────────────
server.registerTool(
  "dns_search",
  {
    title: "Search DNS (dns-shop.ru)",
    description:
      "Search electronics and appliances on DNS (dns-shop.ru): name, price (RUB), rating, review count, reliability badge, short specs and product URL. " +
      "Server sort (rating, price, ...), page walk, and the common client-side filter (brand, ratingMin, reviewsMin, include/exclude on specs, sortBy). " +
      "DNS ratings are per exact model (not aggregated), so they are the most trustworthy source. nothingFound=true means DNS has no exact match.",
    inputSchema: {
      query: z.string().min(1).describe('Search query, e.g. "Bosch PIB375FB1E" or "индукционная панель 30 см"'),
      sort: z.enum(["popular", "rating", "price", "price_desc", "new", "discount"]).default("popular").describe("DNS sort order"),
      ...filterSchema(z),
      limit: z.number().int().min(1).max(50).default(12).describe("Max results after filtering (1–50, default 12)"),
    },
    annotations: { readOnlyHint: true, openWorldHint: true, idempotentHint: true },
  },
  tool("dns_search", dnsSearch)
);

server.registerTool(
  "dns_product",
  {
    title: "Get DNS product characteristics",
    description:
      "Full technical characteristics of a DNS product (grouped, e.g. 'Конфорки / Диаметр конфорки'), price, rating and review count. " +
      "Accepts the product URL from dns_search or the 16-hex product id.",
    inputSchema: { product: z.string().min(1).describe("DNS product URL or 16-hex id") },
    annotations: { readOnlyHint: true, openWorldHint: true, idempotentHint: true },
  },
  tool("dns_product", dnsProduct)
);

server.registerTool(
  "dns_reviews",
  {
    title: "Get DNS product reviews",
    description:
      "Customer reviews from DNS: overall score, per-criterion scores (внешний вид, простота эксплуатации, ...), usage period, pros, cons, comment, date; " +
      "plus the star distribution (5..1). Newest first. sinceMonths/maxScore keep only recent/low reviews.",
    inputSchema: {
      product: z.string().min(1).describe("DNS product URL or 16-hex id"),
      limit: z.number().int().min(1).max(50).default(20).describe("Max reviews (1–50, default 20)"),
      sinceMonths: z.number().int().min(1).max(60).optional().describe("Only reviews not older than N months"),
      maxScore: z.number().int().min(1).max(5).optional().describe("Only reviews with score <= this"),
    },
    annotations: { readOnlyHint: true, openWorldHint: true, idempotentHint: true },
  },
  tool("dns_reviews", dnsReviews)
);

// ── Yandex Market ───────────────────────────────────────────────────────────────
server.registerTool(
  "yandex_search",
  {
    title: "Search Yandex Market",
    description:
      "Search offers on Yandex Market (market.yandex.ru): name, everyday price (RUB), struck-through old price, product rating, short specs and offer URL. " +
      "Best source for 'what does it cost right now across sellers'. Page walk and the common client-side filter. Reviews: yandex_reviews on cards that carry them, or ozon/dns.",
    inputSchema: {
      query: z.string().min(2).describe("Search query in Russian or model code"),
      ...filterSchema(z),
      limit: z.number().int().min(1).max(50).default(12).describe("Max results after filtering (1–50, default 12)"),
    },
    annotations: { readOnlyHint: true, openWorldHint: true, idempotentHint: true },
  },
  tool("yandex_search", yandexSearch)
);

server.registerTool(
  "yandex_card",
  {
    title: "Get Yandex Market offer card",
    description: "Offer card on Yandex Market: price, number of offers from other sellers and the lowest one, seller rating, characteristics.",
    inputSchema: { product: z.string().min(1).describe("Offer URL from yandex_search (market.yandex.ru/card/...) or a share link from the Market app (market.yandex.ru/cc/...)") },
    annotations: { readOnlyHint: true, openWorldHint: true, idempotentHint: true },
  },
  tool("yandex_card", yandexCard)
);

server.registerTool(
  "yandex_reviews",
  {
    title: "Get Yandex Market reviews",
    description:
      "Reviews from a Yandex Market card (<card url>/reviews): author, date, pros, cons, comment, useful votes, variant; plus model rating, " +
      "number of ratings and text reviews. Per-review scores are not exposed by Yandex (score=null). Seller offer cards have no reviews " +
      "(noReviews=true): pick another card of the same model from yandex_search. sinceMonths keeps only recent reviews.",
    inputSchema: {
      product: z.string().min(1).describe("Card URL from yandex_search"),
      limit: z.number().int().min(1).max(50).default(20).describe("Max reviews (1–50, default 20)"),
      sinceMonths: z.number().int().min(1).max(60).optional().describe("Only reviews not older than N months"),
    },
    annotations: { readOnlyHint: true, openWorldHint: true, idempotentHint: true },
  },
  tool("yandex_reviews", yandexReviews)
);

// ── cross-marketplace ───────────────────────────────────────────────────────────
server.registerTool(
  "compare",
  {
    title: "Compare shortlisted products by reviews",
    description:
      "One call for a shortlist (up to 6 products from Ozon, DNS or Yandex Market, detected by URL): name, price, rating, review count, " +
      "star distribution, lowSharePct (share of 1-2 stars), Bayesian score, the worst reviews, recent low reviews (last recentMonths), " +
      "and an 'aggregated' warning when an Ozon card shares its rating across variants. Ranked by score. Use after filtering searches.",
    inputSchema: {
      products: z.array(z.string().min(1)).min(1).max(6).describe("Product URLs (ozon.ru, dns-shop.ru, market.yandex.ru), Ozon SKUs or DNS 16-hex ids"),
      worst: z.number().int().min(1).max(30).default(8).describe("How many worst reviews per product (default 8)"),
      recentMonths: z.number().int().min(1).max(60).default(12).describe("Window for recent 1-2 star reviews (default 12 months)"),
    },
    annotations: { readOnlyHint: true, openWorldHint: true, idempotentHint: true },
  },
  tool("compare", compare)
);

// ── lifecycle ───────────────────────────────────────────────────────────────────
let cleaning = false;
async function cleanup() {
  if (cleaning) return;
  cleaning = true;
  log("shutting down…");
  await shutdown().catch(() => {});
  process.exit(0);
}
process.on("SIGINT", cleanup);
process.on("SIGTERM", cleanup);
process.on("uncaughtException", (e) => {
  log("uncaughtException:", e);
  cleanup();
});
process.on("unhandledRejection", (r) => log("unhandledRejection:", r));

const transport = new StdioServerTransport();
transport.onclose = cleanup; // client disconnected → free the browser
await server.connect(transport);
log("ready on stdio");
