import { describe, expect, it } from "vitest";
import { arrivals, haversineKm, isValidOrder, mapsLink, optimiseOrder, routeKm, routeMinutes, sweepGroups, type PlanStop } from "@/server/delivery/routing";

const P = { avgSpeedKmh: 30, roadFactor: 1.3, pickupMinutes: 5, dropMinutes: 8 };
const lisbon = { lat: 38.7223, lng: -9.1393 };
const stop = (deliveryId: string, kind: "PICKUP" | "DROP", lat: number, lng: number): PlanStop => ({ key: `${deliveryId}-${kind}`, deliveryId, kind, at: { lat, lng } });

describe("routing", () => {
  it("distances", () => {
    expect(haversineKm(lisbon, { lat: 41.1579, lng: -8.6291 })).toBeGreaterThan(270);
    expect(haversineKm(lisbon, { lat: 41.1579, lng: -8.6291 })).toBeLessThan(280);
    expect(routeKm(lisbon, [], P)).toBe(0);
  });

  it("pickup always before its drop", () => {
    expect(isValidOrder([stop("a", "DROP", 0, 0), stop("a", "PICKUP", 0, 0)])).toBe(false);
    expect(isValidOrder([stop("a", "PICKUP", 0, 0), stop("a", "DROP", 0, 0)])).toBe(true);
    expect(isValidOrder([stop("b", "DROP", 0, 0)])).toBe(true); // already collected
  });

  it("optimised order is valid and not longer than the given order", () => {
    // depot in Lisbon, pickups in Lisbon/Almada, drops spread around
    const stops = [
      stop("1", "DROP", 38.80, -9.38), stop("2", "DROP", 38.70, -9.42), stop("1", "PICKUP", 38.73, -9.14),
      stop("3", "PICKUP", 38.68, -9.16), stop("3", "DROP", 38.64, -9.10), stop("2", "PICKUP", 38.73, -9.14),
      stop("4", "DROP", 38.76, -9.10),
    ];
    const best = optimiseOrder(lisbon, stops, P);
    expect(best).toHaveLength(stops.length);
    expect(isValidOrder(best)).toBe(true);
    const given = [...stops].sort((a, b) => (a.kind === b.kind ? 0 : a.kind === "PICKUP" ? -1 : 1));
    expect(routeKm(lisbon, best, P)).toBeLessThanOrEqual(routeKm(lisbon, given, P) + 1e-9);
  });

  it("arrival times add driving and service time; done stops keep their time", () => {
    const s = [stop("a", "PICKUP", 38.7223, -9.1393), stop("a", "DROP", 38.7223, -9.0393)];
    const t0 = new Date("2026-11-10T08:00:00Z");
    const a = arrivals(lisbon, t0, s, P);
    expect(a[0].at.getTime()).toBe(t0.getTime()); // same place
    const km = haversineKm(s[0].at!, s[1].at!) * 1.3;
    expect(Math.abs(a[1].at.getTime() - (t0.getTime() + 5 * 60_000 + (km / 30) * 3600_000))).toBeLessThan(2);
    expect(routeMinutes(lisbon, s, P)).toBe(Math.round((km / 30) * 60 + 13));
    const done = new Date("2026-11-10T09:00:00Z");
    expect(arrivals(lisbon, t0, [{ ...s[0], doneAt: done }, s[1]], P)[1].at.getTime()).toBeGreaterThan(done.getTime());
  });

  it("sweep uses as few routes as possible, split by direction", () => {
    const items = [
      { id: "n1", drop: { lat: 38.82, lng: -9.14 } }, { id: "n2", drop: { lat: 38.83, lng: -9.13 } },
      { id: "s1", drop: { lat: 38.62, lng: -9.14 } }, { id: "s2", drop: { lat: 38.61, lng: -9.15 } },
      { id: "x", drop: null },
    ];
    expect(sweepGroups(lisbon, items, 4, 10)).toHaveLength(1); // as few routes as possible
    const g = sweepGroups(lisbon, items, 2, 3);
    expect(g).toHaveLength(2);
    expect(g.flat().map((i) => i.id).sort()).toEqual(["n1", "n2", "s1", "s2", "x"]);
    const north = g.find((x) => x.some((i) => i.id === "n1"))!;
    expect(north.some((i) => i.id === "n2")).toBe(true);
    expect(north.some((i) => i.id === "s1")).toBe(false);
    expect(sweepGroups(lisbon, items, 5, 2).every((x) => x.length <= 2)).toBe(true);
  });

  it("maps link", () => {
    expect(mapsLink([])).toBeNull();
    expect(mapsLink([{ lat: 1, lng: 2, address: "a" }, { lat: null, lng: null, address: "Rua X, Lisboa" }])).toBe(
      "https://www.google.com/maps/dir/?api=1&travelmode=driving&destination=Rua%20X%2C%20Lisboa&waypoints=1%2C2",
    );
  });
});
