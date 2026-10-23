-- NON-EXECUTABLE transaction templates. NOT installed RPC definitions.
-- Named parameters below describe bindings; API behavior is in api-contract.md.
begin read only;
do $$ begin raise exception 'CUTOUT_V2_DRAFT_ONLY'; end $$;

-- ALL MUTATIONS: verify readiness, exact authenticated/scoped caller, then:
-- 1. SELECT deletion_private.lock_writer(:owner); (owner gate FOR UPDATE)
-- 2. SELECT owned wardrobe_items row FOR UPDATE; verify current immutable
--    image_storage_path -> sha256(UTF8(path)) equals :original_version.
--    Reject missing item, URL-only original, missing V2 provenance marker.
-- 3. Lock job FOR UPDATE; capabilities/storage rows last, always same order.
-- No HTTP call occurs while any database lock is held.

-- RESERVE: owner is auth.uid(), never request owner field; request UUID required.
-- Under owner gate, find (owner,request) alias BEFORE inserting canonical job.
-- Existing alias with different tuple -> REQUEST_CONFLICT; entire TX aborts.
insert into public.wardrobe_cutout_jobs(owner_id, wardrobe_item_id, original_version)
values (:owner, :cloud_item_uuid, :original_version)
on conflict (owner_id, wardrobe_item_id, original_version) do nothing;
-- SELECT canonical row FOR UPDATE; INSERT alias to that row; ON CONFLICT must
-- compare exact canonical id, never rebind. Commit BOTH before returning.

-- EXECUTE: only RESERVED -> ARMED; CAS revision; capability hash persisted in
-- SAME transaction BEFORE any worker request. Hash-only token storage; returned
-- raw token is scoped, short-lived and never logged. Lost raw token => close
-- unclaimed with revocation proof or leave unresolved, never mint replacement.
update public.wardrobe_cutout_jobs
set state='ARMED', revision=revision+1, updated_at=clock_timestamp()
where id=:job and owner_id=:owner and state='RESERVED' and revision=:expected;
-- require row_count=1; insert CLAIM hash bound to resulting revision; COMMIT.
-- execute retries return existing sanitized state, not another provider delivery.

-- CLAIM: provider authenticates only via scoped capability to control Edge.
-- Edge verifies token hash, expiry, job/revision/stage, owner fence/current item.
-- Claim cap consume + RUNNING CAS + COMPLETE cap creation in SAME transaction.
update public.wardrobe_cutout_jobs
set state='RUNNING', claim_count=1, claimed_at=clock_timestamp(),
    revision=revision+1, updated_at=clock_timestamp()
where id=:job and owner_id=:owner and state='ARMED' and claim_count=0 and revision=:expected;
-- require row_count=1 and valid unused cap; otherwise rollback ALL changes.
-- Only committed positive claim authorizes CPU. Lost claim response => UNKNOWN,
-- NEVER return a replayed positive claim / takeover on lease expiry.

-- CLOSE UNCLAIMED: lock gate/item/job/cap; revoke cap before proof in same TX.
update public.wardrobe_cutout_jobs
set state='FAILED', failure_code='CLOSED_UNCLAIMED', non_dispatch_proven=true,
    revision=revision+1, updated_at=clock_timestamp()
where id=:job and owner_id=:owner and state in ('RESERVED','ARMED') and claim_count=0;
-- require 1; cap revoked in same TX. Failure/404/TTL alone NEVER creates proof.

-- COMPLETE (separate trusted sole-writer branch, NOT provider SQL access):
-- A. under gate/item/job/cap lock: RUNNING|UNKNOWN -> COMPLETING;
--    insert one storage_attempt ADMITTED, consume completion cap. Commit.
-- B. under gate/attempt lock: mark UNKNOWN + physical_dispatch_possible BEFORE
--    write. COMMIT. Existing UNKNOWN must use read-only reconciliation, no write.
-- C. account-storage-upload alone uploads fixed immutable target upsert=false,
--    checks fence after write and compensates its own object if fenced.
-- D. verify owned object digest/size/PNG via trusted writer evidence, re-lock
--    gate/item/job/attempt, compare original again, atomically set VERIFIED and
--    SUCCEEDED + bucket/key/digest/length/operation. No proof => stay unresolved.
-- E. late fence/item removal: no publication; drain/sweep/compensation tracked.
-- Completion cleanup after a fence needs existing lease-safe A1 finalization,
-- not lock_writer (which correctly rejects fenced owners). Binding is BLOCKED.
-- Never accept provider/client JSON saying "verified" as Storage proof.

-- STATUS/RESULT: STABLE, read-only, no claim/admission/update/signing side effect.
-- Auth owner + request alias -> current job; no alias -> UNKNOWN, not no-dispatch.
-- Result is returned only for live matching original, non-fenced owner and
-- SUCCEEDED+VERIFIED exact operation. Read URL signing is a separate owner/fence
-- checked, short-TTL gateway operation; durable identity is bucket/key/job/hash.

-- TOMBSTONE: item delete/original replace marks superseded jobs and revokes caps
-- under same gate/order; keep request aliases and dispatch evidence. No TTL reset.
-- A1 deletion: fence -> revoke all caps/admission -> physical writer drain ->
-- Storage API sweep/verify -> auth delete cascades these tables. Never SQL-delete
-- storage.objects or make stateless CPU acknowledgement a deletion dependency.
rollback;
