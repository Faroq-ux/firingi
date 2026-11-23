# Landing page (Phase 56)

The public pages visitors see before they register. They use FIRINGI's colours (red `#D9231A`, black and white), have no dark mode (a dark-mode device still sees white and red) and come in all 25 languages. Every text and section can be changed in admin.

## Pages

| Address | What it is |
|---|---|
| `/` | Main page for wholesale customers. Signed-in users go to their portal. If FIRINGI switches the page off, visitors go to `/login`. |
| `/sell` | "Become a supplier": two ways to sell, what suppliers get, plans, and the supplier application form. Linked only from the menu and the footer. |
| `/welcome` | Preview of the main page for anyone, including signed-in staff. Not indexed. |
| `/legal/terms`, `/legal/privacy` (GDPR), `/legal/cookies`, `/legal/company` | Legal pages linked from the footer. |
| `/newsletter/confirm`, `/newsletter/unsubscribe` | Newsletter double opt-in and leaving. |

## Main page

1. **Top:** "Buy, restock and run *your business* without wasting your time.", the Open account button, and the customer dashboard drawn in code (slightly tilted, with floating notes).
2. **Numbers strip:** €150 minimum for the whole cart · same-day delivery · 1 invoice from FIRINGI · €0 to open an account.
3. **Categories:** 14 categories in two rows gliding in opposite directions (Groceries … Kebab & Pizza Supplies).
4. **Four sections, each with a dashboard screen that animates when scrolled to:**
   - **Buy:** one cart for many vendors.
   - **Till:** POS ticket with NIF; card, MB WAY or cash.
   - **Manage:** margin ring, stock and expiry alerts, staff shifts.
   - **Save:** points, rewards shop, pay later, buying groups.
5. **Start in three steps**, questions (FAQ), contact (questions only, plus WhatsApp), newsletter.
6. **Footer** (black, red top line):
   - Buy / For suppliers / Help / Legal links;
   - email, phone, WhatsApp, Instagram, Facebook, LinkedIn, YouTube and TikTok icons (always shown; each becomes a link once set in admin);
   - language picker, Livro de Reclamações, company line.

The dashboard pictures are drawn in code (`tour.tsx`) rather than screenshots, so every word in them comes from the editable texts.

## Become a supplier (`/sell`)

- **Wholesaler:** sells to shops, cafés and restaurants in its own country, delivering by zone or by distance, and buys stock from distributors. Its button goes to `/register/wholesaler`.
- **Distributor:** sells to wholesalers across the EU. Its button goes to `/register/distributor`.
- **Application form:** the supplier chooses Wholesaler or Distributor. This creates a CRM lead (source Website, kind WHOLESALER or DISTRIBUTOR) with the NIF in the note.

## Visitors' forms

- **Question (main page)** → CRM lead (kind Customer). A second message from the same email is added to the same open lead.
- FIRINGI is notified and the visitor gets a short "we got it" email.
- **Spam protection:** honeypot field, minimum fill time, link limit, 5 messages per 10 minutes per visitor (the IP is stored only as a one-way code).
- **Newsletter:** double opt-in, with the consent text stored. Admin → Marketing → Newsletter lists sign-ups, deletes one and exports the confirmed ones as CSV.

## WhatsApp

- **Registration and company profile** (wholesale customers, wholesalers, distributors): optional WhatsApp number.
  - Tick "This phone number is also on WhatsApp", or type a different number.
  - Saved in international format (`Company.whatsapp`).
  - A WhatsApp message from that number is linked to the business and its owner, ready for the AI assistant and the inbox.
  - Shown on the company page in admin.
- **Landing settings** (admin): optional WhatsApp for customers (main page) and for suppliers (`/sell`, falls back to the customers' number).

## Admin → Marketing → Landing Page (`admin.marketing.manage`)

- Show or hide the page; switch each section on or off: numbers, categories, buy, till, manage, save, steps, FAQ, contact, newsletter, final, the /sell page and its plans.
- Contact details: WhatsApp numbers, email, phone, company name, NIF and address, social links, Livro de Reclamações link.
- **Every text in every language:** search, see the English and built-in wording, write your own or go back to the built-in text, hide list items (categories, FAQ questions…), add FAQ questions.
  - Wording is chosen in this order: your own text in the visitor's language → the built-in translation → your own English → the English.
- **Legal pages per language:** empty means the starting GDPR, cookies or terms text with the company details filled in. Have the final texts checked by a lawyer.

## Sustainability & Careers (footer)

FIRINGI only — FIRINGI's own pages, not suppliers' shops (`/s/<slug>`).

- **Footer:** a "FIRINGI" column (`foot-company`) links `/sustainability` and `/careers`; each link shows only while its page is on. Off → the page answers 404.
- **Texts:** per page and language in `landing.settings.about.<page>.text`. Empty → English text → the starting text (`landing.about.<page>.start.N`, 25 languages).
- **Openings:** `landing.settings.jobs` (id, title, location, type FULL_TIME / PART_TIME / SEASONAL / INTERNSHIP, text, shown). Written once, in the language FIRINGI chooses.
- **Applications** (`JobApplication`): job or open application, name, email, phone, a https link (CV / LinkedIn — no file uploads), message, language, the consent text agreed and a hashed IP.
  - Spam check (hidden field, time on page) and 3 per hour per IP.
  - Notification `website.job_application` to marketing staff; confirmation e-mail to the applicant; optional copy to `careersEmail`.
  - Status NEW → REVIEWING → REJECTED / HIRED; delete for good (GDPR, audit keeps only that it happened).
- **Admin:** *Marketing › Sustainability & Careers* (`/admin/marketing/careers`, English, `admin.marketing.manage`; view with `admin.marketing.view`).
- **Code:** `src/lib/landing.ts` (types, checks), `src/server/landing/careers.ts`, `src/server/actions/landing.ts`, `src/app/(site)/{sustainability,careers}/page.tsx`, `src/components/landing/careers-admin.tsx`, `ApplyForm` in `src/components/landing/client.tsx`.
- **Tests:** `tests/unit/careers.test.ts`, `tests/integration/careers.test.ts`, `tests/e2e/careers.mjs`.

## Code

- **Rules and texts:**
  - `src/lib/landing.ts` (rules);
  - `src/lib/landing-legal.ts` (starting legal texts);
  - the `landing` namespace in `src/messages/*.json`.
- **Server:**
  - `src/server/landing/service.ts`;
  - `src/server/actions/landing.ts`.
- **Pages (`src/components/landing/`):**
  - `app-view.tsx`: main and /sell pages;
  - `tour.tsx`: drawn dashboard screens;
  - `view.tsx`: footer, language list, route picture;
  - `client.tsx`: menu, FAQ, forms, motion;
  - `admin.tsx`: editor;
  - `plain.tsx`: legal and newsletter pages;
  - `landing.css`, `app-landing.css`.
- **WhatsApp:**
  - `src/components/company/whatsapp-field.tsx`;
  - `Company.whatsapp`;
  - matching in `storeInbound` (`src/server/services/notifications.ts`).
- **Tests:**
  - `tests/unit/landing.test.ts`;
  - `tests/integration/landing.test.ts`;
  - `tests/integration/onboarding.test.ts` (WhatsApp);
  - `tests/e2e/landing.mjs`.
