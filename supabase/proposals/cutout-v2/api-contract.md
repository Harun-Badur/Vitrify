# Cutout V2 API and persistence contract — unapplied proposal

Protocol `vitrify.cutout.v2`; all endpoint names below are **proposed, not deployed**.
Readiness: **NO-GO for activation** until README blockers and A1 review are closed.
No existing V1 endpoint, payload, journal or UNKNOWN is changed by these drafts.

## Identity and admission

Owner always comes from verified Supabase session, not JSON. Item is the server
`wardrobe_items.id` UUID, never an unmapped local ID. `originalVersion` is lowercase
SHA-256 of the exact UTF-8 immutable `image_storage_path` (no Unicode normalization,
URL encoding, signed URL or updated_at). The server derives it from its owned row
and returns it in a future snapshot extension; client echo must match. Reusing or
overwriting an original path is forbidden. URL-only originals cannot enter V2.
Existing `photoVersion:1` means original-photo schema support, **not V2 support**.
A separately versioned optional `cutoutVersion:2` capability and durable new-item
provenance marker are required; absent marker means legacy. No backfill.

Canonical key: `(owner, cloudItemUUID, originalVersion)`, UNIQUE for owner lifetime.
Request alias key: `(owner, clientRequestUUID)` -> immutable canonical job.
Two devices may use different request UUIDs and get one job. Reusing a request for
another tuple returns `409 REQUEST_CONFLICT`. Response echoes **that caller's alias**,
not another device's alias. Failed/UNKNOWN jobs retain canonical identity and aliases.
No content hash or tuple equality is used to authorize another owner.

All mutation RPCs: readiness first; gate lock `deletion_private.lock_writer(owner)`
then item row, job row, capability and storage-attempt rows. Fixed schema-qualified
names/search_path, explicit argument types, bounded input and fixed error codes.
Never keep SQL locks during HTTP. Item mutation/deletion must use the **same** lock
order; changing only the job RPCs cannot establish this guarantee.

## HTTP operations

Owner operations use verified `Authorization: Bearer <session>` through the normal
Supabase SDK session path. Worker operations accept only opaque, single-stage job
capabilities to the control Edge; never give the Python worker JWT/service-role/SQL
access. Capabilities are random >=256-bit secrets, stored only as SHA-256, scoped to
job+owner+original+stage+revision, expiring and single-consumption. No query tokens.
No HTTP redirects for credentialed calls. All responses `Cache-Control:no-store`.
Never log headers, bodies, alias/job/owner IDs, paths, URL or capability.

| Proposed route / caller | Input | Successful meaning | Errors and replay |
|---|---|---|---|
| `POST wardrobe-cutout-control/reserve` / owner | JSON `{protocol,itemId,originalVersion,requestId}` | 200 canonical `jobId`, caller alias, identity, revision, sanitized state; durable canonical+alias committed together; no inference | 401 auth; 403 fence/owner; 409 original/request conflict; 503 V2_DISABLED; response lost: same reserve is idempotent |
| `POST .../execute` / owner | JSON `{protocol,jobId,requestId,expectedRevision}` | 202 after atomic RESERVED->ARMED + claim-cap persistence, then at most one delivery attempt; not inference success | repeated execute reads current state without redelivery; missing/expired cap is unresolved, not permission to mint another |
| `POST .../claim` / CPU worker | JSON `{protocol,jobId}` + scoped claim capability header | 200 `claimed:true` **only for the single newly committed** ARMED->RUNNING transition, completion capability returned | duplicate/lost claim response: 409 CLAIM_UNCERTAIN, never repeat `claimed:true`; CPU must not start on timeout/error |
| `POST account-storage-upload` V2 completion mode / worker | binary `image/png`; scoped completion capability; protocol/mode discriminator; no caller-selected path/owner; bounded <=12MiB | 200 only after trusted writer confirms private PNG and matching job/original/fence, commits SUCCEEDED and verified result ref | 202 unresolved Storage outcome; no blind resend; digest mismatch409; invalidPNG422; fence403; expired cap403 |
| `POST .../close-unclaimed` / owner | JSON exact alias/job/revision | 200 FAILED + nonDispatchProven only if no claim exists and all claim capabilities revoked in same TX | CAS/claim conflict409; no automatic re-arm in first release |
| `GET .../status` / owner | job or alias selector, authenticated | 200 `{protocol,state,revision,nonDispatchProven,reasonCode?}`; no claim/inference/mutation | absent/unmatched -> UNKNOWN; unauthorized indistinguishable 404; neither is non-dispatch proof |
| `GET .../result` / owner | exact job/alias selector | 200 correlated verified result manifest for SUCCEEDED/current original | 202 result not available, 404 inaccessible/unknown; never computes result |

Reserve/execute/status/result are control-plane requests, not photo uploads.
The new execute delivery requires a bounded normalized JPEG source for CPU. Minimal
option: CPU receives a job-scoped read capability and asks control Edge for an
owner-checked read of the **existing private original**; normalizes EXIF/RGB locally
in RAM using the existing processor bounds. This is not a second Storage writer.
No arbitrary URL fetching or caller-selected bucket/key is accepted. A failed source
read **before claim** can close unclaimed; after positive claim it cannot trigger
another CPU run. Exact streaming limit/timeouts and capability transport require
implementation review. Do not send prepared client JPEG bytes to claim/status.

`execute` cannot promise both eventual inference and exactly-once inference across
crashes. Chosen safety: at most one automatic inference per canonical job; a lost
positive claim or CPU crash may permanently lose liveness. Recovery status never
starts CPU. A durable late result can still complete the **same** job/capability.

## State meanings and client mapping

| Server state | Durable evidence | Client / recovery |
|---|---|---|
| RESERVED | No claim capability armed | local PRE_DISPATCH; bounded local preparation retries only |
| ARMED | Claim possible; token persisted before delivery | DISPATCH_POSSIBLE; never infer non-dispatch from timeout |
| RUNNING | One committed claim | DISPATCH_POSSIBLE; no lease takeover, no retry inference |
| UNKNOWN | Claim exists but result not known | retain current photo; read-only reconciliation |
| COMPLETING | Same claimed result, one Storage attempt | no inference; reconcile exact writer attempt |
| SUCCEEDED | Verified PNG + immutable private ref + current original | RESPONSE_OBSERVED then ARTIFACT_SAVED after owned local PNG verification |
| FAILED | Fixed failure evidence, may include paid inference | no inference retry; only `nonDispatchProven` allows a separately reviewed new-generation policy |

Read projection can map stale RUNNING/COMPLETING to UNKNOWN without changing DB.
NOT_FOUND/404, expiry, process exit and generic FAILED never prove non-dispatch.
Positive proof needs atomic cap revocation + claim_count=0 under the same claim lock.
New generation/reset is deliberately not implemented: canonical uniqueness persists.

Current `services/wardrobeCutoutV2.ts` backend port cannot represent async 202,
RUNNING or FAILED; do **not** install an adapter pretending dispatch returned a
result. Later extend the dormant port to represent reserve/execute acknowledgement
and explicit status observation. Normal lifecycle resume does bounded metadata reads,
not polling; optional sanitized realtime hint can trigger one correlated status read.
No artificial Promise waiting for an unbounded backend job.

Result manifest contains jobId, caller requestId, cloud item UUID, originalVersion,
PNG sha256, byteLength, bucket=`wardrobe-cutouts`, immutable key and resultId=jobId.
The persisted key is server-generated (SQL constraint); a signed **read** URL is
short-lived delivery only and is never persisted as result identity. Signing is a
separate authenticated/current-owner/fence-checked read-gateway operation.
No signed upload, TUS, client Storage DML or public bucket.

## Sole-writer completion / physical crash window

1. CPU calls the existing `account-storage-upload` **new disabled V2 branch**;
   validates capability, actual PNG signature/decode/digest/size, not just MIME.
   Job lock consumes cap and creates exactly one durable Storage attempt before IO.
2. Durable ADMITTED->UNKNOWN/physicalDispatchPossible precedes transport. Exact
   immutable object path is derived from job, `upsert:false`. Existing v1 admission
   RPC rejects this path and service-role admit: **do not reuse/broaden it**.
3. Physical writer checks fence before and after Storage. Known late fenced write
   is compensated through the existing writer/deletion protocol. Unknown stays
   tracked; absence is not safe non-dispatch. Digest match requires trusted actual
   object verification, never metadata provided solely by CPU/client.
4. Under same lock order, verify current original and commit Storage VERIFIED +
   job SUCCEEDED + reference atomically. Lost response can read/reconcile this exact
   job; unknown upload must not be sent again. Provider PNG response without cloud
   completion is not success. No independent DB publish from CPU.
5. Fence/original change after physical write prevents publishing, retains evidence
   for compensation/sweep. Finalization after fence needs a separate lease-safe A1
   cleanup binding. A client `writer:true` or `drain:true` field is never evidence.

## Retention / cost / deletion

Keep successful result while referenced by the current original. Superseded/item
deleted jobs become tombstones; revoke capabilities, never delete aliases or UNKNOWN
dedup evidence by TTL. Keep minimal job/request metadata until owner deletion;
retention period for obsolete PNGs is a product approval (proposal: seven days after
verified no-live-reference **and physical drain**, not seven days after timeout).
Provider uses bounded RAM only, metadata stripped; no image/body disk logs/backups.
GPU/paid API is not introduced, but CPU hosting, egress, private result storage and
control requests have costs: actual rate/latency/budget UNKNOWN until hosting chosen.

Auth owner FK cascades jobs and private tables. Item UUID is a retained historical
identity, not an item-cascade FK. Deletion of an item must tombstone under the common
gate. Account deletion must revoke all job capabilities under fence, drain every
possible **Storage writer**, Storage API sweep+verify, then auth delete/cascade.
Stateless CPU may finish but cannot claim/write after fence/auth removal; deletion
does not wait on a vendor acknowledgement. No SQL delete of storage.objects.

Legacy unmatched owner/provider UNKNOWN still blocks new dispatch. V2 job records
cannot retroactively prove the old request was never dispatched. Existing two
blocked items remain intact; only correlated existing artifact/result or trustworthy
old request evidence permits recovery, under a separate decision.
