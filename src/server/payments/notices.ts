/** Messages about online payments (customers in their language; FIRINGI finance for the odd case). */
import "server-only";
import { prisma } from "@/server/db";
import { notify } from "@/server/notify/dispatch";

const docsOf = (r: { order: { number: string } | null; items: { invoice: { fullNumber: string | null; providerNumber: string | null } }[] }) =>
  r.order ? r.order.number : r.items.map((i) => i.invoice.providerNumber ?? i.invoice.fullNumber ?? "?").join(", ");

async function load(requestId: string) {
  return prisma.paymentRequest.findUniqueOrThrow({
    where: { id: requestId },
    include: { company: { select: { legalName: true, tradeName: true } }, order: { select: { id: true, number: true, sellerCompanyId: true, grandTotal: true } }, items: { include: { invoice: { select: { fullNumber: true, providerNumber: true } } } } },
  });
}

export async function notifyPaymentReceived(requestId: string, res: { leftover: { toNumber(): number; gt(n: number): boolean }; orderId: string | null; released: boolean }) {
  const r = await load(requestId);
  const total = Number(r.paidAmount ?? r.amount);
  await notify("payment.received", [{ companyId: r.companyId, link: r.order ? `/buy/orders/${r.order.id}` : "/buy/finance/payments" }], { total, documents: docsOf(r) }, { ref: { type: "PaymentRequest", id: r.id } });
  if (!r.orderId && res.leftover.gt(0.004))
    await notifyAttention(r.companyId, res.leftover.toNumber().toFixed(2), `Paid more than was still open on ${docsOf(r)} — kept as customer credit for the next invoices (or refund it).`);
  if (res.released && r.order) {
    const buyer = r.company.tradeName ?? r.company.legalName;
    await notify("order.new", [{ companyId: r.order.sellerCompanyId, link: `/vendor/orders/${r.order.id}` }], { number: r.order.number, buyer, total: Number(r.order.grandTotal) }, { ref: { type: "Order", id: r.order.id } });
  }
}

export async function notifyPaymentFailed(requestId: string) {
  const r = await load(requestId);
  const link = r.order ? `/buy/orders/${r.order.id}` : r.source === "STAFF" || r.source === "REMINDER" ? `/pay/${r.token}` : `/buy/finance/pay/${r.id}`;
  await notify("payment.failed", [{ companyId: r.companyId, link }], { total: Number(r.amount), reason: r.failureReason ?? "" }, { ref: { type: "PaymentRequest", id: r.id } });
  if (r.method === "DIRECT_DEBIT") await notifyAttention(r.companyId, Number(r.amount).toFixed(2), `Direct debit failed for ${docsOf(r)}: ${r.failureReason ?? "unknown reason"}`);
}

export async function notifyMandate(mandateId: string, what: "active") {
  const m = await prisma.sepaMandate.findUniqueOrThrow({ where: { id: mandateId } });
  if (what === "active") await notify("direct_debit.active", [{ companyId: m.companyId, link: "/buy/finance/direct-debit" }], { last4: m.ibanLast4 ?? "····" }, { ref: { type: "SepaMandate", id: m.id } });
}

export async function notifyRefund(companyId: string, amount: string) {
  await notify("payment.refunded", [{ companyId, link: "/buy/finance/payments" }], { total: Number(amount) });
}

/** FIRINGI finance: something about a customer's payment needs a person. */
export async function notifyAttention(companyId: string, amount: string, reason: string) {
  const [admins, c] = await Promise.all([
    prisma.membership.findMany({ where: { status: "ACTIVE", company: { type: "ADMIN" }, roles: { some: { role: { permissions: { some: { permissionCode: "admin.finance.manage" } } } } } }, select: { userId: true } }),
    prisma.company.findUnique({ where: { id: companyId }, select: { legalName: true } }),
  ]);
  const users = [...new Set(admins.map((a) => a.userId))];
  if (users.length) await notify("payment.attention", users.map((userId) => ({ userId, link: "/admin/finance/online-payments" })), { company: c?.legalName ?? "?", total: Number(amount), reason });
}
