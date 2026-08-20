import {
  inspectStorageBrokerReleaseProof,
} from "./storage-broker-release-proof.mjs";

export const MAX_STORAGE_BROKER_DEPLOYMENT_PROOF_BYTES = 256 * 1_024;
export const MAX_GITHUB_WORKFLOW_RUN_BYTES = 128 * 1_024;

function bytes(value) {
  return new TextEncoder().encode(String(value));
}

function hex(value) {
  return [...new Uint8Array(value)].map((part) => part.toString(16).padStart(2, "0")).join("");
}

async function sha256(value) {
  if (!globalThis.crypto?.subtle) throw new Error("当前环境不支持部署回执所需的 Web Crypto");
  return hex(await globalThis.crypto.subtle.digest("SHA-256", bytes(value)));
}

function stableValue(value) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.map(stableValue);
  if (typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype) throw new Error("部署回执必须是普通 JSON 对象");
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

function positiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${label}无效`);
  return value;
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

function repositorySlug(value) {
  return text(value, "GitHub 仓库", 180, /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/);
}

function githubDate(value, label) {
  const candidate = text(value, label, 64);
  const date = new Date(candidate);
  if (!Number.isFinite(date.getTime()) || date.getUTCFullYear() < 2020 || date.getUTCFullYear() > 2200) throw new Error(`${label}无效`);
  return date.toISOString();
}

function repositoryFromReleaseProof(proof) {
  const match = /^https:\/\/github\.com\/([^/]+\/[^/]+)\.git$/.exec(proof.body.source.repository);
  if (!match) throw new Error("发布封签源码仓库无效");
  return match[1];
}

function normalizeRunUrl(value, repository, runId) {
  const candidate = text(value, "GitHub Actions 运行地址", 320);
  const expected = `https://github.com/${repository}/actions/runs/${runId}`;
  if (candidate !== expected) throw new Error("GitHub Actions 运行地址与仓库或 Run ID 不一致");
  return expected;
}

function normalizeAwsCloud(value, releaseProof) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("AWS 部署版本无效");
  const endpointOrigin = origin(value.endpointOrigin, "AWS Lambda 端点 Origin");
  if (endpointOrigin !== releaseProof.body.deployment.endpointOrigin) throw new Error("AWS Lambda 端点与发布封签不一致");
  if (!/^[a-z0-9-]+\.lambda-url\.[a-z0-9-]+\.on\.aws$/.test(new URL(endpointOrigin).hostname)) throw new Error("部署回执必须绑定 Lambda Function URL Origin");
  const region = text(value.region, "AWS Region", 32, /^[a-z0-9][a-z0-9-]{1,31}$/);
  if (!new URL(endpointOrigin).hostname.endsWith(`.${region}.on.aws`)) throw new Error("Lambda Function URL 与 AWS Region 不一致");
  const resourceArn = text(value.resourceArn, "Lambda ARN", 260, /^arn:(?:aws|aws-us-gov|aws-cn):lambda:[a-z0-9-]+:[0-9]{12}:function:[A-Za-z0-9-_]+$/);
  if (!resourceArn.includes(`:lambda:${region}:`)) throw new Error("Lambda ARN 与 AWS Region 不一致");
  return {
    provider: "aws-lambda",
    region,
    resourceArn,
    immutableVersion: text(value.immutableVersion, "Lambda 不可变版本", 12, /^[1-9][0-9]*$/),
    endpointOrigin,
    codeDigest: {
      algorithm: "SHA-256",
      encoding: "base64",
      value: text(value.codeDigest?.value, "Lambda CodeSha256", 44, /^[A-Za-z0-9+/]{43}=$/),
    },
    observedAt: isoDate(value.observedAt, "云端版本核对时间"),
  };
}

async function normalizeBody(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("部署回执正文无效");
  const releaseProof = await inspectStorageBrokerReleaseProof(value.releaseProof);
  if (releaseProof.body.target !== "aws-lambda-s3") throw new Error("当前部署回执只接受 AWS Lambda S3 凭据代理");
  const ci = value.ci;
  if (!ci || typeof ci !== "object" || Array.isArray(ci)) throw new Error("GitHub Actions 来源无效");
  const repository = repositorySlug(ci.repository);
  if (repository !== repositoryFromReleaseProof(releaseProof)) throw new Error("GitHub Actions 仓库与发布封签不一致");
  const runId = text(ci.runId, "GitHub Actions Run ID", 32, /^[1-9][0-9]*$/);
  const ref = text(ci.ref, "GitHub Actions Ref", 260, /^refs\/heads\/(?!.*\.\.)(?!.*\/$)[A-Za-z0-9._/-]+$/);
  if (ref.slice("refs/heads/".length) !== releaseProof.body.source.branch) throw new Error("GitHub Actions Ref 与发布封签分支不一致");
  const createdAt = isoDate(value.createdAt, "部署回执生成时间");
  const cloud = normalizeAwsCloud(value.cloud, releaseProof);
  const releaseTime = new Date(releaseProof.body.createdAt).getTime();
  const observedTime = new Date(cloud.observedAt).getTime();
  const createdTime = new Date(createdAt).getTime();
  if (observedTime > releaseTime || releaseTime > createdTime || createdTime - observedTime > 60 * 60_000) throw new Error("云端核对、发布封签与部署回执时间顺序无效");
  const workflowPath = text(ci.workflowPath, "GitHub Actions 工作流", 220, /^\.github\/workflows\/[A-Za-z0-9._/-]+\.ya?ml$/);
  if (workflowPath !== ".github/workflows/deploy-aws-storage-broker.yml") throw new Error("GitHub Actions 工作流不受支持");
  const environment = text(ci.environment, "GitHub Environment", 100, /^[A-Za-z0-9_.-]+$/);
  if (environment !== "storage-broker-production") throw new Error("GitHub Environment 不受支持");
  return {
    createdAt,
    releaseProof,
    ci: {
      system: "github-actions",
      repository,
      commit: text(ci.commit, "GitHub Actions 提交", 40, /^[0-9a-f]{40}$/),
      ref,
      workflowPath,
      runId,
      runAttempt: positiveInteger(ci.runAttempt, "GitHub Actions Run Attempt"),
      runUrl: normalizeRunUrl(ci.runUrl, repository, runId),
      environment,
      credentialMode: "github-oidc",
      artifactAttestation: {
        kind: "github-artifact-attestation",
        verificationRequired: true,
      },
    },
    cloud,
  };
}

export async function createStorageBrokerDeploymentProof(value) {
  const body = await normalizeBody(value);
  if (body.ci.commit !== body.releaseProof.body.source.commit) throw new Error("GitHub Actions 提交与发布封签不一致");
  return {
    format: "evolve-desk-storage-broker-deployment-proof",
    version: 1,
    body,
    digest: { algorithm: "SHA-256", value: await sha256(stableJson(body)) },
  };
}

export async function inspectStorageBrokerDeploymentProof(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("部署回执格式无效");
  if (value.format !== "evolve-desk-storage-broker-deployment-proof" || value.version !== 1) throw new Error("部署回执版本不受支持");
  const expected = await createStorageBrokerDeploymentProof(value.body);
  if (stableJson(value) !== stableJson(expected)) throw new Error("部署回执字段、云端版本或 SHA-256 核对失败");
  return expected;
}

export async function inspectStorageBrokerDeploymentProofText(rawValue) {
  const raw = String(rawValue || "");
  if (bytes(raw).byteLength > MAX_STORAGE_BROKER_DEPLOYMENT_PROOF_BYTES) throw new Error("部署回执超过 256 KiB 上限");
  let parsed;
  try { parsed = JSON.parse(raw); } catch { throw new Error("部署回执不是有效 JSON"); }
  return inspectStorageBrokerDeploymentProof(parsed);
}

export async function serializeStorageBrokerDeploymentProof(value) {
  return `${JSON.stringify(await inspectStorageBrokerDeploymentProof(value), null, 2)}\n`;
}

export async function verifyStorageBrokerDeploymentRun(value, options = {}) {
  const proof = await inspectStorageBrokerDeploymentProof(value);
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== "function") throw new Error("当前环境不能在线核对 GitHub Actions Run");
  const apiUrl = `https://api.github.com/repos/${proof.body.ci.repository}/actions/runs/${proof.body.ci.runId}`;
  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort(), 10_000);
  let response;
  try {
    response = await fetchImpl(apiUrl, {
      method: "GET",
      headers: {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      credentials: "omit",
      redirect: "error",
      cache: "no-store",
      referrerPolicy: "no-referrer",
      signal: controller.signal,
    });
  } catch (error) {
    if (error?.name === "AbortError") throw new Error("GitHub Actions Run 在线核对超时");
    throw new Error("无法访问 GitHub Actions Run 公共 API");
  } finally {
    globalThis.clearTimeout(timeout);
  }
  if (!response || response.status !== 200) throw new Error(`GitHub Actions Run 在线核对失败（HTTP ${response?.status || 0}）`);
  const contentLength = Number(response.headers?.get?.("content-length") || 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_GITHUB_WORKFLOW_RUN_BYTES) throw new Error("GitHub Actions Run 响应超过 128 KiB 上限");
  const raw = await response.text();
  if (bytes(raw).byteLength > MAX_GITHUB_WORKFLOW_RUN_BYTES) throw new Error("GitHub Actions Run 响应超过 128 KiB 上限");
  let run;
  try { run = JSON.parse(raw); } catch { throw new Error("GitHub Actions Run 响应不是有效 JSON"); }
  if (!run || typeof run !== "object" || Array.isArray(run)) throw new Error("GitHub Actions Run 响应无效");
  const createdAt = githubDate(run.created_at, "GitHub Run 创建时间");
  const updatedAt = githubDate(run.updated_at, "GitHub Run 完成时间");
  const proofTime = new Date(proof.body.createdAt).getTime();
  if (new Date(createdAt).getTime() > proofTime || proofTime > new Date(updatedAt).getTime() + 5 * 60_000) throw new Error("部署回执生成时间不在 GitHub Run 时间窗口内");
  const checks = {
    repository: text(run.repository?.full_name, "GitHub Run 仓库", 180) === proof.body.ci.repository,
    runId: String(run.id) === proof.body.ci.runId,
    runAttempt: run.run_attempt === proof.body.ci.runAttempt,
    runUrl: text(run.html_url, "GitHub Run 地址", 320) === proof.body.ci.runUrl,
    event: run.event === "workflow_dispatch",
    workflowPath: text(run.path, "GitHub Run 工作流", 220) === proof.body.ci.workflowPath,
    commit: text(run.head_sha, "GitHub Run 提交", 40, /^[0-9a-f]{40}$/) === proof.body.ci.commit,
    branch: text(run.head_branch, "GitHub Run 分支", 180) === proof.body.releaseProof.body.source.branch,
    completed: run.status === "completed",
    conclusion: run.conclusion === "success",
  };
  const mismatches = Object.entries(checks).filter(([, matches]) => !matches).map(([name]) => name);
  if (mismatches.length) throw new Error(`GitHub Actions Run 与部署回执不一致：${mismatches.join("、")}`);
  return {
    system: "github-actions-public-api",
    checkedAt: new Date(options.now || Date.now()).toISOString(),
    repository: proof.body.ci.repository,
    runId: proof.body.ci.runId,
    workflowPath: proof.body.ci.workflowPath,
    commit: proof.body.ci.commit,
    status: "completed",
    conclusion: "success",
    createdAt,
    updatedAt,
  };
}
