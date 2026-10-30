import { useOwnedState } from '../../hooks/useOwnedState';
import { useDiscoverPerfTrace } from '../../hooks/useDiscoverPerfTrace';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Alert,
  Platform,
  StyleSheet,
  StatusBar,
  Text,
  TextInput,
  useWindowDimensions,
  View,
  type LayoutChangeEvent,
} from 'react-native';
import { Image } from 'expo-image';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { X } from 'lucide-react-native';
import TouchClaim from '../../components/TouchClaim';
import ShadowedIcon from '../../components/ShadowedIcon';
import { DISCOVER_EDGE_MARGIN, RAIL_COLUMN_WIDTH } from '../../components/DiscoverActionRail';
import {
  runOnUI,
  useSharedValue,
  type SharedValue,
} from 'react-native-reanimated';
import FeedModeSegment from '../../components/FeedModeSegment';
import SwipeCard, {
  SWIPE_CARD_HEIGHT,
  SWIPE_CARD_WIDTH,
  type PageIndex,
} from '../../components/SwipeCard';
import PressableScale from '../../components/PressableScale';
import FilterSheet from '../../components/FilterSheet';
import SkeletonShimmer from '../../components/SkeletonShimmer';
import SwipeHintOverlay from '../../components/SwipeHintOverlay';
import VirtualTryOnModal from '../../components/VirtualTryOnModal';
import { useAuthContext } from '../../hooks/useAuthContext';
import { logger } from '../../lib/logger';
import { track, trackFeedImpression } from '../../lib/analytics';
import {
  countActiveFilters,
  EMPTY_FEED_QUERY,
  feedQueryFromFilters,
  type FeedQuery,
  type FeedQueryFilters,
} from '../../lib/feedQuery';
import { parseSearchQuery } from '../../lib/searchQueryParse';
import { searchRelaxBannerText } from '../../lib/searchRelaxMessage';
import { setSessionFilters, setSessionQuery } from '../../lib/sessionIntent';
import { hasSeenSwipeHint, markSwipeHintSeen } from '../../lib/onboarding';
import {
  colors,
  discoverCardLiftForHeight,
  estimateDiscoverCardHeight,
  layout,
  radius,
  shadows,
  spacing,
} from '../../lib/theme';
import {
  getRedirectLabel,
  openProductPage,
} from '../../services/deeplinkService';
import { fetchRecommendationCatalog, resetProductPrefCatalogCaches } from '../../services/productService';
import { createDeckRefresher } from '../../lib/deckRefresh';
import { canResurfacePassed, resurfacePassed } from '../../lib/resurfacePassed';
import { effectiveProductPref, type ProductPref } from '../../lib/productPreferenceRules';
import { DiscoverRecommendationCache } from '../../lib/discoverRecommendationCache';
import { fingerprint } from '../../src/recommendationCache/fingerprint';
import { discoverPrefetchTrace } from '../../lib/discoverPrefetchInstrumentation';
import { loadDiscoverRecommendationPacket } from '../../services/discoverRecommendationCacheService';
import { complementaryProductsForDisplay } from '../../src/intelligence/recommendations/complementaryProductsForDisplay';
import { DEFAULT_SEARCH_BRANDS } from '../../lib/searchQueryParse';
import {
  assignInsightChips,
  createInsightChipSequence,
  type InsightChip,
  type InsightChipKind,
} from '../../lib/insightChip';
import { insightWardrobeSignature, toInsightWardrobeItems } from '../../lib/insightWardrobe';
import type { DiscoverRecommendation } from '../../src/intelligence/recommendations/discoverRecommendation';
import { useAppStore } from '../../store/useAppStore';
import type { LikeInputSource } from '../../types/analytics';
import { getProductImages, type Product } from '../../types/product';
import type { FeedMode } from '../../types/recommendation';

const TOAST_DURATION_MS = 1600;
/** Filtre kutusu rail sütunuyla birebir aynı 44dp: merkezler aynı dikey eksende. */
const FILTER_HIT_SIZE = RAIL_COLUMN_WIDTH;
const SEARCH_TRACK_DEBOUNCE_MS = 500;
/** Header, clip sınırında kesilen kartın üstünde kalır. */
const HEADER_Z_INDEX = 7;
const EMPTY_RECOMMENDATIONS: readonly DiscoverRecommendation[] = [];
const EMPTY_RECOMMENDATION_CATALOG: Product[] = [];
const NO_HIDDEN_INSIGHT_KINDS: ReadonlySet<InsightChipKind> = new Set();

type HintStatus = 'checking' | 'visible' | 'hidden';

interface DeckPage {
  product: Product;
  pageIndex: PageIndex;
}

function LoadingFeed() {
  return (
    <View style={styles.emptyState}>
      <SkeletonShimmer
        width={SWIPE_CARD_WIDTH}
        height={SWIPE_CARD_HEIGHT}
        borderRadius={radius.card}
      />
      <Text style={styles.loadingTitle}>Ürünler yükleniyor...</Text>
      <Text style={styles.emptySubtitle}>
        Vitrify feedi hazırlanıyor. Birazdan kaydırmaya başlayabilirsin.
      </Text>
    </View>
  );
}

interface DeckFinishedCardProps {
  subtitle: string;
  onRefresh: () => void;
  onOpenLiked: () => void;
  refreshing?: boolean;
  /** GEÇİCİ (prototip): geçilenleri tekrar göster; yoksa buton çizilmez. */
  onResurfacePassed?: () => void;
}

function DeckFinishedCard({
  subtitle,
  onRefresh,
  onOpenLiked,
  refreshing = false,
  onResurfacePassed,
}: DeckFinishedCardProps) {
  return (
    <View style={styles.finishedCard}>
      <Text style={styles.finishedTitle}>Deste bitti! 🎉</Text>
      <Text style={styles.emptySubtitle}>{subtitle}</Text>
      <PressableScale
        onPress={onOpenLiked}
        style={styles.primaryCta}
        accessibilityRole="button"
        accessibilityLabel="Dolabı gör"
      >
        <Text style={styles.primaryCtaText}>Dolabı Gör</Text>
      </PressableScale>
      <PressableScale
        onPress={onRefresh}
        disabled={refreshing}
        style={styles.secondaryCta}
        accessibilityRole="button"
        accessibilityLabel={refreshing ? 'Yükleniyor' : 'Yenile'}
        accessibilityState={{ disabled: refreshing, busy: refreshing }}
      >
        <Text style={styles.secondaryCtaText}>{refreshing ? 'Yükleniyor…' : 'Yenile'}</Text>
      </PressableScale>
      {onResurfacePassed ? (
        <PressableScale
          onPress={onResurfacePassed}
          disabled={refreshing}
          style={styles.outlineCta}
          accessibilityRole="button"
          accessibilityLabel="Geçtiklerimi tekrar göster"
          accessibilityState={{ disabled: refreshing, busy: refreshing }}
        >
          <Text style={styles.outlineCtaText}>{refreshing ? 'Yükleniyor…' : 'Geçtiklerimi tekrar göster'}</Text>
        </PressableScale>
      ) : null}
    </View>
  );
}

export default function FeedScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  /**
   * İkon grubu, header'ın sağ padding'i çıkarılarak rail ile aynı sağ referansa
   * (ekran kenarından DISCOVER_EDGE_MARGIN) oturur.
   */
  const headerActionsRight = DISCOVER_EDGE_MARGIN - Math.max(insets.right, spacing.lg);
  /** Header alt kenarı + 16dp: Keşfet rayının üst sınırı. */
  const railTopInset =
    (insets.top > 0 ? insets.top : layout.statusBarFallback) +
    layout.headerPaddingTop + layout.headerControl + layout.searchToSegment +
    layout.segmentHeight + spacing.lg;
  const { height: windowHeight } = useWindowDimensions();
  const discoverCardLiftPx = discoverCardLiftForHeight(windowHeight);
  const { user, loading: authLoading } = useAuthContext();
  const sessionOwner = useAppStore(state => state.sessionUserId);
  const sessionSyncStatus = useAppStore(state => state.sessionSyncStatus);
  useFocusEffect(
    useCallback(() => {
      const statusBar = StatusBar.pushStackEntry({
        barStyle: 'light-content',
      });
      return () => StatusBar.popStackEntry(statusBar);
    }, []),
  );
  const currentProducts = useAppStore((state) => state.currentProducts);
  const feedStatus = useAppStore((state) => state.feedStatus);
  const feedWarning = useAppStore((state) => state.feedWarning);
  useEffect(() => {
    if (feedWarning === 'LOCAL_RANK_FAILED') {
      Alert.alert('Kişiselleştirme kullanılamıyor', 'Ürünler katalog sırasıyla gösteriliyor.');
    }
  }, [feedWarning]);
  const feedPreparationRevision = useAppStore((state) => state.feedPreparationRevision ?? 0);
  const likedProducts = useAppStore((state) => state.likedProducts);
  const favoriteError = useAppStore(state => state.favoritesOwner === state.sessionUserId && state.favoritesStatus === 'error'
    ? state.favoritesError : null);
  useEffect(() => {
    if (favoriteError) Alert.alert('Favori işlemi tamamlanamadı', favoriteError);
  }, [favoriteError]);
  const seenCount = useAppStore(
    (state) => state.likedProducts.length + state.passedProductIds.length,
  );
  const loadFeed = useAppStore((state) => state.loadFeed);
  const loadMoreFeed = useAppStore((state) => state.loadMoreFeed);
  const hasMore = useAppStore((state) => state.hasMore);
  const isFetchingNext = useAppStore((state) => state.isFetchingNext);
  const setFeedMode = useAppStore((state) => state.setFeedMode);
  const feedMode = useAppStore((state) => state.feedMode);
  const feedFallback = useAppStore((state) => state.feedFallback);
  const feedRelaxed = useAppStore((state) => state.feedRelaxed);
  const swipeRight = useAppStore((state) => state.swipeRight);
  const swipeLeft = useAppStore((state) => state.swipeLeft);
  const undoPass = useAppStore((state) => state.undoPass);
  const lastPassed = useAppStore((state) => {
    const stack = state.passedStack;
    return stack[stack.length - 1] ?? null;
  });

  const estimatedH = estimateDiscoverCardHeight(windowHeight);
  const pageHeight = useSharedValue(estimatedH);
  const dragOffset = useSharedValue(0);
  const currentProduct = currentProducts[0] ?? null;
  const nextProduct = currentProducts[1] ?? null;
  const warmProduct = currentProducts[2] ?? null;
  const topProductId = currentProduct?.id ?? null;

  const prevTopIdRef = useRef<string | null>(null);
  const pageIndexSVByIdRef = useRef(new Map<string, SharedValue<number>>());

  const registerPageIndexSV = useCallback(
    (productId: string, sv: SharedValue<number>): void => {
      pageIndexSVByIdRef.current.set(productId, sv);
    },
    [],
  );

  const unregisterPageIndexSV = useCallback((productId: string): void => {
    pageIndexSVByIdRef.current.delete(productId);
  }, []);

  const handleDeckLayout = useCallback(
    (event: LayoutChangeEvent): void => {
      const nextH = event.nativeEvent.layout.height;
      if (nextH > 0) {
        pageHeight.value = nextH;
      }
    },
    [pageHeight],
  );

  const userId = user?.id ?? null;
  const canLike = user !== null;
  const productPref = useAppStore((state) => effectiveProductPref(state.productPref));
  const preparationDiagnosticState = useRef({ catalogReady: false });
  const [recommendationCatalogState, setRecommendationCatalogState] = useState(() => ({
    products: [] as Product[],
    fingerprint: fingerprint([]),
    status: 'loading' as 'loading' | 'ready' | 'error',
    productPref: productPref as ProductPref,
  }));
  // A pool read under another preference is never handed to a session, even before the refetch lands.
  const poolReady = recommendationCatalogState.productPref === productPref;
  const recommendationCatalog = poolReady ? recommendationCatalogState.products : EMPTY_RECOMMENDATION_CATALOG;
  const [failedRecommendationSession, setFailedRecommendationSession] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      // The first ranked feed is critical; the optional recommendation pool is not.
      if (feedStatus !== 'success') return;
      let active = true;
      if (__DEV__) preparationDiagnosticState.current.catalogReady = false;
      void fetchRecommendationCatalog(productPref)
        .then((products) => {
          if (active) {
            if (__DEV__) preparationDiagnosticState.current.catalogReady = true;
            // Array identity is not a catalog change. Keep the session/pinned results
            // for identical content, including newly allocated or canonicalized objects.
            // Store the snapshot key separately: the repository can mutate products in place.
            const key = fingerprint(products);
            setRecommendationCatalogState(previous => {
              if (previous.fingerprint === key && previous.productPref === productPref) {
                return previous.status === 'ready' ? previous : { ...previous, status: 'ready' };
              }
              return { products: [...products], fingerprint: key, status: 'ready', productPref };
            });
          }
        })
        .catch(() => {
          logger.warn('Öneri kataloğu okunamadı', { code: 'RECOMMENDATION_CATALOG_FAILED' });
          if (active) {
            if (__DEV__) preparationDiagnosticState.current.catalogReady = true;
            setRecommendationCatalogState(previous => previous.status === 'error' ? previous : { ...previous, status: 'error' });
            Alert.alert('Öneriler yüklenemedi', 'Mevcut öneriler korundu. Bağlantını kontrol edip tekrar dene.');
          }
        });
      return () => {
        active = false;
      };
    }, [feedStatus, productPref]),
  );

  // Discover complements are catalog-only; wardrobe loading and edits cannot
  // delay preparation or invalidate its ranking/prefetch session.
  // After a preference change the session is rebuilt once, when the new pool lands. Until then the
  // previous session stays (it is never asked for cards, see poolReady below), so no empty-pool session exists.
  const heldSession = useRef<{ session: DiscoverRecommendationCache; userId: string | null } | null>(null);
  const recommendationSession = useMemo(() => {
    const held = heldSession.current;
    if (!poolReady && held && held.userId === userId) return held.session;
    return new DiscoverRecommendationCache(recommendationCatalog, [], userId, productPref);
  }, [recommendationCatalog, poolReady, userId, productPref]);
  heldSession.current = { session: recommendationSession, userId };
  const [recommendationRevision, publishRecommendations] = useState(0);
  const recommendationFocused = useRef(false);
  const preparationInputs = useRef({ session: recommendationSession, products: currentProducts, feedStatus, feedPreparationRevision });
  useLayoutEffect(() => {
    if (__DEV__) {
      discoverPrefetchTrace(recommendationSession).bind(recommendationSession, feedPreparationRevision);
      discoverPrefetchTrace(recommendationSession).feedUpdate(currentProducts, feedPreparationRevision);
    }
    preparationInputs.current = { session: recommendationSession, products: currentProducts, feedStatus, feedPreparationRevision };
    recommendationSession.setPreparationWindow(currentProducts);
    if (recommendationFocused.current && currentProduct) recommendationSession.activate(currentProduct);
  }, [recommendationSession, currentProducts, currentProduct, feedStatus, recommendationRevision, feedPreparationRevision]);
  const prefetchedCovers = useRef(new Set<string>());
  useFocusEffect(useCallback(() => {
    recommendationFocused.current = true;
    const controller = new AbortController();
    let workerRequested = false;
    let unsubscribeColdStart = () => {};
    const startPreparation = () => {
      if (workerRequested || controller.signal.aborted || !recommendationFocused.current ||
        preparationInputs.current.session !== recommendationSession) return;
      const latest = preparationInputs.current;
      if (__DEV__) {
        const trace = discoverPrefetchTrace(recommendationSession);
        trace.bind(recommendationSession, latest.feedPreparationRevision);
        trace.effectEntered(latest.products, {
          feedStatus, catalogLength: recommendationSession.catalog.length,
          catalogReady: preparationDiagnosticState.current.catalogReady,
          currentProductsLength: latest.products.length, anchorIds: latest.products.slice(0, 3).map(product => product.id),
          isFocused: recommendationFocused.current, userIdPresent: userId !== null,
          wardrobeUserId: null, wardrobeReady: true, wardrobeMatchesUser: true,
          signalAborted: controller.signal.aborted,
        });
      }
      if (feedStatus === 'success' && poolReady && recommendationSession.catalog.length > 0) {
        const anchors = [...latest.products];
        if (anchors.length > 0) {
          workerRequested = true;
          setFailedRecommendationSession(previous => previous === recommendationSession.sessionId ? null : previous);
          unsubscribeColdStart();
        }
        if (latest.products[0]) recommendationSession.activate(latest.products[0]);
        const request = recommendationSession.request(anchors, latest.feedPreparationRevision);
        if (__DEV__) discoverPrefetchTrace(recommendationSession).diagnostic('workerStartAttempt', {
          workerStartAttempt: true, anchorCount: anchors.length, signalAborted: controller.signal.aborted });
        void loadDiscoverRecommendationPacket(request, userId, controller.signal, packet => {
          if (controller.signal.aborted || !recommendationFocused.current || preparationInputs.current.session !== recommendationSession) return;
          if (!recommendationSession.accept(packet, preparationInputs.current.products)) return;
          const active = preparationInputs.current.products[0];
          if (active) recommendationSession.activate(active);
          publishRecommendations(revision => revision + 1);
          // Android expo-image prefetch decodes original-size Glide targets.
          // Mounted active/next/warm cards already warm view-sized cached images.
          if (Platform.OS === 'android') return;
          const imageUrls = [...new Set(preparationInputs.current.products.flatMap(product => complementaryProductsForDisplay(
            recommendationSession.peekPrepared(product) ?? EMPTY_RECOMMENDATIONS, product.id).flatMap(recommended => getProductImages(recommended).slice(0, 1))))]
            .filter(url => !prefetchedCovers.current.has(url));
          if (imageUrls.length > 0) {
            imageUrls.forEach(url => prefetchedCovers.current.add(url));
            void Image.prefetch(imageUrls, { cachePolicy: 'memory-disk' }).catch(() => {
              imageUrls.forEach(url => prefetchedCovers.current.delete(url));
            });
          }
        }, recommendationSession, () => {
          Alert.alert('Öneri servisine ulaşılamadı', 'Önbellek okunamadı; mevcut verilerle öneriler hazırlanıyor.');
        }).catch(() => {
          if (__DEV__) discoverPrefetchTrace(recommendationSession).diagnostic('workerStartBlocked', {
            workerStartBlocked: true, blockedReason: controller.signal.aborted ? 'ABORTED' : 'WORKER_START_ERROR' });
          if (!controller.signal.aborted) {
            setFailedRecommendationSession(recommendationSession.sessionId);
            logger.warn('Recommendation cache paketi okunamadı', { code: 'RECOMMENDATION_PREPARATION_FAILED' });
            Alert.alert('Öneriler hazırlanamadı', 'Mevcut ürünler korundu. Bağlantını kontrol edip tekrar dene.');
          }
        });
      }
    };
    // A NO_ANCHORS request installs no worker. Retry only that cold-start gap;
    // once requested, the existing worker owns all window/append notifications.
    unsubscribeColdStart = recommendationSession.subscribePreparation(() => {
      if (preparationInputs.current.products.length > 0) startPreparation();
    });
    startPreparation();
    return () => {
      unsubscribeColdStart();
      recommendationFocused.current = false;
      if (__DEV__) discoverPrefetchTrace(recommendationSession).closeReason =
        preparationInputs.current.session !== recommendationSession ? 'context_changed'
          : preparationInputs.current.feedStatus !== 'success' ? 'feed_invalidated' : 'focus_lost';
      if (__DEV__) discoverPrefetchTrace(recommendationSession).diagnostic('effectCleanup', {
        reason: discoverPrefetchTrace(recommendationSession).closeReason, signalAborted: controller.signal.aborted });
      controller.abort();
    };
    // Context/focus own the request. Appending feed anchors does not invalidate it.
    // Window promotion only reprioritizes
    // its existing preparation queue; exposure refresh reuses prepared ranking.
  }, [recommendationSession, feedStatus, userId, poolReady]));
  useEffect(() => {
    if (__DEV__) discoverPrefetchTrace(recommendationSession).productsObserved(currentProducts, feedPreparationRevision);
  }, [recommendationSession, currentProducts, feedPreparationRevision]);

  const selectedRecommendationProductIds = useMemo(
    () => likedProducts.map(item => item.product.id), [likedProducts],
  );

  const [feedQuery, setFeedQuery] = useState<FeedQuery>(EMPTY_FEED_QUERY);
  const [searchInput, setSearchInput] = useState('');
  const [isSearchInputOpen, setIsSearchInputOpen] = useState(false);
  const searchInputRef = useRef<TextInput>(null);
  useEffect(() => {
    if (isSearchInputOpen) searchInputRef.current?.focus();
    else searchInputRef.current?.blur();
  }, [isSearchInputOpen]);
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const feedQueryRef = useRef(feedQuery);
  feedQueryRef.current = feedQuery;

  const reloadFeed = useCallback((): void => {
    const q = feedQueryRef.current;
    void loadFeed(userId, {
      filters: q.filters,
      searchMode: q.mode === 'search',
    });
  }, [loadFeed, userId]);

  const [refreshing, setRefreshing] = useState(false);
  const [refreshEmpty, setRefreshEmpty] = useState(false);
  const deckRefresher = useMemo(
    () => createDeckRefresher({
      resetCaches: resetProductPrefCatalogCaches,
      reload: () => {
        const q = feedQueryRef.current;
        return loadFeed(userId, { filters: q.filters, searchMode: q.mode === 'search' });
      },
      deckSize: () => useAppStore.getState().currentProducts.length,
    }),
    [loadFeed, userId],
  );
  const handleDeckRefresh = useCallback(async (): Promise<void> => {
    setRefreshEmpty(false);
    setRefreshing(true);
    let result: Awaited<ReturnType<typeof deckRefresher>> = 'busy';
    try {
      result = await deckRefresher();
    } catch {
      result = 'ready'; // loadFeed reports its own error state; nothing to add here.
    }
    if (result === 'busy') return;
    setRefreshing(false);
    setRefreshEmpty(result === 'empty');
  }, [deckRefresher]);

  const passedCount = useAppStore((state) => state.passedProductIds.length);
  const handleResurfacePassed = useCallback((): void => {
    resurfacePassed(useAppStore.getState().passedProductIds);
    void handleDeckRefresh();
  }, [handleDeckRefresh]);
  const resurfaceHandler =
    canResurfacePassed(passedCount) && feedQuery.mode !== 'search' ? handleResurfacePassed : undefined;

  const applyFeedQuery = useCallback(
    (next: FeedQuery, options?: { inputText?: string }): void => {
      setFeedQuery(next);
      if (options?.inputText !== undefined) {
        setSearchInput(options.inputText);
      }
      setSessionFilters({
        category: next.filters.category ?? null,
        gender: null,
        size: null,
      });
      const textParts = [
        next.filters.text,
        next.filters.style,
        next.filters.color,
        next.filters.brand,
      ]
        .filter((part): part is string => Boolean(part && part.trim()))
        .join(' ');
      if (textParts.length > 0) {
        setSessionQuery(textParts);
      }
      void loadFeed(userId, {
        filters: next.filters,
        searchMode: next.mode === 'search',
      });
    },
    [loadFeed, userId],
  );

  const handleFeedModeChange = useCallback(
    (mode: FeedMode): void => {
      if (mode === feedMode) {
        return;
      }
      setFeedMode(mode);
      const q = feedQueryRef.current;
      void loadFeed(userId, {
        filters: q.filters,
        searchMode: q.mode === 'search',
      });
    },
    [feedMode, loadFeed, setFeedMode, userId],
  );

  const initialFeedOwner = useRef<string | null | undefined>(undefined);
  const feedSessionReady = !authLoading && (userId ? sessionOwner === userId &&
    (sessionSyncStatus === 'success' || sessionSyncStatus === 'error') : sessionOwner === null);
  useEffect(() => {
    if (!feedSessionReady) {
      if (initialFeedOwner.current !== userId) initialFeedOwner.current = undefined;
      return;
    }
    if (initialFeedOwner.current === userId) return;
    initialFeedOwner.current = userId;
    reloadFeed();
  }, [feedSessionReady, userId, reloadFeed]);

  useFocusEffect(useCallback(() => {
    if (feedStatus === 'success' && hasMore && !isFetchingNext && currentProducts.length <= 5) {
      void loadMoreFeed();
    }
  }, [currentProducts.length, feedStatus, hasMore, isFetchingNext, loadMoreFeed]));

  // The visible card mounts its current/neighbor images itself; only warm the next covers.
  useFocusEffect(useCallback(() => {
    if (Platform.OS === 'android') return;
    const urls: string[] = [];
    const next = nextProduct;
    if (next) {
      const first = getProductImages(next)[0];
      if (first) {
        urls.push(first);
      }
    }
    const warm = warmProduct;
    if (warm) {
      const first = getProductImages(warm)[0];
      if (first) {
        urls.push(first);
      }
    }
    const unique = Array.from(new Set(urls)).filter(
      (url): url is string => typeof url === 'string' && url.length > 0 && !prefetchedCovers.current.has(url),
    );
    if (unique.length === 0) {
      return;
    }
    const handle = requestIdleCallback(() => {
      const pending = unique.filter(url => !prefetchedCovers.current.has(url));
      if (pending.length === 0) return;
      pending.forEach(url => prefetchedCovers.current.add(url));
      void Image.prefetch(pending).catch(() => pending.forEach(url => prefetchedCovers.current.delete(url)));
    });
    return () => cancelIdleCallback(handle);
  }, [nextProduct, warmProduct]));

  const handleRequireAuth = useCallback((): void => {
    router.push('/profile');
  }, [router]);

  const handleOpenLiked = useCallback((): void => {
    router.push('/liked');
  }, [router]);

  const noteSwipe = useDiscoverPerfTrace(recommendationSession, currentProduct, recommendationRevision);

  const handleSwipeRight = useCallback(
    (product: Product, input?: LikeInputSource): void => {
      if (!canLike) {
        handleRequireAuth();
        return;
      }
      try {
        noteSwipe();
        swipeRight(product, input);
      } catch (error) {
        logger.error('Beğeni işlenemedi', { code: 'FAVORITE_START_FAILED' });
        Alert.alert('Beğeni kaydedilemedi', 'Bağlantını kontrol edip tekrar dene.');
      }
    },
    [canLike, handleRequireAuth, noteSwipe, swipeRight],
  );

  /** Store commit yalnız gesture settle sonrası (SwipeCard onPass). */
  const handleSwipeLeft = useCallback(
    (product: Product): void => {
      try {
        if (__DEV__) {
          const products = useAppStore.getState?.().currentProducts ?? preparationInputs.current.products;
          discoverPrefetchTrace(preparationInputs.current.session).recordSwipe(
            preparationInputs.current.session, product, products[1]);
        }
        noteSwipe();
        swipeLeft(product);
      } catch (error) {
        logger.error('Geçme işlenemedi', { error, productId: product.id });
      }
    },
    [noteSwipe, swipeLeft],
  );

  const [tryOnProduct, setTryOnProduct] = useOwnedState<Product | null>(userId, null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [hintStatus, setHintStatus] = useState<HintStatus>('checking');
  const toastTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const currentProductsRef = useRef(currentProducts);
  currentProductsRef.current = currentProducts;

  const handleImpression = useCallback(
    (product: Product, dwellMs: number): void => {
      const position = currentProductsRef.current.findIndex(
        (item) => item.id === product.id,
      );
      trackFeedImpression(product.id, Math.max(position, 0), dwellMs);
    },
    [],
  );

  const handleApplyFilters = useCallback(
    (next: FeedQueryFilters): void => {
      const merged: FeedQueryFilters = { ...next };
      // Preserve free-text from bar parse unless panel overwrote facets only.
      if (!merged.text && feedQueryRef.current.filters.text) {
        // Panel does not edit text; keep existing text facet if any.
        merged.text = feedQueryRef.current.filters.text;
      }
      track('filter', null, {
        category: merged.category ?? null,
        color: merged.color ?? null,
        brand: merged.brand ?? null,
        style: merged.style ?? null,
        price_min: merged.priceMin ?? null,
        price_max: merged.priceMax ?? null,
      });
      applyFeedQuery(feedQueryFromFilters(merged));
    },
    [applyFeedQuery],
  );

  const commitSearchText = useCallback(
    (raw: string): void => {
      const trimmed = raw.trim();
      if (trimmed.length === 0) {
        applyFeedQuery(EMPTY_FEED_QUERY, { inputText: '' });
        return;
      }
      const parsed = parseSearchQuery(trimmed, {
        brands: DEFAULT_SEARCH_BRANDS,
      });
      // Merge with panel-only facets that NL didn't set? Prefer NL as full replace
      // of searchable state so bar + panel stay one source after commit.
      const next = feedQueryFromFilters(parsed.filters);
      applyFeedQuery(next, { inputText: trimmed });
      track('search', null, {
        query: trimmed,
        category: parsed.filters.category ?? null,
        color: parsed.filters.color ?? null,
        result_count: null,
      });
    },
    [applyFeedQuery],
  );

  const handleSearchChange = useCallback(
    (value: string): void => {
      setSearchInput(value);
      if (searchDebounceRef.current !== null) {
        clearTimeout(searchDebounceRef.current);
      }
      searchDebounceRef.current = setTimeout(() => {
        commitSearchText(value);
      }, SEARCH_TRACK_DEBOUNCE_MS);
    },
    [commitSearchText],
  );

  const handleClearSearch = useCallback((): void => {
    if (searchDebounceRef.current !== null) {
      clearTimeout(searchDebounceRef.current);
    }
    applyFeedQuery(EMPTY_FEED_QUERY, { inputText: '' });
  }, [applyFeedQuery]);

  useEffect(() => {
    let isMounted = true;
    void hasSeenSwipeHint().then((seen) => {
      if (isMounted) {
        setHintStatus(seen ? 'hidden' : 'visible');
      }
    });

    return () => {
      isMounted = false;
    };
  }, []);

  const handleDismissHint = useCallback((): void => {
    setHintStatus('hidden');
    void markSwipeHintSeen();
  }, []);

  const showToast = useCallback((message: string): void => {
    if (toastTimeoutRef.current !== null) {
      clearTimeout(toastTimeoutRef.current);
    }
    setToastMessage(message);
    toastTimeoutRef.current = setTimeout(() => {
      setToastMessage(null);
      toastTimeoutRef.current = null;
    }, TOAST_DURATION_MS);
  }, []);

  useEffect(() => {
    return () => {
      if (toastTimeoutRef.current !== null) {
        clearTimeout(toastTimeoutRef.current);
      }
    };
  }, []);

  const handleVirtualTryOn = useCallback((product: Product): void => {
    setTryOnProduct(product);
  }, []);

  const handleCloseTryOn = useCallback((): void => {
    setTryOnProduct(null);
  }, []);

  const handleBuy = useCallback(
    (product: Product): void => {
      showToast(`${getRedirectLabel(product)} yönlendiriliyorsun...`);
      void openProductPage(product);
    },
    [showToast],
  );

  const handleUndoPass = useCallback(async (): Promise<boolean> => {
    try {
      return await undoPass();
    } catch {
      Alert.alert('Geri alınamadı', 'Geçme kaydı korundu. Bağlantını kontrol edip tekrar dene.');
      return false;
    }
  }, [undoPass]);

  /**
   * Reels penceresi: prev=-1, current=0, next=1, warm-up=+2 (queue[2], ekran dışı +2H).
   * Prev yoksa mount edilmez. Stack/peek/park yok.
   */
  const deckPages = useMemo<DeckPage[]>(() => {
    const pages: DeckPage[] = [];
    const current = currentProducts[0];
    const next = currentProducts[1];
    const warm = currentProducts[2];

    if (
      lastPassed !== null &&
      current !== undefined &&
      lastPassed.id !== current.id &&
      (next === undefined || lastPassed.id !== next.id) &&
      (warm === undefined || lastPassed.id !== warm.id)
    ) {
      pages.push({ product: lastPassed, pageIndex: -1 });
    }
    if (current !== undefined) {
      pages.push({ product: current, pageIndex: 0 });
    }
    if (next !== undefined) {
      pages.push({ product: next, pageIndex: 1 });
    }
    if (warm !== undefined) {
      pages.push({ product: warm, pageIndex: 2 });
    }
    return pages;
  }, [currentProducts, lastPassed]);

  // Chip'ler desteye giriş sırasıyla bir kez atanır; frekans sınırı bu sırayı izler.
  const insightSequenceRef = useRef(createInsightChipSequence());
  const [hiddenInsightKinds, setHiddenInsightKinds] = useState(NO_HIDDEN_INSIGHT_KINDS);
  const likeCount = likedProducts.length;
  const wardrobeItems = useAppStore((state) => state.wardrobeItems);
  const insightWardrobe = useMemo(() => toInsightWardrobeItems(wardrobeItems ?? []), [wardrobeItems]);
  const insightWardrobeKey = insightWardrobeSignature(insightWardrobe);
  const insightWardrobeKeyRef = useRef(insightWardrobeKey);
  const insightChips = useMemo(() => {
    // Dolap değişince chip'ler yeni dolaba göre baştan atanır; kalıcı eski chip yanlış kanıt gösterirdi.
    if (insightWardrobeKeyRef.current !== insightWardrobeKey) {
      insightWardrobeKeyRef.current = insightWardrobeKey;
      insightSequenceRef.current = createInsightChipSequence();
    }
    insightSequenceRef.current = assignInsightChips(deckPages.map(page => page.product),
      { wardrobe: insightWardrobe, likeCount }, insightSequenceRef.current);
    return insightSequenceRef.current.chips;
  }, [deckPages, likeCount, insightWardrobe, insightWardrobeKey]);
  const handleHideInsightKind = useCallback((chip: InsightChip): void => {
    setHiddenInsightKinds(previous => new Set(previous).add(chip.kind));
  }, []);

  const deckPoseKey = deckPages
    .map((p) => `${p.product.id}:${p.pageIndex}`)
    .join('|');

  // Atomic pose batch: ALL pageIndexSVs + dragOffset in ONE runOnUI tick.
  // Pass: drag≈-H → +=H; Undo: drag≈+H → -=H. First mount still syncs SVs.
  useLayoutEffect(() => {
    const prev = prevTopIdRef.current;
    const isFirst = prev === null;
    const reconcileDrag = isFirst || prev !== topProductId;
    prevTopIdRef.current = topProductId;

    const H = pageHeight.value > 0 ? pageHeight.value : estimatedH;
    let nextDrag = dragOffset.value;
    if (!isFirst && topProductId !== null && prev !== topProductId) {
      const d = dragOffset.value;
      if (d < -H / 2) {
        nextDrag = d + H;
      } else if (d > H / 2) {
        nextDrag = d - H;
      } else {
        nextDrag = 0;
      }
    }

    const updates: { sv: SharedValue<number>; pageIndex: number }[] = [];
    for (const page of deckPages) {
      const sv = pageIndexSVByIdRef.current.get(page.product.id);
      if (sv !== undefined) {
        updates.push({ sv, pageIndex: page.pageIndex });
      }
    }

    runOnUI(() => {
      'worklet';
      for (let i = 0; i < updates.length; i++) {
        const u = updates[i];
        u.sv.value = u.pageIndex;
      }
      // Assigning even the same value cancels an in-flight Reanimated spring.
      // Pagination can append mid-throw without changing the active product.
      if (reconcileDrag) dragOffset.value = nextDrag;
    })();
  }, [
    topProductId,
    deckPoseKey,
    estimatedH,
    deckPages,
    dragOffset,
    pageHeight,
  ]);

  const hasDeck = currentProducts.length > 0;
  // Katalogda ürün var ama hepsi beğenildi/geçildi: tekrar yüklemek işe yaramaz.
  const isCatalogExhausted = !hasDeck && hasMore === false && seenCount > 0;
  const isLoading = (feedStatus === 'loading' || feedStatus === 'idle' || (!hasDeck && isFetchingNext))
    && !(refreshing && !hasDeck);
  /** Boş deste: blok header'ın altından başlar, kalan alanda ortalanır. */
  const finishedLayout = !isLoading && !hasDeck;
  const isSearchMode = feedQuery.mode === 'search';
  const activeFilterCount = countActiveFilters(feedQuery.filters);
  const searchBannerText = useMemo(() => {
    if (!isSearchMode) {
      return null;
    }
    return searchRelaxBannerText(feedQuery.filters, feedRelaxed, feedFallback);
  }, [isSearchMode, feedQuery.filters, feedRelaxed, feedFallback]);
  const showSearchBanner = Boolean(searchBannerText);

  useEffect(() => {
    return () => {
      if (searchDebounceRef.current !== null) {
        clearTimeout(searchDebounceRef.current);
      }
    };
  }, []);

  return (
    <View
      style={[
        styles.container,
        {
          paddingTop: 0,
        },
      ]}
    >
      <View
        style={[
          styles.body,
          {
            paddingBottom:
              !isLoading && hasDeck
                ? 0
                : layout.deckPadding + discoverCardLiftPx,
            paddingTop: finishedLayout ? railTopInset - spacing.lg : 0,
            justifyContent: finishedLayout ? 'center' : 'flex-start',
          },
        ]}
      >
        {isLoading ? (
          <LoadingFeed />
        ) : !hasDeck && feedStatus === 'error' ? (
          <DeckFinishedCard
            subtitle="Ürünler yüklenemedi. Bağlantını kontrol edip tekrar dene."
            onRefresh={handleDeckRefresh}
            refreshing={refreshing}
            onResurfacePassed={resurfaceHandler}
            onOpenLiked={handleOpenLiked}
          />
        ) : isCatalogExhausted && !isSearchMode ? (
          <DeckFinishedCard
            subtitle={refreshEmpty
              ? 'Şimdilik yeni ürün yok, daha sonra tekrar dene'
              : 'Katalogdaki her şeyi gördün. Yeni ürünler eklendikçe burada belirir.'}
            onRefresh={handleDeckRefresh}
            refreshing={refreshing}
            onResurfacePassed={resurfaceHandler}
            onOpenLiked={handleOpenLiked}
          />
        ) : !hasDeck ? (
          <DeckFinishedCard
            subtitle={
              isSearchMode
                ? 'Bu aramayla eşleşen ürün yok. Filtreleri gevşet veya temizle.'
                : refreshEmpty
                  ? 'Şimdilik yeni ürün yok, daha sonra tekrar dene'
                  : 'Beğendiğin parçalar dolabına eklendi. Yeni öneriler yakında.'
            }
            onRefresh={isSearchMode ? handleClearSearch : handleDeckRefresh}
            refreshing={refreshing && !isSearchMode}
            onResurfacePassed={resurfaceHandler}
            onOpenLiked={handleOpenLiked}
          />
        ) : (
          <View
            style={styles.deckClip}
            collapsable={false}
            onLayout={handleDeckLayout}
          >
            <View style={styles.deck}>
              {deckPages.map(({ product, pageIndex }) => {
                // The held session belongs to the previous preference: nothing it holds may reach the deck meanwhile.
                const recommendations = poolReady ? recommendationSession.lookup(product) : undefined;
                const recommendationStatus = recommendations !== undefined
                  ? 'ready'
                  : recommendationCatalogState.status === 'error' || failedRecommendationSession === recommendationSession.sessionId
                    ? 'error'
                    : recommendationCatalogState.status === 'ready' && recommendationCatalog.length === 0
                      ? 'ready'
                      : 'loading';
                const insightChip = insightChips.get(product.id) ?? null;
                return <SwipeCard
                  key={product.id}
                  product={product}
                  pageIndex={pageIndex}
                  pageHeight={pageHeight}
                  dragOffset={dragOffset}
                  registerPageIndexSV={registerPageIndexSV}
                  unregisterPageIndexSV={unregisterPageIndexSV}
                  canLike={canLike}
                  canUndo={lastPassed !== null}
                  onAddToCloset={handleSwipeRight}
                  onPass={handleSwipeLeft}
                  onVirtualTryOn={handleVirtualTryOn}
                  onBuy={handleBuy}
                  onUndoPass={handleUndoPass}
                  onRequireAuth={handleRequireAuth}
                  onImpression={handleImpression}
                  recommendations={recommendations ?? EMPTY_RECOMMENDATIONS}
                  recommendationStatus={recommendationStatus}
                  selectedRecommendationProductIds={selectedRecommendationProductIds}
                  onSelectRecommendation={canLike ? handleSwipeRight : handleRequireAuth}
                  insightChip={insightChip && !hiddenInsightKinds.has(insightChip.kind) ? insightChip : null}
                  onOpenInsightWardrobe={handleOpenLiked}
                  onHideInsightKind={handleHideInsightKind}
                  railTopInset={railTopInset}
                />
              })}
            </View>
          </View>
        )}
      </View>
      {/*
        Header, deste (body) KARDEŞİNDEN SONRA gelir: RNGH Android'de dokunuşu çizim
        sırasına (zIndex) değil çocuk sırasına göre arar; header'ın önce olması, header
        butonlarına dokunuşu da kartın tek dokunuş (büyütme) jestine gönderiyordu.
        box-none: yalnız header kontrolleri hedef olur, boş şerit desteye geçer.
      */}
      <View
        pointerEvents="box-none"
        style={[
          styles.header,
          {
            paddingLeft: Math.max(insets.left, spacing.lg),
            paddingRight: Math.max(insets.right, spacing.lg),
            paddingTop:
              (insets.top > 0 ? insets.top : layout.statusBarFallback) +
              layout.headerPaddingTop,
          },
        ]}
      >
        <View style={styles.segmentWrap}>
          <TouchClaim>
            <FeedModeSegment
              value={feedMode}
              onChange={handleFeedModeChange}
              overlay
            />
          </TouchClaim>
        <TouchClaim>
        <View collapsable={false} style={[styles.headerActions, { right: headerActionsRight }]}>
          <PressableScale
            onPress={() => {
              setIsSearchInputOpen(open => !open);
            }}
            style={styles.filterHit}
            accessibilityRole="button"
            accessibilityLabel={isSearchInputOpen ? 'Aramayı kapat' : 'Aramayı aç'}
            accessibilityState={{ expanded: isSearchInputOpen }}
          >
            <ShadowedIcon name="search" size={21} />
          </PressableScale>
          <PressableScale
            onPress={() => setIsFilterOpen(true)}
            style={styles.filterHit}
            accessibilityRole="button"
            accessibilityLabel="Filtreler"
          >
            <ShadowedIcon name="sliders-horizontal" size={21} />
            {activeFilterCount > 0 ? <View style={styles.filterDot} /> : null}
          </PressableScale>
        </View>
        </TouchClaim>
        <TouchClaim>
        <View collapsable={false} style={[styles.searchBar, { right: headerActionsRight + FILTER_HIT_SIZE * 2 + spacing.xs }, !isSearchInputOpen && styles.searchClosed]}
          accessibilityElementsHidden={!isSearchInputOpen}
          importantForAccessibility={isSearchInputOpen ? 'auto' : 'no-hide-descendants'}
          pointerEvents={isSearchInputOpen ? 'auto' : 'none'}>
          <TextInput
            ref={searchInputRef}
            value={searchInput}
            onChangeText={handleSearchChange}
            onSubmitEditing={() => commitSearchText(searchInput)}
            placeholder="Ne arıyorsun?"
            placeholderTextColor={colors.inverseText}
            style={[styles.searchInput, styles.headerTextShadow]}
            autoCorrect={false}
            autoCapitalize="none"
            returnKeyType="search"
            accessibilityLabel="Ürün ara"
          />
          {isSearchMode || searchInput.trim().length > 0 ? (
            <PressableScale
              onPress={handleClearSearch}
              style={styles.clearHit}
              accessibilityRole="button"
              accessibilityLabel="Aramayı temizle"
            >
              <X color={colors.inverseText} size={16} />
            </PressableScale>
          ) : null}
        </View>
        </TouchClaim>
        </View>
        {isSearchMode && showSearchBanner && searchBannerText ? (
          <View style={styles.searchMetaBlock}>
            <View style={styles.fallbackBanner}>
              <Text style={styles.fallbackBannerText}>{searchBannerText}</Text>
            </View>
          </View>
        ) : null}
      </View>
      {hintStatus === 'visible' && !isLoading && !isSearchMode && hasDeck ? (
        <SwipeHintOverlay onDismiss={handleDismissHint} />
      ) : null}
      <FilterSheet
        visible={isFilterOpen}
        filters={feedQuery.filters}
        onClose={() => setIsFilterOpen(false)}
        onApply={handleApplyFilters}
        userId={userId}
      />
      <VirtualTryOnModal
        visible={tryOnProduct !== null}
        product={tryOnProduct}
        onClose={handleCloseTryOn}
      />
      {toastMessage ? (
        <View
          style={[
            styles.toast,
            {
              top:
                (insets.top > 0 ? insets.top : layout.statusBarFallback) +
                layout.headerPaddingTop +
                layout.headerControl +
                layout.searchToSegment +
                layout.segmentHeight +
                spacing.sm,
            },
          ]}
          pointerEvents="none"
        >
          <Text style={styles.toastText}>{toastMessage}</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
    overflow: 'hidden',
  },
  header: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    paddingHorizontal: spacing.lg,
    zIndex: HEADER_Z_INDEX,
  },
  searchBar: {
    position: 'absolute',
    top: (FILTER_HIT_SIZE - 36) / 2,
    width: '30%',
    maxWidth: 120,
    height: 36,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.inverseText,
    marginBottom: 0,
    zIndex: 6,
  },
  segmentWrap: {
    alignItems: 'flex-start',
  },
  headerActions: {
    position: 'absolute',
    top: (layout.segmentHeight - FILTER_HIT_SIZE) / 2,
    flexDirection: 'row',
  },
  searchClosed: {
    height: 0,
    opacity: 0,
    overflow: 'hidden',
  },
  searchInput: {
    flex: 1,
    color: colors.inverseText,
    fontSize: 14,
    paddingVertical: 0,
  },
  headerTextShadow: {
    textShadowColor: 'rgba(0, 0, 0, 0.55)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  filterHit: {
    width: FILTER_HIT_SIZE,
    height: FILTER_HIT_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterDot: {
    position: 'absolute',
    top: spacing.xs,
    right: spacing.xs,
    width: layout.filterDot,
    height: layout.filterDot,
    borderRadius: layout.filterDot / 2,
    backgroundColor: colors.accent,
  },
  body: {
    flex: 1,
    width: '100%',
    justifyContent: 'flex-start',
  },
  clearHit: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchMetaBlock: {
    gap: spacing.xs,
    marginBottom: spacing.xs,
  },
  fallbackBanner: {
    marginBottom: 0,
    backgroundColor: colors.accentSoft,
    borderRadius: radius.button,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  fallbackBannerText: {
    color: colors.accentDark,
    fontSize: 13,
    fontWeight: '700',
    textAlign: 'center',
  },
  /** Reels viewport: H = onLayout; offscreen pages clip dışında. Peek band yok. */
  // Prevent container bg bleed through card radius during pager transition
  deckClip: {
    flex: 1,
    overflow: 'hidden',
    backgroundColor: colors.bg,
  },
  deck: {
    flex: 1,
    width: '100%',
    overflow: 'hidden',
    backgroundColor: colors.bg,
  },
  emptyState: {
    alignItems: 'center',
    paddingHorizontal: spacing.xxl,
  },
  finishedCard: {
    width: '100%',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.xxl,
    ...shadows.card,
  },
  finishedTitle: {
    fontSize: 26,
    fontWeight: '800',
    color: colors.text,
    textAlign: 'center',
    marginBottom: spacing.md,
  },
  loadingTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: colors.text,
    textAlign: 'center',
    marginTop: spacing.lg,
    marginBottom: spacing.md,
  },
  emptySubtitle: {
    fontSize: 16,
    lineHeight: 24,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  primaryCta: {
    alignSelf: 'stretch',
    marginTop: spacing.xl,
    backgroundColor: colors.accent,
    borderRadius: radius.button,
    paddingVertical: spacing.lg,
    alignItems: 'center',
  },
  primaryCtaText: {
    color: colors.inverseText,
    fontSize: 16,
    fontWeight: '800',
  },
  secondaryCta: {
    alignSelf: 'stretch',
    marginTop: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.button,
    paddingVertical: spacing.lg,
    alignItems: 'center',
  },
  outlineCta: {
    alignSelf: 'stretch',
    marginTop: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.button,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  outlineCtaText: {
    color: colors.textSecondary,
    fontSize: 14,
    fontWeight: '600',
  },
  secondaryCtaText: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '700',
  },
  toast: {
    position: 'absolute',
    left: spacing.xxl,
    right: spacing.xxl,
    zIndex: 10,
    backgroundColor: colors.inverseSurface,
    borderRadius: radius.chip,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    alignItems: 'center',
  },
  toastText: {
    color: colors.inverseText,
    fontSize: 13,
    fontWeight: '700',
    textAlign: 'center',
  },
});
