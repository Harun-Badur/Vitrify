# Katalog ve veri kalitesi

Aktif aday, depolanmış bir bayrakla değil türetilmiş bir kapıyla seçilir. Renk yoksa ürün havuza girmez. Boş stil etiketi eleme nedeni değildir. Canlı sayılar tarihli raporlardır; bu dosya yazılırken veritabanı yeniden sayılmadı.

Son güncelleme: 2026-10-27

## Şema ve kimlik

Kök `supabase/schema_products.sql` `products` tablosunu tanımlar: `id`, `provider`, `external_id`, başlık, marka, fiyat, `currency`, `image_url`, `product_url`, `category`, `affiliate_url`, `garment_description`, zaman damgaları. Birincil anahtar `(provider, external_id)`. `id` üzerinde tekil indeks vardır.

Bu dosyanın CHECK’i sağlayıcıyı `amazon`, `trendyol`, `hepsiburada`, `mock` ve kategoriyi `upper_body`, `lower_body`, `dresses` ile sınırlar. Uygulama `FEED_PROVIDERS` içine `boyner`, `mavi`, `lcw`, `defacto`, `flo` ekler. Kategoriler `shoes`, `bags`, `hats`, `accessories` de içerir. [kodda doğrulandı: types/product.ts, 1–37]

Açık iş: kök `schema_products.sql` CHECK’i dardır. Yeni ortam bu dosyadan kurulursa güncel sağlayıcı/kategoriler reddedilir; baseline migration ile çözülecek. 2026-10-14 sayımı LCW, FLO, Boyner, Mavi ve ayakkabı/çanta/şapka/aksesuar görür; açık iş raporu genişlemenin sonraki migration’da olduğunu söyler. [rapora dayanıyor: reports/backend/backend-open-issues-2026-10-10.md, madde 7; reports/release/VITRIFY_V1_DISCOVER_CATALOG_PERFORMANCE.md]

Kimlik biçimi pratikte `sağlayıcı-dışKimlik` (`trendyol-1167784650`). Kapı `externalId` alanının dolu olmasını ister; biçimi kendisi üretmez. [kodda doğrulandı: lib/catalogEligibility.ts, 181]

`product_attributes` renk, cinsiyet, kalıp, alt tür, marka slug’ı, fiyat bandı, `outfit_role`, `style_tags` taşır. Tüketim: sıralama renk/alt tür/kalıp/marka/fiyat bandı; kombin rol ve renk slug’ı. `style_tags` sıralama adayında okunmaz.

## Uygunluk kapısı

`evaluateCatalogEligibility` (`lib/catalogEligibility.ts` 170–188) şunlar boşsa `incomplete` der: `id`, `title`, http görsel, giysi kategorisi, feed sağlayıcısı, ürün URL’si, dış kimlik, kullanılabilir renk. `styleSignal` bilgi amaçlıdır; `null` olması eksiklik değildir.

Renk: kayıtlı nitelik temizlenince doluysa o, değilse `resolveCatalogAppearance` → `inferProductAttributes`. [kodda doğrulandı: src/intelligence/style/productStyle.ts, 57–68]

Kapı `productService` sayfa eşlemesinde ve `recs-feed` skor öncesinde çalışır. `productsById` kapı uygulamaz; beğeni ve geçmiş kimlikle çözülür.

## Başlıktan çıkarım

`inferProductAttributes` (`lib/productAttributes.ts` 313–330): küratör başlık sözlüğü, sonra başlık ve markadan renk, cinsiyet, kalıp, alt tür, fiyat bandı, marka slug’ı. Bu bir model değildir. Aynı fonksiyon katalog hazırlığında ve skor adayında kullanılır. Kombin sıralaması metinden çıkarım yapmaz. [kodda doğrulandı: src/intelligence/outfits/outfitRanking.ts, 145]

## Kapsam boşlukları

| Alan | Durum |
|---|---|
| Renk | Kapı için zorunlu. 2026-10-14’te attribute rengi 362 üründe eksik, `products.colors` 489 üründe boş. Başlık kurtarabilir. |
| Alt tür | Skor ve casual/tailored için kullanılır. Eşlenmeyen alt tür elenmez, stil puanı 0 kalır. |
| Stil etiketi | 2026-10-14’te 496 ürünün tamamında boş. Sıralama bunu okumaz. |
| Sezon / occasion | Okuma listesinde `season` ve `occasion` kolonları vardır. Kolon yoksa sorgu düşer. `scoreCandidate` bu alanları okumaz. Canlı kolonun dolu olup olmadığı [doğrulanamadı]. [kodda doğrulandı: services/productRepository.ts, 87–89] |
| Cinsiyet | 2026-10-14’te 138 üründe attribute cinsiyeti eksik. Başlık çıkarımı doldurabilir. |

Takım elbise tek role sığmıyor. Phase 6.4 bir ürünü takım olarak doğruladı ve rolü değiştirmedi; sözlükte set rolü yok. [rapora dayanıyor: reports/phase6.4-suit-performance-2026-10-09/report.md]

## Sayılar

| Tarih | Kaynak | Ürün |
|---|---|---|
| 2026-10-08 | B0 manifest | 278 satırlık offline anlık görüntü. Canlı katalog değildir. [rapora dayanıyor: reports/b0-baseline-2026-10-08.md] |
| 2026-10-14 | Canlı salt okuma | 496 ürün, 496 attribute. [rapora dayanıyor: reports/release/VITRIFY_V1_DISCOVER_CATALOG_PERFORMANCE.md] |
| 2026-10-27 | Silme sonucu | Önce 469, 120 renksiz ürün silindikten sonra 349 ürün ve 349 attribute. Daha önce 27 renksiz ürün silinmişti; 147 = 27 + 120. [rapora dayanıyor: reports/catalog-live-audit-2026-10-27/remaining-120-delete-result.json] |

Aynı gün sonraki işlem, okunamayan ranking önbellek satırını sildi. O anda tablo sayımı 0 ve ürün 349 görüldü. Bu paket yazılırken canlı yeniden sayılmadı. Güncel sayı [doğrulanamadı].

Silinen kimlikler yerel içe aktarma JSON/TSV kaynaklarından da çıkarıldı. Jest fikstürü `recommendation-catalog.snapshot.json` tarihsel kimlik taşıyabilir; o dosya içe aktarıcı değildir. Kapı türetilmiş olduğu için renksiz satır yeniden içe aktarılsa da havuza girmez. Rengi olan satır girer.

## İçe aktarma

`package.json` script’leri: `import:feed` → `scripts/importFeed.ts`, `seed:catalog` → `scripts/seedRealCatalog.ts`, `seed:attributes` → `scripts/seed-attributes.ts`, `seed:expansion` → `scripts/seedExpansionFromLinks.ts`. Bunlar elle çalışır. Açılışta katalog kendi kendine içeri alınmaz. [kodda doğrulandı: package.json, scripts]

`scripts/prepareV1Catalog.ts` `reports/catalog-expansion-v1/candidates.json` okur. Bu, canlı tablonun kendisi değildir. 2026-10-27 temizliği hedef kimlikleri bu aday dosyalarından da çıkardı. [rapora dayanıyor: reports/catalog-live-audit-2026-10-27/remaining-120-delete-result.json, localEdits]

## Tekrar ve geçersiz satır

Kapı, aynı eksik satırın yeniden gelmesini havuzda tutmaz. Veritabanında satır yine durabilir; `productsById` onu kimlikle bulur. Beğeni FK’si olmadığı için silinen ürünün beğeni satırı kalabilir. 2026-10-27 silmesi, hedef kimliklerin beğeni ve geçme satırlarını tek tek sildi. Genel bir “yetim beğeniyi temizle” işi değildir. [kodda doğrulandı: supabase/schema.sql, liked_products FK yok]

Aynı görsel URL’sinin iki üründe olması 2026-10-14 sayımında galeri tekrarı 0 diye geçti. Kimlik tekrarı `(provider, external_id)` birincil anahtarıyla engellenir. Kök şema ile sonraki migration’ın aynı anahtarı koruyup korumadığı bu yazımda tüm migration’lar diff’lenmedi. [doğrulanamadı: her migration’ın PK’si]

## 2026-10-14 dağılım

Ürün 496. Kategori: upper_body 185, lower_body 95, shoes 74, accessories 48, bags 40, dresses 37, hats 17. Sağlayıcı: LCW 129, Trendyol 105, DeFacto 102, FLO 90, Boyner 27, Hepsiburada 25, Mavi 18. Rol: top 124, bottom 95, shoes 74, outerwear 61, accessory 48, bag 40, one_piece 37, hat 17. Stil etiketi boş 496. Bu, 27 Ekim silmesinden öncedir. 349’lük kümenin kategori dağılımı raporlanmadı. [rapora dayanıyor: reports/release/VITRIFY_V1_DISCOVER_CATALOG_PERFORMANCE.md] [doğrulanamadı: 349’ün kategori kırılımı]

## Kapının baktığı alanlar

`evaluateCatalogEligibility` eksik saydığı alanlar: `id`, `title`, http görsel, giysi kategorisi, feed sağlayıcısı, ürün URL’si, dış kimlik, kullanılabilir renk. `styleSignal` sonuçta durur; `null` ise `incomplete` olmaz. [kodda doğrulandı: lib/catalogEligibility.ts, 170–188]

`isActiveCatalogRecord` yalnız `status === 'eligible'` bakar. `productsById` bu fonksiyonu çağırmaz. Beğenilen veya önbellekteki kimlik, renk sonradan bozulmuş olsa da kimlikle çözülür. Havuz ve `recs-feed` skor öncesi kapıyı kullanır.

## 27 Ekim silmesinin kapsamı

Önce 27 renksiz ve referansı olmayan ürün silindi (496 → 469). Sonra kalan 120 renksiz ürün, tam kimlik listesiyle silindi. Sonuç dosyası: ürün 349, attribute 349, önbellek 2 (iki gövde okunamadı). Aynı işlemde hedef kimliklerin ilişki satırları da silindi: `style_preference_actions` 258, `user_events` 504, beğenilen 15, geçilen 205, önbellek satırı 270. [rapora dayanıyor: reports/catalog-live-audit-2026-10-27/remaining-120-delete-result.json]

Bu, tüm yetim beğenileri temizleyen bir iş değildir. Yalnız o 120 kimliğin satırlarıdır. Aynı gün daha sonra son ranking önbellek satırı ayrıca silindi ve önbellek sayımı 0 görüldü. Ürün sayısı o anda 349’du. Güncel sayım [doğrulanamadı].

Silinen kimlikler yerel içe aktarma kaynaklarından da çıkarıldı. Jest anlık görüntüsü içe aktarıcı değildir. Kapı türetilmiş olduğu için renksiz satır yeniden gelse de havuza girmez.

## Kapının bakmadığı alanlar

Fiyat, cinsiyet, `style_tags`, `season` ve `occasion` eksik diye ürün `incomplete` olmaz. Renk, başlıktan `inferProductAttributes` ile kurtarılabilirse kapı geçer. Kurtarılamazsa havuza girmez. `productsById` aynı ürünü kimlik istendiyse yine döndürebilir; aday havuzu ile kimlik çözümü aynı filtre değildir. [kodda doğrulandı: lib/catalogEligibility.ts, 170–188; services/productRepository.ts, 114–150]

`material` de semantik kolon listesindedir. Skor formülünde malzeme terimi yoktur. [kodda doğrulandı: services/productRepository.ts, 88; lib/scoring.ts içinde material yok]

Kimlik çözümü ürün satırından ayrıca `current_price`, `previous_price`, `last_price_checked_at`, `colors` ve `sizes` ister. `images` kolonu yoksa sorgu o kolonsuz tekrarlanır. Bu alanlar kapı listesinde değildir. “Son 30 günün en düşük fiyatı” etiketi bu kolonlardan üretilmez. [kodda doğrulandı: services/productRepository.ts, 121–125; lib/reasons.ts içinde bu cümle yok]

Uygulama sağlayıcıları: amazon, trendyol, hepsiburada, mock, boyner, mavi, lcw, defacto, flo. Giysi kategorileri: upper_body, lower_body, dresses, shoes, bags, hats, accessories. [kodda doğrulandı: types/product.ts, 1–37] Kök SQL CHECK’i bu listenin ilk dört sağlayıcısı ve ilk üç kategorisiyle sınırlıdır. Yeni ortam bu dosyadan kurulursa güncel sağlayıcı/kategoriler reddedilir; baseline migration ile çözülecek.

2026-10-14 dağılımı bu geniş listeyi görür. 27 Ekim silmesi renksiz satırları çıkardı. Kalan 349’ün sağlayıcı kırılımı raporlanmadı. [doğrulanamadı: 349 sağlayıcı kırılımı] Stil etiketi boşluğu 14 Ekim sayımının tamamıydı. Kapı bunu eleme nedeni yapmaz. Bugünkü boş etiket oranı yeniden sayılmadı. [doğrulanamadı]

Başlık çıkarımı bir model değildir. Aynı `inferProductAttributes` katalog hazırlığında ve skor adayında kullanılır. Kombin sıralaması başlıktan renk üretmez. [kodda doğrulandı: lib/productAttributes.ts, 313–330; src/intelligence/outfits/outfitRanking.ts, 145]

Boş stil etiketi eksiklik değildir. Eşlenmeyen alt tür de elenmez. Stil puanı 0 kalır. [kodda doğrulandı: lib/catalogEligibility.ts, 184–188; src/intelligence/outfits/catalogCompatibility.ts, 25–27]

`styleSignal` kapı sonucunda bilgi olarak durur. `null` olması `incomplete` yapmaz. [kodda doğrulandı: lib/catalogEligibility.ts, 184–188]
