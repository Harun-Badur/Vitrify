# Vitrify 1.0 — Google Play Internal Testing hazırlığı

20 Ekim 2026. Sonuç: **hazırlık tamamlandı; dağıtım için aşağıdaki doğrulamalar bekleniyor.** AAB üretilmedi, imza oluşturulmadı/değiştirilmedi, EAS/Play Console/Supabase ortamına bağlanılmadı. Eski staging kullanılmadı. Bu belge komutları çalıştırma veya yayın yetkisi değildir.

## Korunan kimlik ve mevcut profiller

`com.kabin.app`, sürüm `1.0.0`, scheme `kabin`, Expo slug `kabin`, mevcut EAS projectId/owner ve main Supabase bağlantısı korunuyor. `app.json`, `eas.json` ve env dosyaları değiştirilmedi.

| Profil | Çıktı / dağıtım | Bu iş için karar |
|---|---|---|
| development | development client, internal APK, development env | Play için kullanma |
| preview | internal APK, preview env, V2=true | Play AAB yerine geçmez |
| production | app-bundle, production env, autoIncrement=true | İmzalı Play AAB için mevcut doğru profil |
| submit.production | internal track, draft | Yükleme otomasyonu tercihi; çalıştırılmadı |

`cli.appVersionSource=local`; mevcut Android versionCode=1. Operatör build öncesinde Play'deki en yüksek versionCode'u kontrol etmeli. Auto-increment sonucu yeni kod bu değerden büyük olmalı; ilk AAB'nin kodunun mutlaka 1 olacağı varsayılmamalı. İmza credential'ının mevcut EAS projesinde bulunması ve varsa Play upload sertifikasıyla eşleşmesi uzaktan doğrulanmadı. Gereksiz yeni keystore üretmeyin.

## Release public env kontrolü

Yerel değerler yazdırılmadan yalnız varlık, boolean bayraklar ve bağlantı eşleşmeleri incelendi. `.env` ve `.env.local` Supabase URL'leri `supabase/config.toml` ile bağlı main projesinin hostuyla eşleşiyor. Public API key mevcut ve publishable key biçiminde; canlı çalışırlık doğrulaması yapılmadı. Anahtarlar bu belgede yoktur.

`.easignore` `.env*` dosyalarını dışlıyor. Yerel Expo Go başarısı EAS production ortamının hazır olduğunu kanıtlamaz. EAS bulut env değerleri okunmadı. Public değişkenler derlenmiş uygulamadan okunabilir; sunucu secret'larını bu alana koymayın. [Expo env davranışı](https://docs.expo.dev/guides/environment-variables/), [EAS env](https://docs.expo.dev/eas/environment-variables/usage/).

| Değişken | Operatörün production ortamında doğrulayacağı durum |
|---|---|
| EXPO_PUBLIC_SUPABASE_URL | Mevcut main URL; yeni veya eski staging ile değiştirme |
| EXPO_PUBLIC_SUPABASE_ANON_KEY | Aynı main projesinin mevcut public/publishable anahtarı; service-role değil |
| EXPO_PUBLIC_PREFERENCE_V2_ENABLED | **true**: preview'da ve `.env.local` içinde açık; production profilinde açıkça tanımlı değil. Bulutta doğrulanmadan V2 release hazır sayılamaz |
| EXPO_PUBLIC_PREMIUM_ENABLED | **false**: ilk internal sürümde ödeme kapalı kalmalı; yerelde eksik olması zaten kapalı davranır, bulut ayrıca doğrulanmalı |
| EXPO_PUBLIC_VTON_PROXY_URL | Ayrı endpoint gerekiyorsa mevcut main `/functions/v1/vton-proxy`; boşsa kod main URL'den türetir |
| EXPO_PUBLIC_RECS_FEED_URL | Gerekliyse mevcut main recs-feed; boşsa kodun mevcut türetme davranışı kullanılır |
| EXPO_PUBLIC_WARDROBE_CUTOUT_URL | Yerel `.env` değeri **HTTP**, release kodu bunu reddeder. Bu adresi buluta kopyalama. Uygun mevcut HTTPS hizmeti yoksa otomatik arka plan silmeyi çalışıyor diye sunma |
| EXPO_PUBLIC_REVENUECAT_ANDROID_KEY | Bu sürüm için gerekli değil; tek başına ödeme açmaz. Anahtarı rapora/loga ekleme |
| EXPO_PUBLIC_PREMIUM_TERMS_URL / SUPPORT_URL | Ödeme açılmadığı sürece satın alma gereksinimi değil; sahte URL koyma |
| EXPO_PUBLIC_SENTRY_DSN | Opsiyonel; yerelde yok. Bulutta varsa veri işleme beyanı ve hata filtrelemesi ayrıca eşleşmeli |

V2'nin yalnız mobil bayrağı yeterli değildir: mevcut okuyucu sunucu `style_profile_v2` algoritmasını, `legacy_policy`, geçiş zamanını ve hesaplanan satırın güncelliğini denetler. Mevcut writer etkinliği ve bu durumların main'deki karşılığı doğrulanmadı. Bunları değiştiren SQL/deploy hazırlanmıyor.

VTON explicit URL'si hesap silme endpoint'inin türetilmesini de etkileyebilir (`services/accountService.ts`). Başka hosta ait override bırakılmamalı; değişiklik yapılmadı.

## Google OAuth ve Play App Signing

Bu projede Google girişi native Google Sign-In SDK'sı değil, `signInWithOAuth` + sistem tarayıcısı + `kabin://auth?attempt=...` dönüşüdür. Bu nedenle mevcut akışa sırf Play'e çıkılıyor diye Android OAuth client/SHA bağımlılığı eklemek gerekmez. Gereken doğrulama:

- Mevcut main Supabase Google provider, Web OAuth client ve provider ayarları çalışır durumda olmalı. Google tarafındaki authorized redirect URI main projenin Auth callback adresi olmalı.
- Supabase redirect allowlist mevcut `kabin://auth` ve dinamik `attempt` query parametresini kabul etmeli. Mevcut kurala uygun dar eşleşme doğrulanmalı; burada yeni wildcard/ayar uygulanmadı.
- Consent ekranı Google'da test modundaysa gerçek test hesapları izinli olmalı. Play test listesine eklenmek Google OAuth test kullanıcısı erişimi yerine geçmez.
- Expo Go sosyal girişi kod tarafından engelleniyor; geçerli kanıt Play'den kurulan release üzerinde tarayıcı dönüşü, iptal ve yeniden giriş testidir.

[Supabase Google OAuth](https://supabase.com/docs/guides/auth/social-login/auth-google), [native redirect](https://supabase.com/docs/guides/auth/native-mobile-deep-linking).

Play, yüklenen AAB'nin upload imzasından farklı bir **app signing key** ile dağıtılan APK'ları imzalar. İleride native Google SDK veya imzaya bağlı başka API kullanılırsa `com.kabin.app` + **Play App Signing sertifikasının SHA-1** bilgisi ilgili Android OAuth client'ta bulunmalı; yalnız EAS upload SHA-1 yeterli değildir. Yerel kurulum testleri için upload/debug sertifikalarının ayrı kayıtları gerekebilir. SHA-256, doğrulanmış HTTPS App Links kullanılırsa assetlinks için önemlidir; mevcut custom scheme için yeni assetlinks dosyası gerekmez. Sertifika/özel anahtar okunmadı veya değiştirilmedi. [Google imza ayrımı](https://support.google.com/googleplay/android-developer/answer/9842756), [Expo App Links](https://docs.expo.dev/linking/android-app-links/).

## Premium hazırlığı

Yerelde Premium bayrağı ve Android RevenueCat anahtarı yok; mevcut guard ödeme SDK'sını açmıyor. Buna rağmen ekranda devre dışı satın alma/restore/manage düğmeleri görünüyordu. En küçük yerel UI düzeltmesiyle `state.configured=false` iken paketler, satın alma düğmesi, otomatik yenileme metni ve mağaza işlemleri gizlendi. Üyelik bilgi kartı ve hazır olmadığı açıklaması duruyor. Yapılandırılmış Premium davranışı testle korundu. Backend, kota veya A1 lifecycle değiştirilmedi.

## İlk dağıtımdan önce gerçek riskler ve kanıt sınırı

| Alan | Mevcut bulgu | Yayın kapısı |
|---|---|---|
| EAS production env | Bulut değerleri doğrulanmadı; V2 yalnız preview'da sabit | Main public env + V2=true + Premium=false operatör kontrolü |
| Google Auth | Tarayıcı akışı, attempt doğrulaması ve oturum değişimi koruması mevcut; yerel test geçti | Play kurulumunda giriş, iptal, dönüş, e-posta girişi ve yeniden açılış |
| Kullanıcı izolasyonu | Sahiplik kontrollü snapshot/yazıcı testleri geçti | Sentetik A/B hesaplarıyla aynı cihazda geçiş; önceki kişinin profil/favori/dolap/fotoğrafı görünmemeli |
| Hesap silme / A1 | Yerel gateway/yazıcı testleri geçti; main dağıtılmış kod/RLS/janitor durumu doğrulanmadı. Eski staging raporu main kanıtı değildir | Main için mevcut kanıtı operatör doğrulasın; silme testi ancak ayrı açık yetkiyle sentetik hesapta. Gerçek hesap silme/SQL/deploy burada yapılmadı. A1_DEPENDENCY: doğrulama gereksinimi, kod değişikliği yok |
| VTON | Kod FASHN çağrısını destekliyor; API anahtarı/admission/kota/main endpoint durumu bilinmiyor | Gerçek fotoğraf kullanımından önce hizmet ve A1 sağlayıcı kapıları doğrulanmalı; hazır değilse özelliğin kullanılamadığı açık olmalı |
| Gizlilik | Yerel politika sağlayıcıya fotoğraf gönderilmediğini söylüyor; kod gönderimi ve kaydedilen model fotoğrafını destekliyor. Bu kesin bir metin/kod kapsam uyuşmazlığıdır, dağıtılmış davranış kanıtı değildir | Aktif özelliklerle metin eşleşmeden gerçek kişi fotoğraflarıyla test başlatma |
| VTON rızası | `lib/consent.ts` tek cihaz anahtarı kullanıyor, hesap kimliği/metin sürümü yok | Paylaşılan cihazda A/B hesabı ve ilk fotoğraf aktarımı akışını kontrol et; bu incelemede rıza sistemi değiştirilmedi |
| Cutout | Yerel HTTP adresi release tarafından reddedilir | Çalışan HTTPS adresi yoksa bu özelliği test kapsamı dışında açıkça belirt |
| Destek ve web silme | `lib/privacy.ts` destek adresinde yayın öncesi TODO var; web linki GitHub politika sayfasına anchor | Adresin çalışması ve erişilebilir silme talep yolu operatör tarafından teyit edilmeli; anchor tek başına çalışan talep sistemi kanıtı değil |
| Android binary | AAB yok; son manifest, target SDK, native kütüphaneler ve imza henüz ölçülemez | Son AAB üzerinde API hedefi, 16 KB uyumluluğu, release/debuggable ve versionCode kontrolü |

20 Ekim 2026 itibarıyla yeni uygulamalar/güncellemeler için API 36+ hedefi gerekir; Internal Testing, kalıcı kurumsal özel dağıtım istisnasıyla aynı değildir. Native bağımlılıklar için 16 KB uyumluluğu son bundle üzerinde doğrulanmalı. SDK 57/RN 0.86 kullanılması tek başına son artifact kanıtı değildir. [Hedef API](https://developer.android.com/google/play/requirements/target-sdk), [16 KB kontrolü](https://developer.android.com/guide/practices/page-sizes).

## Minimum dosyalar ve operatör sırası

Bu hazırlıkta yeni mağaza görseli veya sahte tester listesi üretilmedi. Mevcut `assets/store/google-play-512.png` ikon kaynağıdır; paket içine gerçek AAB henüz eklenmedi. İlk internal test, tam mağaza sayfası tamamlanmadan başlatılabilir; yalnız internal track'te kalan uygulamalar Data safety formu bakımından istisnalıdır. Bu, yanlış gizlilik beyanını doğru yapmaz. [Google Internal Testing](https://support.google.com/googleplay/android-developer/answer/9845334).

Asgari yükleme: sonradan üretilecek imzalı `.aab`; aşağıdaki hazır sürüm notu metni; operatörün gerçek tester e-postaları/Google Group seçimi ve çalışan geri bildirim adresi. Gerçek AAB olmadan yayın paketi tamamlanmış değildir. Tam listeleme istendiğinde 512 ikon, feature graphic, gerçek cihaz ekran görüntüleri ve doğru açıklamalar ayrıca tamamlanır; bu görev bunların var olduğunu iddia etmez.

1. Bu belgedeki env ve işlev kapılarını doğrula. Play Console hesabının kimlik doğrulaması/uygulama erişimi ve `com.kabin.app` kaydını kontrol et. Mevcut paket adına başka uygulama açma.
2. EAS production ortamında mevcut main URL/public key, V2=true ve Premium=false kontrolü yap. Yerel `.env.local` dosyasının buluta gittiğini varsayma. Anahtarları terminale/rapora kopyalama.
3. Mevcut upload credential'ını koru. Play App Signing durumunu ve Play'deki en yüksek versionCode'u kaydet; özel keystore'u repository'ye koyma.
4. **Yalnız daha sonra ayrı build yetkisi verildiğinde:** `eas build --platform android --profile production`. `--auto-submit` ekleme. Komut bu görevde çalıştırılmadı. Build sonucu son packageId, versionCode, imza, API hedefi ve native uyumluluğunu kontrol et.
5. İmzalı AAB'yi indir. Play Console → Test and release → Testing → Internal testing → Create release. Mevcut uygulamada Play App Signing adımını uygun şekilde tamamla; başka imza oluşturma/değiştirme gereksinimini varsayma.
6. AAB'yi yükle, `play-internal-release-notes-tr-TR.txt` içeriğini tr-TR alanına yapıştır, önce taslakta incele. Play Console'un bu uygulama/hesap için istediği eksik zorunlu alanları tamamla. Manuel yüklemede service-account JSON gerekmez; EAS Submit otomasyonu seçilirse ayrı yetkilendirme gerekir. [Expo manuel yükleme](https://docs.expo.dev/submit/android-manual/).
7. Testers alanında gerçek listeyi seç ve geri bildirim adresini ekle. Listeyi/CSV'yi değiştirirken mevcut test kullanıcılarını yanlışlıkla silme. Internal Testing en fazla 100 tester içindir; Internal App Sharing ile karıştırma.
8. **Ayrı dağıtım yetkisiyle** internal rollout başlat. Opt-in bağlantısını yalnız yetkili test grubuyla paylaş; bu görevde mesaj/e-posta gönderilmedi.
9. Play üzerinden kurulumda Auth, A/B izolasyonu, kayıtlı verinin yeniden açılması, Profil, beğeni/swipe, Premium'da satın alma olmaması ve VTON'un güvenli davranışını kontrol et. Hesap silme gibi yıkıcı testler yalnız ayrı yetkili sentetik hesapta. Sonuçları kaydet; Internal Testing production erişim şartlarının yerine geçmez.

## Çalıştırılan kontroller ve değişen dosyalar

İlk hedefli koşu: 7 Jest suite / 56 test geçti (`socialAuth`, `userSnapshotSource`, `accountDeletionWriters`, `accountDeletionGatewayAuth`, `vtonEdgeContract`, `premiumMembershipUI`, `styleProfileFreshness`). Premium UI değişikliği önce başarısız testle gösterildi; sonrasında `premiumMembershipUI` + `revenueCatMobile`: 2 suite / 7 test geçti. Sayılar örtüşür, toplanmamalıdır.

Uygulama kaynaklarını kapsayan mevcut `.tmp/tsconfig-profile.json` ile TypeScript kontrolü geçti. Edge kodu değişmedi; Deno yeniden çalıştırılmadı. Testler cihaz, Play imzası veya main backend uçtan uca kanıtı değildir.

Değişiklikler: `components/PremiumMembership.tsx`, `__tests__/premiumMembershipUI.test.ts`, bu belge ve `docs/releases/play-internal-release-notes-tr-TR.txt`. Mevcut EAS profilleri/package/main bağlantısı, Auth, A1, VTON ve Style Intelligence kodu korunuyor. Production/staging/backend değişikliği, SQL, deploy, mağaza yüklemesi veya build yok.
