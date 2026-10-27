# Performans ve önbellek

Kısa ömürlü bellek önbellekleri katalog sayfasını ve profil anlığını tutar. Kalıcı öneri önbelleği kombin finalidir ve profil sürümünü anahtara koymaz. Cihaz üstünde ilk açılış süresi ölçülmemiştir.

Son güncelleme: 2026-10-27

## Katmanlar

| Katman | Süre / kural | Ne düşürür | Neyi düşürmez |
|---|---|---|---|
| Katalog sayfası `catalogPages` | 60 sn, en fazla 12 anahtar | Supabase istemci kimliği değişince | Profil kaydı |
| Hazır ürün satırı | 60 sn, en fazla 400 | Aynı | Profil kaydı |
| 80’lik havuz | 60 sn, istemciye bağlı | İstemci değişimi | Dolap düzenleme |
| `kabin.recs.profile.v1.{userId}` | Bellek + AsyncStorage; V2 okuyucu raporda 30 sn | `invalidateStyleProfileSnapshot` | Açık deste |
| `kabin.recs.config.v1` | Konfigürasyon | Süre dolunca | — |
| `RecommendationMemoryCache` | LRU, tür başına kapasite | Oturum `stop` / dispose | Profil kaydı tek başına |
| `discover_recommendation_cache` | `kind=final`, motor sürümü, `updated_at` son 7 gün | Retention purge | Profil veya dolap değişimi |
| Edge `configCache` | Fonksiyon belleğinde yaklaşık 5 dk | Süreç yeniden başlayınca | — |
| Okuma zaman aşımı | 1,2 sn | Kesilince yerel motor | — |

[kodda doğrulandı: services/productService.ts katalog sabitleri; src/recommendationCache/retention.ts; services/discoverRecommendationCacheService.ts, 23 ve 32–56; src/recommendationCache/fingerprint.ts, 58–74]

Anahtar: sıralama parmak izi katalog ürünleri, dolap, çapa ve bağlamdan üretilir, SHA-256 alınır. Stil profili bu parmak izinde yoktur. Keşfet dolabı `[]` verdiği için dolap düzenlemesi parmak izini değiştirmez.

Önbellekteki final, katalog kimliği silinmişse `resolveProducts` `Recommendation product not found` fırlatır. [kodda doğrulandı: services/discoverRecommendationCacheService.ts, 71–78]

2026-10-27 silme raporunda önbellek 272’den 2’ye indi; iki gövde zaman aşımı yüzünden okunamadı. Aynı gün sonraki işlem son ranking satırını sildi ve sayım 0 görüldü. Güncel tablo [doğrulanamadı]. [rapora dayanıyor: reports/catalog-live-audit-2026-10-27/remaining-120-delete-result.json]

## Prefetch

Keşfet, deste başarılı olunca `loadDiscoverRecommendationPacket` başlatır. İşbirlikçi dilim `src/intelligence/cooperativeWork.ts` içindedir. Varsayılan bütçe B0 raporunda 4 ms diye geçer. [rapora dayanıyor: reports/b0-baseline-2026-10-08.md] Odak değişince hazırlık iptal edilir. Kaydırma `feedPreparationRevision` artırmaz; yalnız kabul edilen sayfa artırır. [kodda doğrulandı: store/discoverySlice.ts]

## Ölçümler

Host, 2026-10-14: 496 ürün fikstüründe yedi seri sayfa beklemesinin alt sınırı 350 ms; iki paralel sayfa ile sahte saat ≤210 ms. Bu cihaz ölçümü değildir. [rapora dayanıyor: reports/release/VITRIFY_V1_DISCOVER_CATALOG_PERFORMANCE.md]

Aynı rapor: Android ilk içerik, üç tamamlayıcının görünmesi, gerçek Edge p95, bellek **NOT VERIFIED**.

Host, 2026-10-09 Phase 6.4: aynı makinede (Node, i5-1135G7) takım elbise yolu için ısınma + 5×30 replay. Sayılar o raporun tablosundadır. Cihaz değildir. [rapora dayanıyor: reports/phase6.4-suit-performance-2026-10-09/report.md]

B0, 2026-10-08: 30 çapa offline replay, dolap boş, kullanıcı tadı yok. Cihaz baseline’ı değildir. [rapora dayanıyor: reports/b0-baseline-2026-10-08.md]

## Bilinen davranış

- Edge yoksa veya `null` dönerse yerel sıra sessizce devreye girer. `FeedServiceError` ise deste hata durumuna düşer. [kodda doğrulandı: services/productService.ts, fetchFeedProducts]
- Profil kaydı ağırlık önbelleğini düşürür, `loadFeed` çağırmaz. Kullanıcı desteyi yenileyene kadar eski sıra görünebilir.
- Eski final önbellek, parmak izi hâlâ tutuyorsa eski kombin gösterebilir. Anahtar bugünkü boş dolap ve 80’lik havuza bağlıdır.
- Edge `products` okumasında açık `.range()` olmadığı 2026-10-14 raporunda yazılıdır. Satır limiti aşılırsa büyüyen katalog eksik kalabilir. [rapora dayanıyor: aynı performans raporu] Güncel Edge gövdesi bu cümle için yeniden diff’lenmedi; kaynakta sayfalama yoksa risk durur. [doğrulanamadı: yayındaki satır limiti]

## Geçersiz kılma özeti

| Olay | Profil anlığı | Açık deste | Kombin bellek oturumu | DB final önbellek |
|---|---|---|---|---|
| Stil etiketi kaydı | Düşer | Kalır | Kalır | Kalır |
| Beğeni / geçme olayı ingest | Düşer | Kalır | Kalır | Kalır |
| Yalnız gösterim, arama, filtre | Düşmez | Filtre ve arama `loadFeed` çağırır | Sayfa artarsa pencere genişler | Kalır |
| Dolap ekleme | `dolap_add` ingest olursa düşer | Kalır | `[]` olduğu için parmak izi değişmez | Kalır |
| Çıkış `resetSession` | Oturum biter | Deste sıfırlanır | Kaynak durur | Satır silinmez |

[kodda doğrulandı: lib/analytics.ts; app/(tabs)/index.tsx, 276–279; store/profileSlice.ts, resetSession]

Eski final satırı, yedi günden eskiyse okunmaz. `recommendationCacheCutoff` malzeme zamanıdır, son okuma değildir. [kodda doğrulandı: src/recommendationCache/retention.ts]

## Tekrarlanan hesap

Renk çıkarımı katalog hazırlığında bir kez, skor adayında nitelik yoksa yine `preparedProductAttributes` ile yapılır. WeakMap aynı ürün nesnesinde sonucu tutar. Yeni nesne olursa çıkarım tekrarlanır. Bu kasıtlıdır; ikinci bir model değildir. [kodda doğrulandı: src/intelligence/style/productStyle.ts, 43–55; src/intelligence/ranking/productCandidate.ts, 6–18]

Kombin uyumu `recommendationMemoValue` ile aynı çift için tekrar hesaplanmaz. Bellek, süreç içidir. [kodda doğrulandı: src/intelligence/outfits/catalogCompatibility.ts, 33–35]

## Parmak izine giren ve girmeyen

`createRankingCacheKey` şunları kanonikleştirir: şema sürümü, motor sürümü, katalog sürümü, katalog ürün parmak izi, dolap parmak izi, çapa kimliği, çapa parmak izi, bağlam (dolap, `firstOnly`, katalog filtreleri). [kodda doğrulandı: src/recommendationCache/fingerprint.ts, 58–74]

Girmeyenler: `user_style_profiles`, `style_tag_weights`, `priceBandW`, beyan edilen bütçe, açık destedeki beğeni. Final anahtar bunlara ek olarak exposure parmak izi taşır. [kodda doğrulandı: aynı dosya, 77–84]

Sonuç: kullanıcı stil etiketini kaydedince kombin önbelleği kaçmaz. Keşfet dolabı `[]` olduğu için dolaba fotoğraf eklemek de kaçırmaz. Eski final, yedi günden yeniyse ve parmak izi tutuyorsa okunur.

## Host ile cihaz

2026-10-14 sayıları Node üzerinde sahte saattir. Üç tamamlayıcının telefonda görünme süresi yazılmamıştır. P0, release derlemesinde cihaz ölçümü ister. Host ≤210 ms, cihazın aynı sürede bittiği anlamına gelmez. [rapora dayanıyor: reports/release/VITRIFY_V1_DISCOVER_CATALOG_PERFORMANCE.md]

B0 30 çapa replay’i de hosttur. Dolap boş ve kullanıcı tadı yoktur. [rapora dayanıyor: reports/b0-baseline-2026-10-08.md] Bu, “dolap bağlanırsa kaç ms” sorusunun cevabı değildir. Dolap dizisi bugün boş olduğu için o maliyet ölçülmemiştir. [doğrulanamadı: dolaplı kombin süresi]

## Sabitler

| Sabit | Değer | Dosya |
|---|---|---|
| `CATALOG_CACHE_MS` | 60 sn | `services/productService.ts`, 183 |
| Katalog sayfa anahtarı üst sınırı | 12 | aynı dosya, 238 |
| 80’lik havuz belleği | 60 sn | aynı dosya, 407 |
| `CACHE_READ_TIMEOUT_MS` | 1,2 sn | `services/discoverRecommendationCacheService.ts`, 23 |
| `RECOMMENDATION_CACHE_MAX_AGE_MS` | 7 gün | `src/recommendationCache/retention.ts`, 1 |
| Dilim bütçesi varsayılanı | 4 ms | `src/intelligence/cooperativeWork.ts`, 80 |

4 ms, Jest veya sahte saat ölçümü değildir. Uzun kombin aramasını kareler arasında bölmek içindir. Cihazda bir karenin kaç dilim aldığı ölçülmedi. [doğrulanamadı: cihaz kare süresi]

Canlı okuyucu `kind=final` satırını, yaş `RECOMMENDATION_CACHE_MAX_AGE_MS` içindeyse alır. Ranking türü bu okuyucunun türü değildir. Eski ranking satırı bu yüzden destede görünmeden durabilir. [kodda doğrulandı: src/recommendationCache/retention.ts; src/recommendationCache/fingerprint.ts, 50–55]

Profil anlığı `kabin.recs.profile.v1.` önekini kullanır. Önek biçimidir; örnek kullanıcı yoktur. Düşürmek açık 20 kartı yeniden sıralamaz. [kodda doğrulandı: lib/recsConfig.ts, 26]

Katalog sayfa önbelleği ve profil anlığı aynı saatte dolmaz. Biri 60 saniyedir. Diğeri `invalidateStyleProfileSnapshot` ile düşer. İkisi de kombin final satırını silmez.
