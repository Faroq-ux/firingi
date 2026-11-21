# WhatsApp ordering with AI (Phase 58)

Wholesale customers (shops, cafés, restaurants) order by writing to FIRINGI's WhatsApp number. FIRINGI's AI agent — the same one as the Assistant page, with the customer's own rights — finds the products, fills the cart and proposes the order. **Only the customer's YES places it**, and FIRINGI (not the AI) recognises that YES. FIRINGI still invoices the buyer as on the website. FIRINGI's pages are in English; the customer's page and every WhatsApp message come in all 25 languages.

## How a conversation goes

1. The customer writes from the **WhatsApp number on its company profile** (given at registration or in *Company › Profile*). Messages from any other number are not linked to the business.
2. The agent reads:
   - **text** ("10 Coca-Cola 33cl and 2 rice 5 kg");
   - **photos** of a shopping list or a product;
   - **voice notes**, transcribed first (speech-to-text, below).
3. It fills the cart and sends a **summary**: the lines, each supplier's delivery fee, each **wholesaler's own free-delivery amount** (not a fixed FIRINGI number), and the total including VAT.
4. Before proposing, FIRINGI checks each supplier's minimum, its free delivery, the small-order limit (below) and the stock. Anything wrong is told to the customer instead of a proposal.
5. The customer replies **YES** (or taps *Yes, place order* with Meta's buttons). FIRINGI places **exactly the proposed cart**:
   - if the cart changed since the proposal, nothing is placed — the customer asks for a new summary;
   - a proposal expires after 120 minutes (setting);
   - **NO** cancels the proposal (the cart stays).
6. Orders placed this way are marked *WhatsApp* (`Order.placedVia`). Company approvals, credit checks and pay-before-delivery work as on the website; a pay-first order gets the payment link in the chat.
7. **REPEAT** (or the *Repeat last order* button on a reminder) puts the last order back in the cart and proposes it.

The words YES / NO / REPEAT are recognised in every FIRINGI language (*SIM / NÃO / REPETIR*, *JA / NEIN / NOCHMAL*, …). Each message tells the customer the word to use in its language. A unit test checks that every translation's words are understood and that no word means two things. A longer message ("yes but add 2 more") goes to the AI, not to the order.

## After the order

- **Order updates** on WhatsApp: confirmed, on its way, delivered, cancelled. The customer can switch these off on its page.
- **Reorder reminders** (only if the customer said yes on its page): when it usually orders again, from its average gap between orders.
- **Payment links** for pay-first orders and open invoices ("what do I owe?").
- **A person**: asking for one opens a support request with the chat, and the AI stays quiet for 24 hours (setting) so staff answer from the inbox. Staff can also *Take over* any conversation and *Give back to AI*.

WhatsApp only allows free text within 24 hours of the customer's last message. Later updates and reminders need **approved templates** (Meta). Set their names in the settings; with none set, they are skipped outside the window.

## Who can order (Settings › WhatsApp Ordering)

| Switch | Default |
|---|---|
| WhatsApp ordering on | on |
| Wholesale customers | **on** |
| Wholesalers (restocking from distributors) | off |
| Unknown numbers get the registration link (once a day) | off |
| Photos, voice notes, buttons | on |
| Order updates, payment links, reminders | on |

Each business can also be switched off on its own, in the *Businesses* table on the same page (or *Business Features*, key `WHATSAPP_ORDERING`). The customer's menu entry *Company › Order by WhatsApp* is hidden whenever WhatsApp ordering is off for it.

Limits: messages per business per hour that the AI answers (40), proposal lifetime (120 min), AI quiet time after a hand-over (24 h).

## Small orders per month

A **small order** reaches FIRINGI's minimum order but **not the wholesaler's free-delivery amount**, so FIRINGI delivers it at FIRINGI's fee. FIRINGI can limit how many of these a wholesale customer places each calendar month:

- **One general number** for all customers: *Settings › WhatsApp Ordering › Small orders per month*. It is **off** by default.
- **Per customer**, in the *Businesses* table: more, fewer, 0 or *No limit*. Empty means the general number.
- After the month's small orders are used, an order must reach the **wholesaler's free-delivery amount**. When the wholesaler has none, it must reach FIRINGI's free-delivery amount. The cart says how much to add, and checkout refuses with the same message.
- An order only counts as small when there is such an amount to reach. Cancelled orders don't count.
- The limit applies on the **website, the app and WhatsApp**. The customer sees "*n* of *m* small orders left this month" in the cart and on its WhatsApp page.

## Pages

| Who | Page |
|---|---|
| FIRINGI | *Settings › WhatsApp Ordering*: switches, templates, small orders, businesses |
| FIRINGI | *Notifications › WhatsApp Orders*: tiles, conversations (take over / give back), proposals, orders, set-up warnings |
| Customer | *Company › Order by WhatsApp*: FIRINGI's number (opens WhatsApp), its own number, update and reminder switches, small orders left, recent WhatsApp orders |

## Set-up

- **WhatsApp provider**: Twilio or Meta Cloud API, as in Phase 7 (*Notifications › WhatsApp Integration*). The webhooks `/api/webhooks/twilio` and `/api/webhooks/whatsapp` store each message and hand it to the AI right after answering the provider. The `whatsapp` job (every 5 minutes) picks up anything left waiting and expires old proposals.
- **AI**: `ANTHROPIC_API_KEY`. Without it no message is answered, and staff answer from the inbox.
- **FIRINGI's public number**: the landing page's WhatsApp number, or `WHATSAPP_PUBLIC_NUMBER`.
- **Voice notes**: `STT_URL` (an OpenAI-compatible `/audio/transcriptions` endpoint), `STT_API_KEY`, `STT_MODEL` (default `whisper-1`). Without them, customers are asked to type.
- **Tests and development**: `ASSISTANT_SIMULATE=1` (simulated agent), `WA_MEDIA_SIMULATE=1` (fake media; voice notes read as `STT_SIMULATE_TEXT`), `WHATSAPP_DRIVER=log`.

## Code

- `src/lib/wa-ordering.ts`: settings, YES/NO/REPEAT words, language from the phone number, Markdown → WhatsApp text, cart fingerprint.
- `src/server/whatsapp/ordering.ts`: inbound handling, proposals, placing, updates, reminders, the job, page data.
- `src/server/whatsapp/media.ts`: media download and speech-to-text.
- `src/server/orders/small-orders.ts` and `delivery-rule.ts`: the monthly small-order limit.
- WhatsApp-only agent tools in `src/server/ai/tools.ts`: `propose_order`, `repeat_last_order`, `pay_invoices_link`.
- Tests:
  - unit: `tests/unit/wa-ordering.test.ts`;
  - integration: `tests/integration/whatsapp-ordering.test.ts`;
  - browser: `tests/e2e/whatsapp.mjs`.
