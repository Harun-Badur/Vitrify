-- Kapalı beta dolap öğeleri: salt okunur veri raporu. Yalnız SELECT; yalnız toplamlar.
-- ASLA seçilmez: user_id (ham), name, brand, image_url, image_storage_path, e-posta.
--
-- ŞEMA KAYNAĞI (repodan okundu):
--   supabase/deferred/20260924_wardrobe_outfits_v1.sql  -> public.wardrobe_items:
--     id, user_id, image_url, name, category, subcategory (NULL olabilir), color (NULL olabilir),
--     secondary_colors, pattern, brand, size, season, style_tags, notes, created_at, updated_at
--   supabase/migrations/202610210001_cutout_v2.sql -> cutout_protocol; kodda image_storage_path kullanılıyor.
--   Silinmiş/pasif (deleted_at, is_active, archived vb.) kolonu repoda BULUNAMADI: "doğrulanamadı".
--     Silme fiziksel görünüyor (wardrobeSlice filter + RPC); bölüm 5 bunu kolon varlığına bakarak söyler.
--   Bu dosyanın uygulanmış sürümü canlı/staging şemasıyla birebir mi: DOĞRULANAMADI -> önce bölüm 0.
--
-- Her bölüm AYRI bir sorgudur. Editörde bölümü tek tek seç-çalıştır (çoğu editör yalnız son sonucu gösterir).
-- Bölüm 3 ve 4 yalnız bölüm 0'da ilgili kolon 'VAR' ise çalıştırılır; yoksa hata verir, veri değişmez.

-- ===== 0) Kolon varlığı (önce bunu çalıştır) =====
select c.column_name,
       case when i.column_name is not null then 'VAR' else 'YOK' end as durum
from (values ('category'), ('subcategory'), ('color'), ('name'), ('brand'), ('image_storage_path'),
             ('created_at'), ('user_id'), ('deleted_at'), ('is_active'), ('archived_at'), ('status')) as c(column_name)
left join information_schema.columns i
  on i.table_schema = 'public' and i.table_name = 'wardrobe_items' and i.column_name = c.column_name
order by c.column_name;

-- ===== 1) Toplam öğe, farklı kullanıcı, kullanıcı başına medyan ve maksimum =====
with per_user as (
  select user_id, count(*) as n from public.wardrobe_items group by user_id
)
select (select count(*) from public.wardrobe_items) as toplam_oge,
       count(*) as farkli_kullanici,
       percentile_cont(0.5) within group (order by n) as kullanici_basina_medyan,
       max(n) as kullanici_basina_maks
from per_user;

-- ===== 2) Kategori dağılımı =====
select category as kategori,
       count(*) as adet,
       round(100.0 * count(*) / sum(count(*)) over (), 1) as yuzde,
       case when count(*) < 5 then 'az veri' else '' end as uyari
from public.wardrobe_items
group by category
order by adet desc;

-- ===== 3a) Alt tür: boş/NULL oranı (subcategory kolonu VAR ise) =====
select count(*) as toplam,
       count(*) filter (where subcategory is null or btrim(subcategory) = '') as bos,
       round(100.0 * count(*) filter (where subcategory is null or btrim(subcategory) = '') / nullif(count(*), 0), 1) as bos_yuzde
from public.wardrobe_items;

-- ===== 3b) Kategori bazında alt tür dağılımı; "genel" değerler ayrı satır =====
-- genel = alt tür olmayan değerler (kategori adları ve top/bottom/other gibi). Gerçek alt türler 'alt_tur' satırı.
select category as kategori,
       case
         when subcategory is null or btrim(subcategory) = '' then '(boş)'
         else lower(btrim(subcategory))
       end as alt_tur,
       case
         when subcategory is null or btrim(subcategory) = '' then 'boş'
         when lower(btrim(subcategory)) in ('upper_body', 'lower_body', 'dresses', 'shoes', 'bags', 'hats',
              'accessories', 'top', 'tops', 'bottom', 'bottoms', 'other', 'outerwear', 'genel', 'general', 'unknown')
           then 'genel'
         else 'alt_tur'
       end as tur,
       count(*) as adet,
       sum(count(*)) over (partition by category) as kategori_toplami,
       round(100.0 * count(*) / sum(count(*)) over (partition by category), 1) as kategori_ici_yuzde,
       case when sum(count(*)) over (partition by category) < 5 then 'az veri' else '' end as uyari
from public.wardrobe_items
group by category, 2, 3
order by category, adet desc;

-- ===== 4) Renk: boş oranı ve dağılım (color kolonu VAR ise) =====
select case when color is null or btrim(color) = '' then '(boş)' else lower(btrim(color)) end as renk,
       count(*) as adet,
       round(100.0 * count(*) / sum(count(*)) over (), 1) as yuzde,
       case when count(*) < 5 then 'az veri' else '' end as uyari
from public.wardrobe_items
group by 1
order by adet desc;

-- ===== 5) Silinmiş/pasif öğe =====
-- Repoda silinmiş/pasif kolonu yok (doğrulanamadı); wardrobe_items'tan silme fiziksel.
-- Bölüm 0'da deleted_at / is_active / archived_at / status 'VAR' çıkarsa bu bölümü o kolona göre
-- ayrıca yazmak gerekir; kolon adı tahmin edilmedi. Hepsi 'YOK' ise ayrı sayılacak öğe yoktur.
select 'bolum_0 sonucuna bak' as not_;
