// Offline source inventory only: dynamic aliases and deployed clients require integration evidence.
const fs = require('node:fs'), path = require('node:path'), ts = require('typescript');
const roots = ['app','components','hooks','lib','services','store','src','scripts','supabase/functions'];
const methods = new Map([
  ['upload','STORAGE_UPLOAD_CANDIDATE'], ['uploadToSignedUrl','SIGNED_UPLOAD'],
  ['createSignedUploadUrl','SIGNED_UPLOAD_CAPABILITY'], ['createUploadTask','NATIVE_PROVIDER_UPLOAD'],
  ['createDownloadResumable','NATIVE_DOWNLOAD'],
  ['invoke','EDGE_TRANSPORT_REVIEW'],
]);
const findings = []; let files = 0;
function walk(directory) {
  if (!fs.existsSync(directory)) return;
  for (const entry of fs.readdirSync(directory,{withFileTypes:true})) {
    if (['node_modules','.git'].includes(entry.name)) continue;
    const file = path.join(directory,entry.name);
    if (entry.isDirectory()) { walk(file); continue; }
    if (!/\.tsx?$/.test(file)) continue;
    files++;
    const source = ts.createSourceFile(file,fs.readFileSync(file,'utf8'),ts.ScriptTarget.Latest,true);
    const add = (node,kind) => findings.push({file:file.replaceAll('\\','/'),line:source.getLineAndCharacterOfPosition(node.getStart(source)).line+1,kind});
    function visit(node) {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'fetch') add(node,'HTTP_TRANSPORT_REVIEW');
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
        const method = node.expression.name.text;
        if (methods.has(method)) add(node,methods.get(method));
        if (['move','copy','update','remove'].includes(method) && /storage|bucket/i.test(node.expression.expression.getText(source))) add(node,'STORAGE_MUTATION_CANDIDATE');
      }
      if (ts.isStringLiteralLike(node) && /\/storage\/v1\/(?:object|upload)|tus\/resumable/.test(node.text)) add(node,'DIRECT_OR_RESUMABLE_STORAGE_URL');
      ts.forEachChild(node,visit);
    }
    visit(source);
  }
}
roots.forEach(walk);
const report = {status:'PASS',scope:'Offline AST inventory completed, NOT deployed writer coverage',files,findings,
  limitations:['Dynamic aliases and URLs are not complete coverage','Legacy released clients, service credentials, presigned/TUS capabilities and physical drain require staging/provider evidence']};
fs.writeFileSync('reports/backend/a1-writer-inventory-20261011.json',JSON.stringify(report,null,2)+'\n');
process.stdout.write(`Offline inventory: ${files} files, ${findings.length} candidates; provider coverage unverified.\n`);
