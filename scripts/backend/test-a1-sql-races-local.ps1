[CmdletBinding()]
param()
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$a1Repo=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$a1Bin='C:\Users\Harun\AppData\Local\Temp\vitrify-pg17\pgsql\bin'
# Exact scratch cluster created by this task; no URI, host or credential parameter.
$a1Root='C:\Users\Harun\AppData\Local\Temp\vitrify-a1-20-local-e8c0d536d25c408d9e1aaeb010d20230'
$a1Data=Join-Path $a1Root 'data'
$a1Log=Join-Path $a1Repo 'reports/backend/a1-sql20-races-local-evidence.txt'
$a1Sessions=[Collections.Generic.List[Diagnostics.Process]]::new()
function OpenSession([string]$Name){
 $info=[Diagnostics.ProcessStartInfo]::new();$info.FileName=Join-Path $a1Bin 'psql.exe';$info.UseShellExecute=$false;$info.CreateNoWindow=$true
 $info.RedirectStandardInput=$true;$info.RedirectStandardOutput=$true;$info.RedirectStandardError=$true
 foreach($arg in @('-X','-q','-At','-v','ON_ERROR_STOP=1','-h','127.0.0.1','-p','54720','-U','postgres','-d','postgres')){[void]$info.ArgumentList.Add($arg)}
 foreach($name in @($info.Environment.Keys | Where-Object { $_ -like 'PG*' })){[void]$info.Environment.Remove($name)}
 $info.Environment['PGAPPNAME']=$Name;$info.Environment['PGCONNECT_TIMEOUT']='5'
 $process=[Diagnostics.Process]::new();$process.StartInfo=$info;[void]$process.Start();$a1Sessions.Add($process);return $process
}
function Until([Diagnostics.Process]$Process,[string]$Marker){
 while($true){$read=$Process.StandardOutput.ReadLineAsync();if(-not $read.Wait(10000)){throw 'Local session timeout; no retry'}
  $line=$read.Result;if($null -eq $line){throw 'Local SQL session failed; no retry'};if($line -ceq $Marker){return}}
}
function Scalar([string]$Sql){
 $p=OpenSession ('a1-local-observer-'+[guid]::NewGuid().ToString('N'))
 $p.StandardInput.WriteLine($Sql);$p.StandardInput.WriteLine('\q');$p.StandardInput.Close()
 $read=$p.StandardOutput.ReadToEndAsync();$err=$p.StandardError.ReadToEndAsync()
 if(-not $p.WaitForExit(10000) -or $p.ExitCode -ne 0){throw 'Local observer failed; no retry'}
 return $read.GetAwaiter().GetResult().Trim()
}
function Race([string]$Label,[string]$Request,[bool]$CancelFirst){
 $suffix=[guid]::NewGuid().ToString('N');$a=OpenSession ('a1-race-A-'+$suffix);$b=OpenSession ('a1-race-B-'+$suffix)
 $start="perform public.storage_upload_start(op.operation,op.lease,op.subject,op.bucket,op.path);"
 $cancel="perform public.storage_upload_cancel_before_dispatch(op.operation,op.subject,op.request);"
 $aCall=$start;$bCall=$cancel;if($CancelFirst){$aCall=$cancel;$bCall=$start}
 $prefix='DO $$ declare op deletion_private.storage_operations; begin select * into strict op from deletion_private.storage_operations where request=' + "'"+$Request+"'; "
 $a.StandardInput.WriteLine('BEGIN; '+$prefix+$aCall+' end $$;');$a.StandardInput.WriteLine('\echo A_READY');Until $a 'A_READY'
 $b.StandardInput.WriteLine('BEGIN; '+$prefix+$bCall+' end $$;');$b.StandardInput.WriteLine('ROLLBACK;');$b.StandardInput.WriteLine('\echo B_ROLLED_BACK')
 $deadline=[DateTime]::UtcNow.AddSeconds(10);$blocked=$false
 do {
  $blocked=(Scalar ("select exists(select 1 from pg_stat_activity b where b.application_name='a1-race-B-"+$suffix+"' and exists(select 1 from pg_stat_activity a where a.application_name='a1-race-A-"+$suffix+"' and a.pid=any(pg_blocking_pids(b.pid))));")) -ceq 't'
  if(-not $blocked){Start-Sleep -Milliseconds 50}
 } until($blocked -or [DateTime]::UtcNow -gt $deadline)
 if(-not $blocked){throw 'Expected owner lock wait not observed'}
 $a.StandardInput.WriteLine('ROLLBACK;');$a.StandardInput.WriteLine('\echo A_ROLLED_BACK');Until $a 'A_ROLLED_BACK';Until $b 'B_ROLLED_BACK'
 foreach($p in @($a,$b)){$p.StandardInput.WriteLine('\q');$p.StandardInput.Close();if(-not $p.WaitForExit(10000) -or $p.ExitCode -ne 0){throw 'Local contender failed'}}
 $unchanged=Scalar ("select state='ADMITTED' and not dispatch_started and not exists(select 1 from deletion_private.storage_resolutions r where r.operation=o.operation) from deletion_private.storage_operations o where request='"+$Request+"';")
 if($unchanged -cne 't'){throw 'Race fixture rollback failed'}
 ('PASS '+$Label+': pg_blocking_pids observed owner serialization; both transactions rolled back; baseline unchanged.') | Add-Content -LiteralPath $a1Log
}
$a1Started=$false
try{
 'LOCAL ONLY: synthetic pre-existing baseline, no Auth users and no Storage dispatch.' | Set-Content -LiteralPath $a1Log
 $launcher=Start-Process -FilePath (Join-Path $a1Bin 'pg_ctl.exe') -WindowStyle Hidden -PassThru -ArgumentList @('-D',('"'+$a1Data+'"'),'-l',('"'+(Join-Path $a1Root 'races-postgres.log')+'"'),'-o','"-h 127.0.0.1 -p 54720"','-w','start') -RedirectStandardOutput (Join-Path $a1Root 'races-start.log') -RedirectStandardError (Join-Path $a1Root 'races-start.err')
 if(-not $launcher.WaitForExit(15000) -or $launcher.ExitCode -ne 0){throw 'Local cluster start failed; no retry'};$a1Started=$true
 $actual=Scalar "select current_setting('data_directory');"
 if([IO.Path]::GetFullPath($actual.Replace('/','\')) -ine [IO.Path]::GetFullPath($a1Data)){throw 'Local fixture identity mismatch'}
 $seed=@'
begin;
insert into deletion_private.owner_gates(subject) values('a2000000-0000-4000-8000-000000000001');
insert into deletion_private.storage_operations(subject,request,bucket,path) values
('a2000000-0000-4000-8000-000000000001','race-cancel-first','model-photos','a2000000-0000-4000-8000-000000000001/cancel.jpg'),
('a2000000-0000-4000-8000-000000000001','race-start-first','model-photos','a2000000-0000-4000-8000-000000000001/start.jpg');
commit;
'@
 [void](Scalar $seed)
 Race 'cancel/start contention' 'race-cancel-first' $true
 Race 'start/cancel contention' 'race-start-first' $false
 'PASS local races. This verifies lock contention and rollback, NOT a provider drain or a committed cross-session winner.' | Add-Content -LiteralPath $a1Log
} finally{
 foreach($p in $a1Sessions){if(-not $p.HasExited){$p.Kill()};$p.Dispose()}
 if($a1Started){& (Join-Path $a1Bin 'pg_ctl.exe') -D $a1Data -m immediate -w stop *> (Join-Path $a1Root 'races-stop.log')}
}
