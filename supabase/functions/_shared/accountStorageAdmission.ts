/** Trusted server execution contract; individual write completion is not a deletion drain barrier. */
export interface StorageOperation {
  operation: string; lease: string; owner: string; bucket: string; path: string;
}
export type ProviderOutcome =
  | { state: 'COMMITTED' | 'REJECTED_BEFORE_WRITE'; proof: string }
  | { state: 'UNKNOWN' };
export interface StorageAdmissionPort {
  // Atomic gate + owner/path check and durable record. Expiry never drains a record.
  admit(owner: string, bucket: string, path: string): Promise<StorageOperation>;
  // Atomically consumes ADMITTED exactly once, checks gate/token/expiry, and persists
  // UNKNOWN BEFORE physical dispatch. A crash cannot erase a possible remote write.
  start(operation: StorageOperation): Promise<boolean>;
  write(operation: StorageOperation): Promise<ProviderOutcome>;
  // Validate the server's actual Storage success response; client ack/error is insufficient.
  verifyTerminal(operation: StorageOperation, outcome: ProviderOutcome): Promise<boolean>;
  terminal(operation: StorageOperation, state: 'SUCCEEDED' | 'REJECTED', proof: string): Promise<void>;
}
export async function runAdmittedStorageUpload(port: StorageAdmissionPort, owner: string, bucket: string, path: string) {
  const operation = await port.admit(owner, bucket, path);
  if (operation.owner !== owner || operation.bucket !== bucket || operation.path !== path) {
    throw new Error('STORAGE_ADMISSION_IDENTITY_MISMATCH');
  }
  if (await port.start(operation) !== true) throw new Error('STORAGE_DISPATCH_DENIED');
  // start persisted UNKNOWN. Network errors, abort, expiry and crashes leave it there.
  const outcome = await port.write(operation);
  if (outcome.state === 'UNKNOWN' || !outcome.proof.trim() || !await port.verifyTerminal(operation, outcome)) {
    throw new Error('STORAGE_TERMINAL_UNVERIFIED');
  }
  await port.terminal(operation, outcome.state === 'COMMITTED' ? 'SUCCEEDED' : 'REJECTED', outcome.proof);
  if (outcome.state === 'REJECTED_BEFORE_WRITE') throw new Error('STORAGE_WRITE_REJECTED');
  return operation;
}
