import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getDatabase, sha256 } from "./database.mjs";
import { importDatasetBuffer } from "./dataset-importer.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = path.resolve(process.argv[2] || path.join(root, ".data", "derived", "mimic-hosp-bp-pilot-100.zip"));
const buffer = readFileSync(sourcePath);
const db = getDatabase(root);
const sourceHash = sha256(buffer);
const existing = db.prepare("SELECT id, name, valid_count, quarantined_count FROM datasets WHERE source_sha256 = ? LIMIT 1").get(sourceHash);

if (existing) {
  db.prepare("UPDATE datasets SET status = 'Approved', visibility = 'shared' WHERE id = ?").run(existing.id);
  console.log(JSON.stringify({ reused: true, ...existing, sourceHash }, null, 2));
  process.exit(0);
}

const admin = db.prepare("SELECT id FROM users WHERE role = 'admin' LIMIT 1").get();
if (!admin) throw new Error("Local Admin account is missing.");
const result = importDatasetBuffer({
  db,
  root,
  ownerId: admin.id,
  fileName: path.basename(sourcePath),
  buffer,
  name: "MIMIC-IV HOSP Chronic BP Pilot",
  description: "Local-only de-identified real-world pilot. Ten observed BP dates per case; missing labs and medications remain explicitly unavailable. Visit 10 is a withheld future measurement.",
  status: "Approved",
  visibility: "shared",
});
console.log(JSON.stringify({ reused: false, ...result }, null, 2));
