/**
 * Route planning maths (pure, no database).
 *   • Distance: great-circle distance × a road factor (no external routing service needed;
 *     a road-network provider can replace `legKm` later).
 *   • Order: nearest-neighbour start, then "relocate" improvement — every stop is tried at every
 *     position — always keeping each delivery's PICKUP before its DROP.
 *   • Time: driving at the average speed + a service time per stop.
 *   • Splitting work between drivers: sweep by angle around the depot into balanced groups.
 */

export type LatLng = { lat: number; lng: number };
export type PlanStop = { key: string; deliveryId: string; kind: "PICKUP" | "DROP"; at: LatLng | null };
export type RoutingParams = { avgSpeedKmh: number; roadFactor: number; pickupMinutes: number; dropMinutes: number };

const R = 6371;
export function haversineKm(a: LatLng, b: LatLng) {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Road distance estimate; unknown coordinates count as 0 (flagged elsewhere). */
export function legKm(a: LatLng | null, b: LatLng | null, p: Pick<RoutingParams, "roadFactor">) {
  return a && b ? haversineKm(a, b) * p.roadFactor : 0;
}

/** Each DROP comes after the PICKUP of the same delivery (if that pickup is on the route). */
export function isValidOrder(stops: PlanStop[]) {
  const seen = new Set<string>();
  const pickups = new Set(stops.filter((s) => s.kind === "PICKUP").map((s) => s.deliveryId));
  for (const s of stops) {
    if (s.kind === "PICKUP") seen.add(s.deliveryId);
    else if (pickups.has(s.deliveryId) && !seen.has(s.deliveryId)) return false;
  }
  return true;
}

export function routeKm(start: LatLng | null, stops: PlanStop[], p: Pick<RoutingParams, "roadFactor">) {
  let km = 0, at = start;
  for (const s of stops) { km += legKm(at, s.at, p); at = s.at ?? at; }
  return km;
}

/** Shortest order found (nearest neighbour + relocate moves), respecting pickup-before-drop. */
export function optimiseOrder(start: LatLng | null, stops: PlanStop[], p: Pick<RoutingParams, "roadFactor">): PlanStop[] {
  if (stops.length < 2) return [...stops];
  // nearest neighbour over the stops that are allowed next
  const left = [...stops];
  const order: PlanStop[] = [];
  const picked = new Set<string>();
  const pickups = new Set(stops.filter((s) => s.kind === "PICKUP").map((s) => s.deliveryId));
  let at = start;
  while (left.length) {
    let best = -1, bestKm = Infinity;
    left.forEach((s, i) => {
      if (s.kind === "DROP" && pickups.has(s.deliveryId) && !picked.has(s.deliveryId)) return;
      const km = legKm(at, s.at, p);
      if (km < bestKm) { bestKm = km; best = i; }
    });
    const [s] = left.splice(best, 1);
    if (s.kind === "PICKUP") picked.add(s.deliveryId);
    order.push(s);
    at = s.at ?? at;
  }
  // relocate improvement
  let current = routeKm(start, order, p);
  for (let pass = 0, improved = true; improved && pass < 20; pass++) {
    improved = false;
    for (let i = 0; i < order.length; i++) {
      for (let j = 0; j < order.length; j++) {
        if (i === j) continue;
        const cand = [...order];
        const [s] = cand.splice(i, 1);
        cand.splice(j, 0, s);
        if (!isValidOrder(cand)) continue;
        const km = routeKm(start, cand, p);
        if (km < current - 1e-6) { order.splice(0, order.length, ...cand); current = km; improved = true; }
      }
    }
  }
  return order;
}

/** Arrival time at each stop, starting at `startAt` from `start`. Done stops keep their time. */
export function arrivals(start: LatLng | null, startAt: Date, stops: (PlanStop & { doneAt?: Date | null })[], p: RoutingParams) {
  let t = startAt.getTime(), at = start;
  return stops.map((s) => {
    if (s.doneAt) { t = Math.max(t, s.doneAt.getTime()); at = s.at ?? at; return { key: s.key, at: s.doneAt }; }
    t += (legKm(at, s.at, p) / p.avgSpeedKmh) * 3600_000;
    const arrival = new Date(t);
    t += (s.kind === "PICKUP" ? p.pickupMinutes : p.dropMinutes) * 60_000;
    at = s.at ?? at;
    return { key: s.key, at: arrival };
  });
}

export function routeMinutes(start: LatLng | null, stops: PlanStop[], p: RoutingParams) {
  const km = routeKm(start, stops, p);
  const service = stops.reduce((a, s) => a + (s.kind === "PICKUP" ? p.pickupMinutes : p.dropMinutes), 0);
  return Math.round((km / p.avgSpeedKmh) * 60 + service);
}

/**
 * Split deliveries (by drop location) into `groups` balanced groups by angle around the depot,
 * each at most `maxPerGroup` deliveries. Deliveries without coordinates go to the smallest group.
 */
export function sweepGroups<T extends { id: string; drop: LatLng | null }>(depot: LatLng | null, items: T[], groups: number, maxPerGroup: number): T[][] {
  if (!items.length || groups < 1) return [];
  const centre = depot ?? avg(items.map((i) => i.drop).filter(Boolean) as LatLng[]);
  const located = items.filter((i) => i.drop);
  const unknown = items.filter((i) => !i.drop);
  const angle = (x: LatLng) => Math.atan2(x.lat - (centre?.lat ?? 0), x.lng - (centre?.lng ?? 0));
  located.sort((a, b) => angle(a.drop!) - angle(b.drop!));
  const n = Math.min(groups, Math.max(1, Math.ceil(items.length / Math.max(1, maxPerGroup))));
  const size = Math.min(maxPerGroup, Math.max(1, Math.ceil(located.length / n)));
  const out: T[][] = Array.from({ length: n }, () => []);
  let g = 0;
  for (const it of located) {
    while (g < n - 1 && out[g].length >= size) g++;
    if (out[g].length >= maxPerGroup) break;
    out[g].push(it);
  }
  for (const it of unknown) {
    const smallest = out.reduce((m, x) => (x.length < m.length ? x : m), out[0]);
    if (smallest.length < maxPerGroup) smallest.push(it);
  }
  return out.filter((x) => x.length);
}

function avg(points: LatLng[]): LatLng | null {
  if (!points.length) return null;
  return { lat: points.reduce((a, p) => a + p.lat, 0) / points.length, lng: points.reduce((a, p) => a + p.lng, 0) / points.length };
}

/** Google Maps directions link through the remaining stops (max 9 waypoints per link). */
export function mapsLink(stops: { lat: number | null; lng: number | null; address: string }[]) {
  const pts = stops.slice(0, 10).map((s) => (s.lat !== null && s.lng !== null ? `${s.lat},${s.lng}` : s.address));
  if (!pts.length) return null;
  const dest = pts[pts.length - 1];
  const way = pts.slice(0, -1);
  return `https://www.google.com/maps/dir/?api=1&travelmode=driving&destination=${encodeURIComponent(dest)}${way.length ? `&waypoints=${encodeURIComponent(way.join("|"))}` : ""}`;
}
