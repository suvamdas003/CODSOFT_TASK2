/**
 * Generates simple, license-free SVG placeholder images for the demo menu
 * into public/images/menu/. Run with: npm run images:generate
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { SEED_MENU } from "../prisma/menu-data";
import { slugify } from "../src/lib/utils";

const outDir = path.join(process.cwd(), "public", "images", "menu");
mkdirSync(outDir, { recursive: true });

function escapeXml(value: string) {
  return value.replace(/[<>&"']/g, (char) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[char] ?? char);
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter((word) => /^[A-Za-z]/.test(word))
    .slice(0, 2)
    .map((word) => word[0]!.toUpperCase())
    .join("");
}

function svg(name: string, [from, to]: [string, string]) {
  const label = escapeXml(initials(name));
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 480" role="img" aria-label="${escapeXml(name)}">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${from}"/>
      <stop offset="1" stop-color="${to}"/>
    </linearGradient>
  </defs>
  <rect width="640" height="480" fill="url(#g)"/>
  <circle cx="320" cy="240" r="150" fill="#ffffff" fill-opacity="0.16"/>
  <circle cx="320" cy="240" r="112" fill="#ffffff" fill-opacity="0.22"/>
  <text x="320" y="262" text-anchor="middle" font-family="Georgia, 'Times New Roman', serif" font-size="78" font-weight="700" fill="#ffffff" fill-opacity="0.95">${label}</text>
</svg>
`;
}

let count = 0;
for (const category of SEED_MENU) {
  for (const item of category.items) {
    writeFileSync(path.join(outDir, `${slugify(item.name)}.svg`), svg(item.name, category.color));
    count++;
  }
}
writeFileSync(path.join(outDir, "placeholder.svg"), svg("Dine Desk", ["#78716c", "#44403c"]));
console.log(`Generated ${count + 1} placeholder images in ${outDir}`);
