# Çalışma kuralları

Kök `AGENTS.md` 2026-10-27’de olduğu gibi aşağıdadır. Ardından bu paket için geliştirme kuralları gelir. İkisi çelişirse A1 işinde `AGENTS.md` kazanır; A1 dışı işte genel kurallar ve aşağıdaki faz ritmi geçerlidir.

Son güncelleme: 2026-10-27

## AGENTS.md

# Genel proje kuralları

- Kullanıcının verdiği görev kapsamıyla sınırlı çalış; mevcut kullanıcı verisini koru.
- Secret/anahtar yazdırma, commit etme veya loglama. Uzak uygulama, deploy ve veri değiştirme için görevin açık yetki sınırını izle.
- Geliştirmede önce test yaz, sonra uygula; ilgili Jest/TypeScript ve değişen Edge kodu için Deno kontrollerini yap. Mevcut baseline hatalarını yeni regresyonlardan ayır.
- Veri kaybına yol açabilecek belirsiz bir davranışı varsayma; gerekli ürün kararını kullanıcıdan al.
- Görev sonunda tamamlanan işleri, değişen dosyaları, testleri, doğrulanmamış davranışları ve riskleri raporla.

# A1: Hesap silme ve Storage temizliği (kalıcı kurallar)

**Kapsam:** Aşağıdaki amaç, I1–I5, S1–S8, kesin yasaklar ve faz/rapor kuralları yalnız A1 hesap silme ve buna bağlı Storage güvenliği çalışmaları için geçerlidir. Diğer backend modüllerinin geliştirilmesini yasaklamaz. A1 dışı bir görev mevcut A1 koduna veya altyapısına dokunmayı gerektiriyorsa bunu `A1_DEPENDENCY` olarak raporla; açık A1 yetkisi olmadan değiştirme. Genel secret/veri koruma kuralları her görevde geçerlidir.

## Amaç
Kullanıcı hesabını sildiğinde DB verisi ve Supabase Storage nesneleri güvenle silinir.
Tasarım "yazma yok" kanıtlamaya DEĞİL, şu üçüne dayanır:
(1) yazıcılar sayılı, (2) geç kalan yazma sınırlı, (3) kalan her şey kendi kendine temizlenir.

## Değişmez ilkeler
I1. DB: tüm kullanıcı tabloları auth.users'a (doğrudan veya public.users üzerinden) FK + ON DELETE CASCADE ile bağlı. Silme koordinasyonu DB için gerekmez.
I2. Storage: tek yazıcı Edge Function (service-role). İstemci rolleri (anon/authenticated) için storage.objects üzerinde INSERT/UPDATE/DELETE politikası YOK; bucket'lar private. İmzalı yükleme URL'si ve TUS kullanılmaz (imzalı yükleme URL'si 2 saat geçerli ve RLS gerektirmez).
I3. Silme sırası: fence -> drain -> sweep -> doğrula -> operasyon tablosu temizliği (storage_resolutions -> storage_operations -> provider_operations) -> auth kullanıcısını sil -> tamamlandı kaydı. Her adım hatasında: status='failed', auth kullanıcısı SİLİNMEZ, fence açık kalır, yeniden denenebilir.
I4. Edge yükleme fonksiyonu: yazmadan ÖNCE fence kontrolü, yazdıktan SONRA tekrar kontrol; fence görürse kendi yazdığı nesneyi siler ve hata döner. Ek olarak günlük janitor: sahibi olmayan veya silinmekte olan kullanıcıların {user_id}/ altındaki nesnelerini siler.
I5. Harici servisler (görsel işleme): durumsuz tasarım; silme doğrulaması teknik değil beyan olarak raporlanır. Hesap silme satıcı doğrulamasına bağlı DEĞİLDİR.

## Supabase gerçekleri (doğrulanmış)
- Storage nesnelerini SQL ile silme; storage.objects satırını silmek dosyayı kaldırmaz. Storage API (list + remove) kullan; klasör silme yok.
- Nesne sahibi olan auth kullanıcısı silinemez; önce nesneler silinmeli. Service-role yüklemelerinde `owner` boş olabilir: STAGING'DE GÖZLEMLE, varsayma.
- Erişim token'ı (JWT) süresi dolana kadar geçerli; ban/signOut mevcut token'ı iptal etmez. Yetki kapısı olarak ban'a güvenme.

## Tehdit senaryoları (SONLU liste) -> mekanizma -> test
S1 Başka cihaz silme sırasında yükler -> istemci yazma yetkisi yok + Edge fence -> T5, T10
S2 Fence'i geçmiş uçuştaki yükleme -> yazıcı sonrası kontrol + sweep -> T2
S3 Silme yarıda çöker -> durum makinesi, auth silinmez, yeniden deneme -> T3
S4 Çift/eşzamanlı istek -> atomik durum geçişi, idempotent -> T9
S5 İstemci doğrudan Storage/TUS/imzalı URL -> politika yok, imzalı URL yok -> T5, T6
S6 Arka plan işi yazar -> Storage'a yazan worker yok (kod araması); DB'ye yazarsa FK reddi -> T8
S7 Yazıcı yazıp çöker -> janitor -> T4
S8 Harici servis ve yedek -> durumsuz tasarım + beyan -> inceleme
Bu listede olmayan hiçbir kontrol ekleme. Yeni senaryo çıkarsa DUR ve kullanıcıya sor.

## Kesin yasaklar
- Canlı (production) Supabase'e bağlanma, SQL çalıştırma, deploy etme. Yalnızca yerel ve staging (Vitrify-A1-Staging) için kod/SQL ÜRET; uygulamayı kullanıcı yapar.
- Migration EKLEME; gerekiyorsa SQL dosyasını yaz ama "bu hangi S# senaryosunu kapatıyor?" cevabıyla birlikte ve UYGULAMA.
- Mevcut UNKNOWN-upload mekanizmasını değiştirme ve silme akışını ona bağlama.
- Discover arayüzüne, öneri motoruna, ürün/feed kodlarına dokunma.
- Secret/anahtar yazdırma, commit etme, loglama.
- Bir fazın dışına çıkma. Bir seferde tek değişiklik.

## Çalışma biçimi
Önce test yaz, sonra uygula. Çalıştır: Jest, tsc, Deno kontrolleri. Fazın sonunda şu formatta rapor ver:
1) Özet (<=10 satır) 2) Değişen dosyalar 3) Eklenen/çalıştırılan testler ve sonuçları 4) Kapatılan senaryolar (S#)
5) Açık sorular 6) Riskler 7) Yapmadıklarım. Belirsiz bir şey varsa varsayma, dur ve sor.

## Geliştirme kuralları

- Önce test yaz. Tek değişiklik. Faz sonunda dur.
- Rapor yedi bölümdür: özet, değişen dosyalar, testler, kapatılan senaryolar, açık sorular, riskler, yapmadıklarım.
- Canlıya bağlanma ve deploy yok. SQL öneri olarak yazılır. Uygulamayı ürün sahibi yapar.
- Mevcut test baseline’ını kaydet. Yeni hata veya FAIL ekleme. Bilinen `feedPagination` üçlüsü ve tarihsel Jest FAIL’leri yeni regresyon diye kapatılmasın; `08` dosyasına bak.
- Bir kontrol, ancak adlandırılmış bir senaryoyu kapatıyorsa eklenir. A1’de bu senaryo S1–S8 dışına çıkamaz.
- Secret, token ve kullanıcı kimliği yazma, commit etme, loglama.
- A1 dosyasına dokunmak gerekiyorsa bunu `A1_DEPENDENCY` diye işaretle ve açık A1 yetkisi olmadan değiştirme.
- Discover arayüzü A1 işinde kilitlidir. Insight chip istisnası ürün kararıdır (`09` karar 1); A1 yetkisi chip işini açmaz.

## Danışman için kısa işletim

- Kod yazmadan önce ilgili `docs/claude-project` dosyasındaki durum etiketini yeniden kontrol et. Paket 2026-10-27 anıdır.
- Canlı sayı, şema veya Edge gövdesi gerekiyorsa bunu ürün sahibi çalıştırır. Sonuç rapora yol olarak yazılır.
- `ÇELİŞKİ` görülen yerde iki cümleyi de koru. Birini silerek “güncel olan” seçme. Tarih daha yeni olan rapor adaydır; kanıtı yaz.
- Baseline FAIL’leri yeşile çekmek ayrı bir iştir. Sessiz `skip` veya assertion gevşetme yok.
- Yeni senaryo uydurma. A1’de S1–S8 dışında kontrol eklenmez. Ürün işinde senaryo adı testte durur.

## Faz sonu raporu

A1 ve ürün fazı aynı yedi başlığı kullanır:

1. Özet, en fazla on satır.
2. Değişen dosyalar. `docs/claude-project` dışında yazıldıysa her yol.
3. Eklenen ve çalıştırılan testler, komut ve sonuç. Baseline FAIL ayrı satır.
4. Kapatılan senaryo. A1’de S numarası. Ürün işinde test adı.
5. Açık sorular. Bilinmeyen canlı sayı burada [doğrulanamadı] kalır.
6. Riskler. Deploy eşitliği, veri kaybı, yanlış chip metni.
7. Yapmadıklarım. Kapsam dışı P maddeleri ve canlı bağlantı.

SQL bu rapora “öneri” diye girer. İşlendi denmez. Ürün sahibi staging’de çalıştırır.

## Bu paket yazılırken

Yalnız `docs/claude-project/` oluşturuldu. Kod, migration, test ve yapılandırma değişmedi. Ağ ve Supabase yok. Secret taraması klasör üzerinde yapıldı; değer bulunursa yazılmaz.

Ürün işi A1 senaryo listesini genişletmez. A1 işi insight chip, sıralama ve dolap niteliklerini “yanına ekleyerek” yapmaz. İkisi aynı faz raporuna yazılmaz.

Canlı sayı, şema veya Edge gövdesi gerekiyorsa ürün sahibi çalıştırır. Sonuç, bu klasörde tarih ve rapor yoluyla güncellenir. Değer ve anahtar yazılmaz.
