# Feed tekrarı teşhisi (d3, d4, d5): canlı, yalnız okuma

Tarih: 2026-10-28 · Proje: `hnujkabyyrlsxohjhxlg` (linked) · Sorgular: `dup_diagnosis.sql`.
Her SELECT ayrı bir `begin transaction read only; …; rollback;` içinde, `supabase db query --linked` ile çalıştırıldı.
Yalnız sayılar ve fonksiyon üst verisi okundu; satır içeriği okunmadı, hiçbir şey yazılmadı.

## d3: geçilen ürünlerin kaydı

| Fonksiyon | passed_products INSERT | DELETE |
|---|---|---|
| `style_apply_preference_v2` | evet | evet |
| `style_remove_legacy_preference_v2` | hayır | evet |

| passed_products satır | kullanıcı | user_events `pass` | kullanıcı | kullanıcı başı en çok pass |
|---|---|---|---|---|
| 767 | 25 | 869 | 26 | 90 |

Tekil (kullanıcı, ürün) `pass` olayı: 796. Bunların 29'unun passed_products satırı yok. Aynı dönemde 100 `undo_pass` olayı var.
Not: undo ve sonradan beğenme satırı siler, bu yüzden 29'luk fark beklenen davranışla açıklanabilir; tek tek bağlanmadı.

**Sonuç:** V2 RPC passed_products'a yazıyor. Okuma/yazma tablo uyuşmazlığı (d3) **yok**.

## d5: aynı görsel, farklı ID

Aynı `image_url` ile birden fazla ürün olan grup sayısı: **0** (örnek ID yok).
**Sonuç:** görsel düzeyinde çift kayıt yok. Başlık/marka benzerliği ölçülmedi.

## d4: PostgREST satır sınırı

- `anon`, `authenticated`, `authenticator`, `service_role` rollerinde `max_rows` ayarı yok.
- Proje düzeyindeki API `max_rows` değeri SQL'den okunamıyor (Dashboard > API settings ya da Management API gerekir). Supabase varsayılanı 1000.
- Güncel boyutlar: `products` 349, `product_attributes` 349, kullanıcı başı en çok 90 pass.

**Sonuç:** sınırsız okumalar bugün varsayılan 1000 sınırının çok altında. d4 şu an tekrar üretmiyor; katalog büyüdükçe risk olarak kalıyor.
