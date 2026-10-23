import {
  captureOwnerPublication,
  registerOwnerResource,
  trackOwnerWork,
} from '../lib/accountDeviceWork';
import {
  isAccountWriteFenced,
  withAccountWriteGuard,
} from '../lib/accountWriteFence';
export interface PremiumLifecycle {
  run<T>(owner: string, work: () => Promise<T>): Promise<T>;
  bind(owner: string, stop: () => Promise<void>): () => void;
}
export function createPremiumA1Lifecycle(): PremiumLifecycle {
  return {
    run(owner, work) {
      const current = captureOwnerPublication(owner);
      return trackOwnerWork(
        owner,
        Promise.resolve().then(async () => {
          if ((await isAccountWriteFenced(owner)) || !current())
            throw new Error('ACCOUNT_DELETION_FENCED');
          return work();
        }),
      );
    },
    bind(owner, onStop) {
      let stopped = false,
        clean = false,
        cleanup: Promise<void> | null = null;
      const resource = {
        stop: () => {
          if (cleanup || clean) return;
          stopped = true;
          cleanup = trackOwnerWork(owner, onStop());
          void cleanup.then(
            () => {
              clean = true;
              cleanup = null;
              unregister();
            },
            () => {
              cleanup = null;
            },
          );
        },
        empty: () => stopped && clean && cleanup === null,
      };
      // registerOwnerResource may synchronously stop a previously fenced owner.
      let unregister = () => undefined as void;
      unregister = registerOwnerResource(owner, resource);
      return () => {
        resource.stop();
        if (resource.empty()) unregister();
      };
    },
  };
}
/** Admission is a server check; the native dispatch is guarded again without an async gap.
 * The guard holds only dispatch initiation, NOT the unbounded native payment promise.
 */
export function dispatchPremiumUnderGuard<T>(
  owner: string,
  admit: () => Promise<void>,
  dispatch: () => Promise<T>,
): Promise<T> {
  const current = captureOwnerPublication(owner);
  return trackOwnerWork(
    owner,
    (async () => {
      if ((await isAccountWriteFenced(owner)) || !current())
        throw new Error('ACCOUNT_DELETION_FENCED');
      await admit();
      let native: Promise<T> | undefined;
      await withAccountWriteGuard(owner, async () => {
        if (!current()) throw new Error('OWNER_CHANGED');
        native = trackOwnerWork(owner, dispatch());
      });
      return await native!;
    })(),
  );
}
