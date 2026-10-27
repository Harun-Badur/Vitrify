# Style Intelligence — mevcut durum

Ayrı bir Style Intelligence servisi yok. Canlı karar iki kural motorudur: Keşfet sırası `scoreCandidate`, kart kombinleri `catalogCompatibility`. `buildStyleContext` ve `evaluateCompatibility` testlerde durur, ekrandan çağrılmaz.

Son güncelleme: 2026-10-27

## Keşfet sırası

`rankCatalog` adayları niyetteki kategori ve cinsiyete göre süzer, `toScoringCandidate` ile puanlar, `rerankForDiversity` ile dizer. [kodda doğrulandı: src/intelligence/ranking/rankCatalog.ts, 12–41]

`toScoringCandidate` renk, alt tür, kalıp, marka slug’ı ve fiyat bandını üründen ya da `preparedProductAttributes` başlık çıkarımından alır. `style_tags` okunmaz. [kodda doğrulandı: src/intelligence/ranking/productCandidate.ts, 5–26]

Varsayılan ağırlıklar `lib/scoring.ts` 29–42: kategori 10, stil 8, renk 6, marka 5, kalıp 6, fiyat bandı 4, negatif 8, yenilik 3, tazelik 2, oturum 9, deneme alt türü 4, indirim 0. Stil karışımı beyan 0.35, davranış 0.65. Gürültü genliği 2.

`scoreCandidate` (367–478) özü:

- Uzun vadeli afinite: `colorW`, `fitW`, `subcategoryW` (alt tür veya kategori), `brandW`, `priceBandW`.
- Stil: etiket öncelikleri (`DEFAULT_STYLE_TAG_PRIORS`) ile davranış ortalamasının karışımı.
- Oturum: `buildIntent` ağırlıkları. Arama metni marka veya alt türde geçiyorsa oturum afinitesine +0.45.
- Tazelik 90 gün. Yenilik gösterim sayısından. Son denenen alt tür eşleşirse 1.
- Yumuşak negatif: aynı ürün 12 saat yarı ömür; yoksa renk/alt tür/kalıp/marka, ölçek 0.25.
- Toplam = ağırlıklı taban + oturum + tazelik + yenilik + deneme + indirim − negatif + günlük gürültü.

Trend modu `applyFeedMode` ile tazelik ve indirimi büyütür. Misafir bu fonksiyona girmez; `selectLocalFeed` kullanılır.

Eşikler `reasonsThresholds`: fiyat 0.2, renk 0.25, stil ve kategori 0.3, marka 0.35. [kodda doğrulandı: lib/scoring.ts, 112–120]

## Profil ve olaylar

`user_style_profiles` ağırlık haritaları ve `negative_preferences` tutar. Okuma `fetchStyleProfileSnapshot`. [kodda doğrulandı: lib/recsConfig.ts]

`sync_declared_style_tags` yalnız `style_tag_weights` günceller. [kodda doğrulandı: supabase/recs_v1_p1.sql] Çağrı `profileService.syncDeclaredStyleTags`.

`recompute_profile` son 1000 olayı, `product_attributes` ile birleştirir. Olay ağırlığının mutlak değeri 0.5’in altındaysa döngüye girmez. Varsayılanlar: impression 0.05, like 1, dolap_add 1.2, share 1.5, try_on_start 1.5, try_on_success 2, store_click 3, pass −0.8, dolap_remove −1. [kodda doğrulandı: supabase/recs_v1.sql, 103–114 ve 492–511]

Gösterim profil ağırlığına girmez; yalnız `noveltyScore` için sayılır. Arama ve filtre olayları profil anlığını düşürmez. [kodda doğrulandı: lib/analytics.ts, invalidate koşulu]

V2 (`EXPO_PUBLIC_PREFERENCE_V2_ENABLED`) istemcide `preferenceTransactionAdapter` ve `style_apply_preference_v2` yolunu seçer. SQL önerisi `reports/backend/proposals/` altındadır. Canlı kurulum bu paket yazılırken yeniden okunmadı. [doğrulanamadı] Özet: [rapora dayanıyor: reports/release/VITRIFY_V1_STYLE_INTELLIGENCE_INTEGRATION.md]

## Kombin motoru

`getDiscoverRecommendations` filtre ve cinsiyet uyumundan sonra `generateOutfitCandidates`, `rankOutfitCandidates` veya çeşitlilik yolu, sonra `selectDiverseComplements` çağırır. [kodda doğrulandı: src/intelligence/recommendations/getDiscoverRecommendations.ts, 53–68]

`catalogCompatibility` (`src/intelligence/outfits/catalogCompatibility.ts` 14–50): renk 0 / 0.5 / 1 ağırlık 0.30; aynı marka (Kabin sayılmaz) 0.10; aynı kalıp 0.10; aynı stil sınıfı 0.15; fiyat skora 0. Üst sınır 0.65. Stil sınıfı yalnız jean, tişört, polo, hoodie, sweatshirt, sneaker, şort → casual; blazer, gömlek → tailored. Diğer alt türler 0 stil puanı alır ve elenmez.

`selectRecommendationPool` en fazla 80 ürün, isteğe bağlı rolde en fazla 4 koltuk, sağlayıcı sırası. Profil, renk ve cinsiyet havuzu seçmez. [kodda doğrulandı: src/intelligence/recommendations/selectRecommendationPool.ts, 3–12]

`selectDiverseComplements` en fazla 3 parça seçer. Aday kalmazsa döngü erken biter; hiç kombin yoksa `null`. Bu, “kalitesizse gösterme” eşiği değildir: en iyi aday marjın içindeyse düşük mutlak skor da seçilebilir. [kodda doğrulandı: src/intelligence/recommendations/selectDiverseComplements.ts, 15–31 ve 76–88]

## Bağlı olmayan modüller

| Modül | Dosya | Canlı çağrı | Test |
|---|---|---|---|
| `buildUserSnapshot` | `src/intelligence/user/userSnapshot.ts` | `app/` ve `services/` altında yok | `userSnapshot.test.ts` |
| `buildStyleContext` | `src/intelligence/style/styleContext.ts` | Yok; yalnız kapı modülü import eder | `styleContext.test.ts` |
| `buildProductIntelligence` | `src/intelligence/product/productIntelligence.ts` | Keşfet sırasına girmez | `productIntelligence.test.ts` |
| `evaluateCompatibility` | `src/intelligence/compatibility/compatibilityGate.ts` | Üretim importu yok | `compatibilityGate.test.ts` |

Test, kapının üretim dosyalarınca import edilmemesini kilitler. [kodda doğrulandı: __tests__/compatibilityGate.test.ts]

## Bağlantı matrisi

| Veri | Karar | Durum |
|---|---|---|
| `style_tag_weights` | Keşfet stil afinitesi ve “Minimal stiline yakın” | Girer |
| `colorW` `fitW` `subcategoryW` `brandW` `priceBandW` | Keşfet puanı ve chip | Girer |
| Geçilen ürün kimliği | Desteden eleme ve yumuşak negatif | Girer |
| Oturum beğenisi ve arama | Sonraki istekteki `buildIntent` | Girer |
| Beyan edilen marka, renk, bütçe (`studio_preferences`) | Puan | Girmez |
| Beden / boy / kilo | Puan | Girmez |
| Dolap öğeleri | Keşfet kombin girdisi | Girmez; ekran `[]` verir |
| Kaydedilen kombinler | Sonraki öneri | Girmez |
| `dolap_add` katalog kimliği | Nitelik satırı varsa profil | Dolaylı |
| `dolap_add` dolap UUID’si | Renk öğrenmesi | Nitelik satırı beklenmez |
| `dolap_remove` | Profil | Olay tipi var, `track('dolap_remove')` yok |
| Gösterim | Yenilik puanı | Girer; profil ağırlığına girmez |

## Insight chip

Bileşen ayrı bir `InsightChip` değildir. `SwipeCard` `product.reason` doluysa Sparkles (lucide) ve tek satır metin çizer. [kodda doğrulandı: components/SwipeCard.tsx, 630 ve 750–756]

Metin UI’da üretilmez. `types/product.ts` 82: `reason`, `recs-feed` `reasons[0]`; yoksa chip yok. Atama `productService.ts` 492: `metadata.reasons[0]`. `buildReasons` en fazla iki etiket üretir (`MAX_REASONS = 2`) ama karta yalnız ilki yazılır. [kodda doğrulandı: lib/reasons.ts, 9 ve 56–137]

“Fiyat aralığına uygun” kesinleşmesi:

- Bileşen: ayrı chip yok. `SwipeCard` `product.reason` doluysa Sparkles ve tek satır çizer. Metni `buildReasons` üretir; karta `metadata.reasons[0]` yazılır. [kodda doğrulandı: components/SwipeCard.tsx, 750–756; services/productService.ts, 492; lib/reasons.ts, 100–107]
- Alan: `profile.priceBandW` içinde adayın `priceBand` anahtarı. `price_fit`, `lookupWeight(profile.priceBandW, candidate.priceBand)` sonucudur. [kodda doğrulandı: lib/scoring.ts, 383 ve 489]
- Eşik: `reasonsThresholds.price_match`, varsayılan 0.2. Koşul `price_fit >= price_match` ve bu bant ağırlığı `> 0`. `min_score_for_sana_uygun` (0.55) bu etiketi açmaz. [kodda doğrulandı: lib/scoring.ts, 112–120; lib/reasons.ts, 100–102]
- Olay sayısı: `recompute_profile` son 1000 olayı, mutlak ağırlığı en az 0.5 olanları, `price_band` anahtarına toplar. Harita olay sayısı değil normalize ağırlık tutar. Bu etiketin kaç olaydan öğrenildiği saklanmaz. [doğrulanamadı: bant başına olay sayısı] [kodda doğrulandı: supabase/recs_v1.sql, 337–360 ve 492–511]

Metin stüdyo bütçesini okumaz. “Bütçene uygun” gibi okunabilir; kaynak öğrenilmiş bant afinitesidir.

Diğer hazır metinler: “Sevdiğin renk: …”, “Sevdiğin marka”, “Bu kategoriyi sık beğeniyorsun”, “Minimal stiline yakın” (yalnız en güçlü etiket `minimal` ise), keşif yuvasında “Yeni bir şey dene”. Dolap cümleleri, “son 30 günün en düşük fiyatı” ve “beğendiğin minimal parçalara benziyor” bu fonksiyonda yok. [doğrulanamadı] olarak değil: bu metinler `buildReasons` içinde bulunamadı.

Katkı eşiğin altındaysa o etiket toplanmaz. Hiçbiri kalmazsa `reason` boştur ve chip çizilmez.

## Oturum niyeti

`lib/sessionIntent.ts` `buildIntent` üretir. Beğeni, geçme, dolaba ekleme, deneme ve mağaza tıklaması oturum ağırlığına yazılır. Geçmenin oturum ağırlığı 0’dır; asıl etkisi kalıcı negatif ve kimlik elemesidir. Arama `setSessionQuery` ile bir sonraki sıralamada +0.45 verir. Bu bellek, süreç ölünce gider. `user_style_profiles` bir sonraki oturumda kalır. [kodda doğrulandı: lib/sessionIntent.ts; lib/scoring.ts, 400–420]

## Neden iki “stil” var

Sıralamadaki stil, etiket önceliği ve renk/kalıp/kategori ortalamasıdır. Kombin stili, alt türden `casual` veya `tailored` sınıfıdır. Aynı gömlek destede “minimal” görünüp kombin skorunda “tailored” olabilir. Bu bir hata değil, iki sözlüktür. Karar 5 bunları birleştirmeyi ister. Birleşme yok.

## Öğrenme döngüsü, dar hali

Beğeni veya güçlü olay `user_events` olur. `ingest_events` `recompute_profile` çağırır. Ağırlıklar `product_attributes` satırından renk, alt tür, marka, kalıp ve fiyat bandına dağılır. Nitelik satırı yoksa bu alanlara eklenecek kaynak yoktur. Dolap fotoğrafının kimliği katalog kimliği değildir. [kodda doğrulandı: supabase/recs_v1.sql, 492–511]

Profil önbelleği düşünce bir sonraki `fetchStyleProfileSnapshot` yeni satırı okur. O an ekrandaki 20 kartın sırası değişmez. `feedPreparationRevision` yalnız yeni sayfa kabulünde artar. [kodda doğrulandı: store/discoverySlice.ts]

## Chip’in okuduğu veri

| Etiket | Okunan alan | Okumadığı alan |
|---|---|---|
| Fiyat aralığına uygun | `priceBandW`, `candidate.priceBand`, `price_fit` | `studio_preferences.priceRange` |
| Sevdiğin renk | `colorW`, aday renkleri | dolap rengi |
| Sevdiğin marka | `brandW` | beyan edilen favori marka listesi |
| Bu kategoriyi sık beğeniyorsun | `subcategoryW` | dolap kategori sayımı |
| Minimal stiline yakın | `styleTagWeights` içinde kazanan `minimal` | diğer etiket adları bu dalda yazılmaz |
| Yeni bir şey dene | slot `exploration` veya `discovery`, gösterim veya düşük uzun vade | dolap |

`min_score_for_sana_uygun` eşik nesnesinde 0.55 durur. `buildReasons` bu sabiti chip koşulu olarak kullanmıyor. [kodda doğrulandı: lib/scoring.ts, 120; lib/reasons.ts içinde bu isim yok] Kullanım yeri bu pakette ayrıca taranmadı. [doğrulanamadı: başka bir “sana uygun” rozeti]

## `dolap_add` puanı ne öğrenir

Ağırlık 1.2’dir. `recompute_profile` olayı `product_attributes.product_id` ile birleştirir. Katalog kimliği nitelik satırı bulursa renk, alt tür, marka, kalıp ve fiyat bandına dağılır. Dolap fotoğraf UUID’si bu tabloda yoktur; olay yazılır, nitelik katkısı beklenmez.

Üç yazıcı:

| Kaynak | Kimlik | `source` | Puan için anlamı |
|---|---|---|---|
| `wardrobeSlice` | dolap öğesi | `wardrobe` | Nitelik satırı yoksa harita büyümez |
| `favoritesSlice` | katalog ürünü | `feed` | Aynı anda `like` de yazılır |
| `VirtualTryOnModal` | katalog ürünü | `tryon` | Beğeni tablosuna gider, `WardrobeItem` oluşturmaz |

[kodda doğrulandı: store/wardrobeSlice.ts, 333; store/favoritesSlice.ts, 114–115; components/VirtualTryOnModal.tsx, 705–710]

`analyzePreferenceEvents` bu çifti tek tercih sayar ve favori kökenini sahiplik saymaz. `app/` ve `services/` onu import etmez. Canlı `scoreCandidate` bu analizi okumaz. [kodda doğrulandı: src/intelligence/evidence/sharedEvidence.ts, 227–231]
