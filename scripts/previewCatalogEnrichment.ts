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

const CATEGORY_ORDER = ['upper_body', 'lower_body', 'dresses', 'shoes', 'bags', 'accessories', 'hats'];
const FEED_GENDERS = ['kadin', 'erkek', 'unisex'];
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

  const stats = { total: products.length, changed: 0, filled: 0, overwritten: 0, unknownColor: 0, unknownSubcategory: 0,
    unknownFit: 0, unknownGender: 0, anyUnknown: 0, vocabulary: 0 };
  const lines: string[] = [];
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

    // Feed rule: category, gender, subtype, color, price and image must ALL be known; fit is optional.
    const price = Number(product.current_price ?? product.price);
    const missing = [
      !CATEGORY_ORDER.includes(product.category) && 'kategori',
      !FEED_GENDERS.includes(gender.gender) && 'gender',
      newSub === '' && 'alt_tur',
      newColors === '' && 'renk',
      !(price > 0) && 'fiyat',
      !product.image_url?.trim() && 'gorsel',
    ].filter(Boolean) as string[];
    const eligible = missing.length === 0;
    if (eligible) {
      eligibleCount++;
      const sides = gender.gender === 'unisex' ? ['unisex', 'kadin', 'erkek'] : [gender.gender];
      for (const side of sides) bump(bySide[side], product.category);
    } else {
      missing.forEach(field => bump(reasons, field));
      bump(ineligibleByProvider, product.provider);
      bump(ineligibleByBrand, product.brand ?? '(marka yok)');
    }

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
      eligible ? 'evet' : 'hayir', missing.join(','),
    ].map(csvCell).join(','));
  }

  const header = ['id', 'baslik', 'kaynak', 'kategori',
    'mevcut_renk', 'mevcut_alt_tur', 'mevcut_kalip', 'mevcut_gender',
    'cikarilan_renk', 'cikarilan_alt_tur', 'cikarilan_kalip', 'cikarilan_gender',
    'kural', 'gender_guven', 'degisti_mi', 'belirsiz_alanlar',
    'sozluk_formalite(1-5)', 'sozluk_stil_ailesi', 'sozluk_sezon', 'feed_eligible', 'eksik_alan'];
  const counts = (map: Map<string, number>) => CATEGORY_ORDER.map(c => `${c} ${map.get(c) ?? 0}`).join(', ');
  const side = (name: string) => bySide[name].size ? [...bySide[name].values()].reduce((a, b) => a + b, 0) : 0;
  const low = (name: string) => CATEGORY_ORDER.filter(c => (bySide[name].get(c) ?? 0) < 100).join(', ') || 'yok';
  const summary = [
    '# Salt okunur önizleme: veritabanına YAZILMADI, skorlamaya BAĞLANMADI. Yeniden üretmek için: npx tsx scripts/previewCatalogEnrichment.ts',
    `# Ürün: ${stats.total}. Değeri değişecek: ${stats.changed} (yalnız boş alan dolar: ${stats.filled}; dolu bir değer değişir: ${stats.overwritten}).`,
    `# Hâlâ bilinmeyen (tüm ürünler üzerinden): renk ${stats.unknownColor}, alt tür ${stats.unknownSubcategory}, kalıp ${stats.unknownFit} (yalnız giyimde), gender ${stats.unknownGender}; en az bir alanı bilinmeyen ürün: ${stats.anyUnknown}.`,
    `# sozluk_* sütunları (formalite/stil ailesi/sezon) yalnız gösterim: çıkarılan alt türün lib/styleVocabulary.ts karşılığı; ${stats.vocabulary} üründe karşılık var, boşsa alt tür sözlükte yok (genel ayakkabi/canta/aksesuar/sapka) veya bilinmiyor.`,
    `# Feed uygunluğu (kategori, gender kadin/erkek/unisex, alt tür, renk, fiyat, görsel hepsi bilinmeli; kalıp isteğe bağlı): uygun ${eligibleCount}, elenen ${stats.total - eligibleCount}.`,
    `# Elenme nedeni (bir ürün birden çok alanda eksik olabilir): ${sorted(reasons) || 'yok'}. Kaynak: ${sorted(ineligibleByProvider) || 'yok'}. Marka (ilk 8): ${sorted(ineligibleByBrand).split(', ').slice(0, 8).join(', ') || 'yok'}.`,
    `# Uygun, kadın feed'i (kadin+unisex) ${side('kadin')}: ${counts(bySide.kadin)}. Erkek feed'i (erkek+unisex) ${side('erkek')}: ${counts(bySide.erkek)}. Yalnız unisex ${side('unisex')}: ${counts(bySide.unisex)}.`,
    `# 100'ün altındaki kategori — kadın: ${low('kadin')}; erkek: ${low('erkek')}.`,
    '# kural: sub:title_keyword|category_default|unknown; gender:<kural>(<anahtar>). degisti_mi: çıkarım boş olmayıp mevcut değerden farklıysa evet.',
  ];
  const out = join(__dirname, 'queries', 'catalog_enrichment_preview.csv');
  writeFileSync(out, `﻿${[...summary, header.join(','), ...lines].join('\n')}\n`, 'utf8');
  console.log(summary.slice(1, 8).join('\n'));
};

main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exit(1); });
