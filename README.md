# Vitrify

Vitrify, moda ürünlerini keşfetme, favorilere kaydetme, kişisel dolap oluşturma ve sanal deneme için geliştirilmiş Expo / React Native uygulamasıdır. Expo görüntüleme adı `Vitrify`, npm paket adı `vitrify` olarak yapılandırılmıştır. Mevcut uygulama kimlikleri, EAS proje bağlantısı ve `kabin://auth` deep link korunur. Depo, yerel klasör ve Supabase görünen adı için [güvenli marka geçişi](docs/brand-transition.md) adımlarını izleyin.

## Mevcut özellikler

- Kaydırılabilir ürün keşfi; arama, kategori ve ürün filtreleri.
- Supabase oturum yönetimi, profil, favoriler ve geçilen ürünler.
- Stil/beden tercihleri, ürün önerileri ve katalog/dolap temelli kombin seçimi.
- Fotoğrafla kişisel dolap kaydı ve kayıtlı kombinler. Kayıtlar cihazda kullanıcıya bağlı tutulur; `services/wardrobeCloudPersistence.ts` bulut anlık görüntüsü, bekleyen yazma ve çakışma durumunu yönetir.
- FASHN Try-On Max üzerinden sanal deneme ve deneme geçmişi.
- İsteğe bağlı self-hosted Python cutout servisi. Ayrı Android on-device modül `modules/vitrify-on-device-cutout` altındadır, varsayılan olarak kapalıdır ve yalnızca geliştirme derlemesinde kullanılır.
- Hesap silme akışı istemcide ve `delete-account` Edge Function içinde vardır. İlgili Storage fonksiyonları depoda tanımlıdır. Bu belge üretimde silme veya migration çalıştırmaz.
- Premium üyelik kodu RevenueCat istemcisi ve üyelik Edge Function'ları ile vardır. İstemci `EXPO_PUBLIC_PREMIUM_ENABLED=true` olmadan bu akışı açmaz.
- Mağaza ürün bağlantıları ve yapılandırılabilir affiliate parametreleri.
- Katalog import/seed araçları, fiyat düşüşü simülasyonu ve Expo bildirim token kaydı. Otomatik fiyat izleme servisi varsayılmamalıdır.

## Teknoloji

Mevcut `package.json`: Expo 57, React Native 0.86.3, React 19.2.3, TypeScript 6.0.3, Expo Router, Zustand, AsyncStorage, Supabase JS 2.45.4, Reanimated 4.5.1, Gesture Handler, `react-native-purchases` 10.14.0 ve isteğe bağlı Sentry. Jest / jest-expo ve ESLint geliştirme kontrolleri için kullanılır. Kesin sürümler `package-lock.json` içindedir. Python cutout servisi rembg ve CPU U2-Net kullanır. Android on-device modül yerel ONNX Runtime paketini kullanır.

## Proje yapısı

| Dizin | İçerik |
| --- | --- |
| `app/` | Expo Router ekranları; sekmeler, auth ve dolap rotaları |
| `components/`, `hooks/` | Arayüz bileşenleri ve oturum hook'ları |
| `services/`, `lib/` | Veri erişimi, entegrasyonlar ve yardımcı fonksiyonlar |
| `store/`, `types/` | Zustand domain slice'ları ve TypeScript tipleri |
| `src/intelligence/` | Ürün arama/filtreleme, öneri ve kombin hesaplamaları |
| `src/recommendationCache/` | Fingerprint, codec, paket ve bellek önbelleği |
| `supabase/` | Temel SQL dosyaları, migrations, Edge Functions ve RLS testleri |
| `scripts/`, `data/` | Katalog araçları ve örnek/mock veri |
| `assets/`, `__tests__/` | Uygulama görselleri ve testler |
| `services/wardrobe-cutout/` | İsteğe bağlı Python HTTP servisi |
| `modules/vitrify-on-device-cutout/` | Varsayılanı kapalı Android on-device cutout modülü |
| `docs/` | Mimari, geliştirme ve yayın notları |

## Kurulum ve yerel geliştirme

Node.js ve npm kurulu olmalıdır. `package.json` bir `engines` alanı tanımlamaz. Bu senkronizasyon kontrolü Node.js 24.13.0, npm 11.6.2 ve TypeScript 6.0.3 ile yapılmıştır.

```bash
npm ci
```

PowerShell'de `Copy-Item .env.example .env`; diğer kabuklarda `cp .env.example .env` çalıştırın. Gereken değerleri yalnızca yerel `.env` dosyasında doldurun, ardından:

```bash
npm start
npm run android
npm run ios
```

Android için cihaz veya emülatör gerekir. Yerel iOS simulator/build için macOS ve Xcode gerekir; Windows'ta uygun fiziksel cihaz veya EAS cloud build kullanın. Expo Go uyumluluğu kullanılan SDK/native modüllere bağlıdır; development build gerekebilir. Metro önbelleğini temizlemek için `npx expo start --clear` kullanılabilir.

### Environment variables

`.env.example` gerçek değer içermez. Üç çalışma ortamını ayrı yapılandırın:

| Ortam | Değişkenler |
| --- | --- |
| Mobil istemci | `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`, `EXPO_PUBLIC_VTON_PROXY_URL`, `EXPO_PUBLIC_RECS_FEED_URL`, `EXPO_PUBLIC_WARDROBE_CUTOUT_URL`, `EXPO_PUBLIC_AFFILIATE_TAGS_JSON`, `EXPO_PUBLIC_SENTRY_DSN`, `EXPO_PUBLIC_PREFERENCE_V2_ENABLED`, `EXPO_PUBLIC_PREMIUM_ENABLED`, `EXPO_PUBLIC_REVENUECAT_IOS_KEY`, `EXPO_PUBLIC_REVENUECAT_ANDROID_KEY`, `EXPO_PUBLIC_PREMIUM_TERMS_URL`, `EXPO_PUBLIC_PREMIUM_SUPPORT_URL`, `EXPO_PUBLIC_WARDROBE_ON_DEVICE_CUTOUT` |
| Node import/cache araçları | `EXPO_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, gerektiğinde `EXPO_PUBLIC_SUPABASE_ANON_KEY`, `AFFILIATE_TAGS_JSON` |
| Supabase Edge Functions | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY`, `FASHN_API_KEY`; isteğe bağlı FASHN, üyelik, RevenueCat ve hesap silme değişkenleri `.env.example` içindedir |
| Python cutout servisi | `SUPABASE_URL`, `SUPABASE_ANON_KEY`; isteğe bağlı `HOST`, `PORT`, `WARDROBE_CUTOUT_MODEL`, `WARDROBE_CUTOUT_V1_REQUESTS_PER_MINUTE`, `WARDROBE_CUTOUT_V2_ENABLED`, `CUTOUT_V2_FUNCTIONS_BASE` |

`EXPO_PUBLIC_*` değerleri istemci bundle'ına gömülür. Anon key yalnızca RLS ile kullanılmalıdır; service-role key, FASHN anahtarı ve private credential bu prefix ile tanımlanamaz. Sunucu secretlarını mobil build ortamından ayrı tutun. Sentry DSN boşken Sentry başlatılmaz. Feed adresi boşsa kod mevcut proxy/Supabase adresinden türetmeyi dener. Cutout adresi tanımlı değilse arka plan silme tamamlanmaz.

### Supabase ve Try-On

`lib/supabase.ts` istemci bağlantısını kurar. Canlı kullanımda uygun Supabase schema, RLS, auth ayarları ve Storage gerekir. Temel SQL dosyaları migration klasöründen ayrı olduğundan yeni projede yalnızca migrations çalıştırmak tam kurulum sağlamaz; [deployment notlarını](docs/deployment.md) okuyun.

`vton-proxy`, kullanıcının oturumunu doğrular, kota uygular ve FASHN isteğini sunucudan gönderir. FASHN anahtarı yalnızca Edge Function secret store'da tutulur. Depodaki diğer Edge Function dizinleri `recs-feed`, `delete-account`, `premium-membership`, `revenuecat-webhook`, `vton-reconcile`, `wardrobe-cutout-control`, `account-storage-upload`, `account-storage-status` ve `account-storage-janitor` fonksiyonlarıdır. Bir fonksiyonun depoda bulunması onun üretimde açık olduğu anlamına gelmez. Gerçek API çağrıları ve veri yazan scriptler test hesabı veya ayrı bir proje üzerinde kontrollü çalıştırılmalıdır. Üretim veritabanına bu senkronizasyon kapsamında bağlanılmaz ve migration uygulanmaz.

### Web durumu

`npm run web` ve favicon yapılandırması bulunur; bu repo doğrulanmış bir web deployment sunmaz. `react-dom` ve `react-native-web` doğrudan dependency olarak tanımlı değildir. Native dosya, kamera ve bildirim davranışları ayrıca test edilmeden web parity varsayılmamalıdır. Bu hazırlıkta dependency eklenmemiştir.

## Kontroller

```bash
npm run lint
npm test -- --runInBand
npx tsc --noEmit
```

Bazı native servis/bileşen testlerinin ayrıca izole Jest config'leri vardır; [development dokümanına](docs/development.md) bakın. SQL RLS testleri migrate edilmiş ayrı bir PostgreSQL ortamı gerektirir. Bu komutların bulunması mevcut projenin tüm kontrollerden geçtiği anlamına gelmez.

## Production ve güvenlik

`eas.json` development, preview ve production ortamlarını seçer; gerçek bağlantı değerleri repo içinde tutulmaz. Build öncesinde ilgili EAS ortamında istemci değişkenlerini tanımlayın. Android preview APK, production AAB üretir; submit ayarı internal track / draft'tır. [Yayın adımları ve kalan ön koşullar](docs/deployment.md) belgelenmiştir.

`.env*`, credentials, signing keys, `node_modules`, `.tmp/`, `reports/`, Expo/build/cache dosyaları ve yerel test çıktıları ignore edilir. Yalnızca boş `.env.example` takip edilir. EAS tokenları, keystore ve sunucu secretlarını commit etmeyin. Git geçmişinde daha önce yer almış değerler yeni commit ile geçmişten silinmez; [SECURITY.md](SECURITY.md) içindeki geçmiş bulgusunu okuyun. Gizli bilgi bildiriminde değeri herkese açık issue veya pull request içine yazmayın. Mevcut destek adresi `lib/privacy.ts` içindeki `SUPPORT_EMAIL` değeridir.

## Katkı ve geliştirme kuralları

Küçük, açıklanabilir değişiklikler yapın; dependency migration, UI/UX, öneri motoru veya schema değişikliklerini ayrı kapsamda inceleyin. `npm ci` ile lockfile'ı kullanın; ilgili test/lint/typecheck sonucunu PR'a ekleyin. Commit öncesinde diff ve secret kontrolü yapın. Kişisel fotoğraf, kullanıcı export'u, import raporu ve erişim bilgisi eklemeyin. Force push veya history rewrite ancak depo sahibinin açık onayıyla yapılmalıdır.

Lisans: [LICENSE](LICENSE). Gizlilik metni: [PRIVACY_POLICY.md](PRIVACY_POLICY.md).
