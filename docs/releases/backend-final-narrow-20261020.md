# Play Internal Testing — dar backend hazırlık sonucu

20 Ekim 2026. Yerel kod/test ve salt okunur Kabin main incelemesi. Kullanıcının daha önce gerçek cihazda başarılı yaptığı A1 silme kabulü tekrar edilmedi; bu rapor onu yeni bir başarısızlık veya yeni kabul koşusu olarak yeniden sınıflandırmaz.

## 1. Owner-fence fixture: kesin neden ve sonuç

`privacyClosure.test.ts` aynı süreçte `u` hesabını fence eden testler içeriyordu. `beforeEach`, AsyncStorage ve `accountWriteFence` cache'ini temizliyordu; bağımsız `accountDeviceWork` owner registry'sindeki `deleted`/generation durumunu temizlemiyordu. Sonraki testte `captureOwnerPublication('u')` false kalıyor, write guard doğru biçimde yazmayı reddediyordu. Dosya kopyalama callback'i başlamadığından onu bekleyen test 5 saniyede timeout oluyordu.

Yeni baseline koşusu eski sonucu aynen üretti: **4 PASS / 3 FAIL**. Yalnız fixture'a mevcut `resetDeviceWorkForTests()` eklendikten sonra aynı yedi test **7 PASS / 0 FAIL** oldu. Assertion silinmedi, timeout yükseltilmedi. `lib/accountWriteFence.ts` ve `lib/accountDeviceWork.ts` değiştirilmedi. Gerçek hesap/tombstone temizlenmedi.

## 2. Model fotoğrafı: yerel tutarlı 5 MiB sözleşmesi

Main bucket limiti korunur: **5,242,880 byte (5 MiB)**. Handler'ın 10 MiB kabulü 5 MiB'a indirildi. Daha önce 5–10 MiB içerik admission/dispatch aşamasına ulaşabiliyor, bucket tarafından reddedilerek belirsiz işlem davranışına girebiliyordu.

- Ortak, yan etkisiz `accountStorageUploadLimits.ts` istemci ve Edge tarafından kullanılır.
- İstemci, hazırlanmış JPEG Blob/ArrayBuffer boyutunu Auth/ağ çağrısından ve yeni UNKNOWN kaydından önce denetler. Seçicideki özgün dosya boyutu kullanılmaz.
- Handler gerçek stream byte toplamını denetler; Content-Length'e güvenmez. 5 MiB + 1 byte, admission ve Storage dispatch öncesinde HTTP 413 / REJECTED olur.
- Kod: `MODEL_PHOTO_TOO_LARGE`. İki tarafta mesaj: “Model fotoğrafı en fazla 5 MiB olabilir. Daha küçük bir fotoğraf seç.” Profilin mevcut catch'i Error.message'ı kullanıcıya gösterir; ek UI değişikliği gerekmedi.
- Tam 5 MiB kabul edilir. Dolap için mevcut 12 MiB sınırı korunur. Geçersiz/boş body'nin mevcut reddi korunur.
- Mevcut UNKNOWN reconciliation, yeniden gönderim yasağı, kimlik/path/fence ve terminal doğrulaması değiştirilmedi. Uzak hata UNKNOWN kaydını temizleme veya başarıya dönüştürme gerekçesi yapılmadı.

Bu değişiklik **yalnız yereldir**. Production bucket veya upload Edge değiştirilmedi. Eski AAB, yeni istemci ön kontrolünü ve mesajını içermez. Yeni Edge tek başına eski AAB'yi güncellemez; istemci düzeltmesini dağıtmak ileride yeni AAB gerektirir. Bu görevde artifact/build yapılmadı.

## 3. Janitor: mevcut main ve zorunlu ön koşullar

Bugün main Dashboard'da salt okunur doğrulananlar:

- `account-storage-janitor` ve kaynak dosyaları mevcut; son güncelleme altı gün önce.
- Dağıtılmış entry point dedicated `A1_JANITOR_AUTH_TOKEN`, sunucu `A1_JANITOR_PROJECT_REF` ve boolean silme bayrağını okuyor; service RPC + Storage API adaptörlerini kullanıyor.
- Dağıtılmış handler: yalnız POST, hedef proje/URL eşleşmesi, token hash karşılaştırması; caller body silmeyi veya kapsamı seçemiyor. `counts.errors>0` için 503; beklenmeyen hata için 503/JANITOR_FAILED.
- Dedicated token ve target ayar adları mevcut. Silme bayrağının Dashboard digest'i bilinen `false` değeriyle eşleşiyor. Secret değerleri açılmadı/loglanmadı.
- Cron sayfası **Install integration** gösteriyor; kurulu entegrasyonlar Data API ve Vault. Cron kurulumu/iş aktivasyonu yapılmadı.

Mevcut kod ve kurulum kanıtlarına göre kapsam: yalnız model-photos/wardrobe-cutouts, en az 1 saatlik created/updated yaşı; Auth yokluğu veya fenced ve en az 24 saatlik, en az iki storage/auth retry denemeli başarısız silme; aktif lease varsa atlama. Her remove öncesi eligibility yeniden okunur. Bu gözlem Storage API çağrısını kapsayan global bir kilit değildir. UNKNOWN işlemleri zaman geçti diye terminal yapılmaz. Retention ayrı completed/verified, Auth-absent, inactive-lease ve 90 gün kapılarına bağlıdır.

### Aktivasyon ön koşulları — herhangi biri açıkken silme açılmaz

1. **Hedef ve mevcut kaynak:** yalnız `hnujkabyyrlsxohjhxlg` main; dağıtılmış Janitor/RPC kaynak ve service-only izinleri mevcut onaylı paketle eşleşmeli. Eski staging hedefi/fallback kullanılmamalı. Kullanıcının A1 cihaz kabulü korunur; yeniden hesap silme testi gerekmez.
2. **Caller ve sır eşleşmesi:** `pg_cron`, `pg_net`, Vault ön koşulları yetkili operatörce doğrulanmalı. `a1_janitor_endpoint` yalnız main Janitor URL'si olmalı; `a1_janitor_authorization` Edge dedicated token'ıyla eşleşmeli. Token anon/user JWT/service-role anahtarı yerine bağımsız token olmalı; hiçbir client/public env'e girmemeli. Mevcut Vault adlarının veya eşleşmenin doğrulandığı bu görevde iddia edilmiyor.
3. **Kapsam:** Auth/fence/receipt/lease kanıtlarıyla silinebilecek adaylar güvenli operatör incelemesinden geçmeli. Mevcut dry-run yalnız found/skipped/errors sayaçları verir; silinebilir aday listesini/eligible sayısını ayrı sunmaz. Dolayısıyla yalnız `deleted=0` dry-run sonucu silme kapsamı onayı değildir. Mevcut kullanıcıların normal dosyaları ve aktif lease'ler kapsam dışında kalmalı.
4. **Kimlik doğrulamalı dry-run:** ayrı açık işlem onayıyla, bayrak false iken bir kez dedicated caller üzerinden çalıştırılmalı. Gerçek HTTP 200, errors=0, deleted=0, retentionDeleted=0 ve tamamlanma kaydı istenmeli. Bu görevde endpoint çağrılmadı.
5. **Süre ve eşzamanlılık:** mevcut sınırlar 200 sayfa / 1.000 nesne / 1.000 kök, çağrı başına upstream timeout 10 saniye. Bunlar toplam çalışma süresini 120 saniyenin altında garanti etmez. Gerçek inventory ile dry-run süresi caller'ın mevcut 120 saniye timeout'una ve Edge runtime sınırına marjla sığmalı. Sığmıyorsa aktivasyon durur; dar batching/deadline değişikliği ayrı onay gerektirir. Tek yetkili caller; aynı anda manuel çağrı/scheduler çakışması yok.
6. **Hata bildirimi:** mevcut kod HTTP durumunu ve kimliksiz JANITOR_RUN sayaçlarını üretir; tek başına bir bildirim kanalı oluşturmaz. Alarm alıcısı/kanalı ve izleme yöntemi kurulup doğrulanmalı. Cron SQL başarısı yalnız `net.http_post` kuyruğuna alındığını gösterebilir; net HTTP yanıtı ve Edge tamamlanması izlenmeli. Non-2xx, errors>0, HTTP timeout, cron başarısızlığı ve beklenen günlük tamamlanmanın yokluğu alarm vermeli. Kimlik/path/token/body alarmlara konmamalı.
7. **İdempotency sınırı:** mevcut testte ikinci koşu, ilkinde silinen adaylar yeniden listelenmeyince sıfır silme verir. Storage remove'un tekrar güvenliği ve taze eligibility kontrolleri vardır; endpoint için global exactly-once/tek iş lease'i iddia edilmez. Belirsiz timeout sonrası kör otomatik retry açılmaz; önce mevcut koşunun sonucu incelenir.
8. **Onay ve durdurma sahibi:** extension/job/Vault/caller/izleme ve silme bayrağı için açık production onayı; yetkili operatör ve durdurma sorumlusu belirlenmeli. Bu belge tek başına onay değildir.

### Dar operatör sırası — uygulanmadı

1. Yukarıdaki kapıları tamamla; mevcut `20261013_a1_kabin_janitor_schedule.sql` proposal'ını yalnız main için incele. Bu dosya bağımlılık/ad kontrolü yapar, secret/extension oluşturmaz ve işi **disabled** kurar; var olan işi overwrite etmez. Eksik altyapı ayrıca onaylı provisioning gerektirir.
2. Disabled iş ve false silme bayrağıyla tek authenticated dry-run + kapsam/süre/HTTP/alarm doğrulaması yap. Alarm kanalı henüz hazır değilse burada dur.
3. Tüm kapılar ve açık onay sonrası silme bayrağını true yapıp yalnız tek günlük işi etkinleştir: `0 2 * * *`, zaman dilimi UTC doğrulanmalı (Türkiye 05:00). İlk koşu operatör gözetiminde izlenmeli; HTTP sonucu ve sayımlar review edilen kapsamla karşılaştırılmalı.
4. Hata/taşma/beklenmeyen kapsamta önce yeni caller tetiklerini ve işi durdur, silme bayrağını false yap; uçuşta başlamış koşunun durduğunu/tamamlandığını ayrıca doğrula. Bayrağı kapatmak çalışan invocation'ın bellekte alınmış true değerini geri almaz. Belirsiz timeout'u otomatik tekrar ettirme.
5. Geri dönüş: yalnız bu isimli işi disable/unschedule et; gerekiyorsa onaylı önceki Edge kaynağı/config'ine dön. Vault/receipts/tombstone/UNKNOWN kayıtlarını silme veya resetleme. Storage remove geri alınamaz; durdurma planı silinen dosyaları geri getirmez.

**Janitor otomatik silme aktivasyonu: şimdilik NO-GO.** Caller/Vault eşleşmesi, güvenli kapsam, gerçek dry-run süresi ve çalışan hata bildirimi henüz kabul edilmedi. Yapılması gereken production adımları ayrı onay gerektirir; Janitor algoritması, SQL veya secret bu görevde değiştirilmedi.

## 4. VTON kabul sınırı

Main FASHN secret adı, mevcut Auth/quota/provider admission bağlantısı ve yerel sözleşme testleri gerçek FASHN başarısı değildir. Eksik kalan kabul: kullanıcı tarafından yetkilendirilmiş tek görsel/tek istekle gerçek FASHN sonucu alınması, sonuç görselinin çözümlenmesi ve mevcut AAB'de gösterilmesi, cihaza/history'ye kaydı ve yeniden açılışta okunması; provider hata/timeout/UNKNOWN halinde sessiz başarı veya otomatik yeniden ücretli çağrı olmaması.

Yeni A1 silme koşusu, hesap/JWT döngüsü veya kota doldurmak için 20 provider çağrısı planlanmıyor. Ücretli sonuç kabulü ayrı açık onayla tek seferde yapılmalı; yerel mock testleri o kapıyı kapatmaz. Kota 429 sınırı veya gerçek provider timeout'u bu görevde gerçekleşmiş kabul edilmez. Sağlayıcı saklama/silme davranışı teknik garanti diye sunulmaz.

## 5. Hedefli doğrulama ve dosyalar

- Fixture baseline: 4 PASS / 3 FAIL; `privacy-closure-isolation-before-20261020.json`.
- Limit RED: üç yeni reddetme assertion'ı beklendiği gibi başarısız; sınır/12 MiB kontrolleri geçti. `model-photo-limit-red-20261020.json` içindeki skip'ler yalnız bu RED aşamasının testNamePattern seçimidir.
- GREEN: **4 suite / 76 test PASS, 0 FAIL, 0 SKIP**. privacyClosure 7; accountStorageTransport 40; accountStorageRecovery 5; a1JanitorCompletion 24. `backend-final-narrow-tests-20261020.json`.
- Hedefli uygulama + değişen test TypeScript kontrolü geçti: `.tmp/tsconfig-backend-final-narrow.json`.
- Deno shared handler ve gerçek upload entry point frozen check geçti. İlk sandbox JSR erişimi başarısızdı; yetkili salt okunur bağımlılık erişimiyle entry point kontrolü exit 0 oldu. Deploy yapılmadı.
- Kök `tsc --noEmit` kontrolü önceden mevcut `tmp/google-dev-build-archive-20261014-verified/supabase/functions/**` arşivini de tarayıp Deno/JSR hataları verdi. Uygulama/değişen testler aynı derleyiciyle arşiv dışlanarak geçti; bu rapor kök tsc'yi temiz geçmiş diye sunmaz. Arşiv veya tsconfig kapsamı değiştirilmedi.
- İlk Jest denemesi sandbox TEMP cache rename EPERM ile test çalıştıramadı; mevcut workspace `.tmp/jest-profile` cache'i kullanılarak baseline ve hedef koşu tamamlandı. Ürün hatası sayılmadı.

Değişen uygulama/Edge/test kaynakları:

- `__tests__/privacyClosure.test.ts`: yalnız fixture reset.
- `__tests__/accountStorageTransport.test.ts`: altı limit sınır/regresyon testi.
- `services/accountStorageUpload.ts`: yerel model fotoğrafı sınır reddi.
- `supabase/functions/_shared/accountStorageUploadLimits.ts`: ortak sınır/kod/mesaj.
- `supabase/functions/_shared/accountStorageUploadHandler.ts`: stream sınırı ve açık 413 cevabı.

**AAB etkisi:** istemci servisindeki ve yeni ortak modüldeki değişiklikler uygulama bundle'ını etkiler; mevcut `vitrify-1.0.0-2.aab` bunları içermez ve değiştirilmedi. İstemci düzeltmesini yayınlamak ileride ayrı onaylı yeni AAB gerektirir; yalnız Edge değişikliği AAB oluşturmaz. 16 KB statik GO değişmedi. Main A1 kurulumu ve kullanıcının önceki cihaz silme kabulü tekrar edilmedi/geçersiz sayılmadı. Kalan somut kapılar: bu yerel düzeltmelerin onaylı dağıtımı, güvenli Janitor aktivasyonu, tek gerçek FASHN sonuç kabulü ve mevcut ayrı Play-imzalı/16 KB cihaz kabulü.

Production SQL/RLS/deploy/Cron/Janitor aktivasyonu, secret değişikliği, gerçek kullanıcı verisi veya hesap silme, ücretli provider çağrısı, staging, AAB build ve Play yüklemesi yapılmadı.
