# Ürün özeti

Vitrify, mağaza ürünlerini kart kart gezdiren, beğenilenleri saklayan ve kullanıcının kendi kıyafetlerini dolaba almasını hedefleyen bir mobil moda uygulamasıdır. Bugün çalışan çekirdek Keşfet sırası, beğeni/geçme ve katalog kombinleridir. Dolaptan tamamlayıcı kombin ve kanıtlı tek etiket henüz ürün hedefidir.

Son güncelleme: 2026-10-27

## Ne var

Dört sekme `app/(tabs)/_layout.tsx` içindedir. [kodda doğrulandı: app/(tabs)/_layout.tsx, 70–97]

| Sekme | Dosya | Bugünkü iş |
|---|---|---|
| Keşfet | `app/(tabs)/index.tsx` | Ürün destesi, kaydırma, kart altı katalog kombinleri |
| Favoriler | `app/(tabs)/style.tsx` | Beğenilen ürünler. Stil anketi burada değildir |
| Dolap | `app/(tabs)/liked.tsx` | Dolap ve kayıtlı kombinlere giriş |
| Profil | `app/(tabs)/profile.tsx` | Hesap, beden/stil stüdyosu, hesap silme |

Dolap ekleme `app/wardrobe/add.tsx`, kombin kurma `app/wardrobe/create.tsx` altındadır. [kodda doğrulandı: app/wardrobe/add.tsx]

“Kapalı beta” ifadesi repo Markdown’ında bulunamadı. [doğrulanamadı] Ürün sahibi bu paketi kapalı beta danışmanlığı için istedi; bu bir kod olgusu değil, paket amacıdır.

## Hedeflenen deneyim

Bunlar ürün sahibinin istekleridir. Kodda karşılığı varsa ayrıca işaretlenir.

- Kullanıcı kıyafetini dolaba yükler. Style Intelligence, dolaptaki parçalarla tamamlayıcı kombin önerir. Motor dolap öğesi kabul eder; Keşfet ekranı bugün boş dizi verir. Ayrıntı `04-dolap-ve-kombin.md`.
- Keşfet kartının üstündeki etiket, gerçek kanıt varsa tek bir cümle söyler. Örnekler: “Dolabındaki lacivert jeanle uyumlu”, “Dolabındaki 3 parçayla kombinlenir”, “Beğendiğin minimal parçalara benziyor”, “Bütçene uygun”, “Son 30 günün en düşük fiyatı”, “Yeni bir tarz denemesi”. Kanıt yoksa etiket yoktur. Kart başına en fazla bir etiket.
- Bugün görünen etiket bu listenin tamamı değildir. Metin `buildReasons` üretir; ilk neden `product.reason` olur; `SwipeCard` bunu Sparkles ikonuyla çizer. “Fiyat aralığına uygun”, öğrenilen fiyat bandı eşiğini geçerse çıkar. Beyan edilen bütçe alanı bu etiketi beslemez. Ayrıntı `03-style-intelligence-mevcut-durum.md`.
- Sparkles yerine, Vitrify görünümüne uygun soyut “iki nokta göz” animasyonu hedeflenir: ilk görünüşte bir kez kırpar, dolap eşleşmesinde o parçaya kısaca bakar, döngüye girmez, azaltılmış harekete uyar. Bu animasyon kodda yok. [doğrulanamadı]
- Stil profili tek bir “%X tanıyoruz” yüzdesi olmamalı. Her içgörü “henüz bilinmiyor / oluşuyor / belirgin” ve kanıt taşır. Beğeniler gösterim sayısına bölünür. Bu durum modeli canlı profil ekranında yok. [doğrulanamadı]
- Beğeni ve geçme sonraki sıralamayı tutarlı değiştirmeli. Profil ekranı ile motor aynı `user_style_profiles` satırını okumalı; profil ekranı ağırlığı istemcide yeniden yorumlamamalı. V2 bayrağı açıkken profil kartları backend ağırlığını kullanır. Keşfet, kayıt anında desteyi yenilemez. Ayrıntı `03` ve `09`.

## Bugün kullanıcı ne yaşar

Misafir kişiselleştirilmiş sıra almaz. Girişli kullanıcı destede ürün görür, beğenir veya geçer. Beğenilen katalog ürünü favorilere yazılır. Geçilen bir daha aynı destede gösterilmez. Kartın altında, ayrı bir 80 ürünlük havuzdan katalog kombinleri gelebilir. Dolaba fotoğraf eklemek o kombinleri değiştirmez.

Stil stüdyosu etiket, beden, marka, renk ve bütçe sorar. Sırayı doğrudan değiştiren beyan, stil etiketlerinin `style_tag_weights` alanına yazılmasıdır. Marka, renk ve bütçe auth metadata’sında kalır ve `scoreCandidate` bunları okumaz. [kodda doğrulandı: lib/scoring.ts, scoreCandidate 367–478; components/SizeStudioSheet.tsx]

## Bir oturum, bugünkü haliyle

1. Uygulama açılır. Giriş varsa `app/_layout.tsx` `hydrateSession` çağırır. Beğeniler, geçilenler ve dolap gelir. [kodda doğrulandı: store/profileSlice.ts]
2. Keşfet, oturum hazır olunca `loadFeed` ister. Misafir kişiselleştirilmiş Edge sırasına girmez.
3. Kartta görsel, marka, fiyat ve varsa tek neden etiketi vardır. Etiket yoksa chip çizilmez. [kodda doğrulandı: components/SwipeCard.tsx, 750–756]
4. Beğeni çift dokunuşla, geçme kaydırmayla yazılır. Geçilen kimlik sonraki sayfadan düşer. Açık deste yerinde yeniden puanlanmaz.
5. Kartın altındaki kombin, ayrı 80’lik katalog havuzundandır. Dolap parçası bu havuza bugün girmez.
6. Profilde stil etiketi kaydı ağırlık önbelleğini düşürür. Kullanıcı desteyi yenilemezse eski sıra kalır.

## Hedef ile bugün arasındaki fark

| Hedef cümle | Bugün |
|---|---|
| Dolaptaki jeanle uyumlu | Metin `buildReasons` içinde yok. Dolap kombin girdisi boş. |
| Dolabındaki 3 parçayla kombinlenir | Yok. |
| Beğendiğin minimal parçalara benziyor | Yok. “Minimal stiline yakın” yalnız etiket ağırlığı `minimal` ise çıkar. |
| Bütçene uygun | Yok. Görünen “Fiyat aralığına uygun” öğrenilmiş banttır. |
| Son 30 günün en düşük fiyatı | Bu cümle `buildReasons` içinde yok. İndirim skoru `deal_match` varsayılanda 0. |
| Yeni bir tarz denemesi | Keşif yuvasında “Yeni bir şey dene” vardır. Dolap kanıtı değildir. |
| Kanıt yoksa etiket yok | Eşik altı katkı elenir. Eşik, bütçe kanıtı değildir. |
| Kart başına bir etiket | `buildReasons` iki etiket üretebilir; karta yalnız `reasons[0]` yazılır. |
| İki nokta göz | Sparkles ikonu. Animasyon yok. |

Durumlar `03` dosyasında satırla bağlıdır. Bu tablo ürün farkını göstermek içindir.

## Dosya adı ile sekme adı

Sekme başlığı ile dosya adı aynı değildir. [kodda doğrulandı: app/(tabs)/_layout.tsx, 70–97]

| Başlık | Route dosyası | İkon |
|---|---|---|
| Keşfet | `app/(tabs)/index.tsx` | Compass |
| Favoriler | `app/(tabs)/style.tsx` | Heart |
| Dolap | `app/(tabs)/liked.tsx` | Shirt |
| Profil | `app/(tabs)/profile.tsx` | User |

`style.tsx` stil anketi değildir. Anket `SizeStudioSheet` ile profil akışındadır. `liked.tsx` beğeni listesi değildir; beğeniler Favoriler sekmesindedir. Dolap fotoğrafı `WardrobeItem`’dır. Beğenilen mağaza ürünü `liked_products` satırıdır.

## “Dolaba ekle” üç ayrı iş

Olay adı `dolap_add` üç yerde yazılır. Yalnız dolap formu fotoğraf ekler. Diğer ikisi katalog beğenisidir.

- Dolap formu, başarılı senkron sonrası fotoğraf kimliği ve `source: 'wardrobe'` yazar. [kodda doğrulandı: store/wardrobeSlice.ts, 333]
- Favori, aynı katalog kimliği için `like` ve `dolap_add` (`source: 'feed'`) yazar. Bu, `insertLikedProduct` yoludur. [kodda doğrulandı: store/favoritesSlice.ts, 112–118]
- Deneme penceresi “Dolabına eklendi” der ve yine `insertLikedProduct` çağırır; olay `source: 'tryon'`. [kodda doğrulandı: components/VirtualTryOnModal.tsx, 705–710]

`analyzePreferenceEvents` favori kökenli `like` + `dolap_add` çiftini tek tercih sayar ve bunu dolap sahipliği saymaz. Fonksiyon puan yazmaz. Üretim importu yalnız testtedir. [kodda doğrulandı: src/intelligence/evidence/sharedEvidence.ts, 227–231; __tests__/preferenceActionEvidence.test.ts]

## Misafir

Giriş yoksa `fetchFeedProducts` Edge ve `rankLocally` çağırmaz. `selectLocalFeed` katalog sayfasından seçer ve `isPersonalized: false` döner. [kodda doğrulandı: services/productService.ts, 568–577; seçici `src/intelligence/recommendations/feedFallback.ts`] Misafirin dolap yazma sınırı bu pakette satır satır izlenmedi. [doğrulanamadı: misafir dolap sınırı]

## Ürün sahibinin istediği deneyim, kod değil

Yukarıdaki hedef listesi istek metnidir. “%X tanıyoruz” yüzdesinin ekranda olup olmadığı bu yazımda profil bileşeninde ayrıca aranmadı; durum modeli diye ayrı bir tip bulunamadı. [doğrulanamadı] Göz animasyonu ve “dolabındaki jean” cümlesi `buildReasons` ve `SwipeCard` içinde yoktur. [kodda doğrulandı: lib/reasons.ts; components/SwipeCard.tsx, 750–756]

Dört sekme birincil gezintidir. Kombin kurma ve dolap ekleme sekme değil, `app/wardrobe/` altındaki ekranlardır. Favori sekmesi mağaza beğenisini listeler. Dolap sekmesi fotoğraf öğesini listeler. İkisi aynı tablo değildir.

Kart başına bir etiket hedefi, bugünkü `reasons[0]` atamasıyla kısmen örtüşür. İkinci neden üretilse de çizilmez. Bu, kanıt seçicisi değildir. Hangi cümlenin daha doğru olduğu `buildReasons` içindeki katkı sırasına kalır. [kodda doğrulandı: lib/reasons.ts, MAX_REASONS; services/productService.ts, 492]

Sekme geçişi `useReducedMotion` okur. [kodda doğrulandı: app/(tabs)/_layout.tsx, 18 ve 63] `SwipeCard` içindeki Sparkles bu ayarı okumaz. Göz animasyonu yoktur. [kodda doğrulandı: components/SwipeCard.tsx, 752]

Giriş ekranı da `AccessibilityInfo.isReduceMotionEnabled` okur. [kodda doğrulandı: app/auth.tsx, 85–90] Bu, kart etiketinin animasyonu değildir.
