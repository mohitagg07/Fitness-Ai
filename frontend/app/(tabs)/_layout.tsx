import { useEffect, useState } from 'react';
import { Tabs, router } from 'expo-router';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { storage } from '../../src/utils/storage';
import { COLORS } from '../../src/theme/colors';

type TabDef = {
  name: string;
  title: string;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  activeIcon: React.ComponentProps<typeof Ionicons>['name'];
};

const TABS: TabDef[] = [
  { name: 'index',    title: 'HOME',    icon: 'home-outline',         activeIcon: 'home'         },
  { name: 'coach',   title: 'COACH',   icon: 'flash-outline',        activeIcon: 'flash'        },
  { name: 'workout', title: 'WORKOUT', icon: 'barbell-outline',      activeIcon: 'barbell'      },
  { name: 'progress',title: 'PROGRESS',icon: 'stats-chart-outline',  activeIcon: 'stats-chart'  },
  { name: 'profile', title: 'PROFILE', icon: 'person-outline',       activeIcon: 'person'       },
];

export default function TabsLayout() {
  const [authChecked, setAuthChecked] = useState(false);

  useEffect(() => {
    let settled = false;

    // Safety net: if anything in the check below hangs or throws without
    // being caught, this guarantees the screen never sits on the spinner
    // forever with zero console output and zero network request — exactly
    // the failure mode that was previously invisible from the outside.
    const safetyTimer = setTimeout(() => {
      if (!settled) {
        settled = true;
        console.warn('[TabsLayout] Auth check timed out after 5s — redirecting to /login');
        router.replace('/login');
      }
    }, 5000);

    (async () => {
      try {
        const token = await storage.getItem('neurofit_token');
        if (settled) return;
        if (!token) {
          settled = true;
          clearTimeout(safetyTimer);
          router.replace('/login');
          return;
        }
        settled = true;
        clearTimeout(safetyTimer);
        setAuthChecked(true);
      } catch (err) {
        if (settled) return;
        settled = true;
        clearTimeout(safetyTimer);
        console.warn('[TabsLayout] Auth check threw an error:', err);
        router.replace('/login');
      }
    })();

    return () => {
      settled = true;
      clearTimeout(safetyTimer);
    };
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
          letterSpacing: 0.8,
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
                  size={21}
                  color={color}
                />
              </View>
            ),
          }}
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
