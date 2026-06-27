/**
 * app/(tabs)/_layout.tsx — Tab bar layout (tab bar hidden)
 *
 * Navigation between sections is handled by custom buttons in each screen.
 * The tab bar is hidden — we keep the Tabs navigator for routing only.
 */
import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { View, StyleSheet } from 'react-native';
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
        tabBarStyle: { display: 'none' },
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
