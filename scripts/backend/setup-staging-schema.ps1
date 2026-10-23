[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$VerbosePreference = 'SilentlyContinue'
$DebugPreference = 'SilentlyContinue'
$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$cliPath = Join-Path $repoRoot 'node_modules/@supabase/cli-windows-x64/bin/supabase.exe'
$stagingRef = 'sdjxseqfkturkfohkfni'
$productionRef = 'hnujkabyyrlsxohjhxlg'
$poolerHost = 'aws-1-eu-central-1.pooler.supabase.com'
$databaseUser = 'postgres.sdjxseqfkturkfohkfni'
$script:connectionUri = $null
$securePassword = $null
$passwordBuffer = [IntPtr]::Zero
$plainPassword = $null
$encodedPassword = $null
$exitStatus = 1
$script:lastCliExit = $null
$script:phase = 'local-preflight'
$script:targetVerified = $false
$script:migrationWorkRoot = $null
$script:historyDigest = 'd41d8cd98f00b204e9800998ecf8427e'
$runPath = Join-Path $repoRoot ('reports/backend/staging-schema-run-' + [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssfffffffZ') + '.json')
$run = [ordered]@{ staging_ref=$stagingRef; host=$poolerHost; port=5432; database='postgres'; started_utc=[DateTime]::UtcNow.ToString('o'); status='PREPARING'; phase='local-preflight'; cli_exit=$null; error_class=$null; method='isolated-migration-up'; migration_workdir=$null; files=@(); observations=@(); partial_application='NONE'; storage_barrier=$false; writerCoverage=$false; readiness=$false; a1='BLOCKED' }

# All subprocess output is captured, never forwarded or saved. Arguments containing
# credentials stay in memory. The native CLI avoids wrappers and binary overrides.
function Invoke-Cli([string]$Arguments) {
    $info = New-Object Diagnostics.ProcessStartInfo
    $info.FileName = $cliPath
    $info.WorkingDirectory = $repoRoot
    $info.UseShellExecute = $false
    $info.CreateNoWindow = $true
    $info.RedirectStandardOutput = $true
    $info.RedirectStandardError = $true
    $info.RedirectStandardInput = $true
    $info.Arguments = $Arguments
    $info.EnvironmentVariables['NO_COLOR'] = '1'
    $info.EnvironmentVariables['OTEL_SDK_DISABLED'] = 'true'
    $process = New-Object Diagnostics.Process
    $process.StartInfo = $info
    $stdout = $null; $stderr = $null; $outTask = $null; $errTask = $null
    $script:lastCliExit = $null
    try {
        if (-not $process.Start()) { $run.error_class='CLI_START_FAILED'; throw 'CLI startup failed' }
        $process.StandardInput.Close()
        $outTask = $process.StandardOutput.ReadToEndAsync()
        $errTask = $process.StandardError.ReadToEndAsync()
        if (-not $process.WaitForExit(60000)) {
            $process.Kill(); $process.WaitForExit()
            $run.error_class='CLI_TIMEOUT_OUTCOME_UNKNOWN'
            throw 'CLI timeout; application outcome unknown'
        }
        $stdout = $outTask.GetAwaiter().GetResult()
        $stderr = $errTask.GetAwaiter().GetResult()
        $script:lastCliExit = $process.ExitCode
        if ($process.ExitCode -ne 0) { $run.error_class='CLI_NONZERO_EXIT'; throw 'CLI failed; raw output withheld' }
        return $stdout
    } finally {
        $info.Arguments = ''; $Arguments = $null
        $stdout = $null; $stderr = $null; $outTask = $null; $errTask = $null
        $process.Dispose()
    }
}

function Assert-UriTarget {
    $target = [Uri]$script:connectionUri
    $uriUser = [Uri]::UnescapeDataString(($target.UserInfo -split ':', 2)[0])
    if ($target.Scheme -ne 'postgresql' -or $target.Host -ne $poolerHost -or
        $target.Port -ne 5432 -or $target.AbsolutePath -ne '/postgres' -or
        $uriUser -ne $databaseUser -or $uriUser -ne ('postgres.' + $stagingRef) -or
        $target.Query -ne '?sslmode=require' -or $target.Fragment -ne '' -or
        $script:connectionUri.Contains($productionRef)) { throw 'Target mismatch' }
}

function Read-Rows([string]$Sql) {
    Assert-UriTarget
    # Only fixed SELECT queries generated below; never accept external SQL here.
    if (-not $Sql.StartsWith('SELECT ') -or $Sql.Contains('"')) { throw 'Invalid verification query' }
    $raw = $null; $decoded = $null
    try {
        $raw = Invoke-Cli ('db query --db-url "' + $script:connectionUri + '" --output json --log-level none "' + $Sql + '"')
        $decoded = ConvertFrom-Json -InputObject $raw
        if ($null -ne $decoded -and $decoded.PSObject.Properties['rows']) { return @($decoded.rows) }
        return @($decoded)
    } finally { $raw = $null; $decoded = $null }
}

function Save-Run {
    $run.phase = $script:phase
    $run.cli_exit = $script:lastCliExit
    # Only locally defined labels, SHA256s, booleans and counts are persisted.
    $run | ConvertTo-Json -Depth 9 | Set-Content -LiteralPath $runPath -Encoding UTF8
}

function Assert-DatabaseTarget([bool]$RequireEmpty = $false) {
    $script:targetVerified = $false
    $rows = @(Read-Rows "SELECT current_database() AS database_name, current_user AS database_role, (SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE') AS public_table_count, (SELECT count(*) FROM auth.users) AS auth_user_count, (to_regnamespace('deletion_private') IS NOT NULL) AS private_schema_present, (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public') AS public_function_count, (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('i','I','S','v','m')) AS public_other_relation_count, (SELECT count(*) FROM pg_policies WHERE schemaname='public') AS public_policy_count;")
    if ($rows.Count -ne 1) { throw 'Invalid identity response' }
    $row = $rows[0]
    if ($row.database_name -ne 'postgres' -or $row.database_role -ne 'postgres' -or
        $null -eq $row.public_table_count -or $null -eq $row.auth_user_count -or
        $row.private_schema_present -isnot [bool]) { throw 'Database identity mismatch' }
    $tables = [long]$row.public_table_count; $users = [long]$row.auth_user_count
    if ($tables -lt 0 -or $users -ne 0) { throw 'Unexpected users or metadata' }
    $run.observations += [ordered]@{phase=$script:phase; public_tables=$tables; auth_users=$users; deletion_private=$row.private_schema_present; identity='postgres/postgres'; uri_target='PASS'}
    if ($RequireEmpty -and ($tables -ne 0 -or $row.private_schema_present)) { throw 'Staging is not empty' }
    if ($RequireEmpty -and ($null -eq $row.public_function_count -or $row.public_function_count -ne 0 -or
        $null -eq $row.public_other_relation_count -or $row.public_other_relation_count -ne 0 -or
        $null -eq $row.public_policy_count -or $row.public_policy_count -ne 0)) { throw 'Unowned partial public schema; stop without repair' }
    $script:targetVerified = $true
    Write-Host ('Target PASS: staging ' + $stagingRef + '; public tables=' + $tables + '; Auth users=0')
}

function Assert-MigrationHistory([int]$ExpectedCount, [int]$PreviousCount) {
    Assert-UriTarget
    $probe=@(Read-Rows "SELECT to_regclass('supabase_migrations.schema_migrations') IS NOT NULL AS present;")
    if ($probe.Count -ne 1 -or $probe[0].present -isnot [bool]) { throw 'Invalid history presence response' }
    if (-not $probe[0].present) {
        if ($ExpectedCount -ne 0) { throw 'Expected migration history missing' }
        return
    }
    $pairs=@($run.files | Select-Object -First $ExpectedCount | ForEach-Object { "('"+$_.version+"','"+$_.migration_name+"')" })
    $matched='0'
    if ($ExpectedCount -gt 0) { $matched="(SELECT count(*) FROM supabase_migrations.schema_migrations h JOIN (VALUES "+($pairs -join ',')+") AS expected(version,name) ON h.version=expected.version AND h.name=expected.name)" }
    $previousVersions=@($run.files | Select-Object -First $PreviousCount | ForEach-Object { "'"+$_.version+"'" })
    $previousWhere='false'
    if ($PreviousCount -gt 0) { $previousWhere='version IN ('+($previousVersions -join ',')+')' }
    $rows=@(Read-Rows ("SELECT count(*) AS total, "+$matched+" AS matched, md5(coalesce(string_agg(version||':'||coalesce(name,'')||':'||coalesce(statements::text,''),'|' ORDER BY version),'')) AS digest, (SELECT md5(coalesce(string_agg(version||':'||coalesce(name,'')||':'||coalesce(statements::text,''),'|' ORDER BY version),'')) FROM supabase_migrations.schema_migrations WHERE "+$previousWhere+") AS previous_digest FROM supabase_migrations.schema_migrations;"))
    if ($rows.Count -ne 1 -or $null -eq $rows[0].total -or $null -eq $rows[0].matched -or
        $rows[0].total -ne $ExpectedCount -or $rows[0].matched -ne $ExpectedCount -or
        $rows[0].digest -cnotmatch '^[a-f0-9]{32}$' -or $rows[0].previous_digest -cne $script:historyDigest) {
        throw 'Migration history is partial, foreign or changed; no repair/resume'
    }
    $script:historyDigest=$rows[0].digest
    $run.observations+=@{phase=$script:phase; verified_history_count=$ExpectedCount; history_digest=$script:historyDigest}
}

function Stage-NextMigration([int]$Index) {
    $directory=Join-Path $script:migrationWorkRoot 'supabase/migrations'
    # Keep every verified earlier file; expose no later file to migration up.
    $existing=@(Get-ChildItem -LiteralPath $directory -File)
    if ($existing.Count -ne $Index) { throw 'Isolated migration queue changed' }
    for ($p=0; $p -lt $Index; $p++) {
        if ($run.files[$p].state -cne 'VERIFIED') { throw 'Previous migration not verified' }
        $priorPath=Join-Path $directory $run.files[$p].migration_file
        if (-not (Test-Path -LiteralPath $priorPath -PathType Leaf) -or
            (Get-FileHash -LiteralPath $priorPath -Algorithm SHA256).Hash -cne $run.files[$p].sha256) { throw 'Previous isolated migration changed' }
    }
    $entry=$run.files[$Index]
    $sourcePath=Join-Path $repoRoot $entry.file
    if ((Get-FileHash -LiteralPath $sourcePath -Algorithm SHA256).Hash -cne $entry.sha256) { throw 'Source changed before staging' }
    $targetPath=Join-Path $directory $entry.migration_file
    if (Test-Path -LiteralPath $targetPath) { throw 'Migration destination already exists' }
    [IO.File]::Copy($sourcePath,$targetPath,$false)
    if ((Get-FileHash -LiteralPath $targetPath -Algorithm SHA256).Hash -cne $entry.sha256) { throw 'Migration copy hash mismatch' }
    $run.files | Select-Object file,sha256,version,migration_name,migration_file | ConvertTo-Json -Depth 4 |
        Set-Content -LiteralPath (Join-Path $script:migrationWorkRoot 'source-map.json') -Encoding UTF8
}

function Check([string]$Name, [string]$Expression) { return @{Name=$Name; Expression=$Expression} }
function Table([string]$Name) { Check ('table:'+$Name) "EXISTS(SELECT 1 FROM pg_class WHERE oid=to_regclass('$Name') AND relkind='r' AND relrowsecurity)" }
function Fn([string]$Signature) { Check ('function:'+$Signature) "to_regprocedure('$Signature') IS NOT NULL" }
function Column([string]$Name, [string]$Column) { Check ('column:'+$Name+'.'+$Column) "EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid=to_regclass('$Name') AND attname='$Column' AND NOT attisdropped)" }
function Trigger([string]$Name, [string]$Trigger, [string]$Function) { Check ('trigger:'+$Name+'.'+$Trigger) "EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid=to_regclass('$Name') AND tgname='$Trigger' AND tgfoid=to_regprocedure('$Function') AND tgenabled='O' AND NOT tgisinternal)" }
function Bucket([string]$Name) { Check ('bucket:'+$Name) "EXISTS(SELECT 1 FROM storage.buckets WHERE id='$Name' AND public=false)" }
function RpcAcl([string]$Signature) {
    Check ('acl:'+$Signature) "EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('$Signature') AND p.prosecdef AND has_function_privilege('service_role',p.oid,'EXECUTE') AND NOT has_function_privilege('anon',p.oid,'EXECUTE') AND NOT has_function_privilege('authenticated',p.oid,'EXECUTE') AND NOT EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.grantee=0 AND a.privilege_type='EXECUTE'))"
}
function Step([string]$File, [object[]]$Checks) { return @{File=$File; Checks=$Checks} }

$coordinatorChecks = @()
foreach ($name in @('readiness','owner_gates','receipts','inventory','cache_write_permits','job_write_permits','job_claims')) {
    $coordinatorChecks += Table ('deletion_private.'+$name)
    $coordinatorChecks += Check ('private-acl:'+$name) "EXISTS(SELECT 1 FROM pg_class c WHERE c.oid=to_regclass('deletion_private.$name') AND NOT EXISTS(SELECT 1 FROM aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a WHERE a.grantee=0 OR pg_get_userbyid(a.grantee) IN ('anon','authenticated','service_role')))"
}
foreach ($signature in @('deletion_storage_barrier(text,uuid)','deletion_readiness()','deletion_assert_lease(text,uuid)','deletion_begin(uuid,text,text)','deletion_save(text,uuid,jsonb)','deletion_release(text,uuid)','deletion_clean(text,uuid,text)','deletion_verify(text,uuid,text)','claim_discover_recommendation_job_v2()','publish_discover_recommendation_cache(uuid,uuid,bigint,jsonb)','finish_discover_recommendation_job(uuid,uuid,bigint,text,text)')) {
    $coordinatorChecks += Fn ('public.'+$signature)
    $coordinatorChecks += RpcAcl ('public.'+$signature)
}
foreach ($signature in @('lock_writer(uuid)','seed_owner()','block_owned_write()','assert_job(uuid,uuid,bigint,boolean)','block_storage_metadata()')) {
    $coordinatorChecks += Fn ('deletion_private.'+$signature)
}
$ownedTables = @('discover_recommendation_job_payloads','discover_recommendation_jobs','discover_recommendation_cache','user_events','user_style_profiles','liked_products','passed_products','price_alerts','push_tokens','rate_limits','profiles','users')
foreach ($name in $ownedTables) { $coordinatorChecks += Trigger ('public.'+$name) 'account_deletion_fence' 'deletion_private.block_owned_write()' }
$coordinatorChecks += Trigger 'auth.users' 'deletion_seed_owner' 'deletion_private.seed_owner()'
$coordinatorChecks += Trigger 'auth.users' 'deletion_auth_metadata_fence' 'deletion_private.block_owned_write()'
$coordinatorChecks += Trigger 'storage.objects' 'deletion_storage_metadata_fence' 'deletion_private.block_storage_metadata()'
$coordinatorChecks += Check 'private-schema-acl' "EXISTS(SELECT 1 FROM pg_namespace n WHERE n.nspname='deletion_private' AND NOT EXISTS(SELECT 1 FROM aclexplode(coalesce(n.nspacl,acldefault('n',n.nspowner))) a WHERE a.grantee=0 OR pg_get_userbyid(a.grantee) IN ('anon','authenticated','service_role')))"
$coordinatorChecks += Check 'private-functions-acl' "NOT EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE n.nspname='deletion_private' AND (a.grantee=0 OR pg_get_userbyid(a.grantee) IN ('anon','authenticated','service_role')))"
$coordinatorChecks += Check 'private-no-policies' "NOT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='deletion_private')"
$coordinatorChecks += Check 'trusted-function-owners' "NOT EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE (n.nspname='deletion_private' OR (n.nspname='public' AND p.proname IN ('deletion_storage_barrier','deletion_readiness','deletion_assert_lease','deletion_begin','deletion_save','deletion_release','deletion_clean','deletion_verify','claim_discover_recommendation_job_v2','publish_discover_recommendation_cache','finish_discover_recommendation_job'))) AND pg_get_userbyid(p.proowner)<>'postgres')"
foreach ($pair in @(@('receipts','lease'),@('receipts','lease_until'),@('receipts','recovery_hash'),@('owner_gates','fenced'),@('job_claims','token'),@('job_claims','revision'),@('job_claims','lease_until'),@('job_claims','request_snapshot'))) {
    $coordinatorChecks += Column ('deletion_private.'+$pair[0]) $pair[1]
}
$coordinatorChecks += Check 'inventory-12-owned-tables' '(SELECT count(*) FROM deletion_private.inventory)=12 AND NOT EXISTS(SELECT 1 FROM deletion_private.inventory i WHERE to_regclass(''public.''||i.relation_name) IS NULL OR NOT EXISTS(SELECT 1 FROM pg_attribute a WHERE a.attrelid=to_regclass(''public.''||i.relation_name) AND a.attname=i.owner_column AND NOT a.attisdropped))'
$coordinatorChecks += Check 'tombstones-no-auth-fk' "NOT EXISTS(SELECT 1 FROM pg_constraint WHERE contype='f' AND conrelid IN (to_regclass('deletion_private.receipts'),to_regclass('deletion_private.owner_gates')) AND confrelid=to_regclass('auth.users'))"
$coordinatorChecks += Check 'readiness-disabled' "(SELECT count(*)=1 AND bool_and(NOT attested) FROM deletion_private.readiness) AND public.deletion_readiness()->>'ready'='false' AND public.deletion_readiness()->>'writerCoverage'='false' AND public.deletion_readiness()->>'postAuthRecovery'='false'"
$coordinatorChecks += Check 'storage-barrier-disabled' "public.deletion_storage_barrier('setup-schema-check','00000000-0000-0000-0000-000000000000'::uuid)=false"
$coordinatorChecks += Check 'legacy-claim-disabled' "NOT has_function_privilege('service_role','public.claim_discover_recommendation_job()','EXECUTE') AND NOT has_function_privilege('authenticated','public.claim_discover_recommendation_job()','EXECUTE') AND NOT has_function_privilege('anon','public.claim_discover_recommendation_job()','EXECUTE')"
$coordinatorChecks += Check 'request-rpc-retained' "has_function_privilege('authenticated','public.request_discover_recommendation_job(uuid,text)','EXECUTE')"
foreach ($name in @('discover_recommendation_jobs','discover_recommendation_job_payloads','discover_recommendation_cache')) {
    $coordinatorChecks += Check ('service-direct-write-denied:'+$name) "NOT has_table_privilege('service_role','public.$name','INSERT') AND NOT has_table_privilege('service_role','public.$name','UPDATE') AND NOT has_table_privilege('service_role','public.$name','DELETE')"
}

# Exact report order. No directory enumeration, deferred wardrobe or archive SQL.
$plan = @(
    (Step 'supabase/schema_products.sql' @((Table 'public.products'), (Fn 'public.set_products_updated_at()'), (Trigger 'public.products' 'trg_products_updated_at' 'public.set_products_updated_at()'))),
    (Step 'supabase/schema.sql' @((Table 'public.users'), (Table 'public.liked_products'), (Table 'public.passed_products'), (Fn 'public.handle_new_user()'), (Trigger 'auth.users' 'on_auth_user_created' 'public.handle_new_user()'))),
    (Step 'supabase/variations.sql' @((Column 'public.products' 'colors'), (Column 'public.products' 'sizes'))),
    (Step 'supabase/migrations/20260912_products_images.sql' @((Column 'public.products' 'images'))),
    (Step 'supabase/price_tracking.sql' @((Table 'public.push_tokens'), (Table 'public.price_alerts'), (Column 'public.products' 'current_price'), (Column 'public.products' 'previous_price'), (Column 'public.products' 'last_price_checked_at'), (Column 'public.liked_products' 'target_price'), (Column 'public.liked_products' 'notify_on_price_drop'), (Column 'public.liked_products' 'liked_price'), (Trigger 'public.push_tokens' 'trg_push_tokens_updated_at' 'public.set_push_tokens_updated_at()'))),
    (Step 'supabase/model_studio.sql' @((Table 'public.profiles'), (Bucket 'model-photos'), (Fn 'public.handle_new_profile()'), (Trigger 'auth.users' 'on_auth_user_created_profile' 'public.handle_new_profile()'), (Check 'model-storage-policies' "(SELECT count(*) FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname IN ('model_photos_select_own','model_photos_insert_own','model_photos_update_own','model_photos_delete_own'))=4"))),
    (Step 'supabase/rate_limits.sql' @((Table 'public.rate_limits'), (Fn 'public.consume_vton_quota(uuid,integer,integer)'))),
    (Step 'supabase/recs_v1.sql' @((Table 'public.user_events'), (Table 'public.recs_config'), (Table 'public.style_tag_priors'), (Table 'public.product_attributes'), (Table 'public.user_style_profiles'), (Fn 'public.ingest_events(jsonb)'), (Fn 'public.recompute_profile(uuid)'), (Trigger 'public.recs_config' 'trg_recs_config_updated_at' 'public.set_recs_config_updated_at()'), (Check 'config-seed' "EXISTS(SELECT 1 FROM public.recs_config WHERE key='scoring_weights')"))),
    (Step 'supabase/recs_v1_p1.sql' @((Fn 'public.sync_declared_style_tags(jsonb)'), (Check 'funnel-view-invoker' "EXISTS(SELECT 1 FROM pg_class WHERE oid=to_regclass('public.v_funnel') AND relkind='v' AND 'security_invoker=true'=ANY(reloptions))"), (Check 'p1-config-seeds' "(SELECT count(*) FROM public.recs_config WHERE key IN ('noise_amplitude','scoring_mix','soft_negative'))=3"))),
    (Step 'supabase/recs_v1_trend.sql' @((Check 'trend-config-seed' "EXISTS(SELECT 1 FROM public.recs_config WHERE key='trend_scoring_boost')"))),
    (Step 'supabase/migrations/2026092401_product_providers.sql' @((Check 'providers-constraint' "EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid=to_regclass('public.products') AND conname='products_provider_check' AND convalidated AND pg_get_constraintdef(oid) LIKE '%boyner%' AND pg_get_constraintdef(oid) LIKE '%flo%')"))),
    (Step 'supabase/migrations/2026092402_product_outfit_roles.sql' @((Column 'public.product_attributes' 'outfit_role'), (Check 'role-constraint' "EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid=to_regclass('public.product_attributes') AND conname='product_attributes_outfit_role_check' AND convalidated)"))),
    (Step 'supabase/migrations/20260929_discover_recommendation_cache.sql' @((Table 'public.discover_recommendation_cache'), (Table 'public.discover_recommendation_jobs'), (Table 'public.discover_recommendation_job_payloads'), (Fn 'public.request_discover_recommendation_job(uuid,text)'), (Fn 'public.claim_discover_recommendation_job()'))),
    (Step 'supabase/migrations/20260930_wardrobe_cutout_storage.sql' @((Bucket 'wardrobe-cutouts'), (Check 'cutout-storage-policies' "(SELECT count(*) FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname IN ('wardrobe_cutouts_select_own','wardrobe_cutouts_insert_own','wardrobe_cutouts_update_own'))=3"))),
    (Step 'supabase/migrations/2026100801_backfill_null_outfit_roles.sql' @((Check 'no-copied-products-or-role-gaps' '(SELECT count(*) FROM public.products)=0 AND NOT EXISTS(SELECT 1 FROM public.product_attributes WHERE outfit_role IS NULL)'))),
    (Step 'supabase/migrations/2026100901_quota_execute_least_privilege.sql' @((RpcAcl 'public.consume_vton_quota(uuid,integer,integer)'))),
    (Step 'supabase/migrations/2026100902_client_admin_privileges.sql' @((Check 'client-admin-grants-removed' "NOT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace CROSS JOIN LATERAL aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a WHERE n.nspname='public' AND c.relname IN ('users','products','profiles','liked_products','passed_products','push_tokens','price_alerts','user_events','user_style_profiles') AND (a.grantee=0 OR pg_get_userbyid(a.grantee) IN ('anon','authenticated')) AND a.privilege_type IN ('TRUNCATE','TRIGGER','REFERENCES','MAINTAIN'))"))),
    (Step 'reports/backend/proposals/20261010_account_deletion_coordinator.sql' $coordinatorChecks)
)

try {
    if (-not (Test-Path -LiteralPath $cliPath -PathType Leaf)) { throw 'Local CLI missing' }
    $help = Invoke-Cli 'db query --help --log-level none'
    # Help renders the short alias as "--file, -f". Match complete flag
    # declarations, accepting their comma separator without accepting prefixes.
    if ($help -notmatch '(?m)^\s*(?:-[A-Za-z],\s*)?--db-url(?=\s|,|=|$)') { throw 'CLI lacks SELECT URL support' }
    $migrationHelp=Invoke-Cli 'migration up --help --log-level none'
    if ($migrationHelp -notmatch '(?m)^\s*--db-url(?=\s|,|=|$)' -or
        $migrationHelp -notmatch '(?m)^\s*--workdir(?=\s|,|=|$)') { throw 'Migration up URL/workdir unsupported' }
    $migrationHelp=$null
    $help = $null
    foreach ($step in $plan) {
        $path = Join-Path $repoRoot $step.File
        if (-not (Test-Path -LiteralPath $path -PathType Leaf) -or $path.Contains('"')) { throw 'SQL file missing or invalid' }
        $ordinal=$run.files.Count+1
        $version='2026101100{0:D4}' -f $ordinal
        $migrationName='vitrify_a1_{0:D2}' -f $ordinal
        $run.files += [ordered]@{file=$step.File; sha256=(Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash; version=$version; migration_name=$migrationName; migration_file=($version+'_'+$migrationName+'.sql'); state='NOT_STARTED'; checks=@(); cli_exit=$null}
    }
    $script:migrationWorkRoot=Join-Path ([IO.Path]::GetTempPath()) ('vitrify-staging-'+$stagingRef+'-'+[Guid]::NewGuid().ToString('N'))
    if ($script:migrationWorkRoot.Contains('"') -or (Test-Path -LiteralPath $script:migrationWorkRoot)) { throw 'Invalid isolated workdir' }
    [void][IO.Directory]::CreateDirectory((Join-Path $script:migrationWorkRoot 'supabase/migrations'))
    # Never load repository config, vault secrets, seeds or its migration queue.
    $config="project_id = 'vitrify-a1-staging-isolated'"+"`n[db.seed]`nenabled = false`n"
    [IO.File]::WriteAllText((Join-Path $script:migrationWorkRoot 'supabase/config.toml'),$config,(New-Object Text.UTF8Encoding($false)))
    $run.migration_workdir=$script:migrationWorkRoot
    Save-Run # Fail before any connection/write if the evidence file cannot be saved.
    $securePassword = Read-Host 'Staging database password (hidden)' -AsSecureString
    if ($securePassword.Length -eq 0) { throw 'Empty password' }
    $passwordBuffer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
    $plainPassword = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($passwordBuffer)
    $encodedPassword = [Uri]::EscapeDataString($plainPassword)
    $script:connectionUri = 'postgresql://' + $databaseUser + ':' + $encodedPassword + '@' + $poolerHost + ':5432/postgres?sslmode=require'
    Assert-UriTarget
    $script:phase = 'empty-staging-preflight'
    Assert-DatabaseTarget $true
    Assert-MigrationHistory 0 0
    Save-Run
    for ($i=0; $i -lt $plan.Count; $i++) {
        $step = $plan[$i]; $entry = $run.files[$i]; $path = Join-Path $repoRoot $step.File
        $script:phase = 'before:'+$step.File
        Assert-DatabaseTarget
        Assert-MigrationHistory $i $i
        if ((Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash -ne $entry.sha256) { throw 'SQL file changed' }
        Stage-NextMigration $i
        $entry.state = 'APPLY_STARTED'; $run.partial_application = 'POSSIBLE'; Save-Run
        Write-Host ('['+($i+1)+'/'+$plan.Count+'] Applying to staging '+$stagingRef+': '+$step.File)
        $script:phase = 'apply:'+$step.File
        Assert-UriTarget
        $discard = Invoke-Cli ('migration up --db-url "'+$script:connectionUri+'" --workdir "'+$script:migrationWorkRoot+'" --log-level none')
        $discard = $null
        $entry.cli_exit = $script:lastCliExit; $entry.state = 'APPLIED_UNVERIFIED'
        $script:phase = 'after:'+$step.File
        Assert-DatabaseTarget
        Assert-MigrationHistory ($i+1) $i
        if ((Get-FileHash -LiteralPath (Join-Path (Join-Path $script:migrationWorkRoot 'supabase/migrations') $entry.migration_file) -Algorithm SHA256).Hash -cne $entry.sha256) { throw 'Isolated migration changed during application' }
        if ((Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash -ne $entry.sha256) { throw 'SQL file changed during application' }
        # Every expression is a locally defined catalog/metadata SELECT. Report
        # labels come from the plan, never from untrusted subprocess output.
        $parts = @($step.Checks | ForEach-Object { "SELECT '"+$_.Name+"'::text AS check_name, coalesce(("+$_.Expression+"),false) AS passed" })
        $script:phase = 'verify:'+$step.File
        $rows = @(Read-Rows (($parts -join ' UNION ALL ')+';'))
        if ($rows.Count -ne $step.Checks.Count) { throw 'Verification result count mismatch' }
        $allPassed = $true
        for ($c=0; $c -lt $step.Checks.Count; $c++) {
            $matches = @($rows | Where-Object { $_.check_name -ceq $step.Checks[$c].Name })
            if ($matches.Count -ne 1 -or $matches[0].passed -isnot [bool]) { throw 'Invalid verification result' }
            $passed = $matches[0].passed
            $entry.checks += @{name=$step.Checks[$c].Name; passed=$passed}
            if (-not $passed) { $allPassed = $false }
        }
        if (-not $allPassed) { $entry.state='APPLIED_VERIFY_FAILED'; Save-Run; throw 'Schema verification failed' }
        $entry.state='VERIFIED'; Save-Run
        Write-Host ('Verification PASS: '+$entry.checks.Count+' checks; '+$step.File)
    }
    $script:phase='final-target-check'; Assert-DatabaseTarget
    $script:phase='default-acl-observation'
    $aclRows = @(Read-Rows "SELECT EXISTS(SELECT 1 FROM pg_default_acl d JOIN pg_namespace n ON n.oid=d.defaclnamespace WHERE n.nspname='public' AND d.defaclobjtype='r' AND pg_get_userbyid(d.defaclrole)='supabase_admin') AS admin_defaults_visible, EXISTS(SELECT 1 FROM pg_default_acl d JOIN pg_namespace n ON n.oid=d.defaclnamespace CROSS JOIN LATERAL aclexplode(d.defaclacl) a WHERE n.nspname='public' AND d.defaclobjtype='r' AND pg_get_userbyid(d.defaclrole)='supabase_admin' AND (a.grantee=0 OR pg_get_userbyid(a.grantee) IN ('anon','authenticated')) AND a.privilege_type IN ('TRUNCATE','TRIGGER','REFERENCES','MAINTAIN')) AS admin_defaults_gap;")
    if ($aclRows.Count -ne 1 -or $aclRows[0].admin_defaults_visible -isnot [bool] -or $aclRows[0].admin_defaults_gap -isnot [bool]) { throw 'Invalid default ACL observation' }
    $run.observations += @{phase=$script:phase; admin_defaults_visible=$aclRows[0].admin_defaults_visible; admin_defaults_gap=$aclRows[0].admin_defaults_gap}
    if (-not $aclRows[0].admin_defaults_visible -or $aclRows[0].admin_defaults_gap) { Write-Host 'BLOCKED: supabase_admin default ACL gap remains unresolved. No automatic repair.' }
    $run.status='SCHEMA_VERIFIED'; $run.partial_application='ALL_FILES_VERIFIED'
    $exitStatus=0
    Write-Host 'Schema setup verified. Provider race, deletion behavior and device blockers remain BLOCKED. No Edge deployment performed.'
} catch {
    $run.status='STOPPED'; $run.cli_exit=$script:lastCliExit
    if ($null -eq $run.error_class) { $run.error_class='LOCAL_OR_POSTCONDITION_FAILED' }
    $failedPhase=$script:phase; $failedExit=$script:lastCliExit
    if ($run.files.Count -gt 0) {
        foreach ($entry in $run.files) {
            if ($entry.state -eq 'APPLY_STARTED') { $entry.state='APPLY_FAILED_OR_UNKNOWN'; $entry.cli_exit=$failedExit }
        }
    }
    # One read-only metadata snapshot after a write error; never reapply SQL.
    # An identity/target failure suppresses even this diagnostic connection.
    if ($run.partial_application -eq 'POSSIBLE' -and $script:targetVerified) {
        try { $script:phase='partial-state-snapshot'; Assert-DatabaseTarget; $run.partial_snapshot='IDENTITY_AND_COUNTS_RECORDED' }
        catch { $run.partial_snapshot='UNAVAILABLE'; $script:targetVerified=$false }
    }
    $script:phase=$failedPhase; $script:lastCliExit=$failedExit
    Write-Host ('STOP: '+$failedPhase+'. No retry or later SQL files. Raw CLI diagnostics withheld to protect credentials.')
} finally {
    if ($passwordBuffer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordBuffer) }
    if ($null -ne $securePassword) { $securePassword.Dispose() }
    $plainPassword=$null; $encodedPassword=$null; $script:connectionUri=$null; $discard=$null; $help=$null; $migrationHelp=$null
    $run.finished_utc=[DateTime]::UtcNow.ToString('o')
    try { Save-Run; Write-Host ('Secret-free evidence: '+$runPath) }
    catch { Write-Host 'STOP: Evidence file could not be saved. Do not rerun; inspect partial staging state first.'; $exitStatus=1 }
}
exit $exitStatus
