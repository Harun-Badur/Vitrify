# Gizlilik Merkezi içerik tutarlılığı

Profil → Gizlilik ve Güvenlik artık uygulama içinde tam ekran Gizlilik Merkezi açar. Tam politika da aynı merkezde okunur; geri düğmesi ve Android sistem geri hareketi önce politika okuyucusundan merkeze, sonra Profil'e döner.

`PRIVACY_POLICY.md` tek metin kaynağıdır. `node scripts/generatePrivacyPolicy.cjs` bu metni `lib/privacyPolicyContent.ts` içine, tarih ve normalize edilmiş UTF-8 SHA-256 özetiyle paketler. `node scripts/generatePrivacyPolicy.cjs --check` eski paketlenmiş içeriği reddeder. Politika düzenlendiğinde üretim adımı yeniden çalıştırılmalıdır.

`privacyPolicyContent` testi kaynak metnin tamamını, tarihi, özeti ve daha önce herkese açık adresten doğrulanan yayımlanmış sürümün referans özetini karşılaştırır. Yeni politika sürümünde kanonik yayın ayrıca yetkilendirilip doğrulanmadan referans özet güncellenmemelidir. Yeni içerik yayımlama bu UI işinin parçası değildir. Ekran, içerik tarihini ve çevrimiçi metne açık bağlantıyı gösterir; çevrimdışı uygulama kendini her zaman en yeni çevrimiçi sürüm olarak tanıtmaz.

Mevcut sürüm: 20 Ekim 2026. Kanonik repo commit'i: `f7030563af928c1ce647fd6feffb2c061efdb0c0`. Metin özeti: `c96d4d7e4f68851bc63b396d5ee0468768335c7baca43b4d5ce0b933eed43807`.

`lib/privacy.ts` içindeki politika, destek ve harici silme bağlantıları korunmuştur. Tam politika okuyucusu ek bağımlılık veya WebView kullanmaz. Tablolar dar ekranda tüm hücreleri gösteren dikey kartlara dönüştürülür; içerik kırpılmaz.

Hesap silme seçeneği Profil'in mevcut `handleDeleteAccount` onay akışını çağırır. iOS'ta merkez kapandıktan sonra onay açılır. Yeni silme servisi, A1 değişikliği veya rıza/privacy-lifecycle yazımı yoktur. Tercihler mevcut genel tercih editörüne, cihaz izinleri gerçek sistem ayarlarına bağlanır. Yeni rıza/kişiselleştirme anahtarı oluşturulmamıştır.

## Bu görevde değişen dosyalar

- `app/(tabs)/profile.tsx`: harici menü yönlendirmesi yerine merkez açılışı; mevcut tercih/silme callback bağlantıları.
- `components/PrivacyCenter.tsx`: tam ekran merkez, beş bölüm, politika okuyucusu, geri navigasyonu ve bağlantı hataları.
- `lib/privacyPolicy.ts`: paragraflar, başlıklar ve mobil veri tablosu sunumu.
- `lib/privacyPolicyContent.ts`: kaynak belgenin tarih/özet içeren üretilmiş tam kopyası.
- `scripts/generatePrivacyPolicy.cjs`: üretme ve eski içerik kontrolü.
- `__tests__/privacyCenter.test.ts`, `__tests__/privacyPolicyContent.test.ts`: hedefli UI ve içerik regresyonları.
- Bu içerik iş akışı belgesi.

## Doğrulama

Beş hedefli Jest suite'inde 18 test geçti: merkez, politika metni, mevcut VTON disclosure/rıza ve Profil sibling key testleri. Son biçimlendirme/referans düzenlemesi sonrası merkez/içerik testlerinin dar tekrarında 8 test geçti; bu sayı önceki koşuyla örtüşür. Üretici `--check` kontrolü ve uygulama kaynakları/yeni testleri kapsayan `.tmp/tsconfig-privacy-center.json` ile TypeScript kontrolü geçti. Genel tsconfig'in daha önce saptanan geçici Deno arşivi hataları bu görevde yeniden taranmadı.

Tam politika açılışı dış bağlantı başlatmıyor. Dış kanonik adres ve harici hesap silme talebi ayrı, açık eylemlerde korunuyor. React testlerinde geri navigasyonu, gerçek cihaz ayarlarına delegasyon, mevcut silme/tercih callback'leri, kapalı işlem durumu ve iOS dismissal sırası doğrulandı. Fiziksel Android/iOS cihazında görsel kabul yapılmadı.

`PRIVACY_POLICY.md`, `lib/privacy.ts`, VTON disclosure, rıza, privacy-lifecycle ve A1 servisleri değiştirilmedi. Backend, SQL, production, EAS env, staging, build, deploy veya politika yayını yapılmadı. Mevcut çalışma ağacı değişiklikleri korunmuştur.
