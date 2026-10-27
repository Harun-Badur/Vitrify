# Sözlük

Vitrify kodunda ve raporlarında geçen terimler. Her tanım, 2026-10-27 ağacındaki kullanıma göredir. Hedeflenip yazılmamış terimler ayrıca işaretlenir.

Son güncelleme: 2026-10-27

**Anchor / çapa.** Kombin motorunun zorunlu katalog ürünü. Keşfet kartındaki ana parçadır. `requiredCatalogProductId`. [kodda doğrulandı: src/intelligence/recommendations/getDiscoverRecommendations.ts]

**B0.** 2026-10-08 tarihli offline hesaplama bazı. 30 çapa, boş dolap, kullanıcı tadı yok. Cihaz veya canlı katalog baseline’ı değildir. [rapora dayanıyor: reports/b0-baseline-2026-10-08.md]

**B1.** Ayrı bir donmuş protokol dosyası bu taramada bulunamadı. B0 raporu “B0-frozen-production-replay-v1” kullanır. B1’in resmi tanımı [doğrulanamadı].

**Complement.** Çapanın yanına seçilen tamamlayıcı parça. `selectDiverseComplements` en fazla üç tane seçer. [kodda doğrulandı: src/intelligence/recommendations/selectDiverseComplements.ts]

**Gate / kapı.** `evaluateCatalogEligibility`. Zorunlu alan veya kullanılabilir renk yoksa ürün aktif havuza girmez. [kodda doğrulandı: lib/catalogEligibility.ts]

**Abstain.** Kaliteli kombin yoksa parça göstermeme kararı. Kodda `selectDiverseComplements` `null` dönebilir; ayrı bir kalite eşiği fonksiyonu yoktur. Hedef `09` karar 4. **ÇELİŞKİ:** karar ile marj tabanlı seçim.

**Fence.** Hesap silinirken yeni Storage yazısını kesen işaret. Yükleme, yazmadan önce ve sonra fence görürse nesneyi siler. [kodda doğrulandı: AGENTS.md I3–I4]

**Drain.** Fence’ten sonra uçuştaki yazının bitmesi için beklenen süre. Faz 4b bunu veritabanı saatine bağlar. [rapora dayanıyor: reports/backend/a1-phase4b-report-20261012.md]

**Sweep.** Silinen kullanıcının Storage ön ekini listeleyip nesneleri kaldırma. SQL satırı silmek dosyayı silmez. [kodda doğrulandı: AGENTS.md, Supabase gerçekleri]

**Janitor.** Sahipsiz veya silinmekte olan `{user_id}/` nesnelerini temizlemesi hedeflenen günlük iş. Faz 5’te zamanlama BLOCKED. [rapora dayanıyor: reports/backend/a1-phase5-stop-report-20261012.md]

**StyleContext.** Ürün, kullanıcı anlığı ve oturumdan üretilen açıklanabilir bağlam. `buildStyleContext`. Canlı Keşfet bunu çağırmaz. [kodda doğrulandı: src/intelligence/style/styleContext.ts]

**UserSnapshot.** Beyan ve davranışın ayrıldığı kullanıcı anlığı. `buildUserSnapshot`. Canlı sıra bunu okumaz; `StyleProfileSnapshot` okunur. [kodda doğrulandı: src/intelligence/user/userSnapshot.ts; types/recommendation.ts]

**ProductIntelligence.** Ürün sinyalinin kaynak ve çelişkiyle paketlenmesi. `buildProductIntelligence`. Skor adayı bunu kullanmaz. [kodda doğrulandı: src/intelligence/product/productIntelligence.ts]

**StyleProfileSnapshot.** `user_style_profiles` satırının istemci tipi: renk, alt tür, marka, kalıp, fiyat bandı, negatifler, stil etiket ağırlıkları. Sıralamanın okuduğu profil budur. [kodda doğrulandı: lib/scoring.ts, scoreCandidate]

**JEV.** Ürün sahibinin çevrimdışı SemanticJudgment sağlayıcısı olarak seçtiği TypeSafe AI modeli. Repoda çağrı yok. [doğrulanamadı] Hedef `09` karar 8.

**Insight chip.** Kart üstündeki tek satırlık neden. Kod adı `reason`. `SwipeCard` Sparkles ile çizer. Ayrı bileşen adı yoktur. [kodda doğrulandı: components/SwipeCard.tsx, 750–756]

**Sparkles.** `lucide-react-native` ikonu. Hedeflenen “iki nokta göz” animasyonu değildir.

**Pool.** `selectRecommendationPool` çıktısı. En fazla 80 katalog ürünü. Profil seçmez. [kodda doğrulandı: src/intelligence/recommendations/selectRecommendationPool.ts]

**Session intent.** Bellekteki oturum ağırlıkları. `buildIntent`. Kalıcı profil değildir. [kodda doğrulandı: lib/sessionIntent.ts]

**V2.** `EXPO_PUBLIC_PREFERENCE_V2_ENABLED` açıkken tercihlerin tek RPC ile yazılması. Bayrak kapalıyken doğrudan CRUD. Canlı kurulum [doğrulanamadı].

**Declared style.** Kullanıcının stüdyoda seçtiği `minimal` / `street` / `classic` / `sport`. `profiles.style_tags` ve `style_tag_weights`. Davranış ağırlıklarından ayrı yazılır. [kodda doğrulandı: types/profile.ts, STYLE_TAGS; supabase/recs_v1_p1.sql]

**Behavioral style.** `colorW`, `fitW` ve kategori afinitesinin ortalaması. `scoreCandidate` içinde `behavioralStyle`. [kodda doğrulandı: lib/scoring.ts, 385–398]

**Price band.** `inferPriceBand` veya attribute `price_band`. Öğrenilen harita `priceBandW`. Stüdyo bütçe aralığı bu bant değildir.

**Outfit role.** `top`, `bottom`, `outerwear`, `one_piece`, `shoes`, `bag`, `hat`, `accessory`. Havuz ve kombin bunu kullanır. Takım elbise rolü yok. [kodda doğrulandı: types/product.ts, 17–27]

**Fingerprint.** Önbellek anahtarının kanonik metni. Kayıp değil, sıralı ve `undefined` duyarlı bir JSON’dur. SHA-256’sı `cache_key_hash` olur. [kodda doğrulandı: src/recommendationCache/fingerprint.ts, 9–29; scripts/lib/supabaseRecommendationCache.ts, hash]

**Cooperative work.** Uzun kombin aramasını 4 ms civarı dilimlere bölen çalıştırıcı. UI jestini bloklamamak içindir. [rapora dayanıyor: reports/b0-baseline-2026-10-08.md; kodda doğrulandı: src/intelligence/cooperativeWork.ts]

**UNKNOWN upload.** A1’den önce var olan yükleme protokolü. Silme akışına bağlanmaz. Değiştirilmez. [kodda doğrulandı: AGENTS.md, kesin yasaklar]

**isActiveCatalogRecord.** `evaluateCatalogEligibility` sonucu `eligible` ise doğru. Havuz ve feed bunu kullanır. `productsById` kullanmaz. [kodda doğrulandı: lib/catalogEligibility.ts, 191–194]

**incomplete.** Kapının eksik alan listesi. Renk veya zorunlu metin yoksa. Boş `style_tags` bu listeye girmez.

**productsById.** Kimlikten ürün çözen okuma. Kapı uygulamaz. Eksik kimlik haritaya girmez. [kodda doğrulandı: services/productRepository.ts, 47–66 ve 83–85]

**priceBandW.** Öğrenilmiş fiyat bandı ağırlığı. “Fiyat aralığına uygun” bunu okur. Stüdyo bütçe aralığı değildir. [kodda doğrulandı: lib/reasons.ts, 100–107]

**deal_match.** İndirim skoru. Kişisel ağırlıkta 0, trend artışında varsayılan 3. “Son 30 günün en düşük fiyatı” cümlesi değildir. [kodda doğrulandı: lib/scoring.ts, 41 ve 48–58]

**rerankForDiversity.** Puan sırasından sonra desteyi çeşitlendiren adım. Neden metinleri burada `buildReasons` ile bağlanır. [kodda doğrulandı: lib/diversity.ts, 201 ve 265]

**ingest_events.** Olay kuyruğunu işleyip `recompute_profile` çağıran SQL yolu. Gösterim, mutlak ağırlık 0.5 altında kaldığı için döngüye girmez. [kodda doğrulandı: supabase/recs_v1.sql, 508–509]

**kind=final.** Okunan öneri önbellek türü. Ranking satırı, yedi gün içinde olsa bile canlı okuyucunun türü değildir. Ayrıntı `07`. [kodda doğrulandı: src/recommendationCache/retention.ts]

**Exposure.** Kartın daha önce önerilen parçaları. Final parmak izine girer. Profil ağırlığı girmez. [kodda doğrulandı: src/recommendationCache/fingerprint.ts, 77–84]

**Kabin.** Kombin marka puanında yok sayılan marka adı. Aynı marka katkısı, marka `kabin` ise 0 kalır. [kodda doğrulandı: src/intelligence/outfits/catalogCompatibility.ts, 44]

**firstOnly.** Öneri girdisinde tek sonuç isteği. Parmak izinin bağlam alanındadır. [kodda doğrulandı: src/recommendationCache/fingerprint.ts, 71–72]

**A1_DEPENDENCY.** A1 dışı bir işin A1 dosyasına dokunması gerektiğinde yazılan işaret. Yetki yoksa dosya değişmez. [kodda doğrulandı: AGENTS.md, kapsam]

**İki nokta göz.** Hedeflenen chip ikonu. Kodda yok. Bugün Sparkles vardır. [doğrulanamadı: animasyon dosyası]

**material / season / occasion.** Attribute okuma listesindedir. Kolon yoksa sorgu bu kolonlar olmadan tekrarlanır. Sıra formülü bunları toplamaz. [kodda doğrulandı: services/productRepository.ts, 88–89]

**current_price / previous_price.** Ürün satırı seçiminde istenir. `deal_match` kişisel ağırlıkta 0 olduğu için “son 30 gün” cümlesine kendiliğinden dönmez. [kodda doğrulandı: services/productRepository.ts, 121; lib/scoring.ts, 41]

**isPersonalized.** Feed yanıtının kişiselleştiğini söyleyen bayrak. Misafir yolunda `false`. Edge başarısında `true`. [kodda doğrulandı: services/productService.ts, 544 ve 574]

**LOCAL_RANK_FAILED.** Yerel `rankLocally` hata verince katalog sırasına düşülen uyarı kodu. Edge’in yokluğu bu kod değildir; o `feed_fallback` / `edge_unavailable` olur. [kodda doğrulandı: services/productService.ts, 551–552 ve 599]

**feed_fallback.** Edge adresi yok veya yanıt kullanılamazsa yazılan olay. Kişiselleştirilmiş yerel sıra bundan sonra yine denenebilir. Misafir bu olaya girmez; doğrudan `selectLocalFeed` kullanır. [kodda doğrulandı: services/productService.ts, 520–577]

**Recommendation product not found.** Final önbellekteki kimlik katalogda yoksa çözücünün hatası. Eski parmak izi, silinmiş ürünü kartta diriltmez. [kodda doğrulandı: services/discoverRecommendationCacheService.ts, 77]

**excludeIds.** Feed isteğinin dışladığı beğenilen ve geçilen kimlikler. Açık destedeki kart bu listeye girince yerinde yeniden puanlanmaz; sonraki sayfa onu atlar. [kodda doğrulandı: services/productService.ts, fetchFeedProducts exclude parametresi]

**relaxed.** Yerel seçicinin filtreyi gevşettiğini söyleyen alan. Kişiselleştirme kanıtı değildir. [kodda doğrulandı: services/productService.ts, 575–576]
