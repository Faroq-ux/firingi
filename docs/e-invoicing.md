# E-invoicing (Phase 46)

FIRINGI issues every invoice to its customers, plus service invoices (ads, plans, early payout) and — for suppliers
who agree — self-billed supplier invoices. Phase 46 sends these documents **electronically** where the recipient's
country route says so, receives **suppliers' e-invoices** and matches them, prints every document in the right
**language(s)** with the **legal mentions**, and keeps a **hash-checked archive** for auditors.

## Routes per country (admin decides)

*Invoices & Tax › E-Invoicing Settings* — one row per Schengen country (the **recipient's** country):

| Setting | Meaning |
|---|---|
| On | e-invoices for recipients in this country at all |
| Format | Peppol BIS Billing 3.0 (UBL), XRechnung 3.0, Factur-X / ZUGFeRD (PDF + CII XML), KSeF FA(3), FatturaPA 1.2, Verifactu |
| Service | who carries it — the **EU-wide e-invoicing service** (any country, any format), a **Peppol access point**, **KSeF**, **SDI**, **AEAT** (direct), or **e-mail** (XRechnung / Factur-X files) |
| Mandatory | every B2B document goes this way (clearance / reporting countries). Off = only recipients who gave a Peppol id or chose e-invoices |
| E-mail copy | also e-mail the PDF |
| Keep (years) | archive period for documents of this country |

Defaults: **Poland KSeF (mandatory)**, **Italy SDI (mandatory)**, **Spain Verifactu (mandatory)**, Germany XRechnung via
Peppol, France Factur-X via the EU-wide service, all other countries Peppol on request. A service that can't carry a
format is replaced by the EU-wide service. KSeF / SDI / Verifactu belong to one country's tax system: they're only used
for FIRINGI's own company there — for other issuers a recipient with a Peppol id gets Peppol instead.

Every switch is the admin's: master switch, per document type (customer invoices, credit notes, service invoices,
self-billing, receiving supplier e-invoices), per country, checks before sending (and whether warnings stop a
document), the match tolerance for received invoices, Poland's split-payment threshold.

## How a document goes out

1. Issued (inside the delivery / credit / service transaction): its **language(s)** are fixed and, when the route
   applies, an `EInvoiceDocument` is **queued**.
2. The queue (right after the transaction, then every 10 minutes — `/api/cron/einvoice`) builds the XML from the
   document, **checks** it (EN 16931 business rules + each network's own: Peppol ids, Leitweg-ID, NIPs, SDI code …).
   A failed check stops it (**Stopped**) and alerts finance; fix the data and *Check & send again*.
3. The XML (and PDF; Factur-X embeds the XML in the PDF) is **archived** with its SHA-256 and sent. Outages are retried
   with back-off (1 min … 8 h, 8 tries), then **Failed** + alert. A document issued through the certified provider
   (Moloni) waits for its legal number.
4. The status is followed: **Sent → Delivered / cleared → Accepted**, or **Rejected** (+ alert).

Customers see each invoice's e-invoice status (and download the XML) in their invoice list and on *Company ›
E-Invoicing*; FIRINGI sees everything under *Invoices & Tax › E-Invoicing*.

## Language and legal texts

Priority (admin-ordered, default): **the customer's country language → the language the customer chose → the FIRINGI
company's language**. The second language (bilingual print) is the FIRINGI company's own language when it must always
be on its documents, else the customer's second language / its choice, else the company's second language. Documents
print in all 25 languages (DejaVu Sans covers every letter); product names come from the catalogue in that language
(English when the catalogue has none), FIRINGI's own line texts (delivery, deposit, excise, loyalty, ads, early payout)
are translated, the stored invoice lines stay as the legal record.

Legal mentions: EU reverse charge (Art. 196), intra-EU supply (Art. 138), self-billing (Art. 224 / 226(10a)) in the
document's language; country texts — Poland *mechanizm podzielonej płatności* (from the PLN threshold) and
*samofakturowanie*, France's late-payment penalties, Spain's VERI*FACTU mention, *Gutschrift* / *Autofattura* /
*Autofaturação* for self-billing.

## Self-billing

A supplier ticks the self-billing agreement on *Company › E-Invoicing* (agreement number + date recorded). From then
on each billing statement becomes **its invoice, issued by FIRINGI** — numbered in the supplier's own series
(`AF <tax id> <year>/<n>`, credit notes `AFNC …`), recorded and matched at once (no upload), sent to the supplier
electronically when its route says so, PDF in the supplier's language. Admin can switch self-billing off globally.

## Receiving supplier e-invoices

From the services' inboxes (cron), or pushed to `POST /api/einvoice/inbound` (`Authorization: Bearer
$EINVOICE_INBOUND_SECRET`, body = XML). UBL (Peppol / XRechnung), CII (Factur-X) and KSeF are read; the supplier is
found by its Peppol id / VAT number; the invoice is matched to the statement it names (statement / order number) or the
one open statement with the same total, then recorded as the supplier's invoice (matched or disputed). The rest wait
on *Supplier E-Invoices*.

## Archive & audit

*E-Invoice Archive*: every document sent and received with its hash and keep-until date; **Check the archive** re-hashes
every file; **Auditor export** = ZIP of a period (XML, PDF, `manifest.csv` with numbers, statuses, network references and
hashes).

## Connecting the services

| Service | Environment |
|---|---|
| EU-wide e-invoicing service | `EINVOICE_HUB_URL`, `EINVOICE_HUB_KEY` |
| Peppol access point | `PEPPOL_AP_URL`, `PEPPOL_AP_KEY` |
| KSeF | `KSEF_URL`, `KSEF_TOKEN` |
| SDI intermediary | `SDI_URL`, `SDI_KEY` |
| AEAT Verifactu | `AEAT_URL`, `AEAT_KEY` |
| Received e-invoices (push) | `EINVOICE_INBOUND_SECRET` |
| Test network | `EINVOICE_SIMULATE=1` |

Live services are called through one small REST contract (`POST /documents`, `GET /documents/:id`, `GET /inbox`) —
the adapter for the provider FIRINGI signs with maps onto it (`src/server/einvoice/providers.ts`). Without keys a
service shows **Not connected** and documents wait (no failures). The built-in **test network** behaves like the real
ones (sent → delivered / cleared → accepted; a recipient id containing `REJECT`, `NETFAIL` or `NOTREG` shows a
rejection, an outage, an unregistered recipient).

## Not covered (yet)

- Live connections are not certified against each network — run each provider's validator / test environment before
  go-live (KSeF test, SDI test, AEAT pre-production, a Peppol test access point).
- KSeF's own session / encryption flow and Verifactu's QR code are left to the provider adapter.
- Product names exist in English and Portuguese in the catalogue; other languages fall back to English for them.
- Bangla / Hindi: not document languages (not among the 25 UI languages).
