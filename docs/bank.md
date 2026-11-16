# Bank reconciliation (Phase 37)

Bank statements come in; each line is matched to what it was. FIRINGI's finance team works on FIRINGI's bank
(customer payments, supplier payouts, fees…); every supplier and customer can do the same for its own books.
Code: `src/lib/bank/*` (parsers, pure), `src/server/bank/{service,match,feed,job}.ts`, pages in
`src/components/bank/*` (`/admin/finance/bank`, `/vendor/finance/bank`, `/buy/finance/bank`).

## Getting the lines in

| Source | How |
| --- | --- |
| **CAMT.053** (ISO 20022 XML, versions 02–08, also CAMT.052) | `parseCamt` — statement id, account IBAN, period, opening (OPBD/PRCD) and closing (CLBD) balances; per entry: date, value date, signed amount, the bank's reference (`AcctSvcrRef`), payer / payee name and IBAN, remittance (`Ustrd` + structured `Ref`), end-to-end id. Pending entries are left out; a batch entry whose transactions carry their own amounts (SEPA direct debit batches) becomes one line per transaction. The XML reader never resolves DTDs or entities beyond the five standard ones. |
| **MT940** | `parseMt940` — `:25:` account, `:60F:`/`:62F:` balances, `:61:` lines (value + booking date, C/D/RC/RD, amount, customer and bank reference), `:86:` in the German `?20…?33` form, the SWIFT `/NAME/…/REMI/` form, or free text. |
| **CSV / Excel** | Every bank's columns differ: the first file asks for a **mapping** (header row, date, value date, amount — or money out / money in —, name, IBAN, description, reference, date order, decimal mark). `guessMapping` fills it in from the column names in the usual languages and the number / date style of the data. The mapping is saved per account; a new file that doesn't fit it asks again. UTF-8 or Windows-1252. |
| **Bank feed** (open banking) | `feed.ts`: GoCardless Bank Account Data (`GOCARDLESS_SECRET_ID` / `GOCARDLESS_SECRET_KEY`; the account holder picks the bank and approves access for 90 days; transactions and balance are fetched daily by `/api/cron/bank` and on “Fetch now”), or the **simulated bank** (`BANKFEED_SIMULATE=1`; consent is immediate, transactions are queued with `POST /api/bank/sim` + `CRON_SECRET`). Off until FIRINGI switches it on; FIRINGI decides whether suppliers / customers may link their own bank. |

Every line has a **dedupe key** — the bank's reference when there is one, otherwise a hash of its content plus its
place among identical lines — so overlapping statements, or a file and the feed, never create a line twice.
A statement whose opening balance + lines ≠ closing balance is flagged (“the file may be incomplete”). The newest
closing balance becomes the account's balance. Files are kept in storage (`bank/<owner>/<statement>`).

## Matching

`proposalsFor(knowledge, line)` returns candidates, each with a confidence (0–100) and its reasons (translated codes):

**FIRINGI, money in**
- a payment already recorded (online, direct debit, by hand) with the same amount within `windowDays` — 96 when the
  reference / payer also fits, 84 otherwise, lower when several have the amount; a provider's settlement = several
  payments of the same provider and day adding up to the line (86). Recorded payments are matched, never recorded twice.
- a customer's transfer → new `BANK_TRANSFER` payment: invoice numbers in the remittance (`FT FIR2026/12`,
  `FIR2026 12`, the certified provider's number) — 99 when the amount is exactly what's open on them and the payer
  is known, 96 otherwise; more than open → the rest is customer credit (used on its next invoices, as for online
  payments); a little less (≤ `toleranceAmount` € and ≤ `tolerancePct` %) → the invoices are closed and the gap is
  booked as a bank fee; otherwise a part payment.
- without numbers: the payer by remembered IBAN (92), VAT number in the text (88) or name (82) → exactly one open
  invoice, all of them, the oldest ones, within the tolerance, or a part payment / credit.
- a pay-before-shipping order named in the transfer (or the exact amount of the payer's waiting order) → paid, the
  order goes to the supplier.
- only one open invoice in the whole system with this amount → 55 (“check who paid”).

**FIRINGI, money out** — a recorded payout (supplier payouts, early payouts) with the same amount; or a supplier
transfer for its approved invoices (numbers, IBAN, name) → new payout, invoices PAID.

**Supplier's own books** — FIRINGI's payouts to it; its accounting entries (sales for money in, expenses for money
out — when FIRINGI switched accounting on for it). **Customer's own books** — its payments to FIRINGI; FIRINGI
invoices named in its transfer (a record in its own books only — it never pays FIRINGI's invoice); its entries.

**Rules** (“text contains X → bank fee / category”, money in / out / both) are the owner's own standing instruction:
when nothing better (≥ 90) fits, a rule's line is booked at once — also in “always confirmed by a person” mode.

## Booking

- A line is **booked by itself** when the owner allows it, the best candidate reaches the threshold and is clearly
  ahead of the next (≥ 10 points): FIRINGI — *Settings › Matching: book sure matches by itself* (`firingiMode`
  AUTO, `autoConfidence`, default off / 95); suppliers and customers — the switch on each account, when FIRINGI
  allows it (`companiesMayAuto`, `companyAutoConfidence`). Otherwise the best candidate is stored as a suggestion
  (≥ 50) for a person.
- `applyMatch` re-checks everything inside a transaction with the line locked: matches carry signed amounts that must
  add up to the line; invoices of another customer, more than what is open, or a payment's remainder are refused.
  A match can be one line ↔ several invoices, and an invoice can be paid by several lines.
- Confirming a payer remembers its IBAN (`BankPayerLink`). Every booking, undo and ignore is in the audit log
  (`bank.line_matched`, `bank.line_auto_matched`, `bank.line_unmatched`, `bank.line_ignored`).
- **Undo** removes the payments the match created (their invoices open again, supplier invoices go back to APPROVED,
  a released order goes back on hold if it hasn't moved on). A refunded payment can't be undone here.
- **Ignore** (with a note) for lines that aren't for reconciliation (own transfers…); undo brings them back.
- Lines waiting are looked at again daily (new invoices / payments may fit them now) and on “Look again”.

## Settings (`bank.settings`, FIRINGI)

`firingiMode` (CONFIRM | AUTO), `autoConfidence` (95), `companiesMayAuto` (on), `companyAutoConfidence` (95),
`toleranceAmount` (2 €), `tolerancePct` (1 %), `windowDays` (14), `feed` { `enabled` (off), `provider`
(SIMULATED | GOCARDLESS), `companiesMayLink` (on) }.

## Rights

FIRINGI: `admin.finance.view` sees, `admin.finance.manage` imports and matches. Companies: owners, or
`company.bank.view` / `company.bank.manage` (given to the Accountant roles).

## Daily job (`/api/cron/bank`)

Fetches every linked feed (new lines are matched as they arrive), warns 7 and 1 days before a bank's consent ends
(`bank.feed_expiring`) and when a fetch fails (`bank.feed_failed`), looks again at lines waiting (last 120 days),
and tells FIRINGI's finance team how many lines wait (`bank.to_review`).

## Not done (yet)

- The GoCardless adapter follows their published API but hasn't been run against a live bank here (no keys).
- Card / payment-provider settlements are matched when the provider's payments of a day add up to the line exactly;
  settlements net of provider fees need a hand match (the difference as a fee).
- Bank lines in another currency than the account's are skipped.
