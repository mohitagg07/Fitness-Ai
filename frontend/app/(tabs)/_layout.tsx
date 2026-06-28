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
        tabBarLabelStyle: { fontSize: 10, fontFamily: 'Inter_600SemiBold', letterSpacing: 0.5 },
      }}
    >
      <Tabs.Screen name="index"    options={{ title: 'HOME',     tabBarIcon: ({ color }) => <Ionicons name="home-outline"        size={22} color={color} /> }} />
      <Tabs.Screen name="coach"    options={{ title: 'COACH',    tabBarIcon: ({ color }) => <Ionicons name="flash-outline"       size={22} color={color} /> }} />
      <Tabs.Screen name="workout"  options={{ title: 'WORKOUT',  tabBarIcon: ({ color }) => <Ionicons name="barbell-outline"     size={22} color={color} /> }} />
      <Tabs.Screen name="progress" options={{ title: 'PROGRESS', tabBarIcon: ({ color }) => <Ionicons name="stats-chart-outline" size={22} color={color} /> }} />
      <Tabs.Screen name="profile"  options={{ title: 'ME',       tabBarIcon: ({ color }) => <Ionicons name="person-outline"     size={22} color={color} /> }} />
    </Tabs>
  );
}