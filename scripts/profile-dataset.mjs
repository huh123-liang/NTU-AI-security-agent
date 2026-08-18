import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { strFromU8, unzipSync } from "fflate";

const source = resolve(process.argv[2] || "data-source/data500_v5_Pat1to500.zip");
const archive = unzipSync(new Uint8Array(readFileSync(source)));
const names = Object.keys(archive).filter((name) => !name.startsWith("__MACOSX/") && !name.endsWith("/"));
const manifestName = names.find((name) => /(?:^|\/)manifest\.csv$/i.test(name));
const manifestRows = manifestName ? strFromU8(archive[manifestName]).trim().split(/\r?\n/).slice(1).filter(Boolean) : [];
const patientFiles = names.filter((name) => /(?:^|\/)patients\/[^/]+\.json$/i.test(name));
let valid = 0; let invalid = 0; let tenVisits = 0;
for (const name of patientFiles) {
  try {
    const patient = JSON.parse(strFromU8(archive[name]));
    valid += 1;
    if (Array.isArray(patient.visits) && patient.visits.length === 10) tenVisits += 1;
  } catch { invalid += 1; }
}
const declared = manifestRows.length;
console.log(JSON.stringify({ source, declared, patientFilesPresent: patientFiles.length, validJson: valid, invalidJson: invalid, validTenVisitRecords: tenVisits, missingFromManifest: Math.max(0, declared - patientFiles.length) }, null, 2));
