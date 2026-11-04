import { useOwnedState } from '../../hooks/useOwnedState';
import { captureOwnerPublication, trackOwnerWork } from '../../lib/accountDeviceWork';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  Platform,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import * as StoreReview from 'expo-store-review';
import {
  Bell,
  Camera,
  ChevronRight,
  CircleHelp,
  LogOut,
  Settings,
  ShieldCheck,
  Shirt,
  Sparkles,
  Trash2,
  User,
} from 'lucide-react-native';
import InviteCodeModal from '../../components/InviteCodeModal';
import PressableScale from '../../components/PressableScale';
import ProfileSheet from '../../components/ProfileSheet';
import PrivacyCenter from '../../components/PrivacyCenter';
import ProductPrefSetting from '../../components/ProductPrefSetting';
import PremiumMembership from '../../components/PremiumMembership';
import {premiumClient} from '../../services/revenueCatMobile';
import {buildPremiumDeletionNotice,subscriptionManagementUrl} from '../../lib/premiumDeletionNotice';
import ProfileStyleJourney from '../../components/ProfileStyleJourney';
import ProfileStyleGrid from '../../components/ProfileStyleGrid';
import ProfileOnlyYou from '../../components/ProfileOnlyYou';
import SizeStudioSheet, {
  type StyleSheetSection,
} from '../../components/SizeStudioSheet';
import TryOnHistorySheet from '../../components/TryOnHistorySheet';
import { useAuthContext } from '../../hooks/useAuthContext';
import { buildInviteShareMessage } from '../../lib/inviteShare';
import { logger } from '../../lib/logger';
import { checkLowResolutionPersonPhoto } from '../../lib/personPhotoPrepare';
import { PRIVACY_URL, SUPPORT_EMAIL } from '../../lib/privacy';
import { PROFILE_MENU_LABEL, PROFILE_SECTION_GAP, colors, radius, spacing } from '../../lib/theme';
import { initials } from '../../lib/profileDisplay';
import { buildStyleJourney, type JourneyTarget } from '../../lib/profileStyleJourney';
import { fetchCalculatedStyleProfile, subscribeStyleProfileChanges } from '../../lib/recsConfig';
import { refreshStartState, type CalculatedRefreshReason } from '../../lib/calculatedProfileRefresh';
import type { CalculatedStyleProfileState } from '../../types/calculatedStyleProfile';
import { LOW_RES_MODEL_PHOTO_HINT } from '../../lib/vtonPersonImage';
import { completeAccountDeletion, AccountDeletionPendingError } from '../../services/accountService';
import {
  fetchAccountDetails,
  saveAccountDetails,
  type AccountDetails,
} from '../../services/accountDetailsService';
import { useAppStore } from '../../store/useAppStore';
import { logPerfSummary, perfTraceEnabled } from '../../lib/perfTrace';
import { cancelScheduledFeedRefreshOnOwnerChange, profileChangeAffectsFeed, scheduleFeedRefreshAfterProfileSave } from '../../lib/profileSaveFeedRefresh';
import { createAccountDeletionRuntime } from '../../services/accountDeletionRuntime';
import {
  createModelPhotoSignedUrl,
  fetchStudioProfile,
  removeModelPhoto,
  uploadModelPhoto,
  upsertStudioProfile,
} from '../../services/profileService';
import {
  type StudioProfilePatch,
  type UserStudioProfile,
} from '../../types/profile';

const AVATAR_SIZE = 68;
const AVATAR_RADIUS = AVATAR_SIZE / 2;
const ICON_SM = 18;
const CAMERA_BADGE_SIZE = 28;
const CAMERA_BADGE_BORDER = 3;
const CAMERA_HIT_SLOP = 8; // 28 + 2*8 = 44dp touch target
const SETTINGS_BUTTON_SIZE = 44;
const TOAST_DURATION_MS = 1600;
const INVITE_SAVED_TOAST = 'Kod alındı — yakında aktifleşecek';

const emptyStudio = (userId: string): UserStudioProfile => ({
  userId,
  heightCm: null,
  weightKg: null,
  topSize: null,
  bottomSize: null,
  styleTags: [],
  modelPhotoPath: null,
});

interface MenuRowProps {
  label: string;
  icon: ReactNode;
  onPress: () => void;
  accessibilityRole?: 'button' | 'link';
  accessibilityLabel: string;
  disabled?: boolean;
  isLast?: boolean;
  trailing?: ReactNode;
}

function MenuRow({
  label,
  icon,
  onPress,
  accessibilityRole = 'button',
  accessibilityLabel,
  disabled = false,
  isLast = false,
  trailing,
}: MenuRowProps) {
  return (
    <PressableScale
      onPress={onPress}
      disabled={disabled}
      style={[styles.menuRow, isLast ? null : styles.menuRowBorder]}
      accessibilityRole={accessibilityRole}
      accessibilityLabel={accessibilityLabel}
    >
      <View style={styles.menuLeading}>
        {icon}
        <Text style={styles.menuLabel}>{label}</Text>
      </View>
      <View style={styles.menuTrailing}>
        {trailing}
        <ChevronRight color={colors.tabInactive} size={ICON_SM} />
      </View>
    </PressableScale>
  );
}

export default function ProfileScreen() {
  const { user, signOut } = useAuthContext();
  const userId = user?.id ?? null;
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width, fontScale } = useWindowDimensions();
  const compactProfile = width < 380 || fontScale > 1.3;
  const wardrobeCount = useAppStore((state) => state.wardrobeItems.length);
  const favoriteCount = useAppStore((state) => state.likedProducts.length);
  const outfitCount = useAppStore((state) => state.savedOutfits.length);
  const sessionUserId = useAppStore((state) => state.sessionUserId);
  const sessionSyncStatus = useAppStore((state) => state.sessionSyncStatus);
  const wardrobeStatus = useAppStore((state) => state.wardrobeStatus);
  const likedProducts = useAppStore((state) => state.likedProducts);
  const passedProductIds = useAppStore((state) => state.passedProductIds);
  const wardrobeItems = useAppStore((state) => state.wardrobeItems);
  const savedOutfits = useAppStore((state) => state.savedOutfits);
  const [account, setAccount] = useOwnedState<AccountDetails | null>(userId, null);
  const [accountOpen, setAccountOpen] = useState(false);
  const [accountLoading, setAccountLoading] = useState(false);
  const [accountSaving, setAccountSaving] = useState(false);
  const [accountName, setAccountName] = useOwnedState(userId, '');
  const [accountEmailInput, setAccountEmailInput] = useOwnedState(userId, '');
  const [accountError, setAccountError] = useOwnedState<string | null>(userId, null);
  const [accountNotice, setAccountNotice] = useOwnedState<string | null>(userId, null);
  const currentAccount = account?.id === user?.id ? account : null;
  const displayName =
    currentAccount?.username || user?.email?.split('@')[0] || 'Kullanıcı';
  const accountEmail = currentAccount?.email || user?.email || 'E-posta yok';
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useOwnedState<string | null>(userId, null);
  const [studio, setStudio] = useOwnedState<UserStudioProfile | null>(userId, null);
  const [photoUri, setPhotoUri] = useOwnedState<string | null>(userId, null);
  const [isModelPhotoLowRes, setIsModelPhotoLowRes] = useOwnedState(userId, false);
  const [uploadProgress, setUploadProgress] = useOwnedState<number | null>(userId, null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [privacyOpen, setPrivacyOpen] = useState(false);
  const [sizeOpen, setSizeOpen] = useState(false);
  const [styleSheetSection, setStyleSheetSection] =
    useState<StyleSheetSection>('all');
  const [inviteOpen, setInviteOpen] = useState(false);
  const [toastMessage, setToastMessage] = useOwnedState<string | null>(userId, null);
  const toastTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);


  const isBusy =
    isSigningOut || isDeleting || isSaving || uploadProgress !== null;
  const preferencesDisabled = isBusy || studio?.userId !== userId;
  const hasPhoto = photoUri !== null;
  const currentStudio = studio ?? (userId ? emptyStudio(userId) : null);
  const [calculatedProfile, setCalculatedProfile] = useOwnedState<CalculatedStyleProfileState>(userId, {state:'loading'});
  const calculatedRef = useRef(calculatedProfile);
  calculatedRef.current = calculatedProfile;
  const refreshRef = useRef<((reason: CalculatedRefreshReason) => void) | null>(null);
  useFocusEffect(useCallback(() => {
    let active = true, revision = 0;
    if (!userId || userId !== sessionUserId || sessionSyncStatus !== 'success') return;
    const current = captureOwnerPublication(userId);
    const refresh = (reason: CalculatedRefreshReason) => {
      const version=++revision;
      const start = refreshStartState(calculatedRef.current, reason);
      if (start) setCalculatedProfile(start);
      void trackOwnerWork(userId, fetchCalculatedStyleProfile(userId)).then(profile => {
        if (active && current() && version===revision) {
          const previous=calculatedRef.current;
          if (previous.state!=='ready'||previous.profile!==profile) setCalculatedProfile({state:'ready',profile});
        }
      }).catch(() => {
        // A silent focus refresh that fails keeps the value verified moments ago; changes and retries show the error.
        if (active && current() && version===revision && !(reason==='focus' && calculatedRef.current.state==='ready')) setCalculatedProfile({state:'error'});
      });
    };
    refreshRef.current = refresh;
    const unsubscribe=subscribeStyleProfileChanges(userId,()=>refresh('changed'));
    refresh('focus');
    return () => { active=false; refreshRef.current = null; unsubscribe(); };
  }, [userId, sessionUserId, sessionSyncStatus, studio]));
  const handleRetryCalculated = useCallback(() => { refreshRef.current?.('retry'); }, []);
  useEffect(() => cancelScheduledFeedRefreshOnOwnerChange(sessionUserId), [sessionUserId]);
  const journey = useMemo(() => buildStyleJourney({ userId, sessionUserId, sessionSyncStatus,
    wardrobeStatus, likedProducts, passedProductIds, wardrobeItems, savedOutfits, profile: studio, calculatedProfile }),
  [userId, sessionUserId, sessionSyncStatus, wardrobeStatus, likedProducts, passedProductIds, wardrobeItems, savedOutfits, studio, calculatedProfile]);
  const openPreferenceSection = (section: StyleSheetSection): void => {
    setStyleSheetSection(section);
    setSizeOpen(true);
  };
  const handleJourneyTask = (target: JourneyTarget): void => {
    if (target === 'preferences') {
      const { declaredItems } = journey;
      openPreferenceSection(!declaredItems.style ? 'style' : !declaredItems.body ? 'body' : !declaredItems.colors ? 'colors'
        : !declaredItems.brands ? 'brands' : !declaredItems.price ? 'budget' : 'all');
    }
    else if (target === 'outfit') router.push('/wardrobe/create');
    else if (target === 'wardrobe') router.push('/(tabs)/liked');
    else router.push('/(tabs)');
  };

  const showToast = useCallback((message: string): void => {
    if (toastTimeoutRef.current !== null) {
      clearTimeout(toastTimeoutRef.current);
    }
    setToastMessage(message);
    toastTimeoutRef.current = setTimeout(() => {
      setToastMessage(null);
      toastTimeoutRef.current = null;
    }, TOAST_DURATION_MS);
  }, [userId]);

  useEffect(() => {
    return () => {
      if (toastTimeoutRef.current !== null) {
        clearTimeout(toastTimeoutRef.current);
      }
    };
  }, []);

  const loadStudio = useCallback(async (id: string): Promise<void> => {
    const current = captureOwnerPublication(id);
    try {
      const profile = await fetchStudioProfile(id);
      if (!current()) return;
      setStudio(profile);
      if (profile.modelPhotoPath) {
        const signed = await createModelPhotoSignedUrl(profile.modelPhotoPath);
        setPhotoUri(signed);
        if (signed) {
          const lowRes = await checkLowResolutionPersonPhoto(signed, id);
          setIsModelPhotoLowRes(lowRes);
        } else {
          setIsModelPhotoLowRes(false);
        }
      } else {
        setPhotoUri(null);
        setIsModelPhotoLowRes(false);
      }
    } catch (error) {
      logger.error('Stüdyo profili yüklenemedi', { error });
      setErrorMessage('Profil bilgileri yüklenemedi. Lütfen tekrar dene.');
    }
  }, [userId]);

  useFocusEffect(
    useCallback(() => {
      if (!userId) {
        return;
      }
      void loadStudio(userId);
    }, [loadStudio, userId]),
  );

  useFocusEffect(
    useCallback(() => {
      if (!userId) return;
      let active = true;
      void fetchAccountDetails(userId)
        .then((details) => {
          if (active) setAccount(details);
        })
        .catch(() => {
          // Keep the last confirmed account details when offline.
        });
      return () => {
        active = false;
      };
    }, [userId]),
  );

  const handleOpenAccount = async (): Promise<void> => {
    if (!userId) return;
    setAccountOpen(true);
    setAccountLoading(true);
    setAccountError(null);
    setAccountNotice(null);
    try {
      const details = await fetchAccountDetails(userId);
      setAccount(details);
      setAccountName(details.username);
      setAccountEmailInput(details.pendingEmail ?? details.email);
      if (details.pendingEmail)
        setAccountNotice(
          'E-posta değişikliği onay bekliyor. Gelen doğrulama bağlantılarını tamamla.',
        );
    } catch (error) {
      setAccountError(
        error instanceof Error ? error.message : 'Hesap bilgileri yüklenemedi.',
      );
    } finally {
      setAccountLoading(false);
    }
  };

  const handleSaveAccount = async (): Promise<void> => {
    if (!userId || accountSaving || accountLoading || !currentAccount) return;
    setAccountSaving(true);
    setAccountError(null);
    setAccountNotice(null);
    try {
      const details = await saveAccountDetails(userId, {
        username: accountName,
        email: accountEmailInput,
      });
      setAccount(details);
      setAccountName(details.username);
      setAccountEmailInput(details.pendingEmail ?? details.email);
      setAccountNotice(
        details.pendingEmail
          ? 'Kullanıcı adı kaydedildi. E-posta değişikliği için gelen doğrulama bağlantılarını tamamla.'
          : 'Hesap bilgileri kaydedildi.',
      );
    } catch (error) {
      setAccountError(
        error instanceof Error
          ? error.message
          : 'Hesap bilgileri kaydedilemedi.',
      );
    } finally {
      setAccountSaving(false);
    }
  };

  useEffect(() => {
    if (!userId) {
      setStudio(null);
      setPhotoUri(null);
      setIsModelPhotoLowRes(false);
    }
  }, [userId]);

  const handlePickModelPhoto = async (): Promise<void> => {
    const current = captureOwnerPublication(userId);
    if (!userId || !current()) {
      return;
    }
    try {
      const permission =
        await trackOwnerWork(userId, ImagePicker.requestMediaLibraryPermissionsAsync());
      if (!current()) return;
      if (!permission.granted) {
        setErrorMessage(
          'Galerine erişim izni verilmedi. Ayarlardan izin verip tekrar dene.',
        );
        return;
      }

      const result = await trackOwnerWork(userId, ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: false,
      }));
      if (!current() || result.canceled || !result.assets[0]) {
        return;
      }

      setErrorMessage(null);
      setUploadProgress(0);
      const next = await uploadModelPhoto(userId, result.assets[0].uri, {
        onProgress: setUploadProgress,
      });
      setStudio((previous) => ({ ...previous, ...next }));
      setPhotoUri(result.assets[0].uri);
      const lowRes = await checkLowResolutionPersonPhoto(result.assets[0].uri, userId);
      setIsModelPhotoLowRes(lowRes);
    } catch (error) {
      logger.error('Model fotoğrafı yüklenemedi', { error });
      setErrorMessage(
        error instanceof Error
          ? error.message
          : 'Fotoğraf yüklenemedi. Lütfen tekrar dene.',
      );
    } finally {
      setUploadProgress(null);
    }
  };

  const runRemovePhoto = async (): Promise<void> => {
    if (!userId) {
      return;
    }
    setIsSaving(true);
    setErrorMessage(null);
    try {
      const next = await removeModelPhoto(userId);
      setStudio((previous) => ({ ...previous, ...next }));
      setPhotoUri(null);
      setIsModelPhotoLowRes(false);
    } catch (error) {
      logger.error('Model fotoğrafı kaldırılamadı', { error });
      setErrorMessage(
        error instanceof Error
          ? error.message
          : 'Fotoğraf kaldırılamadı. Lütfen tekrar dene.',
      );
    } finally {
      setIsSaving(false);
    }
  };

  const handleRemovePhoto = (): void => {
    if (!hasPhoto) {
      return;
    }
    Alert.alert(
      'Fotoğrafı kaldır',
      'Kayıtlı model fotoğrafın silinecek. Sanal denemede yeniden seçmen gerekir.',
      [
        { text: 'Vazgeç', style: 'cancel' },
        {
          text: 'Kaldır',
          style: 'destructive',
          onPress: () => {
            void runRemovePhoto();
          },
        },
      ],
    );
  };

  const handleSignOut = async (): Promise<void> => {
    setIsSigningOut(true);
    setErrorMessage(null);
    try {
      await signOut();
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : 'Çıkış yapılamadı.',
      );
    } finally {
      setIsSigningOut(false);
    }
  };

  const runDeleteAccount = async (): Promise<void> => {
    setIsDeleting(true);
    setErrorMessage(null);
    try {
      if (!userId) throw new Error('Hesap silmek için giriş yapmalısın.');
      const runtime = await createAccountDeletionRuntime(userId, async () => {
        const store = useAppStore.getState();
        if (store.sessionUserId !== userId) return true; // owner A is gone; preserve B/anonymous state
        store.resetSession();
        setStudio(null); setPhotoUri(null); setAccount(null);
        setAccountName(''); setAccountEmailInput('');
        const cleared = useAppStore.getState();
        // Runtime independently verifies actual owner-work settlement and React clear commits.
        return cleared.sessionUserId === null && cleared.wardrobeItems.length === 0 &&
          cleared.savedOutfits.length === 0 && cleared.likedProducts.length === 0;
      });
      await completeAccountDeletion(runtime);
      // RootNavigator closes only the matching owner's session after verified
      // completion, including startup recovery. Do not sign out account B here.
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Hesap silinemedi.';
      setErrorMessage(message);
      Alert.alert(error instanceof AccountDeletionPendingError ? 'Hesap silme bekliyor' : 'Hesap silinemedi', message);
    } finally {
      setIsDeleting(false);
    }
  };

  const handleDeleteAccount = (): void => {
    const premium=premiumClient.getSnapshot();
    const own=premium.owner===userId?premium:null;
    const fresh=own?.membership && Date.now()-own.membership.checkedAtMs<60000 && (own.membership.tier!=='premium'||(own.membership.expiresAtMs??0)>Date.now());
    const state=own?.storeOperationPending||own?.awaitingVerification?'pending':!fresh?'unknown':own.membership?.tier==='premium'?'active':'inactive';
    const management=subscriptionManagementUrl(Platform.OS);
    Alert.alert(
      'Hesabımı sil',
      buildPremiumDeletionNotice(state),
      [
        { text: 'Vazgeç', style: 'cancel' },
        ...(management?[{text:'Aboneliği yönet',onPress:()=>{void Linking.openURL(management).catch(()=>Alert.alert('Abonelik yönetimi','Satın aldığın mağazanın abonelik ayarlarını kullanabilirsin.'));}}]:[]),
        {
          text: 'Kalıcı olarak sil',
          style: 'destructive',
          onPress: () => {
            void runDeleteAccount();
          },
        },
      ],
    );
  };

  const handleOpenPrivacy = (): void => { setPrivacyOpen(true); };

  const handleInvite = async (): Promise<void> => {
    try {
      await Share.share({ message: buildInviteShareMessage(PRIVACY_URL) });
    } catch (error) {
      logger.error('Davet paylaşımı açılamadı', { error });
    }
  };

  const handleInviteCodeSave = (_code: string): void => {
    setInviteOpen(false);
    showToast(INVITE_SAVED_TOAST);
  };

  const handleFeedback = async (): Promise<void> => {
    try {
      const available = await StoreReview.isAvailableAsync();
      if (available) {
        await StoreReview.requestReview();
        return;
      }
    } catch (error) {
      logger.warn('Mağaza değerlendirmesi açılamadı', { error });
    }

    const mailUrl = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent('Vitrify geri bildirim')}`;
    void Linking.openURL(mailUrl).catch((error: unknown) => {
      logger.error('Destek e-postası açılamadı', { error });
      Alert.alert(
        'Geri bildirim açılamadı',
        `${SUPPORT_EMAIL} adresine yazabilirsin.`,
      );
    });
  };

  const handleSavePreferences = async (
    patch: StudioProfilePatch,
  ): Promise<boolean> => {
    if (!userId || preferencesDisabled) return false;
    setIsSaving(true);
    setErrorMessage(null);
    try {
      const next = await upsertStudioProfile(userId, patch);
      setStudio((previous) => ({ ...previous, ...next }));
      if (profileChangeAffectsFeed(studio, next)) {
        scheduleFeedRefreshAfterProfileSave(
          () => useAppStore.getState().refreshFeedPreservingCurrent(),
          { owner: userId, activeOwner: () => useAppStore.getState().sessionUserId },
        );
      }
      return true;
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : 'Değişiklik kaydedilemedi.',
      );
      return false;
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top + spacing.md,
      paddingLeft: Math.max(insets.left, spacing.lg),
      paddingRight: Math.max(insets.right, spacing.lg) }]}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
        <View style={styles.headerRow}>
          <Text
            style={styles.header}
            onLongPress={perfTraceEnabled() ? () => Alert.alert('Performans özeti', logPerfSummary() || 'Henüz ölçüm yok.') : undefined}
          >
            Profil
          </Text>
          <PressableScale
            onPress={() => {
              void handleOpenAccount();
            }}
            disabled={isBusy}
            style={styles.settingsButton}
            accessibilityRole="button"
            accessibilityLabel="Ayarlar"
          >
            <Settings size={20} color={colors.text} />
          </PressableScale>
        </View>
        {errorMessage ? <Text style={styles.error}>{errorMessage}</Text> : null}

        <View style={styles.profileCard}>
          <View style={[styles.heroRow, compactProfile && styles.compactHero]}>
            <View style={styles.avatarWrap}>
              <PressableScale
                onLongPress={handleRemovePhoto}
                disabled={!hasPhoto || isBusy}
                style={styles.avatar}
                accessibilityRole="button"
                accessibilityLabel="Model fotoğrafı"
              >
                {hasPhoto ? (
                  <Image
                    source={{ uri: photoUri }}
                    style={styles.avatarImage}
                    contentFit="cover"
                    cachePolicy="none"
                    recyclingKey={photoUri}
                  />
                ) : (
                  <View style={styles.avatarPlaceholder}>
                    <Text style={styles.avatarInitials}>{initials(displayName)}</Text>
                  </View>
                )}
                {uploadProgress !== null ? (
                  <View style={styles.avatarScrim}>
                    <ActivityIndicator color={colors.inverseText} />
                  </View>
                ) : null}
              </PressableScale>
              <PressableScale
                onPress={() => {
                  void handlePickModelPhoto();
                }}
                disabled={isBusy}
                hitSlop={CAMERA_HIT_SLOP}
                style={styles.cameraButton}
                accessibilityRole="button"
                accessibilityLabel="Profil fotoğrafını değiştir"
              >
                <Camera size={14} color={colors.inverseText} />
              </PressableScale>
            </View>
            <View style={[styles.heroCopy, compactProfile && styles.compactHeroCopy]}>
              <View style={[styles.identityRow, compactProfile && styles.compactIdentity]}>
                <View style={styles.identityCopy}>
                  <Text style={styles.userName} numberOfLines={1}>
                    {displayName}
                  </Text>
                  <Text style={styles.email} numberOfLines={1}>
                    {accountEmail}
                  </Text>
                </View>
                <PressableScale
                  onPress={() => {
                    void handlePickModelPhoto();
                  }}
                  disabled={isBusy}
                  style={styles.editButton}
                  accessibilityRole="button"
                  accessibilityLabel="Düzenle"
                >
                  <Text style={styles.editButtonText}>Düzenle</Text>
                </PressableScale>
              </View>
              <View style={styles.statsRow}>
                {[
                  { label: 'Dolap', value: wardrobeCount },
                  { label: 'Favori', value: favoriteCount },
                  { label: 'Kombin', value: outfitCount },
                ].map((stat, index) => (
                  <View
                    key={stat.label}
                    style={[styles.stat, index > 0 && styles.statDivider]}
                  >
                    <Text style={styles.statValue}>{stat.value}</Text>
                    <Text style={styles.statLabel} numberOfLines={2}>
                      {stat.label}
                    </Text>
                  </View>
                ))}
              </View>
            </View>
          </View>
        </View>
        {isModelPhotoLowRes ? (
          <Text style={styles.lowResHint}>{LOW_RES_MODEL_PHOTO_HINT}</Text>
        ) : null}

        <ProfileStyleJourney key={`style-journey:${userId ?? 'signed-out'}`} journey={journey} onTask={handleJourneyTask} />

        <ProfileStyleGrid key={`style-grid:${userId ?? 'signed-out'}`} journey={journey}
          onRetry={handleRetryCalculated} onSelectSection={openPreferenceSection} />
        <ProfileOnlyYou key={`only-you:${userId ?? 'signed-out'}`} journey={journey}
          onOpen={openPreferenceSection} disabled={preferencesDisabled} />

        <PremiumMembership key={`membership:${userId ?? 'signed-out'}`} />
        <View style={styles.menuCard}>
          <MenuRow
            label="Denemelerim"
            icon={<Sparkles color={colors.text} size={22} />}
            onPress={() => setHistoryOpen(true)}
            accessibilityLabel="Denemelerim"
          />
          <MenuRow
            label="Hesap Bilgilerim"
            icon={<User color={colors.text} size={22} />}
            onPress={() => {
              void handleOpenAccount();
            }}
            disabled={isBusy}
            accessibilityLabel="Hesap Bilgilerim"
          />
          <ProductPrefSetting userId={userId}>
            {({ valueLabel, open }) => (
              <MenuRow
                label="Ürün tercihi"
                icon={<Shirt color={colors.text} size={22} />}
                onPress={open}
                accessibilityLabel={`Ürün tercihi: ${valueLabel}`}
                trailing={<Text style={styles.menuValue}>{valueLabel}</Text>}
              />
            )}
          </ProductPrefSetting>
          <MenuRow
            label="Bildirim Ayarları"
            icon={<Bell color={colors.text} size={22} />}
            onPress={() => {
              void Linking.openSettings().catch(() =>
                Alert.alert(
                  'Ayarlar açılamadı',
                  'Cihaz ayarlarından bildirim izinlerini düzenleyebilirsin.',
                ),
              );
            }}
            accessibilityLabel="Bildirim Ayarları"
          />
          <MenuRow
            label="Gizlilik ve Güvenlik"
            icon={<ShieldCheck color={colors.text} size={22} />}
            onPress={handleOpenPrivacy}
            accessibilityRole="button"
            accessibilityLabel="Gizlilik ve Güvenlik"
          />
          <MenuRow
            label="Yardım ve Destek"
            icon={<CircleHelp color={colors.text} size={22} />}
            onPress={() =>
              Alert.alert('Yardım ve Destek', SUPPORT_EMAIL, [
                { text: 'Kapat', style: 'cancel' },
                {
                  text: 'Geri bildirim ve değerlendir',
                  onPress: () => {
                    void handleFeedback();
                  },
                },
                {
                  text: 'Davet seçenekleri',
                  onPress: () =>
                    Alert.alert('Davet seçenekleri', undefined, [
                      { text: 'Kapat', style: 'cancel' },
                      {
                        text: 'Davet Et',
                        onPress: () => {
                          void handleInvite();
                        },
                      },
                      {
                        text: 'Davet Kodu Gir',
                        onPress: () => setInviteOpen(true),
                      },
                    ]),
                },
              ])
            }
            accessibilityLabel="Yardım ve Destek"
            isLast
          />
        </View>

        <PressableScale
          onPress={handleDeleteAccount}
          disabled={isBusy}
          style={[styles.accountButton, styles.deleteButton]}
          accessibilityRole="button"
          accessibilityLabel="Hesabımı sil"
        >
          {isDeleting ? (
            <ActivityIndicator color={colors.accent} />
          ) : (
            <>
              <Trash2 size={22} color={colors.accent} />
              <Text style={styles.deleteButtonText}>Hesabımı Sil</Text>
            </>
          )}
        </PressableScale>
        <PressableScale
          onPress={() => {
            void handleSignOut();
          }}
          disabled={isBusy}
          style={[styles.accountButton, styles.signOutButton]}
          accessibilityRole="button"
          accessibilityLabel="Çıkış yap"
        >
          {isSigningOut ? (
            <ActivityIndicator color={colors.text} />
          ) : (
            <>
              <LogOut size={22} color={colors.tabInactive} />
              <Text style={styles.signOutText}>Çıkış Yap</Text>
            </>
          )}
        </PressableScale>
      </ScrollView>

      {toastMessage ? (
        <View style={styles.toast} pointerEvents="none">
          <Text style={styles.toastText}>{toastMessage}</Text>
        </View>
      ) : null}

      <ProfileSheet
        visible={accountOpen}
        title="Hesap Bilgilerim"
        onClose={() => {
          if (!accountSaving) setAccountOpen(false);
        }}
      >
        <View style={styles.accountForm}>
          {accountLoading ? (
            <ActivityIndicator color={colors.accent} />
          ) : (
            <>
              <Text style={styles.accountFieldLabel}>Kullanıcı adı</Text>
              <TextInput
                value={accountName}
                onChangeText={setAccountName}
                editable={!accountSaving && !!currentAccount}
                maxLength={80}
                autoCapitalize="none"
                autoCorrect={false}
                style={styles.accountInput}
                accessibilityLabel="Hesap kullanıcı adı"
              />
              <Text style={styles.accountFieldLabel}>E-posta</Text>
              <TextInput
                value={accountEmailInput}
                onChangeText={setAccountEmailInput}
                editable={!accountSaving && !!currentAccount}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                style={styles.accountInput}
                accessibilityLabel="Hesap e-posta adresi"
              />
            </>
          )}
          {accountError ? (
            <Text style={styles.error} accessibilityRole="alert">
              {accountError}
            </Text>
          ) : null}
          {accountNotice ? (
            <Text style={styles.accountNotice} accessibilityRole="alert">
              {accountNotice}
            </Text>
          ) : null}
          <PressableScale
            onPress={() => {
              void handleSaveAccount();
            }}
            disabled={accountSaving || accountLoading || !currentAccount}
            style={styles.accountSaveButton}
            accessibilityRole="button"
            accessibilityLabel="Hesap bilgilerini kaydet"
          >
            {accountSaving ? (
              <ActivityIndicator color={colors.inverseText} />
            ) : (
              <Text style={styles.accountSaveText}>Kaydet</Text>
            )}
          </PressableScale>
        </View>
      </ProfileSheet>
      <PrivacyCenter
        key={`privacy-center:${userId ?? 'signed-out'}`}
        visible={privacyOpen}
        onClose={() => setPrivacyOpen(false)}
        disabled={isBusy}
        onDeleteAccount={handleDeleteAccount}
        onOpenPreferences={() => { setStyleSheetSection('all'); setSizeOpen(true); }}
      />
      <TryOnHistorySheet
        visible={historyOpen}
        userId={userId}
        onClose={() => setHistoryOpen(false)}
      />
      {currentStudio ? (
        <SizeStudioSheet
          key={userId ?? 'signed-out'}
          visible={sizeOpen}
          section={styleSheetSection}
          profile={currentStudio}
          disabled={preferencesDisabled}
          onClose={() => setSizeOpen(false)}
          onSavePreferences={handleSavePreferences}
        />
      ) : null}
      <InviteCodeModal
        visible={inviteOpen}
        onClose={() => setInviteOpen(false)}
        onSave={handleInviteCodeSave}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  accountForm: { gap: spacing.sm },
  accountFieldLabel: { color: colors.text, fontSize: 13, fontWeight: '600' },
  accountInput: {
    minHeight: 48,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.button,
    paddingHorizontal: spacing.lg,
    color: colors.text,
    fontSize: 16,
    backgroundColor: colors.input,
  },
  accountNotice: { color: colors.textSecondary, fontSize: 13, lineHeight: 18 },
  accountSaveButton: {
    minHeight: 48,
    borderRadius: radius.button,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.sm,
  },
  accountSaveText: {
    color: colors.inverseText,
    fontSize: 16,
    fontWeight: '700',
  },
  root: {
    flex: 1,
    backgroundColor: colors.bg,
    paddingHorizontal: spacing.lg,
  },
  header: {
    flex: 1,
    fontSize: 28,
    fontWeight: '800',
    color: colors.text,
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md },
  settingsButton: {
    width: SETTINGS_BUTTON_SIZE,
    height: SETTINGS_BUTTON_SIZE,
    borderRadius: SETTINGS_BUTTON_SIZE / 2,
    borderWidth: 1,
    borderColor: colors.line,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scroll: {
    gap: PROFILE_SECTION_GAP,
    paddingBottom: spacing.xxl,
  },
  error: {
    color: colors.destructive,
    fontWeight: '600',
  },
  lowResHint: {
    color: colors.textSecondary,
    fontSize: 13,
    fontWeight: '600',
    lineHeight: 18,
  },
  profileCard: {
    backgroundColor: colors.input,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.line,
    padding: spacing.lg,
  },
  heroRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
  },
  compactHero: { flexDirection: 'column' },
  compactHeroCopy: { flex: 0, alignSelf: 'stretch' },
  compactIdentity: { flexWrap: 'wrap' },
  avatarWrap: { width: AVATAR_SIZE, height: AVATAR_SIZE, marginTop: 4, marginRight: spacing.xs, marginBottom: spacing.xs },
  avatar: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: AVATAR_RADIUS,
    overflow: 'hidden',
    backgroundColor: colors.input,
  },
  avatarImage: {
    width: '100%',
    height: '100%',
  },
  avatarPlaceholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.cream,
  },
  avatarInitials: { color: colors.ink, fontSize: 24, fontWeight: '800' },
  avatarScrim: {
    ...StyleSheet.absoluteFill,
    backgroundColor: colors.inverseSurface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cameraButton: {
    position: 'absolute',
    right: -spacing.xs,
    bottom: -spacing.xs,
    width: CAMERA_BADGE_SIZE,
    height: CAMERA_BADGE_SIZE,
    borderRadius: CAMERA_BADGE_SIZE / 2,
    borderWidth: CAMERA_BADGE_BORDER,
    borderColor: colors.input,
    backgroundColor: colors.ink,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroCopy: {
    flex: 1,
    minWidth: 0,
    gap: spacing.lg,
  },
  identityRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  identityCopy: { flex: 1, minWidth: 0, gap: spacing.xs },
  userName: {
    color: colors.text,
    fontSize: 20,
    lineHeight: 26,
    fontWeight: '800',
  },
  email: {
    color: colors.tabInactive,
    fontSize: 13,
    lineHeight: 18,
  },
  statsRow: { flexDirection: 'row' },
  stat: { flex: 1, minWidth: 0, alignItems: 'center', gap: 3 },
  statDivider: { borderLeftWidth: 1, borderLeftColor: colors.hairline },
  statValue: { color: colors.text, fontSize: 20, fontWeight: '800' },
  statLabel: {
    color: colors.textSecondary,
    fontSize: 10,
    lineHeight: 14,
    textAlign: 'center',
  },
  editButton: {
    minHeight: 32,
    justifyContent: 'center',
    flexShrink: 0,
    borderRadius: 16,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.cream,
  },
  editButtonText: {
    color: colors.text,
    fontSize: 12,
    fontWeight: '700',
  },
  menuCard: {
    backgroundColor: colors.input,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.line,
    overflow: 'hidden',
  },
  menuRow: {
    minHeight: 54,
    paddingHorizontal: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  menuRowBorder: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.hairline,
  },
  menuLeading: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  menuLabel: {
    flex: 1,
    ...PROFILE_MENU_LABEL,
  },
  menuValue: {
    color: colors.textSecondary,
    fontSize: 15,
    fontWeight: '500',
  },
  menuTrailing: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  accountButton: {
    minHeight: 48,
    borderRadius: radius.button,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
  },
  deleteButton: { backgroundColor: colors.accentSoft },
  deleteButtonText: { color: colors.accent, fontSize: 15, fontWeight: '600' },
  signOutButton: { backgroundColor: colors.hairline, marginTop: -(PROFILE_SECTION_GAP - spacing.md) },
  signOutText: { color: colors.text, fontSize: 15, fontWeight: '500' },
  toast: {
    position: 'absolute',
    left: spacing.xl,
    right: spacing.xl,
    bottom: spacing.xxl,
    backgroundColor: colors.inverseSurface,
    borderRadius: radius.button,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  toastText: {
    color: colors.inverseText,
    fontSize: 14,
    fontWeight: '700',
    textAlign: 'center',
  },
});
