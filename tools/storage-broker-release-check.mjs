import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import {
  STORAGE_BROKER_RELEASE_TARGETS,
  createStorageBrokerReleaseProof,
  serializeStorageBrokerReleaseProof,
} from "../app/features/storage-broker-release-proof.mjs";

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}

function argumentsFrom(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index];
    if (name === "--") continue;
    if (!new Set(["--target", "--endpoint", "--origin"]).has(name) || !argv[index + 1]) throw new Error("用法：pnpm broker:release-check -- --target <cloudflare-worker-r2|aws-lambda-s3> --endpoint <HTTPS_ORIGIN> --origin <WORKBENCH_HTTPS_ORIGIN>");
    values[name.slice(2)] = argv[index + 1];
    index += 1;
  }
  if (!values.target || !values.endpoint || !values.origin) throw new Error("发布目标、代理 HTTPS Origin 与工作台 HTTPS Origin 都是必填项");
  return values;
}

function git(...args) {
  return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function repositoryUrl(value) {
  const remote = String(value || "").trim();
  const ssh = /^git@github\.com:([^/]+\/[^/]+?)(?:\.git)?$/.exec(remote);
  if (ssh) return `https://github.com/${ssh[1]}.git`;
  const https = /^https:\/\/github\.com\/([^/]+\/[^/]+?)(?:\.git)?$/.exec(remote);
  if (https) return `https://github.com/${https[1]}.git`;
  throw new Error("origin 必须是无凭据的 GitHub SSH 或 HTTPS 仓库地址");
}

async function main() {
  const args = argumentsFrom(process.argv.slice(2));
  const definition = STORAGE_BROKER_RELEASE_TARGETS[args.target];
  if (!definition) throw new Error("发布目标不受支持");
  if (git("status", "--porcelain", "--untracked-files=all")) throw new Error("工作树不干净；请先审阅、提交并验证源码，再生成发布封签");
  for (const path of definition.files) git("ls-files", "--error-unmatch", "--", path);
  const commit = git("rev-parse", "HEAD").toLowerCase();
  const branch = git("branch", "--show-current");
  const remoteHead = git("ls-remote", "--exit-code", "origin", `refs/heads/${branch}`).split(/\s+/)[0]?.toLowerCase();
  if (remoteHead !== commit) throw new Error("当前提交尚未成为 GitHub origin 同名分支头；请先推送并再次核对");
  const proof = await createStorageBrokerReleaseProof({
    target: args.target,
    createdAt: new Date().toISOString(),
    source: {
      repository: repositoryUrl(git("remote", "get-url", "origin")),
      commit,
      branch,
      clean: true,
      remoteHeadVerified: true,
    },
    deployment: { endpointOrigin: args.endpoint, allowedWorkbenchOrigin: args.origin },
    files: definition.files.map((path) => ({
      path,
      sha256: createHash("sha256").update(readFileSync(path)).digest("hex"),
    })),
  });
  process.stdout.write(await serializeStorageBrokerReleaseProof(proof));
}

main().catch((error) => fail(error instanceof Error ? error.message : "无法生成发布封签"));
