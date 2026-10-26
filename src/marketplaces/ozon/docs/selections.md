# Selections («Подборка») — the final result

A selection is a product list with a share link. It needs login (`loggedIn` in `shop_get_info`).
Without login give the user product links instead.

## 1. Create
```json
{"path": "/api/composer-api.bx/_action/submitSelectionFormWeb",
 "body": {"placement": "create_fields", "selectionUuid": "", "media": [], "content": {"title": "ESP32 car", "description": "Мотор TT ×4\nДрайвер L298N ×1", "isPublic": "false"}, "prefilledSku": null}}
```
→ `{selectionUuid, action: {link}}`

## 2. Set the products
```json
{"path": "/api/composer-api.bx/_action/submitSelectionFormWeb",
 "body": {"placement": "update_items", "productIds": ["5827277911", "4947550521"], "content": {}, "selectionUuid": "<uuid>"}}
```
→ `action.link` is the share link: `https://www.ozon.ru/selections/view/<uuid>?uId=<userUuid>`. Give it to the user.

## Rules
- `title` up to 60 chars, `description` up to 4490.
- `isPublic` is a string; `"false"` = visible only by the link.
- A selection has no quantities: write them in `description`.
- `update_items` replaces the whole list: always send all SKUs. Up to 500.
- Products do not need to be in favorites. For an offer of a specific seller use that offer's SKU.

## Other
- View: `{"path": "/selections/view/<uuid>?uId=<userUuid>"}`, products in `tileGridDesktop`. It may lag a few seconds after an update.
- My selections: `{"path": "/selections/list"}`.
- Delete: `{"path": "/api/composer-api.bx/_action/deleteSelection", "body": {"selectionUuid": "<uuid>"}}` (empty answer).
