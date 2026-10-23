# Cutout State Machine V2 — dormant client infrastructure

## Activation status

Not imported by the wardrobe store or the existing cutout service. No production
backend or artifact adapter is provided. `run` rejects a new dispatch when the
V2 backend port is absent. This does not fix or reinterpret existing device jobs.
No environment flag can turn the current stateless provider into this contract.

## Identity and local transitions

Each job uses owner + wardrobeItemId + originalVersion and one durable request.
originalVersion must be a SHA-256 of the stable original-photo identity, not a
rotating signed URL or a metadata-only row revision. The future store adapter
must verify that the owner, item and original still exist at every boundary.

| State | Allowed progress |
| --- | --- |
| PRE_DISPATCH | Local preparation only; at most two durably counted attempts. Only the explicit transient preparation error retries automatically. |
| DISPATCH_POSSIBLE | Stored and read back before dispatch. A crash/timeout remains ambiguous, even if dispatch never actually began. No automatic redispatch/status polling. |
| RESPONSE_OBSERVED | Owner, item, original, request and result identity match. Recover that existing result only. |
| ARTIFACT_SAVED | PNG digest, owned-file verification and job checkpoint succeeded. Reverify before returning to a future Storage continuation. |

Job updates use a single AsyncStorage value, existing global write guard,
expected-record comparison and read-back. Malformed records or failed checkpoints
fail closed. These are the existing single-JS-runtime checkpoint guarantees,
not a new cross-process transaction or physical power-loss durability claim.

The dispatch callback starts inside the guard after its checkpoint. Only its
boxed promise escapes the lock. The enclosing tracked workflow awaits the real
provider settlement and preparation cleanup; deletion cannot mistake abort for
drain. Publication still requires the existing store generation/owner checks.

## Legacy safety

No v1 keys or item states are changed. New admission requires a pending item and
a durable `cutoutProtocol: 2` marker written ONLY at new-item creation by the
future store adapter. It must never be synthesized or backfilled for old items.
Even legacy pending items cannot be upgraded. Any unmatched legacy
wardrobe-provider UNKNOWN blocks new V2 dispatch, including an UNKNOWN that
appears during preparation. V2 jobs can be isolated by their own known identity;
that is not evidence permitting isolation of old unmatched intents.

## Missing adapters / release prerequisites

1. A reviewed owner-bound provider V2 status/result/idempotency implementation.
   The current JSON `pngBase64` handler is insufficient. A label on a port is
   not verification of a deployed backend. NOT_FOUND never proves non-dispatch.
   `reconcile` is an explicit read-only operation, not an automatic retry loop.
2. An artifact adapter that reads only the identified existing result, validates
   PNG/digest/ownership, uses existing owned-file guards/ledger, and idempotently
   recovers a file written before its job checkpoint. No inference fallback.
3. A store adapter preserving generation, item/original identity, cloud-save
   confirmation, durable new-item provenance and the existing Storage UNKNOWN reconciliation/upload/signing.
   `ARTIFACT_SAVED` does not mean Storage or cloud completion.
4. **A1_DEPENDENCY:** include the new owner-scoped V2 job-key namespace in the
   approved account-deletion inventory/cleanup contract before activation.
   Existing deletion adapters were intentionally not modified. Original files,
   legacy provider journals and unresolved evidence must not be discarded.
5. A real-device acceptance check of native preparation, cleanup, bounded network
   settlement and account switching. This implementation makes no device-speed
   or provider-availability claim.

The backend port is implemented only by network-free controlled tests here.
Until these prerequisites are satisfied, production V2 activation is NO-GO.
