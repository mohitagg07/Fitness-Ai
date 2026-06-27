/**
 * app/(tabs)/_layout.tsx — Tab bar layout
 * Beautiful pill-style active indicator, 5 tabs including PR board.
 */
import { Tabs } from 'expo-router';
import { View, StyleSheet, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../../src/theme/colors';

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
  { name: 'prs',     title: 'PRs',     icon: 'trophy-outline',      activeIcon: 'trophy'      },
  { name: 'profile', title: 'ME',      icon: 'person-outline',      activeIcon: 'person'      },
];

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: '#0A0A0A',
          borderTopColor: '#1A1A1A',
          borderTopWidth: 1,
          paddingBottom: Platform.OS === 'ios' ? 20 : 10,
          paddingTop: 8,
          height: Platform.OS === 'ios' ? 82 : 66,
          elevation: 0,
          shadowOpacity: 0,
        },
        tabBarActiveTintColor: COLORS.primaryGreen,
        tabBarInactiveTintColor: '#3A3A3A',
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
              <View style={[styles.iconWrap, focused && styles.activeWrap]}>
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
  iconWrap: {
    width: 40, height: 32,
    alignItems: 'center', justifyContent: 'center',
    borderRadius: 10,
  },
  activeWrap: {
    backgroundColor: COLORS.primaryGreen + '18',
    borderWidth: 1,
    borderColor: COLORS.primaryGreen + '30',
  },
});
