# Order chat (Phase 35)

Messages about an order between the buyer (customer or wholesaler), the supplier, the driver and FIRINGI.

## Conversations (channels)

| Channel | Who is in it | Notes |
|---|---|---|
| `BUYER_SUPPLIER` | buyer, supplier, FIRINGI | Not on orders FIRINGI routed (`routedByFiringi`) — the buyer's seller there is FIRINGI. |
| `BUYER_FIRINGI` | buyer, FIRINGI | Support about the order. |
| `SUPPLIER_FIRINGI` | supplier, FIRINGI | Never shown to the buyer. |
| `DRIVER` | driver, buyer, the company running the delivery, FIRINGI | Exists once a driver is assigned. The supplier is in it only when its own fleet delivers. Writable while the delivery is assigned / picked up / on the way, and `driverHoursAfter` hours after it ends. |

FIRINGI staff (`admin.orders.view`, `admin.orders.manage`, `admin.support.manage`) read every conversation;
writing needs `admin.orders.manage` or `admin.support.manage`. Buyers need `buyer.orders.view`/`place`, suppliers
`vendor.orders.view`/`manage`, drivers must be the order's assigned driver. A wholesaler is a buyer on one order and
a supplier on another — the portal the page is in decides which side it speaks for.

Names shown: FIRINGI → "FIRINGI"; buyer → its company; supplier → its company, except to the buyer and the driver on
a routed order ("FIRINGI"); driver → "Driver · first name".

## Settings (`chat.settings`, *Orders › Order Chat*)

`enabled`, `channels` (one switch each), `maskContacts`, `translate`, `translateModel` (Claude Opus / Sonnet / Haiku
5.5; default Haiku), `photos`, `driverHoursAfter` (0–72, default 2), `closeDaysAfter` (1–365, default 30: the
order's conversations become read-only that many days after it is delivered / cancelled / returned).

Per company (*Settings › Business Features*): `CHAT` (the company can use the chat; off closes every conversation it
is part of) and `CHAT_MASK` (hide its contact details; off → its messages are shown as typed but still flagged).
Both on by default.

## Contact filter (`screenContacts` in `src/lib/chat.ts`)

Finds phone numbers (9+ digits, any spacing, `+`/`00` prefixes), e-mails (also `(at)`, `[at]`, "at … dot …",
"arroba … ponto …"), IBANs and links (http(s), www., common domains). FIRINGI document numbers (FO-, RT-, invoice
series) are protected first; prices, dates, times, postcodes and quantities stay. Hidden parts become `[•••]`.
`OrderMessage.body` holds what participants see; `originalBody` what was typed (only when something was hidden,
shown to FIRINGI only); `flags` what was found. Each flag also writes an audit entry (`chat.contact_flagged`).
FIRINGI staff messages are never screened.

## Translation

On reading, every message written in another language than the reader's is translated once per language
(`OrderMessageTranslation`, newest 20 per view; older ones on the next view) with the Anthropic API (non-streaming
`messages.create`, the system prompt keeps `[•••]`, numbers, product names and document numbers unchanged).
Failures fall back to the text as written. In development/browser tests (`ASSISTANT_SIMULATE=1`, no key) a simulated
translator prefixes `[EN]` etc.; integration tests inject one with `setChatTranslatorForTests`.

## Notifications

Event `chat.message` (`orders` category; in-app + push + e-mail by default; texts in 25 languages). Sent to the other
parties of the conversation (FIRINGI only where it is a party or runs the delivery), once per burst: no new notice
while the same side keeps writing within 5 minutes. On routed orders the sender shown to the buyer is "FIRINGI".

## Limits

2000 characters, up to 3 photos (JPG/PNG/WEBP, checked by content), 30 messages per user per 10 minutes.
Photos are served by `/api/chat/photos/{portal}/{messageId}/{n}` only to someone who can see that conversation.

## Pages

- Order pages (customer, supplier, FIRINGI) and the driver's delivery page: the conversation card (`#chat`).
- *Orders › Messages* (customer, supplier), *Deliveries › Messages* (driver): inbox with unread counts.
- *Orders › Order Chat* (FIRINGI): KPIs, settings, latest conversations; *Flagged messages* with review.
