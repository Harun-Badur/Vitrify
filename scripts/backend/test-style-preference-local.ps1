[CmdletBinding()]
param([switch]$Transition,[switch]$InstallSafety,[switch]$Production,[switch]$Performance,[switch]$Cutover,[switch]$V2Performance,[switch]$RevocationPerformance,[switch]$KabinAcceptance,[switch]$ActivationPackage,[switch]$BackendMedia)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
if($Production -and $InstallSafety){throw 'INCOMPATIBLE_LOCAL_TEST_MODES'}
if($Performance -and -not $Production){throw 'PERFORMANCE_REQUIRES_PRODUCTION_FIXTURE'}
if($Cutover -and -not $Production){throw 'CUTOVER_REQUIRES_PRODUCTION_FIXTURE'}
if($V2Performance -and -not $Production){throw 'V2_PERFORMANCE_REQUIRES_PRODUCTION_FIXTURE'}
if($RevocationPerformance -and -not $V2Performance){throw 'REVOCATION_REQUIRES_V2_PERFORMANCE_FIXTURE'}
if($KabinAcceptance -and (-not $RevocationPerformance -or -not $Cutover)){throw 'ACCEPTANCE_REQUIRES_LOCAL_PATCH_CUTOVER'}
if($ActivationPackage -and (-not $KabinAcceptance)){throw 'ACTIVATION_REQUIRES_EXISTING_LOCAL_ACCEPTANCE_FIXTURE'}
$PSNativeCommandUseErrorActionPreference=$false
$styleRepo=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$styleBin='C:\Users\Harun\AppData\Local\Temp\vitrify-pg17\pgsql\bin'
foreach($name in @('postgres.exe','psql.exe','initdb.exe','pg_ctl.exe')) {
  if(-not (Test-Path -LiteralPath (Join-Path $styleBin $name))) { throw 'LOCAL_TOOL_MISSING' }
}
# No env file, existing DB, service, Docker volume, or remote connection is used.
Get-ChildItem Env: | Where-Object Name -Like 'PG*' | ForEach-Object {
  [Environment]::SetEnvironmentVariable($_.Name,$null,'Process')
}
$styleTempBase=[IO.Path]::GetFullPath((Join-Path $styleRepo '.tmp'))
$styleRoot=[IO.Path]::GetFullPath((Join-Path $styleTempBase ('style-pg-'+[guid]::NewGuid().ToString('N'))))
if(Test-Path -LiteralPath $styleRoot) { throw 'ISOLATION_PATH_EXISTS' }
[void][IO.Directory]::CreateDirectory($styleRoot)
$styleData=Join-Path $styleRoot 'data'
$styleEvidence=Join-Path $styleRepo $(if($ActivationPackage){'reports/release/style-v2-activation-package-local-evidence-20261013.txt'}elseif($KabinAcceptance){'reports/release/style-v2-kabin-acceptance-local-evidence-20261013.txt'}elseif($RevocationPerformance){'reports/release/style-v2-revocation-performance-evidence-20261013.txt'}elseif($V2Performance){'reports/release/style-v2-activation-performance-evidence-20261013.txt'}elseif($Performance){'reports/release/style-wrapper-performance-evidence-20261013.txt'}elseif($Cutover){'reports/release/style-cutover-postgres-evidence-20261013.txt'}elseif($Production){'reports/release/style-production-postgres-evidence-20261013.txt'}elseif($InstallSafety){'reports/backend/style-install-safety-evidence-20261013.txt'}elseif($Transition){'reports/backend/style-transition-postgres-evidence-20261013.txt'}else{'reports/backend/style-postgres-local-evidence-20261013.txt'})
[IO.File]::WriteAllText($styleEvidence,"LOCAL POSTGRES ONLY; unsigned claims/SET ROLE, not cryptographic JWT verification.`n")
if($BackendMedia){ $styleEvidence=Join-Path $styleRepo 'reports/release/backend-media-cascade-local-20261014.txt'; [IO.File]::WriteAllText($styleEvidence,"LOCAL POSTGRES ONLY; existing runner, synthetic fixture, no JWT signature verification.`n") }
$styleSocket=[Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback,0)
$styleSocket.Start();$stylePort=$styleSocket.LocalEndpoint.Port;$styleSocket.Stop()
$styleStarted=$false
$styleUseSchemaOwner=$false
function Run-StyleSql([string]$File,[string]$ExpectedError='') {
  $ErrorActionPreference='Continue' # psql NOTICE is stderr, not a failed test.
  $ownerArgs=if($styleUseSchemaOwner){@('-c','set role style_schema_owner')}else{@()}
  $result=& (Join-Path $styleBin 'psql.exe') -X -q -v ON_ERROR_STOP=1 -h 127.0.0.1 -p $stylePort -U postgres -d style_intelligence_test @ownerArgs -f $File 2>&1
  $code=$LASTEXITCODE
  [IO.File]::AppendAllText($styleEvidence,($result -join "`n")+"`n")
  if($ExpectedError) {
    if($code -eq 0 -or ($result -join "`n") -notmatch [regex]::Escape($ExpectedError)) { throw 'EXPECTED_LOCAL_SQL_REJECTION_MISSING' }
    Write-Output ('PASS '+$ExpectedError);[IO.File]::AppendAllText($styleEvidence,'PASS '+$ExpectedError+"`n");return
  }
  if($code -ne 0) { throw ('LOCAL_SQL_FAILED: '+[IO.Path]::GetFileName($File)) }
  $result | Where-Object { $_.ToString() -match 'NOTICE:.*PASS ' } | ForEach-Object { Write-Output $_.ToString() }
}
function Run-StyleRace([string]$First,[string]$Second,[string]$Label,[string]$WaitKind='advisory') {
  $firstFile=Join-Path $styleRoot 'race-first.sql';$secondFile=Join-Path $styleRoot 'race-second.sql'
  $prefix="begin; set local role authenticated; do `$`$ declare r jsonb; begin perform style_test.claim('C'); "
  [IO.File]::WriteAllText($firstFile,"set application_name='style-first'; "+$prefix+$First+" perform pg_sleep(4); end `$`$; commit;")
  [IO.File]::WriteAllText($secondFile,"set application_name='style-second'; "+$prefix+$Second+" end `$`$; commit;")
  $args=@('-X','-q','-v','ON_ERROR_STOP=1','-h','127.0.0.1','-p',"$stylePort",'-U','postgres','-d','style_intelligence_test','-f',('"'+$firstFile+'"'))
  $styleFirstProcess=Start-Process -FilePath (Join-Path $styleBin 'psql.exe') -WindowStyle Hidden -PassThru -ArgumentList $args -RedirectStandardOutput (Join-Path $styleRoot 'race-first.out') -RedirectStandardError (Join-Path $styleRoot 'race-first.err')
  $null=$styleFirstProcess.Handle
  $ready=$false
  for($i=0;$i -lt 30;$i++) {
    $n=& (Join-Path $styleBin 'psql.exe') -X -q -At -h 127.0.0.1 -p $stylePort -U postgres -d style_intelligence_test -c "select count(*) from pg_stat_activity where application_name='style-first' and wait_event='PgSleep'"
    if($n -eq '1') {$ready=$true;break};Start-Sleep -Milliseconds 100
  }
  if(-not $ready) { throw 'RACE_FIRST_NOT_READY' }
  $args[$args.Length-1]='"'+$secondFile+'"'
  $styleSecondProcess=Start-Process -FilePath (Join-Path $styleBin 'psql.exe') -WindowStyle Hidden -PassThru -ArgumentList $args -RedirectStandardOutput (Join-Path $styleRoot 'race-second.out') -RedirectStandardError (Join-Path $styleRoot 'race-second.err')
  $null=$styleSecondProcess.Handle
  $waitSeen=$false
  $waitFilter=if($WaitKind -eq 'gate'){"l.locktype in ('transactionid','tuple')"}else{"l.locktype='advisory'"}
  for($i=0;$i -lt 20;$i++) {
    $n=& (Join-Path $styleBin 'psql.exe') -X -q -At -h 127.0.0.1 -p $stylePort -U postgres -d style_intelligence_test -c "select count(*) from pg_locks l join pg_stat_activity a on a.pid=l.pid where a.application_name='style-second' and $waitFilter and not l.granted"
    if($n -eq '1') {$waitSeen=$true;break};Start-Sleep -Milliseconds 100
  }
  $styleFirstProcess.WaitForExit();$styleSecondProcess.WaitForExit()
  $logs=(Get-Content (Join-Path $styleRoot 'race-first.err') -Raw)+(Get-Content (Join-Path $styleRoot 'race-second.err') -Raw)
  [IO.File]::AppendAllText($styleEvidence,$logs+"`n")
  if($styleFirstProcess.ExitCode -ne 0 -or $styleSecondProcess.ExitCode -ne 0 -or -not $waitSeen) { throw 'RACE_FAILED_OR_NOT_OBSERVED' }
  Write-Output ('PASS '+$Label);[IO.File]::AppendAllText($styleEvidence,'PASS '+$Label+"`n")
}
try {
  & (Join-Path $styleBin 'initdb.exe') -D $styleData -U postgres --auth=trust --locale=C -E UTF8 *> (Join-Path $styleRoot 'initdb.log')
  if($LASTEXITCODE -ne 0) { throw 'LOCAL_INITDB_FAILED' }
  $starter=Start-Process -FilePath (Join-Path $styleBin 'pg_ctl.exe') -WindowStyle Hidden -PassThru -ArgumentList @(
    '-D',('"'+$styleData+'"'),'-l',('"'+(Join-Path $styleRoot 'postgres.log')+'"'),'-o',('"-h 127.0.0.1 -p '+$stylePort+'"'),'-w','start'
  ) -RedirectStandardOutput (Join-Path $styleRoot 'start.log') -RedirectStandardError (Join-Path $styleRoot 'start.err')
  $starter.WaitForExit()
  $styleStarted=Test-Path -LiteralPath (Join-Path $styleData 'postmaster.pid')
  if(-not $styleStarted) { throw 'LOCAL_START_FAILED' }
  $identity=& (Join-Path $styleBin 'psql.exe') -X -q -At -h 127.0.0.1 -p $stylePort -U postgres -d postgres -c "select current_setting('data_directory')"
  if($LASTEXITCODE -ne 0 -or [IO.Path]::GetFullPath([string]$identity) -ne [IO.Path]::GetFullPath($styleData)) { throw 'LOCAL_IDENTITY_MISMATCH' }
  & (Join-Path $styleBin 'psql.exe') -X -q -v ON_ERROR_STOP=1 -h 127.0.0.1 -p $stylePort -U postgres -d postgres -c 'create database style_intelligence_test'
  if($LASTEXITCODE -ne 0) { throw 'LOCAL_CREATE_DATABASE_FAILED' }
  if($BackendMedia) {
    Run-StyleSql (Join-Path $styleRepo 'supabase/tests/style_preference_v2_fixture.sql')
    # Fill only missing fixture relations from the preserved metadata column contract.
    # Never connect to or copy user rows from Kabin; use this runner's new loopback cluster.
    $metadata=Get-Content (Join-Path $styleRepo 'reports/release/production-metadata-20261013.json') -Raw | ConvertFrom-Json
    $owned=@('discover_recommendation_jobs','discover_recommendation_job_payloads','discover_recommendation_cache','price_alerts','push_tokens','rate_limits')
    $fixtureSql='alter table public.profiles enable row level security;'
    foreach($table in $metadata.tables | Where-Object { $_.object -in ($owned | ForEach-Object { 'public.'+$_ }) }) {
      $columns=@($table.metadata.columns | ForEach-Object { '"'+$_.name+'" '+$_.type + $(if($_.notnull){' not null'}else{''}) + $(if($_.default){' default '+$_.default}else{''}) })
      $ownerColumn=if($table.object -like '*discover*'){'owner_id'}else{'user_id'}
      if($table.object -ne 'public.discover_recommendation_job_payloads') {
        $columns += 'foreign key("'+$ownerColumn+'") references public.users(id) on delete cascade'
      }
      if($table.object -eq 'public.discover_recommendation_jobs') { $columns += 'unique(id,owner_id)' }
      $fixtureSql += 'create table '+$table.object+'('+($columns -join ',')+'); alter table '+$table.object+' enable row level security;'+"`n"
    }
    # Match the repository/live composite ownership contract, not an invented direct user FK.
    $fixtureSql += 'alter table public.discover_recommendation_job_payloads add constraint fixture_payload_job_owner_fk foreign key(job_id,owner_id) references public.discover_recommendation_jobs(id,owner_id) on delete cascade;'
    $fixturePath=Join-Path $styleRoot 'backend-relations.sql';[IO.File]::WriteAllText($fixturePath,$fixtureSql);Run-StyleSql $fixturePath
    Run-StyleSql (Join-Path $styleRepo 'supabase/deferred/20260924_wardrobe_outfits_v1.sql')
    Run-StyleSql (Join-Path $styleRepo 'reports/backend/proposals/20261012_wardrobe_cloud_persistence.sql')
    # Exercise the reviewed install guard itself against unsafe metadata variants.
    # Each rejected variant is in its own rolled-back local connection/transaction.
    $installSource=Get-Content (Join-Path $styleRepo 'reports/backend/proposals/20261014_a1_kabin_install.sql') -Raw
    $installGuard=$installSource.Substring(0,$installSource.IndexOf('lock table auth.users'))
    $unsafePayloadContracts=@(
      'alter table public.discover_recommendation_job_payloads drop constraint fixture_payload_job_owner_fk; alter table public.discover_recommendation_job_payloads add foreign key(job_id,owner_id) references public.discover_recommendation_jobs(id,owner_id) on delete no action;',
      'alter table public.discover_recommendation_job_payloads drop constraint fixture_payload_job_owner_fk; alter table public.discover_recommendation_job_payloads add foreign key(job_id,owner_id) references public.discover_recommendation_jobs(id,owner_id) on delete cascade not valid;',
      'alter table public.discover_recommendation_job_payloads drop constraint fixture_payload_job_owner_fk; alter table public.discover_recommendation_jobs add unique(id); alter table public.discover_recommendation_job_payloads add foreign key(job_id) references public.discover_recommendation_jobs(id) on delete cascade;',
      'alter table public.discover_recommendation_jobs drop constraint discover_recommendation_jobs_owner_id_fkey; alter table public.discover_recommendation_jobs add foreign key(owner_id) references public.users(id) on delete no action;'
    )
    foreach($unsafeContract in $unsafePayloadContracts) {
      $rejectionPath=Join-Path $styleRoot 'payload-contract-rejection.sql'
      [IO.File]::WriteAllText($rejectionPath,$installGuard.Replace('do $$ declare item record;', $unsafeContract+"`n"+'do $$ declare item record;')+"`nrollback;")
      Run-StyleSql $rejectionPath 'Owner CASCADE contract mismatch'
    }
    foreach($candidate in @('20261014_a1_kabin_install.sql','20261014_wardrobe_original_photo.sql')) {
      $path=Join-Path $styleRepo ('reports/backend/proposals/'+$candidate)
      $injected=Join-Path $styleRoot ('failure-'+$candidate)
      [IO.File]::WriteAllText($injected,[regex]::Replace((Get-Content $path -Raw),'(?m)^commit;\r?$',"select 1/0;`ncommit;"))
      Run-StyleSql $injected 'division by zero'
      $assertion=if($candidate -like '*a1*'){"select style_test.ok(to_regnamespace('deletion_private') is null,'A1_INSTALL_ATOMIC_ROLLBACK');"}else{"select style_test.ok(not exists(select 1 from pg_attribute where attrelid='public.wardrobe_items'::regclass and attname='image_storage_path' and not attisdropped),'PHOTO_INSTALL_ATOMIC_ROLLBACK');"}
      $assertPath=Join-Path $styleRoot 'atomic-check.sql';[IO.File]::WriteAllText($assertPath,$assertion);Run-StyleSql $assertPath
      Run-StyleSql $path
    }
    Run-StyleSql (Join-Path $styleRepo 'supabase/tests/a1_kabin_media_contract.sql')
    # Catalog-only Storage fixture; no disk blob exists, no Storage API is simulated as live proof.
    $storageSql="create schema storage;create table storage.buckets(id text primary key,public boolean not null,file_size_limit bigint,allowed_mime_types text[]);create table storage.objects(bucket_id text,name text);alter table storage.buckets enable row level security;alter table storage.objects enable row level security;insert into storage.buckets values('model-photos',false),('wardrobe-cutouts',false);grant all on storage.objects,storage.buckets to anon,authenticated,service_role;"
    $storageSql += 'create function storage.foldername(p_name text) returns text[] language sql immutable as $$select (string_to_array(p_name,''/''))[1:array_length(string_to_array(p_name,''/''),1)-1]$$;'
    $storageSql += "grant usage on schema storage to anon,authenticated,service_role;insert into storage.objects values('model-photos','00000000-0000-4000-8000-000000000001/model.jpg'),('model-photos','00000000-0000-4000-8000-000000000002/model.jpg');"
    foreach($policy in $metadata.policies | Where-Object { $_.object -eq 'storage.objects' -and $_.command -in @('SELECT','INSERT','UPDATE','DELETE') }) {
      $storageSql += 'create policy '+$policy.name+' on storage.objects for '+$policy.command+' to '+($policy.roles -join ',') + $(if($policy.using){' using ('+$policy.using+')'}else{''}) + $(if($policy.check){' with check ('+$policy.check+')'}else{''}) + ';'
    }
    $storageFixture=Join-Path $styleRoot 'storage-catalog.sql';[IO.File]::WriteAllText($storageFixture,$storageSql);Run-StyleSql $storageFixture
    Run-StyleSql (Join-Path $styleRepo 'reports/backend/proposals/20261014_a1_storage_policy_cutover.sql')
    Run-StyleSql (Join-Path $styleRepo 'supabase/tests/a1_storage_rls_cutover_contract.sql')
    $finalCheck=Get-Content (Join-Path $styleRepo 'reports/backend/proposals/20261014_a1_media_metadata_check.sql') -Raw
    $finalCheck=$finalCheck.Replace('select object,status,metadata from checks order by object;',"select style_test.ok(not exists(select 1 from checks where status in ('DIFF','MISSING')),'FINAL_FUNCTION_METADATA_MATCH');")
    $finalPath=Join-Path $styleRoot 'final-metadata.sql';[IO.File]::WriteAllText($finalPath,$finalCheck);Run-StyleSql $finalPath
    # Dolap style-field sync runs after the A1 metadata check, matching live order (A1 installed first).
    # Its guard replaces only the exact photo-contract RPC bodies, then the contract test runs.
    Run-StyleSql (Join-Path $styleRepo 'supabase/migrations/202610270001_wardrobe_style_fields_sync.sql')
    Run-StyleSql (Join-Path $styleRepo 'supabase/tests/wardrobe_style_fields_contract.sql')
    Write-Output 'LOCAL_BACKEND_MEDIA_COMPLETE'
    return
  }
  if($InstallSafety) {
    # Same baseline fixture, but proposal installation/config seeds are deferred.
    $sourceFixture=Join-Path $styleRepo 'supabase/tests/style_preference_v2_fixture.sql'
    $fixture=Get-Content -LiteralPath $sourceFixture -Raw
    $fixture=$fixture.Replace('\ir ../../reports/backend/proposals/20261012_style_preference_v2.sql','')
    $seedMarker=$fixture.IndexOf('-- Test-only activation decision;')
    if($seedMarker -lt 0){throw 'SAFETY_FIXTURE_CONTRACT_CHANGED'}
    $fixture=$fixture.Substring(0,$seedMarker)
    $fixture=[regex]::Replace($fixture,'(?m)^\\ir ([^\r\n]+)',{param($match)
      $dependency=[IO.Path]::GetFullPath((Join-Path (Split-Path $sourceFixture) $match.Groups[1].Value)).Replace('\','/')
      "\ir '$dependency'"
    })
    $bootstrap=Join-Path $styleRoot 'safety-bootstrap.sql';[IO.File]::WriteAllText($bootstrap,$fixture)
    Run-StyleSql $bootstrap
    # Copy only the exact existing trigger dependencies; never execute A1 migration.
    $fenceSource=Get-Content -LiteralPath (Join-Path $styleRepo 'reports/backend/isolated-a1-migration20/supabase/migrations/20261011000018_vitrify_a1_18.sql') -Raw
    $fenceFunctions=''
    foreach($function in @('lock_writer','seed_owner','block_owned_write')) {
      # Explicit dollar-body bounds, no migration-level DML/schema statements copied.
      $start=$fenceSource.IndexOf('create function deletion_private.'+$function+'(')
      if($start -lt 0){throw 'FENCE_TEST_SOURCE_MISSING'}
      $bodyStart=$fenceSource.IndexOf('as $$',$start);$end=$fenceSource.IndexOf('$$;',$bodyStart+5)
      if($bodyStart -lt 0 -or $end -lt 0){throw 'FENCE_TEST_SOURCE_INVALID'}
      $fenceFunctions+=$fenceSource.Substring($start,$end+3-$start)+"`n"
    }
    $fenceFile=Join-Path $styleRoot 'safety-fence-functions.sql';[IO.File]::WriteAllText($fenceFile,$fenceFunctions)
    Run-StyleSql (Join-Path $styleRepo 'supabase/tests/style_preference_install_prepare.sql')
    $styleUseSchemaOwner=$true
    Run-StyleSql $fenceFile
    Run-StyleSql (Join-Path $styleRepo 'supabase/tests/style_preference_install_before.sql')
    $draft=Get-Content -LiteralPath (Join-Path $styleRepo 'reports/backend/proposals/20261012_style_preference_v2.sql') -Raw
    if([regex]::Matches($draft,'(?m)^commit;\r?$').Count -ne 1){throw 'DRAFT_TRANSACTION_CONTRACT_CHANGED'}
    $failed=Join-Path $styleRoot 'safety-injected-install.sql'
    [IO.File]::WriteAllText($failed,[regex]::Replace($draft,'(?m)^commit;\r?$',"select 1/0;`ncommit;"))
    Run-StyleSql $failed 'division by zero'
    Run-StyleSql (Join-Path $styleRepo 'supabase/tests/style_preference_install_atomicity.sql')
    Run-StyleSql (Join-Path $styleRepo 'reports/backend/proposals/20261012_style_preference_v2.sql')
    Run-StyleSql (Join-Path $styleRepo 'supabase/tests/style_preference_install_after.sql')
    Run-StyleSql (Join-Path $styleRepo 'reports/backend/proposals/20261012_style_preference_v2.sql') 'already exists'
    Run-StyleSql (Join-Path $styleRepo 'supabase/tests/style_preference_install_retry.sql')
    Run-StyleRace "perform style_test.fence_c();" "perform style_test.denied('select public.style_apply_preference_v2(''80000000-0000-4000-8000-000000000002'',''unlike'',''fixture-1'',''20000000-0000-4000-8000-000000000001'',array[''80000000-0000-4000-8000-000000000001'']::uuid[])','fenced','FENCE_FIRST_CANCEL_REJECTED');perform style_test.ok((select count(*)=1 from public.liked_products where product_id='fixture-1'),'FENCE_FIRST_LIKE_DELETE_ROLLED_BACK');perform style_test.ok((select count(*)=0 from public.style_preference_actions where kind='unlike'),'FENCE_FIRST_CANCEL_LEDGER_ROLLED_BACK');" 'FENCE_FIRST_CANCEL_ROW_WAIT_OBSERVED' 'gate'
    Run-StyleSql (Join-Path $styleRepo 'supabase/tests/style_preference_install_unfence.sql')
    Run-StyleRace "r:=public.style_apply_preference_v2('80000000-0000-4000-8000-000000000003','favorite','fixture-2','20000000-0000-4000-8000-000000000001',null,'{`"id`":`"fixture-2`"}');" "perform style_test.fence_c();perform style_test.ok((select count(*)=1 from public.style_preference_actions where action_id='80000000-0000-4000-8000-000000000003'),'WRITER_FIRST_COMPLETE_LEDGER');" 'WRITER_FIRST_FENCE_ROW_WAIT_OBSERVED' 'gate'
    Run-StyleSql (Join-Path $styleRepo 'supabase/tests/style_preference_install_reset.sql')
  } elseif($Production) {
    $sourceFixture=Join-Path $styleRepo 'supabase/tests/style_preference_v2_fixture.sql'
    $fixture=Get-Content -Raw -LiteralPath $sourceFixture
    $fixture=$fixture.Replace('\ir ../../reports/backend/proposals/20261012_style_preference_v2.sql',"alter default privileges in schema public grant execute on functions to anon,authenticated,service_role;`n\ir ../../reports/backend/proposals/20261013_style_preference_v2_production.sql`n\ir style_production_acl_local.sql")
    if($Performance -or $V2Performance) {
      # Capture exact pre-install V1 body in the disposable cluster, no remote read.
      $capture="create schema style_bench;`ndo `$`$ begin execute replace(pg_get_functiondef('public.recompute_profile(uuid)'::regprocedure),'public.recompute_profile(', 'style_bench.baseline_recompute('); end `$`$;`n"
      $fixture=$fixture.Replace('alter default privileges in schema public grant execute',$capture+'alter default privileges in schema public grant execute')
    }
    $fixture=[regex]::Replace($fixture,'(?m)^\\ir ([^\r\n]+)',{param($match)
      $dependency=[IO.Path]::GetFullPath((Join-Path (Split-Path $sourceFixture) $match.Groups[1].Value)).Replace('\','/')
      "\ir '$dependency'"
    })
    $productionFixture=Join-Path $styleRoot 'production-fixture.sql'
    [IO.File]::WriteAllText($productionFixture,$fixture)
    Run-StyleSql $productionFixture
  } else { Run-StyleSql (Join-Path $styleRepo 'supabase/tests/style_preference_v2_fixture.sql') }
  if($RevocationPerformance) {
    $prepare=Join-Path $styleRoot 'revocation-prepare.sql'
    [IO.File]::WriteAllText($prepare,"create table style_bench.revocation_baseline as select proacl::text as acl from pg_proc where oid='public.style_profile_events_v2(uuid,text)'::regprocedure;create table style_bench.saved_gates as select key,value from public.recs_config where key in ('style_preference_writer_v2','style_profile_v2');do `$`$ begin execute replace(pg_get_functiondef('public.style_profile_events_v2(uuid,text)'::regprocedure),'public.style_profile_events_v2(', 'style_bench.original_profile_events(');end `$`$;update public.recs_config set value='{}' where key in ('style_preference_writer_v2','style_profile_v2');")
    Run-StyleSql $prepare
    $revocationPath=Join-Path $styleRepo 'reports/backend/proposals/20261013_style_v2_revocation_lookup_performance.sql'
    $revocation=Get-Content -Raw -LiteralPath $revocationPath
    $injected=Join-Path $styleRoot 'revocation-install-failure.sql'
    [IO.File]::WriteAllText($injected,[regex]::Replace($revocation,'(?m)^commit;\r?$',"select 1/0;`ncommit;"))
    Run-StyleSql $injected 'division by zero'
    $assertOld=Join-Path $styleRoot 'revocation-assert-old.sql'
    [IO.File]::WriteAllText($assertOld,"select style_test.ok((select md5(regexp_replace(prosrc,'[[:space:]]+',' ','g'))='452972666bba9de777629473fff8afdd' from pg_proc where oid='public.style_profile_events_v2(uuid,text)'::regprocedure),'REVOCATION_INSTALL_FAILURE_ATOMIC');")
    Run-StyleSql $assertOld
    Run-StyleSql $revocationPath
    Run-StyleSql (Join-Path $styleRepo 'supabase/tests/style_v2_revocation_equivalence_local.sql')
    Run-StyleSql (Join-Path $styleRepo 'reports/backend/proposals/20261013_style_v2_revocation_lookup_performance_rollback.sql')
    Run-StyleSql $assertOld
    Run-StyleSql $revocationPath
    Run-StyleSql $revocationPath 'V2_EVENT_HELPER_FINGERPRINT_MISMATCH'
    [IO.File]::WriteAllText($prepare,"update public.recs_config c set value=s.value from style_bench.saved_gates s where c.key=s.key;")
    Run-StyleSql $prepare
  }
  if($Cutover) {
    $closeFixture=Join-Path $styleRoot 'closed-legacy-install.sql'
    [IO.File]::WriteAllText($closeFixture,"update public.recs_config set value='{`"enabled`":false}' where key='style_preference_writer_v2';update public.recs_config set value='{`"algorithm`":`"v1`"}' where key='style_profile_v2';")
    Run-StyleSql $closeFixture
    Run-StyleSql (Join-Path $styleRepo 'reports/backend/proposals/20261013_style_legacy_remove_v2.sql')
    [IO.File]::WriteAllText($closeFixture,"update public.recs_config set value='{`"enabled`":true}' where key='style_preference_writer_v2';update public.recs_config set value='{`"algorithm`":`"style-preference-v2`",`"legacy_policy`":`"exclude_with_approval`"}' where key='style_profile_v2';")
    Run-StyleSql $closeFixture
    Run-StyleSql (Join-Path $styleRepo 'supabase/tests/style_legacy_remove_local.sql')
    Run-StyleSql (Join-Path $styleRepo 'supabase/tests/style_exclude_legacy_local.sql')
  }
  if($KabinAcceptance) {
    & node (Join-Path $styleRepo 'supabase/tests/style_kabin_acceptance_cleanup_fixture.cjs') $styleRoot
    if($LASTEXITCODE -ne 0){throw 'LOCAL_CLEANUP_FIXTURE_FAILED'}
    Run-StyleSql (Join-Path $styleRoot 'acceptance-gate-baseline.sql')
    Run-StyleSql (Join-Path $styleRepo 'reports/backend/proposals/20261013_style_v2_kabin_acceptance_writer_open.sql')
    Run-StyleSql (Join-Path $styleRoot 'acceptance-seed.sql')
    Run-StyleSql (Join-Path $styleRoot 'acceptance-cleanup.sql') 'WRITER_MUST_BE_OFF'
    Run-StyleSql (Join-Path $styleRepo 'reports/backend/proposals/20261013_style_v2_kabin_acceptance_writer_close.sql')
    Run-StyleSql (Join-Path $styleRepo 'reports/backend/proposals/20261013_style_v2_kabin_acceptance_writer_close.sql') 'TEMPORARY_GATE_MISMATCH_STOP'
    Run-StyleSql (Join-Path $styleRoot 'acceptance-extra.sql')
    Run-StyleSql (Join-Path $styleRoot 'acceptance-cleanup.sql') 'UNEXPECTED_TEST_ACTIVITY'
    Run-StyleSql (Join-Path $styleRoot 'acceptance-clear-extra.sql')
    Run-StyleSql (Join-Path $styleRoot 'acceptance-old-profile.sql')
    Run-StyleSql (Join-Path $styleRoot 'acceptance-cleanup.sql') 'PROFILE_PROVENANCE_STOP'
    Run-StyleSql (Join-Path $styleRoot 'acceptance-fresh-profile.sql')
    Run-StyleSql (Join-Path $styleRoot 'acceptance-cleanup.sql')
    Run-StyleSql (Join-Path $styleRoot 'acceptance-verify.sql')
  }
  if($Performance -or $V2Performance) {
    $candidate=Get-Content -LiteralPath (Join-Path $styleRepo 'reports/backend/proposals/20261013_style_v1_mirror_lookup_performance.sql') -Raw
    $candidateDefinition=[regex]::Match($candidate,'(?s)create or replace function public\.recompute_profile_v1\(.*?\$\$;').Value
    if(-not $candidateDefinition){throw 'PERFORMANCE_CANDIDATE_MISSING'}
    $candidateProvider=Join-Path $styleRoot 'candidate-provider.sql'
    [IO.File]::WriteAllText($candidateProvider,"create function style_bench.candidate_definition() returns text language sql as `$candidate_provider`$ select `$candidate_body`$"+$candidateDefinition+"`$candidate_body`$::text; `$candidate_provider`$;")
    # Reconstruct the exact prior scalar predicate for a paired same-fixture comparison.
    $previousValidation="length(e.payload->>'action_id')=36 and substring(e.payload->>'action_id',9,1)='-' and substring(e.payload->>'action_id',14,1)='-' and substring(e.payload->>'action_id',19,1)='-' and substring(e.payload->>'action_id',24,1)='-' and length(replace(e.payload->>'action_id','-',''))=32 and translate(e.payload->>'action_id','0123456789abcdef-','')=''"
    $previousCandidate=$candidateDefinition.Replace("pg_input_is_valid(e.payload->>'action_id','uuid')",$previousValidation).Replace("and registered.action_id::text=e.payload->>'action_id'",'')
    [IO.File]::AppendAllText($candidateProvider,"`ncreate function style_bench.previous_scalar_definition() returns text language sql as `$old_provider`$ select `$old_body`$"+$previousCandidate+"`$old_body`$::text; `$old_provider`$;")
    Run-StyleSql $candidateProvider
    $benchFile=Join-Path $styleRoot 'wrapper-performance.sql'
    $benchSource=if($V2Performance){'supabase/tests/style_v2_activation_performance_local.sql'}else{'supabase/tests/style_wrapper_performance_local.sql'}
    $bench=Get-Content -LiteralPath (Join-Path $styleRepo $benchSource) -Raw
    [IO.File]::WriteAllText($benchFile,$bench.Replace('style_test.baseline_recompute','style_bench.baseline_recompute'))
    if(-not $KabinAcceptance){Run-StyleSql $benchFile}
  }
  if($Transition) { Run-StyleSql (Join-Path $styleRepo 'supabase/tests/style_preference_transition_local.sql') }
  Write-Output 'PASS SQL_DRAFT_INSTALL'
  [IO.File]::AppendAllText($styleEvidence,"PASS SQL_DRAFT_INSTALL`n")
  $styleRegression=Join-Path $styleRepo 'supabase/tests/style_preference_v2_local.sql'
  if($InstallSafety) {
    $styleRegressionCopy=Join-Path $styleRoot 'safety-regression.sql'
    $styleRegressionSql=Get-Content -LiteralPath $styleRegression -Raw
    if(-not $styleRegressionSql.Contains("pg_get_userbyid(p.proowner)='postgres'")){throw 'REGRESSION_OWNER_ASSERTION_CHANGED'}
    [IO.File]::WriteAllText($styleRegressionCopy,$styleRegressionSql.Replace("pg_get_userbyid(p.proowner)='postgres'","pg_get_userbyid(p.proowner)='style_schema_owner'"))
    $styleRegression=$styleRegressionCopy
  }
  Run-StyleSql $styleRegression
  $raceCall="public.style_apply_preference_v2('50000000-0000-4000-8000-000000000001','favorite','fixture-1','20000000-0000-4000-8000-000000000001',null,'{`"id`":`"fixture-1`"}')"
  Run-StyleRace ("r:="+$raceCall+";perform style_test.ok(r->>'replayed'='false','RACE_FIRST_NEW_COMMIT');") ("r:="+$raceCall+";perform style_test.ok(r->>'replayed'='true','RACE_SECOND_REPLAY');perform style_test.ok((select count(*)=1 from public.style_preference_actions),'RACE_SINGLE_LEDGER_COMMIT');perform style_test.ok((select count(*)=2 from public.user_events),'RACE_SINGLE_SOURCE_PAIR');") 'CONCURRENT_REPLAY_WAIT_OBSERVED'
  $raceSeed=Join-Path $styleRoot 'race-seed.sql'
  [IO.File]::WriteAllText($raceSeed,"set role authenticated;do `$`$ begin perform style_test.claim('C');perform public.style_apply_preference_v2('50000000-0000-4000-8000-000000000003','favorite','fixture-2','20000000-0000-4000-8000-000000000001',null,'{`"id`":`"fixture-2`"}');end `$`$;")
  Run-StyleSql $raceSeed
  Run-StyleRace "r:=public.style_apply_preference_v2('50000000-0000-4000-8000-000000000004','favorite','fixture-2','20000000-0000-4000-8000-000000000001',null,'{`"id`":`"fixture-2`"}');perform style_test.ok(r->>'replayed'='false','RACE_NEW_LIKE');" "perform style_test.denied('select public.style_apply_preference_v2(''50000000-0000-4000-8000-000000000005'',''unlike'',''fixture-2'',''20000000-0000-4000-8000-000000000001'',array[''50000000-0000-4000-8000-000000000003'']::uuid[])','STALE_TARGETS','RACE_STALE_UNLIKE_REJECTED');perform style_test.ok((select count(*)=1 from public.liked_products where product_id='fixture-2'),'RACE_NEW_LIKE_ROW_PRESERVED');perform style_test.ok((select count(*)=0 from public.style_preference_actions where kind='unlike'),'RACE_STALE_CANCEL_NO_COMMIT');" 'CONCURRENT_STALE_UNLIKE_WAIT_OBSERVED'
  if($Cutover) {
    $legacySeed=Join-Path $styleRoot 'legacy-race-seed.sql'
    [IO.File]::WriteAllText($legacySeed,"insert into public.liked_products(id,user_id,product_id,product_snapshot) values('30000000-0000-4000-8000-000000000009','00000000-0000-4000-8000-000000000003','fixture-3','{`"id`":`"fixture-3`"}');")
    Run-StyleSql $legacySeed
    $legacyCall="public.style_remove_legacy_preference_v2('50000000-0000-4000-8000-000000000009','unlike','fixture-3','20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000009')"
    Run-StyleRace ("r:="+$legacyCall+";perform style_test.ok(r->>'replayed'='false','LEGACY_RACE_NEW');") ("r:="+$legacyCall+";perform style_test.ok(r->>'replayed'='true','LEGACY_RACE_REPLAY');perform style_test.ok((select count(*)=1 from public.style_preference_actions where action_id='50000000-0000-4000-8000-000000000009'),'LEGACY_RACE_SINGLE_CANCELLATION');") 'LEGACY_CONCURRENT_REPLAY_WAIT_OBSERVED'
  }
  if($ActivationPackage){Run-StyleSql (Join-Path $styleRepo 'supabase/tests/style_activation_package_local.sql')}
  Run-StyleSql (Join-Path $styleRepo 'supabase/tests/style_preference_v2_pause_prepare.sql')
  Run-StyleSql (Join-Path $styleRepo 'reports/backend/proposals/20261012_style_preference_v2_pause.sql')
  Run-StyleSql (Join-Path $styleRepo 'supabase/tests/style_preference_v2_pause_check.sql')
  Run-StyleSql (Join-Path $styleRepo 'reports/backend/proposals/20261012_style_preference_v2_rollback.sql') 'ROLLBACK_POLICY_REQUIRED'
  Run-StyleSql (Join-Path $styleRepo 'supabase/tests/style_preference_v2_rollback_allow.sql')
  Run-StyleSql (Join-Path $styleRepo 'reports/backend/proposals/20261012_style_preference_v2_rollback.sql')
  Run-StyleSql (Join-Path $styleRepo 'supabase/tests/style_preference_v2_rollback_check.sql')
  Write-Output 'LOCAL_SQL_SUITE_COMPLETE'
} finally {
  if($styleStarted -or (Test-Path -LiteralPath (Join-Path $styleData 'postmaster.pid'))) {
    & (Join-Path $styleBin 'pg_ctl.exe') -D $styleData -m fast -w stop *> (Join-Path $styleRoot 'stop.log')
    if($LASTEXITCODE -ne 0) { throw 'LOCAL_STOP_FAILED_CLUSTER_PRESERVED' }
  }
  # Delete only this newly generated checkout-local cluster, after resolving bounds.
  $styleResolved=[IO.Path]::GetFullPath($styleRoot)
  if((-not $styleResolved.StartsWith($styleTempBase+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)) -or ([IO.Path]::GetFileName($styleResolved) -notmatch '^style-pg-[a-f0-9]{32}$')) { throw 'CLEANUP_PATH_REJECTED' }
  for($styleAttempt=0;$styleAttempt -lt 5;$styleAttempt++) {
    Remove-Item -LiteralPath $styleResolved -Recurse -Force -ErrorAction SilentlyContinue
    if(-not (Test-Path -LiteralPath $styleResolved)) { break }
    Start-Sleep -Milliseconds 300
  }
  if(Test-Path -LiteralPath $styleResolved) { throw 'CLEANUP_INCOMPLETE_OWN_CLUSTER_PRESERVED' }
  Write-Output 'PASS ISOLATED_CLUSTER_STOPPED_AND_REMOVED'
  [IO.File]::AppendAllText($styleEvidence,"PASS ISOLATED_CLUSTER_STOPPED_AND_REMOVED`n")
}
