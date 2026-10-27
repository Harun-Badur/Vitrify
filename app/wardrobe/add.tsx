import { useOwnedState } from '../../hooks/useOwnedState';
import {
  captureOwnerPublication,
  trackOwnerWork,
} from '../../lib/accountDeviceWork';
import { useCallback, useEffect, useRef } from 'react';
import {
  ActivityIndicator,
  Alert,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import {
  router,
  Stack,
  useFocusEffect,
  useLocalSearchParams,
} from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Camera,
  ImagePlus,
  Shirt,
  ArrowDown,
  Footprints,
  Tag,
  ChevronLeft,
} from 'lucide-react-native';
import PressableScale from '../../components/PressableScale';
import { colors, radius, spacing } from '../../lib/theme';
import {
  measureWardrobeStage,
  wardrobeStageText,
  type WardrobeStage,
} from '../../lib/wardrobeProgress';
import { useAppStore } from '../../store/useAppStore';
import type { GarmentCategory } from '../../types/product';
import {
  canSaveWardrobeForm,
  editTitle,
  formFromItem,
  initialFormState,
  resolveTitle,
  selectCategory,
  selectColor,
  selectSubcategory,
} from '../../lib/wardrobeForm';
import { COLORS, subtypesForCategory } from '../../lib/styleVocabulary';

const groups = [
  { key: 'upper_body', label: 'Üst', icon: Shirt },
  { key: 'lower_body', label: 'Alt', icon: ArrowDown },
  { key: 'shoes', label: 'Ayakkabı', icon: Footprints },
  { key: 'accessories', label: 'Aksesuar', icon: Tag },
] as const;
const categories: { key: GarmentCategory; label: string }[] = [
  { key: 'upper_body', label: 'Üst giyim' },
  { key: 'dresses', label: 'Elbise' },
  { key: 'lower_body', label: 'Alt giyim' },
  { key: 'shoes', label: 'Ayakkabı' },
  { key: 'accessories', label: 'Aksesuar' },
  { key: 'bags', label: 'Çanta' },
  { key: 'hats', label: 'Şapka' },
];
const INITIAL_FORM = initialFormState();
const groupFor = (category: GarmentCategory) =>
  category === 'dresses'
    ? 'upper_body'
    : category === 'bags' || category === 'hats'
      ? 'accessories'
      : category;

export default function AddWardrobeScreen() {
  const owner = useAppStore((state) => state.sessionUserId);
  const { id } = useLocalSearchParams<{ id?: string }>();
  const existing = useAppStore((state) =>
    state.wardrobeItems.find((item) => item.id === id),
  );
  const add = useAppStore((state) => state.addWardrobeItem);
  const update = useAppStore((state) => state.updateWardrobeItem);
  const [form, setForm] = useOwnedState(owner, INITIAL_FORM);
  const [brand, setBrand] = useOwnedState(owner, '');
  const { title, category } = form;
  const [uri, setUri] = useOwnedState(owner, '');
  const [busy, setBusy] = useOwnedState(owner, false);
  const [stage, setStage] = useOwnedState<WardrobeStage>(owner, 'save');
  const [failed, setFailed] = useOwnedState(owner, false);
  const lock = useRef(false);
  const mounted = useRef(true);
  const focused = useRef(true);
  const request = useRef({ owner, id: '' });
  const completedRequest = useRef<string | null>(null);
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useFocusEffect(
    useCallback(() => {
      focused.current = true;
      return () => {
        focused.current = false;
      };
    }, []),
  );
  const initialized = useRef<string | null>(null);
  useEffect(() => {
    const key = `${owner}:${id ?? ''}`;
    if (existing && initialized.current !== key) {
      initialized.current = key;
      setForm(formFromItem(existing));
      setBrand(existing.brand);
      setUri(existing.imageUrl);
    }
  }, [owner, id, existing, setForm, setBrand, setUri]);
  const progress = (value: WardrobeStage) => {
    if (mounted.current) setStage(value);
  };
  const pick = async (camera: boolean): Promise<void> => {
    const current = captureOwnerPublication(owner);
    if (
      !owner ||
      !current() ||
      !mounted.current ||
      !focused.current ||
      lock.current ||
      (request.current.owner === owner && request.current.id)
    )
      return;
    lock.current = true;
    setBusy(true);
    const visible = () => current() && mounted.current && focused.current;
    try {
      const permission = await measureWardrobeStage(
        'permission',
        () =>
          trackOwnerWork(
            owner,
            camera
              ? ImagePicker.requestCameraPermissionsAsync()
              : ImagePicker.requestMediaLibraryPermissionsAsync(),
          ),
        progress,
      );
      if (!visible()) return;
      if (!permission.granted) {
        Alert.alert(
          'Fotoğraf izni gerekli',
          'Kamera veya galeri erişimini cihaz ayarlarından açabilirsin.',
        );
        return;
      }
      const options: ImagePicker.ImagePickerOptions = {
        mediaTypes: ['images'],
        quality: 0.9,
        allowsEditing: false,
      };
      const result = await measureWardrobeStage(
        'picker',
        () =>
          trackOwnerWork(
            owner,
            camera
              ? ImagePicker.launchCameraAsync(options)
              : ImagePicker.launchImageLibraryAsync(options),
          ),
        progress,
      );
      if (visible() && !result.canceled && result.assets[0]) {
        setUri(result.assets[0].uri);
        request.current = { owner, id: '' };
        setFailed(false);
      }
    } catch {
      if (visible()) Alert.alert('Fotoğraf açılamadı', 'Lütfen tekrar dene.');
    } finally {
      lock.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  const save = async (): Promise<void> => {
    const current = captureOwnerPublication(owner);
    if (
      !owner ||
      !current() ||
      !mounted.current ||
      !focused.current ||
      lock.current ||
      (request.current.owner === owner &&
        request.current.id === completedRequest.current)
    )
      return;
    if (!canSaveWardrobeForm(uri, form)) {
      Alert.alert(
        'Kıyafet bilgileri eksik',
        'Bir fotoğraf, alt tür ve renk seç.',
      );
      return;
    }
    lock.current = true;
    setBusy(true);
    setFailed(false);
    Keyboard.dismiss();
    const visible = () => current() && mounted.current && focused.current;
    if (request.current.owner !== owner || !request.current.id)
      request.current = {
        owner,
        id: `wardrobe-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      };
    try {
      await measureWardrobeStage(
        'save',
        async () => {
          if (id) {
            if (!existing)
              throw new Error('Kıyafet artık dolabında bulunmuyor.');
            await update(
              id,
              {
                title: resolveTitle(form),
                brand: brand.trim(),
                category,
                subcategory: form.subcategory,
                color: form.color,
              },
              progress,
            );
          } else
            await add(
              {
                title: resolveTitle(form),
                brand: brand.trim(),
                category,
                imageUrl: uri,
                subcategory: form.subcategory,
                color: form.color,
              },
              { requestId: request.current.id, onStage: progress },
            );
        },
        progress,
      );
      completedRequest.current = request.current.id;
      if (visible()) {
        if (id) router.back();
        else router.dismissTo('/(tabs)/liked');
      }
    } catch {
      if (visible()) {
        setFailed(true);
      }
    } finally {
      lock.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  const formLocked =
    busy || (request.current.owner === owner && !!request.current.id);
  const submitDisabled = busy || !canSaveWardrobeForm(uri, form);
  const subtypeOptions = subtypesForCategory(category);
  const activeGroup = groupFor(category);
  const subcategories = categories.filter(
    (value) => groupFor(value.key) === activeGroup,
  );
  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <Stack.Screen options={{ headerShown: false }} />
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[
          styles.content,
          {
            paddingTop: insets.top + 8,
            paddingBottom: Math.max(insets.bottom, 16),
          },
        ]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
        showsVerticalScrollIndicator={false}
        bounces={false}
      >
        <View style={styles.header}>
          <PressableScale
            style={styles.back}
            onPress={() => router.back()}
            accessibilityRole="button"
            accessibilityLabel="Geri"
          >
            <ChevronLeft size={23} color={colors.text} />
          </PressableScale>
          <Text style={styles.heading}>
            {id ? 'Kıyafeti Düzenle' : 'Kıyafet Ekle'}
          </Text>
          <View style={styles.back} />
        </View>
        <View
          style={[
            styles.preview,
            { height: Math.min(210, Math.max(120, height * 0.23)) },
          ]}
        >
          {uri ? (
            <Image
              cachePolicy="none"
              source={{ uri }}
              style={styles.image}
              contentFit="contain"
              accessibilityLabel="Kıyafet fotoğrafı"
            />
          ) : (
            <>
              <Shirt size={38} color={colors.accent} />
              <Text style={styles.hint}>Dolabına yeni bir parça ekle</Text>
            </>
          )}
        </View>
        {!id ? (
          <View style={styles.row}>
            {[
              {
                camera: true,
                label: 'Fotoğraf Çek',
                accessibility: 'Fotoğraf çek',
                icon: Camera,
              },
              {
                camera: false,
                label: 'Galeriden Seç',
                accessibility: 'Galeriden seç',
                icon: ImagePlus,
              },
            ].map(({ camera, label, accessibility, icon: Icon }) => (
              <PressableScale
                key={label}
                disabled={formLocked}
                style={styles.photoAction}
                onPress={() => void pick(camera)}
                accessibilityRole="button"
                accessibilityState={{ disabled: formLocked }}
                accessibilityLabel={accessibility}
              >
                <Icon size={19} color={colors.accentDark} />
                <Text style={styles.actionText}>{label}</Text>
              </PressableScale>
            ))}
          </View>
        ) : null}
        <Text style={styles.label}>Kategori</Text>
        <View style={styles.row}>
          {groups.map(({ key, label, icon: Icon }) => (
            <PressableScale
              key={key}
              disabled={formLocked}
              style={[styles.category, activeGroup === key && styles.selected]}
              onPress={() => setForm((previous) => selectCategory(previous, key))}
              accessibilityRole="radio"
              accessibilityState={{
                selected: activeGroup === key,
                disabled: formLocked,
              }}
              accessibilityLabel={`${label} kategorisi`}
            >
              <Icon
                size={22}
                color={
                  activeGroup === key ? colors.accentDark : colors.textSecondary
                }
              />
              <Text
                style={[
                  styles.categoryText,
                  activeGroup === key && styles.selectedText,
                ]}
              >
                {label}
              </Text>
            </PressableScale>
          ))}
        </View>
        {subcategories.length > 1 ? (
          <View style={styles.row}>
            {subcategories.map((value) => (
              <PressableScale
                key={value.key}
                disabled={formLocked}
                style={[
                  styles.subcategory,
                  category === value.key && styles.selected,
                ]}
                accessibilityLabel={`${value.label} alt kategorisi`}
                accessibilityRole="radio"
                accessibilityState={{
                  selected: category === value.key,
                  disabled: formLocked,
                }}
                onPress={() => setForm((previous) => selectCategory(previous, value.key))}
              >
                <Text style={styles.categoryText}>{value.label}</Text>
              </PressableScale>
            ))}
          </View>
        ) : null}
        {subtypeOptions.length > 1 ? (
          <>
            <Text style={styles.label}>Alt tür</Text>
            <View style={styles.wrapRow}>
              {subtypeOptions.map((option) => (
                <PressableScale
                  key={option.slug}
                  disabled={formLocked}
                  style={[
                    styles.subcategory,
                    form.subcategory === option.slug && styles.selected,
                  ]}
                  accessibilityLabel={`${option.label} alt türü`}
                  accessibilityRole="radio"
                  accessibilityState={{
                    selected: form.subcategory === option.slug,
                    disabled: formLocked,
                  }}
                  onPress={() =>
                    setForm((previous) => selectSubcategory(previous, option.slug))
                  }
                >
                  <Text style={styles.categoryText}>{option.label}</Text>
                </PressableScale>
              ))}
            </View>
          </>
        ) : null}
        <Text style={styles.label}>Renk</Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.colorRow}
        >
          {COLORS.map((color) => {
            const isSelected = form.color === color.slug;
            return (
              <PressableScale
                key={color.slug}
                disabled={formLocked}
                style={color.hex ? styles.colorItem : [styles.subcategory, isSelected && styles.selected]}
                accessibilityLabel={`${color.label} rengi`}
                accessibilityRole="radio"
                accessibilityState={{ selected: isSelected, disabled: formLocked }}
                onPress={() => setForm((previous) => selectColor(previous, color.slug))}
              >
                {color.hex ? (
                  <>
                    <View style={[styles.colorRing, isSelected && styles.colorRingSelected]}>
                      <View style={[styles.colorDot, { backgroundColor: color.hex }]} />
                    </View>
                    <Text style={[styles.colorName, isSelected && styles.selectedText]}>
                      {color.label}
                    </Text>
                  </>
                ) : (
                  <Text style={styles.categoryText}>{color.label}</Text>
                )}
              </PressableScale>
            );
          })}
        </ScrollView>
        <Text style={styles.label}>Kıyafet adı</Text>
        <TextInput
          style={styles.input}
          value={title}
          onChangeText={(value) => setForm((previous) => editTitle(previous, value))}
          placeholder="Örn. Krem keten gömlek"
          placeholderTextColor={colors.placeholder}
          accessibilityLabel="Kıyafet adı"
          maxLength={120}
          editable={!formLocked}
          returnKeyType="next"
        />
        <TextInput
          style={styles.input}
          value={brand}
          onChangeText={setBrand}
          placeholder="Marka (isteğe bağlı)"
          placeholderTextColor={colors.placeholder}
          accessibilityLabel="Kıyafet markası"
          maxLength={80}
          editable={!formLocked}
          returnKeyType="done"
          onSubmitEditing={() => void save()}
        />
        <PressableScale
          disabled={submitDisabled}
          style={[styles.submit, submitDisabled && styles.disabled]}
          onPress={() => void save()}
          accessibilityRole="button"
          accessibilityLabel="Kıyafeti kaydet"
          accessibilityState={{ disabled: submitDisabled, busy }}
        >
          {busy ? <ActivityIndicator color={colors.inverseText} /> : null}
          <Text style={styles.submitText}>
            {busy
              ? wardrobeStageText[stage]
              : failed
                ? 'Tekrar Dene'
                : id
                  ? 'Değişiklikleri Kaydet'
                  : 'Dolabıma Ekle'}
          </Text>
        </PressableScale>
        {failed ? (
          <Text style={styles.hint} accessibilityLabel="Kayıt durumu" accessibilityLiveRegion="polite">
            Kayıt tamamlanamadı. Tekrar denediğinde aynı kayıtla devam edeceğiz.
          </Text>
        ) : null}
        {busy ? (
          <Text
            style={styles.hint}
            accessibilityLiveRegion="polite"
            accessibilityRole="text"
          >
            {wardrobeStageText[stage]}
          </Text>
        ) : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  scroll: { flex: 1 },
  content: {
    flexGrow: 1,
    paddingHorizontal: spacing.xl,
    gap: 10,
    width: '100%',
    maxWidth: 500,
    alignSelf: 'center',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  back: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heading: { color: colors.text, fontWeight: '700', fontSize: 20 },
  preview: {
    borderRadius: radius.card,
    backgroundColor: colors.input,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  image: { width: '100%', height: '100%' },
  row: { flexDirection: 'row', gap: 8 },
  photoAction: {
    flex: 1,
    minHeight: 46,
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.button,
    backgroundColor: colors.input,
  },
  actionText: {
    color: colors.accentDark,
    fontWeight: '600',
    fontSize: 12,
    flexShrink: 1,
  },
  label: { color: colors.text, fontWeight: '600', fontSize: 12, marginTop: 2 },
  category: {
    flex: 1,
    minHeight: 66,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.button,
    backgroundColor: colors.input,
  },
  categoryText: {
    color: colors.textSecondary,
    fontSize: 11,
    fontWeight: '600',
  },
  selectedText: { color: colors.accentDark },
  selected: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
  subcategory: {
    minHeight: 44,
    paddingHorizontal: 12,
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.chip,
    backgroundColor: colors.input,
  },
  wrapRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  colorRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, paddingVertical: 2 },
  colorItem: { width: 56, alignItems: 'center', gap: 2 },
  colorRing: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 2,
    borderColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
  },
  colorRingSelected: { borderColor: colors.accent },
  colorDot: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
  },
  colorName: { color: colors.textSecondary, fontSize: 10, fontWeight: '600', textAlign: 'center' },
  input: {
    minHeight: 46,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.button,
    backgroundColor: colors.input,
    color: colors.text,
    fontSize: 14,
  },
  submit: {
    minHeight: 50,
    paddingHorizontal: 12,
    paddingVertical: 12,
    flexDirection: 'row',
    gap: 8,
    backgroundColor: colors.accent,
    borderRadius: radius.button,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  submitText: {
    color: colors.inverseText,
    fontWeight: '700',
    fontSize: 14,
    flexShrink: 1,
    textAlign: 'center',
  },
  disabled: { opacity: 0.7 },
  hint: {
    color: colors.textSecondary,
    fontSize: 12,
    textAlign: 'center',
    lineHeight: 18,
  },
});
