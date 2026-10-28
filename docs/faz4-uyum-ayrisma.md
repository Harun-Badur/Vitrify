# Faz 4 — Uyum ayrışma tablosu ve B0′ (S1)

S1 davranış değiştirmez; bugünkü main'in kararlarını dondurur. S2–S4 bu kayda karşı ölçülür.

## B0′ nedir

- Protokol B0 ile aynı: 30 çapa, 80 ürünlük sıralı havuz, boş dolap, kullanıcı tadı/oturum/maruziyet yok, `anchorContext → prepareDiscoverRankingAsync → completeDiscoverRecommendationsAsync`.
- Veri: 278 ürün + 278 attribute satırı. 2026-10-27 katalog temizliği B0 manifestinden 133 ürünü sildi; bunlar temizliğin yedeğinden (`remaining-120-backup.json`) **yalnız bellekte** geri kurulur, manifest değiştirilmez. Çapa/havuz sırası `semantic-usage-audit-2026-10-08/manifest.json`'dan (B0 raporunun dondurulmuş girdisi; diğer dört raporla birebir aynı).
- Ürünler bugünkü üretim hidrasyonuyla (`mapFeedRow` + `enrichProduct`) kurulur. Orijinal ham satır sırası kayıp; `datasetSha256` id'ye göre sıralı satırların özetidir (`54b5b16b…`).
- Altın dosya ve girdiler gitignore'lu `reports/` altında (`reports/b0-prime-2026-10-28/golden.json`); test bu dosyalar yoksa atlanır, CI'da çalışmaz.
- Dondurma: `npx tsx scripts/freezeB0Prime.ts`. Doğrulama: `npx jest __tests__/b0PrimeCharacterization.test.ts`. İki dondurma çalıştırması bayt bayt aynı; `__DEV__` false (betik) ve true (Jest) aynı sonucu verir.

## B0′ özeti

- 29 çapa 3 ürün, 1 çapa 0 ürün (B0 ile aynı dağılım). 30 çapanın 29'unda sıralı final B0'dan (2026-10-08) farklı; aradaki değişiklikler (fiyat yakınlığı ağırlığının sıfırlanması, insan kararı listesi, metadata onarımları) muhtemel sebep, tek tek **atfedilmedi**. Ayrıntı: `reports/b0-prime-2026-10-28/b0-comparison.json`.
- 2386 çapa×havuz çifti için mevcut her mekanizmanın kararı kayıtlı: `catalogCompatibility` puanı, iki parçalı `hasHardConflict`, `evaluateCompatibility` sonucu/gerekçesi, insan kararı engeli.

## Ayrışma tablosu — çift düzeyi (B0′, 2386 çift)

| # | Ayrışma | Sayı | Etki |
| --- | --- | --- | --- |
| D1 | `hasHardConflict` cinsiyet çatışmasıyla reddediyor (ham `Product.gender`), kapı `gender_conflict_unverified` → insufficient | 849 (+3 rol+cinsiyet) | Motor güvenilmez kanıtla kesin ret veriyor; "bilinmeyen ≠ uyumsuz" ilkesine aykırı |
| D2 | `hasHardConflict` true (ikinci dış katman / dış giyim alt türlü üst), kapı eligible | 8 | Katman kuralı yalnız motorda; kapının rol tablosunda yok |
| D3 | İnsan kararı engeli olan çiftlerin hepsinde iki mekanizma da "uyumlu" diyor | 13/13 | Engel yalnız elle yazılmış listede; kanıt biçimi yok |
| D4 | Kapı `role_exclusive_slot_unverified` (ör. iki ayakkabı), `hasHardConflict` false | 38 | Motor bunu `isValidOutfitItems` rol tekliğiyle ayrıca engelliyor; iki yerde iki kural |
| D5 | Gösterilen 87 final ürünün 41'i kapıda `gender_unknown` ile geçiyor | 41/87 | Cinsiyet bilinmeden öneriliyor; kanıt listesinde görünmüyor |
| D6 | Nötr renk: puanlayıcı 0.5 veriyor, chip eşleşme saymıyor | 328 çift 0.5 | Aynı "renk uyumu" iki tanımlı |

## Ayrışma tablosu — chip (sentetik fixture, `__tests__/insightChipCharacterization.test.ts`)

| # | Durum | Bugünkü chip | Politika (`COMPATIBILITY_POLICY_V1`) |
| --- | --- | --- | --- |
| C1 | Elbise + dolapta aynı renk ceket/blazer | yok | one_piece↔outerwear tamamlayıcı |
| C2 | Üst ürün + dolapta aynı renk dış giyim | yok | top↔outerwear tamamlayıcı |
| C3 | Lacivert ürün + siyah alt | yok | puanlayıcıda nötr 0.5 |
| C4 | `Navy` ↔ `navy` | yok (normalize edilmiyor) | puanlayıcı normalize ediyor |
| C5 | Renksiz dolap, kategori eksik | `completes_wardrobe` | — (renk kanıtı olmadan dolap chip'i) |
| C6 | Şapka + aynı renk alt | yok | hat↔bottom tamamlayıcı |

Diğer sabitlenen davranışlar: dolap chip'i için en az 3 parça; bütçe chip'i en az 5 beğeni; style_fit gerekçeleri recs-feed `reasons` metninden; Keşfet bugün dolaba `[]` gönderdiği için dolap chip'i üretmiyor.

## Bilinen hatalar

Onaylı ilkelere ("bilinmeyen ≠ uyumlu/uyumsuz", "kanıt yoksa iddia yok") aykırı olan ve S1'de bilerek korunan davranışlar. Bunlar kabul edilmiş farklar değil; düzeltmeleri S2–S4'te onaylı fark listesiyle gelir.

| Satır | Hata | Düzeltileceği adım |
| --- | --- | --- |
| D1 | Güvenilmez cinsiyet kanıtıyla kesin ret | S3 (motor modüle geçince; B0′ farkı onaya sunulur) |
| D5 | Cinsiyeti bilinmeyen öneri kanıt listesinde görünmüyor | S2 (kanıt listesi) |
| C4 | Renk slug'ları normalize edilmeden karşılaştırılıyor | S4 |
| C5 | Renk kanıtı olmadan dolap chip'i üretiliyor | S4 / Faz 5 (renk boşsa chip yok kararı) |

## Kabul kuralları (S2–S4)

- S2 (modül, tüketici değişmez) ve S3 (motor modüle geçer): B0′ testinde **sıfır fark**; puanlar 1e-9 toleransla.
- S4 (chip modüle geçer): C1–C6 bilinçli olarak değişebilir; her fark listelenip onaylanır. Eskiden reddedilen bir çiftin eligible olması gerekçesiz kabul edilmez.

## Plan kararları (kullanıcı onaylı, 2026-10-28; S1'de uygulanmadı)

- **Tarz eşiği (sürümlü politika sabiti):** bir özellik için ≥3 beğeni, beğenilerin ≥%40'ı, katalog taban oranının ≥2×'i, o özellikte geçme sayısı beğeniden fazla olmayacak, toplam ≥5 beğeni. Birden çok özellik geçerse yalnız en güçlüsü gösterilir.
- **Dolap chip'i:** dolap parçasında renk boşsa chip üretilmez (uncertain); rol düzeyinde etiket yok. Eksik bilgi rozeti kullanıcıyı parçayı tamamlamaya yönlendirir. (C5 bu kararla S4/Faz 5'te değişecek.)
- **S2:** pairing modülü `compatibilityGate`'i özümser ve yerini alır; üçüncü paralel mekanizma bırakılmaz.
- **S2 — mevsim ve resmiyet boyutları:** `PairItem` şemasına mevsim ve resmiyet `Signal`'leri eklenir (kaynak/güven ile; bugün alt türden türetildikleri için `derived_from_subtype`). S2'de karar üretmezler, yalnız kanıt olarak raporlanırlar; B0′ farkı sıfır kalır.
- **S3b — 0 parçada bölümü gizle:** tamamlayıcı ürün sayısı 0 olduğunda (B0′'de 1 çapa) tamamlayıcı bölümü gösterilmez; boş başlık/iskelet kalmaz.
