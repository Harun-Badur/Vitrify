[CmdletBinding()]
param()
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$a1Repo=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$a1Bin='C:\Users\Harun\AppData\Local\Temp\vitrify-pg17\pgsql\bin'
$a1Root=Join-Path $env:TEMP ('vitrify-a1-20-local-'+[guid]::NewGuid().ToString('N'))
[void][IO.Directory]::CreateDirectory($a1Root)
$a1Data=Join-Path $a1Root 'data'
$a1Log=Join-Path $a1Repo 'reports/backend/a1-sql20-local-evidence.txt'
$a1OwnerSource=Get-Content -LiteralPath 'C:\Users\Harun\AppData\Local\Temp\vitrify-a1-migration19-51eb6ef46ec149caaf67a4bc05d8a41d\supabase\migrations\20261011000018_vitrify_a1_18.sql' -Raw
$a1UpgradeSource=Get-Content -LiteralPath 'C:\Users\Harun\AppData\Local\Temp\vitrify-a1-migration19-51eb6ef46ec149caaf67a4bc05d8a41d\supabase\migrations\20261011000019_vitrify_a1_19.sql' -Raw
function SourcePart([string]$Source,[string]$Pattern){
 $a1Match=[regex]::Match($Source,$Pattern,[Text.RegularExpressions.RegexOptions]::Multiline)
 if(-not $a1Match.Success){throw 'Local fixture source extraction failed'}
 return $a1Match.Value
}
# Minimal compatibility fixture, NOT a replay of migrations 1..19 or staging setup.
$a1Base=@'
create role anon; create role authenticated; create role service_role;
create schema auth;
grant usage on schema auth to anon,authenticated,service_role;
create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
create schema deletion_private;
revoke all on schema deletion_private from public,anon,authenticated,service_role;
create table deletion_private.owner_gates(subject uuid primary key,fenced boolean not null default false);
create table deletion_private.receipts(subject uuid primary key,request text unique not null,recovery_hash text not null,receipt jsonb not null,lease uuid,lease_until timestamptz,updated_at timestamptz not null default clock_timestamp());
alter table deletion_private.owner_gates enable row level security;
alter table deletion_private.receipts enable row level security;
'@
$a1Base+=SourcePart $a1OwnerSource '(?s)create function deletion_private.lock_writer\(.*?end \$\$;'
$a1Base+=SourcePart $a1OwnerSource '(?s)create function public.deletion_storage_barrier\(.*?\$\$;'
$a1Base+=SourcePart $a1UpgradeSource '(?s)create table deletion_private.storage_operations \(.*?\);'
$a1Base+="`nalter table deletion_private.storage_operations enable row level security;`n"
foreach($a1Function in @('storage_upload_admit','storage_upload_start','storage_upload_succeed')){
 $a1Base+=SourcePart $a1UpgradeSource ('(?s)create function public.'+$a1Function+'\(.*?end \$\$;')
}
$a1Base+=@'
revoke all on function public.storage_upload_admit(text,text,text),public.storage_upload_start(uuid,uuid,uuid,text,text),public.storage_upload_succeed(uuid,uuid,uuid,text,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.storage_upload_admit(text,text,text) to authenticated;
grant execute on function public.storage_upload_start(uuid,uuid,uuid,text,text),public.storage_upload_succeed(uuid,uuid,uuid,text,text,jsonb),public.deletion_storage_barrier(text,uuid) to service_role;
'@
$a1Fixture=Join-Path $a1Root 'minimal-contract-fixture.sql'
[IO.File]::WriteAllText($a1Fixture,$a1Base,[Text.UTF8Encoding]::new($false))
$a1Started=$false
$a1Psql=Join-Path $a1Bin 'psql.exe'
function RunLocalSql([string]$File){
 & $a1Psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -p 54720 -U postgres -d postgres -f $File 2>&1 | Tee-Object -FilePath $a1Log -Append
 if($LASTEXITCODE -ne 0){throw 'Local SQL failed; no retry'}
}
try {
 'LOCAL ONLY: PostgreSQL 17 minimal migration-19 contract fixture; no staging URL read.' | Set-Content -LiteralPath $a1Log
 & (Join-Path $a1Bin 'initdb.exe') -D $a1Data -U postgres --auth=trust --locale=C -E UTF8 *> (Join-Path $a1Root 'initdb.log')
 if($LASTEXITCODE -ne 0){throw 'Local initdb failed; no retry'}
 # Start-Process avoids PowerShell waiting on the detached postgres process tree.
 $a1Launcher=Start-Process -FilePath (Join-Path $a1Bin 'pg_ctl.exe') -WindowStyle Hidden -PassThru -ArgumentList @('-D',('"'+$a1Data+'"'),'-l',('"'+(Join-Path $a1Root 'postgres.log')+'"'),'-o','"-h 127.0.0.1 -p 54720"','-w','start') -RedirectStandardOutput (Join-Path $a1Root 'pg_ctl.log') -RedirectStandardError (Join-Path $a1Root 'pg_ctl.err')
 if(-not $a1Launcher.WaitForExit(15000) -or $a1Launcher.ExitCode -ne 0){throw 'Local start failed or uncertain; no retry'}
 $a1Started=$true
 RunLocalSql $a1Fixture
 RunLocalSql (Join-Path $a1Repo 'reports/backend/proposals/20261011_a1_reconciliation_and_provider_journal.sql')
 RunLocalSql (Join-Path $a1Repo 'supabase/tests/a1_reconciliation_contract.sql')
 & $a1Psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -p 54720 -U postgres -d postgres -c 'DO $$ BEGIN IF EXISTS(SELECT 1 FROM auth.users) OR EXISTS(SELECT 1 FROM deletion_private.owner_gates) OR EXISTS(SELECT 1 FROM deletion_private.storage_operations) OR EXISTS(SELECT 1 FROM deletion_private.provider_operations) OR EXISTS(SELECT 1 FROM deletion_private.storage_resolutions) OR EXISTS(SELECT 1 FROM deletion_private.receipts) THEN RAISE EXCEPTION ''Fixture rollback incomplete''; END IF; RAISE NOTICE ''PASS all fixture rows rolled back''; END $$;' 2>&1 | Tee-Object -FilePath $a1Log -Append
 if($LASTEXITCODE -ne 0){throw 'Local rollback verification failed'}
 'PASS local compatibility/rollback SQL; staging NOT RUN.' | Add-Content -LiteralPath $a1Log
} finally {
 if($a1Started){ & (Join-Path $a1Bin 'pg_ctl.exe') -D $a1Data -m immediate -w stop *> (Join-Path $a1Root 'stop.log') }
}
