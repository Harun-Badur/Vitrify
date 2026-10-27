# Vitrify — Claude Project bilgi paketi

Vitrify’ın moda keşfi, dijital dolap, kombin ve stil puanlama sistemini yeni bir danışmana tek oturumda anlatmak için yazıldı. İddialar kod veya tarihli rapora bağlıdır. Bu paket kod değildir; davranışı değiştirmez.

Son güncelleme: 2026-10-27

Durum etiketleri: `[kodda doğrulandı: yol]`, `[rapora dayanıyor: yol]`, `[doğrulanamadı]`. `ÇELİŞKİ` iki kaynağın uyuşmadığı yerdedir. Anahtar, token, `.env` değeri ve kullanıcı kimliği yok. Ortam değişkenleri yalnız ad olarak geçer.

## Okuma sırası

1. `01-urun-ozeti.md` — ürün, sekmeler, hedeflenen deneyim.
2. `02-teknik-yigin-ve-mimari.md` — yığın, klasörler, açılıştan beğeniye akış.
3. `03-style-intelligence-mevcut-durum.md` — sıralama, kombin, bağlı olmayan stil katmanı, insight chip.
4. `04-dolap-ve-kombin.md` — dolap modeli, kesim, senkron, Keşfet’in boş dolap dizisi.
5. `05-katalog-ve-veri-kalitesi.md` — şema, uygunluk kapısı, başlık çıkarımı, sayılar.
6. `06-backend-guvenlik-ve-A1.md` — Supabase, Edge, hesap silme fazları, açık güvenlik.
7. `07-performans-ve-onbellek.md` — önbellekler ve ölçülmüş / ölçülmemiş performans.
8. `08-test-ve-kalite.md` — komutlar, kapsam, kırık testler.
9. `09-kararlar-ADR.md` — alınmış kararlar ve kodda durumları.
10. `10-acik-isler-ve-oncelikler.md` — P0–P5 ve kodda görülen ek işler.
11. `11-calisma-kurallari.md` — `AGENTS.md` ve geliştirme kuralları.
12. `12-sozluk.md` — terimler.
13. `13-yol-haritasi.md` — yol haritası metni, olduğu gibi.

## Dosya özetleri

| Dosya | Bir cümle |
|---|---|
| 01 | Vitrify dört sekmeli bir keşif uygulamasıdır; dolaptan kombin ve kanıtlı kart etiketi hedeftir, ikisi de bugün tam değildir. |
| 02 | Expo 57 / RN 0.86 istemci, Zustand ve Supabase; Keşfet sırası ile kombin motoru ayrı çağrı zincirleridir. |
| 03 | Canlı stil, `scoreCandidate` ve `catalogCompatibility` kurallarıdır; `StyleContext` canlı yola bağlı değildir. |
| 04 | Dolap fotoğraf, kategori ve başlık tutar; Keşfet kombin oturumuna boş dizi verir. |
| 05 | Uygunluk kapısı renksiz ürünü eler; 2026-10-14 sayımı 496, 2026-10-27 silme sonucu 349’dur. |
| 06 | A1 fazları 4b’ye kadar çoğunlukla yerel/fake kanıttır; Faz 5 janitor zamanlaması BLOCKED’dur. |
| 07 | Katalog ve profil önbellekleri kısa ömürlüdür; profil değişimi açık desteyi yenilemez. |
| 08 | `npm test` Jest’tir; üç `feedPagination` testi Edge’e hiç çıkmadan düşer. |
| 09 | Kararların bir kısmı uygulanmış, uyum modülü ve StyleContext kararları uygulanmamıştır. |
| 10 | Önce chip’in fiyat etiketini kanıta bağlamak veya gizlemek, sonra dolap ve profil. |
| 11 | Görev kapsamı, A1 yasakları ve “önce test, tek değişiklik, faz sonunda dur”. |
| 12 | Çapa, kapı, abstain, fence, JEV ve insight chip tanımları. |
| 13 | Yol haritası metni, 2026-10-27’de olduğu gibi kaydedildi. |

Bu paket 2026-10-27’de çalışma ağacından üretildi. Canlı veritabanı bu yazım sırasında yeniden okunmadı.

## Nasıl kullanılmalı

Her dosya kendi özetiyle başlar. Danışman bir sohbette yalnız ilgili dosyayı okusa da terim ve tarih orada durur. Çelişki başka dosyada geçse bile kısa hali bulunduğu dosyada tekrarlanır.

Güncelleme kuralı: kod değişince ilgili dosyanın “Son güncelleme” satırı ve durum etiketi değişir. Eski raporu silmek yerine tarih eklenir. Canlı sayım yazılacaksa sorgu bu pakette yoktur; sayıyı yazan kişi rapor yolunu ekler.

## Bu paketin bilerek yazmadığı şeyler

- `.env` değerleri, servis anahtarları, JWT, e-posta, kullanıcı UUID’si.
- “Kapalı beta”nın mağaza kaydı. Repo metninde geçmiyor. [doğrulanamadı]
- JEV’in sözleşme metni. Kodda çağrı yok. [doğrulanamadı]
- Yayındaki Edge gövdesinin kaynakla aynı olduğu. [doğrulanamadı]
- 2026-10-27 akşamındaki canlı ürün ve önbellek sayısının hâlâ 349 ve 0 olduğu. O gün görüldü; bu yazımda yeniden okunmadı.

## Çelişki indeksi

Ayrıntı ilgili dosyadadır. Kısa liste:

- NativeWind çelişkisi 2026-10-27’de giderildi. Stil `StyleSheet`. `02`
- Kök ürün CHECK’i backend açık işidir; yeni kurulumda güncel sağlayıcı reddedilir. `05`, `10`
- “Fiyat aralığına uygun” öğrenilmiş banttır, beyan edilen bütçe değildir. `03`
- Dolap tabloları 10 Ekim yok, 13 Ekim kurulum raporu var. `04`
- `dolap_remove` ağırlığı var, istemci olayı yok. `04`
- Karar 4, 5 ve 7 hedef ile mevcut kod farkıdır; çelişki değildir. `09`
- tsc 63 / 1 / 0 üç eski 2026-10 raporudur. Bugünkü sayı `08` baseline’ındadır.
- I3 operasyon temizliği 2026-10-27’de eklendi. Önceki purge farkı giderildi. `06`
- `dolap_add` üç yazıcıda geçer: dolap fotoğrafı, favori ve deneme. Üçü aynı sahiplik değildir. `04`

## Kod yazmadan önce yeniden bak

Paket 2026-10-27 anıdır. Danışman şu maddeleri “hâlâ böyle” diye devralmasın; ürün sahibi veya yeni bir salt okuma söylemeden güncel sayılmasın:

- Canlı `products` ve `discover_recommendation_cache` satır sayısı. Son görülen 349 ve 0’dır. Bu yazımda yeniden sayılmadı. [doğrulanamadı]
- `wardrobe_items` / `outfits` / `outfit_items` canlıda duruyor mu. 13 Ekim kurulum raporu var. [doğrulanamadı]
- Kota EXECUTE ve istemci idari grant’leri. 10 Ekim ölçümü. [doğrulanamadı]
- Yayındaki `recs-feed` ve `delete-account` gövdesi kaynakla aynı mı. [doğrulanamadı]
- `npx tsc --noEmit` hata sayısı. Bu oturumda çalıştırılmadı. [doğrulanamadı]
- Tam Jest sonucu. Yalnız üç `feedPagination` testi 2026-10-27’de yeniden koştu ve FAIL oldu.

Sır yok: bu klasörde JWT, servis anahtarı, `postgres://` bağlantısı, e-posta ve proje referansı arandı. Bulunan olursa dosyadan çıkarılır; değer yazılmaz.

## Danışman hangi dosyayı açar

| Soru | Dosya |
|---|---|
| Karttaki etiket neden “bütçe” gibi duruyor? | `03`, sonra `01` hedef tablosu |
| Dolap neden kombine girmiyor? | `04` |
| Renksiz ürün neden destede yok? | `05` |
| Hesap silme staging’de bitti mi? | `06` |
| Profil kaydı desteyi neden yenilemiyor? | `07` |
| Üç kırmızı Jest neyi kanıtlamaz? | `08` |
| Karar uygulanmış mı? | `09` |
| Sıradaki iş | `10` |

Bir dosya başka dosyaya “ayrıntı orada” diyebilir. Yine de kendi cümlesi durum etiketi taşır. Canlı sayı yazan cümle, tarih ve rapor yolu olmadan güncel kabul edilmez.

Okuma sırası 01’den 12’ye kadardır. Çelişki indeksindeki madde, ilgili dosyada ikinci kez ve kanıt yoluyla durur. Bu klasör dışında dosya değişmedi.
