import { FunctionsClient } from '@supabase/functions-js';
import { createClient, type SupabaseClient, type User, type Session } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { uploadAccountStorage } from '../services/accountStorageUpload';
import { accountStorageUploadFetch, accountStorageUploadMimeHeader } from '../lib/accountStorageUploadFetch';

let mockClient: SupabaseClient;
jest.mock('../lib/supabase', () => ({ getRequiredSupabaseClient: () => mockClient }));
jest.mock('../lib/analytics', () => ({ createUuid: () => 'request-binary-test' }));

const owner = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 255, 128]);
const url = 'https://binary-upload.invalid';

describe('installed SDK binary upload transport (no network)', () => {
  beforeEach(async () => { await AsyncStorage.clear(); });

  it('reproduces functions-js 2.4.1 dropping a binary body with explicit Content-Type', async () => {
    const transport = jest.fn(async () => new Response('{}', { headers: { 'Content-Type': 'application/json' } }));
    const functions = new FunctionsClient(`${url}/functions/v1`, { customFetch: transport });
    await functions.invoke('account-storage-upload', { body: png.buffer, headers: { 'Content-Type': 'image/png' } });
    const init = (transport.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(init.body).toBeUndefined();
    expect(new Headers(init.headers).get('Content-Type')).toBe('image/png');
  });

  it.each([
    ['original', `${owner}/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/original-cccccccc-cccc-4ccc-8ccc-cccccccccccc.png`],
    ['cutout', `${owner}/item-1/cutout.png`],
  ])('sends nonempty byte-identical %s PNG through SDK authentication and durable journal', async (_kind, path) => {
    const transport = jest.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
      const journal = JSON.parse((await AsyncStorage.getItem((await AsyncStorage.getAllKeys())[0]))!);
      expect(journal).toMatchObject({ state: 'UNKNOWN', request: 'request-binary-test' });
      return new Response(JSON.stringify({ protocol: 'vitrify.storage-upload.v1', state: 'SUCCEEDED',
        owner, bucket: 'wardrobe-cutouts', path, operation: 'test-operation' }), { headers: { 'Content-Type': 'application/json' } });
    });
    mockClient = createClient(url, 'test-only-key', { auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: accountStorageUploadFetch(url, transport) } });
    jest.spyOn(mockClient.auth, 'getUser').mockResolvedValue({ data: { user: { id: owner } as User }, error: null });
    jest.spyOn(mockClient.auth, 'getSession').mockResolvedValue({ data: { session: { access_token: 'test-only-token' } as Session }, error: null });
    await uploadAccountStorage({ owner, bucket: 'wardrobe-cutouts', path, body: png.buffer, contentType: 'image/png' });
    expect(transport).toHaveBeenCalledTimes(1);
    const [input, init] = transport.mock.calls[0];
    const headers = new Headers(init?.headers);
    expect(headers.get('Authorization')).toBe('Bearer test-only-token');
    expect(headers.get('apikey')).toBe('test-only-key');
    expect(headers.get('Content-Type')).toBe('image/png');
    expect(headers.get('x-upload-request')).toBe('request-binary-test');
    expect(headers.get('x-upload-bucket')).toBe('wardrobe-cutouts');
    expect(headers.get('x-upload-path')).toBe(path);
    expect(headers.has(accountStorageUploadMimeHeader)).toBe(false);
    expect(init?.body).toBe(png.buffer);
    expect(new Uint8Array(await new Request(input, init).arrayBuffer())).toEqual(png);
    const journal = JSON.parse((await AsyncStorage.getItem((await AsyncStorage.getAllKeys())[0]))!);
    expect(journal.state).toBe('SUCCEEDED');
  });

  it('preserves JPEG MIME, body and abort signal without adding or replacing authentication', async () => {
    const transport = jest.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response('{}'));
    const signal = new AbortController().signal;
    const body = new Uint8Array([255, 216, 255]).buffer;
    await accountStorageUploadFetch(url, transport)(`${url}/functions/v1/account-storage-upload`, {
      method: 'POST', body, signal, headers: { [accountStorageUploadMimeHeader]: 'image/jpeg', Authorization: 'Bearer test-only-token' },
    });
    const init = transport.mock.calls[0][1]!;
    expect(init.body).toBe(body);
    expect(init.signal).toBe(signal);
    expect(new Headers(init.headers).get('Content-Type')).toBe('image/jpeg');
    expect(new Headers(init.headers).get('Authorization')).toBe('Bearer test-only-token');
  });

  it.each([
    [`${url}/functions/v1/account-storage-status`, 'POST'],
    [`${url}/functions/v1/account-storage-upload`, 'DELETE'],
    ['https://other-project.invalid/functions/v1/account-storage-upload', 'POST'],
  ])('leaves other SDK requests unchanged: %s %s', async (input, method) => {
    const transport = jest.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response('{}'));
    const init = { method, body: 'unchanged', headers: { 'Content-Type': 'application/json' } };
    await accountStorageUploadFetch(url, transport)(input, init);
    expect(transport).toHaveBeenCalledWith(input, init);
    expect(transport.mock.calls[0][1]).toBe(init);
  });
});
