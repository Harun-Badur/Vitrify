import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, readdir, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import type { DeletionAdapter } from '../../lib/accountDeletionFoundation';
import { withDeletionWriteGuard, type DeletionStore } from './deletionCoordinator';
import type { JobLifecycleStore, LifecycleJob, JobTransaction } from './jobPayloadLifecycle';

/** Concrete durable offline/trusted Node protocol store; production Supabase schema is NOT replaced. */
export class FileJobLifecycleStore implements JobLifecycleStore {
  constructor(private readonly directory: string, private readonly owners: DeletionStore) {}
  private file(id: string) { return path.join(this.directory, createHash('sha256').update(id).digest('hex') + '.json'); }
  private async persist(job: LifecycleJob) {
    await mkdir(this.directory, { recursive: true });
    const file = this.file(job.id), temporary = `${file}.${randomUUID()}.tmp`, handle = await open(temporary, 'wx', 0o600);
    try { await handle.writeFile(JSON.stringify(job)); await handle.sync(); } finally { await handle.close(); }
    await rename(temporary, file);
  }
  async read(id: string): Promise<LifecycleJob> {
    const job = JSON.parse(await readFile(this.file(id), 'utf8')) as LifecycleJob;
    if (job.id !== id || !job.ownerId) throw new Error('Invalid job identity');
    return job;
  }
  async create(job: LifecycleJob): Promise<void> {
    if (!job.id || !job.ownerId || !job.attempt || job.revision !== 0) throw new Error('Invalid initial job');
    await withDeletionWriteGuard(this.owners, job.ownerId, async () => {
      await mkdir(this.directory, { recursive: true });
      const creationPath = this.file(job.id) + '.creation.lock', creation = await open(creationPath, 'wx', 0o600);
      try {
        try { await readFile(this.file(job.id)); } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') { await this.persist(job); return; }
          throw error;
        }
        throw new Error('Duplicate job');
      } finally { await creation.close(); await unlink(creationPath); }
    });
  }
  async transaction<T>(id: string, operation: (transaction: JobTransaction) => T): Promise<T> {
    const initial = await this.read(id);
    return this.owners.exclusive(initial.ownerId, async () => {
      const job = await this.read(id);
      if (job.ownerId !== initial.ownerId) throw new Error('Job owner changed');
      if (await this.owners.read(job.ownerId)) throw new Error('Owner is deletion-fenced');
      const result = operation({ job, ownerFenced: false });
      if (job.id !== id || job.ownerId !== initial.ownerId) throw new Error('Job identity immutable');
      await this.persist(job);
      return result;
    });
  }
  private async owned(ownerId: string): Promise<{ job: LifecycleJob; file: string }[]> {
    let files: string[];
    try { files = await readdir(this.directory); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
    const result: { job: LifecycleJob; file: string }[] = [];
    for (const file of files.filter(name => /^[a-f0-9]{64}\.json(?:\.[a-f0-9-]+\.tmp)?$/.test(name))) {
      const job = JSON.parse(await readFile(path.join(this.directory, file), 'utf8')) as LifecycleJob;
      if (!job.id || !job.ownerId || !file.startsWith(path.basename(this.file(job.id)))) throw new Error('Unknown temporary job ownership');
      if (job.ownerId === ownerId) result.push({ job, file });
    }
    return result;
  }
  /** Coordinator already holds the owner lock; all publications share it. Do not call outside coordinator. */
  deletionAdapter(): DeletionAdapter {
    return { idempotent: true,
      cleanup: async ({ subjectId }) => {
        if (!await this.owners.read(subjectId)) throw new Error('Deletion fence required');
        for (const record of await this.owned(subjectId)) await unlink(path.join(this.directory, record.file));
      },
      verify: async ({ subjectId }) => {
        const absent = !!await this.owners.read(subjectId) && (await this.owned(subjectId)).length === 0;
        return { complete: absent, evidence: absent ? ['file-backed owned jobs/payloads absent under owner lock'] : [] };
      } };
  }
}
