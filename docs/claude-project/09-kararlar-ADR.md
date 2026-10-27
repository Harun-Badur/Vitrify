# Kararlar

Ürün sahibinin alınmış kararları. Durum, 2026-10-27 koduna göredir. Etiketler: HEDEF (henüz uygulanmadı), KISMEN, UYGULANDI. Hedef ile bugünkü kodun farkı çelişki değildir.

Son güncelleme: 2026-10-27

## 1. Katmanlı evrim, kilitli Discover

Karar: Sistem baştan yazılmaz. Discover arayüzü kilitlidir. Tek istisna insight chip.

Gerekçe: Çalışan deste ve kaydırma bozulmasın.

Durum: KISMEN

Mevcut durum: Deste ve `SwipeCard` duruyor; etiket hâlâ `product.reason` ve Sparkles, ayrı insight bileşeni yok. [kodda doğrulandı: components/SwipeCard.tsx, 750–756]

## 2. Tek kanonik ürün, önbellekte snapshot yok

Karar: Ürün `products` ve resolver’dan gelir. Öneri kimlik taşır; ürün gövdesi önbelleğe yazılmaz.

Gerekçe: Eski fiyat ve görsel kartta kalmasın.

Durum: KISMEN

Mevcut durum: Kombin önbelleği kimlik referansı yazar ve `productsById` ile çözer; Edge yanıtı ürün gövdesi de taşıyabilir. [kodda doğrulandı: src/recommendationCache/codec.ts; services/discoverRecommendationCacheService.ts]

## 3. Geçerlilik ile tercih ayrı

Karar: Uyum “olabilir mi”, sıra “istiyor mu” diye ayrılır. Bilinmeyen nitelik “uyumlu” sayılmaz.

Gerekçe: Eksik renk veya stil, sahte uyum üretmesin.

Durum: KISMEN

Mevcut durum: Kapı renksiz ürünü havuzdan çıkarır; eşlenmeyen alt tür 0 stil puanı alır ve elenmez, `evaluateCompatibility` canlıda çağrılmaz. [kodda doğrulandı: lib/catalogEligibility.ts; src/intelligence/outfits/catalogCompatibility.ts, 46–50]

## 4. Abstain

Karar: Kombin “üç parçayı doldur” değildir. Kaliteli değilse 0–2 parça veya hiç.

Gerekçe: Zorla doldurulan kombin güveni düşürür.

Durum: KISMEN

Mevcut durum: `selectDiverseComplements` aday kalmazsa erken durur veya `null` döner; mutlak kalite eşiği yoktur, seçim marj ve dolulukla yapılır. [kodda doğrulandı: src/intelligence/recommendations/selectDiverseComplements.ts]

## 5. Tek uyum modülü ve ortak sözlük

Karar: `evaluateCompatibility` temel olsun. `catalogCompatibility` ona delege etsin. Katalog ve dolap aynı dilde tanımlansın: rol, alt tür, renk ailesi, formalite, stil ailesi, sezon; kaynak ve güven.

Gerekçe: İki skor iki gerçeklik üretmesin.

Durum: HEDEF

Mevcut durum: Canlı uyum `catalogCompatibility` içindedir; `evaluateCompatibility` üretimden çağrılmaz ve dolap öğesinde ortak nitelik dili yoktur. [kodda doğrulandı: src/intelligence/outfits/catalogCompatibility.ts; src/intelligence/compatibility/compatibilityGate.ts]

## 6. Dolap niteliği nasıl gelir

Karar: Kullanıcı eklerken kategori ve alt tür seçer. Renk, kesim servisinden baskın renk önerisi olarak gelir; kullanıcı onaylar. Görsel sınıflandırıcı ve embedding şimdilik yok.

Gerekçe: Yanlış otomatik etiket profili kirletmesin.

Durum: HEDEF

Mevcut durum: Ekleme formu kategori, başlık, marka ve fotoğraf alır; alt tür ve renk onayı yoktur, kesim yalnız PNG üretir. [kodda doğrulandı: app/wardrobe/add.tsx; store/wardrobeSlice.ts]

## 7. StyleContext ve tek profil kaynağı

Karar: Style Intelligence / StyleContext ürün seçmez; Keşfet sırasını `scoreCandidate` belirler. StyleContext sürümlü bağlam üretir. Profilin tek kaynağı `user_style_profiles` olur. Profil ekranı ağırlığı istemcide yeniden yorumlamaz.

Gerekçe: Ekran ile motor aynı sayıyı görsün. Ürün seçimi ile bağlam üretimi ayrı işlerdir.

Durum: KISMEN

Mevcut durum: StyleContext canlı yolda ürün seçmez; Keşfet sırasını `scoreCandidate` belirler ve profili `user_style_profiles` üzerinden okur. [kodda doğrulandı: lib/scoring.ts; src/intelligence/style/styleContext.ts]

## 8. JEV yalnız çevrimdışı

Karar: JEV (TypeSafe AI, System One) maliyet nedeniyle seçildi. Yalnız çevrimdışı `SemanticJudgment`: taslak zenginleştirme, anlaşmazlık, ileride sınırlı kanıt. Canlı kaydırmada yok. Sert kapının yerine geçmez. Ham davranış ona gitmez. Embedding ayrı bir iştir.

Gerekçe: Canlı yolda belirsiz model olmasın.

Durum: HEDEF

Mevcut durum: Repoda `JEV`, `SemanticJudgment` ve `TypeSafe` çağrısı yoktur. [rapora dayanıyor: reports/b0-baseline-2026-10-08.md] [doğrulanamadı: harici sözleşme]

## 9. A1 silme sırası

Karar: Tek Storage yazıcısı Edge. İstemcinin doğrudan yazma politikası, imzalı yükleme URL’si ve TUS yok. Sıra: fence, drain (DB saati), sweep, çift doğrulama, operasyon temizliği, Auth silme. Hata olursa Auth silinmez. Günlük janitor. Satıcı ve yedek beyan olarak raporlanır.

Gerekçe: `AGENTS.md` I1–I5.

Durum: KISMEN

Mevcut durum: I3 sırası operasyon tablosu temizliğini Auth silmeden önce yazar; Faz 5 janitor zamanlaması BLOCKED ve staging dumanı doğrulanmadı. [kodda doğrulandı: AGENTS.md I3]

## 10. Staging, sentetik kullanıcı, tek değişken

Karar: Önce staging ve sentetik kullanıcı. Önce test. Tek değişiklik. Faz sonunda dur.

Gerekçe: Canlı kullanıcı ve katalog üstünde deneme yok.

Durum: KISMEN

Mevcut durum: A1 raporları önce test, SQL önerisi ve dur ritmini izler; sonraki fazların staging dumanı NOT RUN kalmıştır. [rapora dayanıyor: reports/backend/a1-phase4b-report-20261012.md]

## 11. Kalite kararı insanla

Karar: Kalite kararı insan değerlendirmesidir. AI değerlendirmesi yardımcıdır.

Gerekçe: Otomatik skor, giyim uyumunu tek başına geçirmez.

Durum: KISMEN

Mevcut durum: İnsan kontrol rehberleri vardır; canlı Keşfet sırası insan onayı beklemeden `scoreCandidate` ile seçilir. [rapora dayanıyor: reports/phase6.2-blind-review/README.md; kodda doğrulandı: lib/scoring.ts]

## Kararların kod karşılığı, tek bakış

| # | Durum | İlk bakılacak dosya |
|---|---|---|
| 1 | KISMEN | `components/SwipeCard.tsx` |
| 2 | KISMEN | `src/recommendationCache/codec.ts` |
| 3 | KISMEN | `lib/catalogEligibility.ts` |
| 4 | KISMEN | `selectDiverseComplements.ts` |
| 5 | HEDEF | `catalogCompatibility.ts` ve `compatibilityGate.ts` |
| 6 | HEDEF | `app/wardrobe/add.tsx` |
| 7 | KISMEN | `lib/scoring.ts` ve `styleContext.ts` |
| 8 | HEDEF | repoda JEV yok |
| 9 | KISMEN | `AGENTS.md` I3, Faz 5 raporu |
| 10 | KISMEN | `reports/backend/a1-phase*.md` |
| 11 | KISMEN | `lib/scoring.ts` |
