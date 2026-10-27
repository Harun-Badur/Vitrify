# Test ve kalite

Test komutu Jest’tir. Birçok suit saf fonksiyon veya sahte Supabase kullanır. Üç feed sayfalama testi Edge yolunu doğrulayamaz. Bu paket yazılırken tüm suit çalıştırılmadı.

Son güncelleme: 2026-10-27

## Komutlar

`package.json`: `npm test` → `jest`. Ayrı bir `tsc` script’i yok. Tarihsel komut: `npx tsc --noEmit` veya `node node_modules/typescript/bin/tsc --noEmit`.

A1 odaklı Jest, 4b raporundaki desen: `accountDeletion|accountStorage|a1Phase`. Örnek: `npx jest --testPathPattern "accountDeletion|accountStorage|a1Phase"`. [rapora dayanıyor: reports/backend/a1-phase4b-report-20261012.md]

Deno, Edge için `deno check`. 4b raporu Edge girişini yerel JSR önbelleği yüzünden BLOCKED yazdı. Bu oturumda Deno çalıştırılmadı. [doğrulanamadı]

## Harita

| Alan | Dosya örnekleri | Veri |
|---|---|---|
| Puan | `__tests__/scoring.test.ts`, `diversity.test.ts` | Saf fonksiyon |
| Sıra hazırlığı | `rankingPreparation.test.ts`, `recommendationCorePriority.test.ts` | Fikstür |
| Kapı ve metadata | `catalogEligibility.test.ts`, `catalogMetadataRegression.test.ts` | Saf fonksiyon |
| Kombin | `discoverRecommendations.test.ts`, `outfitSelection.test.ts` | Motor dolabı kabul eder; ekranın `[]` verdiği kilitli değildir |
| Önbellek | `recommendationCacheFingerprint.test.ts`, `discoverCacheErrors.test.ts`, `discoverRecommendationCacheService.test.ts` | Bellek / sahte istemci |
| Profil | `studioPreferences.test.ts`, `styleIntelligenceIntegration.test.ts`, `userSnapshot.test.ts`, `styleContext.test.ts` | Son ikisi canlı yola bağlı değil |
| Dolap | `wardrobeV2Store.test.ts`, `wardrobeWriteGuard.test.ts`, `cutoutV2*.test.ts` | Sahte depolama |
| A1 | `a1Phase*.test.ts`, `accountDeletion*.test.ts` | Çoğunlukla fake RPC |
| Edge sözleşmesi | `recsFeedEdge.test.ts` | Sahte HTTP |
| Sayfalama | `feedPagination.test.ts` | Sahte katalog. Üç test kırık |

Gerçek Supabase veya canlı Edge bu paketin test listesinde yoktur. Staging duman raporları tarihli ve çoğu NOT RUN veya BLOCKED’dur.

## Kırık feedPagination testleri

2026-10-27 yeniden çalıştırıldı. Filtre üç testi seçti. Üçü FAIL, diğerleri skipped. Düzeltme yapılmadı.

- Satır 254: `getRecsFeedUrl()` `null`. Test `jest.replaceProperty` ile `EXPO_PUBLIC_RECS_FEED_URL` koyar.
- Satır 280: beklenen ters Edge sırası gelmez; yerel sıra gelir.
- Satır 298: `source` `edge` değil `supabase`.

Neden: `babel-preset-expo` test ortamında `process.env.EXPO_PUBLIC_*` okumasını `expo/virtual/env` nesnesine bağlar. Bu nesne ilk `process.env` kimliğidir. `replaceProperty` sonraki nesneyi değiştirir. `jest.setup.ts` `.env` yüklemez. Edge fonksiyonu bu değişkeni hiç okumaz. [kodda doğrulandı: node_modules/babel-preset-expo/build/plugins/inline-env-vars.js; node_modules/expo/virtual/env.js; supabase/functions/recs-feed/index.ts, 330–331]

## tsc

2026-10-27, bu ağaçta bir kez: `npx tsc --noEmit --pretty false --incremental false`. Çıkış kodu 0. `error TS` satırı 0. npm’in `devdir` uyarısı dışında tanı yok.

Tarihsel **ÇELİŞKİ**:

- A1 4b, 2026-10-12: 63 hata / 19 dosya, yeni hata yok. [rapora dayanıyor: reports/backend/a1-phase4b-report-20261012.md]
- Aynı gün TypeScript çalışma 3: sandbox junction’ı 56 tanıyı şişiriyor; doğru erişimde kalan 1 tanı `scrollPose` modülünün yokluğu (`__tests__/scrollPose.test.ts`). [rapora dayanıyor: reports/backend/typescript-work3-report-20261012.md]
- 2026-10-14 performans raporu ilgili dosyalarda 0 tanı / exit 0 der. Tüm ağaç mıdır, yazılmamış. [rapora dayanıyor: reports/release/VITRIFY_V1_DISCOVER_CATALOG_PERFORMANCE.md]

63 ile 1 aynı komutun farklı çalışma koşullarıdır. 14 Ekim 0’ı bir alt kümedir. 2026-10-27 tam ağaç koşusu 0 tanıdır. Eski üç sayı bugünün sonucu değildir.

## Baseline borcu

4b genel Jest: 102 suite PASS / 15 FAIL, 1027 test PASS / 39 FAIL. Bu sayı 2026-10-12’dir. [rapora dayanıyor: a1-phase4b raporu]

2026-10-27 tam suit, bir kez: `npx jest --ci --watchAll=false --forceExit`. Süre 62.6 sn. Çıkış kodu 1. Suit 188 PASS / 19 FAIL / 207. Test 1757 PASS / 49 FAIL / 1806. Anlık görüntü 0.

FAIL suitler: `discoverRecommendationCache`, `appStoreDomains`, `accountStorageUpgradeContract`, `outfitCover`, `discoverFeedErrors`, `discoverBackendConsistency`, `wardrobeScreen`, `cardPhysics`, `createOutfitScreen`, `recommendationCacheWorker`, `boundedRecommendationCandidates`, `feedPagination`, `discoverRecommendationCacheService`, `stagingCatalogTransfer`, `wardrobeCutoutCard`, `styleSheets`, `discoverRankingPreparationWiring`, `accountDeletionSafetyRegression`, `a1Phase2Runtime`.

Son dört suit yüklenirken düştü (`Platform.select` veya `expo-crypto`). Diğerleri assertion FAIL’idir. Ayrım bu koşunun çıktısındandır. Düzeltme yapılmadı.

## Testin kanıtlamadığı davranışlar

- Keşfet’in dolabı `[]` vermesi. Motor testleri dolap geçebilir; ekran bağını kilitleyen bir assertion bu taramada bulunmadı. [doğrulanamadı: tek bir test adı]
- Beyan edilen bütçenin puana girmemesi. `scoring.test.ts` fiyat bandı ağırlığını test eder. `studio_preferences.priceRange` için “puana girmez” kilidi aranmadı. [doğrulanamadı]
- Profil kaydından sonra açık destenin eski kalması.
- `dolap_remove` hiç yazılmaması.
- Üç feedPagination testinin Edge sözleşmesini doğrulaması. Bugün doğrulamazlar.

## Sahte ile gerçek

`discoverRecommendationCacheService.test.ts` Supabase istemcisini mock’lar. Cache miss’te yerel motor üç tamamlayıcı yayınlar. Bu, canlı `recs-feed` gecikmesi değildir. [kodda doğrulandı: __tests__/discoverRecommendationCacheService.test.ts, jest.mock supabase]

`recsFeedEdge.test.ts` HTTP’yi sahteeler. Canlı fonksiyon gövdesi eşittir demez.

A1 testleri fake RPC ve statik SQL metni okur. 4b raporu “PostgreSQL yarışı NOT RUN” der. Fake PASS, staging PASS değildir.

## İlgili ek testler

| Soru | Dosya | Ne kilitler |
|---|---|---|
| Favori `like` + `dolap_add` | `__tests__/favoritesConsistency.test.ts` | İki olayın sırası |
| Dolap fotoğrafı olayı | `__tests__/wardrobeActionAnalytics.test.ts` | `source: 'wardrobe'` |
| Çift olay tek tercih | `__tests__/preferenceActionEvidence.test.ts` | Sahiplik sayılmaması |
| Kapı importu | `__tests__/compatibilityGate.test.ts` | Üretim importu yok |

Bunlar ekranın dolabı `[]` verdiğini kilitlemez. Motor testi dolap dolu bir girdiyle geçebilir. Üretim bağını görmek için `app/(tabs)/index.tsx` 276–279 okunur.

## Üç kırık test nasıl okunur

`npx jest __tests__/feedPagination.test.ts` 2026-10-27’de üç FAIL verdi. Beklenen: `getRecsFeedUrl()` dolu, Edge sırası ters, `source` `edge`. Gelen: URL `null`, yerel sıra, `source` `supabase`.

Onarım, `recs-feed` formülünü değiştirmek değildir. Test, `process.env` atamasından sonra `expo/virtual/env` nesnesini görmüyor. Ürün kodu Edge adresini `getRecsFeedUrl` ile okur. Edge’in kendisi `EXPO_PUBLIC_RECS_FEED_URL` okumaz. [kodda doğrulandı: supabase/functions/recs-feed/index.ts, 330–331]

Yeşil test, yayındaki fonksiyonun sağlıklı olduğu anlamına gelmez. Yalnız istemcinin sahte HTTP’ye gittiğini gösterir. Canlı gecikme ve JWT ayrı bir duman ister. Bu oturumda o duman yok. [doğrulanamadı]

2026-10-12 sayıları (102 suite PASS / 15 FAIL) bugünün ağacı değildir. Bugünkü sayılar yukarıdaki 2026-10-27 koşusudur. Yeni FAIL eklememek, bu 19 suit’i sessizce yeşile çekmek değildir. `11`.

A1 deseni ayrı koşulur: `npx jest --testPathPattern "accountDeletion|accountStorage|a1Phase"`. Bu komut bu oturumda çalıştırılmadı. 4b raporundaki PASS, o günün fake testidir. [rapora dayanıyor: reports/backend/a1-phase4b-report-20261012.md] Deno bu oturumda yok. [doğrulanamadı]

`npx tsc --noEmit` 2026-10-27’de 0 tanı verdi. 63 ve 1, 12 Ekim’in iki çalışma koşuludur; 14 Ekim 0’ı bir alt kümedir. **ÇELİŞKİ** o tarihli raporlar arasındadır. Bugünkü tam ağaç 0’dır.

Kapı testleri `catalogEligibility.test.ts` içindedir ve saf fonksiyondur. Canlı 349 sayısını doğrulamaz. Kombin testleri dolap dolu girdi kabul edebilir. Ekranın `[]` verdiği assertion bu pakette bulunmadı. [doğrulanamadı: tek test adı]

`npm test` tüm Jest ağacını çalıştırır. Bu paket sırasında yalnız `feedPagination` üçlüsü yeniden koştu. Sonuç: üç FAIL. Düzeltme yok.
