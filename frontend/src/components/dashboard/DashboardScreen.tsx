import React, { useEffect, useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  RefreshControl,
} from 'react-native';
import { progressApi } from '../../utils/api';
import { useStore } from '../../store';

export default function DashboardScreen({ navigation }: any) {
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

  const fatigueBg = cnsFatigue >= 7 ? '#3A1A1A' : cnsFatigue >= 4 ? '#2A2A1A' : '#1A2A1A';
  const fatigueColor = cnsFatigue >= 7 ? '#FF4500' : cnsFatigue >= 4 ? '#FFD700' : '#4CAF50';
  const fatigueLabel = cnsFatigue >= 7 ? 'HIGH — Reduce Volume' : cnsFatigue >= 4 ? 'MODERATE' : 'FRESH';

  return (
    <ScrollView
      style={styles.container}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#FFD700" />}
    >
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.greeting}>
          {new Date().getHours() < 12 ? 'Good morning' : 'Good evening'},{'\n'}
          {user?.full_name?.split(' ')[0] || 'Athlete'} 👊
        </Text>
        {profile?.goal && (
          <View style={styles.phaseBadge}>
            <Text style={styles.phaseText}>{profile.goal.toUpperCase()} PHASE</Text>
          </View>
        )}
      </View>

      {/* CNS Fatigue */}
      <View style={[styles.card, { backgroundColor: fatigueBg }]}>
        <Text style={styles.cardLabel}>CNS FATIGUE INDEX</Text>
        <View style={styles.fatigueRow}>
          <Text style={[styles.fatigueScore, { color: fatigueColor }]}>{cnsFatigue}</Text>
          <Text style={styles.fatigueDenom}>/10</Text>
          <View style={styles.fatigueSpacer} />
          <Text style={[styles.fatigueLabel, { color: fatigueColor }]}>{fatigueLabel}</Text>
        </View>
        <View style={styles.fatigueBar}>
          <View style={[styles.fatigueBarFill, { width: `${cnsFatigue * 10}%`, backgroundColor: fatigueColor }]} />
        </View>
      </View>

      {/* Today's Macros */}
      {macros && (
        <View style={styles.card}>
          <Text style={styles.cardLabel}>TODAY'S TARGETS</Text>
          <View style={styles.macroRow}>
            <MacroChip label="CALORIES" value={`${macros.calories}`} unit="kcal" color="#FFD700" />
            <MacroChip label="PROTEIN" value={`${macros.protein_g}g`} unit="" color="#FF4500" />
            <MacroChip label="CARBS" value={`${macros.carbs_g}g`} unit="" color="#4CAF50" />
            <MacroChip label="FAT" value={`${macros.fat_g}g`} unit="" color="#2196F3" />
          </View>
          <Text style={styles.waterTarget}>💧 Water: {(macros.water_ml / 1000).toFixed(1)}L</Text>
        </View>
      )}

      {/* Quick Actions */}
      <Text style={styles.sectionLabel}>QUICK START</Text>
      <View style={styles.quickGrid}>
        <QuickBtn label="Ask Coach" icon="🦅" onPress={() => navigation.navigate('Coach')} accent="#FFD700" />
        <QuickBtn label="Start Workout" icon="🏋️" onPress={() => navigation.navigate('Coach')} accent="#FF4500" />
        <QuickBtn label="Log Progress" icon="📊" onPress={() => navigation.navigate('Progress')} accent="#4CAF50" />
        <QuickBtn label="My PRs" icon="🏆" onPress={() => navigation.navigate('Profile')} accent="#9C27B0" />
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
    </ScrollView>
  );
}

const MacroChip = ({ label, value, unit, color }: any) => (
  <View style={styles.macroChip}>
    <Text style={[styles.macroValue, { color }]}>{value}</Text>
    <Text style={styles.macroLabel}>{label}</Text>
  </View>
);

const QuickBtn = ({ label, icon, onPress, accent }: any) => (
  <TouchableOpacity style={[styles.quickBtn, { borderColor: accent + '44' }]} onPress={onPress}>
    <Text style={styles.quickIcon}>{icon}</Text>
    <Text style={styles.quickLabel}>{label}</Text>
  </TouchableOpacity>
);

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#121212' },
  header: {
    padding: 24,
    paddingTop: 60,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  greeting: { color: '#FFFFFF', fontSize: 22, fontWeight: '700', lineHeight: 30 },
  phaseBadge: { backgroundColor: '#1E3A5F', borderRadius: 8, padding: 8 },
  phaseText: { color: '#FFD700', fontSize: 10, fontWeight: '700', letterSpacing: 1 },
  card: {
    backgroundColor: '#1E1E1E',
    borderRadius: 16,
    padding: 16,
    marginHorizontal: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#2A2A2A',
  },
  cardLabel: { color: '#555', fontSize: 11, fontWeight: '700', letterSpacing: 1.5, marginBottom: 12 },
  fatigueRow: { flexDirection: 'row', alignItems: 'baseline', marginBottom: 10 },
  fatigueScore: { fontSize: 40, fontWeight: '800' },
  fatigueDenom: { color: '#555', fontSize: 20, marginLeft: 2 },
  fatigueSpacer: { flex: 1 },
  fatigueLabel: { fontSize: 13, fontWeight: '700', letterSpacing: 1 },
  fatigueBar: { height: 6, backgroundColor: '#2A2A2A', borderRadius: 3, overflow: 'hidden' },
  fatigueBarFill: { height: '100%', borderRadius: 3 },
  macroRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10 },
  macroChip: { alignItems: 'center', flex: 1 },
  macroValue: { fontSize: 18, fontWeight: '700' },
  macroLabel: { color: '#555', fontSize: 10, marginTop: 2, letterSpacing: 0.5 },
  waterTarget: { color: '#888', fontSize: 13 },
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
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginHorizontal: 16,
    gap: 8,
    marginBottom: 12,
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
  quickIcon: { fontSize: 24 },
  quickLabel: { color: '#C0C0C0', fontSize: 13, fontWeight: '600' },
  prRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#2A2A2A',
  },
  prName: { color: '#C0C0C0', fontSize: 14 },
  prWeight: { color: '#FFD700', fontSize: 14, fontWeight: '700' },
});
