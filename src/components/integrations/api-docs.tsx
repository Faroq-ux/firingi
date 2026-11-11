/** API reference rendered from the OpenAPI operations (server component; texts translated, paths not). */
import { getTranslations } from "next-intl/server";
import { BookOpen, Download, ShieldCheck } from "lucide-react";
import type { OPERATIONS } from "@/server/api/openapi";

type Op = (typeof OPERATIONS)[number];
const METHOD = { get: "bg-[color:color-mix(in_oklch,var(--vivid-teal)_18%,transparent)] text-[color:color-mix(in_oklch,var(--vivid-teal)_70%,var(--foreground))]", post: "bg-[color:color-mix(in_oklch,var(--vivid-violet)_18%,transparent)] text-[color:color-mix(in_oklch,var(--vivid-violet)_75%,var(--foreground))]" };

export async function ApiDocs({ ops, origin, side }: { ops: Op[]; origin: string; side: "BUYER" | "SUPPLIER" | "BOTH" }) {
  const t = await getTranslations("integrations");
  const shown = ops.filter((o) => o.who === "Everyone" || side === "BOTH" || (side === "BUYER" ? o.who === "Buyers" : o.who === "Suppliers"));
  const verify = `const [t, v1] = header.match(/t=(\\d+),v1=(\\w+)/).slice(1);
const ok = v1 === hmacSha256Hex(secret, t + "." + rawBody)
  && Math.abs(Date.now() / 1000 - Number(t)) < 300;`;
  return (
    <div className="space-y-5" data-testid="api-docs">
      <div className="grid gap-3 md:grid-cols-3">
        <div className="tile gloss tone-blue rounded-2xl border p-4"><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t("docs.base")}</p><code className="mt-1 block break-all font-mono text-sm">{origin}/api/v2</code></div>
        <div className="tile gloss tone-violet rounded-2xl border p-4"><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t("docs.auth")}</p><code className="mt-1 block font-mono text-sm">Authorization: Bearer fk_live_…</code><p className="mt-1 text-xs text-muted-foreground">{t("docs.limit", { n: 120 })}</p></div>
        <a href="/api/v2/openapi.json" className="tile gloss tone-teal motion-lift flex items-center gap-3 rounded-2xl border p-4" data-testid="openapi-link"><span className="tile-chip grid size-10 place-items-center rounded-xl"><Download className="size-5" aria-hidden /></span><span className="font-semibold">{t("docs.openapi")}</span></a>
      </div>
      <ul className="space-y-2">
        {shown.map((o, i) => (
          <li key={`${o.method}${o.path}`} className="motion-rise overflow-hidden rounded-xl border bg-card" style={{ ["--i" as string]: i }}>
            <details>
              <summary className="flex cursor-pointer flex-wrap items-center gap-3 p-3 hover:bg-muted/40">
                <span className={`w-14 rounded-md px-2 py-0.5 text-center font-mono text-xs font-bold uppercase ${METHOD[o.method]}`}>{o.method}</span>
                <code className="font-mono text-sm font-semibold">{o.path}</code>
                <span className="min-w-0 flex-1 text-sm text-muted-foreground">{o.summary}</span>
                {o.scope && <span className="rounded-full border px-2 py-0.5 text-[11px]">{t("docs.needs", { scope: o.scope })}</span>}
                <span className="rounded-full bg-muted px-2 py-0.5 text-[11px]">{t(`docs.who.${o.who}`)}</span>
              </summary>
              <div className="space-y-2 border-t bg-muted/20 p-3 text-sm">
                {o.params?.length ? <ul className="grid gap-1">{o.params.map((p) => <li key={p.name}><code className="font-mono text-xs">{p.in === "path" ? `{${p.name}}` : `?${p.name}=`}</code> <span className="text-muted-foreground">{p.description}</span></li>)}</ul> : null}
                {o.body && <><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t("docs.example")}</p><pre className="overflow-x-auto rounded-lg bg-[oklch(0.2_0.03_265)] p-3 font-mono text-xs text-[oklch(0.9_0.05_200)]">{JSON.stringify(o.body, null, 2)}</pre></>}
                <pre className="overflow-x-auto rounded-lg bg-[oklch(0.2_0.03_265)] p-3 font-mono text-xs text-[oklch(0.9_0.05_200)]">{`curl ${o.method === "post" ? "-X POST " : ""}-H "Authorization: Bearer $FIRINGI_KEY" ${o.body ? `-H "Content-Type: application/json" -d @body.json ` : ""}${origin}/api/v2${o.path.replace("{id}", "ORDER_ID")}`}</pre>
              </div>
            </details>
          </li>
        ))}
      </ul>
      <div className="rounded-2xl border bg-card p-4">
        <p className="mb-2 flex items-center gap-2 font-semibold"><ShieldCheck className="size-5 text-[var(--vivid-teal)]" aria-hidden />{t("docs.signature")}</p>
        <pre className="overflow-x-auto rounded-lg bg-[oklch(0.2_0.03_265)] p-3 font-mono text-xs text-[oklch(0.9_0.05_200)]">{verify}</pre>
        <p className="mt-2 flex items-center gap-2 text-xs text-muted-foreground"><BookOpen className="size-4" aria-hidden />X-Firingi-Event · X-Firingi-Delivery · X-Firingi-Signature</p>
      </div>
    </div>
  );
}
