[CmdletBinding()]
param()
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$a1Repo=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$a1Evidence=Get-Content -LiteralPath (Join-Path $a1Repo 'reports/backend/staging-schema-run-20261010T2212510118997Z.json') -Raw | ConvertFrom-Json
$a1HistoricalRoot='C:\Users\Harun\AppData\Local\Temp\vitrify-a1-migration19-51eb6ef46ec149caaf67a4bc05d8a41d'
$a1HistoricalDirectory=Join-Path $a1HistoricalRoot 'supabase/migrations'
$a1Destination=Join-Path $a1Repo 'reports/backend/isolated-a1-migration20'
if(Test-Path -LiteralPath $a1Destination){throw 'Destination exists; do not overwrite/retry automatically'}
if(@($a1Evidence.files).Count -ne 18 -or $a1Evidence.status -ne 'SCHEMA_VERIFIED'){throw 'Historical evidence unavailable'}
$a1Files=@(Get-ChildItem -LiteralPath $a1HistoricalDirectory -File)
if($a1Files.Count -ne 19){throw 'Exact historical 19-file source queue required'}
$a1Manifest=@()
foreach($a1Entry in $a1Evidence.files){
 $a1File=Join-Path $a1HistoricalDirectory $a1Entry.migration_file
 if((Get-FileHash -LiteralPath $a1File -Algorithm SHA256).Hash -cne $a1Entry.sha256){throw 'Historical byte mismatch; no repair'}
 $a1Manifest+=@{file=$a1Entry.migration_file;sha256=$a1Entry.sha256;provenance='recorded-18-file-live-verification'}
}
$a1Name19='20261011000019_vitrify_a1_19.sql'
$a1Hash19=(Get-FileHash -LiteralPath (Join-Path $a1HistoricalDirectory $a1Name19) -Algorithm SHA256).Hash
if($a1Hash19 -cne '828789CAE7C8E22C6ACBFA7B80B76065CA252DB8DF97F9270BF76D388121350C'){throw 'Historical 19 source changed'}
$a1Manifest+=@{file=$a1Name19;sha256=$a1Hash19;provenance='existing-isolated-19-source; applied-status-reported-by-user; live-binding-NOT-RUN'}
$a1Proposal=Join-Path $a1Repo 'reports/backend/proposals/20261011_a1_reconciliation_and_provider_journal.sql'
$a1Hash20=(Get-FileHash -LiteralPath $a1Proposal -Algorithm SHA256).Hash
$a1Sql=[IO.File]::ReadAllText($a1Proposal)
if([regex]::Matches($a1Sql,'(?m)^begin;\r?$').Count -ne 1 -or [regex]::Matches($a1Sql,'(?m)^commit;\r?$').Count -ne 1){throw 'Unexpected outer transaction wrapper'}
# Standalone proposal owns BEGIN/COMMIT. A migration runner must own the whole
# transaction INCLUDING its history insert; never commit from inside its file.
$a1MigrationSql=[regex]::Replace([regex]::Replace($a1Sql,'(?m)^begin;\r?\n',''),'(?m)^commit;\r?\n?','')
$a1MigrationDirectory=Join-Path $a1Destination 'supabase/migrations'
[void][IO.Directory]::CreateDirectory($a1MigrationDirectory)
[IO.File]::WriteAllText((Join-Path $a1Destination 'supabase/config.toml'), "project_id = 'vitrify-a1-20-isolated'`n[db.seed]`nenabled = false`n",[Text.UTF8Encoding]::new($false))
foreach($a1Entry in $a1Manifest){
 [IO.File]::Copy((Join-Path $a1HistoricalDirectory $a1Entry.file),(Join-Path $a1MigrationDirectory $a1Entry.file),$false)
 if((Get-FileHash -LiteralPath (Join-Path $a1MigrationDirectory $a1Entry.file) -Algorithm SHA256).Hash -cne $a1Entry.sha256){throw 'Isolated copy mismatch'}
}
[IO.File]::WriteAllText((Join-Path $a1MigrationDirectory '20261011000020_vitrify_a1_20.sql'),$a1MigrationSql,[Text.UTF8Encoding]::new($false))
$a1MigrationHash20=(Get-FileHash -LiteralPath (Join-Path $a1MigrationDirectory '20261011000020_vitrify_a1_20.sql') -Algorithm SHA256).Hash
# No secrets, config link, seed or executable CLI migration command in this queue.
@{queue_status='LOCAL_SOURCE_QUEUE_PREPARED';application='BLOCKED';reason='fresh disposable target and live history/source binding not proven';
 historical_files=$a1Manifest;next=@{file='20261011000020_vitrify_a1_20.sql';sha256=$a1MigrationHash20;source_sha256=$a1Hash20;transform='only outer BEGIN/COMMIT removed; runner must own atomic history transaction'};
 runner_history_atomicity='NOT_RUN';
 live_19_content_binding='NOT_RUN';target_identity='NOT_RUN';data_safety='NOT_RUN';migration_calls=0} |
 ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $a1Destination 'source-map.json') -Encoding UTF8
Write-Output 'PASS: 19 historical byte-identical copies plus migration 20 prepared. Application BLOCKED; live 19 binding NOT RUN.'
