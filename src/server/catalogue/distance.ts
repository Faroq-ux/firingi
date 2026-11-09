/** Great-circle distance (pure). Straight-line km; road distance comes with route optimisation. */
export type LatLng = { lat: number; lng: number };

export function haversineKm(a: LatLng, b: LatLng): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Nearest of several points (e.g. a vendor's warehouses / pickup points). */
export function nearestKm(from: LatLng | null, points: LatLng[]): number | null {
  if (!from || points.length === 0) return null;
  return Math.min(...points.map((p) => haversineKm(from, p)));
}

/** Sort by distance (unknown distances last, then by name). */
export function byDistance<T extends { distanceKm: number | null; name: string }>(a: T, b: T) {
  if (a.distanceKm === null && b.distanceKm === null) return a.name.localeCompare(b.name);
  if (a.distanceKm === null) return 1;
  if (b.distanceKm === null) return -1;
  return a.distanceKm - b.distanceKm;
}
