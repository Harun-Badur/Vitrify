# Dolap ve kombin

Dolap, kullanıcının fotoğrafıdır. Katalog ürünü değildir. Keşfet kombin motoru dolap öğesi kabul edebilir; üretim ekranı bu diziyi boş bırakır. Kaydedilen kombin sonraki öneriye girmez.

Son güncelleme: 2026-10-27

## Veri modeli

İstemci `WardrobeItem` (`types/wardrobe.ts` 8–27): `id`, `title`, `imageUrl`, kesim alanları, `category`, `brand`, `createdAt`. Renk, alt tür ve `style_tags` yok.

`SavedOutfit`: `wardrobeItemIds`, `catalogProductIds`, isteğe bağlı kapak. [kodda doğrulandı: types/wardrobe.ts]

Kombin adayı `sourceType: 'wardrobe' | 'catalog'` ayırır. [kodda doğrulandı: src/intelligence/outfits/outfitCandidate.ts]

## Ekleme

`app/wardrobe/add.tsx` başlık, marka, kategori ve fotoğraf alır. `wardrobeSlice.addWardrobeItem` fotoğrafı `storeWardrobePhoto` ile cihaza yazar, öğeyi `cutoutStatus: 'pending'` koyar, `saveWardrobe` çağırır. Başarılı senkron sonrası `track('dolap_add', id, { source: 'wardrobe' })`. [kodda doğrulandı: store/wardrobeSlice.ts, addWardrobeItem ve 329–334]

Renk veya stil çıkarımı bu akışta yok. Kesim görüntü işler: cihaz (Android geliştirme), `EXPO_PUBLIC_WARDROBE_CUTOUT_URL`, veya Edge `wardrobe-cutout-control`. Kovalar: `wardrobe-cutouts`. `model-photos` deneme mankenidir, dolap parçası değildir. [kodda doğrulandı: services/wardrobeCutoutService.ts; services/profileService.ts]

`removeWardrobeItem` öğeyi listeden siler. `track('dolap_remove')` çağrısı yoktur. Olay tipi `types/analytics.ts` içindedir; SQL ağırlığı −1’dir. **ÇELİŞKİ:** ağırlık tanımlı, yazıcı yok.

## Senkron ve tablolar

Cihaz: AsyncStorage `vitrify.wardrobe.v1.{owner}` ve senkron günlüğü. Bulut alanları başlık, görsel yolu, kategori, marka; kombin için kimlik listeleri. Renk taşınmaz. [kodda doğrulandı: services/wardrobeCloudPersistence.ts, 67–70]

2026-10-10 raporu tabloların canlıda olmadığını söyler. [rapora dayanıyor: reports/backend/backend-open-issues-2026-10-10.md, madde 4]

2026-10-13 kurulum raporu, `supabase/deferred/20260924_wardrobe_outfits_v1.sql` ve bulut kalıcılık SQL’inin ana projeye işlendiğini ve `wardrobe_items`, `outfits`, `outfit_items` metadata’sının doğrulandığını söyler. **ÇELİŞKİ:** 10 Ekim “yok”, 13 Ekim “kuruldu”. 13 Ekim raporu daha sonraki iştir. Bu paket yazılırken şema yeniden okunmadı. [rapora dayanıyor: reports/release/VITRIFY_V1_WARDROBE_PRODUCTION_INSTALL_REPORT.md] [doğrulanamadı: güncel canlı şema]

Ertelenmiş SQL öğede `subcategory`, `color`, `secondary_colors`, `style_tags` kolonlarını tanımlar. İstemci tipi bu kolonları doldurmaz. Tablo kurulu olsa bile uygulama bu nitelikleri yazmaz. [kodda doğrulandı: supabase/deferred/20260924_wardrobe_outfits_v1.sql; types/wardrobe.ts]

## Keşfet neden dolabı görmez

```276:279:app/(tabs)/index.tsx
  // Discover complements are catalog-only; wardrobe loading and edits cannot
  // delay preparation or invalidate its ranking/prefetch session.
  const recommendationSession = useMemo(() => new DiscoverRecommendationCache(recommendationCatalog,
    [], userId), [recommendationCatalog, userId]);
```

İkinci argüman dolap dizisidir ve sabittir `[]`. Yorum, dolap yüklemesinin hazırlığı geciktirmemesi içindir. Motor `input.wardrobeItems` kullanır. [kodda doğrulandı: src/intelligence/recommendations/getDiscoverRecommendations.ts, 44–48]

`upper_body` dolap öğesi alt türsüzse `resolveWardrobeRole` `null` döner ve adaydan düşer. Elle kombin kurucu `upper_body` için `subcategory: 'top'` enjekte eder. [kodda doğrulandı: src/intelligence/outfits/outfitCandidate.ts, 72–79; lib/outfitSelection.ts]

## Kayıtlı kombin

`createOutfit` seçimi `savedOutfits` listesine ekler ve `saveWardrobe` ile yazar. `getDiscoverRecommendations` `savedOutfits` okumaz. Kombinler profil yolculuğu ve kanıt sayımında görünür. [kodda doğrulandı: store/wardrobeSlice.ts, createOutfit; lib/profileStyleJourney.ts]

Store’da `removeOutfit` bulunamadı. Silme yolu [doğrulanamadı] olarak eksik sayılmalı; ekranda başka bir silme varsa bu paket onu görmedi.

## Kombin sırası

`rankOutfitCandidates` sırası: geçerli roller, çekirdek tam mı, eksik çekirdek, ayakkabı, isteğe bağlı parça sayısı, paylaşılan stil etiketi sayısı, `compatibilityScore`, paylaşılan renk, anlamsal anahtar. [kodda doğrulandı: src/intelligence/outfits/rankOutfitCandidates.ts, sort anahtarı dosyanın üst bölümü]

`evaluateOutfitCandidate` yalnız adayın üstündeki metadata’yı okur. Başlıktan renk üretmez. Dolap öğesinde renk ve stil etiketi olmadığı için paylaşılan renk ve etiket sayısı dolap parçası eklenirse de çoğu zaman 0 kalır. [kodda doğrulandı: src/intelligence/outfits/outfitRanking.ts, 145–166]

Çeşitlilik yolu `rankDiversityCandidatesAsync` en iyi uyumun 0.12 altına düşen adayları aramadan çıkarır. Aynı marj `selectDiverseComplements` içindedir. [kodda doğrulandı: src/intelligence/recommendations/selectDiverseComplements.ts, 15]

## Kesim ve deneme ne değildir

Cutout ve `tryOnGarment` (`services/vtonService.ts`) görüntü üretir. `scoreCandidate` veya `catalogCompatibility` çağırmazlar. Deneme başarısı analitik olay olarak `try_on_success` ise profil ağırlığına girebilir. Olayın her denemede yazıldığı bu dosyada satır satır izlenmedi. [doğrulanamadı: her denemenin ingest’e ulaştığı]

## Kullanıcı verisi ile katalog

`wardrobeProduct` dolap öğesini kart gibi göstermek için fiyatı sıfırlar ve favori durumu taşımaz. [kodda doğrulandı: types/wardrobe.ts, wardrobeProduct] Beğeni tablosu katalog kimliği tutar. Dolap satırı beğeni satırı değildir. Ertelenmiş `outfit_items` bir satırda ya dolap ya katalog kaynağı ister, ikisini birden değil. [kodda doğrulandı: supabase/deferred/20260924_wardrobe_outfits_v1.sql]

## Kesim durumları

`cutoutStatus` istemcide `pending`, `ready`, `error`, `blocked` olabilir. Renk alanı yoktur. [kodda doğrulandı: types/wardrobe.ts, 20] Kesim PNG üretir. Baskın renk önermez. Karar 6’daki “kullanıcı rengi onaylar” adımı yazılmamıştır. `09`.

## Aynı olay adı, üç yazıcı

| Yazıcı | Ne ekler | Olay |
|---|---|---|
| `addWardrobeItem` | Cihaz fotoğrafı, sonra senkron | `dolap_add`, `source: 'wardrobe'`, öğe kimliği |
| Favori | `liked_products` | `like` ve `dolap_add`, `source: 'feed'`, katalog kimliği |
| Deneme “Dolabına eklendi” | yine `insertLikedProduct` | `dolap_add`, `source: 'tryon'` |

[kodda doğrulandı: store/wardrobeSlice.ts, 333; store/favoritesSlice.ts, 112–118; components/VirtualTryOnModal.tsx, 705–710]

Kullanıcıya “dolap” denen yer ile `WardrobeItem` listesi bu yüzden ayrılır. Keşfet kombin girdisi yalnız `WardrobeItem` dizisidir ve ekran onu `[]` yapar. Beğenilen gömlek, dolap fotoğrafı olmadığı için o diziye girmez.

## Kayıtlı kombin neden öneri olmaz

`savedOutfits` cihaz ve, tablo kurulduysa, `outfits` / `outfit_items` tarafında durabilir. `getDiscoverRecommendations` bu listeyi parametre almaz. Seçim her seferinde çapa + havuz + boş dolaptan yeniden üretilir. Kullanıcının kaydettiği “bu üç parça” bir sonraki kartta tercih edilmez. [kodda doğrulandı: src/intelligence/recommendations/getDiscoverRecommendations.ts, 53–68]

`profileStyleJourney` kayıtlı kombin sayısını profil metninde kullanabilir. Bu, sıralama ağırlığı değildir. [kodda doğrulandı: lib/profileStyleJourney.ts]

## Cihaz anahtarları

Dolap listesi `vitrify.wardrobe.v1.{owner}` altındadır. Senkron günlüğü `vitrify.wardrobe.sync.v1.{owner}`. [kodda doğrulandı: services/wardrobeCloudPersistence.ts, 61–62] Buluta giden alanlar renk taşımaz. Kesim dosyası `wardrobe-cutouts` kovasına gider. `model-photos` deneme mankenidir.

Öğeyi silmek listeyi ve senkronu günceller. `dolap_remove` olayı yazılmaz. Profildeki eski `dolap_add` katkısı, nitelik satırı hiç oluşmamışsa zaten haritaya girmemiş olabilir. Katalog kimliğiyle yazılmış `dolap_add` (favori veya deneme) silinmez; o kimlik `liked_products` satırıdır. İki silme birbirinin yerine geçmez.

`createOutfit` öneri motorunu çağırmaz. Kayıt, seçilen kimlik listesini saklar. Bir sonraki Keşfet kartı bu listeyi okumaz. [kodda doğrulandı: store/wardrobeSlice.ts, createOutfit; src/intelligence/recommendations/getDiscoverRecommendations.ts]

## Öğede olmayan alanlar

`WardrobeItem` alanları: `id`, `title`, `imageUrl`, yerel ve bulut görsel yolları, kesim URL’si ve durumu, `category`, `brand`, `createdAt`. Renk, alt tür, stil etiketi, fiyat ve cinsiyet yoktur. [kodda doğrulandı: types/wardrobe.ts, 8–27]

Kesim yolu biçimi `validWardrobeOriginalPath` ile denetlenir: sahip, öğe kimliği, `original-….png`. Bu bir kullanıcı kimliği örneği değildir. [kodda doğrulandı: types/wardrobe.ts, 29–33] Onay kaydı `WardrobeItemConfirmation` sahip ve bulut öğe kimliğini taşır. Renk onayı taşımaz.
