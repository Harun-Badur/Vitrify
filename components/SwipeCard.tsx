import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  ActivityIndicator,
  Dimensions,
  type LayoutChangeEvent,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  cancelAnimation,
  Extrapolation,
  interpolate,
  runOnJS,
  runOnUI,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import {
  ChevronRight,
  Heart,
} from 'lucide-react-native';
import DiscoverProductImage from './DiscoverProductImage';
import DiscoverVariantInline from './DiscoverVariantRow';
import {
  activeVariantIndex,
  selectedImageFor,
  storeProductFor,
  VARIANT_ROW_HEIGHT,
  type VariantSelectionState,
} from '../lib/discoverVariants';
import DiscoverRecommendations, { type RecommendationStatus } from './DiscoverRecommendations';
import TouchClaim from './TouchClaim';
import DiscoverActionRail, { DISCOVER_EDGE_MARGIN } from './DiscoverActionRail';
import InsightWhySheet from './InsightWhySheet';
import type { InsightChip as InsightChipModel } from '../lib/insightChip';
import type { DiscoverRecommendation } from '../src/intelligence/recommendations/discoverRecommendation';
import { logger } from '../lib/logger';
import { stripBrandPrefix } from '../lib/productTitle';
import {
  CARD_SPRING_BACK,
  CARD_THROW_SPRING,
  PAN_ACTIVE_OFFSET_Y_PX,
  PAN_FAIL_OFFSET_X_PX,
  shouldCommitPass,
  shouldCommitUndo,
} from '../lib/motion';
import { perfColdStartFirstCard, perfEnabled, perfHasPendingSwipe, perfLog, perfCountRender, perfNow, perfPeekSwipe, perfRenderFields, perfTakeRefreshImage, perfTakeSwipe } from '../lib/perfLog';
import { IMPRESSION_MIN_DWELL_MS, type LikeInputSource } from '../types/analytics';
import { FOREGROUND_RENDER_SETTLE_MS, FOREGROUND_SWIPE_SETTLE_MS, foregroundBegin, foregroundEnd, foregroundSettle } from '../lib/foregroundGate';
import {
  colors,
  estimateDiscoverCardHeight,
  radius,
  shadows,
  spacing,
} from '../lib/theme';
import {
  formatTryPrice,
  getDisplayPrice,
  getDropPercent,
  getProductImages,
  hasCatalogPriceDrop,
  type Product,
} from '../types/product';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

const DOUBLE_TAP_MAX_DISTANCE_PX = 16;
const DOUBLE_TAP_MAX_DURATION_MS = 280;
const HEART_BURST_IN_MS = 160;
const HEART_BURST_OUT_MS = 260;
const HEART_BURST_PEAK_SCALE = 1.18;
/** Soft crossfade when bitmap arrives; pairs with surface placeholder (no white flash). */
const PINCH_MAX_SCALE = 4;
const PINCH_RELEASE_SPRING = { damping: 22, stiffness: 260, mass: 0.6 } as const;
const IMAGE_CROSSFADE_MS = 0;
const RAIL_BOTTOM_PADDING = 26;

/** Single tap (expand) fires only after the double tap window has closed. */
const SINGLE_TAP_DELAY_MS = 250;
/** Horizontal gallery: activate after 6px X; fail if 12px Y first (card vertical wins). */
const IMAGE_SWIPE_ACTIVE_OFFSET_X_PX = 6;
const IMAGE_SWIPE_FAIL_OFFSET_Y_PX = 12;
/** End rubber-band: excess translation ×0.3 at first/last index. */
const IMAGE_RUBBER_BAND = 0.3;
/** Release commit: |vX| > 500 or |tX| > width×0.25 → change index. */
const IMAGE_COMMIT_VELOCITY_X = 500;
const IMAGE_COMMIT_DISTANCE_RATIO = 0.25;
/** Snap settle — withTiming 180ms (not spring). */
const IMAGE_SNAP_DURATION_MS = 180;
const IMAGE_DOT_SIZE = 6;
const IMAGE_DOT_GAP = 5;
const IMAGE_DOT_TRANSITION_MS = 120;

/** Ekran kökünün 16px yatay padding’iyle aynı grid; ekstra inset yok. */
const CARD_WIDTH = SCREEN_WIDTH;
const CARD_HEIGHT = estimateDiscoverCardHeight(SCREEN_HEIGHT);

/** Persists gallery index across unmount so undo restores the same image. */
const imageIndexByProductId = new Map<string, number>();

export type { Product };

/** Sayfa indeksi: -1 = prev, 0 = current, +1 = next. */
export type PageIndex = -1 | 0 | 1 | 2;

export interface SwipeCardProps {
  product: Product;
  /** Relatif sayfa: -1 prev, 0 current, +1 next, +2 warm-up. */
  pageIndex: PageIndex;
  /** Deck onLayout ile ölçülen viewport yüksekliği H. */
  pageHeight: SharedValue<number>;
  /** Ortak sürükleme ofseti; commit sonrası parent 0'a baslar. */
  dragOffset: SharedValue<number>;
  onAddToCloset: (product: Product, source?: LikeInputSource) => void;
  /** Pass throw settle sonrası tek store reconcile. */
  onPass: (product: Product) => void;
  onVirtualTryOn: (product: Product) => void;
  onBuy: (product: Product) => void;
  /** Undo settle sonrası tek store reconcile. */
  onUndoPass?: () => boolean | void | Promise<boolean | void>;
  onRequireAuth?: () => void;
  onImpression: (product: Product, dwellMs: number) => void;
  canLike?: boolean;
  canUndo?: boolean;
  /** Presentation only; horizontal gallery navigation stays enabled. */
  showGalleryIndicators?: boolean;
  /** Parent registry fill (render-time) for atomic pose batch. */
  registerPageIndexSV?: (productId: string, sv: SharedValue<number>) => void;
  /** Parent registry delete on unmount. */
  unregisterPageIndexSV?: (productId: string) => void;
  recommendations?: readonly DiscoverRecommendation[];
  recommendationStatus?: RecommendationStatus;
  selectedRecommendationProductIds?: readonly string[];
  onSelectRecommendation?: (product: Product) => void;
  /** Seçicinin bu karta atadığı tek chip; null/undefined ise chip çizilmez. */
  insightChip?: InsightChipModel | null;
  onOpenInsightWardrobe?: () => void;
  onHideInsightKind?: (chip: InsightChipModel) => void;
  /** Header altı + 16dp: rayın üst sınırı (kart koordinatı). */
  railTopInset?: number;
}

const formatPrice = (product: Product): string =>
  formatTryPrice(getDisplayPrice(product));

function GalleryDotView({ active }: { active: boolean }) {
  const progress = useSharedValue(active ? 1 : 0);

  useEffect(() => {
    progress.value = withTiming(active ? 1 : 0, {
      duration: IMAGE_DOT_TRANSITION_MS,
    });
  }, [active, progress]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0, 1], [0.4, 0.9]),
    transform: [
      {
        scale: interpolate(progress.value, [0, 1], [1, 1.1]),
      },
    ],
  }));

  return <Animated.View style={[styles.galleryDot, animatedStyle]} />;
}

/** Only `active` can change what a dot shows; the dots of a card must not re-render with the card. */
const GalleryDot = React.memo(GalleryDotView);

function SwipeCard({
  product,
  pageIndex,
  pageHeight,
  dragOffset,
  onAddToCloset,
  onPass,
  onVirtualTryOn,
  onBuy,
  onUndoPass,
  onRequireAuth,
  onImpression,
  canLike = true,
  canUndo = false,
  showGalleryIndicators = true,
  registerPageIndexSV,
  unregisterPageIndexSV,
  recommendations,
  recommendationStatus,
  selectedRecommendationProductIds,
  onSelectRecommendation,
  insightChip,
  onOpenInsightWardrobe,
  onHideInsightKind,
  railTopInset = 0,
}: SwipeCardProps) {
  perfCountRender('card');
  const isCurrent = pageIndex === 0;
  /** Pose slot index — parent atomically writes on deck remap; do not sync from React. */
  const pageIndexSV = useSharedValue<number>(pageIndex);
  // Register during render so parent useLayoutEffect sees SVs before paint.
  registerPageIndexSV?.(product.id, pageIndexSV);
  const [hasImageError, setHasImageError] = useState(false);
  const [isImageLoading, setIsImageLoading] = useState(true);
  const imageCachedRef = useRef(false);
  const perfLoadStartRef = useRef<{ index: number; at: number } | null>(null);
  const perfLoadedRef = useRef<Set<number>>(new Set());

  const imagesKey =
    Array.isArray(product.images) && product.images.length > 0
      ? product.images.join('|')
      : product.imageUrl;
  const images = useMemo(
    () => getProductImages(product),
    // product fields captured via imagesKey + id
    // eslint-disable-next-line react-hooks/exhaustive-deps -- stable gallery key
    [product.id, imagesKey],
  );
  const imageCount = images.length;
  const [imageIndex, setImageIndex] = useState(() => {
    const stored = imageIndexByProductId.get(product.id) ?? 0;
    const max = Math.max(0, getProductImages(product).length - 1);
    return Math.min(Math.max(0, stored), max);
  });

  const [pagerWidth, setPagerWidth] = useState(CARD_WIDTH);
  const pageWidthSV = useSharedValue(CARD_WIDTH);
  const galleryX = useSharedValue(0);
  const imageIndexSV = useSharedValue(imageIndex);
  const imageCountSV = useSharedValue(imageCount);

  useEffect(() => {
    const stored = imageIndexByProductId.get(product.id) ?? 0;
    const max = Math.max(0, images.length - 1);
    const next = Math.min(Math.max(0, stored), max);
    setImageIndex(next);
    imageIndexSV.value = next;
    imageCountSV.value = images.length;
    cancelAnimation(galleryX);
    galleryX.value = -next * pageWidthSV.value;
  }, [product.id, images, galleryX, imageCountSV, imageIndexSV, pageWidthSV]);

  const [variantSelection, setVariantSelection] = useState<VariantSelectionState | null>(null);
  const [variantShown, setVariantShown] = useState<VariantSelectionState | null>(null);
  const selectedVariantIndex = activeVariantIndex(variantSelection, product.id);
  const shownVariantImage = selectedImageFor(
    product.colorVariants,
    activeVariantIndex(variantShown, product.id),
  );
  const selectedImageUrl = shownVariantImage ?? images[imageIndex] ?? product.imageUrl;

  useEffect(() => {
    let cancelled = false;
    imageCachedRef.current = false;
    setHasImageError(false);
    setIsImageLoading(true);
    // Prefetch/cache hit: onLoad gelmeden spinner'ı kapat.
    void Image.getCachePathAsync(selectedImageUrl).then((cachedPath) => {
      if (!cancelled && cachedPath) {
        imageCachedRef.current = true;
        setIsImageLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [product.id, selectedImageUrl]);

  useEffect(() => {
    const id = product.id;
    return () => {
      unregisterPageIndexSV?.(id);
    };
  }, [product.id, unregisterPageIndexSV]);

  const hasBrand = product.brand.trim().length > 0;
  const displayTitle = useMemo(
    () => stripBrandPrefix(product.title, product.brand),
    [product.title, product.brand],
  );
  const [isInsightOpen, setIsInsightOpen] = useState(false);
  const [isLikedLocal, setIsLikedLocal] = useState(false);
  /** Görselin alt kenarı (kart koordinatı); ray bu kenara göre konumlanır. */
  const [imageBottom, setImageBottom] = useState(0);
  /** Tek/çift dokunuş yalnız fotoğraf alanında geçerli; alt bilgi dokunuşları yutulur. */
  const imageBottomSV = useSharedValue(0);
  const zoomScale = useSharedValue(1);
  const zoomFocalX = useSharedValue(0);
  const zoomFocalY = useSharedValue(0);
  const pinchActive = useSharedValue(false);
  const likeSourceRef = useRef<LikeInputSource>('double_tap');

  const hasExited = useSharedValue(false);
  const exitAnimationId = useSharedValue(0);
  const heartBurst = useSharedValue(0);

  useEffect(
    () => () => {
      cancelAnimation(heartBurst);
    },
    [heartBurst],
  );

  // Store settle / page rollover: current tekrar etkileşime açık olsun.
  useLayoutEffect(() => {
    runOnUI(() => {
      'worklet';
      // Rollover invalidates callbacks belonging to this card's previous exit.
      exitAnimationId.value += 1;
      if (isCurrent) hasExited.value = false;
    })();
  }, [exitAnimationId, hasExited, isCurrent, product.id]);

  useEffect(() => {
    if (!isCurrent) {
      return;
    }

    const startedAt = Date.now();
    let fired = false;
    const fire = (): void => {
      if (fired) {
        return;
      }
      const dwellMs = Date.now() - startedAt;
      if (dwellMs < IMPRESSION_MIN_DWELL_MS) {
        return;
      }
      fired = true;
      onImpression(product, dwellMs);
    };

    const timeoutId = setTimeout(fire, IMPRESSION_MIN_DWELL_MS);
    return () => {
      clearTimeout(timeoutId);
      fire();
    };
  }, [isCurrent, onImpression, product]);

  const handleAddToCloset = useCallback((source: LikeInputSource): void => {
    try {
      onAddToCloset(product, source);
    } catch (error) {
      logger.error('Beğeni işlenemedi', { error, productId: product.id });
    }
  }, [onAddToCloset, product]);

  const handlePass = useCallback((): void => {
    // The store update and the next card's render follow; the recommendation engine yields to them.
    foregroundSettle(FOREGROUND_RENDER_SETTLE_MS);
    try {
      onPass(product);
    } catch (error) {
      logger.error('Geçme işlenemedi', { error, productId: product.id });
    }
  }, [onPass, product]);

  const handleVirtualTryOn = useCallback((): void => {
    try {
      const vtonUrl = images[imageIndex] ?? product.imageUrl;
      onVirtualTryOn({ ...product, imageUrl: vtonUrl });
    } catch (error) {
      logger.error('Sanal deneme başlatılamadı', {
        error,
        productId: product.id,
      });
    }
  }, [images, imageIndex, onVirtualTryOn, product]);

  const commitImageIndex = useCallback(
    (nextIndex: number): void => {
      if (nextIndex < 0 || nextIndex >= images.length) {
        return;
      }
      setImageIndex(nextIndex);
      imageIndexByProductId.set(product.id, nextIndex);
    },
    [images.length, product.id],
  );

  const handleImagePagerLayout = useCallback(
    (event: LayoutChangeEvent): void => {
      const { width, y, height } = event.nativeEvent.layout;
      const bottom = y + height;
      setImageBottom((current) => (Math.abs(current - bottom) > 0.5 ? bottom : current));
      imageBottomSV.value = bottom;
      if (!(width > 0)) {
        return;
      }
      if (Math.abs(width - pageWidthSV.value) > 0.5) {
        setPagerWidth(width);
      }
      pageWidthSV.value = width;
      galleryX.value = -imageIndexSV.value * width;
    },
    [galleryX, imageBottomSV, imageIndexSV, pageWidthSV],
  );

  const handleRequireAuth = useCallback((): void => {
    try {
      onRequireAuth?.();
    } catch (error) {
      logger.error('Auth yönlendirmesi başarısız', { error });
    }
  }, [onRequireAuth]);

  const handleBuy = useCallback((): void => {
    try {
      onBuy(storeProductFor(product, selectedVariantIndex));
    } catch (error) {
      logger.error('Pazaryeri sayfası açılamadı', {
        error,
        productId: product.id,
      });
    }
  }, [onBuy, product, selectedVariantIndex]);

  const handleUndoPass = useCallback(async (animationId: number): Promise<void> => {
    foregroundSettle(FOREGROUND_RENDER_SETTLE_MS);
    let restored = false;
    try {
      restored = onUndoPass !== undefined && (await onUndoPass()) !== false;
    } catch (error) {
      logger.error('Geçme geri alınamadı', { error });
    }
    if (!restored) {
      runOnUI(() => {
        'worklet';
        // A failed/no-op undo has no rollover to release the exit lock.
        // A late result must never reset a newer card or gesture.
        if (exitAnimationId.value !== animationId || pageIndexSV.value !== 0) return;
        hasExited.value = false;
        dragOffset.value = withSpring(0, CARD_SPRING_BACK);
      })();
    }
  }, [onUndoPass, exitAnimationId, pageIndexSV, hasExited, dragOffset]);

  const handleStorePress = useCallback((): void => {
    handleBuy();
  }, [handleBuy]);

  const finishDoubleTapLike = useCallback((): void => {
    const source = likeSourceRef.current;
    likeSourceRef.current = 'double_tap';
    if (!canLike) {
      handleRequireAuth();
      return;
    }
    handleAddToCloset(source);
  }, [canLike, handleAddToCloset, handleRequireAuth]);


  const snapHome = (): void => {
    'worklet';
    dragOffset.value = withSpring(0, CARD_SPRING_BACK);
  };

  /**
   * Y eksenine kilitli Reels pager: translateY = pageIndexSV * H + dragOffset.
   * Yatay/çapraz sürüklemede pan hiç aktive olmaz.
   */
  const panGesture = Gesture.Pan()
    .enabled(isCurrent)
    .activeOffsetY([-PAN_ACTIVE_OFFSET_Y_PX, PAN_ACTIVE_OFFSET_Y_PX])
    .failOffsetX([-PAN_FAIL_OFFSET_X_PX, PAN_FAIL_OFFSET_X_PX])
    .maxPointers(1)
    // Engine slices pause while the card is dragged and thrown (moves work in time, never changes it).
    .onBegin(() => {
      runOnJS(foregroundBegin)();
    })
    .onFinalize(() => {
      runOnJS(foregroundEnd)(FOREGROUND_SWIPE_SETTLE_MS);
    })
    .onUpdate((event) => {
      if (hasExited.value || pinchActive.value) {
        return;
      }
      dragOffset.value = event.translationY;
    })
    .onEnd((event) => {
      if (hasExited.value) {
        return;
      }

      const y = event.translationY;
      const vy = event.velocityY;
      const H = pageHeight.value > 0 ? pageHeight.value : CARD_HEIGHT;

      if (shouldCommitPass(y, vy)) {
        const animationId = ++exitAnimationId.value;
        hasExited.value = true;
        dragOffset.value = withSpring(
          -H,
          { ...CARD_THROW_SPRING, velocity: vy },
          (finished) => {
            if (exitAnimationId.value !== animationId) return;
            if (finished) {
              runOnJS(handlePass)();
            } else {
              hasExited.value = false;
            }
          },
        );
        return;
      }

      if (shouldCommitUndo(y, vy)) {
        if (!canUndo) {
          snapHome();
          return;
        }
        const animationId = ++exitAnimationId.value;
        hasExited.value = true;
        dragOffset.value = withSpring(
          H,
          { ...CARD_THROW_SPRING, velocity: vy },
          (finished) => {
            if (exitAnimationId.value !== animationId) return;
            if (finished) {
              runOnJS(handleUndoPass)(animationId);
            } else {
              hasExited.value = false;
            }
          },
        );
        return;
      }

      snapHome();
    });

  const playHeartThenLike = (): void => {
    'worklet';
    if (hasExited.value) {
      return;
    }
    exitAnimationId.value += 1;
    hasExited.value = true;
    heartBurst.value = withSequence(
      withTiming(1, { duration: HEART_BURST_IN_MS }),
      withTiming(0, { duration: HEART_BURST_OUT_MS }, (finished) => {
        if (finished) {
          runOnJS(finishDoubleTapLike)();
        }
      }),
    );
  };

  const openInsight = useCallback((): void => setIsInsightOpen(true), []);

  const playHeartRef = useRef(playHeartThenLike);
  playHeartRef.current = playHeartThenLike;

  /** Beğen butonu: çift dokunuşla aynı kalp animasyonu ve beğeni akışı. */
  const handleLikeButton = useCallback((): void => {
    if (!canLike) {
      handleRequireAuth();
      return;
    }
    likeSourceRef.current = 'button';
    setIsLikedLocal(true);
    runOnUI(() => {
      'worklet';
      playHeartRef.current();
    })();
  }, [canLike, handleRequireAuth]);

  const doubleTapGesture = Gesture.Tap()
    .enabled(isCurrent)
    .numberOfTaps(2)
    .maxDelay(SINGLE_TAP_DELAY_MS)
    .maxDuration(DOUBLE_TAP_MAX_DURATION_MS)
    .maxDistance(DOUBLE_TAP_MAX_DISTANCE_PX)
    .onEnd((event) => {
      if (hasExited.value || event.y > imageBottomSV.value) {
        return;
      }
      if (!canLike) {
        runOnJS(handleRequireAuth)();
        return;
      }
      playHeartThenLike();
    });

  /**
   * İki parmakla yakınlaştırma: yalnız fotoğraf alanında, 1–4x, bırakınca 1'e döner.
   * Tamamı UI thread'de; alt bilgi alanında başlayan pinch yok sayılır.
   */
  const pinchGesture = Gesture.Pinch()
    .enabled(isCurrent)
    .onStart((event) => {
      pinchActive.value = !hasExited.value && event.focalY <= imageBottomSV.value;
    })
    .onUpdate((event) => {
      if (!pinchActive.value) {
        return;
      }
      zoomFocalX.value = event.focalX;
      zoomFocalY.value = event.focalY;
      zoomScale.value = Math.min(PINCH_MAX_SCALE, Math.max(1, event.scale));
    })
    .onFinalize(() => {
      pinchActive.value = false;
      zoomScale.value = withSpring(1, PINCH_RELEASE_SPRING);
    });

  const cardGesture = Gesture.Simultaneous(
    pinchGesture,
    Gesture.Exclusive(doubleTapGesture, panGesture),
  );

  const zoomStyle = useAnimatedStyle(() => {
    const scale = zoomScale.value;
    return {
      transform: [
        { translateX: (pageWidthSV.value / 2 - zoomFocalX.value) * (scale - 1) },
        { translateY: (imageBottomSV.value / 2 - zoomFocalY.value) * (scale - 1) },
        { scale },
      ],
    };
  });

  /**
   * Image-only horizontal pager. Separation from card vertical via offsets only:
   * X±6 activates gallery; Y±12 first fails so card pass/undo wins.
   * No simultaneousHandlers / exclusive / requireExternal / blocksExternal vs vertical.
   */
  const imagePanGesture = Gesture.Pan()
    .enabled(isCurrent && imageCount > 1)
    .minPointers(1)
    .activeOffsetX([
      -IMAGE_SWIPE_ACTIVE_OFFSET_X_PX,
      IMAGE_SWIPE_ACTIVE_OFFSET_X_PX,
    ])
    .failOffsetY([-IMAGE_SWIPE_FAIL_OFFSET_Y_PX, IMAGE_SWIPE_FAIL_OFFSET_Y_PX])
    .onUpdate((event) => {
      const width = pageWidthSV.value;
      if (!(width > 0)) {
        return;
      }
      const idx = imageIndexSV.value;
      const last = imageCountSV.value - 1;
      const tx = event.translationX;
      // Direct drag — no withSpring while dragging. Rubber-band excess at ends ×0.3.
      let dragX = tx;
      if (idx <= 0 && tx > 0) {
        dragX = tx * IMAGE_RUBBER_BAND;
      } else if (idx >= last && tx < 0) {
        dragX = tx * IMAGE_RUBBER_BAND;
      }
      galleryX.value = -idx * width + dragX;
    })
    .onEnd((event) => {
      const width = pageWidthSV.value;
      const count = imageCountSV.value;
      if (!(width > 0) || count <= 1) {
        return;
      }
      const idx = imageIndexSV.value;
      const tx = event.translationX;
      const vx = event.velocityX;
      let next = idx;
      if (
        Math.abs(vx) > IMAGE_COMMIT_VELOCITY_X ||
        Math.abs(tx) > width * IMAGE_COMMIT_DISTANCE_RATIO
      ) {
        const direction =
          Math.abs(vx) > IMAGE_COMMIT_VELOCITY_X
            ? Math.sign(vx)
            : Math.sign(tx);
        // Finger left (neg) → next image; finger right (pos) → previous.
        if (direction < 0) {
          next = Math.min(count - 1, idx + 1);
        } else if (direction > 0) {
          next = Math.max(0, idx - 1);
        }
      }
      // Dot/index commit on same tick as snap decision (before animation ends).
      imageIndexSV.value = next;
      runOnJS(commitImageIndex)(next);
      galleryX.value = withTiming(-next * width, {
        duration: IMAGE_SNAP_DURATION_MS,
      });
    });

  const animatedCardStyle = useAnimatedStyle(() => {
    const H = pageHeight.value > 0 ? pageHeight.value : CARD_HEIGHT;
    return {
      transform: [{ translateY: pageIndexSV.value * H + dragOffset.value }],
    };
  });

  const heartBurstStyle = useAnimatedStyle(() => ({
    opacity: heartBurst.value,
    transform: [
      {
        scale: interpolate(
          heartBurst.value,
          [0, 1],
          [0.72, HEART_BURST_PEAK_SCALE],
          Extrapolation.CLAMP,
        ),
      },
    ],
  }));

  const galleryStripStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: galleryX.value }],
  }));

  const showGalleryPager = imageCount > 1 && shownVariantImage === null;

  const slotTranslateStyle = useMemo(
    () => ({ transform: [{ translateY: pageIndex * CARD_HEIGHT }] }),
    [pageIndex],
  );

  useEffect(() => {
    // The next card's image may have loaded while it was still a neighbour.
    if (!perfEnabled() || !isCurrent) return;
    const toCurrent = perfPeekSwipe();
    if (toCurrent !== null) perfLog('swipe_to_is_current', { ms: toCurrent, ...perfRenderFields() });
    if (!perfHasPendingSwipe() || !perfLoadedRef.current.has(0)) return;
    const swipeMs = perfTakeSwipe();
    if (swipeMs !== null) perfLog('swipe_to_next_image', { ms: swipeMs, cached: true, ...perfRenderFields() });
  }, [isCurrent]);

  const handleImageLoadStart = useCallback((): void => {
    if (perfEnabled()) perfLoadStartRef.current = { index: imageIndex, at: perfNow() };
    if (!imageCachedRef.current) {
      setIsImageLoading(true);
    }
  }, [imageIndex]);

  const handleImageLoad = useCallback((): void => {
    if (perfEnabled()) {
      const started = perfLoadStartRef.current;
      perfLoadedRef.current.add(imageIndex);
      if (started && started.index === imageIndex && isCurrent) {
        perfLog(imageIndex === 0 ? 'gallery_first_image' : 'gallery_extra_image', { ms: perfNow() - started.at, idx: imageIndex });
      }
      if (isCurrent && imageIndex === 0) {
        perfColdStartFirstCard();
        const refreshMs = perfTakeRefreshImage();
        if (refreshMs !== null) perfLog('deck_refresh_first_image', { ms: refreshMs });
        const swipeMs = perfTakeSwipe();
        if (swipeMs !== null) perfLog('swipe_to_next_image', { ms: swipeMs, cached: false, ...perfRenderFields() });
      }
    }
    setIsImageLoading(false);
  }, [imageIndex, isCurrent]);

  const clearVariant = useCallback((): void => {
    setVariantSelection(null);
    setVariantShown(null);
  }, []);

  const handleImageError = useCallback((): void => {
    if (shownVariantImage !== null) {
      // Variant image failed: fall back to the previous photo instead of an error card.
      clearVariant();
      return;
    }
    setHasImageError(true);
    setIsImageLoading(false);
  }, [clearVariant, shownVariantImage]);

  const handleSelectColor = useCallback((index: number): void => {
    const variants = product.colorVariants;
    const imageUrl = variants?.[index]?.imageUrl?.trim();
    const productId = product.id;
    if (activeVariantIndex(variantSelection, productId) === index) {
      clearVariant();
      return;
    }
    setVariantSelection({ productId, index });
    if (!imageUrl) {
      setVariantShown(null);
      return;
    }
    // Keep the current photo until the variant image is cached; failure keeps the old photo.
    void Image.prefetch(imageUrl).then(
      (ok) => {
        if (ok) {
          setVariantShown({ productId, index });
        } else {
          setVariantSelection((current) =>
            current?.productId === productId && current.index === index ? null : current);
        }
      },
      () => {
        setVariantSelection((current) =>
          current?.productId === productId && current.index === index ? null : current);
      },
    );
  }, [clearVariant, product.colorVariants, product.id, variantSelection]);

  // Selection is per card: drop it when this slot is reused for another product.
  useEffect(() => {
    setVariantSelection((current) => (current?.productId === product.id ? current : null));
    setVariantShown((current) => (current?.productId === product.id ? current : null));
  }, [product.id]);

  // Current card only: warm one or two unselected color images shortly after it settles.
  useEffect(() => {
    if (!isCurrent || !product.colorVariants || product.colorVariants.length < 2) return;
    const timer = setTimeout(() => {
      (product.colorVariants ?? [])
        .map((variant, index) => ({ url: variant.imageUrl?.trim(), index }))
        .filter((item) => item.url && item.index !== selectedVariantIndex)
        .slice(0, 2)
        .forEach((item) => { void Image.prefetch(item.url as string); });
    }, 300);
    return () => clearTimeout(timer);
  }, [isCurrent, product.colorVariants, selectedVariantIndex]);

  return (
    <Animated.View
      pointerEvents={isCurrent ? 'auto' : 'none'}
      collapsable={false}
      style={[styles.slot, slotTranslateStyle, animatedCardStyle]}
    >
      <GestureDetector gesture={cardGesture}>
        <Animated.View
          collapsable={false}
          style={[styles.shadowWrap, styles.shadowWrapFront,
            recommendations !== undefined && styles.pageContent]}
          accessibilityRole="image"
          accessibilityLabel={`${product.brand} ${product.title}, ${formatPrice(product)}`}
        >
          <View style={styles.card}>
            <View style={styles.imageWrap} onLayout={handleImagePagerLayout}>
              <Animated.View style={[StyleSheet.absoluteFill, zoomStyle]} collapsable={false}>
              {hasImageError ? (
                <View style={styles.imageFallback}>
                  <Text style={styles.imageFallbackText}>
                    Görsel yüklenemedi
                  </Text>
                </View>
              ) : showGalleryPager ? (
                <GestureDetector gesture={imagePanGesture}>
                  <Animated.View
                    style={styles.imagePager}
                    collapsable={false}
                    accessibilityRole="image"
                    accessibilityLabel="Ürün görselleri"
                  >
                    <Animated.View
                      style={[
                        styles.imageStrip,
                        { width: pagerWidth * imageCount },
                        galleryStripStyle,
                      ]}
                    >
                      {images.map((uri, index) => (
                        <View
                          key={`${product.id}:${index}`}
                          style={[styles.imagePage, { width: pagerWidth }]}
                        >
                          {(index === imageIndex || (pageIndex === 0 && Math.abs(index - imageIndex) <= 1)) && <DiscoverProductImage
                            uri={uri}
                            slot="main"
                            style={styles.image}
                            cachePolicy="memory-disk"
                            recyclingKey={`${product.id}:${index}`}
                            transition={IMAGE_CROSSFADE_MS}
                            priority={
                              pageIndex === 0
                                ? 'high'
                                : 'low'
                            }
                            onLoadStart={
                              index === imageIndex
                                ? handleImageLoadStart
                                : undefined
                            }
                            onLoad={
                              index === imageIndex ? handleImageLoad : undefined
                            }
                            onError={
                              index === imageIndex
                                ? handleImageError
                                : undefined
                            }
                          />}
                        </View>
                      ))}
                    </Animated.View>
                  </Animated.View>
                </GestureDetector>
              ) : (
                <DiscoverProductImage
                  uri={selectedImageUrl}
                  slot="main"
                  style={styles.image}
                  cachePolicy="memory-disk"
                  recyclingKey={`${product.id}:${imageIndex}`}
                  transition={IMAGE_CROSSFADE_MS}
                  priority={
                    pageIndex === 0 || pageIndex === 1 || pageIndex === 2
                      ? 'high'
                      : 'low'
                  }
                  onLoadStart={handleImageLoadStart}
                  onLoad={handleImageLoad}
                  onError={handleImageError}
                />
              )}

              </Animated.View>

              {isImageLoading && !hasImageError ? (
                <View style={styles.imageLoading} pointerEvents="none">
                  <ActivityIndicator color={colors.accent} />
                </View>
              ) : null}

              {showGalleryPager && showGalleryIndicators ? (
                <View style={styles.dotsRow} pointerEvents="none">
                  <View style={styles.dotsPill}>
                    {images.map((_, index) => (
                      <GalleryDot
                        key={`${product.id}:dot:${index}`}
                        active={index === imageIndex}
                      />
                    ))}
                  </View>
                </View>
              ) : null}

              <Animated.View
                pointerEvents="none"
                style={[styles.heartBurst, heartBurstStyle]}
              >
                <Heart color={colors.accent} fill={colors.accent} size={64} />
              </Animated.View>

            </View>

            <View style={styles.info}>
              <View
                style={styles.metaRow}
                accessible
                accessibilityLabel={`${product.brand} ${product.title}`.trim()}
              >
                {hasBrand ? (
                  <View style={styles.brandGroup}>
                    <Text style={styles.brand} numberOfLines={1} maxFontSizeMultiplier={1.15}>
                      {product.brand}
                    </Text>
                    <ChevronRight size={14} color={colors.textSecondary} style={styles.chevron} />
                  </View>
                ) : null}
                <Text style={styles.title} numberOfLines={1} ellipsizeMode="tail" maxFontSizeMultiplier={1.15}>
                  {displayTitle}
                </Text>
              </View>
              <View style={styles.purchaseRow}>
                <View style={styles.priceRow}>
                  {hasCatalogPriceDrop(product) &&
                  typeof product.previousPrice === 'number' ? (
                    <Text style={styles.previousPrice}>
                      {formatTryPrice(product.previousPrice)}
                    </Text>
                  ) : null}
                  <Text style={styles.price}>{formatPrice(product)}</Text>
                  {hasCatalogPriceDrop(product) &&
                  typeof product.previousPrice === 'number' ? (
                    <View style={styles.dropBadge}>
                      <Text style={styles.dropBadgeText}>
                        {`↓ %${getDropPercent(product.previousPrice, getDisplayPrice(product))}`}
                      </Text>
                    </View>
                  ) : null}
                </View>
                <DiscoverVariantInline
                  product={product}
                  selectedIndex={selectedVariantIndex}
                  onSelectColor={handleSelectColor}
                />
              </View>
            </View>
          </View>
        </Animated.View>
      </GestureDetector>
      {imageBottom > 0 ? (
        // Kartın jest ağacının KARDEŞİ: ray üzerinde başlayan dokunuş
        // tek/çift dokunuş ve pan jestlerine hiç ulaşmaz. Peek kartlarda da çizilir
        // (kartla aynı kaydırma kapsayıcısında kayar); slot pointerEvents'i yalnız
        // öndeki kartın rayını dokunulabilir bırakır.
        <View
          style={[styles.railAnchor, { height: imageBottom, paddingTop: railTopInset }]}
          pointerEvents="box-none"
        >
          <TouchClaim>
          <DiscoverActionRail
            onTry={handleVirtualTryOn}
            onStore={handleStorePress}
            onLike={handleLikeButton}
            liked={isLikedLocal}
            onWhy={openInsight}
            whyVisible={insightChip !== null && insightChip !== undefined}
            maxHeight={imageBottom - RAIL_BOTTOM_PADDING - railTopInset}
          />
          </TouchClaim>
        </View>
      ) : null}
      {recommendations !== undefined ? (
        <DiscoverRecommendations
          currentProductId={product.id}
          recommendations={recommendations}
          status={recommendationStatus}
          selectedProductIds={selectedRecommendationProductIds}
          onSelectProduct={onSelectRecommendation}
        />
      ) : null}
      {insightChip ? (
        <InsightWhySheet
          chip={insightChip}
          visible={isCurrent && isInsightOpen}
          onClose={() => setIsInsightOpen(false)}
          onOpenWardrobe={() => {
            setIsInsightOpen(false);
            onOpenInsightWardrobe?.();
          }}
          onHideKind={() => {
            setIsInsightOpen(false);
            onHideInsightKind?.(insightChip);
          }}
        />
      ) : null}
    </Animated.View>
  );
}

/** Same shallow comparison as the default memo; under the PERF flag it logs which props changed. */
const arePropsEqual = (prev: SwipeCardProps, next: SwipeCardProps): boolean => {
  const prevRecord = prev as unknown as Record<string, unknown>;
  const nextRecord = next as unknown as Record<string, unknown>;
  const keys = Object.keys(nextRecord);
  const changed = keys.filter(key => !Object.is(prevRecord[key], nextRecord[key]));
  if (changed.length > 0 && perfEnabled()) {
    perfLog('card_props_changed', { idx: next.pageIndex, props: changed.join(',') });
  }
  return changed.length === 0 && Object.keys(prevRecord).length === keys.length;
};

export default React.memo(SwipeCard, arePropsEqual);

export const SWIPE_CARD_WIDTH = CARD_WIDTH;
export const SWIPE_CARD_HEIGHT = CARD_HEIGHT;

const styles = StyleSheet.create({
  railAnchor: {
    position: 'absolute',
    top: 0,
    right: DISCOVER_EDGE_MARGIN,
    justifyContent: 'flex-end',
    paddingBottom: RAIL_BOTTOM_PADDING,
  },
  slot: {
    ...StyleSheet.absoluteFill,
  },
  shadowWrap: {
    width: '100%',
    height: '100%',
    backgroundColor: colors.bg,
  },
  shadowWrapFront: {
    elevation: 0,
  },
  pageContent: {
    flex: 1,
    height: 'auto',
  },
  card: {
    flex: 1,
    overflow: 'hidden',
    backgroundColor: colors.bg,
  },
  imageWrap: {
    flex: 1,
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  image: {
    width: '100%',
    height: '100%',
  },
  imageFallback: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },
  imageFallbackText: {
    color: colors.textSecondary,
    fontSize: 15,
    fontWeight: '600',
  },
  imageLoading: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  imagePager: {
    flex: 1,
    width: '100%',
    overflow: 'hidden',
  },
  imageStrip: {
    flexDirection: 'row',
    height: '100%',
  },
  imagePage: {
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  dotsRow: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 24,
    zIndex: 3,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  dotsPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: IMAGE_DOT_GAP,
    paddingHorizontal: spacing.xs,
    paddingVertical: 2,
    borderRadius: radius.chip,
    backgroundColor: 'transparent',
  },
  galleryDot: {
    width: IMAGE_DOT_SIZE,
    height: IMAGE_DOT_SIZE,
    borderRadius: IMAGE_DOT_SIZE / 2,
    backgroundColor: colors.input,
  },
  heartBurst: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  authButton: {
    position: 'absolute',
    left: spacing.md,
    top: spacing.md,
    zIndex: 4,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.glass,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.chip,
    ...shadows.chip,
  },
  authButtonText: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '700',
  },
  info: {
    flexShrink: 0,
    backgroundColor: colors.input,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    marginTop: -14,
    paddingHorizontal: spacing.lg,
    paddingTop: 10,
    paddingBottom: 6,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    marginBottom: spacing.xs,
  },
  brandGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    flexShrink: 0,
    maxWidth: '45%',
    marginRight: 0,
  },
  // lucide glyph spans x 9..15 of 24: ~5.25dp inner padding per side at 14dp.
  // Visible gaps: brand->stroke 2dp, stroke->title 5dp.
  chevron: {
    flexShrink: 0,
    marginLeft: -3.25,
    marginRight: -0.25,
  },
  identityRow: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  metaDivider: {
    width: 1,
    height: 12,
    backgroundColor: colors.border,
  },
  categoryBadge: {
    paddingVertical: 1,
    borderRadius: radius.chip,
  },
  categoryBadgeText: {
    color: colors.textSecondary,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  brand: {
    flexShrink: 1,
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  title: {
    flex: 1,
    color: colors.text,
    fontSize: 15,
    fontWeight: '600',
    lineHeight: 20,
  },
  variationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  swatch: {
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: colors.border,
  },
  sizeHint: {
    color: colors.textSecondary,
    fontSize: 11,
    fontWeight: '600',
  },
  // Fixed height: color/size row and price share one line; footer height never varies.
  purchaseRow: {
    flexDirection: 'row',
    alignItems: 'center',
    columnGap: 10,
    height: VARIANT_ROW_HEIGHT,
  },
  priceRow: {
    flexShrink: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  previousPrice: {
    color: colors.textSecondary,
    fontSize: 10,
    fontWeight: '600',
    textDecorationLine: 'line-through',
  },
  price: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '800',
  },
  dropBadge: {
    backgroundColor: colors.accentSoft,
    borderRadius: radius.chip,
    paddingHorizontal: spacing.xs,
    paddingVertical: 3,
  },
  dropBadgeText: {
    color: colors.accentDark,
    fontSize: 10,
    fontWeight: '800',
  },
});
