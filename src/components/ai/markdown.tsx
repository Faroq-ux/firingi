/**
 * Tiny Markdown for assistant answers: paragraphs, **bold**, *italic*, `code`, bullet and
 * numbered lists, headings and pipe tables. Builds React elements only (never raw HTML), so
 * model output can't inject markup.
 */
import { Fragment, type ReactNode } from "react";

function inline(text: string, key: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|\*[^*\s][^*]*\*|`[^`]+`)/g;
  let last = 0, m: RegExpExecArray | null, n = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const t = m[0];
    if (t.startsWith("**")) out.push(<strong key={`${key}b${n++}`}>{t.slice(2, -2)}</strong>);
    else if (t.startsWith("`")) out.push(<code key={`${key}c${n++}`} className="rounded bg-muted px-1 font-mono text-[0.85em]">{t.slice(1, -1)}</code>);
    else out.push(<em key={`${key}i${n++}`}>{t.slice(1, -1)}</em>);
    last = m.index + t.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

const cells = (row: string) => row.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());

export function Markdown({ text }: { text: string }) {
  const lines = text.replace(/\r/g, "").split("\n");
  const blocks: ReactNode[] = [];
  let i = 0, k = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    if (/^\s*\|.*\|\s*$/.test(line) && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1])) {
      const head = cells(line);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) rows.push(cells(lines[i++]));
      blocks.push(
        <div key={k++} className="my-2 overflow-x-auto"><table className="w-full text-sm">
          <thead><tr>{head.map((h, j) => <th key={j} className="border-b px-2 py-1 text-left font-semibold">{inline(h, `h${j}`)}</th>)}</tr></thead>
          <tbody>{rows.map((r, ri) => <tr key={ri} className="border-b last:border-0">{r.map((c, j) => <td key={j} className={`px-2 py-1 ${/^[-+€\d.,\s%]+$/.test(c) ? "text-right tabular-nums" : ""}`}>{inline(c, `r${ri}${j}`)}</td>)}</tr>)}</tbody>
        </table></div>,
      );
      continue;
    }
    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    if (h) { blocks.push(<p key={k++} className="mt-2 font-semibold">{inline(h[2], `h${k}`)}</p>); i++; continue; }
    if (/^\s*([-*•])\s+/.test(line) || /^\s*\d+[.)]\s+/.test(line)) {
      const ordered = /^\s*\d+[.)]\s+/.test(line);
      const items: string[] = [];
      while (i < lines.length && (ordered ? /^\s*\d+[.)]\s+/ : /^\s*([-*•])\s+/).test(lines[i])) items.push(lines[i++].replace(/^\s*(?:[-*•]|\d+[.)])\s+/, ""));
      const L = ordered ? "ol" : "ul";
      blocks.push(<L key={k++} className={`my-1 space-y-0.5 pl-5 ${ordered ? "list-decimal" : "list-disc"}`}>{items.map((t, j) => <li key={j}>{inline(t, `l${k}${j}`)}</li>)}</L>);
      continue;
    }
    const para: string[] = [lines[i++]]; // always take this line, so odd lines (a lone "|…") can't stall the loop
    while (i < lines.length && lines[i].trim() && !/^\s*([-*•]|\d+[.)])\s+/.test(lines[i]) && !/^\s*\|/.test(lines[i]) && !/^#{1,4}\s/.test(lines[i])) para.push(lines[i++]);
    blocks.push(<p key={k++} className="my-1">{para.map((p, j) => <Fragment key={j}>{j > 0 && <br />}{inline(p, `p${k}${j}`)}</Fragment>)}</p>);
  }
  return <div className="text-sm leading-relaxed">{blocks}</div>;
}
