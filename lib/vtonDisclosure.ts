// Increment VTON_CONSENT_TEXT_VERSION when materially changing this disclosure.
export const VTON_DISCLOSURE = {
  lead: 'Sanal deneme, fotoğrafının sunucuda ve FASHN adlı harici sağlayıcıda işlenmesini gerektirir.',
  items: [
    'Seçtiğin kişi fotoğrafı ve ürün görseli, Supabase üzerindeki aracımız üzerinden HTTPS ile FASHN hizmetine aktarılır.',
    'Sonuç görseli ve deneme geçmişi cihazında tutulur. Profilde model fotoğrafı kaydetmeyi seçersen fotoğraf Supabase Storage’da ayrıca saklanır; profilinden kaldırabilirsin.',
    'Uygulama hesabındaki dosyaları temizleyebilir. FASHN’in saklama, silme ve eğitim uygulamaları bu sürüm için teknik olarak doğrulanmadı; sıfır saklama veya anında silme garantisi verilmiyor.',
    'Vazgeçersen bu ekrandan yeni deneme başlatılmaz. Kabulün bu cihazdaki hesabın ve bu açıklamanın sürümü için kaydedilir. Önceden aktarılmış veriler bu seçimle geri alınmaz.',
  ],
} as const;
