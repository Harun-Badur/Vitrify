# Internal Testing son kapılar — 20 Ekim 2026

**AAB hazırlık kararı: NO-GO.** Yerel düzeltmeler tamamlandı; EAS production'da istenen iki bayrak tanımlı değil ve uygulamanın açtığı politika URL'sine yeni metin bu görevde yayımlanmadı.

## Düzeltilen sorunlar

- `PRIVACY_POLICY.md` Türkçe ve İngilizce VTON açıklaması: kişi/ürün görselinin Supabase aracı üzerinden FASHN'e aktarılması, ayrıca kaydedilen `model-photos` dosyası, cihazda tutulan sonuç/geçmiş ve budama sırasında dosya temizliği ayrıştırıldı. En fazla 20 geçmiş kaydı / 30 günlük budama kuralının tam 30. günde çalışan bir zamanlayıcı olmadığı açıklandı. Galeri ve dışarı aktarılan kopyalar ayrıldı. Sağlayıcı/yedekler için sıfır saklama, eğitimde kullanılmama, anında silme ve doğrulanmamış yanıt süresi taahhütleri kaldırıldı. Mevcut hesap silme protokolü değiştirilmedi.
- `lib/vtonDisclosure.ts` ve `components/VirtualTryOnModal.tsx`: aynı gerçek işleme/saklama sınırları kabul ekranında gösteriliyor. Önceki “saklanmaz / üçüncü taraflarla paylaşılmaz” açıklaması kaldırıldı.
- `lib/consent.ts`: eski cihaz-geneli izin artık kabul edilmiyor. Mevcut hesap bazlı privacy-lifecycle kaydının `vton` alanı kullanılıyor; açıklama sürümü kontrol ediliyor. Yeni depolama anahtarı veya A1 temizleme değişikliği yok.
- Modal hesap değişiminde rızayı yeniden okuyor; kalıcı kayıt tamamlanmadan deneme ekranı açılmıyor. Hata, çift dokunma ve geç dönen eski hesap sonucu korunuyor.

## EAS production — salt okunur gerçek sonuç

EAS projesi mevcut `eas.json` / `app.json` üzerinden seçildi. Yalnız hedeflenen public değişkenler sorgulandı; yokluk durumunda account kapsamı da kontrol edildi. Ham değerler bellekte karşılaştırıldı, dosyaya/loga yazılmadı. Kanıt: `reports/release/eas-production-redacted-check-20261020.json`.

| Kontrol | Sonuç |
|---|---|
| Supabase URL | **GO:** yerelde kullanılan mevcut main URL ile aynı |
| Supabase public key | **GO:** yereldeki publishable key'den farklı bir legacy anon JWT. Main proje ref/anon rolü/süresi ile uyumlu; EAS'ten okunan public key main `GET /auth/v1/settings` çağrısında **HTTP 200** ile kabul edildi. Kullanıcı verisi istenmedi, yanıt gövdesi yazdırılmadı |
| EXPO_PUBLIC_PREFERENCE_V2_ENABLED=true | **NO-GO:** production project ve account kapsamlarında tanımlı değil. Mevcut kod, eksik değeri false yorumluyor; preview bayrağı production'a miras kalmıyor |
| EXPO_PUBLIC_PREMIUM_ENABLED=false | İstenen açık false değeri **tanımlı değil**. Kodda yalnız true etkinleştirdiğinden Premium fiilen kapalı; yine de istenen env sözleşmesi karşılanmıyor |
| Production profile env override | Yok; eksik bulut bayraklarını tamamlayan profil değeri bulunmuyor |
| HTTP cutout | **GO, adres sızıntısı bakımından:** production project/account cutout env'i yok, profile override yok ve `.env*` EAS paketinden dışlanıyor. Yerel HTTP adresi mevcut release yapılandırmasına taşınmıyor. **Cutout işlevi production'da yapılandırılmış değil**; HTTPS hizmeti çalışıyor iddiası yapılmadı |

Anahtar yenileme/değiştirme, env ekleme veya main SQL/deploy yapılmadı. Public key'in yerelden farklı olması tek başına arıza sayılmadı; güvenli salt okunur kabul kontrolüyle ayırt edildi.

## Kalan GO / NO-GO

- **GO:** yerel VTON açıklaması ve hesap/sürüm bazlı rıza düzeltmesi; main URL/public key; Premium'un fiilen kapalı olması; release'e yerel HTTP cutout taşınmaması.
- **NO-GO:** production'da V2=true ve açık Premium=false değerleri eksik. Bu görevde env/secret değişikliği yapılmadı; build başlatılmamalı.
- **NO-GO:** uygulama `lib/privacy.ts` içindeki harici GitHub politika URL'sini açıyor. Düzeltilen yerel politika oraya yayımlanmadı; kullanıcı hâlâ eski metne ulaşabilir. URL değiştirilmedi veya yayın yapılmadı.
- **Gerçek fotoğraflı test için açık:** FASHN tarafındaki saklama/silme uygulamaları teknik olarak doğrulanmış değil. Metin bunu artık garanti olarak sunmuyor. Main'de dağıtılmış VTON/A1 hizmetlerinin uçtan uca hazır olması bu dar kontrolde sertifikalandırılmadı. Bu bulgu yeni bir A1 mekanizması ekleme veya deploy yetkisi değildir.
- Play-imzalı cihaz testi ve son artifact kontrolleri AAB olmadan doğrulanamaz; bunlar başarılı sayılmadı.

## Dar doğrulama

Önce testler mevcut cihaz-geneli rızanın iki hesaba taşındığını, kayıt hatasının yutulduğunu ve eski politika uyuşmazlığını gösterdi. Son durumda `vtonConsent`, `vtonConsentUI`, `vtonDisclosure`, `vtonHistoryLifecycle`: **4 suite / 14 test geçti**. Modalın gerçek kabul callback'i yürütülerek kayıt öncesi açılmama, hata ve hesap değişimindeki geç sonuç kontrol edildi. Uygulama kaynakları/yeni testleri kapsayan `.tmp/tsconfig-vton-consent.json` ile **TypeScript geçti**; ilgili dosyalarda diff whitespace kontrolü geçti.

Ek mevcut `privacyClosure` fixture'ında 4 test geçti, 3 test owner-fence/timeout hatası verdi. Eski `HEAD` consent koduyla karşılaştırmada aynı üç vaka yeniden başarısız oldu; bunlar bu rıza değişikliğinin yeni regresyonu değil. A1 veya fixture'ı bu kapsamda değiştirmedim. Hedefli VTON history testleri geçti; tüm A1 testlerinin geçtiği iddia edilmedi.

Değişenler: `PRIVACY_POLICY.md`, `lib/consent.ts`, `lib/vtonDisclosure.ts`, `components/VirtualTryOnModal.tsx`, üç yeni hedefli test (`vtonConsent`, `vtonConsentUI`, `vtonDisclosure`), redakte EAS kanıtı ve bu rapor. Backend/A1 kaynakları, Auth, Style V2, Keşfet, Dolap ve Premium işlev kodları değiştirilmedi. Eski staging'e bağlantı, production SQL/deploy, secret/env değişikliği, AAB build veya Play yüklemesi yok.
