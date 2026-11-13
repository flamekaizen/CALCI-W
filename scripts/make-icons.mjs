/**
 * Generates every raster icon from the SVG brand mark.
 *
 *   npm i --no-save sharp png-to-ico
 *   node scripts/make-icons.mjs [outDir]
 *
 * Outputs (default: public/icons): icon-{16..1024}.png, icon-512-maskable.png,
 * apple-touch-icon.png, og.png, icon.ico, android-foreground.png, icon.svg
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const require = (await import('node:module')).createRequire(import.meta.url);
const sharp = require(process.env.SHARP_PATH ?? 'sharp');
const pngToIco = (() => {
  try {
    return require(process.env.PNG_TO_ICO_PATH ?? 'png-to-ico');
  } catch {
    return null;
  }
})();

const out = resolve(process.argv[2] ?? 'public/icons');
mkdirSync(out, { recursive: true });

const GRAD = `<linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#6D66F6"/><stop offset="1" stop-color="#3A31C8"/></linearGradient>`;
const glyph = (scale, tx, ty, stroke = 2.3) =>
  `<g transform="translate(${tx} ${ty}) scale(${scale})" fill="none" stroke="#fff" stroke-linecap="round" stroke-linejoin="round" stroke-width="${stroke}">
     <path d="M4 15c2.5 0 3.5-9 7-9s3 12 9 12"/>
     <path d="M4 20h16" opacity="0.55"/>
   </g>`;

export const iconSvg = (size = 1024) => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 1024 1024">
  <defs>${GRAD}</defs>
  <rect x="32" y="32" width="960" height="960" rx="220" fill="url(#g)"/>
  <rect x="32" y="32" width="960" height="960" rx="220" fill="none" stroke="#000" stroke-opacity="0.08" stroke-width="4"/>
  ${glyph(25, 212, 180)}
</svg>`;

const maskableSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <defs>${GRAD}</defs>
  <rect width="1024" height="1024" fill="url(#g)"/>
  ${glyph(19, 284, 260)}
</svg>`;

// Android adaptive icon foreground: transparent, glyph inside the 66% safe zone
const foregroundSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">${glyph(17, 308, 290)}</svg>`;

const ogSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>${GRAD}<linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0E1117"/><stop offset="1" stop-color="#1A1840"/></linearGradient></defs>
  <rect width="1200" height="630" fill="url(#bg)"/>
  <g transform="translate(110 175) scale(0.27)"><rect x="32" y="32" width="960" height="960" rx="220" fill="url(#g)"/>${glyph(25, 212, 180)}</g>
  <text x="420" y="300" font-family="Segoe UI, Inter, Helvetica, Arial, sans-serif" font-size="104" font-weight="700" fill="#FFFFFF">Calci</text>
  <text x="424" y="372" font-family="Segoe UI, Inter, Helvetica, Arial, sans-serif" font-size="34" fill="#A7B0BF">Scientific · Graphing · 3D · Programmer · Matrix</text>
  <text x="424" y="420" font-family="Segoe UI, Inter, Helvetica, Arial, sans-serif" font-size="34" fill="#A7B0BF">Calculus · Statistics · Finance · Units · Code</text>
</svg>`;

const png = (svg, size, file) => sharp(Buffer.from(svg), { density: 300 }).resize(size, size).png().toFile(join(out, file));

writeFileSync(join(out, 'icon.svg'), iconSvg(512));
for (const s of [16, 32, 48, 64, 128, 180, 192, 256, 384, 512, 1024]) await png(iconSvg(), s, `icon-${s}.png`);
await sharp(Buffer.from(iconSvg()), { density: 300 }).resize(180, 180).flatten({ background: '#4F46E5' }).png().toFile(join(out, 'apple-touch-icon.png'));
await png(maskableSvg, 512, 'icon-512-maskable.png');
await png(maskableSvg, 1024, 'icon-1024-maskable.png');
await png(foregroundSvg, 1024, 'android-foreground.png');
await sharp(Buffer.from(ogSvg)).png().toFile(join(out, 'og.png'));
if (pngToIco) {
  const toIco = typeof pngToIco === "function" ? pngToIco : pngToIco.default;
  const ico = await toIco([16, 32, 48, 64, 128, 256].map((s) => join(out, `icon-${s}.png`)));
  writeFileSync(join(out, 'icon.ico'), ico);
}
console.log(`Icons written to ${out}`);
