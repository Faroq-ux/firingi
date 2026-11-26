"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

/**
 * Renders children at the end of <body>. Pop-up forms placed inside a page header or a card
 * are otherwise trapped under that element's stacking context (animations, blur) and the
 * cards below are drawn on top of them.
 */
export function Portal({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  return ready ? createPortal(children, document.body) : null;
}
