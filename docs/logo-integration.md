# Vitrify 1.0 logo entegrasyonu

Kaynak: `assets/Vitrify Logosu.png` (1254×1254). Orijinal dosya korunmuştur.
SHA-256: `6ea66b242a03f7ea803ef737789a66ca7bf1404ac8c07b8afca4ced28b8cea85`.

## Çıktılar ve entegrasyon

- `assets/icon.png`: 1024×1024, opak; Android/iOS standart ikon. Kaynak görselin tamamı, oranları korunarak küçültüldü.
- `assets/store/google-play-512.png`: 512×512 opak PNG.
- `assets/store/app-store-1024.png`: 1024×1024 opak PNG; köşeler önceden yuvarlatılmadı.
- `assets/android-icon-foreground.png`: 1024×1024, saydam beyaz yazı katmanı. Kaynak kırmızı zeminden beyaz yazının alfa silueti çıkarıldı; yazı yeniden çizilmedi. Yazı dikdörtgeni köşegeni 590 px, güvenli daire çapı 625.8 px (66/108). Tüm anlamlı alfa pikselleri bu daire içinde doğrulandı.
- `assets/android-icon-monochrome.png`: aynı güvenli yerleşimde beyaz alfa silueti; Android temalı ikon.
- `assets/splash-icon.png`: aynı saydam yazı; Expo splash arka planı #FE382B, imageWidth 240, contain.
- `assets/brand-logo.png`: 800×521; orijinal kırmızı zemin ve beyaz yazı korunarak dış boşlukları azaltılmış türev. `app/auth.tsx` ortak giriş/kayıt marka alanında 200×130 contain ile gösterilir, erişilebilir etiketi vardır.
- `assets/favicon.png`: 64×64; eski marka ikonu yenilendi.
- `assets/notification-icon.png`: beyaz saydam siluet; eski K görseli değiştirildi.
- `assets/store/branding-preview.png`: 48/64/96/128 px standart ikon ve daire maskeli önizleme. Tam yazı 48 px ve bildirim boyutunda ince kalır; özgün logoyu değiştirmemek için ayrı bir harf işareti tasarlanmadı.

Üretim: `node scripts/generate-branding.cjs`. Kaynağa yazmaz, premultiplied alpha ile alan ortalamalı küçültme kullanır; JPEG ara dosyası veya üretken yeniden çizim yoktur. Mevcut node_modules içindeki pngjs kullanılır; paket/lock dosyası değiştirilmedi.
Doğrulama: `node scripts/check-branding.cjs`.

`app.json` değişikliği yalnız splash arka planı ve imageWidth değerleridir; mevcut ikon yollarındaki dosyalar yenilendi. Google OAuth kodu/ayarları, kabin://auth, scheme kabin, app.kabin.mobile, com.kabin.app, EAS proje kimliği ve işlevsel auth akışı değiştirilmedi.

## Dar kontroller

- PNG boyutları, mağaza ikonlarının tam opaklığı, adaptive güvenli daire ve kimlik kontrolleri: geçti.
- Kaynak SHA-256 korunumu: geçti.
- `expo config --type public --json`: çözümlendi; ikon/splash yolları ve kimlikler doğrulandı.
- Jest authScreen + socialAuth: 2 suite, 14 test geçti. İlk çalıştırmada sandbox önbelleği EPERM; proje içi önbellekle tekrarlandı. İlk dönüşüm sırasında 5 sn timeout sonrası 30 sn sınırıyla set tamamen geçti.
- `tsc --noEmit`: yalnız tmp/google-dev-build-archive-20261014-verified altındaki mevcut Deno kopyaları nedeniyle başarısız. Aynı tsconfig geçici tmp ve .tmp dizinleri hariç TypeScript API ile çalıştırıldığında 0 hata; tsconfig değiştirilmedi.
- Değişen auth ekranı ESLint kontrolü: geçti. Metro yerel görselinin statik require satırı gerekçeli, tek satırlık lint istisnası kullanır.
- Native cihaz/simülatör release build testi yapılmadı. Splash ve launcher görünümü gerçek release build üzerinde son kez kontrol edilmeli.

## Dağıtım

Android/iOS uygulama ikonları, Android adaptive/monochrome, bildirim ikonu ve native splash yeni native build gerektirir; OTA ile güncellenmez. Giriş/kayıt marka görseli JS/asset güncellemesidir; mevcut dağıtım altyapısı destekliyorsa OTA ile taşınabilir. Mağaza PNG dosyaları ayrıca mağaza panellerine yüklenir, tek başına native build gerektirmez. Mağazaya yükleme veya build/deploy yapılmadı.

Çalışılan gerçek proje yolu `C:\Users\Harun\Desktop\Vitrify`; oturumun bildirdiği Vitrivia klasörü diskte bulunmuyordu.
