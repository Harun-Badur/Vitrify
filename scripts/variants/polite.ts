import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const PILOT_USER_AGENT =
  'VitrifyVariantPilot/0.1 (closed-beta research; contact: badurx101@gmail.com)';
export const MIN_INTERVAL_MS = 3000;

export interface RobotsRules {
  allow: string[];
  disallow: string[];
}

/** Parses robots.txt, keeping the groups that apply to `*` or to our UA token. */
export const parseRobots = (
  text: string,
  uaToken = 'vitrifyvariantpilot',
): RobotsRules => {
  const rules: RobotsRules = { allow: [], disallow: [] };
  let groupAgents: string[] = [];
  let lastWasAgent = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    const idx = line.indexOf(':');
    if (idx < 0) continue;
    const key = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();
    if (key === 'user-agent') {
      if (!lastWasAgent) groupAgents = [];
      groupAgents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    const applies = groupAgents.some((a) => a === '*' || uaToken.includes(a));
    if (!applies || !value) continue;
    if (key === 'allow') rules.allow.push(value);
    if (key === 'disallow') rules.disallow.push(value);
  }
  return rules;
};

const patternToRegExp = (pattern: string): RegExp => {
  const anchored = pattern.endsWith('$');
  const body = (anchored ? pattern.slice(0, -1) : pattern)
    .replace(/[.+?^{}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*');
  return new RegExp(`^${body}${anchored ? '$' : ''}`);
};

/** Longest match wins; Allow wins ties (RFC 9309). */
export const isPathAllowed = (
  rules: RobotsRules,
  pathAndQuery: string,
): boolean => {
  let best = { len: -1, allow: true };
  const groups: Array<[string[], boolean]> = [
    [rules.disallow, false],
    [rules.allow, true],
  ];
  for (const [list, allow] of groups) {
    for (const p of list) {
      if (!patternToRegExp(p).test(pathAndQuery)) continue;
      if (p.length > best.len || (p.length === best.len && allow)) {
        best = { len: p.length, allow };
      }
    }
  }
  return best.allow;
};

export type FetchOutcome =
  | { kind: 'ok'; html: string; status: number; fromCache: boolean }
  | { kind: 'blocked'; reason: string; status: number }
  | { kind: 'robots'; reason: string }
  | { kind: 'error'; reason: string; status: number };

const CAPTCHA_PATTERN =
  /captcha|are you a robot|access denied|cf-challenge|challenge-platform|px-captcha/i;

export const detectBlock = (status: number, body: string): string | null => {
  if (status === 403 || status === 429) return `http_${status}`;
  if (status === 200 && body.trim().length === 0) return 'empty_body';
  if (CAPTCHA_PATTERN.test(body.slice(0, 20_000)) && body.length < 30_000) {
    return 'captcha';
  }
  return null;
};

export interface Fetcher {
  fetchPage(url: string): Promise<FetchOutcome>;
  blockedHosts(): Map<string, string>;
  networkRequests(): number;
}

interface FetcherOptions {
  minIntervalMs?: number;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

export const createFetcher = (
  cacheDir: string,
  opts: FetcherOptions = {},
): Fetcher => {
  const interval = opts.minIntervalMs ?? MIN_INTERVAL_MS;
  const doFetch = opts.fetchImpl ?? fetch;
  const sleep =
    opts.sleep ??
    ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const lastRequestAt = new Map<string, number>();
  const robots = new Map<string, RobotsRules>();
  const blocked = new Map<string, string>();
  let requests = 0;

  const cachePath = (url: string, kind: string): string =>
    path.join(
      cacheDir,
      `${kind}-${createHash('sha1').update(url).digest('hex')}.json`,
    );

  const readCache = async (
    url: string,
    kind: string,
  ): Promise<{ status: number; body: string } | null> => {
    try {
      return JSON.parse(await readFile(cachePath(url, kind), 'utf8'));
    } catch {
      return null;
    }
  };

  const rawGet = async (
    url: string,
    host: string,
  ): Promise<{ status: number; body: string }> => {
    const wait = (lastRequestAt.get(host) ?? 0) + interval - Date.now();
    if (wait > 0) await sleep(wait);
    lastRequestAt.set(host, Date.now());
    requests += 1;
    const res = await doFetch(url, {
      headers: {
        'User-Agent': PILOT_USER_AGENT,
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'tr-TR,tr;q=0.9',
      },
      redirect: 'follow',
    });
    return { status: res.status, body: await res.text() };
  };

  const getRobots = async (u: URL): Promise<RobotsRules> => {
    const known = robots.get(u.host);
    if (known) return known;
    const robotsUrl = `${u.protocol}//${u.host}/robots.txt`;
    let entry = await readCache(robotsUrl, 'robots');
    if (!entry) {
      try {
        entry = await rawGet(robotsUrl, u.host);
        await mkdir(cacheDir, { recursive: true });
        await writeFile(
          cachePath(robotsUrl, 'robots'),
          JSON.stringify(entry),
          'utf8',
        );
      } catch {
        entry = { status: 0, body: '' };
      }
    }
    const rules =
      entry.status === 200
        ? parseRobots(entry.body)
        : { allow: [], disallow: [] };
    robots.set(u.host, rules);
    return rules;
  };

  return {
    blockedHosts: () => blocked,
    networkRequests: () => requests,
    async fetchPage(url) {
      const u = new URL(url);
      const hostBlock = blocked.get(u.host);
      if (hostBlock) {
        return { kind: 'blocked', reason: `host_stopped:${hostBlock}`, status: 0 };
      }
      const cached = await readCache(url, 'page');
      if (cached) {
        return { kind: 'ok', html: cached.body, status: cached.status, fromCache: true };
      }
      const rules = await getRobots(u);
      if (!isPathAllowed(rules, u.pathname + u.search)) {
        return { kind: 'robots', reason: 'disallowed_by_robots' };
      }
      let res: { status: number; body: string };
      try {
        res = await rawGet(url, u.host);
      } catch (e) {
        return {
          kind: 'error',
          reason: e instanceof Error ? e.message : 'network_error',
          status: 0,
        };
      }
      const block = detectBlock(res.status, res.body);
      if (block) {
        blocked.set(u.host, block);
        return { kind: 'blocked', reason: block, status: res.status };
      }
      if (res.status !== 200) {
        return { kind: 'error', reason: `http_${res.status}`, status: res.status };
      }
      await mkdir(cacheDir, { recursive: true });
      await writeFile(cachePath(url, 'page'), JSON.stringify(res), 'utf8');
      return { kind: 'ok', html: res.body, status: res.status, fromCache: false };
    },
  };
};
