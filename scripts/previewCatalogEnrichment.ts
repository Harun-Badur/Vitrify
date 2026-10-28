/**
 * READ-ONLY preview: compares stored product_attributes with the current title rules
 * and writes scripts/queries/catalog_enrichment_preview.csv. Uses anon PostgREST GET
 * only; nothing is written to the database and nothing is wired into scoring.
 *
 * Run: npx tsx scripts/previewCatalogEnrichment.ts
 */
import { config as loadEnv } from 'dotenv';
import { writeFileSync } from 'fs';
import { join } from 'path';
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
const GENDER_FROM_DB: Record<string, string> = { women: 'kadin', men: 'erkek', unisex: 'unisex' };

interface ProductRow { id: string; provider: string; title: string; brand: string | null; category: string; product_url: string | null }
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

const csvCell = (value: unknown): string => {
  const text = String(value ?? '');
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

const vocabularyFor = (category: string, slug: string | undefined) =>
  SUBTYPES[category as GarmentCategory]?.find(item => item.slug === slug);

const main = async () => {
  const products = await fetchAll<ProductRow>('products', 'id,provider,title,brand,category,product_url', 'id');
  const attributes = new Map((await fetchAll<AttributeRow>('product_attributes', 'product_id,gender,colors,fit,subcategory', 'product_id'))
    .map(row => [row.product_id, row]));

  const stats = { total: products.length, changed: 0, filled: 0, overwritten: 0, unknownColor: 0, unknownSubcategory: 0,
    unknownFit: 0, unknownGender: 0, anyUnknown: 0, vocabulary: 0 };
  const lines: string[] = [];

  for (const product of products) {
    const stored = attributes.get(product.id);
    const garment = GARMENT_CATEGORIES.includes(product.category);
    const curColors = cleanDeclaredCatalogColors(product.id, stored?.colors).join('|');
    const curSub = stored?.subcategory ?? '';
    const curFit = declaredCatalogFit(stored?.fit);
    const curGender = GENDER_FROM_DB[stored?.gender ?? ''] ?? '';

    const newColors = inferColorsFromText(product.title, product.brand).join('|');
    const keyword = matchSubcategoryFromTitle(product.title, product.category);
    const newSub = inferSubcategory(product.title, product.category) ?? '';
    const subRule = keyword ? 'title_keyword' : newSub ? 'category_default' : 'unknown';
    const newFit = inferFitFromTitle(product.title);
    const gender = inferGenderDetail(product.title, product.product_url, product.category);

    const diffs = [
      [curColors, newColors], [curSub, newSub], [curFit, newFit],
      [curGender, gender.gender === 'bilinmiyor' ? '' : gender.gender],
    ].filter(([current, next]) => next !== '' && next !== current);
    const changed = diffs.length > 0;
    const overwrites = diffs.some(([current]) => current !== '');

    const unknown = [
      newColors === '' && 'renk',
      newSub === '' && 'alt_tur',
      garment && newFit === '' && 'kalip',
      gender.gender === 'bilinmiyor' && 'gender',
    ].filter(Boolean) as string[];

    const vocabulary = vocabularyFor(product.category, newSub);
    stats.changed += Number(changed);
    stats.overwritten += Number(overwrites);
    stats.filled += Number(changed && !overwrites);
    stats.unknownColor += Number(newColors === '');
    stats.unknownSubcategory += Number(newSub === '');
    stats.unknownFit += Number(garment && newFit === '');
    stats.unknownGender += Number(gender.gender === 'bilinmiyor');
    stats.anyUnknown += Number(unknown.length > 0);
    stats.vocabulary += Number(vocabulary !== undefined);

    lines.push([
      product.id, product.title, product.provider, product.category,
      curColors, curSub, curFit, curGender,
      newColors, newSub, newFit, gender.gender,
      `sub:${subRule};gender:${gender.rule}${gender.key ? `(${gender.key})` : ''}`, gender.confidence,
      changed ? 'evet' : 'hayir', unknown.join('|') || 'yok',
      vocabulary?.formality ?? '', vocabulary?.family ?? '', vocabulary?.season ?? '',
    ].map(csvCell).join(','));
  }

  const header = ['id', 'baslik', 'kaynak', 'kategori',
    'mevcut_renk', 'mevcut_alt_tur', 'mevcut_kalip', 'mevcut_gender',
    'cikarilan_renk', 'cikarilan_alt_tur', 'cikarilan_kalip', 'cikarilan_gender',
    'kural', 'gender_guven', 'degisti_mi', 'belirsiz_alanlar',
    'sozluk_formalite(1-5)', 'sozluk_stil_ailesi', 'sozluk_sezon'];
  const summary = [
    '# Salt okunur önizleme: veritabanına YAZILMADI, skorlamaya BAĞLANMADI. Yeniden üretmek için: npx tsx scripts/previewCatalogEnrichment.ts',
    `# Ürün: ${stats.total}. Değeri değişecek: ${stats.changed} (yalnız boş alan dolar: ${stats.filled}; dolu bir değer değişir: ${stats.overwritten}).`,
    `# Hâlâ bilinmeyen (tüm ürünler üzerinden): renk ${stats.unknownColor}, alt tür ${stats.unknownSubcategory}, kalıp ${stats.unknownFit} (yalnız giyimde), gender ${stats.unknownGender}; en az bir alanı bilinmeyen ürün: ${stats.anyUnknown}.`,
    `# sozluk_* sütunları (formalite/stil ailesi/sezon) yalnız gösterim: çıkarılan alt türün lib/styleVocabulary.ts karşılığı; ${stats.vocabulary} üründe karşılık var, boşsa alt tür sözlükte yok (genel ayakkabi/canta/aksesuar/sapka) veya bilinmiyor.`,
    '# kural: sub:title_keyword|category_default|unknown; gender:<kural>(<anahtar>). degisti_mi: çıkarım boş olmayıp mevcut değerden farklıysa evet.',
  ];
  const out = join(__dirname, 'queries', 'catalog_enrichment_preview.csv');
  writeFileSync(out, `﻿${[...summary, header.join(','), ...lines].join('\n')}\n`, 'utf8');
  console.log(summary.slice(1, 4).join('\n'));
};

main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exit(1); });
