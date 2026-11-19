/** Tiny XML writer for the e-invoice formats (no dependencies, always escaped, stable output). */

export type XNode = { tag: string; attrs?: Record<string, string | number | null | undefined>; children?: (XNode | null | undefined | false)[]; text?: string | number | null };

export const esc = (v: string | number) => String(v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");

/** el("cbc:ID", { schemeID: "0088" }, "123") or el("cac:Party", {}, [children…]) */
export function el(tag: string, attrs?: XNode["attrs"] | null, body?: XNode["children"] | string | number | null): XNode | null {
  if (body === undefined || body === null || body === "") {
    // an element with neither text nor children is left out (optional data missing)
    return null;
  }
  if (Array.isArray(body)) {
    const kids = body.filter(Boolean) as XNode[];
    if (!kids.length) return null;
    return { tag, attrs: attrs ?? undefined, children: kids };
  }
  return { tag, attrs: attrs ?? undefined, text: body };
}

function render(n: XNode, depth: number, out: string[]) {
  const pad = "  ".repeat(depth);
  const attrs = Object.entries(n.attrs ?? {}).filter(([, v]) => v !== null && v !== undefined && v !== "").map(([k, v]) => ` ${k}="${esc(v as string)}"`).join("");
  if (n.children?.length) {
    out.push(`${pad}<${n.tag}${attrs}>`);
    for (const c of n.children) if (c) render(c, depth + 1, out);
    out.push(`${pad}</${n.tag}>`);
  } else {
    out.push(`${pad}<${n.tag}${attrs}>${esc(n.text ?? "")}</${n.tag}>`);
  }
}

export function toXml(root: XNode): string {
  const out: string[] = ['<?xml version="1.0" encoding="UTF-8"?>'];
  render(root, 0, out);
  return out.join("\n") + "\n";
}

/** Fixed 2-decimal amount for XML ("12.50"). */
export const amt = (v: string | number, dp = 2) => Number(v).toFixed(dp);
