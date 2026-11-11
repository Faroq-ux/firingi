/**
 * A simulated Moloni (in-process) for tests, development and demos — no network, NOT fiscal.
 * Implements the endpoints FIRINGI uses, with the request fields and answers documented at
 * https://www.moloni.pt/dev/ (required fields, error lists like ["2 document_set_id"],
 * closed documents with sequential numbers, credit notes tied to invoice lines).
 */
type Init = { method: "GET" | "POST"; headers?: Record<string, string>; body?: string };
type Line = { document_product_id: number; product_id: number; name: string; qty: number; price: number; discount: number; taxes: { tax_id: number; value: number }[]; exemption_reason: string };
type Doc = { document_id: number; type: "FT" | "NC"; document_set_id: number; number: number; customer_id: number; date: string; expiration_date: string | null; our_reference: string; your_reference: string; products: Line[]; associated: { associated_id: number; value: number }[]; net: number; taxes: number; gross: number; rsa_hash: string; credited: Map<number, number> };

const COMPANY = 77001;
const TAXES = [
  { tax_id: 1, name: "IVA Normal", value: 23, type: 1, saft_type: 1, vat_type: "NOR", fiscal_zone: "PT", active_by_default: 1 },
  { tax_id: 2, name: "IVA Intermédio", value: 13, type: 1, saft_type: 1, vat_type: "INT", fiscal_zone: "PT", active_by_default: 0 },
  { tax_id: 3, name: "IVA Reduzido", value: 6, type: 1, saft_type: 1, vat_type: "RED", fiscal_zone: "PT", active_by_default: 0 },
  { tax_id: 4, name: "IVA Normal Madeira", value: 22, type: 1, saft_type: 1, vat_type: "NOR", fiscal_zone: "PT-MA", active_by_default: 0 },
  { tax_id: 5, name: "IVA Intermédio Madeira", value: 12, type: 1, saft_type: 1, vat_type: "INT", fiscal_zone: "PT-MA", active_by_default: 0 },
  { tax_id: 6, name: "IVA Reduzido Madeira", value: 5, type: 1, saft_type: 1, vat_type: "RED", fiscal_zone: "PT-MA", active_by_default: 0 },
  { tax_id: 7, name: "IVA Normal Açores", value: 16, type: 1, saft_type: 1, vat_type: "NOR", fiscal_zone: "PT-AC", active_by_default: 0 },
  { tax_id: 8, name: "IVA Intermédio Açores", value: 9, type: 1, saft_type: 1, vat_type: "INT", fiscal_zone: "PT-AC", active_by_default: 0 },
  { tax_id: 9, name: "IVA Reduzido Açores", value: 4, type: 1, saft_type: 1, vat_type: "RED", fiscal_zone: "PT-AC", active_by_default: 0 },
];
const COUNTRIES = [
  { country_id: 1, iso_3166_1: "PT", languages: [{ country_id: 1, language_id: 1, name: "Português" }] },
  { country_id: 70, iso_3166_1: "ES", languages: [{ country_id: 70, language_id: 3, name: "Español" }] },
  { country_id: 75, iso_3166_1: "FR", languages: [{ country_id: 75, language_id: 4, name: "Français" }] },
  { country_id: 60, iso_3166_1: "DE", languages: [{ country_id: 60, language_id: 2, name: "English" }] },
];

function fresh() {
  return {
    seq: 1000, customers: new Map<number, Record<string, unknown>>(), products: new Map<number, Record<string, unknown>>(), docs: new Map<number, Doc>(),
    numbers: new Map<string, number>(), failNext: [] as ("UNAVAILABLE" | "VALIDATION" | "AUTH" | null)[], calls: [] as { endpoint: string; body: Record<string, unknown> }[],
  };
}
let S = fresh();

/** Test controls: reset, make the next calls fail, see what was sent. */
export const moloniSim = {
  reset() { S = fresh(); },
  /** Upcoming API calls in order: null = answer normally, otherwise fail that way. */
  failNext(...kinds: ("UNAVAILABLE" | "VALIDATION" | "AUTH" | null)[]) { S.failNext.push(...kinds); },
  calls: () => S.calls,
  doc: (id: number) => S.docs.get(id),
  companyId: COMPANY,
};

const reply = (status: number, body: unknown) => ({ status, json: async () => body });
const r2 = (n: number) => Math.round(n * 100) / 100;
const today = () => new Date().toISOString().slice(0, 10);

function totals(lines: Line[]) {
  let net = 0, tax = 0;
  for (const l of lines) {
    const base = r2(l.qty * l.price * (1 - (l.discount || 0) / 100));
    net += base;
    for (const t of l.taxes) tax += r2(base * (TAXES.find((x) => x.tax_id === t.tax_id)?.value ?? 0) / 100);
  }
  return { net: r2(net), taxes: r2(tax), gross: r2(net + tax) };
}

function view(d: Doc) {
  return {
    document_id: d.document_id, company_id: COMPANY, document_type_id: d.type === "FT" ? 1 : 3, customer_id: d.customer_id, document_set_id: d.document_set_id, number: d.number,
    date: `${d.date} 00:00:00`, expiration_date: d.expiration_date ? `${d.expiration_date} 00:00:00` : null, year: Number(d.date.slice(0, 4)), our_reference: d.our_reference, your_reference: d.your_reference,
    net_value: d.net, taxes_value: d.taxes, gross_value: d.gross, status: 1, rsa_hash: d.rsa_hash, hash_control: 1,
    document_type: { document_type_id: d.type === "FT" ? 1 : 3, saft_code: d.type }, document_set: { document_set_id: d.document_set_id, name: "SIM" },
    products: d.products.map((p, i) => ({ ...p, order: i + 1, taxes: p.taxes.map((t) => ({ ...TAXES.find((x) => x.tax_id === t.tax_id), value: TAXES.find((x) => x.tax_id === t.tax_id)?.value })) })),
    associated_documents: d.associated, payments: [],
  };
}

function validateLines(products: unknown, credit: Doc | null): { lines: Line[] } | { error: string[] } {
  const errs: string[] = [];
  if (!Array.isArray(products) || !products.length) return { error: ["2 products"] };
  const lines = (products as Record<string, unknown>[]).map((p, i) => {
    if (!S.products.has(Number(p.product_id))) errs.push(`2 products[${i}][product_id]`);
    if (!p.name) errs.push(`2 products[${i}][name]`);
    if (!(Number(p.qty) > 0)) errs.push(`2 products[${i}][qty]`);
    if (p.price === undefined || Number(p.price) < 0) errs.push(`2 products[${i}][price]`);
    const taxes = Array.isArray(p.taxes) ? (p.taxes as Record<string, unknown>[]).map((t) => ({ tax_id: Number(t.tax_id), value: Number(t.value ?? 0) })) : [];
    taxes.forEach((t, j) => { if (!TAXES.some((x) => x.tax_id === t.tax_id)) errs.push(`2 products[${i}][taxes][${j}][tax_id]`); });
    const vat = taxes.some((t) => (TAXES.find((x) => x.tax_id === t.tax_id)?.value ?? 0) > 0);
    if (!vat && !p.exemption_reason) errs.push(`2 products[${i}][exemption_reason]`);
    if (credit) {
      const orig = credit.products.find((o) => o.document_product_id === Number(p.related_id));
      if (!orig) errs.push(`2 products[${i}][related_id]`);
      else {
        const left = orig.qty - (credit.credited.get(orig.document_product_id) ?? 0);
        if (Number(p.qty) > left + 1e-9) errs.push(`5 products[${i}][qty]`);
        if (Number(p.price) > orig.price + 1e-9) errs.push(`5 products[${i}][price]`);
      }
    }
    return { document_product_id: ++S.seq, product_id: Number(p.product_id), name: String(p.name ?? ""), qty: Number(p.qty), price: Number(p.price), discount: Number(p.discount ?? 0), taxes, exemption_reason: String(p.exemption_reason ?? ""), related_id: Number(p.related_id ?? 0) } as Line & { related_id: number };
  });
  return errs.length ? { error: errs } : { lines };
}

export async function simulatedMoloni(url: string, init: Init) {
  const u = new URL(url);
  const endpoint = u.pathname.replace(/^\/(sandbox\/)?v1\//, "").replace(/\/$/, "");
  if (endpoint === "grant") {
    const g = u.searchParams.get("grant_type");
    if (g !== "password" && g !== "refresh_token") return reply(400, { error: "unsupported_grant_type", error_description: `Grant type ${g} not supported` });
    if (S.failNext[0] === "AUTH") { S.failNext.shift(); return reply(400, { error: "invalid_grant", error_description: "Invalid username and password combination" }); }
    return reply(200, { access_token: `sim-${++S.seq}`, expires_in: 3600, token_type: "bearer", scope: null, refresh_token: `simr-${S.seq}` });
  }
  if (!u.searchParams.get("access_token")?.startsWith("sim-")) return reply(400, { error: "invalid_grant", error_description: "Token is no longer valid" });
  const kind = S.failNext.shift();
  if (kind === "UNAVAILABLE") return reply(503, { error: "unavailable" });
  if (kind === "AUTH") return reply(400, { error: "invalid_grant", error_description: "Token is no longer valid" });
  const b = (init.body ? JSON.parse(init.body) : {}) as Record<string, unknown>;
  S.calls.push({ endpoint, body: b });
  if (kind === "VALIDATION") return reply(200, ["2 document_set_id"]);
  const needCompany = () => (Number(b.company_id) === COMPANY ? null : reply(200, ["2 company_id"]));

  switch (endpoint) {
    case "companies/getAll": return reply(200, [{ company_id: COMPANY, name: "FIRINGI (simulated Moloni)", vat: "509999999", country_id: 1, country: { country_id: 1, iso_3166_1: "PT", name: "Portugal" } }]);
    case "countries/getAll": return reply(200, COUNTRIES);
    case "taxes/getAll": return needCompany() ?? reply(200, TAXES);
    case "taxExemptions/getAll": return reply(200, [{ code: "M07", name: "Isento artigo 9.º do CIVA", visibility: 1 }, { code: "M16", name: "Isento artigo 14.º do RITI", visibility: 1 }, { code: "M99", name: "Não sujeito ou não tributado", visibility: 1 }]);
    case "documentSets/getAll": return needCompany() ?? reply(200, [{ document_set_id: 11, name: "SIM", active_by_default: 1, cash_vat_scheme_indicator: 0 }]);
    case "maturityDates/getAll": return needCompany() ?? reply(200, [{ maturity_date_id: 21, name: "Pronto pagamento", days: 0 }, { maturity_date_id: 22, name: "30 dias", days: 30 }]);
    case "paymentMethods/getAll": return needCompany() ?? reply(200, [{ payment_method_id: 31, name: "Transferência bancária", is_numerary: 0 }]);
    case "measurementUnits/getAll": return needCompany() ?? reply(200, [{ unit_id: 41, name: "Unidade", short_name: "Un." }]);
    case "productCategories/getAll": return needCompany() ?? reply(200, [{ category_id: 51, parent_id: 0, name: "Mercadorias", num_products: S.products.size }]);
    case "customers/getByVat": return needCompany() ?? reply(200, [...S.customers.values()].filter((c) => c.vat === b.vat));
    case "customers/insert": {
      const c = needCompany(); if (c) return c;
      const errs = ["vat", "number", "name", "language_id", "address", "city", "country_id", "maturity_date_id"].filter((k) => !b[k]).map((k) => `1 ${k}`);
      if (Number(b.country_id) === 1 && b.zip_code && !/^\d{4}-\d{3}$/.test(String(b.zip_code))) errs.push("2 zip_code");
      if (String(b.number ?? "").length > 20) errs.push("2 number");
      if (errs.length) return reply(200, errs);
      const id = ++S.seq;
      S.customers.set(id, { ...b, customer_id: id });
      return reply(200, { valid: 1, customer_id: id });
    }
    case "products/getByReference": return needCompany() ?? reply(200, [...S.products.values()].filter((p) => p.reference === b.reference));
    case "products/insert": {
      const c = needCompany(); if (c) return c;
      const errs = ["category_id", "type", "name", "reference", "unit_id"].filter((k) => !b[k]).map((k) => `1 ${k}`);
      if ([...S.products.values()].some((p) => p.reference === b.reference)) errs.push("3 reference");
      if (errs.length) return reply(200, errs);
      const id = ++S.seq;
      S.products.set(id, { ...b, product_id: id });
      return reply(200, { valid: 1, product_id: id });
    }
    case "invoices/insert":
    case "creditNotes/insert": {
      const c = needCompany(); if (c) return c;
      const credit = endpoint === "creditNotes/insert";
      const errs = ["date", "document_set_id", "customer_id", ...(credit ? [] : ["expiration_date"])].filter((k) => !b[k]).map((k) => `1 ${k}`);
      if (b.document_set_id && Number(b.document_set_id) !== 11) errs.push("2 document_set_id");
      if (b.customer_id && !S.customers.has(Number(b.customer_id))) errs.push("2 customer_id");
      const assoc = (Array.isArray(b.associated_documents) ? b.associated_documents : []) as { associated_id: number; value: number }[];
      const orig = credit ? S.docs.get(Number(assoc[0]?.associated_id)) ?? null : null;
      if (credit && (!orig || orig.type !== "FT")) errs.push("2 associated_documents");
      if (errs.length) return reply(200, errs);
      const v = validateLines(b.products, orig);
      if ("error" in v) return reply(200, v.error);
      const t = totals(v.lines);
      if (credit && orig && t.gross > orig.gross + 1e-9) return reply(200, ["5 associated_documents"]); // a credit note can't exceed the invoice
      const key = `${credit ? "NC" : "FT"}-11`;
      // Numbers continue across server restarts (a fresh simulator must not repeat a number).
      const number = (S.numbers.get(key) ?? Math.floor((Date.now() - Date.UTC(2026, 0, 1)) / 1000)) + 1;
      S.numbers.set(key, number);
      const id = ++S.seq;
      const doc: Doc = {
        document_id: id, type: credit ? "NC" : "FT", document_set_id: 11, number, customer_id: Number(b.customer_id), date: String(b.date), expiration_date: b.expiration_date ? String(b.expiration_date) : null,
        our_reference: String(b.our_reference ?? ""), your_reference: String(b.your_reference ?? ""), products: v.lines, associated: assoc, ...t, rsa_hash: `SIMHASH${id}`, credited: new Map(),
      };
      S.docs.set(id, doc);
      if (orig) for (const l of v.lines as (Line & { related_id: number })[]) orig.credited.set(l.related_id, (orig.credited.get(l.related_id) ?? 0) + l.qty);
      return reply(200, { valid: 1, document_id: id });
    }
    case "invoices/getAll":
    case "creditNotes/getAll": {
      const c = needCompany(); if (c) return c;
      const type = endpoint.startsWith("invoices") ? "FT" : "NC";
      return reply(200, [...S.docs.values()].filter((d) => d.type === type && (!b.our_reference || d.our_reference === b.our_reference)).slice(0, Number(b.qty ?? 50)).map(view));
    }
    case "invoices/getOne":
    case "creditNotes/getOne":
    case "documents/getOne": {
      const c = needCompany(); if (c) return c;
      const d = S.docs.get(Number(b.document_id));
      return reply(200, d ? view(d) : []);
    }
    case "documents/getPDFLink": {
      const c = needCompany(); if (c) return c;
      return S.docs.has(Number(b.document_id)) ? reply(200, { url: `https://simulated.moloni.invalid/pdf/${b.document_id}` }) : reply(200, ["2 document_id"]);
    }
    default: return reply(404, { error: "not_found" });
  }
}
export const simToday = today;
