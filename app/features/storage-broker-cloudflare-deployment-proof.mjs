import {
  inspectStorageBrokerReleaseProof,
} from "./storage-broker-release-proof.mjs";
import {
  inspectCredentialBrokerRuntimeChallenge,
  inspectCredentialBrokerRuntimeRelease,
} from "./sync-credential-broker.mjs";

export const MAX_CLOUDFLARE_DEPLOYMENT_PROOF_BYTES = 256 * 1_024;
export const MAX_WRANGLER_DEPLOY_OUTPUT_BYTES = 64 * 1_024;
export const MAX_CLOUDFLARE_BUILD_LOG_BYTES = 10 * 1_024 * 1_024;
export const CLOUDFLARE_DEPLOYMENT_PROOF_LOG_MARKER = "EVOLVE_DESK_CLOUDFLARE_DEPLOYMENT_PROOF_BASE64URL=";

const WORKER_SCRIPT_NAME = "evolve-desk-r2-credential-broker";

function bytes(value) {
  return new TextEncoder().encode(String(value));
}

function hex(value) {
  return [...new Uint8Array(value)].map((part) => part.toString(16).padStart(2, "0")).join("");
}

async function sha256(value) {
  if (!globalThis.crypto?.subtle) throw new Error("当前环境不支持 Cloudflare 部署回执所需的 Web Crypto");
  return hex(await globalThis.crypto.subtle.digest("SHA-256", bytes(value)));
}

function stableValue(value) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.map(stableValue);
  if (typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype) throw new Error("Cloudflare 部署回执必须是普通 JSON 对象");
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
}

function stableJson(value) {
  return JSON.stringify(stableValue(value));
}

function text(value, label, maximum, pattern) {
  const candidate = String(value || "").trim();
  if (!candidate || candidate.length > maximum || /[\u0000-\u001f\u007f]/.test(candidate) || (pattern && !pattern.test(candidate))) throw new Error(`${label}无效`);
  return candidate;
}

function isoDate(value, label) {
  const candidate = text(value, label, 64);
  const date = new Date(candidate);
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== candidate || date.getUTCFullYear() < 2020 || date.getUTCFullYear() > 2200) throw new Error(`${label}无效`);
  return candidate;
}

function origin(value, label) {
  let url;
  try { url = new URL(String(value || "")); } catch { throw new Error(`${label}无效`); }
  if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash) throw new Error(`${label}必须是无路径、凭据、查询或片段的 HTTPS Origin`);
  return url.origin;
}

function repositoryFromReleaseProof(proof) {
  const match = /^https:\/\/github\.com\/([^/]+\/[^/]+)\.git$/.exec(proof.body.source.repository);
  if (!match) throw new Error("Cloudflare 发布封签源码仓库无效");
  return match[1];
}

function versionId(value, label = "Cloudflare Worker Version ID") {
  return text(value, label, 36, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
}

function normalizeWranglerDeployEvent(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Wrangler 部署输出事件无效");
  if (value.type !== "deploy" || value.version !== 1) throw new Error("Wrangler 部署输出事件版本不受支持");
  if (value.worker_name_overridden !== false) throw new Error("Workers Builds 覆盖了 Worker 名称，已拒绝生成回执");
  const workerName = text(value.worker_name, "Wrangler Worker 名称", 63, /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/);
  if (workerName !== WORKER_SCRIPT_NAME) throw new Error("Wrangler Worker 名称与受审计模板不一致");
  if (!Array.isArray(value.targets) || value.targets.length < 1 || value.targets.length > 32) throw new Error("Wrangler 部署目标无效");
  const targets = value.targets.map((target) => text(target, "Wrangler 部署目标", 500));
  if (new Set(targets).size !== targets.length) throw new Error("Wrangler 部署目标不能重复");
  return {
    workerName,
    workerTag: text(value.worker_tag, "Wrangler Worker Tag", 128, /^[A-Za-z0-9_-]+$/),
    versionId: versionId(value.version_id),
    deployedAt: isoDate(value.timestamp, "Wrangler 部署完成时间"),
    targets,
  };
}

export function inspectCloudflareWranglerDeployOutputText(rawValue) {
  const raw = String(rawValue || "");
  if (bytes(raw).byteLength > MAX_WRANGLER_DEPLOY_OUTPUT_BYTES) throw new Error("Wrangler 部署输出超过 64 KiB 上限");
  const lines = raw.split(/\r?\n/).filter((line) => line.trim());
  const events = lines.map((line) => {
    try { return JSON.parse(line); } catch { throw new Error("Wrangler 部署输出不是有效 NDJSON"); }
  });
  const deployments = events.filter((event) => event?.type === "deploy");
  if (deployments.length !== 1) throw new Error("Wrangler 部署输出必须且只能包含一个 deploy 事件");
  return normalizeWranglerDeployEvent(deployments[0]);
}

async function normalizeBody(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Cloudflare 部署回执正文无效");
  const releaseProof = await inspectStorageBrokerReleaseProof(value.releaseProof);
  if (releaseProof.body.target !== "cloudflare-worker-r2") throw new Error("Cloudflare 部署回执只接受 R2 Worker 凭据代理");
  const ci = value.ci;
  const cloud = value.cloud;
  if (!ci || typeof ci !== "object" || Array.isArray(ci)) throw new Error("Workers Builds 来源无效");
  if (!cloud || typeof cloud !== "object" || Array.isArray(cloud)) throw new Error("Cloudflare Worker 版本无效");
  const repository = text(ci.repository, "Workers Builds 仓库", 180, /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/);
  if (repository !== repositoryFromReleaseProof(releaseProof)) throw new Error("Workers Builds 仓库与发布封签不一致");
  const commit = text(ci.commit, "Workers Builds 提交", 40, /^[0-9a-f]{40}$/);
  if (commit !== releaseProof.body.source.commit) throw new Error("Workers Builds 提交与发布封签不一致");
  const branch = text(ci.branch, "Workers Builds 分支", 180, /^(?!.*\.\.)(?!\/)(?!.*\/$)[A-Za-z0-9._/-]+$/);
  if (branch !== releaseProof.body.source.branch) throw new Error("Workers Builds 分支与发布封签不一致");
  const endpointOrigin = origin(cloud.endpointOrigin, "Cloudflare Worker 端点 Origin");
  if (endpointOrigin !== releaseProof.body.deployment.endpointOrigin) throw new Error("Cloudflare Worker 端点与发布封签不一致");
  const scriptName = text(cloud.scriptName, "Cloudflare Worker 名称", 63, /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/);
  if (scriptName !== WORKER_SCRIPT_NAME) throw new Error("Cloudflare Worker 名称与受审计模板不一致");
  const versionTag = text(cloud.versionTag, "Cloudflare Worker 版本标签", 80, /^evolve-[0-9a-f]{40}$/);
  if (versionTag !== `evolve-${commit}`) throw new Error("Cloudflare Worker 版本标签与提交不一致");
  const createdAt = isoDate(value.createdAt, "Cloudflare 部署回执生成时间");
  const deployedAt = isoDate(cloud.deployedAt, "Cloudflare Worker 部署时间");
  const releaseTime = new Date(releaseProof.body.createdAt).getTime();
  const deployedTime = new Date(deployedAt).getTime();
  const createdTime = new Date(createdAt).getTime();
  if (releaseTime > deployedTime || deployedTime > createdTime || createdTime - releaseTime > 60 * 60_000) throw new Error("发布封签、Worker 部署与回执时间顺序无效");
  return {
    createdAt,
    releaseProof,
    ci: {
      system: "cloudflare-workers-builds",
      repository,
      commit,
      branch,
      buildUuid: text(ci.buildUuid, "Workers Build UUID", 128, /^[A-Za-z0-9._-]+$/),
      credentialMode: "cloudflare-user-api-token",
    },
    cloud: {
      provider: "cloudflare-workers",
      scriptName,
      workerTag: text(cloud.workerTag, "Cloudflare Worker Tag", 128, /^[A-Za-z0-9_-]+$/),
      versionId: versionId(cloud.versionId),
      versionTag,
      endpointOrigin,
      deployedAt,
    },
  };
}

export async function createCloudflareStorageBrokerDeploymentProof(value) {
  const body = await normalizeBody(value);
  return {
    format: "evolve-desk-cloudflare-storage-broker-deployment-proof",
    version: 1,
    body,
    digest: { algorithm: "SHA-256", value: await sha256(stableJson(body)) },
  };
}

export async function inspectCloudflareStorageBrokerDeploymentProof(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Cloudflare 部署回执格式无效");
  if (value.format !== "evolve-desk-cloudflare-storage-broker-deployment-proof" || value.version !== 1) throw new Error("Cloudflare 部署回执版本不受支持");
  const expected = await createCloudflareStorageBrokerDeploymentProof(value.body);
  if (stableJson(value) !== stableJson(expected)) throw new Error("Cloudflare 部署回执字段、版本或 SHA-256 核对失败");
  return expected;
}

export async function inspectCloudflareStorageBrokerDeploymentProofText(rawValue) {
  const raw = String(rawValue || "");
  if (bytes(raw).byteLength > MAX_CLOUDFLARE_DEPLOYMENT_PROOF_BYTES) throw new Error("Cloudflare 部署回执超过 256 KiB 上限");
  let parsed;
  try { parsed = JSON.parse(raw); } catch { throw new Error("Cloudflare 部署回执不是有效 JSON"); }
  return inspectCloudflareStorageBrokerDeploymentProof(parsed);
}

export async function serializeCloudflareStorageBrokerDeploymentProof(value) {
  return `${JSON.stringify(await inspectCloudflareStorageBrokerDeploymentProof(value), null, 2)}\n`;
}

function bytesToBase64url(value) {
  let binary = "";
  for (const part of bytes(value)) binary += String.fromCharCode(part);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64urlToText(value) {
  const candidate = text(value, "Cloudflare 部署回执日志载荷", 512 * 1_024, /^[A-Za-z0-9_-]+$/);
  const padded = candidate.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(candidate.length / 4) * 4, "=");
  let binary;
  try { binary = atob(padded); } catch { throw new Error("Cloudflare 部署回执日志载荷不是有效 Base64URL"); }
  const output = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) output[index] = binary.charCodeAt(index);
  try { return new TextDecoder("utf-8", { fatal: true }).decode(output); } catch { throw new Error("Cloudflare 部署回执日志载荷不是有效 UTF-8"); }
}

export async function createCloudflareDeploymentProofLogMarker(value) {
  const serialized = await serializeCloudflareStorageBrokerDeploymentProof(value);
  return `${CLOUDFLARE_DEPLOYMENT_PROOF_LOG_MARKER}${bytesToBase64url(serialized)}`;
}

export async function inspectCloudflareDeploymentProofFromBuildLogText(rawValue) {
  const raw = String(rawValue || "");
  if (bytes(raw).byteLength > MAX_CLOUDFLARE_BUILD_LOG_BYTES) throw new Error("Cloudflare Build 日志超过 10 MiB 上限");
  const expression = new RegExp(`${CLOUDFLARE_DEPLOYMENT_PROOF_LOG_MARKER}([A-Za-z0-9_-]+)`, "g");
  const matches = [...raw.matchAll(expression)].map((match) => match[1]);
  if (matches.length !== 1) throw new Error("Cloudflare Build 日志必须且只能包含一个部署回执标记");
  return inspectCloudflareStorageBrokerDeploymentProofText(base64urlToText(matches[0]));
}

export async function verifyCloudflareStorageBrokerDeploymentRuntime(value, healthValue, options = {}) {
  const proof = await inspectCloudflareStorageBrokerDeploymentProof(value);
  if (healthValue?.ok !== true || healthValue?.service !== "evolve-desk-storage-broker"
    || healthValue?.providers?.cloudflareR2 !== true || healthValue?.providers?.amazonS3 !== false) {
    throw new Error("Cloudflare 凭据代理运行时健康响应无效");
  }
  const release = inspectCredentialBrokerRuntimeRelease(healthValue.release);
  if (!release || release.ci.system !== "cloudflare-workers-builds" || release.runtime.provider !== "cloudflare-workers") throw new Error("Cloudflare 凭据代理没有报告可核对的运行时来源");
  const challenge = await inspectCredentialBrokerRuntimeChallenge(healthValue.challenge, release, options.challenge);
  const checks = {
    repository: release.ci.repository === proof.body.ci.repository,
    commit: release.ci.commit === proof.body.ci.commit,
    branch: release.ci.branch === proof.body.ci.branch,
    buildUuid: release.ci.buildUuid === proof.body.ci.buildUuid,
    scriptName: release.runtime.scriptName === proof.body.cloud.scriptName,
    versionId: release.runtime.versionId === proof.body.cloud.versionId,
    versionTag: release.runtime.versionTag === proof.body.cloud.versionTag,
  };
  const mismatches = Object.entries(checks).filter(([, matches]) => !matches).map(([name]) => name);
  if (mismatches.length) throw new Error(`Cloudflare 凭据代理运行时与部署回执不一致：${mismatches.join("、")}`);
  const versionTime = new Date(release.runtime.versionCreatedAt).getTime();
  const deployedTime = new Date(proof.body.cloud.deployedAt).getTime();
  if (versionTime > deployedTime + 60_000 || deployedTime - versionTime > 10 * 60_000) throw new Error("Cloudflare Worker 版本创建时间与部署回执不一致");
  const checkedAt = new Date(options.now || Date.now());
  if (!Number.isFinite(checkedAt.getTime())) throw new Error("Cloudflare 运行时核对时间无效");
  return {
    system: "cloudflare-worker-runtime-challenge",
    checkedAt: checkedAt.toISOString(),
    repository: release.ci.repository,
    commit: release.ci.commit,
    branch: release.ci.branch,
    buildUuid: release.ci.buildUuid,
    scriptName: release.runtime.scriptName,
    versionId: release.runtime.versionId,
    versionTag: release.runtime.versionTag,
    versionCreatedAt: release.runtime.versionCreatedAt,
    challengeDigest: challenge.digest,
  };
}
