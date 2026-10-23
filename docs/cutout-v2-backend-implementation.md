# Cutout V2 backend implementation — 2026-10-21

Source implementation, **not deployed and not activated**. Historical design files
in `supabase/proposals/cutout-v2/` remain unchanged. V1, its request identities and
legacy provider UNKNOWN records are not migrated, reset or retried.

## Implemented source

| File | Behavior |
|---|---|
| `supabase/migrations/202610210001_cutout_v2.sql` | Transactional schema + real RPCs: canonical unique jobs, immutable owner/request aliases, capabilities hashed/scoped to stage+revision, one claim, owner RLS and denied raw DML. Installer role/A1 trigger and RPC prerequisites abort installation on missing guarantees. Admission defaults OFF |
| same migration: `wardrobe_apply_change_v2` | Authenticated **new-item-only** wrapper around existing apply validation, marks only the row created in that transaction. Existing item -> conflict. No legacy provenance backfill; old RPC unchanged |
| same migration: `cutout_v2_command`, `cutout_v2_read` | Reserve, arm, claim, source admission, completion admission/finalize, close-unclaimed, explicit reconciliation; status/result read by owner/request alias, including when the server job ID was not saved locally |
| `supabase/functions/_shared/cutoutV2Control.ts`, `wardrobe-cutout-control/index.ts` | Session-authenticated owner routes; job-scoped worker claim/source; execute makes one delivery attempt after commit. Stable allowlisted failures, no raw error logging. GET status/result never infer or mutate |
| `supabase/functions/_shared/accountStorageUploadHandler.ts`, `cutoutV2Png.ts` | OFF-by-default V2 completion in the **existing** writer; capability validation before body processing, bounded PNG structure/CRC/dimensions, actual-byte digest, immutable upload. Existing deadline, pre/post fence, compensation, start/succeed and terminal proof flow retained |
| `services/wardrobe-cutout/v2.py`, `server.py`, `Dockerfile` | Separate OFF-by-default V2 route. Positive committed claim required before CPU, then owner-scoped existing-original read and one completion attempt. No JWT/service key/SQL/Storage client in worker. Redirects disabled; V1 route unchanged |
| `services/wardrobeCutoutV2Api.ts`, `wardrobeCutoutV2.ts` | Dormant adapter and async ACK support. ARMED/RUNNING/COMPLETING is DISPATCH_POSSIBLE, never artifact success. Correlated SUCCEEDED maps to existing response contract; status uses durable request alias. No store activation, timer or polling |
| `services/accountDeletionRuntime.ts`, `deviceDeletionAdapters.ts`, `ownedDeviceFiles.ts` | Strict owner-scoped V2 journal/artifact inventory; corrupt metadata blocks coverage, other-account artifact references prevent unsafe deletion. Existing workflow drain retained |
| `supabase/config.toml` | New control route plus upload handler authenticate inside handler: session JWT for V1/owner, scoped capability for V2 worker. Gateway JWT check disabled for these routes to permit non-JWT worker capabilities; no unauthenticated write path |

The injectable API adapter's `invoke` port must be bound to the existing authenticated
Supabase SDK, returning validated `data` or throwing on `error`. It is not imported by
the live store. The adapter's `confirmed` callback must check the exact cloud UUID,
original version, owner generation, V2 provenance and item-specific pending mutations.

## Safety and A1 integration

- SQL owner always comes from verified session at Edge or the hashed job capability;
  clients cannot call command/read RPCs directly (service-role EXECUTE only).
- Original identity is SHA-256 of the exact UTF-8 immutable original path. Private
  reads independently require the exact owner/item/original-UUID PNG pattern; they
  do not trust an assumed upstream path constraint or a caller-selected URL.
- Gate serializes each owner's short SQL transitions. Claim count can only become
  one; no lease takeover, expired-token replacement, alias rebinding or implicit
  UNKNOWN resend. CPU crash/lost claim can sacrifice liveness, not paid-call safety.
- Completion uses **existing** `deletion_private.storage_operations`. Existing
  `storage_upload_start` persists UNKNOWN before bytes; `storage_upload_succeed`
  attests actual successful transport. V2 attempt metadata mirrors dispatch in the
  same database transaction via trigger, not a second physical drain mechanism.
- Job SUCCEEDED requires the exact verified operation + same owner/original. A
  crash after Storage commit can use owner `POST reconcile`; this only finalizes an
  existing SUCCEEDED operation. It cannot upload, start CPU or reinterpret missing
  Storage proof. GET status/result never call reconcile.
- Owner fence revokes V2 capabilities atomically. Item original changes/deletion
  tombstone jobs and revoke capabilities. Late completion cannot publish a stale
  original. Post-write fence uses existing writer compensation/drain/sweep.
- Jobs join existing public deletion inventory. Private aliases/caps/attempts cascade
  through job/auth owner FKs, retain dedup evidence until deletion, and carry no
  independent Storage writer. Device V2 work already uses existing tracked workflow;
  only inventory coverage was added. A1-dependent files changed within this task's
  explicit integration scope. S1/S2/S4/S5/S6/S7 mechanisms retained; actual A1 backend
  drain certification still requires deployment-matched acceptance evidence.

## Activation / rollback boundary

OFF controls: `CUTOUT_V2_ENABLED=false` in Edge shared source; Python V2 environment
flag defaults false; SQL readiness.enabled defaults false; client adapter defaults
disabled and is not wired to store. No existing item receives cutout_protocol=2.

Rollback after a future activation closes **SQL admission**, not cleanup: setting
readiness.enabled=false rejects reserve/execute/claim but permits valid already-
claimed source/completion/finalize/close/reconciliation. Keep operational Edge/CPU
routes and metadata available until admitted jobs are resolved/drained; do not use
the global source flag as an inflight rollback switch. Preserve read/status/result,
aliases/tombstones and A1 cleanup. Never downgrade an admitted job to V1.

Legacy owner/provider UNKNOWN still blocks the dormant client's new dispatch. V2
cannot prove the missing old provider request was never sent. The two old blocked
items and original photos are not recovered by this implementation.

## Validation and remaining blockers

- New control tests first failed because the module did not exist. Journal inventory
  tests then failed on its missing export; implementation made them pass.
- Targeted Jest: 5 suites / 40 tests passed; related regression batch: **14 suites /
  194 tests passed**, including V2 model, cloud journal, actual Storage handler,
  binary transport, owner workflow and deletion/runtime tests. No real network.
- Python V1+V2: **10 tests passed** with mocked transport/inference; no real rembg
  provider execution. Lost claim/duplicate/timeout/foreign completion fail closed.
- TypeScript passed with known archived Deno directory excluded in memory; config
  unchanged. Shared Edge Deno check passed. Entry points passed against locally
  installed Supabase SDK declarations using a temporary offline import map.
- Exact pinned JSR SDK Deno check could not complete: package metadata was absent
  from local cache. No package installation or dependency change was made.
- ESLint: two existing `no-unsafe-finally` errors in `services/ownedDeviceFiles.ts`
  at lines 85/87; reconstructing the file in memory without this task's namespace
  edits produces the same errors. Other changed client/test files lint clean.

**Not production ready yet:** PostgreSQL execution/concurrency/RLS/FK-cascade tests
were not run (no local PostgreSQL available). Static SQL assertions and a serialized
reference model do not prove database behavior. Before applying this migration,
validate the exact installed A1/wardrobe base schema and run concurrent reserve /
claim-vs-close / complete-vs-fence / cascade tests in an explicitly approved isolated
environment. Do not infer current production deployment state from repository code.

Hosting/TLS/reachability, CPU capacity and real latency remain **UNKNOWN**. Docker
build/start and HTTPS checks were not run. The current listener itself remains HTTP;
an approved TLS proxy is needed. Future CPU settings: V2 flag, trusted HTTPS
`CUTOUT_V2_FUNCTIONS_BASE` ending in `/functions/v1`; control Edge requires a trusted
HTTPS `WARDROBE_CUTOUT_V2_PROVIDER` origin. No credentials go to Python.

Before activation also approve/apply the migration and Edge/provider deployments;
verify installed sole-writer coverage/drain attestation; bind the dormant SDK API
and owned-artifact adapter, new-item-only V2 creation and bounded lifecycle
reconciliation in the store; keep the legacy barrier; confirm operating budget and
obsolete-artifact retention. No TTL/tombstone reset or retention janitor was added.
Current results remain private references, not persisted signed URLs.

No production/staging connection, SQL application, deploy, real upload/cutout, journal
cleanup or AAB build was performed. Further application/activation needs separate
approval; the source flag remains OFF.
