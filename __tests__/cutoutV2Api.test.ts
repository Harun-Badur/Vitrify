import { cutoutV2ApiBackend } from '../services/wardrobeCutoutV2Api';
import type { CutoutV2Job } from '../services/wardrobeCutoutV2';
const job:CutoutV2Job={version:2,identity:{owner:'owner',wardrobeItemId:'item',originalVersion:'a'.repeat(64)},request:'request',state:'DISPATCH_POSSIBLE',revision:1,prepareAttempts:1,preparationStopped:false};
const base={protocol:'vitrify.cutout.v2',owner:'owner',wardrobeItemId:'item',originalVersion:'a'.repeat(64),request:'request',jobId:'job',revision:0};
test('API backend stays disabled by default',async()=>{
  const invoke=jest.fn();const api=cutoutV2ApiBackend({invoke,confirmed:()=>true});
  await expect(api.prepare(job)).rejects.toThrow();expect(invoke).not.toHaveBeenCalled();
});
test('async Edge reply maps to durable pending ACK, not artifact success',async()=>{
  const invoke=jest.fn().mockResolvedValueOnce({...base,state:'RESERVED'}).mockResolvedValueOnce({...base,state:'ARMED'});
  const api=cutoutV2ApiBackend({enabled:true,invoke,confirmed:()=>true});
  expect(await api.dispatch(job,{value:null,cleanup:async()=>{}})).toMatchObject({state:'DISPATCH_POSSIBLE',request:'request'});
  expect(invoke).toHaveBeenCalledTimes(2);
});
test('status resolves persistent request alias without a remembered server job id',async()=>{
  const invoke=jest.fn().mockResolvedValue({...base,state:'SUCCEEDED',resultId:'result',pngSha256:'b'.repeat(64)});
  const api=cutoutV2ApiBackend({enabled:true,invoke,confirmed:()=>true});
  expect(await api.status(job)).toMatchObject({state:'RESPONSE_OBSERVED',response:{request:'request',resultId:'result'}});
  expect(invoke).toHaveBeenCalledWith('status?requestId=request','GET');
});
test('foreign or replaced original response never advances client checkpoint',async()=>{
  const api=cutoutV2ApiBackend({enabled:true,confirmed:()=>true,invoke:async()=>({...base,originalVersion:'c'.repeat(64),state:'SUCCEEDED'})});
  await expect(api.status(job)).rejects.toThrow();
});
