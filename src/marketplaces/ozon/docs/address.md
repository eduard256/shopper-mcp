# Delivery address (pickup point)

Current address: `address` in `shop_get_info`, e.g. «Москва • Укажите адрес» means only a city, no pickup point.
Search results, stock and delivery dates depend on it, so set it before searching.
The user can also pick a point on the map themselves: `shop_show` with path `/`, then click the address in the header.

## 1. Address text → coordinates
```json
{"path": "/api/composer-api.bx/_action/suggest",
 "body": {"clientName": "ozonWeb", "query": "Санкт-Петербург, Невский проспект 28", "count": 5, "lang": "ru", "removeDisallowedCountries": true, "requestSessionId": "<new uuid>", "preferredProviders": ["maps_selfsuggest_vector_misspell_v6", "yandex"]},
 "jq": "[.suggestions[] | {address: .displayAddressValue, point: .address.geometry.point}]"}
```

## 2. Coordinates → nearby pickup points
```json
{"path": "/modal/commonDelivery?lat=59.9311&long=30.3609&msid=<new uuid>&pid=3&pv=2&tab=pp",
 "body": {"mapInfo": {"geoSessionId": "<new uuid>"}, "geolocation": {"coords": {}, "isAvailable": false}},
 "jq": "[.widgets.pvzList.cells[] | {title: .dsCell.centerBlock.title.text, address: .dsCell.centerBlock.subtitle.text, badges: [.dsCell.centerBlock.badgeList[]?.text], link: .dsCell.common.action.link}]"}
```
`link` is the ready path of the point card; the point id is `pp=<id>` inside it. The list also contains Russian Post offices.

## 3. Select the point
Two calls with the same `msid`:
1. `{"path": "<link>"}` — the point card (`pid=5`).
2. `{"path": "<link with pid=5 replaced by pid=7>", "body": {}}` — confirm.

Step 2 alone does not save. Its answer looks like the point card again, so check the result with `shop_get_info`; the new address may show up one call later.
