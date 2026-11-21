/**
 * e2e helper (Phase 58): WhatsApp messages from a number as the provider delivers them, handled by the simulated AI.
 * Prints one line per message: the handling result and FIRINGI's last reply to that number.
 *   ASSISTANT_SIMULATE=1 WA_MEDIA_SIMULATE=1 npx tsx --require ./tests/e2e/setup/no-server-only.cjs tests/e2e/setup/wa-inbound.ts +351910000058 "add 6 Arroz" "sim"
 */
import "dotenv/config";
import { prisma } from "@/server/db";
import { storeInboundForTests } from "@/server/services/notifications";
import { processInbound } from "@/server/whatsapp/ordering";

async function main() {
  const [from, ...texts] = process.argv.slice(2);
  delete process.env.ANTHROPIC_API_KEY;
  process.env.ASSISTANT_SIMULATE = "1";
  for (const [i, text] of texts.entries()) {
    const id = await storeInboundForTests("WHATSAPP", `whatsapp:${from}`, text, `e2e-wa-${Date.now()}-${i}`);
    const r = id ? await processInbound(id) : "NOT_STORED";
    const out = await prisma.notificationMessage.findFirst({ where: { to: from, channel: "WHATSAPP" }, orderBy: { createdAt: "desc" }, select: { body: true } });
    console.log(JSON.stringify({ text, result: r, reply: out?.body ?? "" }));
  }
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
