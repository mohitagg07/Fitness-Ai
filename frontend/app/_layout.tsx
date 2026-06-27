/**
 * app/(tabs)/_layout.tsx — Tab bar layout
 *
 * Auth is handled entirely by app/index.tsx — no token means the user
 * never reaches this layout in the first place. A second guard here
 * creates a race condition: the 5s safety timer fires before SecureStore
 * resolves on slower devices, kicking the user back to /login mid-session
 * and leaving a blank screen.
 */
import { Tabs } from 'expo-router';
import { View, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../src/theme/colors';

type TabDef = {
  name: string;
  title: string;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  activeIcon: React.ComponentProps<typeof Ionicons>['name'];
};

const TABS: TabDef[] = [
  { name: 'index',    title: 'HOME',    icon: 'home-outline',        activeIcon: 'home'        },
  { name: 'coach',   title: 'COACH',   icon: 'flash-outline',       activeIcon: 'flash'       },
  { name: 'workout', title: 'WORKOUT', icon: 'barbell-outline',     activeIcon: 'barbell'     },
  { name: 'progress',title: 'PROGRESS',icon: 'stats-chart-outline', activeIcon: 'stats-chart' },
  { name: 'profile', title: 'PROFILE', icon: 'person-outline',      activeIcon: 'person'      },
];

export default function TabsLayout() {
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
  iconWrap: { padding: 4 },
  activeWrap: {
    padding: 6,
    backgroundColor: COLORS.primaryGreen + '20',
    borderRadius: 10,
  },
});
