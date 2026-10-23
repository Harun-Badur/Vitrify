[CmdletBinding()]
param()
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$VerbosePreference='SilentlyContinue';$DebugPreference='SilentlyContinue'
$a1Repo=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$a1Report=Join-Path $a1Repo 'reports/backend/a1-m20-current-preflight.json'
$a1Evidence=[ordered]@{status='WAITING_SECURE_INPUT';target='sdjxseqfkturkfohkfni';readonly_preflight_calls=0;migration_calls=0;tests='NOT_RUN';backup_restore='NOT_PROVEN';cli_history_atomicity='NOT_PROVEN';cli_exit=$null;observations=$null;error_class=$null}
function SaveEvidence { $a1Evidence | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $a1Report -Encoding UTF8 }
$a1Secret=$null;$a1Password=$null;$a1Uri=$null;$a1Secure=$null;$a1SecurePassword=$null;$a1Bstr=[IntPtr]::Zero;$a1Process=$null
try {
 $Host.UI.RawUI.WindowTitle='Vitrify A1 M20 - Secure local input'
 SaveEvidence
 Set-Location -LiteralPath $a1Repo
 Write-Host 'Vitrify-A1-Staging only. One READ ONLY preflight; no migration in this helper.'
 Write-Host 'Enter the PostgreSQL connection URI below, never in Codex chat. Input is masked.'
 $a1Secure=Read-Host 'Staging PostgreSQL URI (hidden)' -AsSecureString
 $a1Bstr=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($a1Secure)
 $a1Secret=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($a1Bstr)
 [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($a1Bstr);$a1Bstr=[IntPtr]::Zero
 $a1Uri=[Uri]$a1Secret
 $a1UserInfo=$a1Uri.UserInfo -split ':',2
 $a1User=[Uri]::UnescapeDataString($a1UserInfo[0])
 if($a1Uri.Scheme -ne 'postgresql' -or $a1Uri.Host -ne 'aws-1-eu-central-1.pooler.supabase.com' -or $a1Uri.Port -ne 5432 -or
    $a1Uri.AbsolutePath -ne '/postgres' -or $a1User -ne 'postgres.sdjxseqfkturkfohkfni' -or $a1Uri.Fragment -ne '' -or
    $a1Uri.Query -notin @('','?sslmode=require') -or $a1Secret.Contains('hnujkabyyrlsxohjhxlg')) { $a1Evidence.error_class='TARGET_MISMATCH';throw 'Stop' }
 if($a1UserInfo.Count -eq 2 -and $a1UserInfo[1]){$a1Password=[Uri]::UnescapeDataString($a1UserInfo[1])}
 else {
  $a1SecurePassword=Read-Host 'Staging database password (hidden)' -AsSecureString
  $a1Bstr=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($a1SecurePassword)
  $a1Password=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($a1Bstr)
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($a1Bstr);$a1Bstr=[IntPtr]::Zero
 }
 if([string]::IsNullOrEmpty($a1Password)){$a1Evidence.error_class='EMPTY_PASSWORD';throw 'Stop'}
 $a1Map=Get-Content -LiteralPath (Join-Path $a1Repo 'reports/backend/isolated-a1-migration20/source-map.json') -Raw | ConvertFrom-Json
 $a1Pairs=@($a1Map.historical_files | ForEach-Object {
  if($_.file -cnotmatch '^(\d{14})_(vitrify_a1_\d{2})[.]sql$'){throw 'Stop'}
  "('"+$Matches[1]+"','"+$Matches[2]+"')"
 }) -join ','
 $a1Sql=@'
begin read only;
set local statement_timeout='30s';
select jsonb_build_object(
 'identity',jsonb_build_object('database',current_database(),'role',current_user,'ssl',coalesce((select ssl from pg_stat_ssl where pid=pg_backend_pid()),false),
   'project_setting_matches',case when current_setting('app.settings.supabase_url',true) is null then null else current_setting('app.settings.supabase_url',true)='https://sdjxseqfkturkfohkfni.supabase.co' end),
 'history',jsonb_build_object('count',(select count(*) from supabase_migrations.schema_migrations),
   'matched',(select count(*) from supabase_migrations.schema_migrations h join (values __PAIRS__) e(version,name) on h.version=e.version and h.name=e.name),
   'digest',(select md5(coalesce(string_agg(version||':'||coalesce(name,'')||':'||coalesce(statements::text,''),'|' order by version),'')) from supabase_migrations.schema_migrations)),
 'data_counts',jsonb_build_object('auth_users',(select count(*) from auth.users),'storage_objects',(select count(*) from storage.objects),'storage_buckets',(select count(*) from storage.buckets),
   'storage_operations',(select count(*) from deletion_private.storage_operations),'unresolved',(select count(*) from deletion_private.storage_operations where state<>'SUCCEEDED'),
   'legacy_operations',(select count(*) from deletion_private.storage_operations where legacy_record),'receipts',(select count(*) from deletion_private.receipts)),
 'table_contract',(select jsonb_agg(jsonb_build_object('column',attname,'type',format_type(atttypid,atttypmod)) order by attnum) from pg_attribute where attrelid='deletion_private.storage_operations'::regclass and attnum>0 and not attisdropped),
 'base_tables',(select jsonb_agg(jsonb_build_object('name',c.relname,'owner',pg_get_userbyid(c.relowner),'rls',c.relrowsecurity,
   'client_acl',exists(select 1 from aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a where a.grantee=0 or pg_get_userbyid(a.grantee) in ('anon','authenticated','service_role'))))
   from pg_class c where c.oid in ('deletion_private.storage_operations'::regclass,'deletion_private.owner_gates'::regclass,'deletion_private.receipts'::regclass)),
 'schema_owner',(select pg_get_userbyid(nspowner) from pg_namespace where nspname='deletion_private'),
 'rpcs',(select jsonb_agg(jsonb_build_object('signature',p.oid::regprocedure::text,'owner',pg_get_userbyid(p.proowner),'definer',p.prosecdef,
   'expected_search_path',p.proconfig @> array['search_path=pg_catalog, deletion_private'],'config_count',cardinality(p.proconfig),
   'body_digest',md5(regexp_replace(p.prosrc,'[[:space:]]','','g')),
   'acl',(select jsonb_agg(jsonb_build_object('role',case when a.grantee=0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end,'privilege',a.privilege_type,'grantable',a.is_grantable)) from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a)))
   from pg_proc p where p.oid in (to_regprocedure('deletion_private.lock_writer(uuid)'),to_regprocedure('public.storage_upload_admit(text,text,text)'),to_regprocedure('public.storage_upload_start(uuid,uuid,uuid,text,text)'),to_regprocedure('public.storage_upload_succeed(uuid,uuid,uuid,text,text,jsonb)'))),
 'new_objects_absent',to_regclass('deletion_private.storage_resolutions') is null and to_regclass('deletion_private.provider_operations') is null
   and to_regprocedure('public.storage_upload_status(text)') is null and to_regprocedure('public.storage_upload_cancel_before_dispatch(uuid,uuid,text)') is null
   and to_regprocedure('public.deletion_storage_barrier_snapshot(text,uuid)') is null and to_regprocedure('public.provider_dispatch_admit(uuid,text,text)') is null
   and to_regprocedure('public.provider_dispatch_start(uuid,uuid,uuid,text,text)') is null and to_regprocedure('public.provider_dispatch_observe(uuid,uuid,uuid,text,text,text)') is null,
 'auth_insert_trigger_audit',(select jsonb_agg(jsonb_build_object('name',t.tgname,'function_digest',md5(p.prosrc),
   'possible_external_effect',p.prosrc ~* '(http|net[.]|dblink|foreign|send|notify|vault)')) from pg_trigger t join pg_proc p on p.oid=t.tgfoid where t.tgrelid='auth.users'::regclass and not t.tgisinternal),
 'gate_definition_digests',(select jsonb_agg(jsonb_build_object('name',p.proname,'body_digest',md5(p.prosrc))) from pg_proc p where p.oid in (to_regprocedure('public.deletion_readiness()'),to_regprocedure('public.deletion_storage_barrier(text,uuid)')))
);
rollback;
'@
 $a1Sql=$a1Sql.Replace('__PAIRS__',$a1Pairs)
 $a1Start=[Diagnostics.ProcessStartInfo]::new()
 $a1Start.FileName='C:\Users\Harun\AppData\Local\Temp\vitrify-pg17\pgsql\bin\psql.exe'
 $a1Start.UseShellExecute=$false;$a1Start.CreateNoWindow=$true;$a1Start.RedirectStandardInput=$true;$a1Start.RedirectStandardOutput=$true;$a1Start.RedirectStandardError=$true
 # Windows PowerShell 5 uses the Arguments property; no URI/password in arguments.
 $a1Start.Arguments='-X -q -A -t -v ON_ERROR_STOP=1 -h aws-1-eu-central-1.pooler.supabase.com -p 5432 -U postgres.sdjxseqfkturkfohkfni -d postgres'
 foreach($a1Key in @($a1Start.EnvironmentVariables.Keys | Where-Object {$_ -like 'PG*'})){$a1Start.EnvironmentVariables.Remove($a1Key)}
 $a1Start.EnvironmentVariables['PGPASSWORD']=$a1Password;$a1Start.EnvironmentVariables['PGSSLMODE']='require';$a1Start.EnvironmentVariables['PGCONNECT_TIMEOUT']='10'
 $a1Process=[Diagnostics.Process]::new();$a1Process.StartInfo=$a1Start
 $a1Evidence.status='PREFLIGHT_RUNNING';SaveEvidence
 [void]$a1Process.Start();$a1Evidence.readonly_preflight_calls=1;SaveEvidence
 $a1Out=$a1Process.StandardOutput.ReadToEndAsync();$a1Err=$a1Process.StandardError.ReadToEndAsync()
 $a1Process.StandardInput.WriteLine($a1Sql);$a1Process.StandardInput.Close()
 if(-not $a1Process.WaitForExit(60000)){$a1Process.Kill();$a1Evidence.error_class='PREFLIGHT_TIMEOUT';throw 'Stop'}
 $a1Evidence.cli_exit=$a1Process.ExitCode
 $a1Raw=$a1Out.GetAwaiter().GetResult();$a1Stderr=$a1Err.GetAwaiter().GetResult()
 if($a1Process.ExitCode -ne 0){
  $a1Evidence.error_class=if($a1Stderr -match 'password authentication failed'){'AUTHENTICATION_FAILED'}elseif($a1Stderr -match 'permission denied'){'PERMISSION_DENIED'}elseif($a1Stderr -match 'timed out|timeout'){'CONNECTION_OR_QUERY_TIMEOUT'}else{'PSQL_PREFLIGHT_FAILED'}
  throw 'Stop'
 }
 $a1Evidence.observations=$a1Raw.Trim() | ConvertFrom-Json
 $a1Evidence.status='PREFLIGHT_CAPTURED_APPLICATION_BLOCKED'
 # Capture facts, not blanket PASS. No application until independent backup,
 # exact source/RPC compatibility and runner/history atomicity have been reviewed.
 SaveEvidence
 Write-Host 'Read-only preflight captured. No migration or synthetic tests ran. Return to Codex.'
} catch {
 $a1Evidence.status='BLOCKED';if(-not $a1Evidence.error_class){$a1Evidence.error_class='SECURE_INPUT_OR_LOCAL_PREFLIGHT_FAILED'}
 SaveEvidence;Write-Host 'Stopped. Sanitized result saved; no retry, migration or test execution.'
} finally {
 if($a1Bstr -ne [IntPtr]::Zero){[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($a1Bstr)}
 if($a1Process){$a1Process.StartInfo.EnvironmentVariables.Remove('PGPASSWORD');$a1Process.Dispose()}
 $a1Secret=$null;$a1Password=$null;$a1Uri=$null;$a1UserInfo=$null;$a1Raw=$null;$a1Stderr=$null
 if($a1Secure){$a1Secure.Dispose()};if($a1SecurePassword){$a1SecurePassword.Dispose()}
}
