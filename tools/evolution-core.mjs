import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import {
  appendFile,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { dirname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const STATE_DIR = join(ROOT, ".evolve");
const PROPOSAL_DIR = join(STATE_DIR, "proposals");
const AUDIT_FILE = join(STATE_DIR, "audit.jsonl");
const execFileAsync = promisify(execFile);
const GIT_TIMEOUT = 60_000;

const EXACT_EDITABLE_FILES = new Set([
  "app/page.tsx",
  "app/layout.tsx",
  "app/globals.css",
  "README.md",
]);
const PROTECTED_FILES = new Set([
  "app/components/EvolutionLab.tsx",
  "tests/evolution-core.test.mjs",
]);
const EDITABLE_DIRECTORIES = [
  { prefix: "app/components/", extensions: [".ts", ".tsx", ".css"] },
  { prefix: "app/features/", extensions: [".ts", ".tsx", ".css", ".mjs", ".mts"] },
  { prefix: "tests/", extensions: [".mjs"] },
];
const CONTEXT_ROOTS = ["app", "tests"];
const MAX_FILE_CHARS = 80_000;
const MAX_TOTAL_CHARS = 180_000;
const SECRET_PATTERNS = [
  /agt_codex_[A-Za-z0-9_-]{12,}/,
  /\bsk-[A-Za-z0-9_-]{20,}/,
  /\bgh[opsu]_[A-Za-z0-9]{20,}/,
  /BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY/,
];

function cleanRelativePath(value) {
  const candidate = normalize(String(value || "")).split(sep).join("/");
  if (!candidate || candidate.startsWith("/") || candidate.includes("..") || candidate.includes("\0") || !/^[A-Za-z0-9._/-]+$/.test(candidate)) {
    throw new Error(`不安全的文件路径：${String(value || "(空)")}`);
  }
  return candidate.replace(/^\.\//, "");
}

export function isEditablePath(value) {
  let path;
  try {
    path = cleanRelativePath(value);
  } catch {
    return false;
  }
  if (PROTECTED_FILES.has(path)) return false;
  if (EXACT_EDITABLE_FILES.has(path)) return true;
  return EDITABLE_DIRECTORIES.some(
    ({ prefix, extensions }) =>
      path.startsWith(prefix) && extensions.some((extension) => path.endsWith(extension)),
  );
}

export function assertEditablePath(value) {
  const path = cleanRelativePath(value);
  if (!isEditablePath(path)) throw new Error(`「${path}」位于源码进化沙箱之外`);
  return path;
}

function absoluteFor(path, root = ROOT) {
  const absolute = resolve(root, path);
  if (!absolute.startsWith(`${root}${sep}`)) throw new Error("文件越过了工作区边界");
  return absolute;
}

export function scanProposedContent(path, content) {
  if (typeof content !== "string" || content.length === 0) throw new Error(`${path} 的内容为空`);
  if (content.length > MAX_FILE_CHARS) throw new Error(`${path} 超过单文件变更上限`);
  if (content.includes("\0")) throw new Error(`${path} 包含二进制内容`);

  if (SECRET_PATTERNS.some((pattern) => pattern.test(content))) {
    throw new Error(`${path} 疑似包含密钥，提案已拦截`);
  }

  if (path !== "README.md") {
    const forbidden = [
      /node:child_process|child_process/,
      /node:(?:fs|net|tls|http|https)/,
      /\beval\s*\(/,
      /new\s+Function\s*\(/,
      /dangerouslySetInnerHTML/,
      /document\.cookie/,
      /navigator\.sendBeacon/,
      /\bWebSocket\s*\(/,
      /\bEventSource\s*\(/,
      /importScripts\s*\(/,
      /process\.env/,
      /(?:localhost|127\.0\.0\.1):4242/,
      /\/api\/(?:apply|rollback|discard|propose)/,
      /EVOLVE_AGENT|SOURCE_AGENT_URL/,
      /(?:localStorage|sessionStorage)\.setItem\([^)]*\bapiKey\b/,
      /console\.(?:log|info|warn|error)\([^)]*\bapiKey\b/,
    ];
    if (forbidden.some((pattern) => pattern.test(content))) {
      throw new Error(`${path} 引入了沙箱禁止的执行或数据通道`);
    }

    const urls = content.match(/https?:\/\/[^\s"'`)]+/g) || [];
    for (const raw of urls) {
      const url = new URL(raw);
      if (!["localhost", "127.0.0.1", "[::1]", "::1"].includes(url.hostname)) {
        throw new Error(`${path} 引入了非本机网络地址`);
      }
    }
  }
  return true;
}

export function hashContent(content) {
  return content === null ? null : createHash("sha256").update(content).digest("hex");
}

async function readOptional(path, root = ROOT) {
  try {
    return await readFile(absoluteFor(path, root), "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

function calculateOperations(before, after) {
  const oldLines = before.split("\n");
  const newLines = after.split("\n");
  if (oldLines.length * newLines.length > 1_500_000) {
    return [
      ...oldLines.map((text) => ({ kind: "remove", text })),
      ...newLines.map((text) => ({ kind: "add", text })),
    ];
  }

  const table = Array.from({ length: oldLines.length + 1 }, () => new Uint16Array(newLines.length + 1));
  for (let oldIndex = oldLines.length - 1; oldIndex >= 0; oldIndex -= 1) {
    for (let newIndex = newLines.length - 1; newIndex >= 0; newIndex -= 1) {
      table[oldIndex][newIndex] = oldLines[oldIndex] === newLines[newIndex]
        ? table[oldIndex + 1][newIndex + 1] + 1
        : Math.max(table[oldIndex + 1][newIndex], table[oldIndex][newIndex + 1]);
    }
  }

  const operations = [];
  let oldIndex = 0;
  let newIndex = 0;
  while (oldIndex < oldLines.length || newIndex < newLines.length) {
    if (oldIndex < oldLines.length && newIndex < newLines.length && oldLines[oldIndex] === newLines[newIndex]) {
      operations.push({ kind: "context", text: oldLines[oldIndex] });
      oldIndex += 1;
      newIndex += 1;
    } else if (newIndex < newLines.length && (oldIndex === oldLines.length || table[oldIndex][newIndex + 1] >= table[oldIndex + 1][newIndex])) {
      operations.push({ kind: "add", text: newLines[newIndex] });
      newIndex += 1;
    } else {
      operations.push({ kind: "remove", text: oldLines[oldIndex] });
      oldIndex += 1;
    }
  }
  return operations;
}

export function createDiff(before, after) {
  const operations = calculateOperations(before, after);
  let oldLine = 1;
  let newLine = 1;
  const numbered = operations.map((operation) => {
    const line = {
      ...operation,
      oldLine: operation.kind === "add" ? null : oldLine,
      newLine: operation.kind === "remove" ? null : newLine,
    };
    if (operation.kind !== "add") oldLine += 1;
    if (operation.kind !== "remove") newLine += 1;
    return line;
  });

  const changed = numbered
    .map((line, index) => (line.kind === "context" ? -1 : index))
    .filter((index) => index >= 0);
  const visible = new Set();
  for (const index of changed) {
    for (let offset = -3; offset <= 3; offset += 1) {
      if (numbered[index + offset]) visible.add(index + offset);
    }
  }

  const compact = [];
  let lastIndex = -2;
  for (const index of [...visible].sort((a, b) => a - b)) {
    if (index > lastIndex + 1) compact.push({ kind: "gap", oldLine: null, newLine: null, text: "…" });
    compact.push(numbered[index]);
    lastIndex = index;
  }
  return {
    lines: compact,
    additions: operations.filter((line) => line.kind === "add").length,
    deletions: operations.filter((line) => line.kind === "remove").length,
  };
}

async function gitText(args, cwd = ROOT, options = {}) {
  const { stdout } = await execFileAsync("git", args, {
    cwd,
    timeout: GIT_TIMEOUT,
    maxBuffer: 1024 * 1024,
    ...options,
  });
  return stdout.trim();
}

function validBranchName(value) {
  const branch = String(value || "").trim();
  return branch.length > 0
    && branch.length <= 160
    && /^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(branch)
    && !branch.includes("..")
    && !branch.includes("@{")
    && !branch.includes("//")
    && !branch.endsWith("/")
    && !branch.endsWith(".")
    && !branch.endsWith(".lock");
}

export function proposalBranchName(id) {
  const proposalId = String(id || "").toLowerCase();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(proposalId)) {
    throw new Error("无效的提案编号，无法创建分支");
  }
  const compact = proposalId.replaceAll("-", "").slice(0, 12);
  return `evolve/proposal-${compact}`;
}

export function parseGitHubRemote(value) {
  const remote = String(value || "").trim();
  const match = remote.match(/^(?:https:\/\/|ssh:\/\/git@|git@)github\.com(?::|\/)([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?$/i);
  return match ? { owner: match[1], repository: match[2], slug: `${match[1]}/${match[2]}` } : null;
}

export function mapPullRequestState(value) {
  const review = value && typeof value === "object" ? value : {};
  if (review.mergedAt) return "merged";
  if (review.state === "OPEN") return review.isDraft ? "draft" : "open";
  if (review.state === "CLOSED") return "closed";
  return "pushed";
}

function commitSubject(value) {
  return String(value || "Evolve Desk source proposal")
    .replace(/[\r\n]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 72) || "Evolve Desk source proposal";
}

async function gitBaseline(root = ROOT) {
  const [sha, branch, status] = await Promise.all([
    gitText(["rev-parse", "HEAD"], root),
    gitText(["symbolic-ref", "--quiet", "--short", "HEAD"], root),
    gitText(["status", "--porcelain=v1", "--untracked-files=all"], root),
  ]);
  if (!validBranchName(branch)) throw new Error("当前 Git 分支无法作为提案基线");
  return { sha, branch, clean: status.length === 0 };
}

export async function assertEvolutionGitReady(root = ROOT) {
  const baseline = await gitBaseline(root);
  if (!baseline.clean) throw new Error("工作区存在未提交变化；请先处理后再生成源码提案");
  return baseline;
}

async function ensureStateDirectory() {
  await mkdir(PROPOSAL_DIR, { recursive: true, mode: 0o700 });
}

async function writeProposal(proposal) {
  await ensureStateDirectory();
  const target = join(PROPOSAL_DIR, `${proposal.id}.json`);
  const temporary = `${target}.tmp`;
  await writeFile(temporary, `${JSON.stringify(proposal, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, target);
}

async function audit(entry) {
  await ensureStateDirectory();
  await appendFile(AUDIT_FILE, `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`, { mode: 0o600 });
}

export function toPublicProposal(proposal) {
  return {
    id: proposal.id,
    title: proposal.title,
    intent: proposal.intent,
    reflection: proposal.reflection,
    risk: proposal.risk,
    status: proposal.status,
    createdAt: proposal.createdAt,
    appliedAt: proposal.appliedAt || null,
    rolledBackAt: proposal.rolledBackAt || null,
    baseSha: proposal.baseSha,
    baseBranch: proposal.baseBranch || "",
    remoteRepository: proposal.remoteRepository || "",
    guards: proposal.guards,
    validation: proposal.validation || null,
    branch: proposal.branch || null,
    remoteReview: proposal.remoteReview || null,
    files: proposal.files.map((file) => ({ path: file.path, reason: file.reason, diff: file.diff })),
  };
}

export async function createProposal(agentOutput) {
  if (!agentOutput || typeof agentOutput !== "object") throw new Error("Agent 没有生成结构化源码提案");
  const proposedFiles = agentOutput.files || [];
  if (proposedFiles.length < 1 || proposedFiles.length > 4) throw new Error("一次提案只能修改 1–4 个文件");
  const uniquePaths = new Set();
  let totalChars = 0;
  const files = [];

  for (const file of proposedFiles) {
    const path = assertEditablePath(file.path);
    if (uniquePaths.has(path)) throw new Error(`提案重复修改 ${path}`);
    uniquePaths.add(path);
    scanProposedContent(path, file.content);
    totalChars += file.content.length;
    if (totalChars > MAX_TOTAL_CHARS) throw new Error("提案超过总变更上限");

    const originalContent = await readOptional(path);
    if (originalContent === null && !EDITABLE_DIRECTORIES.some(({ prefix }) => path.startsWith(prefix))) {
      throw new Error(`不允许创建核心入口文件 ${path}`);
    }
    if (originalContent === file.content) continue;
    files.push({
      path,
      reason: String(file.reason || "Agent 建议的调整").slice(0, 180),
      originalContent,
      originalHash: hashContent(originalContent),
      proposedContent: file.content,
      proposedHash: hashContent(file.content),
      diff: createDiff(originalContent || "", file.content),
    });
  }
  if (!files.length) throw new Error("Agent 没有产生实际代码变化");

  const metadataText = `${agentOutput.title || ""}\n${agentOutput.intent || ""}\n${agentOutput.reflection || ""}\n${proposedFiles.map((file) => file.reason || "").join("\n")}`;
  if (SECRET_PATTERNS.some((pattern) => pattern.test(metadataText))) {
    throw new Error("提案说明疑似包含密钥，已拒绝保存");
  }

  const baseline = await assertEvolutionGitReady();
  const remoteURL = await gitText(["remote", "get-url", "origin"]).catch(() => "");
  const remoteRepository = parseGitHubRemote(remoteURL)?.slug || "";

  const proposal = {
    id: randomUUID(),
    title: String(agentOutput.title || "源码进化提案").slice(0, 80),
    intent: String(agentOutput.intent || "改善工作台体验").slice(0, 240),
    reflection: String(agentOutput.reflection || "保持改动小而可撤销。").slice(0, 420),
    risk: ["low", "medium", "high"].includes(agentOutput.risk) ? agentOutput.risk : "medium",
    status: "proposed",
    createdAt: new Date().toISOString(),
    baseSha: baseline.sha,
    baseBranch: baseline.branch,
    remoteRepository,
    guards: ["路径白名单通过", "敏感信息扫描通过", "危险执行通道扫描通过", "Git 基线与文件哈希已锁定"],
    files,
  };
  await writeProposal(proposal);
  await audit({ action: "proposed", id: proposal.id, baseSha: proposal.baseSha, paths: files.map((file) => file.path) });
  return toPublicProposal(proposal);
}

export async function readProposal(id) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(id || ""))) {
    throw new Error("无效的提案编号");
  }
  return JSON.parse(await readFile(join(PROPOSAL_DIR, `${id}.json`), "utf8"));
}

export async function latestProposal() {
  try {
    const names = (await readdir(PROPOSAL_DIR)).filter((name) => name.endsWith(".json"));
    if (!names.length) return null;
    const entries = await Promise.all(names.map(async (name) => ({ name, info: await stat(join(PROPOSAL_DIR, name)) })));
    entries.sort((a, b) => b.info.mtimeMs - a.info.mtimeMs);
    return toPublicProposal(JSON.parse(await readFile(join(PROPOSAL_DIR, entries[0].name), "utf8")));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

async function atomicWrite(path, content, id, root = ROOT) {
  const absolute = absoluteFor(path, root);
  await mkdir(dirname(absolute), { recursive: true });
  if (content === null) {
    await rm(absolute, { force: true });
    return;
  }
  const temporary = join(dirname(absolute), `.evolve-${id}.tmp`);
  await writeFile(temporary, content, { mode: 0o644 });
  await rename(temporary, absolute);
}

async function validateCurrentFiles(files, expectedKey, root = ROOT) {
  for (const file of files) {
    const current = await readOptional(file.path, root);
    if (hashContent(current) !== file[expectedKey]) throw new Error(`${file.path} 已在提案后发生变化，拒绝覆盖`);
  }
}

async function runValidation(cwd) {
  try {
    const commands = [["run", "lint"], ["exec", "tsc", "--noEmit"]];
    const outputs = [];
    for (const args of commands) {
      const { stdout, stderr } = await execFileAsync("pnpm", args, {
        cwd,
        timeout: 90_000,
        maxBuffer: 1024 * 1024,
        env: { ...process.env, NO_COLOR: "1" },
      });
      outputs.push(`${stdout}\n${stderr}`.trim());
    }
    return {
      status: "passed",
      summary: "ESLint 与 TypeScript 静态检查通过；提案代码未被执行",
      output: outputs.join("\n\n").trim().slice(-12_000),
    };
  } catch (error) {
    return {
      status: "failed",
      summary: "隔离静态检查未通过；临时 worktree 与未提交分支将被清理",
      output: `${error?.stdout || ""}\n${error?.stderr || error?.message || "验证失败"}`.trim().slice(-12_000),
    };
  }
}

async function gitRefExists(root, ref) {
  try {
    await gitText(["show-ref", "--verify", "--quiet", ref], root);
    return true;
  } catch {
    return false;
  }
}

async function removeProposalWorktree(root, worktreePath) {
  await gitText(["-c", "core.hooksPath=/dev/null", "worktree", "remove", "--force", worktreePath], root).catch(() => {});
  await rm(worktreePath, { recursive: true, force: true }).catch(() => {});
  await gitText(["worktree", "prune"], root).catch(() => {});
}

function assertCommitReadyProposal(proposal) {
  if (!proposal || typeof proposal !== "object" || proposal.status !== "proposed") {
    throw new Error("只有待确认提案可以创建隔离分支");
  }
  if (!/^[0-9a-f]{40,64}$/i.test(String(proposal.baseSha || "")) || !validBranchName(proposal.baseBranch)) {
    throw new Error("提案缺少可验证的 Git 基线，请重新生成");
  }
  if (!Array.isArray(proposal.files) || proposal.files.length < 1 || proposal.files.length > 4) {
    throw new Error("提案文件数量超出安全边界");
  }
  for (const file of proposal.files) {
    const path = assertEditablePath(file.path);
    scanProposedContent(path, file.proposedContent);
    if (hashContent(file.originalContent) !== file.originalHash || hashContent(file.proposedContent) !== file.proposedHash) {
      throw new Error(`${path} 的提案内容与封存指纹不一致`);
    }
  }
}

export async function createIsolatedProposalCommit(proposal, options = {}) {
  assertCommitReadyProposal(proposal);
  const root = resolve(options.root || ROOT);
  const branchName = proposalBranchName(proposal.id);
  const branchRef = `refs/heads/${branchName}`;
  const baseline = await gitBaseline(root);
  if (!baseline.clean) throw new Error("工作区存在未提交变化，无法创建隔离提案分支");
  if (baseline.sha !== proposal.baseSha || baseline.branch !== proposal.baseBranch) {
    throw new Error("Git 基线已变化，请重新生成提案后再提交");
  }
  await validateCurrentFiles(proposal.files, "originalHash", root);
  if (await gitRefExists(root, branchRef)) throw new Error(`提案分支 ${branchName} 已存在`);

  const worktreeRoot = join(root, ".evolve", "worktrees");
  const worktreePath = join(worktreeRoot, proposal.id);
  await mkdir(worktreeRoot, { recursive: true, mode: 0o700 });
  await rm(worktreePath, { recursive: true, force: true });

  let branchCreated = false;
  let keepBranch = false;
  try {
    await gitText([
      "-c", "core.hooksPath=/dev/null",
      "worktree", "add", "--quiet", "-b", branchName, worktreePath, proposal.baseSha,
    ], root);
    branchCreated = true;
    for (const file of proposal.files) {
      await atomicWrite(file.path, file.proposedContent, proposal.id, worktreePath);
    }

    const validator = typeof options.validate === "function" ? options.validate : runValidation;
    if (!options.validate) {
      try {
        await stat(join(root, "node_modules"));
      } catch {
        throw new Error("缺少 node_modules，请先使用 pnpm install 安装依赖");
      }
      await symlink(join(root, "node_modules"), join(worktreePath, "node_modules"), "junction");
    }
    const validation = await validator(worktreePath);
    if (!validation || validation.status !== "passed") {
      return {
        branch: null,
        validation: validation || { status: "failed", summary: "隔离验证没有返回结果", output: "" },
      };
    }

    const paths = proposal.files.map((file) => file.path);
    await gitText(["add", "--", ...paths], worktreePath);
    await gitText(["diff", "--cached", "--check"], worktreePath);
    const stagedPaths = (await gitText(["diff", "--cached", "--name-only", "--diff-filter=ACMR"], worktreePath))
      .split("\n")
      .filter(Boolean)
      .sort();
    const expectedPaths = [...paths].sort();
    if (JSON.stringify(stagedPaths) !== JSON.stringify(expectedPaths)) {
      throw new Error("暂存文件与提案白名单不一致，已停止自动提交");
    }
    await gitText([
      "-c", "core.hooksPath=/dev/null",
      "commit", "--no-gpg-sign", "--no-verify", "-m", `Evolve: ${commitSubject(proposal.title)}`,
    ], worktreePath, { env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } });
    const commitSha = await gitText(["rev-parse", "HEAD"], worktreePath);
    const parentSha = await gitText(["rev-parse", "HEAD^"], worktreePath);
    if (parentSha !== proposal.baseSha) throw new Error("自动提交没有直接基于封存版本，已停止发布");
    keepBranch = true;
    return {
      validation,
      branch: {
        name: branchName,
        commitSha,
        baseBranch: proposal.baseBranch,
        committedAt: new Date().toISOString(),
      },
    };
  } finally {
    await removeProposalWorktree(root, worktreePath);
    if (branchCreated && !keepBranch) {
      await gitText(["-c", "core.hooksPath=/dev/null", "branch", "-D", branchName], root).catch(() => {});
    }
  }
}

export async function commitProposal(id) {
  const proposal = await readProposal(id);
  const result = await createIsolatedProposalCommit(proposal);
  proposal.validation = result.validation;
  if (result.branch) {
    proposal.status = "committed";
    proposal.branch = result.branch;
    await audit({ action: "committed", id: proposal.id, branch: result.branch.name, commitSha: result.branch.commitSha });
  } else {
    await audit({ action: "branch_validation_failed", id: proposal.id, status: result.validation.status });
  }
  await writeProposal(proposal);
  return toPublicProposal(proposal);
}

async function githubRepository(root = ROOT) {
  const remote = await gitText(["remote", "get-url", "origin"], root);
  const repository = parseGitHubRemote(remote);
  if (!repository) throw new Error("origin 不是可识别的 GitHub 仓库，无法开启远端审阅");
  return repository;
}

async function readPullRequest(branchName, repository) {
  try {
    const { stdout } = await execFileAsync("gh", [
      "pr", "view", branchName,
      "--repo", repository.slug,
      "--json", "url,state,isDraft,mergedAt,headRefOid",
    ], {
      cwd: ROOT,
      timeout: GIT_TIMEOUT,
      maxBuffer: 512 * 1024,
      env: { ...process.env, GH_PROMPT_DISABLED: "1", GIT_TERMINAL_PROMPT: "0" },
    });
    return JSON.parse(stdout);
  } catch {
    return null;
  }
}

function publicRemoteReview(review, expectedCommitSha, publishedAt = null) {
  const url = String(review?.url || "");
  if (!/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/pull\/\d+$/.test(url)) {
    throw new Error("GitHub 没有返回可验证的审阅地址");
  }
  const headSha = String(review?.headRefOid || "");
  return {
    status: mapPullRequestState(review),
    url,
    headSha,
    inSync: headSha === expectedCommitSha,
    publishedAt: publishedAt || new Date().toISOString(),
    checkedAt: new Date().toISOString(),
  };
}

function proposalReviewBody(proposal) {
  const safeText = (value) => String(value || "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replaceAll("@", "＠")
    .replace(/[<>]/g, "")
    .trim();
  const files = proposal.files.map((file) => `- \`${file.path}\` — ${safeText(file.reason)}`).join("\n");
  return `## 提案意图\n\n${safeText(proposal.intent)}\n\n## Agent 自省\n\n${safeText(proposal.reflection)}\n\n## 变更文件\n\n${files}\n\n## 固定验证\n\n${safeText(proposal.validation?.summary || "尚无验证结果")}\n\n---\n由 Evolve Desk 本地源码实验室生成。模型只能提出白名单文件内容；分支、提交、推送与草稿审阅由用户逐步确认。`;
}

function assertPublishedBranch(proposal, root = ROOT) {
  if (!proposal?.branch || !["committed", "published"].includes(proposal.status)) {
    throw new Error("提案尚未形成通过验证的本地提交");
  }
  if (!validBranchName(proposal.branch.name) || !/^[0-9a-f]{40,64}$/i.test(String(proposal.branch.commitSha || ""))) {
    throw new Error("提案分支记录无效");
  }
  return gitText(["rev-parse", `refs/heads/${proposal.branch.name}`], root).then((sha) => {
    if (sha !== proposal.branch.commitSha) throw new Error("本地提案分支已变化，拒绝推送不同内容");
  });
}

export async function publishProposal(id) {
  const proposal = await readProposal(id);
  await assertPublishedBranch(proposal);
  const repository = await githubRepository();
  if (!proposal.remoteRepository || proposal.remoteRepository !== repository.slug) {
    throw new Error("GitHub origin 与提案封存时的仓库不一致，拒绝推送");
  }
  await execFileAsync("gh", ["auth", "status", "--hostname", "github.com"], {
    cwd: ROOT,
    timeout: GIT_TIMEOUT,
    maxBuffer: 512 * 1024,
    env: { ...process.env, GH_PROMPT_DISABLED: "1", GIT_TERMINAL_PROMPT: "0" },
  }).catch(() => {
    throw new Error("GitHub CLI 尚未登录，无法推送并开启草稿审阅");
  });

  const ref = `refs/heads/${proposal.branch.name}`;
  await gitText([
    "-c", "core.hooksPath=/dev/null",
    "push", "origin", `${ref}:${ref}`,
  ], ROOT, { timeout: 120_000, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } }).catch(() => {
    throw new Error("提案分支推送失败；本地提交仍然保留，可以稍后重试");
  });

  proposal.status = "published";
  proposal.remoteReview = {
    status: "pushed",
    url: "",
    headSha: proposal.branch.commitSha,
    inSync: true,
    publishedAt: proposal.remoteReview?.publishedAt || new Date().toISOString(),
    checkedAt: new Date().toISOString(),
  };
  await writeProposal(proposal);
  await audit({ action: "pushed", id: proposal.id, branch: proposal.branch.name, commitSha: proposal.branch.commitSha });

  let review = await readPullRequest(proposal.branch.name, repository);
  if (!review) {
    const { stdout } = await execFileAsync("gh", [
      "pr", "create",
      "--repo", repository.slug,
      "--draft",
      "--base", proposal.branch.baseBranch,
      "--head", proposal.branch.name,
      "--title", `[Evolve] ${commitSubject(proposal.title).replaceAll("@", "＠").replace(/[<>]/g, "")}`,
      "--body", proposalReviewBody(proposal),
    ], {
      cwd: ROOT,
      timeout: 120_000,
      maxBuffer: 512 * 1024,
      env: { ...process.env, GH_PROMPT_DISABLED: "1", GIT_TERMINAL_PROMPT: "0" },
    }).catch(() => {
      throw new Error("分支已推送，但草稿审阅创建失败；可以稍后重试");
    });
    const createdURL = stdout.trim();
    review = await readPullRequest(proposal.branch.name, repository) || {
      url: createdURL,
      state: "OPEN",
      isDraft: true,
      mergedAt: null,
      headRefOid: proposal.branch.commitSha,
    };
  }

  proposal.remoteReview = publicRemoteReview(review, proposal.branch.commitSha, proposal.remoteReview.publishedAt);
  await writeProposal(proposal);
  await audit({ action: "review_opened", id: proposal.id, url: proposal.remoteReview.url, status: proposal.remoteReview.status });
  return toPublicProposal(proposal);
}

export async function refreshProposalReview(id) {
  const proposal = await readProposal(id);
  await assertPublishedBranch(proposal);
  if (proposal.status !== "published") throw new Error("提案分支尚未推送");
  const repository = await githubRepository();
  if (!proposal.remoteRepository || proposal.remoteRepository !== repository.slug) {
    throw new Error("GitHub origin 与提案封存时的仓库不一致，无法刷新审阅");
  }
  const review = await readPullRequest(proposal.branch.name, repository);
  if (!review) throw new Error("尚未找到这个分支对应的 GitHub 审阅");
  proposal.remoteReview = publicRemoteReview(review, proposal.branch.commitSha, proposal.remoteReview?.publishedAt);
  await writeProposal(proposal);
  await audit({ action: "review_refreshed", id: proposal.id, status: proposal.remoteReview.status, inSync: proposal.remoteReview.inSync });
  return toPublicProposal(proposal);
}

export async function rollbackProposal(id) {
  const proposal = await readProposal(id);
  if (proposal.status !== "applied") throw new Error("只有已应用的提案可以回滚");
  await validateCurrentFiles(proposal.files, "proposedHash");
  for (const file of [...proposal.files].reverse()) await atomicWrite(file.path, file.originalContent, proposal.id);
  proposal.status = "rolled_back";
  proposal.rolledBackAt = new Date().toISOString();
  proposal.validation = null;
  await writeProposal(proposal);
  await audit({ action: "rolled_back", id: proposal.id, paths: proposal.files.map((file) => file.path) });
  return toPublicProposal(proposal);
}

export async function discardProposal(id) {
  const proposal = await readProposal(id);
  if (proposal.status !== "proposed") throw new Error("只能搁置尚未应用的提案");
  proposal.status = "discarded";
  proposal.discardedAt = new Date().toISOString();
  await writeProposal(proposal);
  await audit({ action: "discarded", id: proposal.id });
  return toPublicProposal(proposal);
}

async function walk(directory, prefix = "") {
  const output = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) output.push(...await walk(join(directory, entry.name), relativePath));
    else output.push(relativePath);
  }
  return output;
}

export async function sourceContext() {
  const candidates = ["README.md"];
  for (const root of CONTEXT_ROOTS) {
    try {
      candidates.push(...(await walk(join(ROOT, root), root)));
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
  let total = 0;
  const files = [];
  for (const path of candidates.filter(isEditablePath)) {
    const content = await readOptional(path);
    if (content === null || total + content.length > MAX_TOTAL_CHARS) continue;
    total += content.length;
    files.push({ path, content });
  }
  return files;
}
