# Ozon API overview

## Paths for shop_request
- Page path: `/search/?text=...`, `/product/<sku>/`, `/cart`, `/my/main`, `/modal/...`. The server wraps it into the page API.
  Returns `{pageInfo: {url, pageType}, nextPage?, widgets: {<name>: state}, layout, seo, ...}`.
- Action: `/api/composer-api.bx/_action/<name>` with a JSON `body` (POST). Returns plain JSON.
- Full `https://www.ozon.ru/...` URLs work as page paths.

Write query values as in a browser URL. A `;` inside a value must be `%3B` (price ranges), a raw `;` is dropped.

## Widgets
Names come without the numeric id: `tileGridDesktop`, `webPrice`. Repeats get `#2`, `#3`.
Most widgets are header, footer and layout noise; each topic lists the useful ones.
A big page without jq comes back as an overview (widget names and sizes): pick what you need with jq.

## Async widgets
Some widgets are `{}` on the page and load separately, e.g. `webDelivery` on a product page.
1. Get the call: `{"path": "/product/<sku>/", "jq": "[.layout | .. | objects | select(.component == \"webDelivery\" and .asyncData) | {path: (\"/api/composer-api.bx/widget/json/v2?widgetStateId=\" + (.stateId | @uri)), body: {asyncData}}][0]"}`
2. Send the returned `path` and `body` → `{state: {...}}`.

## Pagination
Follow `nextPage` as is, it is a page path. On page 1 it sits in a paginator widget
(`.widgets.infiniteVirtualPaginator.nextPage`, `.widgets.paginator.nextPage`), later pages have a top-level `.nextPage`.
Never build `page=N` yourself: without its tokens Ozon returns page 1 again.

## Values
- Prices are strings with a thin space: `"1 039 ₽"`.
- SKU is the number at the end of `/product/<slug>-<sku>/`; `/product/<sku>/` works without the slug.
- Unknown SKU: status 404 and `pageInfo.pageType` is `search` instead of `pdp`.

## Session
- Login and delivery address: `shop_get_info`. Login, captcha or choosing on a map: `shop_show`.
- Requests are paced by the server (1–2 s reads, 3–5 s writes). Ozon errors come back as is.
