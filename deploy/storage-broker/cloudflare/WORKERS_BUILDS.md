# Cloudflare Workers Builds production path

Use Cloudflare's native GitHub App integration when the repository must not hold a long-lived Cloudflare deployment token.

Dashboard configuration:

- Worker name: `evolve-desk-r2-credential-broker`
- Repository: `Tabriage/EvolveDesk` (grant the GitHub App access to this repository only)
- Production branch: `main`
- Root directory: `/`
- Build command: leave empty
- Deploy command: `pnpm exec wrangler deploy --config deploy/storage-broker/cloudflare/wrangler.jsonc`
- Non-production branch deployments: disabled unless preview credentials and a separate Worker are configured
- Build watch paths: the six files listed by `STORAGE_BROKER_RELEASE_TARGETS["cloudflare-worker-r2"].files`

Configure `ALLOWED_ORIGIN`, `BROKER_TOKEN`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, and `R2_SECRET_ACCESS_KEY` as Worker secrets before enabling production builds. The required-secret declaration in `wrangler.jsonc` makes a missing binding fail closed.

This route removes `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` from GitHub Actions. It is not OIDC: Workers Builds currently deploys with a user API token stored inside Cloudflare. The automatically generated token can include broader Workers, KV, R2, route, and user permissions than this broker needs. Prefer a dedicated user token scoped to this account and Workers Scripts edit, review it in Cloudflare, and rotate it. The five runtime secrets and the build token remain long-lived cloud-side credentials.

For each production deployment, match the GitHub commit to the Cloudflare check run and its Build ID, then record the active Worker Version ID from Deployments. `WORKERS_CI_COMMIT_SHA`, `WORKERS_CI_BRANCH`, and `WORKERS_CI_BUILD_UUID` are available to build commands, but they are build evidence rather than runtime authentication.
