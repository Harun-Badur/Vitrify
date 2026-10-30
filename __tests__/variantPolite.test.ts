import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  createFetcher,
  detectBlock,
  isPathAllowed,
  parseRobots,
} from '../scripts/variants/polite';

const ROBOTS = [
  'User-agent: Googlebot',
  'Disallow: /',
  '',
  'User-agent: *',
  'Disallow: /sepet',
  'Disallow: /*?sort=',
  'Allow: /sepet/ok',
].join('\n');

describe('robots', () => {
  const rules = parseRobots(ROBOTS);
  it('applies only the * group and longest match', () => {
    expect(isPathAllowed(rules, '/urun/x-1')).toBe(true);
    expect(isPathAllowed(rules, '/sepet')).toBe(false);
    expect(isPathAllowed(rules, '/sepet/ok')).toBe(true);
    expect(isPathAllowed(rules, '/a?sort=1')).toBe(false);
  });
});

describe('detectBlock', () => {
  it('flags 403/429/empty/captcha', () => {
    expect(detectBlock(403, 'x')).toBe('http_403');
    expect(detectBlock(429, 'x')).toBe('http_429');
    expect(detectBlock(200, ' ')).toBe('empty_body');
    expect(detectBlock(200, '<html>Please solve the captcha</html>')).toBe('captcha');
    expect(detectBlock(200, '<html>ok</html>')).toBeNull();
  });
});

describe('fetcher', () => {
  const makeFetch = (statusFor: (u: string) => number) => {
    const calls: string[] = [];
    const impl = (async (u: string) => {
      calls.push(u);
      if (u.endsWith('/robots.txt')) {
        return new Response('User-agent: *\nDisallow: /no', { status: 200 });
      }
      const s = statusFor(u);
      return new Response(s === 200 ? `<html>${'x'.repeat(50)}</html>` : 'denied', { status: s });
    }) as unknown as typeof fetch;
    return { calls, impl };
  };

  it('caches pages, respects robots, stops host on 429', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'vp-'));
    const { calls, impl } = makeFetch((u) => (u.includes('bad') ? 429 : 200));
    const f = createFetcher(dir, { fetchImpl: impl, minIntervalMs: 0, sleep: async () => {} });
    expect((await f.fetchPage('https://h.test/p/1')).kind).toBe('ok');
    const again = await f.fetchPage('https://h.test/p/1');
    expect(again.kind === 'ok' && again.fromCache).toBe(true);
    expect((await f.fetchPage('https://h.test/no/x')).kind).toBe('robots');
    expect((await f.fetchPage('https://h.test/bad')).kind).toBe('blocked');
    expect((await f.fetchPage('https://h.test/p/2')).kind).toBe('blocked');
    expect(calls.filter((c) => c.endsWith('/p/1'))).toHaveLength(1);
  });

  it('spaces requests per host by the interval', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'vp-'));
    const { impl } = makeFetch(() => 200);
    const sleeps: number[] = [];
    const f = createFetcher(dir, {
      fetchImpl: impl,
      minIntervalMs: 3000,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });
    await f.fetchPage('https://h.test/p/1');
    await f.fetchPage('https://h.test/p/2');
    expect(sleeps.some((ms) => ms > 2000)).toBe(true);
  });
});
