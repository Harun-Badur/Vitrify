# Dolap veri raporu: runbook

1. Ortam: önce **staging** (Vitrify-A1-Staging). Beta/prod'da çalıştırmak ayrı bir kararındır; bu dosya hiçbir ortama bağlanmaz.
2. Yalnız `SELECT` içerir. Migration, DDL, yazma yok. Sorgular user_id, başlık, marka, dosya yolu, e-posta seçmez.
3. Önce `-- 0)` bölümünü çalıştır; `subcategory` / `color` için `YOK` çıkarsa 3 ve 4'ü atla.
4. Her bölümü ayrı çalıştır (editör yalnız son sonucu gösterir); 5. bölüm kolon varlığına bağlı.
5. Çıktıyı bölüm başına bir **markdown tablo** olarak yapıştır (başlık satırı + satırlar); `az veri` uyarılarını silme.
