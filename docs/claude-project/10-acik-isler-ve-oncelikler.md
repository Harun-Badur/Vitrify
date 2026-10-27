# Açık işler ve öncelikler

Sıra ürün sahibinin P0–P5 listesidir. Her madde bugünkü koda bağlanır. “Ek açık işler” kod veya rapordan gelen, bu listede adı geçmeyen borçlardır. Hiçbiri bu pakette uygulanmadı.

Son güncelleme: 2026-10-27

## P0

Insight chip. Bugünkü “Fiyat aralığına uygun” `buildReasons` içindedir: öğrenilmiş `priceBandW` eşiği, stüdyo bütçesi değil. [kodda doğrulandı: lib/reasons.ts, 100–107] Kanıt, bütçe alanı değildir. Sahip kararı: kanıta bağlanana kadar gizle. Gizleme henüz yok; eşik altındaysa zaten çizilmez, eşik üstündeyse yanlış okunabilir etiket çizilir.

Hızlı doğruluk:

- `dolap_add` yalnız nitelik satırı olan katalog kimliğinde profili beslesin. Dolap UUID’si `product_attributes` ile eşleşmez. [kodda doğrulandı: supabase/recs_v1.sql, 504–506; store/wardrobeSlice.ts, 333]
- `dolap_remove` yazılsın. Tip ve SQL ağırlığı var, `track` çağrısı yok.
- Profil kaydı sıralama bellek önbelleğini düşürsün ve desteyi yenilesin. Bugün yalnız `invalidateStyleProfileSnapshot`. [kodda doğrulandı: services/profileService.ts, syncDeclaredStyleTags yolu]
- `feedPagination` Jest ortamı. Üç test `EXPO_PUBLIC_*` inlining yüzünden Edge’e çıkmaz. Ayrıntı `08`. Ürün kodunu “Edge yok” diye değiştirmek yanlış onarımdır.
- Release derlemesinde gerçek cihaz ölçümü. 2026-10-14 raporu bunu NOT VERIFIED bırakır. [rapora dayanıyor: reports/release/VITRIFY_V1_DISCOVER_CATALOG_PERFORMANCE.md]

## P1

Tek chip bileşeni, tek seçici, neden kodları, gösterim ve dokunma olayları, “neden” alt sayfası. İlk gerçek tip: beyan edilen bütçe. Göz animasyonu paralel tasarım. Bugün Sparkles ve serbest metin var; neden kodu ve alt sayfa yok. [doğrulanamadı: neden alt sayfası arandı, bulunamadı]

## P2

Dolapta alt tür seçimi ve kesimden renk önerisi, kullanıcı onayı. Sonra tek uyum modülü ve ortak sözlük. `evaluateCompatibility` duruyor, `catalogCompatibility` ona bağlı değil. Karar 5 ve 6 uygulanmadı.

## P3

Dolap eşleşmesi etiketi ve kart kombininde dolap parçası. Eşik altındaysa gösterme. Dolap ekranında “bununla ne giyerim”. Keşfet bugün `[]` geçtiği için bu yüzey yok. [kodda doğrulandı: app/(tabs)/index.tsx, 276–279]

## P4

İçgörü durumu: henüz bilinmiyor / oluşuyor / belirgin. Gösterimle normalize beğeni. Beyan ve davranış karışımı kanıta göre. Marka, renk ve bütçe yumuşak sinyal. Bu üçü `studio_preferences` içindedir ve `scoreCandidate` okumaz.

## P5

“Dolabını tamamlar” sıralama sinyali. Sıra formülünde dolap terimi yok. Kombin motorundan sonra gelmeli; aksi halde destedeki ürün, hiç görülmeyen dolaba göre seçilir.

## Paralel A1

Faz 4b staging doğrulaması (T2, T11) NOT VERIFIED. Faz 5 janitor BLOCKED. Sonra sadeleştirme. [rapora dayanıyor: reports/backend/a1-phase4b-report-20261012.md; reports/backend/a1-phase5-stop-report-20261012.md]

## Ek açık işler

- İki stil dili: sıralama etiket önceliği ile kombin casual/tailored. Birleştirilmedi.
- Kök `schema_products.sql` CHECK’i backend açık işidir. Yeni ortam bu dosyadan kurulursa güncel sağlayıcı/kategoriler reddedilir; baseline migration ile çözülecek. Ledger eksik. [rapora dayanıyor: reports/backend/backend-open-issues-2026-10-10.md; kodda doğrulandı: supabase/schema_products.sql]
- 2026-10-10 kota EXECUTE ve istemci TRUNCATE/MAINTAIN grant’leri. Öneri SQL uygulanmadı diye yazılmış. Güncel ACL [doğrulanamadı].
- `scrollPose` testi, kaynak modül olmadan duruyor. [rapora dayanıyor: reports/backend/typescript-work3-report-20261012.md]
- Takım elbise için rol yok. [rapora dayanıyor: reports/phase6.4-suit-performance-2026-10-09/report.md]
- Edge deploy gövdesi ile kaynak eşitliği [doğrulanamadı].
- `liked_products.product_id` ürün FK’si değil. Silinen katalog kimliği beğenide kalabilir. [kodda doğrulandı: supabase/schema.sql]
- Jest fikstürü silinmiş katalog kimlikleri içerebilir. İçe aktarıcı değildir; testi bozmamak için bilinçli bırakıldı.

## Ölçmeden yapılmayacaklar

Sıra formülünün ağırlıklarını, `catalogCompatibility` katsayılarını veya 80’lik kotayı, cihaz ölçümü ve insan uyum değerlendirmesi olmadan değiştirmek P0 değildir. Karar 11 AI skorunu kalite kararı saymaz. Önce chip metninin yanlış kanıtı ve profilin desteye geç bağlanması kapanmalıdır.

Dolabı kombinlere bağlamak P3’tür. P2’de nitelik yokken bağlamak, renksiz dolap parçasını “uyumlu” gibi gösterebilir. Karar 3 bunu istemez. `resolveWardrobeRole` alt türsüz üst bedeni zaten düşürür. [kodda doğrulandı: src/intelligence/outfits/outfitCandidate.ts, 72–79]

## Durma çizgisi

Her P maddesi tek değişiklik ve önce test ister. A1 paralel işi Discover dosyasına dokunursa `A1_DEPENDENCY` yazılır ve A1 yetkisi olmadan yapılmaz. [kodda doğrulandı: AGENTS.md, kapsam paragrafı]

## P0’ın dokunacağı yer, henüz yapılmadan

| İş | İlk dosya | Yanlış onarım |
|---|---|---|
| Fiyat etiketini gizle | `lib/reasons.ts` 100–107 ve `SwipeCard` | Tüm chip’i silmek; diğer gerçek nedenler de gider |
| `dolap_add` yalnız nitelikli katalog | `supabase/recs_v1.sql` döngüsü ve `wardrobeSlice` | Favori `source: 'feed'` olayını silmek |
| `dolap_remove` | `store/wardrobeSlice.ts` `removeWardrobeItem` | SQL ağırlığını silmek |
| Profil kaydı desteyi yeniler | `profileService` sonrası `loadFeed` | Yalnız AsyncStorage anahtarını silmek |
| feedPagination | Jest ortamı / `expo/virtual/env` | Edge formülünü “yerel sıra yeter” diye değiştirmek |
| Cihaz ölçümü | Release derleme | Host ≤210 ms’yi cihaz sonucu diye yazmak |

`dolap_add` üç yazıcıdadır. P0 “yalnız nitelikli katalog kimliği profili güncellesin” der. Favori ve deneme katalog kimliği taşır; dolap formu UUID taşır. UUID’yi profil birleştirmesinden çıkarmak, favori olayını silmek değildir. Ayrıntı `04`.

## P1’de henüz olmayan yüzey

Neden kodu, gösterim olayı, dokunma olayı ve “neden” alt sayfası arandı; ayrı bir sayfa bulunamadı. [doğrulanamadı] İlk gerçek tip beyan edilen bütçedir. Bugünkü fiyat cümlesi bu tipe bağlanmadan gizlenmelidir. Göz animasyonu Sparkles’ın yerine geçer; metin seçiciden ayrı bir iş olarak paralel gider. Döngülü animasyon ve azaltılmış hareketi yok saymak hedefe uymaz. `01`.

## Bağımlılık

P3, P2’deki nitelik olmadan “dolabındaki lacivert jean” diyemez. Renk ve alt tür yokken dolabı kombin girdisine bağlamak, karar 3’e aykırı sahte uyum üretebilir. P4, beyan edilen bütçeyi yumuşak sinyal yapar; P1’in chip’i aynı alanı okumalı, ikinci bir bütçe hesabı istemcide kurulmamalı. P5, P3’ten sonra gelir: sıra sinyali, hiç bağlanmamış dolaba göre ürün seçmesin.

Paralel A1, P0 chip gizlemesiyle aynı PR’da birleşmez. Discover dosyasına A1 dokunuşu `A1_DEPENDENCY` olur. [kodda doğrulandı: AGENTS.md]

P0 maddeleri de tek seferde yapılmaz. Önce fiyat etiketinin kaynağı doğrulanır; kanıt bütçe değilse etiket gizlenir. Jest ortamı ayrı bir değişikliktir. Cihaz ölçümü kod değiştirmeden raporlanır. `dolap_remove` ve profil kaydının desteyi yenilemesi ayrı testlerle gelir. Ağırlık veya 80’lik kota bu sıranın parçası değildir.

## Bu paketin yapmadığı iş

P0–P5 ve paralel A1 burada uygulanmadı. Kod, test, SQL ve Edge değişmedi. Liste, danışmanın sıradaki işi seçmesi içindir. Bir madde “kısmen var” diyorsa ilgili dosyadaki durum etiketi geçerlidir. Gizlenmemiş fiyat etiketi, yazılmayan `dolap_remove` ve yenilenmeyen deste bugünün davranışıdır.

Ek açık işler P0 değildir. Kota grant’i, migration ledger ve takım elbise rolü ayrı yetki ister. Stil sözlüğünü birleştirmek P2’dir. Edge deploy eşitliği, kod yazarak kapanmaz. Ürün sahibi yayını karşılaştırır. [doğrulanamadı: güncel deploy]

İnsan uyum değerlendirmesi karar 11’dedir. Phase 6.2 kör inceleme rehberi vardır. Canlı `scoreCandidate` o rehberi beklemez. Katsayı değiştirmek, rehber ve cihaz ölçümü olmadan P0 sayılmaz. [rapora dayanıyor: reports/phase6.2-blind-review/README.md]

P1 göz işi, P0 gizlemesini beklemeden tasarlanabilir. Metin seçici ile ikon aynı PR olmak zorunda değildir. İkon, kanıtsız etiketi göstermez. Etiket yoksa ikon da yoktur. `01`.

Cihaz ölçümü P0’ın son maddesidir ve algoritma değiştirmez. Host sayıları `07` dosyasındadır. Release derlemesi bu pakette alınmadı. [doğrulanamadı: cihaz süresi]

Faz sonunda dur. Yedi bölümlü rapor `11` dosyasındadır.
