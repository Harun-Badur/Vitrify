# Local secure input UI. No credentials, tokens or personal identifiers are saved.
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$taskRoot=Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$taskResult=Join-Path $taskRoot 'reports/backend/style-v2-db-diagnostic-result-20261013.json'
if(Test-Path -LiteralPath $taskResult){throw 'RESULT_ALREADY_EXISTS_DO_NOT_RERUN'}
$taskForm=New-Object System.Windows.Forms.Form
$taskForm.Text='Vitrify staging: yalniz DB baglanti teshisi'
$taskForm.Size=New-Object System.Drawing.Size(680,400)
$taskForm.StartPosition='CenterScreen'
$taskForm.TopMost=$true
$taskForm.FormBorderStyle='FixedDialog'
$taskForm.MaximizeBox=$false
$taskInfo=New-Object System.Windows.Forms.Label
$taskInfo.Text="Session pooler / sdjxseqfkturkfohkfni / database postgres. Writer ACILMAZ.`nBilgiler yalniz bellekte kullanilir. Sonuc dosyasi sadece sabit test kodlarini icerir."
$taskInfo.Location=New-Object System.Drawing.Point(15,15)
$taskInfo.Size=New-Object System.Drawing.Size(640,45)
$taskForm.Controls.Add($taskInfo)
$taskInputs=@{}
$taskLabels=@('Dashboard session pooler host','DB user','DB port (5432)','Staging DB parola')
for($taskIndex=0;$taskIndex -lt 4;$taskIndex++) {
  $taskLabel=New-Object System.Windows.Forms.Label
  $taskLabel.Text=$taskLabels[$taskIndex];$taskLabel.Location=New-Object System.Drawing.Point(15,(75+45*$taskIndex));$taskLabel.Width=195
  $taskBox=New-Object System.Windows.Forms.TextBox
  $taskBox.Location=New-Object System.Drawing.Point(215,(72+45*$taskIndex));$taskBox.Width=370
  $taskBox.UseSystemPasswordChar=$true
  $taskInputs[$taskIndex]=$taskBox;$taskForm.Controls.Add($taskLabel);$taskForm.Controls.Add($taskBox)
}
$taskInputs[0].Text='aws-1-eu-central-1.pooler.supabase.com'
$taskInputs[1].Text='postgres.sdjxseqfkturkfohkfni'
$taskInputs[2].Text='5432'
$taskSubmit=New-Object System.Windows.Forms.Button
$taskSubmit.Text='DNS TCP TLS ve SELECT teshisi';$taskSubmit.Location=New-Object System.Drawing.Point(210,290);$taskSubmit.Width=235
$taskSubmit.DialogResult=[System.Windows.Forms.DialogResult]::OK;$taskForm.AcceptButton=$taskSubmit;$taskForm.Controls.Add($taskSubmit)
try {
  if($taskForm.ShowDialog() -ne [System.Windows.Forms.DialogResult]::OK){throw 'USER_CANCELLED'}
  $taskPayload=@{host=$taskInputs[0].Text.Trim();user=$taskInputs[1].Text.Trim();port=$taskInputs[2].Text.Trim();password=$taskInputs[3].Text} | ConvertTo-Json -Compress
  foreach($taskBox in $taskInputs.Values){$taskBox.Clear()}
  $taskStart=New-Object System.Diagnostics.ProcessStartInfo
  $taskStart.FileName=(Get-Command node).Source
  $taskStart.Arguments='"'+(Join-Path $PSScriptRoot 'style-v2-db-diagnostic.cjs')+'"'
  $taskStart.WorkingDirectory=$taskRoot;$taskStart.UseShellExecute=$false;$taskStart.CreateNoWindow=$true
  $taskStart.RedirectStandardInput=$true;$taskStart.RedirectStandardOutput=$true;$taskStart.RedirectStandardError=$true
  $taskProcess=New-Object System.Diagnostics.Process;$taskProcess.StartInfo=$taskStart
  [void]$taskProcess.Start();$taskProcess.StandardInput.Write($taskPayload);$taskProcess.StandardInput.Close();$taskPayload=$null
  $taskOutput=$taskProcess.StandardOutput.ReadToEnd();$taskProcess.WaitForExit()
  # Child output is a fixed, sanitized result contract; never serialize raw provider responses.
  $taskParsed=$taskOutput | ConvertFrom-Json
  [IO.File]::WriteAllText($taskResult,($taskParsed | ConvertTo-Json -Depth 8),[Text.UTF8Encoding]::new($false))
  [void][System.Windows.Forms.MessageBox]::Show('Test tamamlandi. Sonuc: '+$taskParsed.status+'. Gizli bilgiler kaydedilmedi.','Vitrify')
} catch {
  [IO.File]::WriteAllText($taskResult,'{"status":"BLOCKED","code":"LOCAL_INPUT_OR_RUNNER_FAILED"}',[Text.UTF8Encoding]::new($false))
} finally {
  $taskPayload=$null;foreach($taskBox in $taskInputs.Values){$taskBox.Clear()};$taskForm.Dispose()
  if($taskProcess){$taskProcess.Dispose()}
}
