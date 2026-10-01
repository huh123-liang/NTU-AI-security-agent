import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const currentGuides = [
  "README.md", "项目指南.md", "PROJECT_STATUS_FOR_CLAUDE.md", "docs/README.md",
  "docs/getting-started/README.md", "docs/architecture/README.md", "docs/project/STATUS.md",
  "docs/reference/engineering-details.md", "src/README.md", "scripts/README.md",
  "worker/README.md", "db/README.md", "tests/README.md", "samples/README.md",
];

test("current repository guides have resolvable local navigation and no private-file links", () => {
  let checked = 0;
  for (const file of currentGuides) {
    const fullPath = resolve(root, file);
    assert.ok(existsSync(fullPath), `${file} exists`);
    const content = readFileSync(fullPath, "utf8");
    for (const match of content.matchAll(/!?\[[^\]\n]*\]\(([^)\n]+)\)/g)) {
      const href = match[1];
      if (/^(https?:|mailto:|#)/i.test(href)) continue;
      const localPath = decodeURIComponent(href.split("#")[0]);
      const target = resolve(dirname(fullPath), localPath);
      const fromRoot = relative(root, target);
      assert.ok(!isAbsolute(fromRoot) && fromRoot !== ".." && !fromRoot.startsWith("..\\") && !fromRoot.startsWith("../"), `${file}: link stays inside repository: ${href}`);
      assert.ok(!/(^|[\\/])(\.data|\.runtime)([\\/]|$)|(^|[\\/])\.env(?:\.|$)/.test(fromRoot), `${file}: no private runtime links: ${href}`);
      assert.ok(existsSync(target), `${file}: target exists: ${href}`);
      checked++;
    }
  }
  assert.ok(checked >= 80, `expected comprehensive navigation; checked ${checked}`);
});

test("repository navigation preserves active local launchers and labels historical guidance", () => {
  for (const file of ["First-Time-Setup.cmd", "首次安装向导.cmd", "Start-Platform.cmd", "一键启动-AI医疗评估平台.cmd", "Stop-Platform.cmd", "scripts/serve.mjs", "scripts/local-api.mjs", "db/schema.sql", "worker/index.js", "scripts/prepare-sites-build.mjs"]) {
    assert.ok(existsSync(resolve(root, file)), `stable entry point: ${file}`);
  }
  assert.match(readFileSync(resolve(root, "docs/archive/project-guide-2026-09-15.md"), "utf8"), /历史快照/);
  assert.match(readFileSync(resolve(root, "docs/archive/claude-handoff-2026-09-15.md"), "utf8"), /Archived snapshot/);
  assert.match(readFileSync(resolve(root, "README.md"), "utf8"), /not a hosted website/);
});
