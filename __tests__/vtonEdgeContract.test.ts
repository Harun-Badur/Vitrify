import { readFileSync } from 'fs';
import { join } from 'path';
import {
  FASHN_TIMEOUT_ERROR,
  isPollContinueStatus,
  mapFashnHttpError,
  mapFashnRuntimeFailure,
  normalizePngDataUri,
  readVtonClientRequest,
  resolveVtonProxyUrl,
} from '../lib/vtonEdgeContract';

describe('vtonEdgeContract', () => {
  it('derives VTON from the configured Supabase project only when explicit endpoint is absent', () => {
    expect(resolveVtonProxyUrl(undefined, 'https://hnujkabyyrlsxohjhxlg.supabase.co/')).toBe('https://hnujkabyyrlsxohjhxlg.supabase.co/functions/v1/vton-proxy');
    expect(resolveVtonProxyUrl(' https://fixture.invalid/vton/ ', 'https://hnujkabyyrlsxohjhxlg.supabase.co')).toBe('https://fixture.invalid/vton');
  });
  it.each([undefined, 'http://hnujkabyyrlsxohjhxlg.supabase.co', 'https://other.invalid', 'https://hnujkabyyrlsxohjhxlg.supabase.co/extra', 'https://user:password@hnujkabyyrlsxohjhxlg.supabase.co', 'https://hnujkabyyrlsxohjhxlg.supabase.co?key=x'])('does not derive an endpoint from invalid project URL %s', url => {
    expect(resolveVtonProxyUrl(undefined, url)).toBeNull();
  });
  it('geçerli client body kabul eder', () => {
    expect(
      readVtonClientRequest({
        model_image: 'data:image/jpeg;base64,abc=',
        product_image: 'https://productimages.example.com/item.jpg',
      }),
    ).toEqual({
      model_image: 'data:image/jpeg;base64,abc=',
      product_image: 'https://productimages.example.com/item.jpg',
    });
  });

  it('eksik/http body reddeder', () => {
    expect(readVtonClientRequest({})).toBeNull();
    expect(
      readVtonClientRequest({
        model_image: 'data:image/png;base64,abc',
        product_image: 'http://insecure.example.com/a.jpg',
      }),
    ).toBeNull();
    expect(
      readVtonClientRequest({
        model_image: 'abc',
        product_image: 'https://cdn.example.com/a.jpg',
      }),
    ).toBeNull();
  });

  it('FASHN HTTP kodlarını güvenli Türkçe detaya çevirir', () => {
    expect(mapFashnHttpError(400)).toEqual({
      status: 400,
      detail: 'Geçersiz sanal deneme isteği.',
    });
    expect(mapFashnHttpError(401)).toEqual({
      status: 401,
      detail: 'Servis yapılandırılmamış.',
    });
    expect(mapFashnHttpError(422)).toEqual({
      status: 422,
      detail: 'Görsel/deneme girdisi işlenemedi.',
    });
    expect(mapFashnHttpError(429)).toEqual({
      status: 429,
      detail: 'Sanal deneme servisi geçici olarak yoğun.',
    });
    expect(mapFashnHttpError(503)).toEqual({
      status: 502,
      detail: 'Sanal deneme servisine ulaşılamadı.',
    });
    expect(mapFashnHttpError(402)).toEqual({
      status: 502,
      detail: 'Sanal deneme tamamlanamadı.',
    });
  });

  it('poll continue/completed/failed ayrımı yapar', () => {
    expect(isPollContinueStatus('starting')).toBe(true);
    expect(isPollContinueStatus('in_queue')).toBe(true);
    expect(isPollContinueStatus('processing')).toBe(true);
    expect(isPollContinueStatus('completed')).toBe(false);
    expect(isPollContinueStatus('failed')).toBe(false);
    expect(mapFashnRuntimeFailure('ImageLoadError').status).toBe(422);
    expect(mapFashnRuntimeFailure('OtherError').detail).toBe(
      'Sanal deneme tamamlanamadı.',
    );
    expect(FASHN_TIMEOUT_ERROR.status).toBe(504);
  });

  it('PNG data URI dışında çıktıyı malform kabul eder', () => {
    expect(
      normalizePngDataUri('data:image/png;base64,abc+def=='),
    ).toBe('data:image/png;base64,abc+def==');
    expect(
      normalizePngDataUri('https://cdn.fashn.ai/output.png'),
    ).toBeNull();
    expect(normalizePngDataUri('data:image/jpeg;base64,abc')).toBeNull();
  });
});

describe('vton-proxy wiring', () => {
  it('JWT, kota ve FASHN_API_KEY kontrolü içerir; client FASHN alanları taşımaz', () => {
    const source = readFileSync(
      join(__dirname, '../supabase/functions/vton-proxy/index.ts'),
      'utf8',
    );
    expect(source).toContain('getUser');
    expect(source).toContain('consume_vton_quota');
    expect(source).toContain('FASHN_API_KEY');
    expect(source).toContain("jsonResponse({ detail: 'Servis yapılandırılmamış.' }, 401)");
    expect(source).toContain('buildFashnTryOnMaxRequest');
    expect(source).not.toContain('garment_image');
    expect(source).not.toContain('cloth_type');
  });
});
