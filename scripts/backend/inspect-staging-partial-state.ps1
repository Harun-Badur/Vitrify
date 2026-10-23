[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$VerbosePreference='SilentlyContinue'
$DebugPreference='SilentlyContinue'
$repoRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$driverPath=Join-Path $repoRoot 'node_modules/@supabase/cli-windows-x64/bin/supabase.exe'
$stagingRef='sdjxseqfkturkfohkfni'
$productionRef='hnujkabyyrlsxohjhxlg'
$poolerHost='aws-1-eu-central-1.pooler.supabase.com'
$databaseUser='postgres.sdjxseqfkturkfohkfni'
# Startup options alone did not establish transaction_read_only in the observed
# run. Use the installed Bun.SQL driver and explicit BEGIN READ ONLY instead.
# The old JSON parser reached IDENTITY_READONLY_NOT_ON, not a JSON shape error.
# The precise upstream reason for ignoring/resetting the startup setting is
# unproved; no provider behavior is assumed by this replacement.
$uriQuery='?sslmode=require'
$script:connectionUri=$null
$securePassword=$null
$passwordBuffer=[IntPtr]::Zero
$plainPassword=$null
$encodedPassword=$null
$script:phase='local-preflight'
$exitStatus=1
$run=[ordered]@{staging_ref=$stagingRef; started_utc=[DateTime]::UtcNow.ToString('o'); status='PREPARING'; phase='local-preflight'; driver='installed-Bun.SQL'; driver_exit=$null; error_class=$null; observations=@(); protocol_probe='NOT_RUN_DRIVER_CHANGED'; baseline_comparison='BLOCKED_NO_BEFORE_CATALOG'; a1='BLOCKED'; writes=0; transaction_read_only_verified=$false; rollback_verified=$false}
$runPath=Join-Path $repoRoot ('reports/backend/staging-partial-inspection-'+[DateTime]::UtcNow.ToString('yyyyMMddTHHmmssfffffffZ')+'.json')

function Assert-Target {
    $target=[Uri]$script:connectionUri
    $user=[Uri]::UnescapeDataString(($target.UserInfo -split ':',2)[0])
    if ($target.Scheme -ne 'postgresql' -or $target.Host -ne $poolerHost -or
        $target.Port -ne 5432 -or $target.AbsolutePath -ne '/postgres' -or
        $user -ne $databaseUser -or $user -ne ('postgres.'+$stagingRef) -or
        $target.Query -ne $uriQuery -or $target.Fragment -ne '' -or
        $script:connectionUri.Contains($productionRef)) { throw 'TARGET_MISMATCH' }
}

# This program is embedded so no helper file/dependency installation is needed.
# Credentials travel through redirected stdin, never argv, env, output or a file.
# BUN_BE_BUN selects the existing executable's bundled runtime, not the CLI.
$driverSource=@'
const identitySql = "SELECT current_database() AS database_name, current_user AS database_role, current_setting('transaction_read_only') AS read_only, (SELECT count(*) FROM auth.users) AS auth_user_count";
function fail(errorClass) { const e = new Error("SAFE_VALIDATION_FAILURE"); e.safeClass = errorClass; throw e; }
function validateTarget(uri) {
  const u = new URL(uri);
  if (u.protocol !== "postgresql:" || u.hostname !== "aws-1-eu-central-1.pooler.supabase.com" ||
      u.port !== "5432" || u.pathname !== "/postgres" ||
      decodeURIComponent(u.username) !== "postgres.sdjxseqfkturkfohkfni" ||
      u.search !== "?sslmode=require" || u.hash !== "" ||
      uri.includes("hnujkabyyrlsxohjhxlg")) fail("TARGET_MISMATCH");
}
function validateIdentity(rows) {
  if (!Array.isArray(rows) || rows.length !== 1) fail("IDENTITY_ROW_COUNT_MISMATCH");
  const r = rows[0];
  if (!r || typeof r !== "object" || Array.isArray(r) ||
      !["database_name","database_role","read_only","auth_user_count"].every(k => Object.hasOwn(r,k) && r[k] !== null)) fail("IDENTITY_FIELDS_INVALID");
  if (r.database_name !== "postgres") fail("IDENTITY_DATABASE_MISMATCH");
  if (r.database_role !== "postgres") fail("IDENTITY_ROLE_MISMATCH");
  if (r.read_only !== "on") fail("IDENTITY_READONLY_NOT_ON");
  const n = r.auth_user_count;
  // PostgreSQL bigint can be a bigint or an exact decimal string in drivers.
  if (!(n === 0 || n === 0n || n === "0")) fail("IDENTITY_AUTH_NOT_EMPTY_OR_INVALID");
}
function safeClass(e) {
  const allowed = new Set(["TARGET_MISMATCH","IDENTITY_ROW_COUNT_MISMATCH","IDENTITY_FIELDS_INVALID",
    "IDENTITY_DATABASE_MISMATCH","IDENTITY_ROLE_MISMATCH","IDENTITY_READONLY_NOT_ON",
    "IDENTITY_AUTH_NOT_EMPTY_OR_INVALID","INVENTORY_RESPONSE_INVALID","QUERY_PLAN_INVALID",
    "DRIVER_UNAVAILABLE","ROLLBACK_FAILED","DRIVER_CLOSE_FAILED"]);
  if (allowed.has(e?.safeClass)) return e.safeClass;
  if (e?.code === "28P01") return "DB_AUTHENTICATION_FAILED";
  if (e?.code === "42501") return "DB_PERMISSION_DENIED";
  if (["ERR_POSTGRES_TLS_NOT_AVAILABLE","ERR_POSTGRES_TLS_UPGRADE_FAILED"].includes(e?.code)) return "DB_TLS_FAILED";
  return "DRIVER_ERROR_UNCLASSIFIED";
}
function countValue(v) {
  if (typeof v === "bigint" && v >= 0n && v <= BigInt(Number.MAX_SAFE_INTEGER)) return Number(v);
  if (typeof v === "string" && /^(0|[1-9][0-9]*)$/.test(v)) {
    const n = Number(v); if (Number.isSafeInteger(n)) return n;
  }
  if (typeof v === "number" && Number.isSafeInteger(v) && v >= 0) return v;
  fail("INVENTORY_RESPONSE_INVALID");
}
function validateInventory(rows, names, fingerprint) {
  if (!Array.isArray(rows) || rows.length !== names.length) fail("INVENTORY_RESPONSE_INVALID");
  return names.map(name => {
    const found = rows.filter(r => r && r.check_name === name);
    if (found.length !== 1) fail("INVENTORY_RESPONSE_INVALID");
    if (fingerprint) {
      const value = found[0].fingerprint;
      if (typeof value !== "string" || !/^[a-f0-9]{32}$/.test(value)) fail("INVENTORY_RESPONSE_INVALID");
      return {name, fingerprint:value};
    }
    return {name, count:countValue(found[0].count_value)};
  });
}
async function inspect(input, createDriver) {
  const result = {status:"STOPPED",phase:"target-validation",error_class:null,observations:[],
    transaction_read_only_verified:false,rollback_verified:false};
  let sql, reserved;
  try {
    validateTarget(input.uri);
    if (!Array.isArray(input.queries) || input.queries.length !== 2 ||
        input.queries.some(q => typeof q.sql !== "string" || !q.sql.startsWith("SELECT ") ||
          q.sql.includes(";") || !Array.isArray(q.names) || q.names.some(n => typeof n !== "string")) ||
        input.queries[0].fingerprint !== false || input.queries[1].fingerprint !== true) fail("QUERY_PLAN_INVALID");
    result.phase = "driver-connect";
    sql = createDriver(input.uri);
    reserved = await sql.reserve();
    result.phase = "begin-readonly";
    await reserved.unsafe("BEGIN READ ONLY");
    result.phase = "staging-identity-readonly-check";
    validateIdentity(await reserved.unsafe(identitySql));
    result.transaction_read_only_verified = true;
    // No inventory SELECT is sent before target and transaction identity pass.
    for (const q of input.queries) {
      result.phase = q.fingerprint ? "catalog-fingerprints" : "partial-catalog-inspection";
      result.observations.push(...validateInventory(await reserved.unsafe(q.sql), q.names, q.fingerprint));
    }
    result.phase = "final-staging-identity-check";
    validateIdentity(await reserved.unsafe(identitySql));
    result.status = "READONLY_INSPECTION_COMPLETE";
  } catch(e) { result.error_class = safeClass(e); }
  finally {
    if (reserved) {
      try { await reserved.unsafe("ROLLBACK"); result.rollback_verified = true; }
      catch { if (!result.error_class) result.error_class = "ROLLBACK_FAILED"; result.status = "STOPPED"; }
      try { reserved.release(); } catch { result.status = "STOPPED"; if (!result.error_class) result.error_class = "DRIVER_CLOSE_FAILED"; }
    }
    if (sql) {
      try { await sql.close({timeout:0}); }
      catch { result.status = "STOPPED"; if (!result.error_class) result.error_class = "DRIVER_CLOSE_FAILED"; }
    }
  }
  return result;
}
async function main() {
  let input;
  try {
    input = JSON.parse(await Bun.stdin.text());
    if (typeof Bun.SQL !== "function") fail("DRIVER_UNAVAILABLE");
    const result = await inspect(input, uri => new Bun.SQL(uri, {
      max:1, ssl:"require", prepare:false, connectionTimeout:15, idleTimeout:0
    }));
    process.stdout.write(JSON.stringify(result));
    process.exitCode = result.status === "READONLY_INSPECTION_COMPLETE" ? 0 : 1;
  } catch(e) {
    process.stdout.write(JSON.stringify({status:"STOPPED",phase:"driver-input",error_class:safeClass(e),
      observations:[],transaction_read_only_verified:false,rollback_verified:false}));
    process.exitCode = 1;
  } finally { if (input) input.uri = null; input = null; }
}
await main();
'@

function Invoke-Driver([string]$Payload) {
    $info=New-Object Diagnostics.ProcessStartInfo
    $info.FileName=$driverPath; $info.WorkingDirectory=$repoRoot
    $info.UseShellExecute=$false; $info.CreateNoWindow=$true
    $info.RedirectStandardOutput=$true; $info.RedirectStandardError=$true; $info.RedirectStandardInput=$true
    # Source is static and secret-free. Base64 avoids shell/Windows argv quoting.
    $source64=[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($driverSource))
    $info.Arguments='--eval "await import(''data:text/javascript;base64,'+$source64+''')"'
    $info.EnvironmentVariables['BUN_BE_BUN']='1'
    $p=New-Object Diagnostics.Process; $p.StartInfo=$info
    $stdout=$null; $stderr=$null; $outTask=$null; $errTask=$null
    try {
        $run.error_class='PROCESS_START_FAILURE'
        if (-not $p.Start()) { throw 'PROCESS_START_FAILURE' }
        $outTask=$p.StandardOutput.ReadToEndAsync(); $errTask=$p.StandardError.ReadToEndAsync()
        $p.StandardInput.Write($Payload); $p.StandardInput.Close()
        $Payload=$null
        $run.error_class='TIMEOUT_OUTCOME_UNKNOWN'
        if (-not $p.WaitForExit(60000)) { $p.Kill(); $p.WaitForExit(); throw 'TIMEOUT_OUTCOME_UNKNOWN' }
        $stdout=$outTask.GetAwaiter().GetResult(); $stderr=$errTask.GetAwaiter().GetResult()
        $run.driver_exit=$p.ExitCode
        $run.error_class='DRIVER_RESPONSE_INVALID'
        # The driver itself emits only whitelist metadata/errors. Still never
        # forward its raw output or stderr, including runtime/loader exceptions.
        $result=ConvertFrom-Json -InputObject $stdout
        if ($result -isnot [pscustomobject] -or $result.status -cnotin @('STOPPED','READONLY_INSPECTION_COMPLETE') -or
            $result.phase -cnotin @('target-validation','driver-connect','begin-readonly','staging-identity-readonly-check','partial-catalog-inspection','catalog-fingerprints','final-staging-identity-check','driver-input') -or
            $result.transaction_read_only_verified -isnot [bool] -or $result.rollback_verified -isnot [bool] -or
            $result.observations -isnot [array]) { throw 'DRIVER_RESPONSE_INVALID' }
        $allowedErrors=@('TARGET_MISMATCH','IDENTITY_ROW_COUNT_MISMATCH','IDENTITY_FIELDS_INVALID','IDENTITY_DATABASE_MISMATCH','IDENTITY_ROLE_MISMATCH','IDENTITY_READONLY_NOT_ON','IDENTITY_AUTH_NOT_EMPTY_OR_INVALID','INVENTORY_RESPONSE_INVALID','QUERY_PLAN_INVALID','DRIVER_UNAVAILABLE','ROLLBACK_FAILED','DRIVER_CLOSE_FAILED','DB_AUTHENTICATION_FAILED','DB_PERMISSION_DENIED','DB_TLS_FAILED','DRIVER_ERROR_UNCLASSIFIED')
        if ($null -ne $result.error_class -and $result.error_class -cnotin $allowedErrors) { throw 'DRIVER_RESPONSE_INVALID' }
        $script:phase=$result.phase; $run.error_class=$result.error_class
        $run.transaction_read_only_verified=$result.transaction_read_only_verified
        $run.rollback_verified=$result.rollback_verified
        foreach ($item in $result.observations) {
            # Some fingerprint labels also occur among count metrics. Select
            # the typed field first; a fingerprint must never enter count validation.
            if ($item.PSObject.Properties['count'] -and $item.name -cin @($metrics.Name)) {
                if ($null -eq $item.count -or ($item.count -isnot [int] -and $item.count -isnot [long]) -or $item.count -lt 0) { throw 'DRIVER_RESPONSE_INVALID' }
                $run.observations+=@{name=$item.name; count=$item.count}
            } elseif ($item.PSObject.Properties['fingerprint'] -and $item.name -cin @($fingerprints.Name)) {
                if ($item.fingerprint -isnot [string] -or $item.fingerprint -cnotmatch '^[a-f0-9]{32}$') { throw 'DRIVER_RESPONSE_INVALID' }
                $run.observations+=@{name=$item.name; fingerprint=$item.fingerprint}
            } else { throw 'DRIVER_RESPONSE_INVALID' }
        }
        if ($p.ExitCode -ne 0 -or $result.status -cne 'READONLY_INSPECTION_COMPLETE' -or
            $null -ne $result.error_class -or -not $result.transaction_read_only_verified -or -not $result.rollback_verified) { throw 'INSPECTION_STOPPED' }
        if ($run.observations.Count -ne ($metrics.Count+$fingerprints.Count)) { throw 'DRIVER_RESPONSE_INVALID' }
        foreach ($name in @($metrics.Name)) {
            if (@($run.observations | Where-Object {$_.name -ceq $name -and $_.ContainsKey('count')}).Count -ne 1) { throw 'DRIVER_RESPONSE_INVALID' }
        }
        foreach ($name in @($fingerprints.Name)) {
            if (@($run.observations | Where-Object {$_.name -ceq $name -and $_.ContainsKey('fingerprint')}).Count -ne 1) { throw 'DRIVER_RESPONSE_INVALID' }
        }
        $run.error_class=$null
    } finally {
        $info.Arguments=''; $Payload=$null; $stdout=$null; $stderr=$null; $outTask=$null; $errTask=$null
        $p.Dispose()
    }
}

function Metric([string]$Name,[string]$Expression) { return @{Name=$Name; Expression=$Expression} }
$metrics=@(
    (Metric 'public_tables' "(SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p'))"),
    (Metric 'public_functions' "(SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public')"),
    (Metric 'public_sequences' "(SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='S')"),
    (Metric 'public_indexes' "(SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('i','I'))"),
    (Metric 'public_triggers' "(SELECT count(*) FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND NOT t.tgisinternal)"),
    (Metric 'public_policies' "(SELECT count(*) FROM pg_policies WHERE schemaname='public')"),
    (Metric 'non_system_schemas' "(SELECT count(*) FROM pg_namespace WHERE nspname NOT LIKE 'pg_%' AND nspname<>'information_schema')"),
    (Metric 'deletion_private_schema' "(SELECT count(*) FROM pg_namespace WHERE nspname='deletion_private')"),
    (Metric 'extensions' '(SELECT count(*) FROM pg_extension)'),
    (Metric 'public_extensions' "(SELECT count(*) FROM pg_extension e JOIN pg_namespace n ON n.oid=e.extnamespace WHERE n.nspname='public')"),
    (Metric 'products_table' "(SELECT count(*) FROM pg_class WHERE oid=to_regclass('public.products') AND relkind IN ('r','p'))"),
    (Metric 'products_columns' "(SELECT count(*) FROM pg_attribute WHERE attrelid=to_regclass('public.products') AND attnum>0 AND NOT attisdropped)"),
    (Metric 'products_rls' "(SELECT count(*) FROM pg_class WHERE oid=to_regclass('public.products') AND relrowsecurity)"),
    (Metric 'products_force_rls' "(SELECT count(*) FROM pg_class WHERE oid=to_regclass('public.products') AND relforcerowsecurity)"),
    (Metric 'products_constraints' "(SELECT count(*) FROM pg_constraint WHERE conrelid=to_regclass('public.products'))"),
    (Metric 'products_primary_key' "(SELECT count(*) FROM pg_constraint WHERE conrelid=to_regclass('public.products') AND conname='products_pkey' AND contype='p')"),
    (Metric 'products_provider_check' "(SELECT count(*) FROM pg_constraint WHERE conrelid=to_regclass('public.products') AND conname='products_provider_check')"),
    (Metric 'products_category_check' "(SELECT count(*) FROM pg_constraint WHERE conrelid=to_regclass('public.products') AND conname='products_category_check')"),
    (Metric 'products_id_key_index' "(SELECT count(*) FROM pg_index WHERE indexrelid=to_regclass('public.products_id_key') AND indisunique AND indisvalid)"),
    (Metric 'products_pkey_index' "(SELECT count(*) FROM pg_index WHERE indexrelid=to_regclass('public.products_pkey') AND indisprimary AND indisvalid)"),
    (Metric 'products_composite_type' "(SELECT count(*) FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='public' AND t.typname='products' AND t.typtype='c')"),
    (Metric 'products_array_type' "(SELECT count(*) FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='public' AND t.typname='_products')"),
    (Metric 'products_toast_table' "(SELECT count(*) FROM pg_class c JOIN pg_class t ON t.oid=c.reltoastrelid WHERE c.oid=to_regclass('public.products') AND t.relkind='t')"),
    (Metric 'products_toast_indexes' "(SELECT count(*) FROM pg_class c JOIN pg_index i ON i.indrelid=c.reltoastrelid WHERE c.oid=to_regclass('public.products'))"),
    (Metric 'set_products_updated_at_function' "(SELECT count(*) FROM pg_proc WHERE oid=to_regprocedure('public.set_products_updated_at()'))"),
    (Metric 'products_update_trigger' "(SELECT count(*) FROM pg_trigger WHERE tgrelid=to_regclass('public.products') AND tgname='trg_products_updated_at' AND NOT tgisinternal)"),
    (Metric 'products_trigger_binding_enabled' "(SELECT count(*) FROM pg_trigger WHERE tgrelid=to_regclass('public.products') AND tgname='trg_products_updated_at' AND tgfoid=to_regprocedure('public.set_products_updated_at()') AND tgtype=19 AND tgenabled='O')"),
    (Metric 'products_select_policy' "(SELECT count(*) FROM pg_policies WHERE schemaname='public' AND tablename='products' AND policyname='products_select_anon')"),
    (Metric 'public_table_acl_entries' "(SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace CROSS JOIN LATERAL aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a WHERE n.nspname='public' AND c.relkind IN ('r','p'))"),
    (Metric 'public_function_acl_entries' "(SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE n.nspname='public')"),
    (Metric 'public_schema_acl_entries' "(SELECT count(*) FROM pg_namespace n CROSS JOIN LATERAL aclexplode(coalesce(n.nspacl,acldefault('n',n.nspowner))) a WHERE n.nspname='public')"),
    (Metric 'public_default_acl_entries' "(SELECT count(*) FROM pg_default_acl d JOIN pg_namespace n ON n.oid=d.defaclnamespace CROSS JOIN LATERAL aclexplode(d.defaclacl) a WHERE n.nspname='public')")
)
$fingerprints=@(
    @{Name='schemas'; From="pg_namespace n"; Filter="n.nspname NOT LIKE 'pg_%' AND n.nspname<>'information_schema'"; Value="n.nspname||':'||n.nspowner::text||':'||coalesce(n.nspacl::text,'')"},
    @{Name='public_relations'; From="pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace"; Filter="n.nspname='public'"; Value="c.relname||':'||c.relkind::text||':'||c.relowner::text||':'||c.relrowsecurity::text||':'||coalesce(c.relacl::text,'')"},
    @{Name='public_functions'; From="pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace"; Filter="n.nspname='public'"; Value="p.proname||':'||p.proargtypes::text||':'||p.proowner::text||':'||coalesce(p.proacl::text,'')"},
    @{Name='public_triggers'; From="pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace"; Filter="n.nspname='public' AND NOT t.tgisinternal"; Value="c.relname||':'||t.tgname||':'||t.tgfoid::text||':'||t.tgtype::text||':'||t.tgenabled::text"},
    @{Name='public_policies'; From='pg_policies p'; Filter="p.schemaname='public'"; Value="p.tablename||':'||p.policyname||':'||p.roles::text||':'||p.cmd||':'||coalesce(p.qual,'')||':'||coalesce(p.with_check,'')"},
    @{Name='extensions'; From='pg_extension e'; Filter='true'; Value="e.extname||':'||e.extversion||':'||e.extnamespace::text||':'||e.extowner::text"},
    @{Name='default_acls'; From='pg_default_acl d'; Filter='true'; Value="d.defaclrole::text||':'||d.defaclnamespace::text||':'||d.defaclobjtype::text||':'||d.defaclacl::text"}
)
foreach ($column in @('id','provider','external_id','title','brand','price','currency','image_url','product_url','category','affiliate_url','garment_description','created_at','updated_at','images')) {
    $metrics+=Metric ('products_column_'+$column) "(SELECT count(*) FROM pg_attribute WHERE attrelid=to_regclass('public.products') AND attname='$column' AND NOT attisdropped)"
}
foreach ($role in @('anon','authenticated','service_role')) {
    foreach ($privilege in @('SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER')) {
        $metrics+=Metric ('products_acl_'+$role+'_'+$privilege) "(SELECT count(*) FROM pg_class c WHERE c.oid=to_regclass('public.products') AND has_table_privilege('$role',c.oid,'$privilege'))"
    }
    $metrics+=Metric ('function_execute_'+$role) "(SELECT count(*) FROM pg_proc p WHERE p.oid=to_regprocedure('public.set_products_updated_at()') AND has_function_privilege('$role',p.oid,'EXECUTE'))"
    $metrics+=Metric ('public_schema_usage_'+$role) "(SELECT count(*) FROM pg_namespace n WHERE n.nspname='public' AND has_schema_privilege('$role',n.oid,'USAGE'))"
    $metrics+=Metric ('public_schema_create_'+$role) "(SELECT count(*) FROM pg_namespace n WHERE n.nspname='public' AND has_schema_privilege('$role',n.oid,'CREATE'))"
}

try {
    if (-not (Test-Path -LiteralPath $driverPath -PathType Leaf)) { $run.error_class='DRIVER_UNAVAILABLE'; throw 'DRIVER_UNAVAILABLE' }
    $securePassword=Read-Host 'Staging database password (hidden)' -AsSecureString
    if ($securePassword.Length -eq 0) { $run.error_class='EMPTY_PASSWORD'; throw 'EMPTY_PASSWORD' }
    $passwordBuffer=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
    $plainPassword=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($passwordBuffer)
    $encodedPassword=[Uri]::EscapeDataString($plainPassword)
    $script:connectionUri='postgresql://'+$databaseUser+':'+$encodedPassword+'@'+$poolerHost+':5432/postgres'+$uriQuery
    $run.error_class='TARGET_MISMATCH'; Assert-Target
    $parts=@($metrics | ForEach-Object { "SELECT '"+$_.Name+"'::text AS check_name, ("+$_.Expression+")::bigint AS count_value" })
    $metricSql=$parts -join ' UNION ALL '
    $parts=@($fingerprints | ForEach-Object { "SELECT '"+$_.Name+"'::text AS check_name, (SELECT md5(coalesce(string_agg("+$_.Value+", '|' ORDER BY "+$_.Value+"),'')) FROM "+$_.From+" WHERE "+$_.Filter+") AS fingerprint" })
    $fingerprintSql=$parts -join ' UNION ALL '
    $payload=@{uri=$script:connectionUri; queries=@(@{sql=$metricSql; names=@($metrics.Name); fingerprint=$false},@{sql=$fingerprintSql; names=@($fingerprints.Name); fingerprint=$true})} | ConvertTo-Json -Depth 5 -Compress
    $script:phase='driver-transaction'; $run.error_class=$null
    Invoke-Driver $payload
    $run.status='READONLY_INSPECTION_COMPLETE'; $exitStatus=0
    Write-Host ('Read-only transaction verified and rolled back. Metadata observations: '+$run.observations.Count+'. Partial state remains unproven against a missing baseline. Do not rerun setup yet.')
} catch {
    $run.status='STOPPED'
    if ($null -eq $run.error_class) { $run.error_class='LOCAL_OR_RESPONSE_VALIDATION_FAILED' }
    Write-Host ('STOP: '+$script:phase+'; error_class='+$run.error_class+'. Raw diagnostics withheld.')
} finally {
    if ($passwordBuffer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordBuffer) }
    if ($null -ne $securePassword) { $securePassword.Dispose() }
    $plainPassword=$null; $encodedPassword=$null; $script:connectionUri=$null; $payload=$null
    $run.phase=$script:phase; $run.finished_utc=[DateTime]::UtcNow.ToString('o')
    try { $run | ConvertTo-Json -Depth 7 | Set-Content -LiteralPath $runPath -Encoding UTF8; Write-Host ('Secret-free evidence: '+$runPath) }
    catch { Write-Host 'STOP: Evidence file could not be saved.'; $exitStatus=1 }
}
exit $exitStatus
