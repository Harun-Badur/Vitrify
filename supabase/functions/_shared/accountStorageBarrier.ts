export const STORAGE_BARRIER_PROTOCOL = 'vitrify.storage-barrier.v2';
export const STORAGE_WRITER_REVISION = 'vitrify.storage-writers.v2';
const buckets = ['model-photos', 'wardrobe-cutouts'];
export interface StorageBarrierEvidence {
  protocol: string; owner: string; request: string; fenced: boolean;
  unresolved: number; legacyUnresolved: number;
  // This evidence is read ONLY from a trusted service RPC. Client headers/body never attest it.
  provider: null | { binding: string; evidenceId: string; writerRevision: string; buckets: string[];
    admissionClosed: boolean; legacyAccessRevoked: boolean; issuedCapabilitiesRevoked: boolean; physicalDrainVerified: boolean };
}
/** Additional check, never a replacement for the installed fail-closed DB barrier. */
export function assessStorageBarrier(value: unknown, owner: string, request: string) {
  const blockers: string[] = [], snapshot = value as StorageBarrierEvidence | null;
  if (!snapshot || snapshot.protocol !== STORAGE_BARRIER_PROTOCOL || snapshot.owner !== owner || snapshot.request !== request ||
    typeof snapshot.fenced !== 'boolean' || !Number.isSafeInteger(snapshot.unresolved) || snapshot.unresolved < 0 ||
    !Number.isSafeInteger(snapshot.legacyUnresolved) || snapshot.legacyUnresolved < 0) {
    return { verified: false, blockers: ['STORAGE_BARRIER_SNAPSHOT_INVALID'] };
  }
  if (!snapshot.fenced) blockers.push('STORAGE_ADMISSION_OPEN');
  if (snapshot.unresolved || snapshot.legacyUnresolved) blockers.push('STORAGE_OPERATIONS_UNRESOLVED');
  const proof = snapshot.provider;
  if (!proof || typeof proof.binding !== 'string' || !proof.binding.trim() || typeof proof.evidenceId !== 'string' || !proof.evidenceId.trim() || proof.writerRevision !== STORAGE_WRITER_REVISION ||
    !Array.isArray(proof.buckets) || proof.buckets.length !== 2 || !buckets.every(bucket => proof.buckets.includes(bucket))) {
    blockers.push('PROVIDER_WIDE_COVERAGE_UNPROVEN');
  } else {
    if (proof.admissionClosed !== true) blockers.push('PROVIDER_ADMISSION_OPEN');
    if (proof.legacyAccessRevoked !== true) blockers.push('LEGACY_WRITERS_UNFENCED');
    if (proof.issuedCapabilitiesRevoked !== true) blockers.push('ISSUED_UPLOAD_CAPABILITIES_UNREVOKED');
    if (proof.physicalDrainVerified !== true) blockers.push('PHYSICAL_STORAGE_DRAIN_UNPROVEN');
  }
  return { verified: blockers.length === 0, blockers };
}
