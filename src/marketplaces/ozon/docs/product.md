# Product card

## Main info (part 1)
```json
{"path": "/product/<sku>/",
 "jq": "{type: .pageInfo.pageType, title: .widgets.webProductHeading.title, price: (.widgets.webPrice | {cardPrice, price, originalPrice, isAvailable}), seller: .widgets.webStickyProducts.seller | {name, link}, inCart: .widgets.webAddToCart.firstButton.isInCart, rating: (.seo.script[0].innerHTML | fromjson | .aggregateRating), variants: [.widgets.webAspects.aspects[]? | {name: .aspectName, variants: [.variants[] | {sku, title: .data.searchableText, price: .data.price, active}]}], next: .widgets.paginator.nextPage}"}
```
- `cardPrice` with Ozon bank card, `price` without it, `originalPrice` crossed out.
- Each variant (color, memory, used copy) is its own SKU.
- Photos: `.widgets.webGallery.images[].src`. Short characteristics: `.widgets.webShortCharacteristics`. Category path: `.widgets.breadCrumbs.breadcrumbs`.
- Plain description and rating in one place: `.seo.script[0].innerHTML | fromjson` (JSON-LD; `offers.price` is the price without the bank card).

## Delivery and stock
Async widget, see overview. On part 1 get the call:
`"jq": "[.layout | .. | objects | select(.component == \"webDelivery\" and .asyncData) | {path: (\"/api/composer-api.bx/widget/json/v2?widgetStateId=\" + (.stateId | @uri)), body: {asyncData}}][0]"`
Send it with:
`"jq": "{options: [.state.sections[] | select(.descriptionRs) | {text: ([.descriptionRs[].content | strings] | join(\" \")), price: .priceBadge.text}], returns: .state.returnInfo.text}"`
Options include the warehouse, stock hints and delivery dates for the current address.

## Characteristics and description (part 2)
```json
{"path": "/product/<sku>/?layout_container=pdpPage2column&layout_page_index=2",
 "jq": "{characteristics: ([.widgets | to_entries[] | select(.key | startswith(\"webCharacteristics\")) | .value.characteristics[]? | ((.short // []) + (.long // []))[] | {key: .name, value: ([.values[].text] | join(\", \"))}] | from_entries), description: ([.widgets | to_entries[] | select(.key | startswith(\"webDescription\")) | .value.richAnnotation // empty][0])}"}
```
Kit contents: `.widgets["webDescription#2"].characteristics` (when present).

## Reviews
```json
{"path": "/product/<sku>/reviews/?sort=usefulness_desc",
 "jq": ".widgets.webListReviews | {total: .paging.total, next: .paging.nextButton, reviews: [.reviews[] | {uuid, variant: .itemId, score: .content.score, text: .content.comment, plus: .content.positive, minus: .content.negative, date: (.publishedAt | todate), replies: .comments.totalCount}]}"}
```
- `sort`: `usefulness_desc` (default) | `score_desc` | `score_asc` (worst first; there is no star filter).
- Only this variant: add `reviewsVariantMode=1`.
- Next page: path `/product/<sku>/reviews/` + `next` (it starts with `?page=`). Follow it in order, jumping to far pages returns the same reviews.
- Summary (stars histogram, "buyers say"): `/product/<sku>/reviews/pdp-part`, widgets `webReviewProductScore`, `contextQuestionsStatistic`.
- Seller replies (when `replies > 0`): `{"path": "/api/composer-api.bx/_action/rpGetCommentsByReviewUuid", "body": {"reviewUuid": "<uuid>", "sku": "<variant>", "rootSku": "<sku>", "limit": 10, "offset": 0}}`

## Questions
`{"path": "/product/<sku>/questions/", "jq": "[.widgets.webPDPListQuestions.questions[] | {question: (.text.text | gsub(\"<[^>]+>\"; \"\")), date: .createdAt.text, answers: [.answers[]? | {author: .author.name.text, text: .text.text}]}]"}`
Sort with `qsort=created_at_desc|usefulness_desc|has_answers_desc`. Next page: `paginator` widget `nextPage`, then top-level `nextPage`. Only the best answer is inline.

## Other sellers of the same product
`{"path": "/modal/otherOffersFromSellers?product_id=<sku>&sort=price", "jq": "[.widgets.webSellerList.sellers[]? | {sku, name, price: .price.cardPrice.price, rating: .rating.totalScore, reviews: .rating.reviewsCount, delivery: ([.advantages[]?.contentRs.headRs[]?.content] | join(\" \"))}]"}`
An empty list means no other sellers.
`sort=price` cheapest first, `sort=date` fastest delivery. Each offer has its own SKU: use it to pick that seller.
