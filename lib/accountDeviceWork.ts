/** Owner-scoped JS resources and publication generations. Persistent admission lives in accountWriteFence. */
interface Resource { stop(): void; empty(): boolean }
interface OwnerState { generation: number; deleted: boolean; stopping: boolean; resources: Set<Resource>; pending: Set<Promise<unknown>> }
const owners = new Map<string, OwnerState>();
let activeOwner: string | null = null;
let sessionKnown = false;
const state = (owner: string) => {
  let value = owners.get(owner);
  if (!value) { value = { generation: 0, deleted: false, stopping: false, resources: new Set(), pending: new Set() }; owners.set(owner, value); }
  return value;
};
export function captureOwnerPublication(owner: string | null): () => boolean {
  if (!owner) { const captured = activeOwner; return () => activeOwner === captured; }
  const entry = state(owner), generation = entry.generation;
  return () => !entry.deleted && entry.generation === generation && (!sessionKnown || activeOwner === owner);
}
function stop(owner: string) {
  const entry = state(owner); entry.generation++;
  if (entry.stopping) return;
  entry.stopping = true;
  for (const resource of entry.resources) { try { resource.stop(); } catch { /* failed disposal remains visible to verification */ } }
  entry.stopping = false;
}
export function setDeviceSessionOwner(owner: string | null): void {
  if (sessionKnown && owner === activeOwner) return;
  const previous = activeOwner; sessionKnown = true; activeOwner = owner;
  if (previous) stop(previous);
}
export function deviceSessionOwner(): string | null { return activeOwner; }
export function fenceOwnerMemory(owner: string): void { state(owner).deleted = true; stop(owner); }
export function registerOwnerResource(owner: string, resource: Resource): () => void {
  const entry = state(owner); entry.resources.add(resource);
  if (entry.deleted || (sessionKnown && activeOwner !== owner)) resource.stop();
  return () => { if (resource.empty()) entry.resources.delete(resource); };
}
export function trackOwnerWork<T>(owner: string, work: Promise<T>): Promise<T> {
  const pending = state(owner).pending; pending.add(work);
  void work.then(() => pending.delete(work), () => pending.delete(work));
  return work;
}
/** Abort is not drain. Await actual settlements, including work added by an already registered workflow. */
export async function drainOwnerWork(owner: string): Promise<boolean> {
  const entry = state(owner);
  while (entry.pending.size) await Promise.allSettled([...entry.pending]);
  return [...entry.resources].every(resource => resource.empty());
}
export function ownerWorkEvidence(owner: string) {
  const entry = state(owner);
  return { fenced: entry.deleted, pending: entry.pending.size, nonempty: [...entry.resources].filter(resource => !resource.empty()).length };
}
/** Test restart simulation, never clears disk tombstones. */
export function resetDeviceWorkForTests() { owners.clear(); activeOwner = null; sessionKnown = false; }
