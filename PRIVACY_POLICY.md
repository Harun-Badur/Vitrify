# Vitrify — Gizlilik Politikası

**Son güncelleme:** 20 Ekim 2026
**Uygulama:** Vitrify (Android)
**İletişim:** vitrifyapp@gmail.com

Vitrify; moda ürünlerini keşfetmenizi, yapay zekâ ile sanal olarak denemenizi ve
beğendiklerinizi takip etmenizi sağlar. Bu politika hangi verileri topladığımızı,
neden topladığımızı ve nasıl silebileceğinizi açıklar.

Vitrify, uygulama içindeki etkileşimleri kişiselleştirilmiş öneriler sunmak amacıyla saklar.

---

## 1. Topladığımız veriler

| Veri | Neden | Nerede saklanır | Saklama süresi |
|------|-------|-----------------|----------------|
| E-posta adresi | Hesap oluşturma ve giriş | Supabase (AB/ABD bölgesi) | Hesap silinene kadar |
| Beğenilen / geçilen ürünler | Dolabınızı oluşturmak, aynı ürünü tekrar göstermemek | Supabase | Hesap silinene kadar |
| Uygulama içi etkileşimler (beğeni, geçme, görüntüleme, arama, filtre, sanal deneme, mağaza tıklaması) | Kişiselleştirilmiş öneriler sunmak | Supabase | Hesap silinene kadar |
| Stil stüdyosu tercihleri (beden, stil etiketleri) | Önerileri ve sanal denemeyi kişiselleştirmek | Supabase | Hesap silinene kadar |
| Fiyat alarmı tercihleri | Fiyat düşünce bildirim göndermek | Supabase | Hesap silinene kadar |
| Bildirim (push) tokenı | Fiyat düşüşü bildirimi göndermek | Supabase | Hesap silinene kadar |
| Sanal deneme girdisi | Giydirme işlemi | Cihaz, Supabase Edge aracı ve FASHN işleme hizmeti | Sağlayıcının saklama/silme süresi bu sürüm için doğrulanmış değil; bkz. bölüm 2 |
| Kaydetmeyi seçtiğiniz model fotoğrafı | Sonraki denemelerde yeniden kullanma | Supabase Storage (`model-photos`) ve cihaz önbelleği | Fotoğraf kaldırma veya hesap silme akışı tamamlanana kadar; hata durumunda yeniden deneme gerekebilir |
| Deneme sonucu ve geçmişi | Önceki sonuçları cihazda görme | Cihazdaki uygulama dosyaları ve hesap bazlı yerel geçmiş | En fazla 20 kayıt; 30 gün ve üzerindeki kayıtlar geçmiş açılırken/eklenirken budanır; dosya silme hataları sonraki işlemlerde yeniden denenir |
| Sanal deneme kotası (sayaç) | Kötüye kullanımı engellemek | Supabase | Hesap silinene kadar |

Reklam kimliği toplamıyoruz. Konum, rehber, arama geçmişi veya cihaz kimliği
toplamıyoruz. Üçüncü taraf analitik veya reklam SDK'sı kullanmıyoruz.

---

## 2. Sanal deneme fotoğrafınız

Sanal deneme özelliğini kullandığınızda:

1. Seçtiğiniz kişi fotoğrafı cihazda JPEG olarak hazırlanır. Fotoğraf ve ürün
   görseli, Supabase üzerindeki kimlik doğrulamalı aracı üzerinden HTTPS ile
   **FASHN** adlı harici yapay zekâ sağlayıcısına işlenmek üzere aktarılır.
   Sağlayıcıya ürün görselinin adresi de iletilir.
2. Aracı kod, gelen kişi görselini işlem isteğinde kullanır ve sonucu uygulamaya
   döndürür; bu akış kişi görselini ayrıca Supabase Storage'a yüklemez.
   İşlem kimliği, sağlayıcı işlem durumu ve kota gibi koordinasyon kayıtları
   görsel dosyasından ayrı tutulabilir. Bu kayıtlar sıfır saklama kanıtı değildir.
3. Profilde model fotoğrafı kaydetmeyi seçerseniz bu ayrı işlem fotoğrafı
   Supabase Storage'daki `model-photos` alanına yükler. Sonraki kullanımda cihaz
   önbelleğine bir kopyası indirilebilir. Profilde fotoğraf kaldırma akışı,
   sunucudaki kayıtlı fotoğrafı kaldırmayı ister. Bir VTON işlemini iptal etmek
   daha önce kaydedilmiş profil fotoğrafını kaldırmaz.
4. Üretilen sonuç uygulama önbelleğine yazılır. Ürün bilgileriyle birlikte hesap
   bazlı deneme geçmişinde gösterilebilir. Geçmiş en fazla **20 kayıt** tutar;
   **30 gün** ve üzerindeki kayıtlar geçmiş okunurken veya yeni sonuç eklenirken
   budanır. Bu bir arka plan zamanlayıcısı değildir; uygulama açılmadığında
   dosyaların tam 30. günde silindiği garanti edilmez. Dosya silme hatalarında
   temizleme yeniden denenir. Galerinizdeki kaynak veya dışarı aktardığınız
   kopyalar uygulamanın geçmiş temizliğiyle silinmez.
5. **FASHN'in saklama, silme ve eğitim uygulamaları bu sürüm için teknik olarak
   doğrulanmış değildir.** Sağlayıcı için sıfır saklama, eğitimde kullanılmama
   veya anında ve doğrulanmış silme taahhüdü vermiyoruz. Cihazdaki ya da Supabase
   Storage'daki bir kopyanın kaldırılması sağlayıcıdaki kopyanın silindiğini
   kanıtlamaz. Yedeklerin silinme süreleri de bu uygulama kodundan doğrulanamaz.

Yeni denemeye geçmeden önce bu açıklamayı kabul etmeniz istenir. Kabul, bu
cihazda **kullanıcı hesabı ve açıklama sürümü bazında** kaydedilir. Başka hesabın
veya eski açıklamanın kabulü yeni hesap/sürüm için kullanılmaz. Kabulün kaydı
başarısızsa yeni denemeye geçilmez. Vazgeçerseniz o ekrandan yeni deneme
başlatılmaz; uygulamanın diğer bölümlerini kullanabilirsiniz. Vazgeçme, önceden
aktarılmış verileri geri almaz. Buradaki teknik kabul kaydı, tek başına hukuki
rıza yeterliliği veya sağlayıcı uygulamalarının doğrulandığı anlamına gelmez.

---

## 3. Verileri kimlerle paylaşıyoruz

| Alt işleyici | Amaç | Aktarılan veri |
|--------------|------|----------------|
| Supabase Inc. | Veritabanı, kimlik doğrulama, dosya saklama ve VTON aracı | Hesap/tercih bilgileri, kayıtlı model fotoğrafı, işleme isteği ve işlem kayıtları |
| FASHN | Sanal deneme görselini işleme | Kişi fotoğrafı ve ürün görseli/adresi |
| Expo (Push Notification Service) | Bildirim iletimi | Bildirim tokenı |

Verilerinizi satmıyoruz ve reklam amaçlı paylaşmıyoruz.

Pazaryeri bağlantılarına (Trendyol, Hepsiburada, Amazon) tıkladığınızda ilgili
sitenin kendi gizlilik politikası geçerli olur; Vitrify bu sitelere kişisel
verinizi göndermez.

---

## 4. Hesap silme

Hesabınızı ve tüm verilerinizi iki yolla silebilirsiniz.

### Uygulama içinden

1. Vitrify uygulamasını açın ve giriş yapın.
2. Alt menüden **Profil** sekmesine gidin.
3. **Hesabımı Sil** düğmesine dokunun.
4. Onay penceresinde **Kalıcı olarak sil** seçeneğini onaylayın.

Silme akışı uygulamanın yönettiği hesap verilerini ve dosyaları temizlemeyi
amaçlar; kullanıcıya ait sunucu dosyalarının temizliği doğrulanmadan hesap
silme adımı tamamlandı sayılmaz. Bir adım başarısızsa işlem tamamlanmış gibi
sunulmaz; yeniden deneme gerekebilir. Tamamlanan hesap silme işlemi geri
alınamaz. Harici sağlayıcı ve yedeklerdeki silmenin kapsamı veya süresi bu
istemci tarafından teknik olarak doğrulanmaz; anında ve tüm kopyalar için
silme garantisi verilmez. Galerinizdeki bağımsız kopyalar bu kapsamda değildir.

### Web üzerinden / e-posta ile

Uygulamayı kaldırdıysanız veya uygulamaya erişemiyorsanız hesap kaydınızla
aynı adresten **vitrifyapp@gmail.com** adresine "Hesap silme talebi" konulu bir
e-posta ile talep iletebilirsiniz. Talebin alınması, hesabın doğrulanması ve
işlemin tamamlanması ayrıca teyit edilmelidir; bu metin doğrulanmamış bir
yanıt süresi veya otomatik silme garantisi vermez.

---

## 5. Haklarınız

KVKK ve GDPR kapsamında; verilerinize erişme, düzeltme, silme, işlemeyi
kısıtlama ve verilerinizi taşınabilir biçimde alma hakkına sahipsiniz. Bu
haklarınızı kullanmak için **vitrifyapp@gmail.com** adresine yazabilirsiniz.

---

## 6. Çocukların gizliliği

Vitrify 13 yaşın altındaki kullanıcılara yönelik değildir ve bu yaş grubundan
bilerek veri toplamayız.

---

## 7. Güvenlik

- Tüm ağ trafiği HTTPS üzerinden şifrelenir.
- Veritabanı satır düzeyi güvenlik (RLS) ile korunur; her kullanıcı yalnızca
  kendi kayıtlarına erişebilir.
- Sanal deneme servisine yalnızca kimliği doğrulanmış kullanıcılar adına,
  sunucu tarafı bir aracı üzerinden erişilir.

---

## 8. Politika değişiklikleri

Bu politikayı güncellediğimizde "Son güncelleme" tarihini değiştirir ve önemli
değişiklikleri uygulama içinde duyururuz.

---
---

# Vitrify — Privacy Policy (English summary)

**Last updated:** 20 October 2026 · **Contact:** vitrifyapp@gmail.com

**What we collect.** Your email address (for the account), the products you
like or skip, your price-alert preferences, your push notification token, and
in-app interactions used to personalize recommendations. Vitrify stores
in-app interactions in order to provide personalized recommendations. All of
this is stored in Supabase and kept until you delete your account. We do
not collect advertising identifiers, location, or contacts, and we use no
third-party analytics or ad SDKs.

**Your try-on photo.** A JPEG prepared on your device and the product image
are sent via the authenticated Supabase intermediary to **FASHN** for processing.
The intermediary does not separately upload the incoming try-on photo to
Supabase Storage. Saving a model photo in your profile is a separate action
that stores it in Supabase Storage (`model-photos`) and may cache a device copy.
Results and account-scoped history are stored on your device. History keeps
up to 20 entries and prunes entries aged 30 days or more when read or updated;
this is not a scheduled deletion at exactly 30 days. Failed file cleanup can
require retry. Gallery originals and exported copies are not removed by history
cleanup. Provider operation and quota records are separate from image files.

FASHN retention, deletion and training practices have not been technically
verified for this release. We do not promise zero retention, no training or
immediate provider deletion. Removing an app-controlled copy does not prove
provider or backup deletion. Acceptance is stored per account and disclosure
version on this device; old device-wide acceptance is not reused. A failed
acceptance save does not enable a new try-on. Declining prevents a new try-on
from that screen, but does not undo earlier transfers.

**Sub-processors.** Supabase (database, authentication, saved files and try-on
intermediary), FASHN (image processing), Expo Push Notification Service
(notification delivery). We do not sell your data.

**Deleting your account.** Open **Profile → Delete My Account** and confirm.
The app-controlled cleanup flow may require retry and does not report completion
on failure. Account deletion waits for the app-controlled server-file cleanup
checks. External-provider and backup deletion are not technically verified by
this client. We do not promise immediate removal of all copies. You may email
**vitrifyapp@gmail.com** with the subject "Account deletion request" if you cannot
access the app; receipt, identity verification and completion require confirmation.
No unverified response-time guarantee is made here.

**Your rights.** Under GDPR and Turkish KVKK you may access, correct, delete,
restrict, or export your data. Contact **vitrifyapp@gmail.com**.

**Children.** Vitrify is not directed at children under 13.
