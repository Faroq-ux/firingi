/**
 * A small, strict-enough XML reader for bank statements (CAMT): elements, attributes, text, CDATA,
 * entities. Namespace prefixes are dropped ("camt:Ntry" → "Ntry"). No DTDs or external entities are
 * ever resolved, so a hostile file can't make the server fetch or expand anything.
 */
export type XNode = { name: string; attrs: Record<string, string>; children: XNode[]; text: string };

const ENT: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
const decode = (s: string) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") { const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : ""; }
    return ENT[e.toLowerCase()] ?? m;
  });
const local = (n: string) => n.slice(n.indexOf(":") + 1);

export function parseXml(src: string): XNode {
  const root: XNode = { name: "#root", attrs: {}, children: [], text: "" };
  const stack: XNode[] = [root];
  let i = 0;
  const n = src.length;
  while (i < n) {
    const lt = src.indexOf("<", i);
    if (lt < 0) { stack[stack.length - 1].text += decode(src.slice(i)); break; }
    if (lt > i) stack[stack.length - 1].text += decode(src.slice(i, lt));
    if (src.startsWith("<!--", lt)) { const e = src.indexOf("-->", lt + 4); i = e < 0 ? n : e + 3; continue; }
    if (src.startsWith("<![CDATA[", lt)) { const e = src.indexOf("]]>", lt + 9); stack[stack.length - 1].text += src.slice(lt + 9, e < 0 ? n : e); i = e < 0 ? n : e + 3; continue; }
    if (src.startsWith("<?", lt)) { const e = src.indexOf("?>", lt + 2); i = e < 0 ? n : e + 2; continue; }
    if (src.startsWith("<!", lt)) { // DOCTYPE and friends: skipped, never interpreted
      const e = src.indexOf(">", lt + 2); i = e < 0 ? n : e + 1; continue;
    }
    const gt = src.indexOf(">", lt + 1);
    if (gt < 0) throw new Error("Unclosed tag");
    const raw = src.slice(lt + 1, gt);
    i = gt + 1;
    if (raw[0] === "/") {
      const name = local(raw.slice(1).trim());
      // close up to the matching element (tolerant of small mistakes)
      for (let k = stack.length - 1; k > 0; k--) if (stack[k].name === name) { stack.length = k; break; }
      continue;
    }
    const self = raw.endsWith("/");
    const body = self ? raw.slice(0, -1) : raw;
    const m = body.match(/^\s*([^\s/>]+)/);
    if (!m) continue;
    const el: XNode = { name: local(m[1]), attrs: {}, children: [], text: "" };
    for (const a of body.slice(m[0].length).matchAll(/([^\s=]+)\s*=\s*("([^"]*)"|'([^']*)')/g)) el.attrs[local(a[1])] = decode(a[3] ?? a[4] ?? "");
    stack[stack.length - 1].children.push(el);
    if (!self) stack.push(el);
  }
  return root;
}

/** First descendant along a path ("Acct/Id/IBAN"); "*" matches any one element. */
export function pick(node: XNode | undefined, path: string): XNode | undefined {
  if (!node) return undefined;
  let cur: XNode[] = [node];
  for (const step of path.split("/")) {
    const next: XNode[] = [];
    for (const c of cur) for (const ch of c.children) if (step === "*" || ch.name === step) next.push(ch);
    if (!next.length) return undefined;
    cur = next;
  }
  return cur[0];
}
export const all = (node: XNode | undefined, name: string) => (node ? node.children.filter((c) => c.name === name) : []);
export const txt = (node: XNode | undefined, path?: string) => { const n = path ? pick(node, path) : node; return n ? n.text.trim() : ""; };
/** Every descendant (depth-first) with this name. */
export function findAll(node: XNode | undefined, name: string, out: XNode[] = []): XNode[] {
  if (!node) return out;
  for (const c of node.children) { if (c.name === name) out.push(c); findAll(c, name, out); }
  return out;
}
