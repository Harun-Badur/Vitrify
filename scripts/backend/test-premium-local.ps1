param([switch]$A1,[switch]$Lifecycle)
$ErrorActionPreference='Stop'
$repo=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$bin='C:\Users\Harun\AppData\Local\Temp\vitrify-pg17\pgsql\bin'
$root=[IO.Path]::GetFullPath((Join-Path $repo ('.tmp/premium-'+[guid]::NewGuid().ToString('N'))))
if(-not $root.StartsWith((Join-Path $repo '.tmp')+[IO.Path]::DirectorySeparatorChar)){throw 'UNSAFE_PATH'}
Get-ChildItem Env: | Where-Object Name -Like 'PG*' | ForEach-Object {[Environment]::SetEnvironmentVariable($_.Name,$null,'Process')}
[void][IO.Directory]::CreateDirectory($root)
$data=Join-Path $root 'data'
$socket=[Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback,0);$socket.Start();$port=$socket.LocalEndpoint.Port;$socket.Stop()
$started=$false
function Sql([string]$text) {
 $out=& "$bin/psql.exe" -X -At -v ON_ERROR_STOP=1 -h 127.0.0.1 -p $port -U postgres -d postgres -c $text 2>&1
 if($LASTEXITCODE -ne 0){throw ($out -join "`n")};return $out
}
try {
 & "$bin/initdb.exe" -D $data -U postgres --auth=trust --locale=C -E UTF8 *> (Join-Path $root 'init.log');if($LASTEXITCODE){throw 'INIT_FAILED'}
 $p=Start-Process "$bin/pg_ctl.exe" -WindowStyle Hidden -PassThru -ArgumentList @('-D',$data,'-l',(Join-Path $root 'pg.log'),'-o',"`"-h 127.0.0.1 -p $port`"",'-w','start') -RedirectStandardOutput (Join-Path $root 'start.log') -RedirectStandardError (Join-Path $root 'start.err')
 $p.WaitForExit()
 if($p.ExitCode){throw 'START_FAILED'};$started=$true
 if((Sql "select current_setting('data_directory')").Trim().Replace('\','/') -ne $data.Replace('\','/')){throw 'CLUSTER_IDENTITY_MISMATCH'}
 # Exact installed-source gate/lease code, not a replacement implementation.
 # Readiness transport only is synthetic; this is not the full Storage/JWT fixture.
 $source=Get-Content (Join-Path $repo 'reports/backend/proposals/20261014_a1_kabin_install.sql') -Raw
 $bootstrap=@'
create role anon;create role authenticated;create role service_role;
create schema auth;create table auth.users(id uuid primary key);
create schema deletion_private;
create table deletion_private.inventory(relation_name text primary key,owner_column text not null);
create table deletion_private.owner_gates(subject uuid primary key,fenced boolean not null default false,fenced_at timestamptz);
create table deletion_private.receipts(subject uuid primary key,request text unique not null,recovery_hash text not null,receipt jsonb not null,lease uuid,lease_until timestamptz,updated_at timestamptz not null default clock_timestamp());
alter table deletion_private.receipts enable row level security;
create function public.deletion_readiness() returns jsonb language sql as $$select '{"ready":true}'::jsonb$$;
'@
 foreach($fn in @('deletion_private.lock_writer','deletion_private.seed_owner','deletion_private.block_owned_write','public.deletion_assert_lease','public.deletion_begin','public.deletion_save','public.deletion_release')){
  $matches=[regex]::Matches($source,'(?s)create(?: or replace)? function '+[regex]::Escape($fn)+'\(.*?\$\$;')
  if($matches.Count -eq 0){throw 'SOURCE_FUNCTION_MISSING'}
  $bootstrap+="`n"+$matches[$matches.Count-1].Value
 }
 $bootstrap+="`ncreate trigger deletion_seed_owner before insert on auth.users for each row execute function deletion_private.seed_owner();"
 $baseFile=Join-Path $root 'a1-source-fixture.sql';[IO.File]::WriteAllText($baseFile,$bootstrap)
 & "$bin/psql.exe" -X -q -v ON_ERROR_STOP=1 -h 127.0.0.1 -p $port -U postgres -d postgres -f $baseFile
 if($LASTEXITCODE){throw 'BOOTSTRAP_FAILED'}
 $fixture=if($Lifecycle){'supabase/tests/premium_cleanup_local.sql'}elseif($A1){'supabase/tests/premium_a1_local.sql'}else{'supabase/tests/premium_v1_local.sql'}
 & "$bin/psql.exe" -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -p $port -U postgres -d postgres -f (Join-Path $repo $fixture)
 if($LASTEXITCODE){throw 'FIXTURE_FAILED'}
 if($Lifecycle){return}
 if($A1){
  function Race([string]$label,[string]$first,[string]$second,[bool]$denied){
   $f=Join-Path $root "$label-first.sql";$s=Join-Path $root "$label-second.sql"
   [IO.File]::WriteAllText($f,"set application_name='premium-a1-first';"+$first)
   [IO.File]::WriteAllText($s,"set application_name='premium-a1-second';"+$second)
   $one=Start-Process "$bin/psql.exe" -WindowStyle Hidden -PassThru -ArgumentList @('-X','-v','ON_ERROR_STOP=1','-h','127.0.0.1','-p',$port,'-U','postgres','-d','postgres','-f',$f) -RedirectStandardOutput (Join-Path $root "$label-first.out") -RedirectStandardError (Join-Path $root "$label-first.err")
   $sleeping=$false
   for($i=0;$i -lt 40;$i++){if((Sql "select count(*) from pg_stat_activity where application_name='premium-a1-first' and wait_event='PgSleep'") -eq '1'){$sleeping=$true;break};Start-Sleep -Milliseconds 50}
   if(-not $sleeping){throw 'RACE_FIRST_NOT_READY'}
   $two=Start-Process "$bin/psql.exe" -WindowStyle Hidden -PassThru -ArgumentList @('-X','-v','ON_ERROR_STOP=1','-h','127.0.0.1','-p',$port,'-U','postgres','-d','postgres','-f',$s) -RedirectStandardOutput (Join-Path $root "$label-second.out") -RedirectStandardError (Join-Path $root "$label-second.err")
   $waiting=$false
   for($i=0;$i -lt 25;$i++){if((Sql "select count(*) from pg_stat_activity where application_name='premium-a1-second' and wait_event_type='Lock'") -eq '1'){$waiting=$true;break};Start-Sleep -Milliseconds 30}
   $one.WaitForExit();$two.WaitForExit()
   if($one.ExitCode -or (-not $denied -and $two.ExitCode) -or ($denied -and $two.ExitCode -eq 0) -or -not $waiting){throw 'RACE_RESULT_FAILED'}
   if($denied -and (Get-Content (Join-Path $root "$label-second.err") -Raw) -notmatch 'Account deletion fenced or owner unavailable'){throw 'RACE_WRONG_ERROR'}
   Write-Output "PASS PA1-02 $label actual gate contention observed"
  }
  Race 'writer-first' "begin;select public.premium_binding('10000000-0000-4000-8000-000000000002');select pg_sleep(2);commit;" "select public.deletion_begin('10000000-0000-4000-8000-000000000002','race-delete',repeat('b',64));" $false
  Sql "insert into auth.users values('10000000-0000-4000-8000-000000000003')" | Out-Null
  Race 'fence-first' "begin;select public.deletion_begin('10000000-0000-4000-8000-000000000003','race-delete-c',repeat('c',64));select pg_sleep(2);commit;" "select public.premium_binding('10000000-0000-4000-8000-000000000003');" $true
  if((Sql "select count(*) from public.premium_identities where user_id='10000000-0000-4000-8000-000000000003'") -ne '0'){throw 'FENCED_IDENTITY_CREATED'}
  return
 }
 $jobs=@()
 1..6 | ForEach-Object {
   $file=Join-Path $root "race-$_.sql"
   [IO.File]::WriteAllText($file,"select public.premium_vton_reserve('10000000-0000-4000-8000-000000000002','race-$_','hash');")
   $jobs+=Start-Process "$bin/psql.exe" -WindowStyle Hidden -PassThru -ArgumentList @('-X','-At','-v','ON_ERROR_STOP=1','-h','127.0.0.1','-p',$port,'-U','postgres','-d','postgres','-f',$file) -RedirectStandardOutput (Join-Path $root "race-$_.out") -RedirectStandardError (Join-Path $root "race-$_.err")
 }
 foreach($job in $jobs){$job.WaitForExit();if($job.ExitCode){throw 'RACE_PROCESS_FAILED'}}
 $count=Sql "select day_count||':'||minute_count from public.rate_limits where user_id='10000000-0000-4000-8000-000000000002'"
 if($count -ne '3:3'){throw "RACE_FAILED $count"}
 Write-Output 'PASS six parallel requests: exactly 3 reserved'
 $jobs=@()
 1..6 | ForEach-Object {
   $file=Join-Path $root "refund-$_.sql"
   [IO.File]::WriteAllText($file,"select public.premium_vton_settle('10000000-0000-4000-8000-000000000002',(select request_id from public.premium_vton_requests where user_id='10000000-0000-4000-8000-000000000002' order by request_id limit 1),'not_sent',null);")
   $jobs+=Start-Process "$bin/psql.exe" -WindowStyle Hidden -PassThru -ArgumentList @('-X','-At','-v','ON_ERROR_STOP=1','-h','127.0.0.1','-p',$port,'-U','postgres','-d','postgres','-f',$file) -RedirectStandardOutput (Join-Path $root "refund-$_.out") -RedirectStandardError (Join-Path $root "refund-$_.err")
 }
 foreach($job in $jobs){$job.WaitForExit();if($job.ExitCode){throw 'REFUND_PROCESS_FAILED'}}
 if((Sql "select day_count||':'||minute_count from public.rate_limits where user_id='10000000-0000-4000-8000-000000000002'") -ne '2:3'){throw 'REFUND_RACE_FAILED'}
 Write-Output 'PASS six parallel refunds: exactly 1 daily credit, no minute credit'
} finally {
 if($started){& "$bin/pg_ctl.exe" -D $data -m immediate -w stop *> (Join-Path $root 'stop.log')}
 # Preserve synthetic cluster/logs for inspection; no recursive delete.
 Write-Output "Local synthetic evidence: $root"
}
