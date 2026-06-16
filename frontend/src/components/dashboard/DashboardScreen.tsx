// NeuroFit AI — Dashboard Screen
// All emojis replaced with @expo/vector-icons (Ionicons) for consistent
// cross-platform rendering and the updated NeuroFit AI branding.

import React, { useEffect, useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  RefreshControl,
} from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { progressApi } from '../../utils/api';
import { useStore } from '../../store';

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

export default function DashboardScreen() {
  const { user, profile, cnsFatigue, prs } = useStore();
  const [macros, setMacros] = useState<any>(null);
  const [refreshing, setRefreshing] = useState(false);

  const loadData = async () => {
    try {
      const res = await progressApi.getNutritionTargets(true);
      setMacros(res.data);
    } catch {}
  };

  useEffect(() => { loadData(); }, []);

  const onRefresh = async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  };

  const hour = new Date().getHours();
  const greeting =
    hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const firstName =
    user?.full_name?.split(' ')[0] ||
    profile?.full_name?.split(' ')[0] ||
    'Athlete';

  const fatigueBg =
    cnsFatigue >= 7 ? '#3A1A1A' : cnsFatigue >= 4 ? '#2A2A1A' : '#1A2A1A';
  const fatigueColor =
    cnsFatigue >= 7 ? '#FF4500' : cnsFatigue >= 4 ? '#FFD700' : '#4CAF50';
  const fatigueLabel =
    cnsFatigue >= 7 ? 'HIGH — Reduce Volume' : cnsFatigue >= 4 ? 'MODERATE' : 'FRESH';

  return (
    <ScrollView
      style={styles.container}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#FFD700" />
      }
    >
      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.greeting}>{greeting},</Text>
          <Text style={styles.name}>{firstName}</Text>
        </View>
        {profile?.goal && (
          <View style={styles.phaseBadge}>
            <Text style={styles.phaseText}>{profile.goal.toUpperCase()} PHASE</Text>
          </View>
        )}
      </View>

      {/* AI Feed Card */}
      <View style={styles.feedCard}>
        <View style={styles.feedLabelRow}>
          <Ionicons name="flash" size={12} color="#FFD700" />
          <Text style={styles.feedLabel}>AI COACH</Text>
        </View>
        <Text style={styles.feedText}>
          {cnsFatigue >= 7
            ? 'High CNS fatigue detected. Today is a recovery day — light work only.'
            : "You're looking fresh. Ask me for today's workout anytime."}
        </Text>
        <TouchableOpacity
          style={styles.feedBtn}
          onPress={() => router.push('/(tabs)/coach')}
        >
          <Text style={styles.feedBtnText}>Open Coach</Text>
          <Ionicons name="arrow-forward" size={14} color="#FFD700" />
        </TouchableOpacity>
      </View>

      {/* CNS Fatigue */}
      <View style={[styles.card, { backgroundColor: fatigueBg }]}>
        <Text style={styles.cardLabel}>CNS FATIGUE INDEX</Text>
        <View style={styles.fatigueRow}>
          <Text style={[styles.fatigueScore, { color: fatigueColor }]}>{cnsFatigue}</Text>
          <Text style={styles.fatigueDenom}>/10</Text>
          <View style={{ flex: 1 }} />
          <Text style={[styles.fatigueLabel, { color: fatigueColor }]}>{fatigueLabel}</Text>
        </View>
        <View style={styles.fatigueBar}>
          <View
            style={[
              styles.fatigueBarFill,
              { width: `${cnsFatigue * 10}%`, backgroundColor: fatigueColor },
            ]}
          />
        </View>
      </View>

      {/* Today's Macros */}
      {macros && (
        <View style={styles.card}>
          <Text style={styles.cardLabel}>TODAY'S TARGETS</Text>
          <View style={styles.macroRow}>
            <MacroChip label="CALORIES" value={`${macros.calories}`}    color="#FFD700" />
            <MacroChip label="PROTEIN"  value={`${macros.protein_g}g`}  color="#FF4500" />
            <MacroChip label="CARBS"    value={`${macros.carbs_g}g`}    color="#4CAF50" />
            <MacroChip label="FAT"      value={`${macros.fat_g}g`}      color="#2196F3" />
          </View>
          <View style={styles.waterRow}>
            <Ionicons name="water-outline" size={14} color="#2196F3" />
            <Text style={styles.water}>
              {' '}Water target: {(macros.water_ml / 1000).toFixed(1)}L
            </Text>
          </View>
        </View>
      )}

      {/* Quick Actions */}
      <Text style={styles.sectionLabel}>QUICK START</Text>
      <View style={styles.quickGrid}>
        <QuickBtn
          label="Ask Coach"
          icon="chatbubble-outline"
          onPress={() => router.push('/(tabs)/coach')}
          accent="#FFD700"
        />
        <QuickBtn
          label="Gym Mode"
          icon="barbell-outline"
          onPress={() => router.push('/(tabs)/workout')}
          accent="#FF4500"
        />
        <QuickBtn
          label="Progress"
          icon="stats-chart-outline"
          onPress={() => router.push('/(tabs)/progress')}
          accent="#4CAF50"
        />
        <QuickBtn
          label="My PRs"
          icon="trophy-outline"
          onPress={() => router.push('/(tabs)/profile')}
          accent="#9C27B0"
        />
      </View>

      {/* Top PRs */}
      {Object.keys(prs).length > 0 && (
        <>
          <Text style={styles.sectionLabel}>PERSONAL RECORDS</Text>
          <View style={styles.card}>
            {Object.entries(prs).slice(0, 5).map(([name, weight]) => (
              <View key={name} style={styles.prRow}>
                <Text style={styles.prName}>{name}</Text>
                <Text style={styles.prWeight}>{weight} kg</Text>
              </View>
            ))}
          </View>
        </>
      )}

      <View style={{ height: 24 }} />
    </ScrollView>
  );
}

function MacroChip({
  label, value, color,
}: {
  label: string; value: string; color: string;
}) {
  return (
    <View style={styles.macroChip}>
      <Text style={[styles.macroValue, { color }]}>{value}</Text>
      <Text style={styles.macroLabel}>{label}</Text>
    </View>
  );
}

function QuickBtn({
  label, icon, onPress, accent,
}: {
  label: string; icon: IoniconName; onPress: () => void; accent: string;
}) {
  return (
    <TouchableOpacity
      style={[styles.quickBtn, { borderColor: accent + '44' }]}
      onPress={onPress}
    >
      <Ionicons name={icon} size={24} color={accent} />
      <Text style={styles.quickLabel}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#121212' },
  header: {
    padding: 24,
    paddingTop: 60,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  greeting: { color: '#888', fontSize: 14 },
  name: { color: '#FFF', fontSize: 24, fontWeight: '800' },
  phaseBadge: {
    backgroundColor: '#1E3A5F', borderRadius: 8, padding: 8, marginTop: 4,
  },
  phaseText: { color: '#FFD700', fontSize: 10, fontWeight: '700', letterSpacing: 1 },
  feedCard: {
    margin: 16,
    marginTop: 0,
    backgroundColor: '#1A2535',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#1E3A5F',
  },
  feedLabelRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 8, gap: 6 },
  feedLabel: {
    color: '#FFD700', fontSize: 10, fontWeight: '700', letterSpacing: 1.5,
  },
  feedText: { color: '#C0C8D4', fontSize: 14, lineHeight: 20, marginBottom: 12 },
  feedBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start',
  },
  feedBtnText: { color: '#FFD700', fontSize: 13, fontWeight: '600' },
  card: {
    backgroundColor: '#1E1E1E',
    borderRadius: 16,
    padding: 16,
    marginHorizontal: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#2A2A2A',
  },
  cardLabel: {
    color: '#555', fontSize: 11, fontWeight: '700', letterSpacing: 1.5, marginBottom: 12,
  },
  fatigueRow: { flexDirection: 'row', alignItems: 'baseline', marginBottom: 10 },
  fatigueScore: { fontSize: 40, fontWeight: '800' },
  fatigueDenom: { color: '#555', fontSize: 20, marginLeft: 2 },
  fatigueLabel: { fontSize: 13, fontWeight: '700', letterSpacing: 1 },
  fatigueBar: { height: 6, backgroundColor: '#2A2A2A', borderRadius: 3, overflow: 'hidden' },
  fatigueBarFill: { height: '100%', borderRadius: 3 },
  macroRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10 },
  macroChip: { alignItems: 'center', flex: 1 },
  macroValue: { fontSize: 18, fontWeight: '700' },
  macroLabel: { color: '#555', fontSize: 10, marginTop: 2, letterSpacing: 0.5 },
  waterRow: { flexDirection: 'row', alignItems: 'center' },
  water: { color: '#888', fontSize: 13 },
  sectionLabel: {
    color: '#555',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.5,
    marginHorizontal: 16,
    marginBottom: 8,
    marginTop: 8,
  },
  quickGrid: {
    flexDirection: 'row', flexWrap: 'wrap',
    marginHorizontal: 16, gap: 8, marginBottom: 12,
  },
  quickBtn: {
    width: '47%',
    backgroundColor: '#1E1E1E',
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    alignItems: 'center',
    gap: 6,
  },
  quickLabel: { color: '#C0C0C0', fontSize: 13, fontWeight: '600' },
  prRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#2A2A2A',
  },
  prName: { color: '#C0C0C0', fontSize: 14 },
  prWeight: { color: '#FFD700', fontSize: 14, fontWeight: '700' },
});