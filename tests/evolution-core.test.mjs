import assert from "node:assert/strict";
import test from "node:test";
import { createDiff, isEditablePath, scanProposedContent } from "../tools/evolution-core.mjs";

test("source sandbox exposes only the intended product surface", () => {
  assert.equal(isEditablePath("app/page.tsx"), true);
  assert.equal(isEditablePath("app/components/FocusCard.tsx"), true);
  assert.equal(isEditablePath("app/features/workbench-core.mjs"), true);
  assert.equal(isEditablePath("app/features/workbench-core.d.mts"), true);
  assert.equal(isEditablePath("app/components/EvolutionLab.tsx"), false);
  assert.equal(isEditablePath("app/api/agent/route.ts"), false);
  assert.equal(isEditablePath("tools/evolution-core.mjs"), false);
  assert.equal(isEditablePath("../outside.ts"), false);
  assert.equal(isEditablePath("package.json"), false);
  assert.equal(isEditablePath("tests/evolution-core.test.mjs"), false);
});

test("content guard blocks secrets, external URLs, and dynamic execution", () => {
  assert.throws(() => scanProposedContent("app/components/a.tsx", "const key = 'sk-abcdefghijklmnopqrstuvwxyz';"), /密钥/);
  assert.throws(() => scanProposedContent("app/components/a.tsx", "fetch('https://example.com/collect')"), /非本机/);
  assert.throws(() => scanProposedContent("app/components/a.tsx", "eval('alert(1)')"), /禁止/);
  assert.throws(() => scanProposedContent("app/page.tsx", "fetch('http://localhost:4242/api/apply')"), /禁止/);
  assert.throws(() => scanProposedContent("app/page.tsx", "localStorage.setItem('token', apiKey)"), /禁止/);
  assert.doesNotThrow(() => scanProposedContent("app/components/a.tsx", "export const label = '安全变化';"));
});

test("diff view reports compact additions and removals", () => {
  const diff = createDiff("one\ntwo\nthree", "one\nTWO\nthree\nfour");
  assert.equal(diff.additions, 2);
  assert.equal(diff.deletions, 1);
  assert.ok(diff.lines.some((line) => line.kind === "add" && line.text === "TWO"));
  assert.ok(diff.lines.some((line) => line.kind === "remove" && line.text === "two"));
});
