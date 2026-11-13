// Copies the prebuilt CesiumJS bundle (script, workers, assets, widgets CSS)
// from node_modules into public/cesium so the browser can load it directly.
// CesiumJS is loaded at runtime from /cesium/Cesium.js rather than bundled,
// which keeps Turbopack builds fast and avoids Cesium's worker-path quirks.
//
//   node scripts/copy-cesium-assets.mjs              always copy
//   node scripts/copy-cesium-assets.mjs --if-missing copy only when absent/outdated

import { cpSync, existsSync, readFileSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);

let cesiumPkg;
try {
  cesiumPkg = require.resolve("cesium/package.json", { paths: [root] });
} catch {
  console.warn("[cesium] package not installed yet — skipping asset copy");
  process.exit(0);
}

const { version } = JSON.parse(readFileSync(cesiumPkg, "utf8"));
const source = join(dirname(cesiumPkg), "Build", "Cesium");
const target = join(root, "public", "cesium");
const stamp = join(target, ".version");

if (process.argv.includes("--if-missing") && existsSync(stamp) && readFileSync(stamp, "utf8").trim() === version) {
  process.exit(0);
}

rmSync(target, { recursive: true, force: true });
mkdirSync(target, { recursive: true });
for (const entry of ["Cesium.js", "Workers", "Assets", "ThirdParty", "Widgets"]) {
  cpSync(join(source, entry), join(target, entry), { recursive: true });
}
writeFileSync(stamp, version);
console.log(`[cesium] copied CesiumJS ${version} assets to public/cesium`);
