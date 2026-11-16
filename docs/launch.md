# Launching FIRINGI — step by step

Everything below is checked live on **Settings › Launch Readiness** in FIRINGI's back office. Work down
this list until that page says **"Ready for a pilot"** (no *Must fix* left), run the pilot, then fix the
warnings and say **"Ready to launch"**.

The code is finished for launch. What is left is outside the code: accounts with providers, a server,
legal texts, real data and real people.

## 1. Accounts and keys (outside FIRINGI)

| What | Why | Where it goes |
|---|---|---|
| **Moloni** account (AT-certified invoicing), API client id/secret, user | In Portugal invoices must come from certified software | `MOLONI_CLIENT_ID`, `MOLONI_CLIENT_SECRET`, `MOLONI_USERNAME`, `MOLONI_PASSWORD` in `production.env`; then *Invoices › Invoice Settings*: choose Moloni and map series, taxes, units |
| **Stripe** account (cards, MB WAY, Multibanco, SEPA direct debit), live key + webhook secret | Online payments. Optional for a pilot (bank transfer works) | `STRIPE_SECRET_KEY` (`sk_live_…`), `STRIPE_WEBHOOK_SECRET`; webhook `https://<domain>/api/webhooks/payments/stripe` |
| **E-mail** provider (SMTP: e.g. Amazon SES, Postmark, Brevo) | Invoices, password resets, order messages, invitations | `MAIL_DRIVER=smtp`, `SMTP_URL`, `MAIL_FROM` |
| SMS / WhatsApp (Twilio or Meta) | Delivery updates by SMS/WhatsApp. Optional | `SMS_DRIVER`, `WHATSAPP_DRIVER` + their keys |
| **Anthropic API key** | The AI assistant (customers, suppliers, staff). Optional — everything else works without it | `ANTHROPIC_API_KEY` |
| Web push keys | Phone notifications for drivers and buyers | `PUSH_DRIVER=webpush`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` (`npx web-push generate-vapid-keys`) |
| S3-compatible storage (optional) | Photos, documents and PDFs off the server's disk | `STORAGE_DRIVER=s3` + `S3_*` |
| Sentry (optional) | External error tracking | `SENTRY_DSN` |

Never put `PAYMENTS_SIMULATE`, `MOLONI_SIMULATE`, `ASSISTANT_SIMULATE` or `SEED_PASSWORD` in production —
the readiness page fails on each of them.

## 2. Server

Follow `docs/operations.md` (Docker, HTTPS, backups, scheduler). Set `FIRINGI_ENV=production`.
**Start from an empty database with the bootstrap command — never with the demo seed** (the readiness page
fails while any demo account exists). Check `/api/health`, `/status` and *Settings › System Health*.

## 3. In FIRINGI's back office

1. **Settings › Company Settings** — add FIRINGI's invoicing entity for every country with buyers
   (legal name, NIF, VAT number, address, invoicing e-mail, phone). The bootstrap doesn't create one, and
   no sales invoice can be issued without it. Then the **IBAN** under *Settings › Payment Settings*.
2. **Settings › Security** — every staff member turns on two-factor sign-in; add a **second super admin**.
3. **Invoices › Invoice Settings** — Moloni connected and mapped (see above).
4. **International** — open the markets you launch in (customers / wholesalers / distributors per country).
5. **Delivery** — delivery zones for every open country; delivery fees and free-delivery rules.
6. **Tax Settings** — VAT rates in force for every open country (seeded for the Schengen countries; check them).
7. **Vendors** — approve the first suppliers and check their catalogue and prices (aim for 3+ suppliers and
   20+ products per country before inviting customers).
8. **Settings › Launch Readiness › Launch settings** — links to your **terms of service** and **privacy
   policy** (written or checked by a lawyer — FIRINGI only links to them), and the support e-mail.

## 4. Pilot (2–4 weeks)

1. Turn **Pilot** on (*Launch Readiness › Launch settings*): registration becomes invitation-only.
2. *Settings › Pilot & Invites*: invite 5–10 customers and 2–3 suppliers you know. Each invitation is for one
   business, account type and country, valid 1–180 days, used once; the e-mail goes out in the country's
   language. Approve their applications as usual.
3. Customers and suppliers see a banner asking for feedback (to *Support*). Read it every day.
4. Watch *System Health*, *Finance*, *Invoices* (provider queue) and *Risk* daily.

## 5. Open to everyone

Fix the remaining warnings, turn the pilot off (registration opens in the open countries — FIRINGI still
approves every business), and announce.
