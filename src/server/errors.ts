/** Typed application errors. Messages are safe to show to users. */
export class AppError extends Error {
  /** Optional structured values so the UI can show a translated message. */
  public details?: Record<string, string>;
  constructor(public code: string, message: string, public status = 400, details?: Record<string, string>) {
    super(message);
    this.name = "AppError";
    this.details = details;
  }
}
export class UnauthenticatedError extends AppError {
  constructor() { super("UNAUTHENTICATED", "Please sign in.", 401); }
}
export class ForbiddenError extends AppError {
  constructor(message = "You do not have permission to do this.") { super("FORBIDDEN", message, 403); }
}
export class NotFoundError extends AppError {
  constructor(what = "Record") { super("NOT_FOUND", `${what} not found.`, 404); }
}
export class ValidationError extends AppError {
  constructor(message: string, public fieldErrors?: Record<string, string[]>) { super("VALIDATION", message, 422); }
}

/** Map the stable codes raised by our DB triggers to friendly messages. */
const DB_CODES: Record<string, string> = {
  CART_SELLER_MISMATCH:
    "Your cart already contains products from another vendor. Check out or clear your cart before adding products from a different vendor.",
  SELLER_NOT_ALLOWED: "This product is not available to your account.",
  SELLER_COUNTRY_NOT_ALLOWED: "This wholesaler doesn't sell in your country. Wholesalers sell only inside their own country.",
  ORDER_PARTIES_INVALID: "This order can't be placed with this supplier.",
  INVOICE_IMMUTABLE: "Issued invoices cannot be changed or deleted. Issue a credit note instead.",
  COMMISSION_HISTORY: "Commission history cannot be rewritten. Create a new commission rule instead.",
  APPEND_ONLY: "This record is part of the audit history and cannot be changed.",
  COMPANY_TYPE_IMMUTABLE: "A company's account type cannot be changed.",
  OFFER_VENDOR_INVALID: "Only vendors can create offers.",
};

export function fromDbError(e: unknown): AppError | null {
  const msg = e instanceof Error ? e.message : String(e);
  for (const code of Object.keys(DB_CODES)) {
    if (msg.includes(code)) return new AppError(code, DB_CODES[code], 409);
  }
  return null;
}
