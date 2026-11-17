/**
 * Phase 39: draws the app icons (public/icons/*.png) from one SVG with the installed Chromium.
 *   node scripts/app-icons.mjs
 * "any" icons are a rounded tile; "maskable" icons fill the square (the phone cuts its own shape)
 * with the letter inside the safe zone.
 */
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright");

const svg = (size, maskable) => {
  const r = maskable ? 0 : size * 0.22;
  const fs = size * (maskable ? 0.42 : 0.56);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#3b6cf6"/><stop offset="1" stop-color="#8b4ff0"/></linearGradient>
  <radialGradient id="h" cx="0.25" cy="0.15" r="0.9"><stop offset="0" stop-color="#ffffff" stop-opacity="0.35"/><stop offset="0.6" stop-color="#ffffff" stop-opacity="0"/></radialGradient></defs>
  <rect width="${size}" height="${size}" rx="${r}" fill="url(#g)"/><rect width="${size}" height="${size}" rx="${r}" fill="url(#h)"/>
  <text x="50%" y="50%" dy="0.36em" text-anchor="middle" font-family="Inter, Segoe UI, Arial, sans-serif" font-weight="800" font-size="${fs}" fill="#ffffff">F</text></svg>`;
};
const out = [["icon-192.png", 192, false], ["icon-512.png", 512, false], ["maskable-192.png", 192, true], ["maskable-512.png", 512, true], ["apple-touch-icon.png", 180, true], ["badge-96.png", 96, false]];
const browser = await chromium.launch();
const page = await browser.newPage();
for (const [name, size, maskable] of out) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0;background:transparent">${svg(size, maskable)}</body></html>`);
  await page.locator("svg").screenshot({ path: `public/icons/${name}`, omitBackground: true });
  console.log("public/icons/" + name);
}
await browser.close();
