import type { PremiumLifecycle } from './premiumA1Lifecycle';
export interface VerifiedMembership {
  tier: 'free' | 'premium';
  expiresAtMs: number | null;
  checkedAtMs: number;
  dailyLimit: 3 | 20 | null;
  minuteLimit: 3 | null;
  storeProducts: Record<string, string[]>;
}
export interface PremiumPackage {
  id: string;
  productId: string;
  store: 'app_store' | 'play_store';
  period: 'monthly' | 'annual';
  price: string;
}
export interface PremiumClientPorts {
  configured(): boolean;
  identity(owner: string): Promise<string>;
  connect(identity: string): Promise<void>;
  disconnect(): Promise<void>;
  verify(owner: string): Promise<VerifiedMembership>;
  packages(): Promise<PremiumPackage[]>;
  purchase(id: string): Promise<void>;
  restore(): Promise<void>;
  management(): Promise<string | null>;
  open(url: string): Promise<void>;
}
export interface PremiumClientState {
  owner: string | null;
  membership: VerifiedMembership | null;
  packages: PremiumPackage[];
  busy: boolean;
  configured: boolean;
  awaitingVerification: boolean;
  storeOperationPending?: boolean;
  message: string | null;
}
export function parseVerifiedMembership(
  input: unknown,
  now = Date.now(),
): VerifiedMembership {
  const value = input as Record<string, unknown> | null;
  if (
    !value ||
    !['free', 'premium'].includes(String(value.tier)) ||
    typeof value.checkedAtMs !== 'number' ||
    !Number.isFinite(value.checkedAtMs) ||
    Math.abs(now - value.checkedAtMs) > 60000 ||
    (value.tier === 'premium' &&
      (typeof value.expiresAtMs !== 'number' ||
        !Number.isFinite(value.expiresAtMs) ||
        value.expiresAtMs <= now))
  )
    throw new Error('MEMBERSHIP_UNVERIFIED');
  const quotaActive = value.quotaPolicyActive === true;
  if (
    quotaActive &&
    (value.vtonDailyLimit !== (value.tier === 'premium' ? 20 : 3) ||
      value.vtonMinuteLimit !== 3)
  )
    throw new Error('QUOTA_UNVERIFIED');
  const storeProducts: Record<string, string[]> = {};
  const products = value.storeProducts as Record<string, unknown> | undefined;
  for (const store of ['app_store', 'play_store']) {
    const ids = products?.[store];
    if (
      Array.isArray(ids) &&
      ids.every((id) => typeof id === 'string' && id.length > 0)
    )
      storeProducts[store] = [...ids];
  }
  return {
    tier: value.tier as 'free' | 'premium',
    expiresAtMs:
      value.tier === 'premium' ? (value.expiresAtMs as number) : null,
    checkedAtMs: value.checkedAtMs,
    dailyLimit: quotaActive ? (value.vtonDailyLimit as 3 | 20) : null,
    minuteLimit: quotaActive ? 3 : null,
    storeProducts,
  };
}
const empty = (
  owner: string | null,
  configured: boolean,
): PremiumClientState => ({
  owner,
  configured,
  membership: null,
  packages: [],
  busy: false,
  awaitingVerification: false,
  message: null,
});
const fresh = (membership: VerifiedMembership | null) =>
  membership !== null &&
  Date.now() - membership.checkedAtMs < 60000 &&
  (membership.tier !== 'premium' || (membership.expiresAtMs ?? 0) > Date.now());

/** All SDK mutations are serialized; owner revision changes immediately discard publications. */
export function createPremiumClient(
  ports: PremiumClientPorts,
  lifecycle?: PremiumLifecycle,
) {
  let state = empty(null, ports.configured()),
    generation = 0,
    queue = Promise.resolve(),
    actionPending = false;
  const listeners = new Set<() => void>();
  const publish = (patch: Partial<PremiumClientState>) => {
    state = { ...state, ...patch };
    listeners.forEach((fn) => fn());
  };
  let releaseOwner: (() => void) | undefined;
  const enqueue = (work: () => Promise<void>, track = true) => {
    const owner = state.owner;
    const previous = queue;
    const task =
      track && owner && lifecycle
        ? lifecycle.run(owner, () => previous.then(work))
        : previous.then(work);
    queue = task.catch(() => undefined);
    return queue;
  };
  const verify = async (owner: string, version: number) => {
    const membership = await ports.verify(owner);
    if (generation !== version) return;
    const waiting = state.awaitingVerification && membership.tier !== 'premium';
    publish({
      membership,
      awaitingVerification: waiting,
      message: waiting
        ? 'Mağaza işlemi için backend doğrulaması bekleniyor. Yeniden satın almadan durumu kontrol et.'
        : null,
    });
  };
  const load = async (owner: string, version: number) => {
    try {
      const identity = await ports.identity(owner);
      if (generation !== version) return;
      await ports.connect(identity);
      if (generation !== version) return;
      await verify(owner, version);
      if (generation !== version) return;
      try {
        const received = await ports.packages();
        if (generation === version) {
          const packages = received.filter((pack) =>
            state.membership?.storeProducts[pack.store]?.includes(
              pack.productId,
            ),
          );
          publish({
            packages,
            message: packages.length
              ? state.message
              : 'Mağaza paketleri şu anda kullanılamıyor.',
          });
        }
      } catch {
        if (generation === version)
          publish({
            packages: [],
            message: 'Mağaza paketleri şu anda kullanılamıyor.',
          });
      }
    } catch {
      if (generation === version)
        publish({
          membership: null,
          packages: [],
          message:
            'Üyelik doğrulanamadı. Satın alma kapalı; tekrar kontrol edebilirsin.',
        });
    } finally {
      if (generation === version) publish({ busy: false });
    }
  };
  const action = (kind: 'purchase' | 'restore', id?: string) => {
    const owner = state.owner,
      version = generation;
    if (
      !owner ||
      !state.configured ||
      state.busy ||
      actionPending ||
      !fresh(state.membership) ||
      (kind === 'purchase' &&
        (state.awaitingVerification ||
          state.membership?.dailyLimit == null ||
          state.membership?.tier === 'premium' ||
          !state.packages.some((p) => p.id === id)))
    )
      return Promise.resolve();
    actionPending = true;
    publish({ busy: true, message: null, storeOperationPending: true });
    return enqueue(async () => {
      try {
        if (generation !== version) return;
        if (kind === 'purchase') await ports.purchase(id!);
        else await ports.restore();
        if (generation !== version) return;
        publish({
          membership: null,
          awaitingVerification: kind === 'purchase',
        });
        await verify(owner, version);
        if (generation === version && kind === 'restore')
          publish({
            message:
              state.membership?.tier === 'premium'
                ? 'Premium üyeliğin backend tarafından doğrulandı.'
                : 'Bu hesapta doğrulanmış aktif Premium abonelik bulunamadı.',
          });
      } catch (error) {
        if (generation !== version) return;
        if ((error as { userCancelled?: boolean })?.userCancelled)
          publish({ message: 'Satın alma iptal edildi.' });
        else
          publish({
            membership: null,
            awaitingVerification: kind === 'purchase',
            message:
              'İşlem doğrulanamadı. Hesap eşleşmesini kontrol et; yeniden satın almadan durumu yenile veya destek al.',
          });
      } finally {
        actionPending = false;
        if (generation === version)
          publish({ busy: false, storeOperationPending: false });
      }
    });
  };
  return {
    getSnapshot: () => state,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    setOwner(owner: string | null, autoLoad = true) {
      if (state.owner === owner) return queue;
      releaseOwner?.();
      releaseOwner = undefined;
      const version = ++generation;
      actionPending = false;
      state = empty(owner, ports.configured());
      listeners.forEach((fn) => fn());
      if (owner && lifecycle)
        releaseOwner = lifecycle.bind(owner, () => {
          if (state.owner === owner) {
            ++generation;
            actionPending = false;
            publish({
              membership: null,
              packages: [],
              busy: false,
              awaitingVerification: false,
              message:
                'Hesap silme veya oturum değişimi nedeniyle üyelik işlemleri durduruldu.',
            });
          }
          return enqueue(async () => {
            await ports.disconnect();
          }, false);
        });
      return enqueue(async () => {
        try {
          await ports.disconnect();
        } catch {
          if (generation === version)
            publish({
              message: 'Mağaza oturumu temizlenemedi. Satın alma kapalı.',
            });
          return;
        }
        if (generation !== version || !owner) return;
        if (!state.configured) {
          publish({
            message: 'Premium satın alma henüz kullanıma hazır değil.',
          });
          return;
        }
        if (!autoLoad) return;
        publish({ busy: true });
        await load(owner, version);
      }).catch(() => undefined);
    },
    refresh(force = false) {
      const owner = state.owner,
        version = generation;
      if (
        !owner ||
        !state.configured ||
        state.busy ||
        actionPending ||
        (!force && fresh(state.membership))
      )
        return Promise.resolve();
      publish({ busy: true });
      return enqueue(() =>
        generation === version ? load(owner, version) : Promise.resolve(),
      ).catch(() => undefined);
    },
    invalidate() {
      publish({ membership: null });
    },
    purchase: (id: string) => action('purchase', id),
    restore: () => action('restore'),
    manage() {
      const version = generation;
      if (!state.owner || !state.configured || state.busy || actionPending)
        return Promise.resolve();
      publish({ busy: true });
      return enqueue(async () => {
        try {
          if (generation !== version) return;
          const url = await ports.management();
          if (generation !== version) return;
          if (!url) throw new Error('MANAGEMENT_UNAVAILABLE');
          await ports.open(url);
        } catch {
          if (generation === version)
            publish({
              message:
                'Abonelik yönetimi açılamadı. Satın aldığın mağazanın abonelik ayarlarını kullan.',
            });
        } finally {
          if (generation === version) publish({ busy: false });
        }
      });
    },
  };
}
