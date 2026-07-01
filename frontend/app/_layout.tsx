import { useEffect, useState } from 'react';
import { Tabs, router } from 'expo-router';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { storage } from '../src/utils/storage';
import { COLORS } from '../src/theme/colors';

type TabDef = {
  name: string;
  title: string;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  activeIcon: React.ComponentProps<typeof Ionicons>['name'];
};

// ── 5-tab nav — Decisions, Simulate, Form AI moved to Dashboard cards ──
// Eight tabs was too many; 4-5 is the mobile-nav sweet spot. The removed
// tabs are still real screens — they're now reachable via the Quick Start
// grid and new dashboard feature cards on the Home tab instead of a
// permanent bottom slot. This frees up visible space and makes the nav
// instantly scannable.
const TABS: TabDef[] = [
  { name: 'index',    title: 'HOME',      icon: 'home-outline',        activeIcon: 'home'        },
  { name: 'coach',   title: 'COACH',     icon: 'flash-outline',       activeIcon: 'flash'       },
  { name: 'workout', title: 'WORKOUT',   icon: 'barbell-outline',     activeIcon: 'barbell'     },
  { name: 'progress', title: 'PROGRESS', icon: 'stats-chart-outline', activeIcon: 'stats-chart' },
  { name: 'profile', title: 'PROFILE',   icon: 'person-outline',      activeIcon: 'person'      },
];

// Hidden tabs — still routable via router.push(), just not in the bar
const HIDDEN_TABS = ['decisions', 'simulate', 'formanalysis', 'prs'];

export default function TabsLayout() {
  const [authChecked, setAuthChecked] = useState(false);

  useEffect(() => {
    (async () => {
      const token = await storage.getItem('vyrn_token');
      if (!token) {
        router.replace('/login');
        return;
      }
      setAuthChecked(true);
    })()
  }, []);

  if (!authChecked) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={COLORS.primaryGreen} size="large" />
      </View>
    );
  }

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: COLORS.tabBg,
          borderTopColor: COLORS.tabBorder,
          borderTopWidth: 1,
          paddingBottom: 10,
          paddingTop: 8,
          height: 66,
          elevation: 0,
          shadowOpacity: 0,
        },
        tabBarActiveTintColor: COLORS.tabActive,
        tabBarInactiveTintColor: COLORS.tabInactive,
        tabBarLabelStyle: {
          fontSize: 9,
          fontWeight: '700',
          letterSpacing: 0.6,
          marginTop: 2,
        },
        tabBarHideOnKeyboard: true,
      }}
    >
      {TABS.map((t) => (
        <Tabs.Screen
          key={t.name}
          name={t.name}
          options={{
            title: t.title,
            tabBarIcon: ({ color, focused }) => (
              <View style={focused ? styles.activeWrap : styles.iconWrap}>
                <Ionicons
                  name={focused ? t.activeIcon : t.icon}
                  size={22}
                  color={color}
                />
              </View>
            ),
          }}
        />
      ))}
      {/* Hidden tabs — routable but not visible in the bottom bar */}
      {HIDDEN_TABS.map((name) => (
        <Tabs.Screen
          key={name}
          name={name}
          options={{ href: null }}
        />
      ))}
    </Tabs>
  );
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    backgroundColor: COLORS.background,
    justifyContent: 'center',
    alignItems: 'center',
  },
  iconWrap: { padding: 4 },
  activeWrap: {
    padding: 6,
    backgroundColor: COLORS.primaryGreen + '20',
    borderRadius: 10,
  },
});