// frontend/app/(tabs)/_layout.tsx
// TAB ORDER (left → right):
//   HOME | COACH | WORKOUT | PROGRESS | ME
//
// Changes from previous version:
//   • PRs tab removed from bottom bar (still accessible via screen if needed)
//   • PROGRESS is now 2nd-last (index 3)
//   • ME is now last (index 4)

import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../../src/theme/colors';

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: '#0A0A0A',
          borderTopColor: '#1A1A1A',
          borderTopWidth: 1,
          height: 60,
          paddingBottom: 8,
        },
        tabBarActiveTintColor: COLORS.primaryGreen,
        tabBarInactiveTintColor: '#444',
        tabBarLabelStyle: {
          fontSize: 10,
          fontFamily: 'Inter_600SemiBold',
          letterSpacing: 0.5,
        },
      }}
    >
      {/* 1 — HOME */}
      <Tabs.Screen
        name="index"
        options={{
          title: 'HOME',
          tabBarIcon: ({ color }) => (
            <Ionicons name="home-outline" size={22} color={color} />
          ),
        }}
      />

      {/* 2 — COACH */}
      <Tabs.Screen
        name="coach"
        options={{
          title: 'COACH',
          tabBarIcon: ({ color }) => (
            <Ionicons name="flash-outline" size={22} color={color} />
          ),
        }}
      />

      {/* 3 — WORKOUT */}
      <Tabs.Screen
        name="workout"
        options={{
          title: 'WORKOUT',
          tabBarIcon: ({ color }) => (
            <Ionicons name="barbell-outline" size={22} color={color} />
          ),
        }}
      />

      {/* 4 — PROGRESS (2nd-last) */}
      <Tabs.Screen
        name="progress"
        options={{
          title: 'PROGRESS',
          tabBarIcon: ({ color }) => (
            <Ionicons name="stats-chart-outline" size={22} color={color} />
          ),
        }}
      />

      {/* 5 — ME (last) ← moved from position 4 */}
      <Tabs.Screen
        name="profile"
        options={{
          title: 'ME',
          tabBarIcon: ({ color }) => (
            <Ionicons name="person-outline" size={22} color={color} />
          ),
        }}
      />

      {/* PRs screen — hidden from tab bar, still routable */}
      <Tabs.Screen
        name="prs"
        options={{
          href: null, // hides from tab bar
          title: 'PRs',
        }}
      />
    </Tabs>
  );
}