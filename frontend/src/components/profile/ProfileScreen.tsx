import React, { useEffect, useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  Alert, ActivityIndicator, Switch,
} from 'react-native';
import { router } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { profileApi } from '../../utils/api';
import { useStore } from '../../store';
import { COLORS } from '../../theme/colors';
import { storage } from '../../utils/storage';

export default function ProfileScreen() {
  const { user, profile, injuries, prs, setProfile, logout } = useStore();
  const [loading, setLoading] = useState(false);

  useEffect(() => { loadProfile(); }, []);

  const loadProfile = async () => {
    setLoading(true);
    try {
      const res = await profileApi.getMe();
      const d = res.data;
      setProfile(d.profile || {}, d.injuries || [], d.personal_records || []);
    } catch {}
    finally { setLoading(false); }
  };

  const handleLogout = async () => {
    Alert.alert('Log Out', 'Are you sure?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Log Out', style: 'destructive',
        onPress: async () => { await logout(); router.replace('/login'); },
      },
    ]);
  };

  const handleRedoOnboarding = () => {
    Alert.alert(
      'Redo Onboarding',
      'This will reset your profile setup. You can update your goal, diet, coach style and more. Continue?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Continue',
          onPress: async () => {
            await storage.removeItem('neurofit_onboarded');
            router.replace('/onboarding');
          },
        },
      ]
    );
  };

  const goalColors: Record<string, string> = {
    bulk: '#4CAF50', cut: '#FF4500', recomp: '#9C27B0', maintain: '#2196F3',
  };

  if (loading) {
    return <View style={styles.center}><ActivityIndicator color={COLORS.primaryGreen} size="large" /></View>;
  }

  return (
    <ScrollView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <LinearGradient colors={[COLORS.primaryGreen, '#1E3A5F']} style={styles.avatar}>
          <Text style={styles.avatarText}>
            {(user?.full_name || profile?.full_name || 'A').charAt(0).toUpperCase()}
          </Text>
        </LinearGradient>
        <Text style={styles.name}>{user?.full_name || profile?.full_name || 'Athlete'}</Text>
        <Text style={styles.email}>{user?.email}</Text>
        {profile?.goal && (
          <View style={[styles.goalBadge, { backgroundColor: (goalColors[profile.goal] || '#555') + '22' }]}>
            <Text style={[styles.goalText, { color: goalColors[profile.goal] || '#888' }]}>
              {profile.goal.toUpperCase()} PHASE · {profile.experience_level?.toUpperCase()}
            </Text>
          </View>
        )}
        {profile?.diet_type || profile?.food_preference ? (
          <View style={styles.dietBadge}>
            <Text style={styles.dietBadgeText}>
              {(profile.diet_type || profile.food_preference || '').toUpperCase()}
            </Text>
          </View>
        ) : null}
      </View>

      {/* Stats */}
      {profile?.weight_kg && (
        <View style={styles.statsRow}>
          <Stat label="WEIGHT" value={`${profile.weight_kg} kg`} />
          <Stat label="HEIGHT" value={`${profile.height_cm} cm`} />
          <Stat label="AGE" value={`${profile.age}`} />
        </View>
      )}

      {/* Personal Records */}
      {Object.keys(prs).length > 0 && (
        <View style={styles.card}>
          <View style={styles.cardLabelRow}>
            <Ionicons name="trophy-outline" size={13} color="#FFD700" />
            <Text style={styles.cardLabel}>PERSONAL RECORDS</Text>
          </View>
          {Object.entries(prs).map(([name, weight]) => (
            <View key={name} style={styles.prRow}>
              <Text style={styles.prName}>{name}</Text>
              <View style={styles.prRight}>
                <Text style={styles.prWeight}>{weight} kg</Text>
                <Ionicons name="trophy" size={12} color="#FFD700" />
              </View>
            </View>
          ))}
        </View>
      )}

      {/* Injuries */}
      {injuries.length > 0 && (
        <View style={styles.card}>
          <View style={styles.cardLabelRow}>
            <Ionicons name="shield-checkmark-outline" size={13} color="#FF4500" />
            <Text style={styles.cardLabel}>INJURY PROFILE</Text>
          </View>
          {injuries.map((inj: any, i: number) => (
            <View key={i} style={styles.injuryRow}>
              <View>
                <Text style={styles.injuryPart}>{inj.body_part}</Text>
                <Text style={styles.injuryType}>{inj.issue_type}</Text>
              </View>
              <View style={[styles.severityBadge, { backgroundColor: inj.severity >= 7 ? '#3A1A1A' : '#2A2A1A' }]}>
                <Text style={[styles.severityText, { color: inj.severity >= 7 ? '#FF4500' : COLORS.primaryGreen }]}>
                  {inj.severity}/10
                </Text>
              </View>
            </View>
          ))}
        </View>
      )}

      {/* Equipment */}
      {profile?.equipment?.length > 0 && (
        <View style={styles.card}>
          <View style={styles.cardLabelRow}>
            <Ionicons name="barbell-outline" size={13} color="#4CAF50" />
            <Text style={styles.cardLabel}>EQUIPMENT</Text>
          </View>
          <View style={styles.tagsRow}>
            {profile.equipment.map((e: string, i: number) => (
              <View key={i} style={styles.tag}>
                <Text style={styles.tagText}>{e}</Text>
              </View>
            ))}
          </View>
        </View>
      )}

      {/* ── SETTINGS ── */}
      <View style={styles.settingsHeader}>
        <Ionicons name="settings-outline" size={14} color="#555" />
        <Text style={styles.settingsHeaderText}>SETTINGS</Text>
      </View>

      <View style={styles.settingsCard}>
        <SettingsRow
          icon="refresh-outline"
          label="Redo Onboarding"
          sub="Update goal, diet, coach style & more"
          onPress={handleRedoOnboarding}
          color={COLORS.primaryGreen}
        />
        <View style={styles.settingsDivider} />
        <SettingsRow
          icon="notifications-outline"
          label="Notifications"
          sub="Coming soon"
          onPress={() => Alert.alert('Coming soon', 'Notification settings will be available in the next update.')}
          color="#60A5FA"
        />
        <View style={styles.settingsDivider} />
        <SettingsRow
          icon="shield-outline"
          label="Privacy & Data"
          sub="Your data stays private"
          onPress={() => Alert.alert('Privacy', 'NeuroFit AI stores your data securely in Supabase. We never sell your data.')}
          color="#FBBF24"
        />
      </View>

      <TouchableOpacity style={styles.logoutBtn} onPress={handleLogout}>
        <Ionicons name="log-out-outline" size={16} color="#FF4500" />
        <Text style={styles.logoutText}>Log Out</Text>
      </TouchableOpacity>

      <View style={{ height: 32 }} />
    </ScrollView>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function SettingsRow({ icon, label, sub, onPress, color }: {
  icon: string; label: string; sub: string; onPress: () => void; color: string;
}) {
  return (
    <TouchableOpacity style={styles.settingsRow} onPress={onPress}>
      <View style={[styles.settingsIcon, { backgroundColor: color + '20' }]}>
        <Ionicons name={icon as any} size={16} color={color} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.settingsLabel}>{label}</Text>
        <Text style={styles.settingsSub}>{sub}</Text>
      </View>
      <Ionicons name="chevron-forward" size={16} color="#333" />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#121212' },
  center: { flex: 1, backgroundColor: '#121212', justifyContent: 'center', alignItems: 'center' },
  header: { alignItems: 'center', paddingTop: 60, paddingBottom: 24, paddingHorizontal: 20 },
  avatar: { width: 80, height: 80, borderRadius: 40, alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  avatarText: { color: '#121212', fontSize: 32, fontFamily: 'Inter_700Bold' },
  name: { color: '#FFF', fontSize: 22, fontFamily: 'Inter_700Bold', marginBottom: 4 },
  email: { color: '#555', fontSize: 13, fontFamily: 'Inter_400Regular', marginBottom: 12 },
  goalBadge: { borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6, marginBottom: 6 },
  goalText: { fontSize: 11, fontFamily: 'Inter_700Bold', letterSpacing: 1 },
  dietBadge: { backgroundColor: '#1A1A2A', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 4 },
  dietBadgeText: { color: '#60A5FA', fontSize: 10, fontFamily: 'Inter_700Bold', letterSpacing: 1 },
  statsRow: { flexDirection: 'row', justifyContent: 'space-around', marginHorizontal: 16, marginBottom: 16, backgroundColor: '#1E1E1E', borderRadius: 16, padding: 16, borderWidth: 1, borderColor: '#2A2A2A' },
  stat: { alignItems: 'center' },
  statValue: { color: '#FFF', fontSize: 18, fontFamily: 'Inter_700Bold' },
  statLabel: { color: '#555', fontSize: 11, fontFamily: 'Inter_400Regular', marginTop: 2, letterSpacing: 0.5 },
  card: { backgroundColor: '#1E1E1E', borderRadius: 16, padding: 16, marginHorizontal: 16, marginBottom: 12, borderWidth: 1, borderColor: '#2A2A2A' },
  cardLabel: { color: '#555', fontSize: 11, fontFamily: 'Inter_700Bold', letterSpacing: 1.5, marginBottom: 12 },
  cardLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 12 },
  prRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#2A2A2A' },
  prRight: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  prName: { color: '#C0C0C0', fontSize: 14, fontFamily: 'Inter_400Regular' },
  prWeight: { color: '#FFD700', fontSize: 14, fontFamily: 'Inter_700Bold' },
  injuryRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#2A2A2A' },
  injuryPart: { color: '#C0C0C0', fontSize: 14, fontFamily: 'Inter_600SemiBold' },
  injuryType: { color: '#888', fontSize: 12, fontFamily: 'Inter_400Regular', marginTop: 2 },
  severityBadge: { borderRadius: 8, padding: 6 },
  severityText: { fontSize: 12, fontFamily: 'Inter_700Bold' },
  tagsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tag: { backgroundColor: '#252525', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 },
  tagText: { color: '#888', fontSize: 12, fontFamily: 'Inter_400Regular' },
  settingsHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginHorizontal: 16, marginBottom: 8, marginTop: 8 },
  settingsHeaderText: { color: '#555', fontSize: 11, fontFamily: 'Inter_700Bold', letterSpacing: 1.5 },
  settingsCard: { backgroundColor: '#1E1E1E', borderRadius: 16, marginHorizontal: 16, marginBottom: 12, borderWidth: 1, borderColor: '#2A2A2A' },
  settingsRow: { flexDirection: 'row', alignItems: 'center', padding: 16, gap: 12 },
  settingsIcon: { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  settingsLabel: { color: '#FFF', fontSize: 14, fontFamily: 'Inter_600SemiBold' },
  settingsSub: { color: '#555', fontSize: 12, fontFamily: 'Inter_400Regular', marginTop: 1 },
  settingsDivider: { height: 1, backgroundColor: '#2A2A2A', marginLeft: 62 },
  logoutBtn: { margin: 16, backgroundColor: '#1A1A1A', borderRadius: 14, padding: 16, alignItems: 'center', borderWidth: 1, borderColor: '#3A2020', flexDirection: 'row', justifyContent: 'center', gap: 8 },
  logoutText: { color: '#FF4500', fontSize: 14, fontFamily: 'Inter_600SemiBold' },
});