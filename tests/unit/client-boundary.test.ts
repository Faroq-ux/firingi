/**
 * A server file that imports a plain value (constant, object) from a "use client" module gets
 * a client reference, not the value — labels silently go missing (seen with cost categories,
 * coupon error codes and campaign channels). Shared values belong in a non-client module.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = resolve(__dirname, "../../src");
const files: string[] = [];
const walk = (d: string) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else if (/\.tsx?$/.test(f)) files.push(p); } };
walk(SRC);
const isClient = (src: string) => /^\s*["']use client["']/.test(src);
const resolveImport = (spec: string) => {
  if (!spec.startsWith("@/")) return null;
  const base = join(SRC, spec.slice(2));
  return [`${base}.ts`, `${base}.tsx`, join(base, "index.ts"), join(base, "index.tsx")].find((p) => files.includes(p)) ?? null;
};

describe("client / server boundary", () => {
  it("server files import no constants from client modules", () => {
    const bad: string[] = [];
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      if (isClient(src)) continue;
      for (const m of src.matchAll(/import\s*\{([^}]+)\}\s*from\s*["']([^"']+)["']/g)) {
        const target = resolveImport(m[2]);
        if (!target) continue;
        const tsrc = readFileSync(target, "utf8");
        if (!isClient(tsrc)) continue;
        for (const raw of m[1].split(",")) {
          const name = raw.trim().replace(/^type\s+/, "").split(/\s+as\s+/)[0];
          if (!name || raw.trim().startsWith("type ")) continue;
          if (new RegExp(`export\\s+const\\s+${name}\\s*[:=]\\s*(?!\\(|React\\.forwardRef|forwardRef)`).test(tsrc) && /^[A-Z][A-Z0-9_]+$/.test(name))
            bad.push(`${f.replace(SRC, "src")} imports ${name} from client module ${m[2]}`);
        }
      }
    }
    expect(bad).toEqual([]);
  });
});
