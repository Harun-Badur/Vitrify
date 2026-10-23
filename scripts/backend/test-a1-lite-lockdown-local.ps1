[CmdletBinding()]
param()
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$liteRepo=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$liteBin='C:\Users\Harun\AppData\Local\Temp\vitrify-pg17\pgsql\bin'
$liteRoot=Join-Path $env:TEMP ('vitrify-a1-lite-local-'+[guid]::NewGuid().ToString('N'))
[void][IO.Directory]::CreateDirectory($liteRoot)
$liteData=Join-Path $liteRoot 'data'
$liteEvidence=Join-Path $liteRepo 'reports/backend/a1-lite-lockdown-local-evidence.txt'
# No credentials or connection URI read; fixed loopback target only.
foreach($liteName in @('PGSERVICE','PGSERVICEFILE','PGPASSWORD','PGPASSFILE','PGHOST','PGHOSTADDR','PGPORT','PGDATABASE','PGUSER','PGOPTIONS')) {
  [Environment]::SetEnvironmentVariable($liteName,$null,'Process')
}
$liteFixture=Join-Path $liteRoot 'fixture.sql'
@'
create role anon; create role authenticated; create role service_role bypassrls;
create schema storage;
create table storage.objects(bucket_id text not null,name text not null);
alter table storage.objects enable row level security;
grant usage on schema storage to anon,authenticated,service_role;
grant select,insert,update,delete on storage.objects to anon,authenticated,service_role;
-- Intentionally broad existing permissive policy proves restrictive AND behavior.
create policy fixture_permissive on storage.objects for all to anon,authenticated using(true) with check(true);
insert into storage.objects values ('model-photos','original'),('wardrobe-cutouts','original');
'@ | Set-Content -LiteralPath $liteFixture -Encoding utf8
function RunLiteSql([string]$File) {
  & (Join-Path $liteBin 'psql.exe') -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -p 54721 -U postgres -d postgres -f $File 2>&1 | Tee-Object -FilePath $liteEvidence -Append
  if($LASTEXITCODE -ne 0){throw 'Local SQL failed; no retry'}
}
$liteAttempted=$false
try {
  'LOCAL ONLY: synthetic PostgreSQL RLS fixture; no migrations 1..20, JWT or Storage API calls.' | Set-Content -LiteralPath $liteEvidence
  & (Join-Path $liteBin 'initdb.exe') -D $liteData -U postgres --auth=trust --locale=C -E UTF8 *> (Join-Path $liteRoot 'initdb.log')
  if($LASTEXITCODE -ne 0){throw 'Local initdb failed; no retry'}
  $liteAttempted=$true
  $liteLauncher=Start-Process -FilePath (Join-Path $liteBin 'pg_ctl.exe') -WindowStyle Hidden -PassThru -ArgumentList @('-D',('"'+$liteData+'"'),'-l',('"'+(Join-Path $liteRoot 'postgres.log')+'"'),'-o','"-h 127.0.0.1 -p 54721"','-w','start') -RedirectStandardOutput (Join-Path $liteRoot 'start.log') -RedirectStandardError (Join-Path $liteRoot 'start.err')
  # Cache the handle before waiting: Windows PowerShell can otherwise expose a
  # null ExitCode for a short-lived Start-Process child. Unmeasured is still stop.
  $null=$liteLauncher.Handle
  if(-not $liteLauncher.WaitForExit(15000) -or $liteLauncher.ExitCode -ne 0){throw 'Local start failed or uncertain; no retry'}
  RunLiteSql $liteFixture
  RunLiteSql (Join-Path $liteRepo 'reports/backend/proposals/20261011_a1_lite_client_storage_lockdown.sql')
  RunLiteSql (Join-Path $liteRepo 'supabase/tests/a1_lite_lockdown_local.sql')
} finally {
  if($liteAttempted) {
    & (Join-Path $liteBin 'pg_ctl.exe') -D $liteData -m immediate -w stop *> (Join-Path $liteRoot 'stop.log')
    if($LASTEXITCODE -ne 0){throw 'Local server stop unverified'}
    'PASS local fixture server stopped' | Add-Content -LiteralPath $liteEvidence
  }
}
