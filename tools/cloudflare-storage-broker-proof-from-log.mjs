import { readFileSync } from "node:fs";
import {
  inspectCloudflareDeploymentProofFromBuildLogText,
  serializeCloudflareStorageBrokerDeploymentProof,
} from "../app/features/storage-broker-cloudflare-deployment-proof.mjs";

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}

function argumentsFrom(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index];
    if (name === "--") continue;
    if (name !== "--build-log" || !argv[index + 1]) throw new Error("用法：pnpm broker:cloudflare-proof -- --build-log <CLOUDFLARE_BUILD_LOG_PATH>");
    values.buildLog = argv[index + 1];
    index += 1;
  }
  if (!values.buildLog) throw new Error("缺少 --build-log");
  return values;
}

async function main() {
  const args = argumentsFrom(process.argv.slice(2));
  const proof = await inspectCloudflareDeploymentProofFromBuildLogText(readFileSync(args.buildLog, "utf8"));
  process.stdout.write(await serializeCloudflareStorageBrokerDeploymentProof(proof));
}

main().catch((error) => fail(error instanceof Error ? error.message : "无法从 Cloudflare Build 日志提取部署回执"));
