import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import {
  Dimensions,
  NativeScrollEvent,
  NativeSyntheticEvent,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Animated, {
  Extrapolation,
  interpolate,
  type SharedValue,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSpring,
} from 'react-native-reanimated';
import PressableScale from './PressableScale';
import {
  DiscoverFanIllustration,
  TryOnScanIllustration,
} from './OnboardingIllustrations';
import {
  ONBOARDING_DOT_SPRING,
  ONBOARDING_ENTER_SPRING,
  ONBOARDING_PARALLAX_FACTOR,
  ONBOARDING_STAGGER_MS,
} from '../lib/motion';
import { colors, radius, spacing } from '../lib/theme';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

interface OnboardingPageCopy {
  title: string;
  body: string;
}

const PAGES: readonly OnboardingPageCopy[] = [
  {
    title: 'Tarzını Keşfet',
    body: 'Kaydırdıkça akış zevkine göre şekillenir; beğendiklerin dolabına eklenir.',
  },
  {
    title: 'AI ile Üzerinde Dene',
    body: 'Fotoğrafını yükle, ürünü üzerinde gör; kararını güvenle ver.',
  },
];

interface OnboardingScreenProps {
  onComplete: () => void;
}

interface PageBlockProps {
  index: number;
  title: string;
  body: string;
  scrollX: SharedValue<number>;
  illustration: ReactElement;
}

function PageBlock({
  index,
  title,
  body,
  scrollX,
  illustration,
}: PageBlockProps) {
  const enter = useSharedValue(0);
  const copyEnter = useSharedValue(0);

  useEffect(() => {
    enter.value = withDelay(
      ONBOARDING_STAGGER_MS * index,
      withSpring(1, ONBOARDING_ENTER_SPRING),
    );
    copyEnter.value = withDelay(
      ONBOARDING_STAGGER_MS * index + ONBOARDING_STAGGER_MS,
      withSpring(1, ONBOARDING_ENTER_SPRING),
    );
  }, [copyEnter, enter, index]);

  const illustrationStyle = useAnimatedStyle(() => {
    const pageOffset = scrollX.value - index * SCREEN_WIDTH;
    return {
      opacity: interpolate(enter.value, [0, 1], [0, 1], Extrapolation.CLAMP),
      transform: [
        {
          translateY: interpolate(
            enter.value,
            [0, 1],
            [36, 0],
            Extrapolation.CLAMP,
          ),
        },
        {
          translateX: pageOffset * ONBOARDING_PARALLAX_FACTOR,
        },
      ],
    };
  });

  const copyStyle = useAnimatedStyle(() => ({
    opacity: interpolate(copyEnter.value, [0, 1], [0, 1], Extrapolation.CLAMP),
    transform: [
      {
        translateY: interpolate(
          copyEnter.value,
          [0, 1],
          [28, 0],
          Extrapolation.CLAMP,
        ),
      },
    ],
  }));

  return (
    <View style={styles.page}>
      <Animated.View style={[styles.illustrationSlot, illustrationStyle]}>
        {illustration}
      </Animated.View>
      <Animated.View style={copyStyle}>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.body}>{body}</Text>
      </Animated.View>
    </View>
  );
}

interface DotProps {
  index: number;
  progress: SharedValue<number>;
}

function Dot({ index, progress }: DotProps) {
  const style = useAnimatedStyle(() => {
    const active = interpolate(
      progress.value,
      [index - 1, index, index + 1],
      [0, 1, 0],
      Extrapolation.CLAMP,
    );
    return {
      width: 8 + active * 16,
      opacity: 0.35 + active * 0.65,
    };
  });

  return <Animated.View style={[styles.dot, style]} />;
}

export default function OnboardingScreen({
  onComplete,
}: OnboardingScreenProps) {
  const scrollRef = useRef<Animated.ScrollView>(null);
  const scrollX = useSharedValue(0);
  const pageProgress = useSharedValue(0);
  const [pageIndex, setPageIndex] = useState(0);

  const onScroll = useAnimatedScrollHandler({
    onScroll: (event) => {
      scrollX.value = event.contentOffset.x;
    },
  });

  const handleMomentumEnd = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>): void => {
      const nextIndex = Math.round(
        event.nativeEvent.contentOffset.x / SCREEN_WIDTH,
      );
      const clamped = Math.max(
        0,
        Math.min(PAGES.length - 1, nextIndex),
      );
      setPageIndex(clamped);
      pageProgress.value = withSpring(clamped, ONBOARDING_DOT_SPRING);
    },
    [pageProgress],
  );

  const goNext = useCallback((): void => {
    if (pageIndex >= PAGES.length - 1) {
      onComplete();
      return;
    }
    const next = pageIndex + 1;
    setPageIndex(next);
    pageProgress.value = withSpring(next, ONBOARDING_DOT_SPRING);
    scrollRef.current?.scrollTo({ x: next * SCREEN_WIDTH, animated: true });
  }, [onComplete, pageIndex, pageProgress]);

  const isLastPage = pageIndex === PAGES.length - 1;
  const ctaLabel = isLastPage ? 'Başla' : 'Devam';

  return (
    <View style={styles.root}>
      <PressableScale
        onPress={onComplete}
        style={styles.skip}
        accessibilityRole="button"
        accessibilityLabel="Atla"
      >
        <Text style={styles.skipText}>Atla</Text>
      </PressableScale>

      <Animated.ScrollView
        ref={scrollRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onScroll={onScroll}
        scrollEventThrottle={16}
        onMomentumScrollEnd={handleMomentumEnd}
      >
        {PAGES.map((page, index) => (
          <PageBlock
            key={page.title}
            index={index}
            title={page.title}
            body={page.body}
            scrollX={scrollX}
            illustration={
              index === 0 ? (
                <DiscoverFanIllustration />
              ) : (
                <TryOnScanIllustration />
              )
            }
          />
        ))}
      </Animated.ScrollView>

      <View style={styles.footer}>
        <View style={styles.dots}>
          {PAGES.map((page, index) => (
            <Dot key={page.title} index={index} progress={pageProgress} />
          ))}
        </View>
        <PressableScale
          onPress={goNext}
          style={styles.cta}
          accessibilityRole="button"
          accessibilityLabel={ctaLabel}
        >
          <Text style={styles.ctaText}>{ctaLabel}</Text>
        </PressableScale>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.bg,
    paddingTop: 56,
  },
  skip: {
    alignSelf: 'flex-end',
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
  },
  skipText: {
    color: colors.textSecondary,
    fontSize: 15,
    fontWeight: '600',
  },
  page: {
    width: SCREEN_WIDTH,
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xxl,
  },
  illustrationSlot: {
    height: 260,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xl,
  },
  title: {
    color: colors.text,
    fontSize: 28,
    fontWeight: '800',
    textAlign: 'center',
    marginBottom: spacing.md,
  },
  body: {
    color: colors.textSecondary,
    fontSize: 16,
    lineHeight: 24,
    textAlign: 'center',
  },
  footer: {
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.xxl,
    gap: spacing.lg,
  },
  dots: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: spacing.sm,
  },
  dot: {
    height: 8,
    borderRadius: radius.chip,
    backgroundColor: colors.accent,
  },
  cta: {
    backgroundColor: colors.accent,
    borderRadius: radius.button,
    paddingVertical: spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 56,
  },
  ctaText: {
    color: colors.inverseText,
    fontSize: 16,
    fontWeight: '800',
  },
});
