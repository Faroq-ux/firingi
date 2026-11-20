/**
 * Phase 39 — what the phone keeps (browser only): the saved data per portal (IndexedDB "kv") and the
 * outbox of actions done without signal ("outbox", in the order they were done). Sent to
 * /api/app/sync when online; each action carries its own id so it is carried out only once.
 */
import type { AppPortal } from "@/lib/app";

const DB = "firingi-app";
const DOCS = "firingi-docs";
export const OUTBOX_EVENT = "firingi:outbox";

export type OutboxState = "WAITING" | "SENDING" | "DONE" | "NEEDS_CONFIRM" | "FAILED";
export type OutboxEntry = {
  clientId: string; kind: string; portal: AppPortal; at: string; data: Record<string, unknown>;
  /** Who did it: only that person's session sends it (another person signing in on the phone never does). */
  userId: string;
  /** Short text for the outbox list (e.g. "Order · 3 products · 84,20 €"). */
  title: string;
  state: OutboxState; result?: unknown; error?: string; tries: number; sentAt?: string;
};

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => {
      const db = r.result;
      if (!db.objectStoreNames.contains("kv")) db.createObjectStore("kv");
      if (!db.objectStoreNames.contains("outbox")) db.createObjectStore("outbox", { keyPath: "clientId" });
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

async function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const req = fn(t.objectStore(store));
    t.oncomplete = () => { resolve(req ? req.result : undefined); db.close(); };
    t.onerror = () => { reject(t.error); db.close(); };
  });
}

export const kvGet = <T>(key: string) => tx<T>("kv", "readonly", (s) => s.get(key) as IDBRequest<T>);
export const kvSet = (key: string, value: unknown) => tx("kv", "readwrite", (s) => { s.put(value, key); });
export const kvDel = (key: string) => tx("kv", "readwrite", (s) => { s.delete(key); });

export async function outbox(): Promise<OutboxEntry[]> {
  const all = (await tx<OutboxEntry[]>("outbox", "readonly", (s) => s.getAll() as IDBRequest<OutboxEntry[]>)) ?? [];
  return all.sort((a, b) => a.at.localeCompare(b.at) || a.clientId.localeCompare(b.clientId));
}
const changed = () => { if (typeof window !== "undefined") window.dispatchEvent(new Event(OUTBOX_EVENT)); };
export async function putEntry(e: OutboxEntry) { await tx("outbox", "readwrite", (s) => { s.put(e); }); changed(); }
export async function removeEntry(clientId: string) { await tx("outbox", "readwrite", (s) => { s.delete(clientId); }); changed(); }

/** A new id for an action (made on the phone; the server keeps one result per id). */
export function newClientId() {
  const r = crypto.getRandomValues(new Uint8Array(12));
  return `o${Date.now().toString(36)}${Array.from(r, (b) => b.toString(16).padStart(2, "0")).join("")}`.slice(0, 40);
}

/** Queue an action and try to send it straight away (it waits if there is no signal). */
export async function queue(userId: string, portal: AppPortal, kind: string, data: Record<string, unknown>, title: string) {
  const e: OutboxEntry = { clientId: newClientId(), kind, portal, at: new Date().toISOString(), data, title, userId, state: "WAITING", tries: 0 };
  await putEntry(e);
  void flush(userId);
  return e;
}

let flushing: Promise<{ sent: number; needsLogin: boolean }> | null = null;

/** Send what this person has waiting, oldest first, in small batches. Safe to call often (one run at a time). */
export function flush(userId: string): Promise<{ sent: number; needsLogin: boolean }> {
  if (flushing) return flushing;
  // The run is stored before it can finish: an early return (no signal) must not leave a finished run in place.
  const run = async (): Promise<{ sent: number; needsLogin: boolean }> => {
    let sent = 0;
    try {
      if (typeof navigator !== "undefined" && !navigator.onLine) return { sent, needsLogin: false };
      for (let round = 0; round < 20; round++) {
        const waiting = (await outbox()).filter((e) => e.userId === userId).filter((e) => e.state === "WAITING" || (e.state === "SENDING" && Date.now() - Date.parse(e.sentAt ?? e.at) > 120_000)).slice(0, 10);
        if (!waiting.length) break;
        for (const e of waiting) await putEntry({ ...e, state: "SENDING", sentAt: new Date().toISOString(), tries: e.tries + 1 });
        let res: Response;
        try {
          res = await fetch("/api/app/sync", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ops: waiting.map((e) => ({ clientId: e.clientId, kind: e.kind, portal: e.portal, at: e.at, data: e.data })) }) });
        } catch {
          for (const e of waiting) await putEntry({ ...e, state: "WAITING", tries: e.tries + 1 });
          return { sent, needsLogin: false };
        }
        if (res.status === 401) {
          for (const e of waiting) await putEntry({ ...e, state: "WAITING", tries: e.tries + 1 });
          await kvSet("needsLogin", true);
          return { sent, needsLogin: true };
        }
        if (!res.ok) { for (const e of waiting) await putEntry({ ...e, state: "WAITING", tries: e.tries + 1 }); break; }
        await kvDel("needsLogin");
        const { results } = (await res.json()) as { results: { clientId: string; status: string; result?: unknown; error?: string }[] };
        for (const e of waiting) {
          const r = results.find((x) => x.clientId === e.clientId);
          const state: OutboxState = !r || r.status === "BUSY" ? "WAITING" : (r.status as OutboxState);
          await putEntry({ ...e, state, result: r?.result, error: r?.error, tries: e.tries + 1 });
          if (state !== "WAITING") sent++;
        }
        if (results.some((r) => r.status === "BUSY")) break;
      }
      return { sent, needsLogin: false };
    } finally {
      changed();
    }
  };
  const p = run().finally(() => { if (flushing === p) flushing = null; });
  flushing = p;
  return p;
}

export type SnapshotMeta = { portal: AppPortal; at: string; userId: string };

/** Fetch the portal's data for offline use (and a few invoice PDFs into the phone's cache). */
export async function refreshSnapshot(portal: AppPortal, userId: string): Promise<boolean> {
  if (!navigator.onLine) return false;
  const res = await fetch(`/api/app/snapshot?portal=${portal}`, { cache: "no-store" }).catch(() => null);
  if (!res || !res.ok) return false;
  const snap = (await res.json()) as { user: { id: string }; at: string; settings: { documents: number }; buy?: { invoices: { pdf: string }[] } };
  if (snap.user.id !== userId) return false;
  await kvSet(`snap:${portal}`, snap);
  await kvSet("meta", { portal, at: snap.at, userId } satisfies SnapshotMeta);
  await kvSet("lastPortal", portal);
  const docs = snap.buy?.invoices.slice(0, snap.settings.documents).map((i) => i.pdf) ?? [];
  if (docs.length && "caches" in window) {
    const cache = await caches.open(DOCS);
    for (const url of docs) {
      if (await cache.match(url)) continue;
      const r = await fetch(url).catch(() => null);
      if (r?.ok) await cache.put(url, r);
      else await r?.body?.cancel().catch(() => {}); // not ready yet (e.g. still being issued): close it, try next time
    }
  }
  return true;
}

/**
 * The saved data (products, orders, route, pick lists, invoice PDFs) — removed on sign-out or when someone
 * else signs in. Actions not sent yet stay (only their author's session sends them); sent ones are cleared.
 */
export async function wipe() {
  try { await tx("kv", "readwrite", (s) => { s.clear(); }); } catch { /* not available */ }
  try { for (const e of await outbox()) if (e.state === "DONE") await tx("outbox", "readwrite", (s) => { s.delete(e.clientId); }); } catch { /* not available */ }
  try { if ("caches" in window) await caches.delete(DOCS); } catch { /* not available */ }
  changed();
}

export async function cachedDoc(url: string): Promise<string | null> {
  if (!("caches" in window)) return null;
  const r = await (await caches.open(DOCS)).match(url);
  return r ? URL.createObjectURL(await r.blob()) : null;
}

/** Make a phone photo small enough to keep and send (longest side ≤ 1280 px, JPEG). */
export async function shrinkPhoto(file: File, max = 1280): Promise<string> {
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas");
  c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
  c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", 0.8);
}
