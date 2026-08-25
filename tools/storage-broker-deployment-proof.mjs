import { readFileSync } from "node:fs";
import {
  createStorageBrokerDeploymentProof,
  serializeStorageBrokerDeploymentProof,
} from "../app/features/storage-broker-deployment-proof.mjs";
import { inspectStorageBrokerReleaseProofText } from "../app/features/storage-broker-release-proof.mjs";

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}

function argumentsFrom(argv) {
  const allowed = new Set(["--release-proof", "--resource-arn", "--cloud-version", "--code-sha256", "--endpoint", "--region", "--observed-at"]);
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index];
    if (name === "--") continue;
    if (!allowed.has(name) || !argv[index + 1]) throw new Error("用法：pnpm broker:deployment-proof -- --release-proof <PATH> --resource-arn <LAMBDA_ARN> --cloud-version <VERSION> --code-sha256 <BASE64> --endpoint <HTTPS_ORIGIN> --region <AWS_REGION>");
    values[name.slice(2)] = argv[index + 1];
    index += 1;
  }
  for (const required of ["release-proof", "resource-arn", "cloud-version", "code-sha256", "endpoint", "region"]) {
    if (!values[required]) throw new Error(`缺少 --${required}`);
  }
  return values;
}

function githubEnvironment(name) {
  const value = String(process.env[name] || "").trim();
  if (!value) throw new Error(`只能在 GitHub Actions 中生成部署回执：缺少 ${name}`);
  return value;
}

async function main() {
  const args = argumentsFrom(process.argv.slice(2));
  const repository = githubEnvironment("GITHUB_REPOSITORY");
  const runId = githubEnvironment("GITHUB_RUN_ID");
  const proof = await createStorageBrokerDeploymentProof({
    createdAt: new Date().toISOString(),
    releaseProof: await inspectStorageBrokerReleaseProofText(readFileSync(args["release-proof"], "utf8")),
    ci: {
      repository,
      commit: githubEnvironment("GITHUB_SHA").toLowerCase(),
      ref: githubEnvironment("GITHUB_REF"),
      workflowPath: ".github/workflows/deploy-aws-storage-broker.yml",
      runId,
      runAttempt: Number(githubEnvironment("GITHUB_RUN_ATTEMPT")),
      runUrl: `${githubEnvironment("GITHUB_SERVER_URL")}/${repository}/actions/runs/${runId}`,
      environment: "storage-broker-production",
    },
    cloud: {
      region: args.region,
      resourceArn: args["resource-arn"],
      immutableVersion: args["cloud-version"],
      endpointOrigin: args.endpoint,
      codeDigest: { value: args["code-sha256"] },
      observedAt: args["observed-at"] || new Date().toISOString(),
    },
  });
  process.stdout.write(await serializeStorageBrokerDeploymentProof(proof));
}

main().catch((error) => fail(error instanceof Error ? error.message : "无法生成 AWS 部署回执"));
