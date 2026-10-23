import { GARMENT_CATEGORY_LABEL, isGarmentCategory, type LikedProduct } from '../types/product';
import { STUDIO_COLORS, STYLE_TAGS, type UserStudioProfile } from '../types/profile';
import type { SavedOutfit, WardrobeItem } from '../types/wardrobe';
import type { CalculatedStyleProfileState } from '../types/calculatedStyleProfile';

export type DiscoveryStatus = 'Henüz keşfedilmedi' | 'Gelişiyor' | 'Keşfedildi';
export type JourneyTarget = 'discover' | 'wardrobe' | 'outfit' | 'preferences';
export interface StyleJourneyInput {
  userId: string | null;
  sessionUserId: string | null;
  sessionSyncStatus: 'idle' | 'loading' | 'error' | 'success';
  wardrobeStatus: 'idle' | 'loading' | 'error' | 'ready';
  likedProducts: readonly LikedProduct[];
  passedProductIds: readonly string[];
  wardrobeItems: readonly WardrobeItem[];
  savedOutfits: readonly SavedOutfit[];
  profile: UserStudioProfile | null;
  calculatedProfile?: CalculatedStyleProfileState;
}
export interface StyleInsight {
  id: 'color' | 'category' | 'outfits' | 'style' | 'fit' | 'brand' | 'price';
  title: string;
  status: DiscoveryStatus;
  summary: string;
  detail: string;
}
export interface StyleJourney {
  percent: number;
  status: DiscoveryStatus;
  notice: string | null;
  insightNotice?: string;
  counts: { evaluations: number; wardrobe: number; outfits: number; declared: number };
  task: { target: JourneyTarget; label: string };
  insights: StyleInsight[];
}

// Current retained records, not lifetime XP or model accuracy. Removal/undo may
// reduce progress. No writes, tracking, title inference or new persistence.
export const STYLE_JOURNEY_GOALS = { evaluations: 10, wardrobe: 3, outfits: 2, declared: 1 } as const;
export const STYLE_JOURNEY_EVIDENCE = { samples: 5, repeats: 3 } as const;
const normalize = (value: string) => value.trim().toLocaleLowerCase('tr-TR');
const token = (value: string) => normalize(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ı/g, 'i').replace(/[ _]+/g, '-');
const labels: Record<string, string> = { gomlek: 'Gömlek', tisort: 'Tişört', pantolon: 'Pantolon', elbise: 'Elbise', ceket: 'Ceket', blazer: 'Blazer', hoodie: 'Kapüşonlu', sweatshirt: 'Sweatshirt', polo: 'Polo', jean: 'Jean', kargo: 'Kargo', esofman: 'Eşofman', sort: 'Şort', etek: 'Etek', pareo: 'Pareo', ayakkabi: 'Ayakkabı', canta: 'Çanta', sapka: 'Şapka', aksesuar: 'Aksesuar', upper_body: 'Üst Giyim', lower_body: 'Alt Giyim', oversized: 'Bol kesim', relaxed: 'Rahat kesim', regular: 'Normal kesim', slim: 'Dar kesim', low: 'Uygun fiyat bandı', mid: 'Orta fiyat bandı', high: 'Yüksek fiyat bandı', luxury: 'Lüks fiyat bandı' };
const colorLabels = new Map<string, string>(STUDIO_COLORS.map(color => [token(color.label), color.label]));
Object.entries({ navy: 'Lacivert', bordo: 'Bordo', camel: 'Camel', altin: 'Altın', gumus: 'Gümüş', turkuaz: 'Turkuaz', krem: 'Krem' }).forEach(([key, value]) => colorLabels.set(key, value));
const colorsByName = new Map(STUDIO_COLORS.map(color => [normalize(color.label), color.label]));
function tendency(id: 'color' | 'category', title: string, observations: string[][]): StyleInsight {
  const samples = observations.filter(values => values.length > 0);
  const counts = new Map<string, number>();
  samples.forEach(values => new Set(values).forEach(value => counts.set(value, (counts.get(value) ?? 0) + 1)));
  const repeated = [...counts].filter(([, count]) => count >= STYLE_JOURNEY_EVIDENCE.repeats)
    .sort((a,b) => b[1]-a[1] || a[0].localeCompare(b[0], 'tr')).slice(0,2);
  const unlocked = samples.length >= STYLE_JOURNEY_EVIDENCE.samples && repeated.length > 0;
  return { id, title,
    status: unlocked ? 'Keşfedildi' : samples.length ? 'Gelişiyor' : 'Henüz keşfedilmedi',
    summary: unlocked ? repeated.map(([label, count]) => `${label} (${count}/${samples.length})`).join(' · ')
      : samples.length ? `${samples.length} metadata örneği; eğilim henüz net değil` : 'Yeterli metadata yok',
    detail: `Yalnız mevcut beğenilerindeki açık ${id === 'color' ? 'renk' : 'kategori'} metadata'sı kullanılır. `
      + `En az 5 farklı beğenide veri ve aynı değerde en az 3 tekrar gerekir. ${samples.length} örnek var. `
      + 'Geçilen ürünler olumlu tercih sayılmaz. Bu bir gözlem; kesin kişilik veya tarz sonucu değildir.',
  };
}

export function buildStyleJourney(input: StyleJourneyInput): StyleJourney {
  const owned = Boolean(input.userId && input.userId === input.sessionUserId);
  const ratingsReady = owned && input.sessionSyncStatus === 'success';
  const wardrobeReady = owned && input.wardrobeStatus === 'ready';
  const passed = new Set(ratingsReady ? input.passedProductIds.filter(Boolean) : []);
  const liked = new Map((ratingsReady ? input.likedProducts : []).map(like => [like.product.id, like.product]));
  const positive = [...liked.values()].filter(product => !passed.has(product.id));
  const wardrobe = new Map((wardrobeReady ? input.wardrobeItems : []).map(item => [item.id, item]));
  const outfits = new Map((wardrobeReady ? input.savedOutfits : []).filter(outfit =>
    outfit.wardrobeItemIds.every(id => wardrobe.has(id))
      && new Set([...outfit.wardrobeItemIds, ...outfit.catalogProductIds]).size >= 2)
    .map(outfit => [outfit.id, outfit]));
  const profile = owned && input.profile?.userId === input.userId ? input.profile : null;
  const declared = profile && (profile.styleTags.some(value => STYLE_TAGS.some(tag => tag.value === value))
    || profile.preferredColors?.some(value => colorsByName.has(normalize(value)))
    || profile.favoriteBrands?.some(value => value.trim())) ? 1 : 0;
  const counts = { evaluations: new Set([...liked.keys(), ...passed]).size,
    wardrobe: wardrobe.size, outfits: outfits.size, declared };
  const goals = STYLE_JOURNEY_GOALS;
  const percent = Math.round(Math.min(counts.evaluations/goals.evaluations,1)*50 + Math.min(counts.wardrobe/goals.wardrobe,1)*25
    + Math.min(counts.outfits/goals.outfits,1)*15 + declared*10);
  const task = counts.evaluations < goals.evaluations ? { target: 'discover' as const, label: `Keşfet'te ${goals.evaluations-counts.evaluations} farklı ürünü değerlendir` }
    : counts.wardrobe < goals.wardrobe ? { target: 'wardrobe' as const, label: `Dolabına ${goals.wardrobe-counts.wardrobe} parça daha ekleyebilirsin` }
    : counts.outfits < goals.outfits ? { target: 'outfit' as const, label: 'Parçalarınla bir kombin oluştur' }
    : !declared ? { target: 'preferences' as const, label: 'İstersen bir stil, renk veya marka tercihi belirt' }
    : { target: 'discover' as const, label: 'İstersen farklı ürünleri keşfetmeye devam et' };
  const notice = !owned ? 'Stil yolculuğun için hesabındaki veriler bekleniyor.'
    : input.sessionSyncStatus === 'error' || input.wardrobeStatus === 'error'
      ? 'Bazı veriler yüklenemedi; ilerleme eksik olabilir. Bağlantını kontrol et.'
      : !ratingsReady || !wardrobeReady ? 'Verilerin yükleniyor; ilerleme henüz tamamlanmadı.' : null;
  const supplied = input.calculatedProfile;
  const backendInsights = Boolean(supplied && !(supplied.state==='ready' && owned
    && supplied.profile.snapshot.userId===input.userId && supplied.profile.algorithm==='v1'));
  const result: StyleJourney = { percent, counts, task, notice,
    status: percent === 100 ? 'Keşfedildi' : percent > 0 ? 'Gelişiyor' : 'Henüz keşfedilmedi',
    insights: [
      ...(backendInsights ? [] : [tendency('color', 'Renk eğilimlerin', positive.map(product => (Array.isArray(product.colors) ? product.colors : [])
        .flatMap(color => { const label = typeof color?.name === 'string' ? colorsByName.get(normalize(color.name)) : undefined; return label ? [label] : []; }))),
      tendency('category', 'Kategori eğilimlerin', positive.map(product => isGarmentCategory(product.category)
        ? [GARMENT_CATEGORY_LABEL[product.category]] : []))]),
      { id: 'outfits', title: 'Kombin yolculuğun',
        status: outfits.size >= 2 ? 'Keşfedildi' : outfits.size ? 'Gelişiyor' : 'Henüz keşfedilmedi',
        summary: outfits.size >= 2 ? `${outfits.size} kaydedilmiş kombin` : 'İlk 2 kombinle açılır',
        detail: `${outfits.size} geçerli kombin kaydın var. En az 2 parça içeren 2 farklı kombinle bu adım açılır. `
          + 'Silinmiş dolap parçalarına başvuran kayıtlar sayılmaz. Kombin sayısı stil türünü belirlemez.' },
      { id: 'style', title: 'Tarz eğilimlerin', status: 'Henüz keşfedilmedi',
        summary: 'Otomatik tarz çıkarımı henüz desteklenmiyor',
        detail: 'Mevcut ürün metadata’sı minimal, klasik veya spor tarzını güvenilir biçimde göstermiyor. '
          + 'Bu yüzden davranışlarından tarz etiketi uydurmuyoruz. Seçtiğin tarzlar aşağıda manuel tercih olarak korunur.' },
    ],
  };
  const read = input.calculatedProfile;
  if (!read) return result; // Existing V1 caller contract stays unchanged.
  const model = read.state === 'ready' && owned && read.profile.snapshot.userId === input.userId ? read.profile : null;
  if (model?.algorithm === 'v1') return result;
  if (!model) result.insightNotice = read.state === 'loading' ? 'Hesaplanan stil profili yükleniyor.' : 'Hesaplanan stil profili doğrulanamadı; eski eğilimler gösterilmiyor.';
  const sourceDetail = 'Kaynak: user_style_profiles; Keşfet ile aynı hesaplanan tercih ağırlıkları. '
    + (model ? `${model.eventCount} hesaplama olayı; ${model.snapshot.negativePreferences.length} negatif tercih kaydı. ` : '')
    + 'Olay sayısı beğeni veya boyut örneği sayısı değildir. Ağırlıklar olasılık/doğruluk değildir; kesin tarz çıkarılmaz. '
    + (model?.computedAt ? `Hesaplama zamanı: ${model.computedAt}. ` : '')
    + 'V2 geçiş güncelliği okuma sırasında denetlenir; örnek sayısı ve boyut bazında güven skoru mevcut değildir. '
    + 'Dolap sahipliği beğeni sayılmaz. Manuel tercihler ayrı alanda korunur.';
  const preference = (id: StyleInsight['id'], title: string, weights: Record<string, number>): StyleInsight => {
    const values = model && model.eventCount > 0 ? Object.entries(weights).filter(([,w])=>Number.isFinite(w)&&w>0)
      .sort(([a,x],[b,y])=>y-x||a.localeCompare(b,'tr')).slice(0,2) : [];
    const displayLabels = values.map(([value]) => id === 'color' ? colorLabels.get(token(value)) ?? value : id === 'brand' ? value.replace(/-/g, ' ') : labels[value] ?? value);
    return { id, title, status: values.length ? 'Gelişiyor' : 'Henüz keşfedilmedi',
      summary: displayLabels.length ? displayLabels.join(' · ') : 'Yeterli tercih verisi yok',
      detail: sourceDetail + (values.length ? '' : 'Yeterli doğrulanmış tercih verisi yok.') };
  };
  result.insights = [preference('color','Renk eğilimlerin',model?.snapshot.colorW ?? {}),
    preference('category','Alt kategori eğilimlerin',model?.snapshot.subcategoryW ?? {}),
    preference('fit','Kesim eğilimlerin',model?.snapshot.fitW ?? {}),
    preference('brand','Marka eğilimlerin',model?.snapshot.brandW ?? {}),
    preference('price','Hesaplanan fiyat bandı',model?.snapshot.priceBandW ?? {}),
    ...result.insights.filter(x=>x.id==='outfits'||x.id==='style')];
  return result;
}
