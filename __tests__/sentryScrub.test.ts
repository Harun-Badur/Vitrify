import {
  buildDeviceTags,
  ramClass,
  scrubBreadcrumb,
  scrubEvent,
  scrubTransaction,
  scrubUrl,
} from '../lib/sentryScrub';

describe('scrubUrl', () => {
  it('drops query string, fragment and id-like path segments', () => {
    expect(scrubUrl('https://x.supabase.co/rest/v1/products?select=*&apikey=abc#frag')).toBe(
      'https://x.supabase.co/rest/v1/products',
    );
    expect(scrubUrl('https://x.co/storage/v1/object/0b9a3c1e-1111-4222-8333-444455556666/a.jpg?token=eyJ')).toBe(
      'https://x.co/storage/v1/object/:id/a.jpg',
    );
    expect(scrubUrl('https://x.co/products/12345')).toBe('https://x.co/products/:id');
  });
});

describe('scrubEvent', () => {
  it('keeps only an anonymous id on the user and removes PII fields', () => {
    const event = scrubEvent({
      user: { id: 'anon-1', email: 'a@b.com', username: 'harun', ip_address: '1.2.3.4' },
      request: {
        url: 'https://x.co/p?token=1',
        query_string: 'token=1',
        cookies: { a: 'b' },
        headers: { authorization: 'Bearer eyJabc.def.ghi' },
        data: { email: 'a@b.com' },
      },
      message: 'failed for a@b.com with Bearer eyJhbGciOi.abc.def',
      extra: { userId: 'u1', productName: 'x', count: 2 },
    } as never) as Record<string, any>;
    expect(event.user).toEqual({ id: 'anon-1' });
    expect(event.request).toEqual({ url: 'https://x.co/p' });
    expect(event.message).not.toMatch(/a@b\.com|eyJ/);
    expect(event.extra.userId).toBe('[gizlendi]');
    expect(event.extra.count).toBe(2);
  });

  it('scrubs exception messages', () => {
    const event = scrubEvent({
      exception: { values: [{ type: 'Error', value: 'bad sb_secret_abcdef1234567890 for me@x.io' }] },
    } as never) as Record<string, any>;
    expect(event.exception.values[0].value).not.toMatch(/me@x\.io|sb_secret/);
  });
});

describe('scrubBreadcrumb', () => {
  it('drops console breadcrumbs', () => {
    expect(scrubBreadcrumb({ category: 'console', message: 'user a@b.com' })).toBeNull();
  });

  it('keeps only method/status and a clean url for http breadcrumbs', () => {
    const crumb = scrubBreadcrumb({
      category: 'fetch',
      data: { url: 'https://x.co/rest/v1/a?apikey=k', method: 'GET', status_code: 200, request_body: 'secret' },
    })!;
    expect(crumb.data).toEqual({ url: 'https://x.co/rest/v1/a', method: 'GET', status_code: 200 });
  });

  it('maps navigation to closed route labels', () => {
    const crumb = scrubBreadcrumb({ category: 'navigation', data: { from: '/wardrobe/abc-1', to: '/profile?x=1' } })!;
    expect(crumb.data).toEqual({ from: 'dolap', to: 'profil' });
  });

  it('strips ui text', () => {
    const crumb = scrubBreadcrumb({ category: 'ui.click', message: 'Button Siyah Ceket', data: { a: 1 } })!;
    expect(crumb.message).toBeUndefined();
    expect(crumb.data).toBeUndefined();
  });
});

describe('scrubTransaction', () => {
  it('cleans span descriptions and urls', () => {
    const tx = scrubTransaction({
      transaction: 'GET https://x.co/p?token=1',
      spans: [{ description: 'GET https://x.co/rest/v1/a?apikey=k', data: { 'http.query': 'apikey=k', 'http.url': 'https://x.co/a?k=1' } }],
    } as never) as Record<string, any>;
    expect(tx.transaction).toBe('GET https://x.co/p');
    expect(tx.spans[0].description).toBe('GET https://x.co/rest/v1/a');
    expect(tx.spans[0].data).toEqual({ 'http.url': 'https://x.co/a' });
  });
});

describe('device tags', () => {
  it('classifies ram', () => {
    expect(ramClass(2 * 1024 ** 3)).toBe('dusuk');
    expect(ramClass(4 * 1024 ** 3)).toBe('orta');
    expect(ramClass(8 * 1024 ** 3)).toBe('yuksek');
    expect(ramClass(null)).toBe('bilinmiyor');
  });

  it('builds the tag set', () => {
    expect(buildDeviceTags({ model: 'Pixel 7', osVersion: '14', totalMemory: 8 * 1024 ** 3, appVersion: '1.0.0', versionCode: 3 })).toEqual({
      device_model: 'Pixel 7',
      android_version: '14',
      ram_class: 'yuksek',
      app_version: '1.0.0',
      version_code: '3',
    });
  });
});
