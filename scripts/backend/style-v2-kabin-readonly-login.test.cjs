'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const source=()=>fs.readFileSync(path.join(__dirname,'style-v2-kabin-readonly-login.ps1'),'utf8');
test('masked Kabin entry uses existing acceptance package without staging or login mutation',()=>{
 const s=source();assert.match(s,/https:\/\/hnujkabyyrlsxohjhxlg\.supabase\.co/);
 assert.match(s,/style-v2-kabin-acceptance\.cjs/);assert.doesNotMatch(s,/sdjxseqfkturkfohkfni|signIn|ALLOW_WRITES\s*=\s*'yes'/);
 assert.equal((s.match(/Read-Host[^\n]+-AsSecureString/g)||[]).length,1);
});
test('all inherited Kabin write and database settings are removed before secure input',()=>{
 const s=source();assert.match(s,/Get-ChildItem Env:KABIN_V2_\*/);
 assert(s.indexOf('Remove-Item')<s.indexOf('Read-Host'));
 assert.match(s,/finally\s*\{/);assert.match(s,/EnvironmentVariableTarget\]::Process/);
});
test('entry refuses nonexclusive accounts and never writes credentials or raw errors',()=>{
 const s=source();assert.match(s,/\$taskConfirmation -cne 'YES'/);
 assert.match(s,/LOCAL_READONLY_INPUT_OR_RUN_FAILED/);
 assert.doesNotMatch(s,/WriteAllText|Set-Content|Out-File|\$_\.Exception|Write-Error|Write-Output \$taskSecret/);
});
