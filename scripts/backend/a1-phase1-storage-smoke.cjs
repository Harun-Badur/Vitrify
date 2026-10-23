// S1/S5 live smoke, OPERATOR RUN ONLY. Never loads .env or logs provider errors/secrets.
// Requires two disposable synthetic staging users and valid JPEG/PNG fixture files.
// Writes via the existing Edge; leaves fixtures for operator cleanup via Storage API.
// No service-role key needed on the operator's client. Edge uses its own service-role.
'use strict';
const { readFileSync } = require('node:fs');
const { randomUUID } = require('node:crypto');

function requireStaging(url) {
  if (url !== 'https://sdjxseqfkturkfohkfni.supabase.co') throw new Error('STAGING_TARGET_REQUIRED');
}
function requireUserJwt(jwt) {
  try {
    if (JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString('utf8')).role !== 'authenticated') throw new Error();
  } catch { throw new Error('AUTHENTICATED_USER_JWT_REQUIRED'); }
  // Signature and expiry are verified by auth.getUser before any Storage operation.
}
function requireWriteDenial(result) {
  const status = Number(result?.error?.statusCode ?? result?.error?.status);
  if (status !== 403 && !(status === 400 && /row.level security/i.test(result?.error?.message ?? ''))) {
    throw new Error('WRITE_NOT_PROVEN_DENIED');
  }
}
function requireRemoveDenial(result, fixtureStillReadable) {
  if (result.error) requireWriteDenial(result);
  else if (!Array.isArray(result.data) || result.data.length) throw new Error('REMOVE_NOT_PROVEN_DENIED');
  if (!fixtureStillReadable) throw new Error('REMOVE_NOT_PROVEN_DENIED');
}
function required(name) {
  const value = process.env[name];
  if (!value) throw new Error('CONFIG_REQUIRED');
  return value;
}
async function readable(client, bucket, path) {
  const result = await client.storage.from(bucket).download(path);
  return !result.error && result.data?.size > 0;
}
async function main() {
  let step = 'CONFIG';
  const pass = label => process.stdout.write(`PASS ${label}\n`);
  try {
    const url = required('A1_STAGING_URL'); requireStaging(url);
    if (required('A1_SYNTHETIC_FIXTURES_ONLY') !== 'yes') throw new Error('SYNTHETIC_USERS_REQUIRED');
    const anon = required('A1_STAGING_ANON_KEY');
    const jwtA = required('A1_USER_A_JWT'), jwtB = required('A1_USER_B_JWT');
    requireUserJwt(jwtA); requireUserJwt(jwtB);
    const jpeg = readFileSync(required('A1_JPEG_FIXTURE'));
    const png = readFileSync(required('A1_PNG_FIXTURE'));
    // Keep fixtures below existing 5 MiB/12 MiB bucket limits; no limit alignment here.
    if (!jpeg.length || jpeg.length > 5*1024*1024 || !png.length || png.length > 12*1024*1024) throw new Error('FIXTURE_SIZE');
    const { createClient } = require('@supabase/supabase-js');
    const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
    const make = jwt => createClient(url, anon, { ...options, global: {
      headers: { Authorization: `Bearer ${jwt}` },
      fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(70_000) }),
    } });
    const a=make(jwtA), b=make(jwtB);
    step='JWT_PREFLIGHT';
    const authA=await a.auth.getUser(jwtA), authB=await b.auth.getUser(jwtB);
    if (authA.error || authB.error || !authA.data.user || !authB.data.user || authA.data.user.id===authB.data.user.id) throw new Error('VALID_DISTINCT_USERS_REQUIRED');
    const ownerA=authA.data.user.id, ownerB=authB.data.user.id;
    pass(step);
    const run=randomUUID();
    for (const [bucket, body, type, suffix] of [
      ['model-photos',jpeg,'image/jpeg','model.jpg'],
      ['wardrobe-cutouts',png,'image/png',`a1-phase1-${run}/cutout.png`],
    ]) {
      const own=`${ownerA}/${suffix}`, other=`${ownerB}/${suffix}`;
      step=`${bucket}:POSITIVE_EDGE`;
      for (const [jwt, owner, path] of [[jwtA,ownerA,own],[jwtB,ownerB,other]]) {
        const response=await fetch(`${url}/functions/v1/account-storage-upload`, { method:'POST',
          headers:{ apikey:anon, Authorization:`Bearer ${jwt}`, 'Content-Type':type,
            'x-upload-bucket':bucket, 'x-upload-path':path, 'x-upload-request':randomUUID() },
          body, signal:AbortSignal.timeout(70_000) });
        const result=await response.json();
        if (!response.ok || result.protocol!=='vitrify.storage-upload.v1' || result.state!=='SUCCEEDED' ||
          result.owner!==owner || result.bucket!==bucket || result.path!==path) throw new Error('EDGE_NOT_PROVEN');
      }
      pass(step);
      step=`${bucket}:SELECT_OWN_AND_OTHER`;
      const before=await a.storage.from(bucket).download(own);
      if (before.error || !before.data || !(await readable(b,bucket,other))) throw new Error('FIXTURE_UNREADABLE');
      const foreign=await a.storage.from(bucket).download(other);
      if (!foreign.error || await readable(a,bucket,other)) throw new Error('FOREIGN_READ_ALLOWED');
      const ownSigned=await a.storage.from(bucket).createSignedUrl(own,60);
      const otherSigned=await a.storage.from(bucket).createSignedUrl(other,60);
      if (ownSigned.error || !ownSigned.data?.signedUrl || !otherSigned.error || otherSigned.data?.signedUrl) throw new Error('SELECT_SIGNING_NOT_PROVEN');
      const signedRead=await fetch(ownSigned.data.signedUrl,{signal:AbortSignal.timeout(10_000)});
      if (!signedRead.ok) throw new Error('OWN_SIGNED_READ_FAILED');
      pass(step);
      const direct=`${ownerA}/a1-direct-${run}.${bucket==='model-photos'?'jpg':'png'}`;
      step=`${bucket}:T5_T7_UPLOAD`;
      requireWriteDenial(await a.storage.from(bucket).upload(direct,body,{contentType:type,upsert:false})); pass(step);
      step=`${bucket}:T5_T7_UPDATE`;
      requireWriteDenial(await a.storage.from(bucket).update(own,body,{contentType:type}));
      requireWriteDenial(await a.storage.from(bucket).upload(own,body,{contentType:type,upsert:true})); pass(step);
      step=`${bucket}:T6_SIGNED_UPLOAD`;
      requireWriteDenial(await a.storage.from(bucket).createSignedUploadUrl(direct)); pass(step);
      step=`${bucket}:T6_TUS`;
      const metadata=Object.entries({bucketName:bucket,objectName:direct,contentType:type})
        .map(([key,value])=>`${key} ${Buffer.from(value).toString('base64')}`).join(',');
      const tus=await fetch(`${url}/storage/v1/upload/resumable`,{method:'POST',headers:{
        apikey:anon,Authorization:`Bearer ${jwtA}`,'Tus-Resumable':'1.0.0',
        'Upload-Length':String(body.length),'Upload-Metadata':metadata,
      },signal:AbortSignal.timeout(10_000)});
      let tusBody={}; try { tusBody=await tus.json(); } catch { /* Never log response body. */ }
      requireWriteDenial({error:{statusCode:tus.status,message:tusBody.message ?? tusBody.error}}); pass(step);
      step=`${bucket}:T5_T7_DELETE_FOREIGN`;
      const foreignRemove=await a.storage.from(bucket).remove([other]);
      requireRemoveDenial(foreignRemove,await readable(b,bucket,other)); pass(step);
      if (bucket==='wardrobe-cutouts') {
        step=`${bucket}:T5_T7_DELETE_OWN`;
        const remove=await a.storage.from(bucket).remove([own]);
        requireRemoveDenial(remove,await readable(a,bucket,own)); pass(step);
      }
      step=`${bucket}:FIXTURE_UNCHANGED`;
      const after=await a.storage.from(bucket).download(own);
      if (after.error || !after.data || !Buffer.from(await before.data.arrayBuffer()).equals(Buffer.from(await after.data.arrayBuffer()))) throw new Error('FIXTURE_CHANGED');
      pass(step);
      if (bucket==='model-photos') {
        step=`${bucket}:EXPLICIT_OWN_DELETE_EXCEPTION`;
        const remove=await a.storage.from(bucket).remove([own]);
        if (remove.error || !Array.isArray(remove.data) || remove.data.length!==1 || await readable(a,bucket,own)) throw new Error('EXCEPTION_NOT_PROVEN');
        pass(step);
      }
    }
    pass('PHASE1_SMOKE_COMPLETE_WITH_MODEL_DELETE_EXCEPTION');
    process.stdout.write('Fixtures remain for operator Storage API cleanup (user B model; both cutouts).\n');
  } catch {
    // Fixed step labels only. No exception text, headers, JWT, URL, user ID or signed URL.
    process.stderr.write(`FAIL ${step} (no provider details logged; fixtures may remain)\n`);
    process.exitCode=1;
  }
}
module.exports={requireStaging,requireUserJwt,requireWriteDenial,requireRemoveDenial};
if (require.main===module) void main();
