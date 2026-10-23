# Kabin only: existing authenticated JWTs and SELECT preflight. No login/account creation.
# Run interactively; never paste credentials into a command line or chat.
$ErrorActionPreference='Stop'
$taskSavedEnvironment=@{}
$taskExit=1
try {
  foreach($taskEntry in @(Get-ChildItem Env:KABIN_V2_*)) {
    $taskSavedEnvironment[$taskEntry.Name]=$taskEntry.Value
    Remove-Item -LiteralPath ('Env:'+$taskEntry.Name)
  }
  $taskConfirmation=Read-Host 'Both Kabin accounts are disposable, exclusive to this test, and unused by other clients? Type YES'
  if($taskConfirmation -cne 'YES'){throw 'DISPOSABLE_CONFIRMATION_REQUIRED'}
  $env:KABIN_V2_URL='https://hnujkabyyrlsxohjhxlg.supabase.co'
  $env:KABIN_V2_DISPOSABLE='yes'
  foreach($taskName in @('KABIN_V2_PUBLIC_KEY','KABIN_V2_A_JWT','KABIN_V2_B_JWT')) {
    $taskSecret=Read-Host $taskName -AsSecureString
    $taskPointer=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($taskSecret)
    try {
      [Environment]::SetEnvironmentVariable($taskName,[Runtime.InteropServices.Marshal]::PtrToStringBSTR($taskPointer),[EnvironmentVariableTarget]::Process)
    } finally {
      [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($taskPointer)
      $taskSecret.Dispose()
    }
  }
  $taskRunner=Join-Path $PSScriptRoot 'style-v2-kabin-acceptance.cjs'
  & node $taskRunner
  $taskExit=$LASTEXITCODE
} catch {
  Write-Host 'STATUS BLOCKED LOCAL_READONLY_INPUT_OR_RUN_FAILED'
} finally {
  foreach($taskEntry in @(Get-ChildItem Env:KABIN_V2_*)) {
    Remove-Item -LiteralPath ('Env:'+$taskEntry.Name)
  }
  foreach($taskName in $taskSavedEnvironment.Keys) {
    [Environment]::SetEnvironmentVariable($taskName,$taskSavedEnvironment[$taskName],[EnvironmentVariableTarget]::Process)
  }
  $taskSavedEnvironment.Clear()
}
exit $taskExit
