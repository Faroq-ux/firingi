/**
 * Daily bank job (Phase 37): fetch every linked bank feed, match what came in (and re-check lines
 * waiting — new invoices or payments may fit them now), warn before a bank's consent ends, and tell
 * FIRINGI's finance team how many lines wait for a person.
 */
import "server-only";
import { prisma } from "@/server/db";
import { notify } from "@/server/notify/dispatch";
import { bankSettings, ownerOfAccount, syncFeed, type Owner } from "./service";
import { matchLines } from "./match";

const DAY = 86_400_000;

export async function runBankJob(now = new Date()) {
  const s = await bankSettings();
  const out = { synced: 0, newLines: 0, booked: 0, failed: 0, expiring: 0, toReview: 0 };
  const admin = await prisma.company.findFirst({ where: { type: "ADMIN" }, select: { id: true } });
  const linkFor = (o: Owner) => (o.side === "FIRINGI" ? "/admin/finance/bank" : o.side === "VENDOR" ? "/vendor/finance/bank" : "/buy/finance/bank");
  const target = (o: Owner) => (o.companyId ? o.companyId : admin?.id);

  if (s.feed.enabled) {
    const linked = await prisma.bankAccount.findMany({ where: { active: true, feedStatus: "LINKED" } });
    for (const a of linked) {
      const owner = await ownerOfAccount(a.id);
      if (owner.side !== "FIRINGI" && !s.feed.companiesMayLink) continue;
      const to = target(owner);
      try {
        const r = await syncFeed(a.id);
        out.synced++; out.newLines += r.newLines; out.booked += r.autoMatched;
      } catch (e) {
        out.failed++;
        if (to) await notify("bank.feed_failed", [{ companyId: to, link: linkFor(owner) }], { account: a.name, reason: (e as Error).message.slice(0, 200) }).catch(() => null);
      }
      // consent ending within a week: say it once (on the 7th and the 1st day before)
      if (a.feedConsentUntil && to) {
        const days = Math.ceil((a.feedConsentUntil.getTime() - now.getTime()) / DAY);
        if (days === 7 || days === 1) {
          out.expiring++;
          await notify("bank.feed_expiring", [{ companyId: to, link: linkFor(owner) }], { account: a.name, date: a.feedConsentUntil.toISOString().slice(0, 10) }).catch(() => null);
        }
      }
    }
  }

  // look again at lines that wait (per owner)
  const owners = await prisma.bankLine.groupBy({ by: ["accountId"], where: { status: { in: ["OPEN", "SUGGESTED"] }, bookingDate: { gte: new Date(now.getTime() - 120 * DAY) } } });
  const seen = new Set<string>();
  for (const { accountId } of owners) {
    const o = await ownerOfAccount(accountId);
    if (seen.has(o.key)) continue;
    seen.add(o.key);
    const r = await matchLines(o);
    out.booked += r.booked;
  }

  const waiting = await prisma.bankLine.findMany({ where: { account: { ownerKey: "FIRINGI" }, status: { in: ["OPEN", "SUGGESTED"] } }, orderBy: { bookingDate: "asc" }, select: { bookingDate: true }, take: 1 });
  out.toReview = await prisma.bankLine.count({ where: { account: { ownerKey: "FIRINGI" }, status: { in: ["OPEN", "SUGGESTED"] } } });
  if (out.toReview && admin) await notify("bank.to_review", [{ companyId: admin.id, link: "/admin/finance/bank" }], { count: String(out.toReview), oldest: waiting[0]?.bookingDate.toISOString().slice(0, 10) ?? "" }).catch(() => null);
  return out;
}
