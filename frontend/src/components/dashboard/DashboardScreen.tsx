import React, { useEffect, useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  RefreshControl,
} from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { progressApi } from '../../utils/api';
import { useStore } from '../../store';
import { colors, radius, spacing, shadow } from '../../theme';

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

  const fatigueBg = cnsFatigue >= 7 ? colors.dangerSoft : cnsFatigue >= 4 ? colors.warningSoft : colors.successSoft;
  const fatigueColor = cnsFatigue >= 7 ? colors.fatigueHigh : cnsFatigue >= 4 ? colors.fatigueMid : colors.fatigueLow;
  const fatigueLabel = cnsFatigue >= 7 ? 'High — Reduce Volume' : cnsFatigue >= 4 ? 'Moderate' : 'Fresh';

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.scrollContent}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
    >
      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.greetingSmall}>
            {new Date().getHours() < 12 ? 'Good morning' : 'Good evening'}
          </Text>
          <View style={styles.nameRow}>
            <Text style={styles.greeting}>{user?.full_name?.split(' ')[0] || 'Athlete'}</Text>
            <Ionicons name="flame" size={22} color={colors.primary} style={{ marginLeft: 6 }} />
          </View>
        </View>
        {profile?.goal && (
          <View style={styles.phaseBadge}>
            <Text style={styles.phaseText}>{profile.goal.toUpperCase()}</Text>
          </View>
        )}
      </View>

      {/* CNS Fatigue */}
      <View style={[styles.card, { backgroundColor: fatigueBg, borderColor: 'transparent' }]}>
        <View style={styles.cardLabelRow}>
          <MaterialCommunityIcons name="pulse" size={14} color={colors.textSecondary} />
          <Text style={styles.cardLabel}>CNS Fatigue Index</Text>
        </View>
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
          <View style={styles.cardLabelRow}>
            <Ionicons name="nutrition-outline" size={14} color={colors.textSecondary} />
            <Text style={styles.cardLabel}>Today's Targets</Text>
          </View>
          <View style={styles.macroRow}>
            <MacroChip label="Calories" value={`${macros.calories}`} color={colors.primary} />
            <MacroChip label="Protein" value={`${macros.protein_g}g`} color={colors.danger} />
            <MacroChip label="Carbs" value={`${macros.carbs_g}g`} color={colors.success} />
            <MacroChip label="Fat" value={`${macros.fat_g}g`} color={colors.secondary} />
          </View>
          <View style={styles.waterRow}>
            <Ionicons name="water-outline" size={14} color={colors.secondary} />
            <Text style={styles.waterTarget}>Water target: {(macros.water_ml / 1000).toFixed(1)}L</Text>
          </View>
        </View>
      )}

      {/* Quick Actions */}
      <Text style={styles.sectionLabel}>Quick Start</Text>
      <View style={styles.quickGrid}>
        <QuickBtn label="Ask Coach" iconLib="ion" icon="chatbubble-ellipses-outline" onPress={() => navigation.navigate('Coach')} accent={colors.primary} />
        <QuickBtn label="Start Workout" iconLib="mci" icon="weight-lifter" onPress={() => navigation.navigate('Coach')} accent={colors.secondary} />
        <QuickBtn label="Log Progress" iconLib="ion" icon="bar-chart-outline" onPress={() => navigation.navigate('Progress')} accent={colors.success} />
        <QuickBtn label="My PRs" iconLib="ion" icon="trophy-outline" onPress={() => navigation.navigate('Profile')} accent={colors.warning} />
      </View>

      {/* Top PRs */}
      {Object.keys(prs).length > 0 && (
        <>
          <Text style={styles.sectionLabel}>Personal Records</Text>
          <View style={styles.card}>
            {Object.entries(prs).slice(0, 5).map(([name, weight], idx, arr) => (
              <View key={name} style={[styles.prRow, idx === arr.length - 1 && { borderBottomWidth: 0 }]}>
                <View style={styles.prNameRow}>
                  <Ionicons name="medal-outline" size={16} color={colors.warning} />
                  <Text style={styles.prName}>{name}</Text>
                </View>
                <Text style={styles.prWeight}>{weight} kg</Text>
              </View>
            ))}
          </View>
        </>
      )}
    </ScrollView>
  );
}

const MacroChip = ({ label, value, color }: any) => (
  <View style={styles.macroChip}>
    <Text style={[styles.macroValue, { color }]}>{value}</Text>
    <Text style={styles.macroLabel}>{label}</Text>
  </View>
);

const QuickBtn = ({ label, icon, iconLib, onPress, accent }: any) => {
  const IconComponent = iconLib === 'mci' ? MaterialCommunityIcons : Ionicons;
  return (
    <TouchableOpacity style={styles.quickBtn} onPress={onPress} activeOpacity={0.85}>
      <View style={[styles.quickIconWrap, { backgroundColor: accent + '1A' }]}>
        <IconComponent name={icon} size={22} color={accent} />
      </View>
      <Text style={styles.quickLabel}>{label}</Text>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  scrollContent: { paddingBottom: 32 },
  header: {
    padding: spacing.xl,
    paddingTop: 60,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  greetingSmall: { color: colors.textMuted, fontSize: 13, marginBottom: 2 },
  nameRow: { flexDirection: 'row', alignItems: 'center' },
  greeting: { color: colors.textPrimary, fontSize: 26, fontWeight: '800' },
  phaseBadge: { backgroundColor: colors.secondarySoft, borderRadius: radius.pill, paddingHorizontal: 12, paddingVertical: 6 },
  phaseText: { color: colors.secondary, fontSize: 11, fontWeight: '800', letterSpacing: 1 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadow.card,
  },
  cardLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: spacing.md },
  cardLabel: { color: colors.textSecondary, fontSize: 12, fontWeight: '700', letterSpacing: 0.8 },
  fatigueRow: { flexDirection: 'row', alignItems: 'baseline', marginBottom: 10 },
  fatigueScore: { fontSize: 40, fontWeight: '800' },
  fatigueDenom: { color: colors.textMuted, fontSize: 20, marginLeft: 2 },
  fatigueSpacer: { flex: 1 },
  fatigueLabel: { fontSize: 13, fontWeight: '700', letterSpacing: 0.5 },
  fatigueBar: { height: 6, backgroundColor: '#FFFFFF99', borderRadius: 3, overflow: 'hidden' },
  fatigueBarFill: { height: '100%', borderRadius: 3 },
  macroRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: spacing.md },
  macroChip: { alignItems: 'center', flex: 1 },
  macroValue: { fontSize: 18, fontWeight: '800' },
  macroLabel: { color: colors.textMuted, fontSize: 11, marginTop: 2, letterSpacing: 0.4 },
  waterRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  waterTarget: { color: colors.textSecondary, fontSize: 13 },
  sectionLabel: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1.2,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.sm,
    marginTop: spacing.sm,
    textTransform: 'uppercase',
  },
  quickGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginHorizontal: spacing.lg,
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  quickBtn: {
    width: '47%',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'flex-start',
    gap: spacing.sm,
    ...shadow.card,
  },
  quickIconWrap: {
    width: 40,
    height: 40,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  quickLabel: { color: colors.textPrimary, fontSize: 14, fontWeight: '700' },
  prRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  prNameRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  prName: { color: colors.textSecondary, fontSize: 14, fontWeight: '500' },
  prWeight: { color: colors.primary, fontSize: 14, fontWeight: '800' },
});