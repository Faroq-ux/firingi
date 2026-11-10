/** Fit lat/lng points into an SVG box (equirectangular, corrected for latitude; pure). */
export type LL = { lat: number; lng: number };

export function fitProjection(points: LL[], width: number, height: number, pad = 24) {
  const ok = points.filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));
  if (!ok.length) return { project: () => ({ x: width / 2, y: height / 2 }), empty: true };
  const midLat = ok.reduce((a, p) => a + p.lat, 0) / ok.length;
  const k = Math.cos((midLat * Math.PI) / 180) || 1; // shrink longitude away from the equator
  const xs = ok.map((p) => p.lng * k), ys = ok.map((p) => p.lat);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const spanX = Math.max(maxX - minX, 0.01), spanY = Math.max(maxY - minY, 0.01);
  const scale = Math.min((width - pad * 2) / spanX, (height - pad * 2) / spanY);
  const offX = (width - spanX * scale) / 2, offY = (height - spanY * scale) / 2;
  return {
    empty: false,
    project: (p: LL) => ({ x: offX + (p.lng * k - minX) * scale, y: height - (offY + (p.lat - minY) * scale) }),
  };
}

/** Smooth path through points (quadratic midpoints). */
export function smoothPath(pts: { x: number; y: number }[]) {
  if (!pts.length) return "";
  if (pts.length === 1) return `M${pts[0].x.toFixed(1)},${pts[0].y.toFixed(1)}`;
  let d = `M${pts[0].x.toFixed(1)},${pts[0].y.toFixed(1)}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const mx = (pts[i].x + pts[i + 1].x) / 2, my = (pts[i].y + pts[i + 1].y) / 2;
    d += ` Q${pts[i].x.toFixed(1)},${pts[i].y.toFixed(1)} ${mx.toFixed(1)},${my.toFixed(1)}`;
  }
  const l = pts[pts.length - 1];
  return `${d} L${l.x.toFixed(1)},${l.y.toFixed(1)}`;
}
