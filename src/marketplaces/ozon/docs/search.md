# Search

## Call
```json
{"path": "/search/?text=esp32 devkit&sorting=price",
 "jq": "{url: .pageInfo.url, next: (.nextPage // .widgets.infiniteVirtualPaginator.nextPage), items: [.widgets.tileGridDesktop.items[]? | {sku, name: ([.mainState[] | select(.id == \"name\") | .textDS.text][0]), price: ([.mainState[] | select(.type == \"priceV2\") | .priceV2.price[0].text][0]), rating: ([.mainState[] | select(.labelListV2.testInfo.automatizationId == \"tile-list-rating\") | .labelListV2.items[] | select(.type == \"text\") | .text.text] | join(\" · \")), delivery: .multiButton.ozonButton.addToCart.actionButton.title, link: (.action.link | split(\"?\")[0])}]}"}
```
Next page: same jq with `"path": "<next>"`. `delivery` is the date shown on the add-to-cart button. Out-of-stock tiles have no price.

## Search URL
`/search/?text=<query>[&sorting=<s>][&<filter>=<value>...]`
- Ozon usually redirects to a predicted category. The final URL is `pageInfo.url`, the kind is `pageInfo.pageType` (`search` | `category` | `pdp`).
- To stay in plain search add `deny_category_prediction=true`. To search inside a category: `/category/<slug-id>/?text=<q>`.
- A SKU as the text opens that product (`pdp`).
- No total result count is available.

`sorting`: `score` popular (default) | `new` | `price` cheapest | `price_desc` | `rating` | `discount`.
Page size: 8 for score/new/rating, 36 for price/price_desc/discount.

## Filters
URL params: AND between keys, OR inside one key.

| type | form | examples |
|---|---|---|
| bool | `key=t` | `isdiscount=t`, `is_high_rating=t`, `isbest=t`, `brandcertified=t`, `is_official_brand_seller=t` |
| checkboxes | `key=id,id` | `brand=32686750,24565087`, `seller=0` (Ozon itself) |
| exclude | `key=all_but,id` | `brand=all_but,26303000` |
| delivery | `delivery=id` | `1` today, `2` tomorrow, `4` up to 3 days, `8` up to 7 days |
| color | `color=id,id` | `color=100955526,100955527` |
| range | `key=from%3Bto` | `currency_price=1000%3B3000` (price), `talktime=10%3B40` |
| category | path | `/category/naushniki-15547/?text=...` |

Keys and value ids are per category. Discover them on a results page (`path` = `pageInfo.url`):
- filters: `"jq": "[.widgets.filtersDesktop.sections[].filters[] | {key, type}]"`
- values of one filter: `"jq": "[.widgets.filtersDesktop.sections[].filters[] | select(.key == \"brand\") | .checkboxesFilter.sections[].items[] | {key, title: .title.text}]"`
- all filters of a category: path `/modal/allFilters/<category path>?text=<q>`, same jq.
- all values of one filter (the page shows only the top ones):
  `{"path": "/api/composer-api.bx/_action/getCatalogFilterValues", "body": {"baseLink": "<pageInfo.url>", "isOpened": "true", "key": "brand", "pageType": "category"}}`

Unknown keys or values are dropped silently. Check what was applied: `"jq": ".widgets.searchResultsFiltersActive.activeFilters"`.

## Suggestions
Resolve a brand or category from text:
`{"path": "/searchSuggestions/search/?text=<q>&from_global=true", "jq": "[.widgets.webSuggestions.items[].cellItem | {title: .centerBlock.title.text, kind: .centerBlock.subtitle.text, link: .common.action.link}]"}`

## Nothing found
No `tileGridDesktop` widget; `statusWidget` says «Ничего не нашлось». Causes: too many filters, or no delivery to the current address. Drop filters one by one.

## Writing queries
- Short: `<type> <brand> <model>`, 2–4 words. Typos and transliteration are fine.
- No price or "cheap/good/buy" words: use `sorting` and `currency_price`.
- Attributes go into filters when a filter exists.
- A wrong predicted category: add `deny_category_prediction=true` or use an explicit `/category/<slug-id>/`.
