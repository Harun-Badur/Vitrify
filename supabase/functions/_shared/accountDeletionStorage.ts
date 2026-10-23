import type { DeletionAdapter } from './accountDeletionFoundation.ts';

export interface DeletionStoragePort {
  assertLease(owner: string): Promise<void>;
  // Must certify actual provider admission closure AND completed physical writes.
  // Metadata emptiness, an expired ticket or client abort is not such a barrier.
  barrier(): Promise<boolean>;
  objects(bucket: string, owner: string): Promise<string[]>;
  remove(bucket: string, paths: string[]): Promise<void>;
}
export const ACCOUNT_STORAGE_BUCKETS = ['model-photos', 'wardrobe-cutouts'] as const;
const buckets = ACCOUNT_STORAGE_BUCKETS;
function ownedPaths(owner: string, paths: string[]): string[] {
  if (!/^[a-zA-Z0-9-]+$/.test(owner) || !Array.isArray(paths) || paths.some(path =>
    typeof path !== 'string' || !path.startsWith(owner + '/') ||
    path.split('/').some(part => !part || part === '.' || part === '..' || /[\\\x00-\x1f\x7f]/.test(part)))) {
    throw new Error('Storage inventory ownership unverified');
  }
  return [...new Set(paths)];
}

/** Each page is lease guarded; malformed or non-progressing listings fail closed. */
export async function listOwnedStorageObjects(owner: string,
  list: (prefix: string, offset: number) => Promise<{ name: string; id: string | null }[]>,
  guard: () => Promise<void>): Promise<string[]> {
  if (!/^[a-zA-Z0-9-]+$/.test(owner)) throw new Error('Unsafe Storage owner');
  const paths: string[] = [], seen = new Set<string>();
  let pages = 0;
  async function walk(prefix: string, depth: number): Promise<void> {
    if (depth > 32) throw new Error('Storage inventory depth exceeded');
    for (let offset = 0; ; offset += 100) {
      await guard();
      if (++pages > 10_000) throw new Error('Storage inventory page budget exceeded');
      const items = await list(prefix, offset);
      if (!Array.isArray(items) || items.length > 100) throw new Error('Storage inventory malformed');
      for (const item of items) {
        if (!item || typeof item.name !== 'string' || !item.name || /[/\\\x00-\x1f\x7f]|^\.{1,2}$/.test(item.name) ||
          !(item.id === null || typeof item.id === 'string' && item.id.length > 0)) throw new Error('Unsafe Storage entry');
        const path = prefix + '/' + item.name;
        if (seen.has(path)) throw new Error('Storage inventory did not progress');
        seen.add(path);
        if (item.id === null) await walk(path, depth + 1); else paths.push(path);
      }
      if (items.length < 100) break;
    }
  }
  await walk(owner, 0);
  await guard();
  return ownedPaths(owner, paths);
}
export function deletionStorageAdapter(port: DeletionStoragePort): DeletionAdapter {
  const guard = async (owner: string) => {
    await port.assertLease(owner);
    if (await port.barrier() !== true) throw new Error('Physical Storage writer drain unverified');
  };
  return { idempotent: true,
    cleanup: async ({ subjectId }) => {
      await guard(subjectId);
      for (const bucket of buckets) {
        await guard(subjectId);
        const paths = ownedPaths(subjectId, await port.objects(bucket, subjectId));
        for (let i = 0; i < paths.length; i += 100) { await guard(subjectId); await port.remove(bucket, paths.slice(i, i + 100)); }
      }
      await guard(subjectId);
    },
    verify: async ({ subjectId }) => {
      await guard(subjectId);
      let complete = true;
      for (const bucket of buckets) {
        await guard(subjectId);
        if (ownedPaths(subjectId, await port.objects(bucket, subjectId)).length) complete = false;
      }
      await guard(subjectId); // barrier lost during listing cannot produce absence evidence
      return { complete, evidence: complete ? ['physical writer barrier and both owned Storage prefixes empty'] : [] };
    },
  };
}

/** Recovered receipts are historical; absence must be measured again before Auth. */
export async function assertStorageEmptyBeforeAuth(adapter: DeletionAdapter, receipt: Parameters<DeletionAdapter['verify']>[0]): Promise<void> {
  const proof = await adapter.verify(receipt);
  if (proof.complete !== true || !Array.isArray(proof.evidence) || !proof.evidence.length ||
    proof.evidence.some(value => typeof value !== 'string' || !value.trim())) {
    throw new Error('Storage objects remain or absence unverified before Auth cleanup');
  }
}
