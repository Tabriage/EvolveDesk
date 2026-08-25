# Cloudflare Workers Builds production path

Use Cloudflare's native GitHub App integration when the repository must not hold a long-lived Cloudflare deployment token.

Dashboard configuration:

- Worker name: `evolve-desk-r2-credential-broker`
- Repository: `Tabriage/EvolveDesk` (grant the GitHub App access to this repository only)
- Production branch: `main`
- Root directory: `/`
- Build command: leave empty
- Deploy command: `pnpm broker:cloudflare-deploy`
- Non-production branch deployments: disabled unless preview credentials and a separate Worker are configured
- Build watch paths: every file listed by `STORAGE_BROKER_RELEASE_TARGETS["cloudflare-worker-r2"].files`

Configure `ALLOWED_ORIGIN`, `BROKER_TOKEN`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, and `R2_SECRET_ACCESS_KEY` as Worker secrets before enabling production builds. The required-secret declaration in `wrangler.jsonc` makes a missing binding fail closed. Configure these two non-secret build variables in Workers Builds:

- `EVOLVE_BROKER_ENDPOINT_ORIGIN`: the production Worker's exact HTTPS origin, without a path.
- `EVOLVE_WORKBENCH_ORIGIN`: the exact HTTPS origin allowed to call the broker.

The deploy wrapper refuses to run outside Workers Builds. It checks the clean checkout against the exact GitHub branch head, seals every audited file, injects the native `WORKERS_CI_COMMIT_SHA`, `WORKERS_CI_BRANCH`, and `WORKERS_CI_BUILD_UUID` values as version-scoped Worker variables, sets an `evolve-<commit>` version tag, and asks Wrangler for structured NDJSON output. `wrangler.jsonc` also enables the `CF_VERSION_METADATA` binding, so `/health` can report the provider-generated Version ID, tag, and creation time from the code that is actually serving the request.

After a successful deployment, the final build-log line starts with `EVOLVE_DESK_CLOUDFLARE_DEPLOYMENT_PROOF_BASE64URL=`. Download the build log and recover the bounded JSON receipt locally:

```sh
pnpm broker:cloudflare-proof -- --build-log ~/Downloads/cloudflare-build.log \
  > evolve-storage-broker-cloudflare-deployment-proof.json
```

Import that file from the Cloudflare R2 recipe in EvolveDesk. The workbench creates a fresh 256-bit browser challenge, sends it only to the authenticated `/health` endpoint, verifies the returned SHA-256 binding, and requires the runtime Commit, Build UUID, Worker name, Version ID, and version tag to match the imported receipt. A copied old health response cannot satisfy a new challenge.

This route removes `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` from GitHub Actions. It is not OIDC: Workers Builds currently deploys with a user API token stored inside Cloudflare. The automatically generated token can include broader Workers, KV, R2, route, and user permissions than this broker needs. Prefer a dedicated user token scoped to this account and Workers Scripts edit, review it in Cloudflare, and rotate it. The five runtime secrets and the build token remain long-lived cloud-side credentials.

The extracted receipt is deliberately labelled `BUILD LOG`, not an attestation. It has a closed schema and self-digest, and the live challenge confirms what the current HTTPS endpoint reports, but Cloudflare does not sign this file and the workbench does not call an unauthenticated Builds API. It is not OIDC and does not prove the deployer's identity. Keep matching the GitHub commit to the Cloudflare check run and Build ID in the dashboard. The build token and five runtime secrets remain long-lived cloud-side credentials.

Implementation references: [Workers Builds configuration](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/), [Version metadata binding](https://developers.cloudflare.com/workers/runtime-apis/bindings/version-metadata/), and [Wrangler structured output variables](https://developers.cloudflare.com/workers/wrangler/system-environment-variables/).
