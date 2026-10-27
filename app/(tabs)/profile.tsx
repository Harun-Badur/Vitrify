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
  Database,
  Heart,
  LogOut,
  Palette,
  Pencil,
  Ruler,
  ShieldCheck,
  Shirt,
  Sparkles,
  Tag,
  Trash2,
  User,
} from 'lucide-react-native';
import InviteCodeModal from '../../components/InviteCodeModal';
import PressableScale from '../../components/PressableScale';
import ProfileSheet from '../../components/ProfileSheet';
import PrivacyCenter from '../../components/PrivacyCenter';
import PremiumMembership from '../../components/PremiumMembership';
import {premiumClient} from '../../services/revenueCatMobile';
import {buildPremiumDeletionNotice,subscriptionManagementUrl} from '../../lib/premiumDeletionNotice';
import ProfileStyleJourney from '../../components/ProfileStyleJourney';
import SizeStudioSheet, {
  type StyleSheetSection,
} from '../../components/SizeStudioSheet';
import TryOnHistorySheet from '../../components/TryOnHistorySheet';
import { useAuthContext } from '../../hooks/useAuthContext';
import { buildInviteShareMessage } from '../../lib/inviteShare';
import { logger } from '../../lib/logger';
import { checkLowResolutionPersonPhoto } from '../../lib/personPhotoPrepare';
import { PRIVACY_URL, SUPPORT_EMAIL } from '../../lib/privacy';
import { colors, radius, shadows, spacing } from '../../lib/theme';
import { buildStyleJourney, type JourneyTarget } from '../../lib/profileStyleJourney';
import { fetchCalculatedStyleProfile, subscribeStyleProfileChanges } from '../../lib/recsConfig';
import type { CalculatedStyleProfileState } from '../../types/calculatedStyleProfile';
import { LOW_RES_MODEL_PHOTO_HINT } from '../../lib/vtonPersonImage';
import { completeAccountDeletion, AccountDeletionPendingError } from '../../services/accountService';
import {
  fetchAccountDetails,
  saveAccountDetails,
  type AccountDetails,
} from '../../services/accountDetailsService';
import { useAppStore } from '../../store/useAppStore';
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
  STYLE_TAGS,
  type StudioProfilePatch,
  type UserStudioProfile,
} from '../../types/profile';

const AVATAR_SIZE = 82;
const AVATAR_RADIUS = AVATAR_SIZE / 2;
const ICON_SM = 18;
const ICON_AVATAR = 26;
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
  const styleSummary =
    STYLE_TAGS.filter((tag) => currentStudio?.styleTags.includes(tag.value))
      .map((tag) => tag.label)
      .join(', ') || 'Belirlenmedi';
  const bodySummary =
    [
      currentStudio?.topSize,
      currentStudio?.bottomSize && `Alt: ${currentStudio.bottomSize}`,
      currentStudio?.heightCm != null && `${currentStudio.heightCm} cm`,
      currentStudio?.weightKg != null && `${currentStudio.weightKg} kg`,
    ]
      .filter(Boolean)
      .join(' · ') || 'Belirlenmedi';
  const favoriteBrands =
    currentStudio?.favoriteBrands?.join(', ') || 'Seçilmedi';
  const [calculatedProfile, setCalculatedProfile] = useOwnedState<CalculatedStyleProfileState>(userId, {state:'loading'});
  const calculatedRef = useRef(calculatedProfile);
  calculatedRef.current = calculatedProfile;
  useFocusEffect(useCallback(() => {
    let active = true, revision = 0;
    if (!userId || userId !== sessionUserId || sessionSyncStatus !== 'success') return;
    const current = captureOwnerPublication(userId);
    const refresh = (changed: boolean) => {
      const version=++revision;
      if (changed) setCalculatedProfile({state:'loading'});
      void trackOwnerWork(userId, fetchCalculatedStyleProfile(userId)).then(profile => {
        if (active && current() && version===revision) {
          const previous=calculatedRef.current;
          if (previous.state!=='ready'||previous.profile!==profile) setCalculatedProfile({state:'ready',profile});
        }
      }).catch(() => { if (active && current() && version===revision) setCalculatedProfile({state:'error'}); });
    };
    const unsubscribe=subscribeStyleProfileChanges(userId,()=>refresh(true));
    refresh(true);
    return () => { active=false; unsubscribe(); };
  }, [userId, sessionUserId, sessionSyncStatus, studio]));
  useEffect(() => cancelScheduledFeedRefreshOnOwnerChange(sessionUserId), [sessionUserId]);
  const journey = useMemo(() => buildStyleJourney({ userId, sessionUserId, sessionSyncStatus,
    wardrobeStatus, likedProducts, passedProductIds, wardrobeItems, savedOutfits, profile: studio, calculatedProfile }),
  [userId, sessionUserId, sessionSyncStatus, wardrobeStatus, likedProducts, passedProductIds, wardrobeItems, savedOutfits, studio, calculatedProfile]);
  const handleJourneyTask = (target: JourneyTarget): void => {
    if (target === 'preferences') { setStyleSheetSection('style'); setSizeOpen(true); }
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
      <Text style={styles.header}>Profil</Text>
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
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
                    <User color={colors.textSecondary} size={ICON_AVATAR} />
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
                style={styles.cameraButton}
                accessibilityRole="button"
                accessibilityLabel="Profil fotoğrafını değiştir"
              >
                <Camera size={18} color={colors.accent} />
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
                  <Pencil size={14} color={colors.text} />
                  <Text style={styles.editButtonText}>Düzenle</Text>
                </PressableScale>
              </View>
              <View style={styles.statsRow}>
                {[
                  { label: 'Dolabım', value: wardrobeCount },
                  { label: 'Favoriler', value: favoriteCount },
                  { label: 'Kombinlerim', value: outfitCount },
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

        <View>
          <View style={styles.styleHeading}>
            <Text style={styles.sectionTitle}>Tercihlerin</Text>
            <PressableScale
              onPress={() => {
                setStyleSheetSection('all');
                setSizeOpen(true);
              }}
              disabled={preferencesDisabled}
              style={styles.sectionEdit}
              accessibilityRole="button"
              accessibilityLabel="Stil bilgilerini düzenle"
            >
              <Pencil color={colors.text} size={18} />
              <Text style={styles.sectionEditText}>Düzenle</Text>
            </PressableScale>
          </View>
          <Text style={styles.progressDescription}>Senin belirttiğin tercihler · her zaman düzenlenebilir</Text>
          <View style={styles.styleGrid}>
            {[
              {
                title: 'Stil Tarzım',
                value: styleSummary,
                Icon: Shirt,
                onPress: () => {
                  setStyleSheetSection('style');
                  setSizeOpen(true);
                },
              },
              {
                title: 'Beden Bilgilerim',
                value: bodySummary,
                Icon: Ruler,
                onPress: () => {
                  setStyleSheetSection('body');
                  setSizeOpen(true);
                },
              },
              {
                title: 'Renk Tercihlerim',
                value:
                  currentStudio?.preferredColors?.join(', ') || 'Seçilmedi',
                Icon: Palette,
                onPress: () => {
                  setStyleSheetSection('colors');
                  setSizeOpen(true);
                },
              },
              {
                title: 'Favori Markalarım',
                value: favoriteBrands,
                Icon: Tag,
                onPress: () => {
                  setStyleSheetSection('brands');
                  setSizeOpen(true);
                },
              },
              {
                title: 'Fiyat Aralığım',
                value: currentStudio?.priceRange
                  ? `₺${currentStudio.priceRange.min.toLocaleString('tr-TR')} – ₺${currentStudio.priceRange.max.toLocaleString('tr-TR')}`
                  : 'Belirlenmedi',
                Icon: Database,
                onPress: () => {
                  setStyleSheetSection('budget');
                  setSizeOpen(true);
                },
              },
            ].map(({ title, value, Icon, onPress }) => (
              <PressableScale
                key={title}
                style={[styles.styleTile, (title === 'Fiyat Aralığım' || width < 350 || fontScale > 1.3) && { width: '100%' }]}
                onPress={onPress}
                disabled={preferencesDisabled}
                accessibilityRole="button"
                accessibilityLabel={title}
              >
                <View style={styles.styleIcon}>
                  <Icon size={22} color={colors.text} />
                </View>
                <View style={styles.tileCopy}>
                  <Text style={styles.tileTitle} numberOfLines={2}>
                    {title}
                  </Text>
                  <Text style={styles.tileValue} numberOfLines={2}>
                    {value}
                  </Text>
                </View>
                <ChevronRight size={15} color={colors.tabInactive} />
              </PressableScale>
            ))}
          </View>
        </View>

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
    fontSize: 28,
    fontWeight: '800',
    color: colors.text,
    marginBottom: spacing.md,
  },
  scroll: {
    gap: spacing.md,
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
    borderColor: colors.hairline,
    padding: spacing.md,
    ...shadows.segment,
  },
  heroRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
  },
  compactHero: { flexDirection: 'column' },
  compactHeroCopy: { flex: 0, alignSelf: 'stretch' },
  compactIdentity: { flexWrap: 'wrap' },
  avatarWrap: { width: AVATAR_SIZE, height: AVATAR_SIZE, marginTop: 4 },
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
  },
  avatarScrim: {
    ...StyleSheet.absoluteFill,
    backgroundColor: colors.inverseSurface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cameraButton: {
    position: 'absolute',
    right: -3,
    bottom: -3,
    width: 48,
    height: 48,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.input,
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
    fontSize: 17,
    lineHeight: 22,
    fontWeight: '800',
  },
  email: {
    color: colors.textSecondary,
    fontSize: 12,
    lineHeight: 17,
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
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    flexShrink: 0,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.button,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    backgroundColor: colors.input,
  },
  editButtonText: {
    color: colors.text,
    fontSize: 12,
    fontWeight: '700',
  },
  styleProgressCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.card,
    backgroundColor: colors.accentSoft,
  },
  progressCopy: { flex: 1, minWidth: 0, gap: spacing.xs },
  progressTitle: { color: colors.text, fontSize: 17, fontWeight: '800' },
  progressDescription: {
    color: colors.textSecondary,
    fontSize: 12,
    lineHeight: 17,
  },
  progressCircle: {
    width: 64,
    height: 64,
    alignItems: 'center',
    justifyContent: 'center',
  },
  progressPercent: {
    position: 'absolute',
    color: colors.text,
    fontSize: 18,
    fontWeight: '800',
  },
  styleHeading: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  sectionTitle: { color: colors.text, fontSize: 20, fontWeight: '800' },
  sectionEdit: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.xs,
  },
  sectionEditText: { color: colors.text, fontSize: 13, fontWeight: '500' },
  styleGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  styleTile: {
    width: '48%',
    flexGrow: 1,
    minHeight: 80,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.md,
    borderRadius: radius.card,
    backgroundColor: colors.input,
    borderWidth: 1,
    borderColor: colors.hairline,
    ...shadows.segment,
  },
  styleIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.input,
    borderWidth: 1,
    borderColor: colors.hairline,
    ...shadows.segment,
  },
  tileCopy: { flex: 1, minWidth: 0, gap: spacing.xs },
  tileTitle: {
    color: colors.text,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '700',
  },
  tileValue: { color: colors.textSecondary, fontSize: 11, lineHeight: 15 },
  menuCard: {
    backgroundColor: colors.input,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.hairline,
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
    color: colors.text,
    fontSize: 16,
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
  signOutButton: { backgroundColor: colors.hairline, marginTop: -4 },
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
