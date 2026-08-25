import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import test from "node:test";

const run = promisify(execFile);
const root = new URL("..", import.meta.url);

test("deployment templates declare secrets and package only audited Lambda runtime files", async (context) => {
  const wrangler = JSON.parse(await readFile(new URL("../deploy/storage-broker/cloudflare/wrangler.jsonc", import.meta.url), "utf8"));
  assert.equal(wrangler.main, "./worker.mjs");
  assert.equal(wrangler.compatibility_date, "2026-08-21");
  assert.deepEqual(wrangler.version_metadata, { binding: "CF_VERSION_METADATA" });
  assert.deepEqual(wrangler.secrets.required, [
    "ALLOWED_ORIGIN",
    "BROKER_TOKEN",
    "R2_ACCOUNT_ID",
    "R2_ACCESS_KEY_ID",
    "R2_SECRET_ACCESS_KEY",
  ]);

  const template = await readFile(new URL("../deploy/storage-broker/aws-lambda/template.yaml", import.meta.url), "utf8");
  assert.match(template, /AuthType: NONE/);
  assert.match(template, /Action: sts:AssumeRole/);
  assert.match(template, /Resource: !Ref TargetRoleArn/);
  assert.match(template, /EVOLVE_RELEASE_COMMIT: !Ref ReleaseCommit/);
  assert.doesNotMatch(template, /AWS_ACCESS_KEY_ID|AWS_SECRET_ACCESS_KEY|AWS_SESSION_TOKEN/);

  const artifacts = await mkdtemp(join(tmpdir(), "evolve-broker-lambda-"));
  context.after(() => rm(artifacts, { recursive: true, force: true }));
  await run("make", ["build-StorageCredentialBroker", `ARTIFACTS_DIR=${artifacts}`], { cwd: root });
  const files = (await readdir(artifacts, { recursive: true, withFileTypes: true }))
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name).slice(artifacts.length + 1))
    .sort();
  assert.deepEqual(files, [
    "app/features/aws-sigv4.mjs",
    "app/features/sync-credential-broker.mjs",
    "app/features/sync-storage-recipes.mjs",
    "app/features/sync-storage-scope.mjs",
    "deploy/storage-broker/aws-lambda/handler.mjs",
    "tools/storage-credential-issuers.mjs",
  ]);
  const handlerModule = await import(`${pathToFileURL(join(artifacts, "deploy/storage-broker/aws-lambda/handler.mjs")).href}?test=${Date.now()}`);
  assert.equal(typeof handlerModule.handler, "function");
});
