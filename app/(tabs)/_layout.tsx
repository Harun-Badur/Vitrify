import { useEffect } from 'react';
import { BackHandler, StyleSheet, useWindowDimensions } from 'react-native';
import { Tabs, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Compass, Heart, Shirt, User } from 'lucide-react-native';
import { useReducedMotion } from 'react-native-reanimated';
import { TAB_TRANSITION_MS } from '../../lib/motion';
import { colors, spacing } from '../../lib/theme';
import { getTabBarMetrics } from '../../lib/tabBarLayout';

const ACTIVE_COLOR = colors.accent;
const INACTIVE_COLOR = colors.textSecondary;
const ICON_SIZE = 25;

export default function TabsLayout() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const reduceMotion = useReducedMotion();
  const { fontScale } = useWindowDimensions();
  const barMetrics = getTabBarMetrics(insets.bottom, fontScale);

  useEffect(() => {
    const subscription = BackHandler.addEventListener(
      'hardwareBackPress',
      () => {
        // Gidilecek bir geçmiş varsa navigator kendi davranışını uygulasın.
        // Kök sekmedeyken geri tuşu uygulamadan çıkmasın.
        return !router.canGoBack();
      },
    );

    return () => {
      subscription.remove();
    };
  }, [router]);

  return (
    <Tabs
      backBehavior="history"
      safeAreaInsets={{
        bottom: insets.bottom,
        left: insets.left,
        right: insets.right,
      }}
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: ACTIVE_COLOR,
        tabBarInactiveTintColor: INACTIVE_COLOR,
        tabBarStyle: [
          styles.bar,
          {
            ...barMetrics,
            paddingLeft: Math.max(insets.left, spacing.sm),
            paddingRight: Math.max(insets.right, spacing.sm),
          },
        ],
        tabBarLabelStyle: styles.label,
        tabBarLabelPosition: 'below-icon',
        tabBarIconStyle: styles.icon,
        tabBarHideOnKeyboard: true,
        tabBarItemStyle: styles.item,
        sceneStyle: styles.scene,
        animation: reduceMotion ? 'none' : 'shift',
        transitionSpec: {
          animation: 'timing',
          config: { duration: TAB_TRANSITION_MS },
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Keşfet',
          tabBarIcon: ({ color }) => <Compass color={color} size={ICON_SIZE} />,
        }}
      />
      <Tabs.Screen
        name="style"
        options={{
          title: 'Favoriler',
          tabBarIcon: ({ color }) => <Heart color={color} size={ICON_SIZE} />,
        }}
      />
      <Tabs.Screen
        name="liked"
        options={{
          title: 'Dolap',
          tabBarIcon: ({ color }) => <Shirt color={color} size={ICON_SIZE} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profil',
          tabBarIcon: ({ color }) => <User color={color} size={ICON_SIZE} />,
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  bar: {
    backgroundColor: colors.input,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingHorizontal: spacing.sm,
  },
  item: {
    minHeight: 48,
  },
  icon: { width: 28, height: 28 },
  label: {
    fontSize: 11,
    lineHeight: 16,
    fontWeight: '600',
  },
  scene: {
    backgroundColor: colors.bgSoft,
  },
});
