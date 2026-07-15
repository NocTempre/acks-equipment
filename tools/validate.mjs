/**
 * Pre-release validation (run by the release workflow): JS syntax of all
 * scripts/tools, Handlebars template compilation (parse errors otherwise only
 * surface at render time in Foundry), JSON validity, and pack-source document
 * invariants (16-char alphanumeric _id, matching _key, unique ids).
 *
 * Usage:  npm run validate
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import Handlebars from "handlebars";
import { buildMacros, buildProficiencies, buildSamples } from "./pack-data.mjs";

const ROOT = path.dirname(path.dirname(url.fileURLToPath(import.meta.url)));
let failed = false;
const fail = (file, message) => {
  console.error(`FAIL ${file}: ${message}`);
  failed = true;
};

// 1. JS syntax of every script/tool module.
for (const dir of ["scripts", "tools"]) {
  for (const file of fs.readdirSync(path.join(ROOT, dir)).filter((f) => f.endsWith(".mjs"))) {
    const full = path.join(ROOT, dir, file);
    try {
      execFileSync(process.execPath, ["--check", full], { stdio: "pipe" });
    } catch (err) {
      fail(`${dir}/${file}`, String(err.stderr ?? err.message).trim().split("\n")[0]);
    }
  }
}

// 2. Handlebars templates precompile.
const tplDir = path.join(ROOT, "templates");
if (fs.existsSync(tplDir)) {
  for (const file of fs.readdirSync(tplDir).filter((f) => f.endsWith(".hbs"))) {
    try {
      Handlebars.precompile(fs.readFileSync(path.join(tplDir, file), "utf8"));
    } catch (err) {
      fail(`templates/${file}`, err.message.split("\n").slice(0, 2).join(" "));
    }
  }
}

// 3. JSON validity.
for (const file of ["module.json", "lang/en.json", "package.json"]) {
  try {
    JSON.parse(fs.readFileSync(path.join(ROOT, file), "utf8"));
  } catch (err) {
    fail(file, err.message);
  }
}

// 4. Pack-source document invariants.
const ID_RE = /^[A-Za-z0-9]{16}$/;
function checkPack(label, docs) {
  const ids = new Set();
  for (const doc of docs) {
    if (!ID_RE.test(doc._id)) fail(label, `"${doc.name}": _id "${doc._id}" is not 16 alphanumerics`);
    if (!doc._key?.endsWith(doc._id)) fail(label, `"${doc.name}": _key does not end with _id`);
    if (ids.has(doc._id)) fail(label, `"${doc.name}": duplicate _id ${doc._id}`);
    ids.add(doc._id);
  }
}
checkPack("equipment-proficiencies", buildProficiencies());
checkPack("equipment-samples", buildSamples());
checkPack("macros", buildMacros());

if (failed) process.exit(1);
console.log("validate: scripts, templates, JSON, and pack sources OK");
