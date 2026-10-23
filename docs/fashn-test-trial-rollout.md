# FASHN test trial: new accounts only — NOT DEPLOYED

## Policy and minimal delta

`supabase/proposals/fashn_test_trial.sql` now excludes **every** account visible at installation, regardless of usage history. The reported 11 production accounts (including 9 without evidence) receive no new right; the snapshot takes the actual account set at execution, not a hardcoded count.

A private singleton `fashn_test_policy.eligible_after` is set once by PostgreSQL to `clock_timestamp() + interval '30 minutes'`. RLS has no client policies; anon/authenticated/service_role have no direct table access. No app/RPC argument supplies or changes this boundary. Flag toggles never reset it.

Effective controlled activation is this future database instant **T**, not the earlier flag-setting operation. Arm `VTON_TEST_TRIAL_ENABLED=true` before T. Until T the RPC denies every account. Afterwards only an Auth row with `created_at > T` and `created_at <= server check time` is eligible. Equality, null/future timestamps, absent policy and accounts created during the paused deployment interval fail closed. Late-committing signup transactions with `created_at <= T` are excluded even if missing from the initial snapshot. All initially snapshotted accounts stay excluded even if an administrator later changes their timestamp.

The existing unique active-request index, owner transaction lock, request hash/lease, pre-dispatch release, UNKNOWN/no-refund behavior, A1 fence/provider admission and Auth cascades remain unchanged. `fashnTrial.ts` returns HTTP 403 / `trial_ineligible` without entering provider work. Existing status `used` remains a compatibility availability signal: true also means excluded/ineligible; an excluded account is never advertised a free available trial. Normal Free/Premium policy remains unchanged when the temporary overlay is off. Legacy UNKNOWNs are not modified or bypassed.

## Exact production order — separate approval required

1. Verify every deployed production FASHN `/run` route, including shared imports/forwarders. Route-name metadata alone is insufficient. If any alternate route is unverified or bypasses the quota, keep paused and **do not set true**. Target only `hnujkabyyrlsxohjhxlg`.
2. Deploy the approved proxy/shared source with `VTON_TEST_TRIAL_ENABLED=paused`. Confirm all FASHN admission paths are paused and older invocations have drained before SQL. No SQL snapshot while an old caller can still dispatch.
3. Apply the approved SQL package once while paused. It stores T 30 minutes ahead and permanently snapshots all then-visible accounts. Read T, the all-account exclusion count, RPC ACL and the immutable policy row. Do not grant an exception to the 9 accounts without usage evidence.
4. Ship the existing UI/service integration; verify the deployed proxy uses the reviewed quota RPC and there is no alternate provider path. All verification and the flag update must **finish before T**, with operational margin. Then set the flag to true. RPC admission stays closed until T; deployment-window accounts remain excluded permanently.
5. If step 4 cannot finish before T, keep/restore paused and **do not activate against an elapsed boundary**. A later boundary requires a separately reviewed SQL rescheduling step while paused/drained; never reset usage, identities or UNKNOWN rows. This package supplies no automatic rescheduling/reset.
6. At T the armed overlay becomes effective. Only accounts created strictly after T can receive one trial. Any real paid acceptance call needs separate authorization; none was performed here.

The boundary is server-persistent, account-specific and unaffected by reinstall, logout, device switch or switching to another pre-activation account. Creating an entirely new post-activation account is a new account, not a restored right for an old account; this is not a per-person anti-signup policy.

## Rollback

Set `paused` first and stop new admission. Keep the policy row, all exclusion/request rows and UNKNOWN states. Do not reopen an old quota-bypassing proxy. Returning the flag to true later must retain the original T and exclusions. Only the separately approved end of the trial period may restore the previous Free/Premium behavior with false; no entitlement history is erased.

## Validation boundaries

The previously accepted PostgreSQL 40 checks/concurrency result belongs to the previous base package and was not rerun. This delta is verified separately by targeted new-account policy tests, not another concurrency batch. No production/staging SQL, deployment, flag update, provider request, history reset or user data change was made. Production alternate-route verification is still an activation blocker.

The 3 new policy Jest tests failed before implementation. The exact SQL then passed 10 sequential new-policy checks in an isolated PostgreSQL fixture: all old accounts without history, before/equal/after cutover, deployment window, future/null Auth timestamps, durable old-account exclusion, second-request denial and missing policy. No database concurrency batch was rerun. A pre-existing mocked Edge test assumed request r1 always won asynchronous hashing; its assertion now replays whichever request actually won, preserving the one-provider-call and replay-denial assertions. TypeScript passed excluding only the known archived build; changed helper/tests ESLint and standalone Deno check passed.
