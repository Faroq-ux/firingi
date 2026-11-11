"use client";
import { useEffect } from "react";

/** Copies each column's header text onto its cells (data-label) so phone layouts can show it. */
function label(root: ParentNode) {
  root.querySelectorAll<HTMLTableElement>("table.ft-stack").forEach((table) => {
    const headRow = table.tHead?.rows[table.tHead.rows.length - 1];
    if (!headRow) return;
    const names: string[] = [];
    for (const th of Array.from(headRow.cells)) for (let i = 0; i < th.colSpan; i++) names.push((th.textContent ?? "").trim());
    for (const body of [...Array.from(table.tBodies), ...(table.tFoot ? [table.tFoot] : [])]) {
      for (const row of Array.from(body.rows)) {
        let col = 0;
        for (const td of Array.from(row.cells)) {
          const name = td.colSpan > 1 && row.cells.length === 1 ? "" : names[col] ?? "";
          if (td.getAttribute("data-label") !== name) td.setAttribute("data-label", name);
          col += td.colSpan;
        }
      }
    }
  });
}

export function TableLabeler() {
  useEffect(() => {
    let raf = 0;
    const run = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => label(document)); };
    run();
    const mo = new MutationObserver((list) => { if (list.some((m) => m.type === "childList")) run(); });
    mo.observe(document.body, { childList: true, subtree: true });
    return () => { mo.disconnect(); cancelAnimationFrame(raf); };
  }, []);
  return null;
}
