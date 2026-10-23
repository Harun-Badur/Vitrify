import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FS from 'expo-file-system/legacy';
import { assessStorageBarrier, STORAGE_BARRIER_PROTOCOL, STORAGE_WRITER_REVISION } from '../supabase/functions/_shared/accountStorageBarrier';
import { accountStorageStatusHandler } from '../supabase/functions/_shared/accountStorageReconciliation';
import { beginProviderDispatch, providerDispatchRpcPort } from '../supabase/functions/_shared/accountProviderDispatch';
import { reconcileAccountStorageUpload, accountStorageUploadInventory, storageUploadJournalPrefix, uploadAccountStorage } from '../services/accountStorageUpload';
import { beginProviderDeviceIntentUnderGuard, observeProviderDeviceResponseUnderGuard, providerDeviceInventory } from '../services/providerDeviceJournal';
import { withAccountWriteGuard, resetAccountWriteFenceMemoryForTests } from '../lib/accountWriteFence';
import { withOwnedNativeFileUnderGuard, readOwnedFileLedger } from '../services/ownedDeviceFiles';

const A='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', B='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const operation='cccccccc-cccc-4ccc-8ccc-cccccccccccc', lease='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const input={owner:A,bucket:'model-photos' as const,path:`${A}/model.jpg`};
const journal={...input,request:'request-A',state:'UNKNOWN'};
const key=storageUploadJournalPrefix(A)+encodeURIComponent(input.bucket+'/'+input.path);
let mockClient: any;
jest.mock('../lib/supabase',()=>({getRequiredSupabaseClient:()=>mockClient}));
beforeEach(async()=>{await AsyncStorage.clear();resetAccountWriteFenceMemoryForTests();
  mockClient={auth:{getUser:jest.fn(async()=>({data:{user:{id:A}},error:null}))},functions:{invoke:jest.fn()},storage:{from:jest.fn()}};
});
const status=(state='SUCCEEDED')=>({protocol:'vitrify.storage-status.v1',...input,request:journal.request,operation,state});
describe('explicit durable reconciliation',()=>{
  beforeEach(async()=>{await AsyncStorage.setItem(key,JSON.stringify(journal));});
  it.each(['SUCCEEDED','REJECTED_NO_DISPATCH'])('accepts matching durable %s without dispatching bytes',async state=>{
    mockClient.functions.invoke.mockResolvedValue({data:status(state),error:null});
    expect(await reconcileAccountStorageUpload(input)).toBe(state);
    expect((await accountStorageUploadInventory(A)).unresolved).toEqual([]);
    expect(mockClient.functions.invoke).toHaveBeenCalledWith('account-storage-status',{body:{request:'request-A',bucket:input.bucket,path:input.path}});
    expect(mockClient.storage.from).not.toHaveBeenCalled();
    expect(await reconcileAccountStorageUpload(input)).toBe(state);
    expect(mockClient.functions.invoke).toHaveBeenCalledTimes(1);
  });
  it.each(['UNKNOWN','ADMITTED'])('%s never authorizes another upload',async state=>{
    mockClient.functions.invoke.mockResolvedValue({data:status(state),error:null});
    expect(await reconcileAccountStorageUpload(input)).toBe('UNKNOWN');
    await expect(uploadAccountStorage({...input,body:new ArrayBuffer(1),contentType:'image/jpeg'})).rejects.toMatchObject({code:'STORAGE_UPLOAD_UNRESOLVED'});
    expect((await accountStorageUploadInventory(A)).unresolved).toEqual([key]);
    expect(mockClient.functions.invoke).toHaveBeenCalledTimes(1);
  });
  it.each(['owner','request','path','operation'])('rejects mismatched %s and preserves UNKNOWN',async field=>{
    mockClient.functions.invoke.mockResolvedValue({data:{...status(),[field]:field==='owner'?B:field==='operation'?'':'foreign'},error:null});
    await expect(reconcileAccountStorageUpload(input)).rejects.toMatchObject({code:'STORAGE_RECONCILIATION_UNVERIFIED'});
    expect((await accountStorageUploadInventory(A)).unresolved).toHaveLength(1);
  });
  it.each([null,{state:'UNKNOWN'}])('absence/incomplete status is not no-dispatch proof',async data=>{
    mockClient.functions.invoke.mockResolvedValue({data,error:null});
    await expect(reconcileAccountStorageUpload(input)).rejects.toThrow();
    expect((await accountStorageUploadInventory(A)).unresolved).toHaveLength(1);
  });
  it('lost status reply is not retried',async()=>{
    mockClient.functions.invoke.mockResolvedValue({data:null,error:new Error('lost')});
    await expect(reconcileAccountStorageUpload(input)).rejects.toMatchObject({code:'STORAGE_RECONCILIATION_UNAVAILABLE'});
    expect(mockClient.functions.invoke).toHaveBeenCalledTimes(1);
  });
  it('singleflight excludes uploads while lookup is outstanding',async()=>{
    let resolve!: (value:any)=>void, notify!:()=>void;
    const started=new Promise<void>(done=>{notify=done;});
    mockClient.functions.invoke.mockImplementation(()=>new Promise(done=>{resolve=done;notify();}));
    const first=reconcileAccountStorageUpload(input);await started;
    expect(reconcileAccountStorageUpload(input)).toBe(first);
    await expect(uploadAccountStorage({...input,body:new ArrayBuffer(1),contentType:'image/jpeg'})).rejects.toMatchObject({code:'STORAGE_UPLOAD_IN_FLIGHT'});
    resolve({data:status(),error:null});await first;expect(mockClient.functions.invoke).toHaveBeenCalledTimes(1);
  });
  it('changed request is never overwritten by late status',async()=>{
    mockClient.functions.invoke.mockImplementation(async()=>{await AsyncStorage.setItem(key,JSON.stringify({...journal,request:'next-request'}));return {data:status(),error:null};});
    await expect(reconcileAccountStorageUpload(input)).rejects.toMatchObject({code:'STORAGE_JOURNAL_CHANGED'});
    expect(JSON.parse((await AsyncStorage.getItem(key))!).request).toBe('next-request');
  });
});
describe('read-only authenticated status endpoint',()=>{
  const fixture=(data:any)=>{
    const rpc=jest.fn(async()=>({data,error:null}));
    const handler=accountStorageStatusHandler({auth:{getUser:async()=>({data:{user:{id:A}},error:null})}} as any,()=>({rpc}));
    const req=new Request('https://local.invalid',{method:'POST',headers:{Authorization:'Bearer fixture-token'},body:JSON.stringify({...input,request:'request-A'})});
    return {handler,rpc,req};
  };
  it('returns only matching sanitized status, no lease or proof',async()=>{
    const f=fixture({...status(),lease,terminal_proof:{secret:'not-returned'}});const res=await f.handler(f.req);
    expect(res.status).toBe(200);expect(await res.json()).toEqual(status());
    expect(f.rpc).toHaveBeenCalledWith('storage_upload_status',{p_request:'request-A'});
  });
  it('missing row remains UNKNOWN',async()=>{const f=fixture(null);const res=await f.handler(f.req);expect(res.status).toBe(404);expect((await res.json()).state).toBe('UNKNOWN');});
  it('foreign owner is blocked',async()=>{const f=fixture({...status(),owner:B});expect((await f.handler(f.req)).status).toBe(503);});
});
describe('provider-wide evidence requirements',()=>{
  const evidence=()=>({protocol:STORAGE_BARRIER_PROTOCOL,owner:A,request:'delete-A',fenced:true,unresolved:0,legacyUnresolved:0,
    provider:{binding:'fixture-only',evidenceId:'controlled-test',writerRevision:STORAGE_WRITER_REVISION,buckets:['model-photos','wardrobe-cutouts'],admissionClosed:true,legacyAccessRevoked:true,issuedCapabilitiesRevoked:true,physicalDrainVerified:true}});
  it('complete controlled fixture meets the contract, never live provider proof',()=>expect(assessStorageBarrier(evidence(),A,'delete-A').verified).toBe(true));
  it.each(['admissionClosed','legacyAccessRevoked','issuedCapabilitiesRevoked','physicalDrainVerified'])('missing %s blocks cleanup',flag=>{
    const e=evidence();(e.provider as any)[flag]=false;expect(assessStorageBarrier(e,A,'delete-A').verified).toBe(false);
  });
  it.each([null,true,{...evidence(),provider:null},{...evidence(),unresolved:1},{...evidence(),legacyUnresolved:1},{...evidence(),owner:B}])('incomplete/foreign snapshot fails closed',e=>expect(assessStorageBarrier(e,A,'delete-A').verified).toBe(false));
  it('malformed provider binding cannot throw or become proof',()=>{const e=evidence();(e.provider as any).binding=42;expect(assessStorageBarrier(e,A,'delete-A').verified).toBe(false);});
});
describe('provider dispatch and device retention journal',()=>{
  const op={operation,lease,owner:A,provider:'fashn',request:'request-A'};
  it('durably starts before caller is permitted to dispatch',async()=>{
    const order:string[]=[];const port={admit:jest.fn(async()=>{order.push('admit');return op;}),start:jest.fn(async()=>{order.push('unknown');return true;}),observe:jest.fn()};
    await beginProviderDispatch(port,A,'fashn','request-A');order.push('bytes');expect(order).toEqual(['admit','unknown','bytes']);
  });
  it('foreign admission never calls start',async()=>{const port={admit:jest.fn(async()=>({...op,owner:B})),start:jest.fn(),observe:jest.fn()};await expect(beginProviderDispatch(port,A,'fashn','request-A')).rejects.toThrow();expect(port.start).not.toHaveBeenCalled();});
  it('failed start has no automatic retry',async()=>{const rpc=jest.fn(async name=>({data:name==='provider_dispatch_admit'?op:false,error:null}));await expect(beginProviderDispatch(providerDispatchRpcPort({rpc}),A,'fashn','request-A')).rejects.toThrow();expect(rpc).toHaveBeenCalledTimes(2);});
  it('response observation still blocks retention closure and is owner-scoped',async()=>{
    const intent=await withAccountWriteGuard(A,()=>beginProviderDeviceIntentUnderGuard(A,'fashn'));
    expect((await providerDeviceInventory(A)).unknown).toBe(1);
    await withAccountWriteGuard(A,()=>observeProviderDeviceResponseUnderGuard(intent));
    resetAccountWriteFenceMemoryForTests();
    expect(await providerDeviceInventory(A)).toMatchObject({unknown:0,retentionUnverified:1});
    expect(await providerDeviceInventory(B)).toMatchObject({unknown:0,retentionUnverified:0});
    expect(await AsyncStorage.getItem((await providerDeviceInventory(A)).keys[0])).not.toMatch(/uri|token|image|prediction/);
  });
  it('a new UUID cannot replay unresolved provider work after restart',async()=>{
    await withAccountWriteGuard(A,()=>beginProviderDeviceIntentUnderGuard(A,'fashn'));
    resetAccountWriteFenceMemoryForTests();
    await expect(withAccountWriteGuard(A,()=>beginProviderDeviceIntentUnderGuard(A,'fashn'))).rejects.toThrow('Provider dispatch unresolved');
    expect((await providerDeviceInventory(A)).keys).toHaveLength(1);
  });
  it('failed durable provider checkpoint prevents caller dispatch',async()=>{
    const original=jest.mocked(AsyncStorage.setItem).getMockImplementation()!;
    const write=jest.spyOn(AsyncStorage,'setItem');write.mockRejectedValueOnce(new Error('disk unavailable'));
    const bytes=jest.fn();
    try {
      await expect(withAccountWriteGuard(A,async()=>{await beginProviderDeviceIntentUnderGuard(A,'fashn');bytes();})).rejects.toThrow('disk unavailable');
      expect(bytes).not.toHaveBeenCalled();
    } finally {write.mockRestore();jest.mocked(AsyncStorage.setItem).mockImplementation(original);}
  });
  it.each(['file:///cache/vitrify-owned/foreign/orphan.png','file:///cache/legacy.png'])('does not claim foreign/legacy native output %s',async uri=>{
    const consume=jest.fn();const before=jest.mocked(FS.deleteAsync).mock.calls.length;
    await expect(withAccountWriteGuard(A,()=>withOwnedNativeFileUnderGuard(A,'file:///gallery/source.jpg',async()=>uri,consume))).rejects.toThrow();
    expect(consume).not.toHaveBeenCalled();expect(jest.mocked(FS.deleteAsync).mock.calls).toHaveLength(before);
    expect((await readOwnedFileLedger(A)).intents).toEqual([expect.objectContaining({opaque:true,paths:[],state:'CREATING'})]);
  });
});
