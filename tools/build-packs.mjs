/**
 * Build the module's compendium packs.
 *
 * Writes source JSON to packs/_source/<pack>/ (one file per document) and
 * compiles each into a Foundry LevelDB pack at packs/<pack>/ with the official
 * Foundry CLI. Mirrors the acks-formation / acks-henchmen / acks-monsters
 * harness (candidate for promotion to a shared acks-lib — see docs/MODEL.md §6).
 *
 * Usage:  npm install && npm run build:packs
 */
import { compilePack } from "@foundryvtt/foundryvtt-cli";
import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import { buildMacros, buildProficiencies, buildSamples } from "./pack-data.mjs";

const ROOT = path.dirname(path.dirname(url.fileURLToPath(import.meta.url)));

async function buildPack(packName, docs) {
  // Skip packs with no documents yet (added in later phases) so the release
  // workflow's "verify every declared pack exists" step only sees populated
  // packs — declare a pack in module.json only once it has content.
  if (!docs.length) {
    console.log(`Skipped empty pack "${packName}" (no documents yet).`);
    return;
  }
  const srcDir = path.join(ROOT, "packs", "_source", packName);
  const dbDir = path.join(ROOT, "packs", packName);

  fs.mkdirSync(srcDir, { recursive: true });
  for (const f of fs.readdirSync(srcDir).filter((f) => f.endsWith(".json"))) fs.rmSync(path.join(srcDir, f));
  for (const doc of docs) {
    const slug = doc.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
    fs.writeFileSync(path.join(srcDir, `${slug}.json`), JSON.stringify(doc, null, 2) + "\n");
  }

  fs.rmSync(dbDir, { recursive: true, force: true });
  await compilePack(srcDir, dbDir, { recursive: false, log: false });
  console.log(`Built pack "${packName}": ${docs.length} document(s) -> ${dbDir}`);
}

await buildPack("equipment-proficiencies", buildProficiencies());
await buildPack("equipment-samples", buildSamples());
await buildPack("macros", buildMacros());
