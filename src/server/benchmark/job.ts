import "server-only";
/**
 * Price benchmark job (Phase 70, hourly): rebuilds the benchmark when it is older than FIRINGI's hours, and on the
 * 1st of the month tells each customer what it could save a year (from FIRINGI's minimum saving, once a month).
 */
import { prisma } from "@/server/db";
import type { Prisma } from "@prisma/client";
import { benchSettings, buyerOn } from "./settings";
import { lastRun, rebuild } from "./service";

export async function processBenchmark(now = new Date(), force = false) {
  const s = await benchSettings();
  const out = { rebuilt: false, groups: 0, notified: 0 };
  if (!s.enabled) return out;
  let run = await lastRun();
  if (force || !run || now.getTime() - new Date(run.at).getTime() >= s.refreshHours * 3600_000) {
    run = await rebuild(now, s);
    out.rebuilt = true; out.groups = run.groups;
  }
  const month = now.toISOString().slice(0, 7);
  if (s.parts.monthlyMessage && now.getUTCDate() === 1 && run.notifiedMonth !== month) {
    const { notify } = await import("@/server/notify/dispatch");
    const cos = await prisma.company.findMany({ where: { id: { in: run.topSavers.map((x) => x.companyId) } }, select: { id: true, type: true, businessType: true, country: { select: { code: true } } } });
    for (const x of run.topSavers.filter((t) => t.saving >= s.notifyMinSaving)) {
      const c = cos.find((y) => y.id === x.companyId);
      if (!c || !buyerOn(s, { id: c.id, type: c.type, countryCode: c.country.code, businessType: c.businessType })) continue;
      await notify("benchmark.monthly_savings", [{ companyId: c.id, link: "/buy/reports/price-benchmark" }], { amount: `€${Math.round(x.saving).toLocaleString("pt-PT")}`, count: x.products }).catch(() => null);
      out.notified++;
    }
    await prisma.setting.update({ where: { scope_scopeId_key: { scope: "GLOBAL", scopeId: "", key: "benchmark.lastRun" } }, data: { value: { ...run, notifiedMonth: month } as unknown as Prisma.InputJsonValue } });
  }
  return out;
}
