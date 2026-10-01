/**
 * Generates the PWA icons for Chatter (run once with `node scripts/generate-icons.mjs`).
 *
 * Outputs:
 *   public/icons/icon-192.png          manifest icon (any)
 *   public/icons/icon-512.png          manifest icon (any)
 *   public/icons/icon-maskable.png     512px, extra padding for Android adaptive icons
 *   src/app/apple-icon.png             180px, auto-linked by Next for iOS home screen
 */
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Speech-bubble glyph, drawn once on a 512 canvas. */
function artwork({ padding }) {
  // padding shrinks the glyph into the maskable "safe zone" (central 80%).
  const scale = (256 - padding) / 160;
  const glyph = `
    <g transform="translate(256 256) scale(${scale}) translate(-256 -256)">
      <path fill="#ffffff"
        d="M112 112h288a48 48 0 0 1 48 48v136a48 48 0 0 1-48 48H232l-96 72v-72h-24a48 48 0 0 1-48-48V160a48 48 0 0 1 48-48z"/>
      <circle cx="176" cy="228" r="24" fill="#4f46e5"/>
      <circle cx="256" cy="228" r="24" fill="#4f46e5"/>
      <circle cx="336" cy="228" r="24" fill="#4f46e5"/>
    </g>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
    <rect width="512" height="512" fill="#4f46e5"/>
    ${glyph}
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
