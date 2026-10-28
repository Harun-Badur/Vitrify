/**
 * READ-ONLY preview: compares stored product_attributes with the current title rules,
 * merges them with the shared rule (lib/catalogEnrichment.ts: an unknown inference keeps
 * the stored value; a different inference wins and is marked "incelenecek"), and writes
 * scripts/queries/catalog_enrichment_preview.csv and catalog_enrichment_review.md.
 * Uses anon PostgREST GET only; nothing is written to the database and nothing is wired
 * into scoring.
 *
 * Run: npx tsx scripts/previewCatalogEnrichment.ts
 */
import { config as loadEnv } from 'dotenv';
import { writeFileSync } from 'fs';
import { join } from 'path';
import { computeCatalogEnrichment, existingGender, FEED_CATEGORIES } from '../lib/catalogEnrichment';
import { cleanDeclaredCatalogColors, declaredCatalogFit } from '../lib/catalogMetadata';
import {
  inferColorsFromText,
  inferFitFromTitle,
  inferGenderDetail,
  inferSubcategory,
  matchSubcategoryFromTitle,
} from '../lib/productAttributes';
import { SUBTYPES } from '../lib/styleVocabulary';
import type { GarmentCategory } from '../types/product';

loadEnv();

const PAGE_SIZE = 1000;
const GARMENT_CATEGORIES = ['upper_body', 'lower_body', 'dresses'];

interface ProductRow { id: string; provider: string; title: string; brand: string | null; category: string; product_url: string | null; price: number | null; current_price: number | null; image_url: string | null }
interface AttributeRow { product_id: string; gender: string | null; colors: unknown; fit: string | null; subcategory: string | null }

const baseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
if (!baseUrl || !anonKey) throw new Error('EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY missing');

const fetchAll = async <T>(table: string, select: string, order: string): Promise<T[]> => {
  const rows: T[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const response = await fetch(
      `${baseUrl}/rest/v1/${table}?select=${select}&order=${order}.asc&limit=${PAGE_SIZE}&offset=${offset}`,
      { headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}` } },
    );
    if (!response.ok) throw new Error(`${table}: HTTP ${response.status}`);
    const page = (await response.json()) as T[];
    rows.push(...page);
    if (page.length < PAGE_SIZE) return rows;
  }
};

const CATEGORY_ORDER: readonly string[] = FEED_CATEGORIES;
const bump = (map: Map<string, number>, key: string) => map.set(key, (map.get(key) ?? 0) + 1);
const sorted = (map: Map<string, number>) => [...map].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', ');

const csvCell = (value: unknown): string => {
  const text = String(value ?? '');
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

const vocabularyFor = (category: string, slug: string | undefined) =>
  SUBTYPES[category as GarmentCategory]?.find(item => item.slug === slug);

const main = async () => {
  const products = await fetchAll<ProductRow>('products', 'id,provider,title,brand,category,product_url,price,current_price,image_url', 'id');
  const attributes = new Map((await fetchAll<AttributeRow>('product_attributes', 'product_id,gender,colors,fit,subcategory', 'product_id'))
    .map(row => [row.product_id, row]));

  const stats = { total: products.length, changed: 0, review: 0, reviewFields: 0, unknownColor: 0, unknownSubcategory: 0,
    unknownFit: 0, unknownGender: 0, anyUnknown: 0, vocabulary: 0 };
  const lines: string[] = [];
  const reviewLines: string[] = [];
  const reasons = new Map<string, number>(), ineligibleByProvider = new Map<string, number>(),
    ineligibleByBrand = new Map<string, number>();
  const bySide: Record<string, Map<string, number>> = { kadin: new Map(), erkek: new Map(), unisex: new Map() };
  let eligibleCount = 0;

  for (const product of products) {
    const stored = attributes.get(product.id);
    const garment = GARMENT_CATEGORIES.includes(product.category);
    const curColors = cleanDeclaredCatalogColors(product.id, stored?.colors).join('|');
    const curSub = stored?.subcategory ?? '';
    const curFit = declaredCatalogFit(stored?.fit);
    const curGender = existingGender(null, stored?.gender) ?? '';

    // Title inference alone, shown next to the merged result below.
    const newColors = inferColorsFromText(product.title, product.brand).join('|');
    const keyword = matchSubcategoryFromTitle(product.title, product.category);
    const newSub = inferSubcategory(product.title, product.category) ?? '';
    const subRule = keyword ? 'title_keyword' : newSub ? 'category_default' : 'unknown';
    const newFit = inferFitFromTitle(product.title);
    const gender = inferGenderDetail(product.title, product.product_url, product.category);

    // The shared merge: exactly what the backfill dry-run and --apply compute.
    const merged = computeCatalogEnrichment({ ...product, gender: null },
      { colors: stored?.colors, fit: stored?.fit ?? null, subcategory: stored?.subcategory ?? null, gender: stored?.gender ?? null });
    const mergedColors = merged.colors.join('|');
    const mergedSub = merged.subcategory ?? '';
    const mergedFit = merged.fit ?? '';
    const mergedGender = merged.gender ?? '';

    const changed = [[curColors, mergedColors], [curSub, mergedSub], [curFit, mergedFit], [curGender, mergedGender]]
      .some(([current, next]) => next !== current);
    const reviewText = merged.review.map(entry => `${entry.field}: ${entry.from} → ${entry.to}`).join('; ');
    if (merged.review.length > 0) {
      stats.review++;
      stats.reviewFields += merged.review.length;
      reviewLines.push(...merged.review.map(entry =>
        `| ${product.id} | ${product.title.replace(/\|/g, '/')} | ${entry.field}: ${entry.from} → ${entry.to} |`));
    }

    const unknown = [
      mergedColors === '' && 'renk',
      mergedSub === '' && 'alt_tur',
      garment && mergedFit === '' && 'kalip',
      mergedGender === '' && 'gender',
    ].filter(Boolean) as string[];

    const missing = merged.eligibilityMissing;
    if (merged.feedEligible) {
      eligibleCount++;
      const sides = mergedGender === 'unisex' ? ['unisex', 'kadin', 'erkek'] : [mergedGender];
      for (const side of sides) bump(bySide[side], product.category);
    } else {
      missing.forEach(field => bump(reasons, field));
      bump(ineligibleByProvider, product.provider);
      bump(ineligibleByBrand, product.brand ?? '(marka yok)');
    }

    const vocabulary = vocabularyFor(product.category, mergedSub);
    stats.changed += Number(changed);
    stats.unknownColor += Number(mergedColors === '');
    stats.unknownSubcategory += Number(mergedSub === '');
    stats.unknownFit += Number(garment && mergedFit === '');
    stats.unknownGender += Number(mergedGender === '');
    stats.anyUnknown += Number(unknown.length > 0);
    stats.vocabulary += Number(vocabulary !== undefined);

    lines.push([
      product.id, product.title, product.provider, product.category,
      curColors, curSub, curFit, curGender,
      newColors, newSub, newFit, gender.gender,
      `sub:${subRule};gender:${gender.rule}${gender.key ? `(${gender.key})` : ''}`, gender.confidence,
      mergedColors, mergedSub, mergedFit, mergedGender,
      changed ? 'evet' : 'hayir', reviewText ? 'evet' : 'hayir', reviewText, unknown.join('|') || 'yok',
      vocabulary?.formality ?? '', vocabulary?.family ?? '', vocabulary?.season ?? '',
      merged.feedEligible ? 'evet' : 'hayir', missing.join(','),
    ].map(csvCell).join(','));
  }

  const header = ['id', 'baslik', 'kaynak', 'kategori',
    'mevcut_renk', 'mevcut_alt_tur', 'mevcut_kalip', 'mevcut_gender',
    'cikarilan_renk', 'cikarilan_alt_tur', 'cikarilan_kalip', 'cikarilan_gender',
    'kural', 'gender_guven',
    'birlesik_renk', 'birlesik_alt_tur', 'birlesik_kalip', 'birlesik_gender',
    'degisti_mi', 'incelenecek', 'incelenecek_degisiklik', 'belirsiz_alanlar',
    'sozluk_formalite(1-5)', 'sozluk_stil_ailesi', 'sozluk_sezon', 'feed_eligible', 'eksik_alan'];
  const counts = (map: Map<string, number>) => CATEGORY_ORDER.map(c => `${c} ${map.get(c) ?? 0}`).join(', ');
  const side = (name: string) => bySide[name].size ? [...bySide[name].values()].reduce((a, b) => a + b, 0) : 0;
  const low = (name: string) => CATEGORY_ORDER.filter(c => (bySide[name].get(c) ?? 0) < 100).join(', ') || 'yok';
  const summary = [
    '# Salt okunur önizleme: veritabanına YAZILMADI, skorlamaya BAĞLANMADI. Yeniden üretmek için: npx tsx scripts/previewCatalogEnrichment.ts',
    '# Birleştirme (lib/catalogEnrichment.ts): çıkarım bilinmiyor/boşsa MEVCUT değer korunur; çıkarım doluysa ve farklıysa çıkarılan değer geçer ve "incelenecek" olur. Dolu değer bilinmeyene çevrilmez.',
    `# Ürün: ${stats.total}. birlesik_* değeri mevcut değerden farklı olan ürün: ${stats.changed}. İncelenecek: ${stats.review} ürün (${stats.reviewFields} alan; liste catalog_enrichment_review.md).`,
    `# Birleştirmeden sonra hâlâ bilinmeyen (tüm ürünler üzerinden): renk ${stats.unknownColor}, alt tür ${stats.unknownSubcategory}, kalıp ${stats.unknownFit} (yalnız giyimde), gender ${stats.unknownGender}; en az bir alanı bilinmeyen ürün: ${stats.anyUnknown}.`,
    `# sozluk_* sütunları (formalite/stil ailesi/sezon) yalnız gösterim: birleşik alt türün lib/styleVocabulary.ts karşılığı; ${stats.vocabulary} üründe karşılık var, boşsa alt tür sözlükte yok (genel ayakkabi/canta/aksesuar/sapka) veya bilinmiyor.`,
    `# Feed uygunluğu (birleşik değerlerle; kategori, gender kadin/erkek/unisex, alt tür, renk, fiyat, görsel hepsi bilinmeli; kalıp isteğe bağlı): uygun ${eligibleCount}, elenen ${stats.total - eligibleCount}.`,
    `# Elenme nedeni (bir ürün birden çok alanda eksik olabilir): ${sorted(reasons) || 'yok'}. Kaynak: ${sorted(ineligibleByProvider) || 'yok'}. Marka (ilk 8): ${sorted(ineligibleByBrand).split(', ').slice(0, 8).join(', ') || 'yok'}.`,
    `# Uygun, kadın feed'i (kadin+unisex) ${side('kadin')}: ${counts(bySide.kadin)}. Erkek feed'i (erkek+unisex) ${side('erkek')}: ${counts(bySide.erkek)}. Yalnız unisex ${side('unisex')}: ${counts(bySide.unisex)}.`,
    `# 100'ün altındaki kategori — kadın: ${low('kadin')}; erkek: ${low('erkek')}.`,
    '# kural: sub:title_keyword|category_default|unknown; gender:<kural>(<anahtar>) (yalnız çıkarım). degisti_mi: birleşik değer mevcuttan farklıysa evet.',
  ];
  const queries = join(__dirname, 'queries');
  writeFileSync(join(queries, 'catalog_enrichment_preview.csv'), `﻿${[...summary, header.join(','), ...lines].join('\n')}\n`, 'utf8');
  writeFileSync(join(queries, 'catalog_enrichment_review.md'), [
    '# İncelenecek değişiklikler',
    '',
    `Dolu bir değer, başlıktan çıkarılan farklı bir değerle değişir (${stats.review} ürün, ${stats.reviewFields} alan). Salt okunur önizleme; veritabanına yazılmadı.`,
    '',
    '| id | başlık | alan: eski → yeni |',
    '| --- | --- | --- |',
    ...reviewLines,
    '',
  ].join('\n'), 'utf8');
  console.log(summary.slice(2, 9).join('\n'));
};

main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exit(1); });
