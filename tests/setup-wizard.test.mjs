import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");

test("the Windows first-time setup flow is present and keeps secrets local", () => {
  const requiredFiles = [
    "First-Time-Setup.cmd",
    "首次安装向导.cmd",
    "scripts/first-time-setup.ps1",
    ".env.example",
  ];
  for (const file of requiredFiles) assert.equal(existsSync(resolve(root, file)), true, `${file} is required`);

  const script = readFileSync(resolve(root, "scripts/first-time-setup.ps1"), "utf8");
  assert.match(script, /Read-Host \$Prompt -AsSecureString/);
  assert.match(script, /\.env\.local/);
  assert.match(script, /New-Object Text\.UTF8Encoding\(\$false\)/);
  assert.match(script, /npm install|& \$NpmExe install/);
  assert.match(script, /& \$NpmExe run build/);
  assert.match(script, /& \$NpmExe test/);
  assert.doesNotMatch(script, /Write-Host\s+\$ApiKey/);

  for (const launcher of ["Start-Platform.cmd", "一键启动-AI医疗评估平台.cmd"]) {
    const content = readFileSync(resolve(root, launcher), "utf8");
    assert.match(content, /first-time-setup\.ps1/i);
    assert.match(content, /node_modules/i);
    assert.match(content, /\.env\.local/i);
  }
});
