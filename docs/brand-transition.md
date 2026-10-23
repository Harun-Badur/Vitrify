# Vitrify marka geçişi

Görünen marka adı **Vitrify**; npm paket adı `vitrify` olarak düzenlendi. Bu belge bir teknik kimlik veya veri taşıma işlemi değildir. Tarihsel raporlar ve kurulum manifestleri değiştirilmez.

## Korunan teknik referanslar

- Supabase project ref: `hnujkabyyrlsxohjhxlg`; URL, veritabanı, Storage, RLS ve Edge Functions aynı kalır.
- Android: `com.kabin.app`; iOS: `app.kabin.mobile`.
- OAuth: `kabin://auth` ve `kabin://auth?attempt=*`; Google callback ve sağlayıcı ayarları değişmez.
- EAS: `@harunbadurs-team/kabin`, proje ID `8ba7778a-ee4d-43b0-9594-74b6624a7af6`. `expo.slug` bağlantıyı korumak için `kabin` kalır.
- Mevcut cache/storage anahtarları, yerel dosya önekleri, ürün metadata sentinel değerleri, destek e-postası ve gizlilik URL'si korunur. Bunlar marka metni olarak topluca değiştirilmez.
- Görseldeki “Deneme Kabini” bir özellik adıdır; eski uygulama markası değildir.

## Kullanıcının yapacağı son adımlar

### 1. GitHub deposu

Mevcut `Harun-Badur/Vitrivia` deposunda **Settings → General → Repository name** alanını `vitrify` yapın. Yeni depo oluşturmayın; geçmişi taşımayın veya resetlemeyin. Yeni adresi tarayıcıda doğruladıktan sonra, halen mevcut klasörde:

```powershell
git -c safe.directory=C:/Users/Harun/Desktop/Vitrivia remote set-url origin https://github.com/Harun-Badur/vitrify.git
git -c safe.directory=C:/Users/Harun/Desktop/Vitrivia remote -v
```

Bu komutlar bu çalışma sırasında uygulanmadı; mevcut remote korunuyor. GitHub eski URL'yi yönlendirse de remote'u yeni URL'ye geçirmek önerilir. GitHub Pages, Actions ve harici CI bağlantıları varsa ayrıca kontrol edin; eski isimde yeni depo açmayın.

Kaynak: [GitHub — Renaming a repository](https://docs.github.com/en/repositories/creating-and-managing-repositories/renaming-a-repository).

### 2. Supabase görünen adı

Yalnız `hnujkabyyrlsxohjhxlg` projesini açın. **Project Settings → General** içindeki proje adı alanını `Vitrify` olarak kaydedin. Menü/alan farklıysa yalnız görünen proje adını düzenleyen alanı kullanın; bağlantı/kimlik değişikliği yapmayın. Kaydetmeden önce project ref'i doğrulayın. Database, API, Auth, Storage, RLS, secrets veya OAuth ayarlarına dokunmayın. Bu çalışma Supabase'e bağlanmadı veya uzak ayar değiştirmedi.

### 3. Yerel klasör — oturum kapandıktan sonra

Önce değişiklikleri koruyun ve `git status` çıktısını kontrol edin. Metro, bu klasörü kullanan terminal ve editör/Codex oturumlarını kapatın. Mevcut çalışan oturum içinden klasörü taşımayın.

Windows Dosya Gezgini'nde `C:\Users\Harun\Desktop\Vitrivia` klasörünü **Vitrify** olarak yeniden adlandırın; hedef klasör zaten varsa birleştirmeyin. Ardından yeni yolu proje olarak açın. `.git`, `.env` ve mevcut kullanıcı dosyaları klasörle birlikte korunmalıdır.

Eski mutlak yolu kullanan kısayol, yerel araç ve proje kaydını yeni yola yönlendirin; geçmiş raporlardaki kanıt yollarını değiştirmeyin. Git güvenli dizin uyarısı çıkarsa yalnız yeni klasör için güvenilir dizin tanımlayın; `safe.directory=*` kullanmayın. Node bağımlılıkları junction ise hedef erişimini kontrol edin; otomatik yeniden kurulum yapmayın.

Son kontrol: `git status`, `git remote -v`; ardından yeni klasörden `node node_modules/expo/bin/cli start --dev-client`.

## Cihazdaki uygulama adı

`expo.name` değişikliği yeni native APK/build ile cihaz simgesine yansır. Önceden oluşturulmuş APK ve EAS build geçmişi geriye dönük değişmez. Bu marka çalışmasında yeni build veya deploy başlatılmadı.
