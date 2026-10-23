'use strict';
// A fresh synthetic user has no app/device data. Evidence is fixture-only.
function createDeletionReceipt(requestId,subjectId) {
  return {requestId,subjectId,layers:Object.fromEntries(
    ['queue','async_storage','local_files','memory_cache'].map(layer=>[layer,
      {state:'VERIFIED',attempts:1,evidence:['fresh synthetic fixture: no app/device data']}]))};
}
module.exports={createDeletionReceipt};
