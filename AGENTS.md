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
I1. DB: tüm kullanıcı tabloları auth.users'a (doğrudan veya public.users üzerinden) FK + ON DELETE CASCADE ile bağlı.
    Silme koordinasyonu DB için gerekmez.
I2. Storage: tek yazıcı Edge Function (service-role). İstemci rolleri (anon/authenticated) için storage.objects
    üzerinde INSERT/UPDATE/DELETE politikası YOK; bucket'lar private. İmzalı yükleme URL'si ve TUS kullanılmaz
    (imzalı yükleme URL'si 2 saat geçerli ve RLS gerektirmez).
I3. Silme sırası: fence -> drain -> sweep -> doğrula -> auth kullanıcısını sil -> tamamlandı kaydı.
    Her adım hatasında: status='failed', auth kullanıcısı SİLİNMEZ, fence açık kalır, yeniden denenebilir.
I4. Edge yükleme fonksiyonu: yazmadan ÖNCE fence kontrolü, yazdıktan SONRA tekrar kontrol; fence görürse
    kendi yazdığı nesneyi siler ve hata döner. Ek olarak günlük janitor: sahibi olmayan veya silinmekte olan
    kullanıcıların {user_id}/ altındaki nesnelerini siler.
I5. Harici servisler (görsel işleme): durumsuz tasarım; silme doğrulaması teknik değil beyan olarak raporlanır.
    Hesap silme satıcı doğrulamasına bağlı DEĞİLDİR.

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
