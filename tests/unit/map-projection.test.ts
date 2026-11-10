import { describe, expect, it } from "vitest";
import { fitProjection, smoothPath } from "@/lib/map-projection";

describe("map projection", () => {
  it("fits points inside the box, north up, keeping the aspect", () => {
    const pts = [{ lat: 38.70, lng: -9.20 }, { lat: 38.75, lng: -9.10 }, { lat: 38.72, lng: -9.15 }];
    const { project, empty } = fitProjection(pts, 800, 300, 20);
    expect(empty).toBe(false);
    for (const p of pts.map(project)) { expect(p.x).toBeGreaterThanOrEqual(19.9); expect(p.x).toBeLessThanOrEqual(780.1); expect(p.y).toBeGreaterThanOrEqual(19.9); expect(p.y).toBeLessThanOrEqual(280.1); }
    expect(project(pts[1]).y).toBeLessThan(project(pts[0]).y); // further north = higher up
    expect(project(pts[1]).x).toBeGreaterThan(project(pts[0]).x); // further east = right
  });
  it("handles no points / one point", () => {
    expect(fitProjection([], 100, 100).empty).toBe(true);
    const one = fitProjection([{ lat: 1, lng: 1 }], 100, 100);
    const p = one.project({ lat: 1, lng: 1 });
    expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true);
  });
  it("smooth path starts at the first and ends at the last point", () => {
    const d = smoothPath([{ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 20, y: 0 }]);
    expect(d.startsWith("M0.0,0.0")).toBe(true);
    expect(d.endsWith("L20.0,0.0")).toBe(true);
  });
});
