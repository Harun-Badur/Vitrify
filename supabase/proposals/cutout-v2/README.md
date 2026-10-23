# Cutout V2 — draft implementation package

**UNAPPLIED / DISABLED / NO-GO for production activation.** This directory is
outside migration discovery and Edge deployment sources. SQL starts with read-only
transaction + unconditional exception and ends with rollback. Transaction templates
also contain unbound `:parameters`; they are deliberately not installable RPCs.
No keys, runtime adapters, database connections, provider calls or live store wiring.

## Deliverables and evidence limits

- `001_schema.draft.sql`: canonical jobs, request aliases, hashed capabilities,
  sole-writer attempt metadata; FK/cascade, constraints, denied DML, owner RLS.
- `002_transactions.draft.sql`: transaction ordering/CAS/claim/completion/deletion
  templates. **Not complete executable function definitions.** Exact A1 and original
  provenance bindings must be reviewed before generating an installable migration.
- `api-contract.md`: reserve/execute/claim/complete/status/result, failure meanings,
  request aliasing, safe storage and retention contracts.
- `protocol.draft.ts`: pure offline reference model, no IO or runtime imports.
- `../../../__tests__/cutoutV2BackendDraft.test.ts`: model safety tests; existing
  client tests remain separate. A green model test is not SQL concurrency, RLS,
  capability crypto, physical drain or hosting evidence.

No current migration, SQL source, Edge function, Python provider, V1 client or journal
is modified. V2 remains dormant. This package does not repair the two legacy items.

## CPU provider inspection

Sources: `services/wardrobe-cutout/server.py`, `processor.py`, `Dockerfile`,
`requirements.txt`, `start.ps1` (repository-relative references in this document).

| Observed implementation | Requirement / unverified point |
|---|---|
| Python 3.12 image; rembg[cpu] 2.0.67, CPUExecutionProvider; model downloaded at build | Build/model availability, image digest, host CPU/RAM, restart policy, capacity and cost **UNKNOWN**; nothing built/started here |
| ThreadingHTTPServer on 7010; Docker HOST 0.0.0.0; `/health` | HTTP only in source; reachable production HTTPS, trusted certificate, reverse proxy, routing/DNS/firewall and Edge-to-worker reachability **UNKNOWN** |
| `SUPABASE_URL` must be HTTPS, bearer verified at `/auth/v1/user` with 10s timeout | This validates Auth upstream transport, not TLS on provider listener. Current auth returns bool and does not bind item/job/request; cannot implement V2 claim |
| POST `/v1/wardrobe/cutout`, normalized JPEG, 12MiB bound; 200 pngBase64 | No durable idempotency, status, result, scoped worker capability, claim or completion; V1 must not be represented as V2 backend |
| One process inference lock, busy503; 20s socket timeout | Lock does not coordinate replicas/restarts. Socket timeout is not inference deadline; durable DB claim is mandatory before CPU |
| Processor EXIF transpose/RGB, 40Mpx limit, 1600px thumbnail, RGBA mask, metadata stripping, <=12MiB PNG | Original private object remains unchanged; preserve current output policy. RAM peak/CPU duration and quality on target devices **UNKNOWN** |

Minimal hosting: existing CPU container behind trusted HTTPS; job-scoped read and
completion connectivity to Supabase; bounded ingress/concurrency and RAM; model
cached in image; no photo persistence/logging. Proxy access logs must not expose
headers, query tokens, object paths or payloads. No photo/job data in health probes.
Deployment readiness cannot be inferred from Docker EXPOSE or localhost startup.
No new paid provider dependency is proposed; hosting/egress/storage are still costs.

## File-by-file future integration (not performed)

| Existing / proposed file | Required binding and acceptance gate |
|---|---|
| `services/wardrobeCutoutV2.ts` | Extend dormant backend port for reserve + async execute acknowledgement; preserve durable DISPATCH_POSSIBLE before external dispatch; no automatic resubmission on UNKNOWN |
| `services/wardrobeCloudPersistence.ts`, `services/wardrobeService.ts`, `types/wardrobe.ts` | Map local ID to cloud UUID; optional snapshot cutoutVersion/originalVersion/result ref; durable new-item provenance marker only; V1 photoVersion=1 unchanged |
| `store/wardrobeSlice.ts`, `lib/wardrobeCutoutState.ts`, `hooks/useWardrobeCutoutResume.ts` | Item-specific confirmation: current owner/generation + owned cloud UUID + matching original + no pending mutation for that item, not global pending=0. Keep unmatched legacy provider UNKNOWN admission barrier. Publish only current original after Storage verification; key images by result/version; no manual button or polling |
| proposed `supabase/functions/wardrobe-cutout-control/*` | JWT owner routes, scoped worker routes, exact SQL RPCs, status/result without inference, fixed safe diagnostic codes; **no Storage writes and no credentials given to CPU** |
| `services/wardrobe-cutout/server.py` | Separate V2 route, claim-before-inference, bounded existing-original read, completion via scoped capability to sole writer. Claim response lost => no CPU retry. Keep V1 route untouched |
| `supabase/functions/_shared/accountStorageUploadHandler.ts`, `accountStorageAdmission.ts`, `accountStorageReconciliation.ts`, `accountStorageUploadLimits.ts` | **A1_DEPENDENCY**: separate V2 completion discriminator/admission/verification, same physical writer, no broadening V1 paths or retry semantics. Retain pre/post fence and compensation; validated binary transport |
| `supabase/functions/_shared/accountStorageBarrier.ts`, `accountDeletionExecution.ts`, `accountDeletionCoordinator.ts` | **A1_DEPENDENCY**: writer revision/coverage must include new capabilities/attempts and physical drain. Metadata flags alone are insufficient. Fail closed until evidence binding passes |
| `supabase/functions/_shared/accountDeletionStorage.ts`, `accountStorageJanitor*.ts` | **A1_DEPENDENCY**: existing owner-prefix sweep covers V2 immutable paths, but stale/late-write janitor and no-live-reference retention need validation; Storage API only; no second writer |
| `services/deviceDeletionAdapters.ts`, `services/accountDeletionRuntime.ts` | **A1_DEPENDENCY**: recognize `vitrify.wardrobe-cutout-jobs.v2.` owner namespace; strict V2 parse/owner validation, inventory/read-back/cleanup under existing fence and post-auth recovery. Do not smuggle keys into privacy-only extraOwnedKeys |
| `lib/accountDeviceWork.ts`, `lib/accountWriteFence.ts` | Preserve short guards + full tracked workflow/native cleanup drain and generation suppression. Add adapters using existing mechanism; do not hold exclusive guard across CPU/network or weaken deletion |
| Existing A1 SQL inventory/lease cleanup bindings | **A1_DEPENDENCY**: public jobs plus private aliases/caps/attempts. Current public-table inventory cannot be blindly extended with private schema names. Explicit lease-validated cleanup required; owner cascade is final safety net, not physical drain |

The result remains a separate cutout manifest; never replace `image_storage_path`
with a cutout. Updating a result should not silently rewrite wardrobe row versions
or invalidate pending `expected` CAS. Optional snapshot projection must preserve
old clients and exact expected-version semantics. Lock-order review must include
normal item apply/delete; current A1/wardrobe code cannot be assumed compatible.

## Blockers, smallest application order, and rollback

1. **Approve A1 dependency scope**: shared gate lock order, deletion inventory,
   capabilities revoked on fence, physical writer drain and fenced finalization.
   Current barrier revision cannot be attested to cover an unimplemented V2 branch.
2. Finalize provenance/originalVersion snapshot contract and retained item tombstone
   hooks. Agree obsolete-PNG retention (seven-day proposal) and operating budget.
3. Generate separately reviewed executable SQL/RPCs from templates, still disabled;
   test transaction races, FK deletion cycles, ACL/search_path and exact live schema
   in an explicitly authorized disposable environment. No application in this task.
4. Implement reviewed control Edge + separate sole-writer V2 mode + CPU V2 route;
   validate HTTPS/capability hashing and secrecy, streamed PNG verification, bounded
   late-writer compensation. No provider status guarantee exists today.
5. Add client/device inventory adapters and bounded resume, V2 marker only for new
   items. Do not enable for legacy. Existing unmatched UNKNOWN remains protected.
6. One consolidated acceptance run after explicit test-environment authorization;
   then separate production approval, allowlist/flag rollout, operational monitoring.

Rollback closes **new admission only**. Preserve schema, aliases, capabilities
revocation/status/result, UNKNOWN evidence, writer reconciliation and deletion
cleanup for admitted jobs. Never downgrade inflight V2 jobs to V1, drop metadata,
reset identities, re-infer, or revoke necessary cleanup code while work may remain.

## Acceptance plan and safety coverage

Offline model: two devices/canonical aliases, duplicate claim, failed commit before
dispatch, timeout/crash/UNKNOWN, non-dispatch closure vs late claim, immutable result,
Storage UNKNOWN recovery without write, original replacement/item removal, owner
isolation, deletion fence/drain/sweep, independent V2 items, legacy UNKNOWN barrier.
Existing client tests cover account switching/generation and device workflow drain.
These are design checks, not certification of not-yet-built backend adapters.

Before activation: concurrent SQL reserve/claim/close; capability replay/expiry/hash;
complete-vs-fence/item-delete races; actual writer crash-after-upload and reconciliation;
no unauthorized Storage DML; result signing ownership; A->B->A late callbacks; offline
reopen after each client checkpoint; deletion with CPU/Storage inflight; legacy data
unchanged. One consolidated device scenario must verify confirmed new item -> one CPU
claim -> verified private result -> automatic UI, plus kill/reopen and slow network,
without polling, manual action or duplicate inference. Requires separate approval.

A1 mapping: S1/S2 fence+sole writer+drain; S4 atomic canonical/claim;
S5 private bucket/no client writes; S6 CPU has no Storage/DB write rights;
S7 existing janitor/compensation. These scenarios are **planned**, not closed by model
tests. External RAM-only photo processing is a declaration under I5, not a deletion
vendor dependency. No new threat scope or current A1 behavior is introduced.

Production operations, hosting changes, any SQL/Edge deployment, capability/credential
configuration, A1 runtime modifications and eventual activation require separate
explicit approval. No production or staging connection was made for this package.

## Local validation — 2026-10-21

- Test-first red: new test suite failed module resolution before the reference model
  existed (zero assertions ran); this does not reproduce an existing product bug.
- Targeted offline model: 13/13 passed after implementation.
- One related regression batch: 6 suites / 81 tests passed, including the new model,
  dormant V2 client, account workflow, Storage admission/binary transport and device
  deletion files. No network/provider/Storage request was made.
- ESLint passed for the two added TypeScript files.
- TypeScript passed with the previously known archived Deno directory
  `tmp/google-dev-build-archive-20261014-verified/**` excluded in memory; tsconfig
  unchanged. This is not a claim that the unfiltered archive compiles.
- No deployable Edge source changed: no Deno check. SQL was not executed/parsed by
  PostgreSQL, provider not run, production deployment/HTTPS/physical drain UNKNOWN.
