import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createCloudflareDeploymentProofLogMarker,
  createCloudflareStorageBrokerDeploymentProof,
  inspectCloudflareWranglerDeployOutputText,
} from "../app/features/storage-broker-cloudflare-deployment-proof.mjs";
import { inspectStorageBrokerReleaseProofText } from "../app/features/storage-broker-release-proof.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}

function environment(name, maximum, pattern) {
  const value = String(process.env[name] || "").trim();
  if (!value || value.length > maximum || /[\u0000-\u001f\u007f]/.test(value) || (pattern && !pattern.test(value))) throw new Error(`Workers Builds 环境变量 ${name} 无效`);
  return value;
}

function repositorySlug(proof) {
  const match = /^https:\/\/github\.com\/([^/]+\/[^/]+)\.git$/.exec(proof.body.source.repository);
  if (!match) throw new Error("发布封签 GitHub 仓库无效");
  return match[1];
}

function releaseProof(endpointOrigin, workbenchOrigin) {
  const raw = execFileSync(process.execPath, [
    join(root, "tools/storage-broker-release-check.mjs"),
    "--target", "cloudflare-worker-r2",
    "--endpoint", endpointOrigin,
    "--origin", workbenchOrigin,
  ], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  });
  return inspectStorageBrokerReleaseProofText(raw);
}

async function main() {
  if (process.env.WORKERS_CI !== "1") throw new Error("生产部署包装器只能在 Cloudflare Workers Builds 中运行");
  const commit = environment("WORKERS_CI_COMMIT_SHA", 40, /^[0-9a-f]{40}$/).toLowerCase();
  const branch = environment("WORKERS_CI_BRANCH", 180, /^(?!.*\.\.)(?!\/)(?!.*\/$)[A-Za-z0-9._/-]+$/);
  const buildUuid = environment("WORKERS_CI_BUILD_UUID", 128, /^[A-Za-z0-9._-]+$/);
  const endpointOrigin = environment("EVOLVE_BROKER_ENDPOINT_ORIGIN", 320);
  const workbenchOrigin = environment("EVOLVE_WORKBENCH_ORIGIN", 320);
  const proof = await releaseProof(endpointOrigin, workbenchOrigin);
  if (proof.body.source.commit !== commit || proof.body.source.branch !== branch) throw new Error("Workers Builds 来源与发布封签不一致");
  const repository = repositorySlug(proof);
  const versionTag = `evolve-${commit}`;
  const temporary = mkdtempSync(join(tmpdir(), "evolve-cloudflare-deploy-"));
  const outputPath = join(temporary, "wrangler-output.ndjson");
  try {
    execFileSync(process.execPath, [
      join(root, "node_modules/wrangler/bin/wrangler.js"),
      "deploy",
      "--config", "deploy/storage-broker/cloudflare/wrangler.jsonc",
      "--tag", versionTag,
      "--message", `EvolveDesk ${commit} / Workers Build ${buildUuid}`,
      "--var", `EVOLVE_RELEASE_REPOSITORY:${repository}`,
      "--var", `EVOLVE_RELEASE_COMMIT:${commit}`,
      "--var", `EVOLVE_RELEASE_BRANCH:${branch}`,
      "--var", `EVOLVE_CLOUDFLARE_BUILD_UUID:${buildUuid}`,
    ], {
      cwd: root,
      env: { ...process.env, WRANGLER_OUTPUT_FILE_PATH: outputPath },
      stdio: "inherit",
    });
    const deployment = inspectCloudflareWranglerDeployOutputText(readFileSync(outputPath, "utf8"));
    const deploymentProof = await createCloudflareStorageBrokerDeploymentProof({
      createdAt: new Date().toISOString(),
      releaseProof: proof,
      ci: { repository, commit, branch, buildUuid },
      cloud: {
        scriptName: deployment.workerName,
        workerTag: deployment.workerTag,
        versionId: deployment.versionId,
        versionTag,
        endpointOrigin,
        deployedAt: deployment.deployedAt,
      },
    });
    process.stdout.write(`\n${await createCloudflareDeploymentProofLogMarker(deploymentProof)}\n`);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

main().catch((error) => fail(error instanceof Error ? error.message : "无法部署 Cloudflare R2 凭据代理"));
