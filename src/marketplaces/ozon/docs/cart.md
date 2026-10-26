# Cart

To give the user a list, prefer selections: they do not touch the cart.

## Add
`{"path": "/api/composer-api.bx/_action/v2/addToCart", "body": [{"id": 5827277911, "quantity": 1}]}`
→ `{data: {success, cart: {cartItems: [{id, qty}]}}}` — the whole cart as SKUs. `id` is the SKU as a number.

## Read
`{"path": "/cart"}` — widgets `cartSplit` (items, prices, selection), `total`; an empty cart has `emptyCart`.
Explore with `"jq": ".widgets.cartSplit | keys"`.

## Change
Re-request the cart page with an action body:
- delete: `{"path": "/cart?page_changed=true", "body": {"name": "deleteItems", "params": "{\"items\":[\"<sku>\"]}"}}`
- unselect: `{"path": "/cart?page_changed=true", "body": {"name": "selectItems", "params": "{\"mode\":\"MODE_UNSELECT_SPECIFIED\",\"items\":[\"<sku>\"]}"}}`

`params` is a JSON string. The answer is the new cart page.

## Share the cart
`{"path": "/modal/shareCartFrom?page_changed=true", "jq": ".widgets.sharingCartControl.button.common.action.link"}`
→ `https://www.ozon.ru/cart?share=c_...`. Only selected items are shared; the link is a snapshot; each call makes a new link.

Checkout is blocked by the server.
