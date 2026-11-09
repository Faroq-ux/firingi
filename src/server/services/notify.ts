/** In-app notifications (+ e-mail) for account events. */
import { prisma } from "@/server/db";
import { sendMail } from "./mailer";

export async function notifyCompany(companyId: string, n: { type: string; title: string; body: string; link?: string }) {
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { email: true, memberships: { where: { status: "ACTIVE" }, select: { userId: true, isOwner: true, user: { select: { email: true } } } } },
  });
  if (!company) return;
  await prisma.notification.createMany({
    data: company.memberships.map((m) => ({ userId: m.userId, type: n.type, title: n.title, body: n.body, link: n.link ?? null })),
  });
  const owners = company.memberships.filter((m) => m.isOwner).map((m) => m.user.email);
  for (const to of new Set([company.email, ...owners])) await sendMail({ to, subject: `FIRINGI — ${n.title}`, text: n.body });
}

export async function notifyUser(userId: string, n: { type: string; title: string; body: string; link?: string }) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
  if (!user) return;
  await prisma.notification.create({ data: { userId, type: n.type, title: n.title, body: n.body, link: n.link ?? null } });
  await sendMail({ to: user.email, subject: `FIRINGI — ${n.title}`, text: n.body });
}
