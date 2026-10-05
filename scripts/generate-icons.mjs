/**
 * Generates the Chatter brand icons (run with `node scripts/generate-icons.mjs`).
 *
 * Outputs:
 *   public/icons/icon-192.png          manifest icon (any)
 *   public/icons/icon-512.png          manifest icon (any)
 *   public/icons/icon-maskable.png     512px, extra padding for Android adaptive icons
 *   src/app/apple-icon.png             180px, auto-linked by Next for iOS home screen
 *   src/app/favicon.ico                32/48px, auto-linked by Next for the browser tab
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * The Chatter mark: a bold "C" whose open mouth reads like a listening
 * speech bubble, with a message dot — on a rounded indigo→violet tile.
 * Drawn once on a 512 canvas; `padding` shrinks it into the maskable
 * icon "safe zone" (the central 80%).
 */
function artwork({ padding }) {
  const scale = (256 - padding) / 256;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
    <defs>
      <linearGradient id="tile" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#6366f1"/>
        <stop offset="1" stop-color="#7c3aed"/>
      </linearGradient>
    </defs>
    <rect width="512" height="512" rx="112" fill="url(#tile)"/>
    <g transform="translate(256 256) scale(${scale}) translate(-256 -256)">
      <path d="M350.5 158.2 A136 136 0 1 0 350.5 353.8"
        fill="none" stroke="#ffffff" stroke-width="76" stroke-linecap="round"/>
      <circle cx="402" cy="256" r="30" fill="#ffffff"/>
    </g>
  </svg>`;
}

const targets = [
  ["public/icons/icon-192.png", 192, artwork({ padding: 0 })],
  ["public/icons/icon-512.png", 512, artwork({ padding: 0 })],
  ["public/icons/icon-maskable.png", 512, artwork({ padding: 52 })],
  ["src/app/apple-icon.png", 180, artwork({ padding: 24 })],
];

for (const [file, size, svg] of targets) {
  const out = join(root, file);
  mkdirSync(dirname(out), { recursive: true });
  await sharp(Buffer.from(svg)).resize(size, size).png().toFile(out);
  console.log(`wrote ${file} (${size}x${size})`);
}

/** Wraps PNG buffers into a multi-resolution .ico (PNG-in-ICO, Vista+). */
function toIco(pngs) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(pngs.length, 4);

  let offset = 6 + 16 * pngs.length;
  const entries = pngs.map(({ size, buffer }) => {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size >= 256 ? 0 : size, 0); // width
    entry.writeUInt8(size >= 256 ? 0 : size, 1); // height
    entry.writeUInt8(0, 2); // palette colors
    entry.writeUInt8(0, 3); // reserved
    entry.writeUInt16LE(1, 4); // color planes
    entry.writeUInt16LE(32, 6); // bits per pixel
    entry.writeUInt32LE(buffer.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += buffer.length;
    return entry;
  });

  return Buffer.concat([header, ...entries, ...pngs.map((p) => p.buffer)]);
}

const faviconSvg = artwork({ padding: 0 });
const faviconPngs = [];
for (const size of [32, 48]) {
  const buffer = await sharp(Buffer.from(faviconSvg)).resize(size, size).png().toBuffer();
  faviconPngs.push({ size, buffer });
}
writeFileSync(join(root, "src/app/favicon.ico"), toIco(faviconPngs));
console.log("wrote src/app/favicon.ico (32, 48)");
