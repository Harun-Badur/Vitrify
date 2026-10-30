import * as fs from 'fs';
import * as path from 'path';
import { createDeckRefresher } from '../lib/deckRefresh';

describe('createDeckRefresher', () => {
  it('bypasses the catalog cache, reloads, and reports ready when products arrive', async () => {
    const order: string[] = [];
    const refresh = createDeckRefresher({
      resetCaches: () => { order.push('reset'); },
      reload: async () => { order.push('reload'); },
      deckSize: () => 3,
    });
    await expect(refresh()).resolves.toBe('ready');
    expect(order).toEqual(['reset', 'reload']);
  });

  it('reports empty when the reload still yields no products, and can be retried', async () => {
    const reload = jest.fn(async () => undefined);
    const refresh = createDeckRefresher({ resetCaches: jest.fn(), reload, deckSize: () => 0 });
    await expect(refresh()).resolves.toBe('empty');
    await expect(refresh()).resolves.toBe('empty');
    expect(reload).toHaveBeenCalledTimes(2);
  });

  it('ignores a second tap while a refresh is in flight', async () => {
    let release: () => void = () => undefined;
    const reload = jest.fn(() => new Promise<void>(resolve => { release = resolve; }));
    const refresh = createDeckRefresher({ resetCaches: jest.fn(), reload, deckSize: () => 1 });
    const first = refresh();
    await expect(refresh()).resolves.toBe('busy');
    release();
    await expect(first).resolves.toBe('ready');
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('frees the guard even if the reload throws', async () => {
    const reload = jest.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined);
    const refresh = createDeckRefresher({ resetCaches: jest.fn(), reload, deckSize: () => 2 });
    await expect(refresh()).rejects.toThrow('offline');
    await expect(refresh()).resolves.toBe('ready');
  });
});

describe('Deck finished screen wiring (source contract)', () => {
  const screen = fs.readFileSync(path.join(__dirname, '../app/(tabs)/index.tsx'), 'utf8');
  it('starts the finished block below the header and centers it above the tab bar', () => {
    expect(screen).toMatch(/finishedLayout/);
    expect(screen).toMatch(/paddingTop:\s*finishedLayout \? railTopInset - spacing\.lg : 0/);
    expect(screen).toMatch(/justifyContent: 'center'/);
  });
  it('wires Yenile to the guarded refresher and shows loading and empty states', () => {
    expect(screen).toContain('createDeckRefresher');
    expect(screen).toContain('Yükleniyor…');
    expect(screen).toContain('Şimdilik yeni ürün yok, daha sonra tekrar dene');
    expect(screen).toMatch(/!(refreshing && !hasDeck)/);
  });
});
