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
  if (!candidate || candidate.startsWith("/") || candidate.includes("..") || candidate.includes("\0")) {
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

function absoluteFor(path) {
  const absolute = resolve(ROOT, path);
  if (!absolute.startsWith(`${ROOT}${sep}`)) throw new Error("文件越过了工作区边界");
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

async function readOptional(path) {
  try {
    return await readFile(absoluteFor(path), "utf8");
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

async function gitHead() {
  try {
    const { stdout } = await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: ROOT });
    return stdout.trim();
  } catch {
    return "uncommitted";
  }
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
    guards: proposal.guards,
    validation: proposal.validation || null,
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

  const metadataText = `${agentOutput.title || ""}\n${agentOutput.intent || ""}\n${agentOutput.reflection || ""}`;
  if (SECRET_PATTERNS.some((pattern) => pattern.test(metadataText))) {
    throw new Error("提案说明疑似包含密钥，已拒绝保存");
  }

  const proposal = {
    id: randomUUID(),
    title: String(agentOutput.title || "源码进化提案").slice(0, 80),
    intent: String(agentOutput.intent || "改善工作台体验").slice(0, 240),
    reflection: String(agentOutput.reflection || "保持改动小而可撤销。").slice(0, 420),
    risk: ["low", "medium", "high"].includes(agentOutput.risk) ? agentOutput.risk : "medium",
    status: "proposed",
    createdAt: new Date().toISOString(),
    baseSha: await gitHead(),
    guards: ["路径白名单通过", "敏感信息扫描通过", "危险执行通道扫描通过", "文件哈希已锁定"],
    files,
  };
  await writeProposal(proposal);
  await audit({ action: "proposed", id: proposal.id, baseSha: proposal.baseSha, paths: files.map((file) => file.path) });
  return toPublicProposal(proposal);
}

export async function readProposal(id) {
  if (!/^[0-9a-f-]{36}$/i.test(String(id || ""))) throw new Error("无效的提案编号");
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

async function atomicWrite(path, content, id) {
  const absolute = absoluteFor(path);
  await mkdir(dirname(absolute), { recursive: true });
  if (content === null) {
    await rm(absolute, { force: true });
    return;
  }
  const temporary = join(dirname(absolute), `.evolve-${id}.tmp`);
  await writeFile(temporary, content, { mode: 0o644 });
  await rename(temporary, absolute);
}

async function validateCurrentFiles(files, expectedKey) {
  for (const file of files) {
    const current = await readOptional(file.path);
    if (hashContent(current) !== file[expectedKey]) throw new Error(`${file.path} 已在提案后发生变化，拒绝覆盖`);
  }
}

async function runValidation() {
  try {
    const { stdout, stderr } = await execFileAsync("pnpm", ["run", "check:evolution"], {
      cwd: ROOT,
      timeout: 180_000,
      maxBuffer: 1024 * 1024,
      env: { ...process.env, NO_COLOR: "1" },
    });
    return { status: "passed", summary: "Lint、类型检查、构建与产品测试全部通过", output: `${stdout}\n${stderr}`.trim().slice(-12_000) };
  } catch (error) {
    return {
      status: "failed",
      summary: "代码已写入，但固定验证未通过；建议检查差异或立即回滚",
      output: `${error?.stdout || ""}\n${error?.stderr || error?.message || "验证失败"}`.trim().slice(-12_000),
    };
  }
}

export async function applyProposal(id) {
  const proposal = await readProposal(id);
  if (proposal.status !== "proposed") throw new Error("该提案不处于待确认状态");
  await validateCurrentFiles(proposal.files, "originalHash");
  try {
    for (const file of proposal.files) await atomicWrite(file.path, file.proposedContent, proposal.id);
  } catch (error) {
    for (const file of proposal.files) await atomicWrite(file.path, file.originalContent, proposal.id).catch(() => {});
    throw error;
  }
  proposal.status = "applied";
  proposal.appliedAt = new Date().toISOString();
  await writeProposal(proposal);
  await audit({ action: "applied", id: proposal.id, paths: proposal.files.map((file) => file.path) });
  proposal.validation = await runValidation();
  await writeProposal(proposal);
  await audit({ action: "validated", id: proposal.id, status: proposal.validation.status });
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
