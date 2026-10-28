# recs-feed v14 backup (copy)

Copy of reports/release/recs-feed-v2-dashboard-rollback-20261013: the function source read from the
Dashboard on 2026-10-13, the day live recs-feed v14 was last updated. It is complete for the bundler
(index.ts, _shared/*, lib/catalogMetadata.ts, deno.json, deno.lock; see manifest.json).
Not byte-verified against v14: the live ezbr_sha256 (1aa3f84c...462f) hashes the bundle, not these files.
Redeploy by copying into supabase/functions/ (and lib/catalogMetadata.ts) on a scratch checkout, then
`npx supabase functions deploy recs-feed --project-ref hnujkabyyrlsxohjhxlg --use-api`.
