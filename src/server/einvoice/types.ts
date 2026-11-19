/**
 * The e-invoice in one neutral shape (EN 16931 semantic model, simplified). Every format generator and the
 * validation work on this; it is built from FIRINGI's invoice / credit note / self-billing statement.
 */

/** UNCL5305 VAT category: S standard, Z zero, E exempt, AE reverse charge, K intra-EU supply, O outside scope. */
export type VatCategory = "S" | "Z" | "E" | "AE" | "K" | "O";

export type EParty = {
  name: string;
  /** VAT id with country prefix (PT500…, PL…, DE…) */
  vatId: string | null;
  /** national tax / company id (NIF, NIP, Steuernummer …) */
  taxId: string | null;
  countryCode: string;
  street: string | null;
  city: string | null;
  postalCode: string | null;
  email: string | null;
  phone?: string | null;
  /** Peppol participant id "scheme:identifier" */
  peppolId: string | null;
  iban?: string | null;
};

export type ELine = {
  id: string;
  name: string;
  /** second-language name (bilingual documents) */
  name2?: string | null;
  sku: string | null;
  qty: string;
  /** UN/ECE rec 20: C62 piece, KGM kilogram */
  unitCode: string;
  /** net price per unit after discount */
  price: string;
  /** gross list price per unit (before discount) */
  listPrice: string;
  discount: string;
  net: string;
  vatCategory: VatCategory;
  vatRate: string;
};

export type ETax = { category: VatCategory; rate: string; base: string; vat: string; exemptionCode?: string | null; exemptionText?: string | null };

export type EDoc = {
  /** 380 invoice, 381 credit note, 389 self-billed invoice, 261 self-billed credit note */
  typeCode: "380" | "381" | "389" | "261";
  kind: "INVOICE" | "CREDIT_NOTE" | "SERVICE_INVOICE" | "SELF_BILLED" | "SELF_BILLED_CREDIT";
  number: string;
  issueDate: string;
  dueDate: string | null;
  currency: string;
  /** VAT total in EUR when the document is in another currency (BT-111) */
  vatInEur: string | null;
  seller: EParty;
  buyer: EParty;
  /** BT-10 buyer reference (Leitweg-ID, PO number …) */
  buyerReference: string | null;
  orderReference: string | null;
  /** credit notes: the invoice they correct */
  preceding: { number: string; issueDate: string | null } | null;
  notes: string[];
  lines: ELine[];
  taxes: ETax[];
  totals: { lineNet: string; net: string; vat: string; gross: string; paid: string; payable: string };
  payment: { meansCode: string; iban: string | null; reference: string | null; terms: string | null } | null;
  language: string;
  /** country-specific bits (SDI code, KSeF NIP, Verifactu chaining …) */
  extra: {
    sdiCode?: string | null; pec?: string | null; ksefBuyerNip?: string | null; ksefSellerNip?: string | null;
    splitPayment?: boolean; previousHash?: string | null; previousNumber?: string | null; previousDate?: string | null;
  };
};
