[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$VerbosePreference = 'SilentlyContinue'
$DebugPreference = 'SilentlyContinue'

$stagingRef = 'sdjxseqfkturkfohkfni'
$productionRef = 'hnujkabyyrlsxohjhxlg'
$poolerHost = 'aws-1-eu-central-1.pooler.supabase.com'
$databaseUser = 'postgres.sdjxseqfkturkfohkfni'
$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$cliPath = Join-Path $repoRoot 'node_modules/@supabase/cli-windows-x64/bin/supabase.exe'

# Use the installed native CLI directly: no wrapper, link, binary override or install.
if (-not (Test-Path -LiteralPath $cliPath -PathType Leaf)) {
    Write-Host 'STOP: Repository Supabase CLI executable not found. No connection attempted.'
    exit 1
}

$securePassword = $null
$passwordBuffer = [IntPtr]::Zero
$plainPassword = $null
$encodedPassword = $null
$connectionUri = $null
$process = $null
$startInfo = $null
$capturedOutput = $null
$capturedError = $null
$exitStatus = 1

try {
    $securePassword = Read-Host 'Staging database password (hidden)' -AsSecureString
    if ($securePassword.Length -eq 0) { throw 'Empty password' }

    $passwordBuffer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
    $plainPassword = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($passwordBuffer)
    $encodedPassword = [Uri]::EscapeDataString($plainPassword)
    $connectionUri = 'postgresql://' + $databaseUser + ':' + $encodedPassword + '@' + $poolerHost + ':5432/postgres?sslmode=require'

    $target = [Uri]$connectionUri
    $uriUser = [Uri]::UnescapeDataString(($target.UserInfo -split ':', 2)[0])
    if ($target.Scheme -ne 'postgresql' -or $target.Host -ne $poolerHost -or
        $target.Port -ne 5432 -or $target.AbsolutePath -ne '/postgres' -or
        $uriUser -ne $databaseUser -or $uriUser -ne ('postgres.' + $stagingRef) -or
        $target.Query -ne '?sslmode=require' -or $target.Fragment -ne '' -or
        $connectionUri.Contains($productionRef)) {
        throw 'Target validation failed'
    }
    Write-Host ('Target verified: staging ' + $stagingRef + ' / ' + $poolerHost + ':5432 / postgres')

    # One fixed metadata SELECT; no user-supplied SQL or write command.
    $sql = "SELECT current_database() AS database_name, current_user AS database_role, (SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE') AS public_table_count, (SELECT count(*) FROM auth.users) AS auth_user_count, to_regnamespace('deletion_private')::text AS deletion_private_schema;"

    $startInfo = New-Object Diagnostics.ProcessStartInfo
    $startInfo.FileName = $cliPath
    $startInfo.WorkingDirectory = $repoRoot
    $startInfo.UseShellExecute = $false
    $startInfo.CreateNoWindow = $true
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true
    $startInfo.RedirectStandardInput = $true
    # URI password is percent-encoded; neither argument contains a double quote.
    # Never echo Arguments, exceptions, stderr or the full native output.
    $startInfo.Arguments = 'db query --db-url "' + $connectionUri + '" --output json --log-level none "' + $sql + '"'
    $startInfo.EnvironmentVariables['NO_COLOR'] = '1'
    $startInfo.EnvironmentVariables['OTEL_SDK_DISABLED'] = 'true'

    $process = New-Object Diagnostics.Process
    $process.StartInfo = $startInfo
    if (-not $process.Start()) { throw 'CLI startup failed' }
    $process.StandardInput.Close()
    $outputTask = $process.StandardOutput.ReadToEndAsync()
    $errorTask = $process.StandardError.ReadToEndAsync()
    if (-not $process.WaitForExit(60000)) {
        $process.Kill()
        $process.WaitForExit()
        throw 'Connection check timed out'
    }
    $capturedOutput = $outputTask.GetAwaiter().GetResult()
    $capturedError = $errorTask.GetAwaiter().GetResult()
    if ($process.ExitCode -ne 0) { throw 'Database query failed' }

    # Whitelist metadata only. Do not forward CLI output, which may contain a URI.
    $decoded = ConvertFrom-Json -InputObject $capturedOutput
    if ($null -ne $decoded -and $decoded.PSObject.Properties['rows']) {
        $rows = @($decoded.rows)
    } else {
        $rows = @($decoded)
    }
    if ($rows.Count -ne 1) { throw 'Unexpected query response' }
    $row = $rows[0]
    if ($row.database_name -ne 'postgres' -or $row.database_role -ne 'postgres') {
        throw 'Database identity mismatch'
    }
    $tableCount = [long]$row.public_table_count
    $authCount = [long]$row.auth_user_count
    if ($null -eq $row.public_table_count -or $null -eq $row.auth_user_count -or
        $tableCount -lt 0 -or $authCount -lt 0 -or
        ($null -ne $row.deletion_private_schema -and $row.deletion_private_schema -ne 'deletion_private')) {
        throw 'Invalid metadata response'
    }
    $schemaPresent = $row.deletion_private_schema -eq 'deletion_private'
    Write-Host 'Connection verified: database=postgres; current_user=postgres'
    Write-Host ('Public base tables: ' + $tableCount)
    Write-Host ('Auth users: ' + $authCount)
    Write-Host ('deletion_private present: ' + $schemaPresent)
    Write-Host ('Empty staging prerequisite: ' + ($tableCount -eq 0 -and $authCount -eq 0 -and -not $schemaPresent))
    Write-Host 'Read-only check finished. No schema, migration or deployment was performed.'
    $exitStatus = 0
} catch {
    Write-Host 'STOP: Password, target, connection or metadata validation failed. Diagnostic output withheld to protect credentials. No database writes were performed.'
} finally {
    if ($passwordBuffer -ne [IntPtr]::Zero) {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordBuffer)
    }
    if ($null -ne $securePassword) { $securePassword.Dispose() }
    if ($null -ne $process) { $process.Dispose() }
    if ($null -ne $startInfo) { $startInfo.Arguments = '' }
    $plainPassword = $null
    $encodedPassword = $null
    $connectionUri = $null
    $target = $null
    $outputTask = $null
    $errorTask = $null
    $capturedOutput = $null
    $capturedError = $null
}
exit $exitStatus
