# Backend, güvenlik ve A1

Supabase Postgres, RLS ve Edge fonksiyonlarından oluşur. Hesap silme A1’dir ve yalnız o işin kuralları `AGENTS.md` içindedir. Faz raporlarının çoğu yerel veya fake kanıttır. Staging SQL’in kurulu olup olmadığı, rapor “uygulanmadı” diyorsa öyledir; sonra kurulum raporu yoksa [doğrulanamadı].

Son güncelleme: 2026-10-27

## Tablolar ve RLS

Çekirdek: `products`, `product_attributes`, `liked_products`, `passed_products`, `user_events`, `user_style_profiles`, `profiles`, `users`, `price_alerts`, `discover_recommendation_cache`, `discover_recommendation_jobs`. Beğeni ve geçme `product_id` metindir; ürün tablosuna FK yoktur. [kodda doğrulandı: supabase/schema.sql; rapora dayanıyor: reports/backend/backend-open-issues-2026-10-10.md, madde 8]

`products` ve `product_attributes` için 2026-10-14 raporu anon/authenticated SELECT politikasında `qual=true` der. Bu, JWT ile sayfalama testi değildir. [rapora dayanıyor: reports/release/VITRIFY_V1_DISCOVER_CATALOG_PERFORMANCE.md]

Öneri önbelleği: istemci yazamaz; okuma `kind=final` ve sahip veya public kapsam. [kodda doğrulandı: supabase/migrations/20260929_discover_recommendation_cache.sql]

Dolap tabloları: 10 Ekim yok, 13 Ekim kurulum raporu var. `04` dosyasındaki çelişkiye bakın.

## Edge fonksiyonları

Kaynak ağaç: `recs-feed`, `delete-account`, `account-storage-upload`, `account-storage-janitor`, `account-storage-status`, `vton-proxy`, `vton-reconcile`, `wardrobe-cutout-control`, `premium-membership`, `revenuecat-webhook`. Deploy eşitliği 10 Ekim raporunda doğrulanamadı. [rapora dayanıyor: reports/backend/backend-open-issues-2026-10-10.md, madde 6]

`recs-feed`: JWT, `user_style_profiles`, katalog, 30 gün gösterim, `scoreCandidate`. `verify_jwt = true` yerel `config.toml` içindedir. Bu, yayındaki gövdenin kaynakla aynı olduğu anlamına gelmez.

Worker: `scripts/lib/supabaseRecommendationCache.ts` sahip doğrulamalı iş ile önbellek yazar. Genel kapsama yazmak reddedilir. Zamanlanmış bir öneri işçisinin canlıda çalıştığı [doğrulanamadı].

## A1 fazları

Tasarım `AGENTS.md` I1–I5 ve S1–S8. Sıra: fence, drain, sweep, doğrula, operasyon tablosu temizliği (`storage_resolutions`, sonra `storage_operations`, sonra `provider_operations`), Auth sil, tamamlandı. Hata olursa Auth silinmez. Bu adım 2026-10-27’de I3’e yazıldı. Önceki “I3 purge adını yazmaz” farkı giderildi. [kodda doğrulandı: AGENTS.md I3] Faz 4b aynı temizliği Auth öncesine koyar. [rapora dayanıyor: reports/backend/a1-phase4b-report-20261012.md]

| Faz | Rapor | Durum |
|---|---|---|
| 0 / temel | `reports/backend/account-deletion-*.md` (2026-10-10) | Sözleşme ve fence iskeleti. Ayrıntı o dosyalarda. |
| 1 | `a1-phase1-storage-runbook-20261011.md` | SQL önerisi hazır, “uygulanmamış” diye yazılmış. Kullanıcının staging doğrulaması Faz 2’de ön koşul kabul edilmiş. Güncel politika [doğrulanamadı]. |
| 2 | `a1-phase2-report-20261011.md` | Yerel kapılar. Staging SQL çalıştırılmamış. |
| 3 | `a1-phase3-report-20261011.md` | BLOCKED. Yazma sonrası fence sözleşmesi yoktu. |
| 3b | `a1-phase3b-report-20261012.md` | Handler telafisi ve SQL önerisi. SQL uygulanmadı, staging T2 yok. |
| 4 | `a1-phase4-stop-report-20261012.md` | Zaman damgası yok diye durdu. Yalnız SQL önerisi. Uygulanmadı. |
| 4b | `a1-phase4b-report-20261012.md` | Yerel fake testler geçti. “SQL önerileri uygulandı/çalıştırıldı” değil. Staging NOT RUN. |
| 5 | `a1-phase5-stop-report-20261012.md` | BLOCKED. Janitor zamanlaması ve Vault doğrulanamadı. S7 kapanmadı. |

4b koruması: remote upload kesin durmaz; 90 saniye ve iki boş ölçüm yetim nesne kanıtı değildir. Auth silindikten sonra fiş yazılamazsa geri alınamaz. [rapora dayanıyor: aynı 4b rapor, riskler]

## Bilinen güvenlik bulguları (2026-10-10)

Canlı ACL o gün ölçülmüş, bu paket sırasında ölçülmemiştir.

1. Kota: `consume_vton_quota` canlıda herkese EXECUTE göründü. Kaynak revoke eder. Öneri migration `2026100901_quota_execute_least_privilege.sql` “LOCAL PROPOSAL ONLY / NOT APPLIED”. [rapora dayanıyor: backend-open-issues madde 3] Güncel canlı ACL [doğrulanamadı].
2. İstemci idari yetkileri: anon/authenticated üzerinde TRUNCATE, TRIGGER, REFERENCES, MAINTAIN. RLS truncate’i kesmez. Öneri `2026100902_client_admin_privileges.sql` uygulanmadı diye yazılmış. [rapora dayanıyor: madde 2] Güncel [doğrulanamadı].
3. Ledger yalnız `20260929` ile örtüşür. Ürün genişlemesi, dolap, kota ve grant dosyaları ledger dışıdır. [rapora dayanıyor: madde 7]
4. Eski `delete-account` ile istemci protokolü uyuşmuyordu (GET 405). Sonraki A1 fazları protokolü değiştirdi. Yayındaki fonksiyon gövdesi [doğrulanamadı]. **ÇELİŞKİ riski:** kaynak yeni, deploy eski olabilir.
5. `recompute_profile` kaynakta `auth.uid()` ile başkasını reddeder. Canlı gövde eşitliği [doğrulanamadı]. [rapora dayanıyor: madde 5]

Satıcı ve yedek silmesi teknik doğrulama değildir; beyan olarak raporlanır. [kodda doğrulandı: AGENTS.md I5]

## Faz 0 izi

10 Ekim dosyaları temel sözleşme, cihaz temizliği, fence ve staging doğrulama denemeleridir: `reports/backend/account-deletion-hardening-2026-10-10.md`, `account-deletion-server-fence-2026-10-10.md`, `account-deletion-device-coverage-2026-10-10.md`, `account-deletion-staging-verification-2026-10-10.md` ve `2026-10-11` devamı. Hepsi “canlı silme yapılmadı” çizgisindedir. Tek tek test sayılarını bu özete kopyalamadım. Danışman faz iddiasını o dosyanın kendi “NOT RUN” satırından okumalı.

## Yazıcılar

Storage’a yazması beklenen Edge’ler: `account-storage-upload`, dolap kesimi ve deneme vekili. İstemci `profileService` model fotoğrafında doğrudan `remove` kullanır. Faz 1 raporu bunu I2’nin DELETE istisnası diye işaretler ve politikayı o fazda kaldırmaz. [rapora dayanıyor: reports/backend/a1-phase1-storage-runbook-20261011.md] Güncel politikada bu DELETE duruyor mu [doğrulanamadı].

`recs-feed` katalog okur, Storage yazmaz. Öneri önbelleğini istemci değil, sahip doğrulamalı worker yazar. [kodda doğrulandı: scripts/lib/supabaseRecommendationCache.ts, 27–30]

## Açık A1 işi, kısa

Faz 4b SQL ve staging dumanı uygulanmadı diye yazılmış. Faz 5 janitor, 24 saat / en az 2 deneme / 90 gün mezar taşı kararını kodlamadı. S7 kapanmadı. Sadeleştirme bu kapıdan sonra gelir. [rapora dayanıyor: reports/backend/a1-phase5-stop-report-20261012.md]

## Senaryo durumu, rapor diliyle

S1–S8 `AGENTS.md` içindedir. Kapanış iddiası ancak ilgili faz raporu “geçti” diyorsa alınır. Bu paket her T testini yeniden koşmadı.

| Senaryo | Mekanizma | Raporların bıraktığı yer |
|---|---|---|
| S1 başka cihaz yazar | istemci yazma yok + fence | Faz 1 politikası staging’de yeniden okunmadı |
| S2 uçuştaki yazma | yazı sonrası kontrol + sweep | Faz 3b SQL uygulanmadı, T2 yok |
| S3 yarıda çökme | durum makinesi, Auth silinmez | Yerel fake; staging değil |
| S4 çift istek | atomik geçiş | Faz 4b fake |
| S5 imzalı URL / TUS | politika yok | Canlı politika [doğrulanamadı] |
| S6 arka plan yazarı | kod araması | Öneri worker Storage yazmaz |
| S7 yazıcı çöker | janitor | Faz 5 BLOCKED |
| S8 satıcı / yedek | beyan | Teknik doğrulama yok |

## Ne kanıt sayılır

Fake RPC PASS, staging PASS değildir. “SQL önerisi yazıldı” ifadesi migration’ın işlendiği anlamına gelmez. Ledger’da görülen tek örtüşen dosya 10 Ekim raporunda `20260929`’dur. Dolap, kota ve grant dosyaları o raporda ledger dışıdır. [rapora dayanıyor: reports/backend/backend-open-issues-2026-10-10.md, madde 7]

`recs-feed` `config.toml` içinde `verify_jwt = true` olabilir. Bu satır, yayındaki fonksiyonun aynı gövde olduğunu kanıtlamaz. [doğrulanamadı: deploy]

A1 işi Discover, öneri motoru ve ürün/feed koduna dokunmaz. Insight chip ürün kararıdır; A1 yetkisi onu açmaz. `11`.

## İlkeler, bu dosyada

Ayrıntı `AGENTS.md` ve `11` dosyasındadır. Kısa hali:

- I1. Kullanıcı tabloları `auth.users` silinince FK ile gider. Koordinasyon DB için gerekmez.
- I2. Storage yazıcısı Edge’dir. İstemci INSERT/UPDATE/DELETE politikası ve imzalı yükleme URL’si / TUS hedeflenmez. Faz 1, model fotoğrafı `remove` istisnasını o fazda kaldırmadı.
- I3. fence, drain, sweep, doğrula, operasyon tablosu temizliği (`storage_resolutions` → `storage_operations` → `provider_operations`), Auth sil, tamamlandı. Hata olursa Auth silinmez. [kodda doğrulandı: AGENTS.md I3]
- I4. Yükleme fence’i yazmadan önce ve sonra kontrol eder. Günlük janitor hedeflenir. Faz 5 zamanlaması BLOCKED.
- I5. Satıcı ve yedek silmesi beyandır.

Yeni tehdit uydurulmaz. S1–S8 dışına kontrol eklenmez.
