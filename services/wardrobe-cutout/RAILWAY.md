# V1 HTTPS deployment — prepared, NOT deployed

Use Railway Hobby, one service, one replica, EU region. Existing Dockerfile,
CPU u2netp and POST /v1/wardrobe/cutout remain the contract. No Supabase SQL,
Edge deployment, V2 activation or legacy journal changes are required.

## Approval/account step

The user must sign into Railway and approve paid Hobby hosting and the first
production deployment. Nothing in this package creates an account or deploys.
Create an empty project/service named `vitrify-cutout-v1` with automatic GitHub
deployments disabled. Set its resource limits to 1 vCPU / 2 GB RAM, one replica,
Serverless OFF (avoid model-load cold starts), and no persistent volume.
These are initial limits, not a measured RAM guarantee. If the process hits OOM,
stop the test and report it; do not repeatedly submit the photograph.

Set an explicit Compute hard spending limit in Railway Workspace Usage, e.g.
$25/month if approved. This can take the service offline when reached; it is
not a guarantee that inference is always available. Do not create databases.

## Service variables (dashboard only; never print their values)

| Name | Setting |
| --- | --- |
| SUPABASE_URL | Main project `hnujkabyyrlsxohjhxlg` HTTPS URL |
| SUPABASE_ANON_KEY | Existing main-project anon key; NOT service-role |
| HOST | `0.0.0.0` |
| PORT | `7010` |
| WARDROBE_CUTOUT_MODEL | `u2netp` |
| WARDROBE_CUTOUT_V1_REQUESTS_PER_MINUTE | `12` |
| WARDROBE_CUTOUT_V2_ENABLED | `false` |

Docker already sets U2NET_HOME=/models and OMP_NUM_THREADS=2 and downloads the
model during build. No new runtime model host, Storage writer or server key in
the mobile app is needed. Use Railway's HTTPS domain, never a public TCP port.

## Deploy ONLY after explicit user authorization

With Railway CLI installed, sign in using `railway login`, then `railway link`
and explicitly select that project/service and its production environment.
From the Vitrify repository root the authorized deployment command is:

```powershell
railway up ./services/wardrobe-cutout --path-as-root --service vitrify-cutout-v1 --environment production
```

Service Root Directory must be `/`, Dockerfile `/Dockerfile`, configuration
`/railway.toml` for this subdirectory archive. Do not deploy the repository root.
The ignore allowlists exclude .env, local models, .venv, photos and test files.
Do not use `--no-gitignore`, debug request logging or APM body capture.

After a successful build/healthcheck, Settings > Networking > Generate Domain,
target port 7010, provides the actual HTTPS hostname. No hostname exists yet.
Before connecting the app, check only GET /health (200 + ok:true) and a POST
with no JWT/body (401); the latter never authenticates remotely or runs CPU.
Do not submit a test image or actual JWT from tooling.

## Authentication, abuse controls and photo privacy

- Every V1 image request validates the user's Bearer JWT via the configured
  main project's Auth API. Missing/invalid tokens and anonymous Auth users are
  rejected. A paid plan or app secret in the mobile bundle is not an auth gate.
- Service-wide 12 attempts/minute, including rejected auth, bounds auth traffic.
  It is process-local, resets on restart, and requires exactly one replica.
  Excess returns 429; CPU contention returns 503. These are not proof of a
  non-dispatched client request and MUST NOT reset/retry old UNKNOWN journals.
- Eight HTTP workers, 20-second socket timeouts, one CPU inference, JPEG-only,
  12 MiB input/output and the existing pixel limit bound resource use. This is
  bounded public exposure, not a guarantee against denial of service.
- Service code uses image bytes in memory, strips output EXIF/GPS, writes no
  photos to disk, suppresses access logs and returns Cache-Control:no-store.
  It sends no image to an external inference API. HTTPS terminates at Railway,
  which is a photo-processing infrastructure provider; do not claim it sees no
  data or promise forensic memory erasure/provider deletion certification.
- Keep HTTP request/response bodies, headers, JWTs and tracing capture disabled.
  Review app privacy disclosures for the hosting processor before public release.
  No Storage credentials or service-role are supplied to the Python service.

## Connect and perform ONE Android acceptance test

Only once the real HTTPS domain passes the no-inference checks, replace the
existing EXPO_PUBLIC_WARDROBE_CUTOUT_URL in local .env (do not add duplicates):

```dotenv
EXPO_PUBLIC_WARDROBE_CUTOUT_URL=https://<actual-railway-domain>/v1/wardrobe/cutout
```

Restart Metro from the repository root: `npx expo start --clear`. Reopen the
updated Expo Go bundle. Use a clean account with no owner/provider UNKNOWN and
add one garment. Expect cloud synced/pending=0, automatic cutout, then updated
card. Check safe wardrobe_stage_timing / wardrobe_cutout_failure stage/code
only if it fails. Do not repeat submission, clear app data, delete/reset old
journals or interpret V1 HTTP failure as permission to redispatch.

If admission returns 429/503 or the response is lost, V1 intentionally retains
UNKNOWN/blocked; this deployment does not repair that existing recovery limit.

Rollback: stop new app submissions and the provider service; retain originals,
Storage/journals and UNKNOWN records. Restore only the previous app endpoint
configuration if that service is available. No automatic replay on rollback.

## Cost estimate (not a measured bill)

Railway Hobby has a $5 monthly minimum credited toward usage. Listed rates are
$10/GB-month RAM, $20/vCPU-month CPU, $0.05/GB egress. Example average usage
0.5–1 GB RAM and 0.05–0.2 vCPU is approximately $6–14/month plus egress/tax;
budget $10–20 initially. A fully occupied 1-vCPU/2-GB instance is about $40/month
plus egress, so the hard limit is important. Allocated limits are not the bill.
Memory, latency and build viability remain unmeasured on Railway.

References: https://docs.railway.com/pricing/plans ,
https://docs.railway.com/pricing/cost-control ,
https://docs.railway.com/cli/deploying ,
https://docs.railway.com/networking/public-networking .
