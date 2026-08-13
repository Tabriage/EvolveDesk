import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import {
  createDiff,
  createIsolatedProposalCommit,
  hashContent,
  isEditablePath,
  mapPullRequestState,
  parseGitHubRemote,
  proposalBranchName,
  scanProposedContent,
} from "../tools/evolution-core.mjs";

const execFileAsync = promisify(execFile);

async function git(root, args) {
  const { stdout } = await execFileAsync("git", args, { cwd: root });
  return stdout.trim();
}

test("source sandbox exposes only the intended product surface", () => {
  assert.equal(isEditablePath("app/page.tsx"), true);
  assert.equal(isEditablePath("app/components/FocusCard.tsx"), true);
  assert.equal(isEditablePath("app/features/workbench-core.mjs"), true);
  assert.equal(isEditablePath("app/features/workbench-core.d.mts"), true);
  assert.equal(isEditablePath("app/components/EvolutionLab.tsx"), false);
  assert.equal(isEditablePath("app/api/agent/route.ts"), false);
  assert.equal(isEditablePath("tools/evolution-core.mjs"), false);
  assert.equal(isEditablePath("../outside.ts"), false);
  assert.equal(isEditablePath("app/components/bad name.tsx"), false);
  assert.equal(isEditablePath("package.json"), false);
  assert.equal(isEditablePath("tests/evolution-core.test.mjs"), false);
});

test("proposal Git helpers keep branch names and GitHub review states bounded", () => {
  assert.equal(proposalBranchName("12345678-1234-4abc-8def-1234567890ab"), "evolve/proposal-123456781234");
  assert.throws(() => proposalBranchName("short"), /无效/);
  assert.throws(() => proposalBranchName("1234567812344abc8def1234567890ab"), /无效/);
  assert.deepEqual(parseGitHubRemote("git@github.com:Tabriage/EvolveDesk.git"), {
    owner: "Tabriage",
    repository: "EvolveDesk",
    slug: "Tabriage/EvolveDesk",
  });
  assert.equal(parseGitHubRemote("https://example.com/owner/repo.git"), null);
  assert.equal(parseGitHubRemote("https://github.com/Tabriage/EvolveDesk.git")?.slug, "Tabriage/EvolveDesk");
  assert.equal(mapPullRequestState({ state: "OPEN", isDraft: true }), "draft");
  assert.equal(mapPullRequestState({ state: "OPEN", isDraft: false }), "open");
  assert.equal(mapPullRequestState({ state: "CLOSED", mergedAt: "2026-08-14T00:00:00.000Z" }), "merged");
});

test("proposal commit is validated and committed on an isolated branch", async () => {
  const root = await mkdtemp(join(tmpdir(), "evolve-proposal-git-"));
  try {
    await mkdir(join(root, "app/components"), { recursive: true });
    const original = "export const label = 'before';\n";
    const proposed = "export const label = 'after';\n";
    await writeFile(join(root, ".gitignore"), "/.evolve/\n");
    await writeFile(join(root, "app/components/Demo.tsx"), original);
    await git(root, ["init", "-b", "feature/base"]);
    await git(root, ["config", "user.name", "Evolution Test"]);
    await git(root, ["config", "user.email", "evolution@example.test"]);
    await git(root, ["add", ".gitignore", "app/components/Demo.tsx"]);
    await git(root, ["commit", "-m", "base"]);
    const baseSha = await git(root, ["rev-parse", "HEAD"]);
    const proposal = {
      id: "12345678-1234-4abc-8def-1234567890ab",
      title: "调整演示标签",
      status: "proposed",
      baseSha,
      baseBranch: "feature/base",
      files: [{
        path: "app/components/Demo.tsx",
        originalContent: original,
        originalHash: hashContent(original),
        proposedContent: proposed,
        proposedHash: hashContent(proposed),
      }],
    };

    const result = await createIsolatedProposalCommit(proposal, {
      root,
      validate: async (worktree) => {
        assert.equal(await readFile(join(worktree, "app/components/Demo.tsx"), "utf8"), proposed);
        return { status: "passed", summary: "fixture passed", output: "ok" };
      },
    });

    assert.equal(result.validation.status, "passed");
    assert.equal(result.branch.name, "evolve/proposal-123456781234");
    assert.equal(await readFile(join(root, "app/components/Demo.tsx"), "utf8"), original);
    assert.equal(await git(root, ["symbolic-ref", "--short", "HEAD"]), "feature/base");
    assert.equal(await git(root, ["status", "--porcelain=v1"]), "");
    assert.equal(await git(root, ["show", `${result.branch.name}:app/components/Demo.tsx`]), proposed.trim());
    assert.equal(await git(root, ["rev-parse", `${result.branch.commitSha}^`]), baseSha);

    const failedProposal = {
      ...proposal,
      id: "abcdefab-cdef-4abc-8def-1234567890ab",
      files: [{
        ...proposal.files[0],
        proposedContent: "export const label = 'invalid';\n",
        proposedHash: hashContent("export const label = 'invalid';\n"),
      }],
    };
    const failed = await createIsolatedProposalCommit(failedProposal, {
      root,
      validate: async () => ({ status: "failed", summary: "fixture failed", output: "expected" }),
    });
    assert.equal(failed.branch, null);
    assert.equal(failed.validation.status, "failed");
    await assert.rejects(() => git(root, ["show-ref", "--verify", "refs/heads/evolve/proposal-abcdefabcdef"]));
    assert.equal(await readFile(join(root, "app/components/Demo.tsx"), "utf8"), original);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
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
