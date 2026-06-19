import React, { useEffect, useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  RefreshControl, StatusBar,
} from 'react-native';
import { router } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { progressApi } from '../../utils/api';
import { useStore } from '../../store';
import { COLORS, alpha } from '../../theme/colors';

type IName = React.ComponentProps<typeof Ionicons>['name'];

export default function DashboardScreen() {
  const { user, profile, cnsFatigue, prs } = useStore();
  const [macros, setMacros] = useState<any>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = async () => {
    try { setMacros((await progressApi.getNutritionTargets(true)).data); } catch {}
  };
  useEffect(() => { load(); }, []);

  const onRefresh = async () => {
    setRefreshing(true); await load(); setRefreshing(false);
  };

  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const firstName = user?.full_name?.split(' ')[0] || profile?.full_name?.split(' ')[0] || 'Athlete';

  // Fatigue config
  const highFatigue = cnsFatigue >= 7;
  const midFatigue  = cnsFatigue >= 4;
  const fatigueColor = highFatigue ? COLORS.danger : midFatigue ? COLORS.warning : COLORS.primaryGreen;
  const fatigueLabel = highFatigue ? 'HIGH — Reduce Volume' : midFatigue ? 'MODERATE' : 'FRESH & READY';
  const fatigueIcon: IName  = highFatigue ? 'warning-outline' : midFatigue ? 'alert-circle-outline' : 'checkmark-circle-outline';

  return (
    <ScrollView
      style={styles.container}
      showsVerticalScrollIndicator={false}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.primaryGreen} />}
    >
      <StatusBar barStyle="light-content" />

      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.greeting}>{greeting},</Text>
          <Text style={styles.name}>{firstName}</Text>
        </View>
        <View style={styles.headerRight}>
          {profile?.goal && (
            <View style={styles.goalBadge}>
              <Ionicons name="flag-outline" size={10} color={COLORS.primaryBlue} />
              <Text style={styles.goalText}>{profile.goal.toUpperCase()}</Text>
            </View>
          )}
          <TouchableOpacity style={styles.notifBtn} onPress={() => router.push('/(tabs)/coach')}>
            <Ionicons name="notifications-outline" size={20} color={COLORS.textSecondary} />
          </TouchableOpacity>
        </View>
      </View>

      {/* AI Coach Banner */}
      <LinearGradient
        colors={[alpha(COLORS.primaryGreen, 0.12), alpha(COLORS.primaryBlue, 0.12)]}
        start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
        style={styles.coachCard}
      >
        <View style={styles.coachLeft}>
          <LinearGradient
            colors={[COLORS.primaryGreen, COLORS.primaryBlue]}
            start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
            style={styles.coachIcon}
          >
            <Ionicons name="flash" size={16} color="#000" />
          </LinearGradient>
          <View style={{ flex: 1 }}>
            <Text style={styles.coachLabel}>NEUROFIT AI COACH</Text>
            <Text style={styles.coachText}>
              {highFatigue
                ? 'High CNS fatigue detected. Recovery day recommended.'
                : "You're fresh. Tell me what you lifted or ask for today's plan."}
            </Text>
          </View>
        </View>
        <TouchableOpacity style={styles.coachBtn} onPress={() => router.push('/(tabs)/coach')}>
          <Text style={styles.coachBtnText}>Chat</Text>
          <Ionicons name="arrow-forward" size={12} color="#000" />
        </TouchableOpacity>
      </LinearGradient>

      {/* Stats Row — inspired by Flutter app's statistics row */}
      <View style={styles.statsRow}>
        <StatCard
          icon="flame-outline" iconColor={COLORS.primaryGreen}
          value={String(cnsFatigue)} label="CNS Score" sub="/10"
        />
        <StatCard
          icon="barbell-outline" iconColor={COLORS.primaryBlue}
          value={Object.keys(prs).length ? String(Object.keys(prs).length) : '—'}
          label="PRs Tracked" sub="total"
        />
        <StatCard
          icon="trophy-outline" iconColor={COLORS.warning}
          value={profile?.experience_level ? profile.experience_level.slice(0,3).toUpperCase() : '—'}
          label="Level" sub=""
        />
      </View>

      {/* CNS Fatigue Card */}
      <View style={[styles.card, { borderColor: fatigueColor + '30' }]}>
        <View style={styles.cardLabelRow}>
          <Ionicons name="pulse-outline" size={12} color={COLORS.textMuted} />
          <Text style={styles.cardLabel}>CNS FATIGUE INDEX</Text>
        </View>
        <View style={styles.fatigueRow}>
          <View style={styles.fatigueLeft}>
            <Text style={[styles.fatigueScore, { color: fatigueColor }]}>{cnsFatigue}</Text>
            <Text style={styles.fatigueDenom}>/10</Text>
          </View>
          <View style={styles.fatigueRight}>
            <Ionicons name={fatigueIcon} size={20} color={fatigueColor} />
            <Text style={[styles.fatigueLabel, { color: fatigueColor }]}>{fatigueLabel}</Text>
          </View>
        </View>
        <View style={styles.barBg}>
          <View style={[styles.barFill, { width: `${cnsFatigue * 10}%` as any, backgroundColor: fatigueColor }]} />
        </View>
      </View>

      {/* Macros — Flutter-style 4-column grid */}
      {macros && (
        <View style={styles.card}>
          <View style={styles.cardLabelRow}>
            <Ionicons name="nutrition-outline" size={12} color={COLORS.textMuted} />
            <Text style={styles.cardLabel}>TODAY'S TARGETS</Text>
          </View>
          <View style={styles.macroGrid}>
            <MacroCell icon="flame-outline"  color={COLORS.calories}     label="CAL"     value={String(macros.calories)} />
            <MacroCell icon="fish-outline"   color={COLORS.protein}      label="PROTEIN" value={`${macros.protein_g}g`} />
            <MacroCell icon="leaf-outline"   color={COLORS.carbs}        label="CARBS"   value={`${macros.carbs_g}g`} />
            <MacroCell icon="water-outline"  color={COLORS.fat}          label="FAT"     value={`${macros.fat_g}g`} />
          </View>
          <View style={styles.waterRow}>
            <Ionicons name="water" size={13} color={COLORS.primaryBlue} />
            <Text style={styles.waterText}>  {(macros.water_ml / 1000).toFixed(1)}L water daily</Text>
          </View>
        </View>
      )}

      {/* Quick Actions — Flutter-style horizontal scroll cards */}
      <Text style={styles.sectionLabel}>QUICK START</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.quickScroll}>
        <QuickCard icon="chatbubble-ellipses-outline" label="Ask Coach"  accent={COLORS.primaryGreen} onPress={() => router.push('/(tabs)/coach')} />
        <QuickCard icon="barbell-outline"             label="Gym Mode"   accent={COLORS.primaryBlue}  onPress={() => router.push('/(tabs)/workout')} />
        <QuickCard icon="stats-chart-outline"         label="Progress"   accent={COLORS.warning}      onPress={() => router.push('/(tabs)/progress')} />
        <QuickCard icon="trophy-outline"              label="My PRs"     accent={COLORS.primaryGreen} onPress={() => router.push('/(tabs)/profile')} />
      </ScrollView>

      {/* Personal Records */}
      {Object.keys(prs).length > 0 && (
        <>
          <Text style={styles.sectionLabel}>PERSONAL RECORDS</Text>
          <View style={styles.card}>
            {Object.entries(prs).slice(0, 5).map(([name, weight], i) => (
              <View key={name} style={[styles.prRow, i === 0 && { borderTopWidth: 0 }]}>
                <View style={styles.prLeft}>
                  <Ionicons name="medal-outline" size={14} color={COLORS.primaryGreen} />
                  <Text style={styles.prName}>{name}</Text>
                </View>
                <Text style={[styles.prWeight, { color: COLORS.primaryGreen }]}>{weight} kg</Text>
              </View>
            ))}
          </View>
        </>
      )}

      <View style={{ height: 28 }} />
    </ScrollView>
  );
}

function StatCard({ icon, iconColor, value, label, sub }: {
  icon: IName; iconColor: string; value: string; label: string; sub: string;
}) {
  return (
    <View style={sStyles.wrap}>
      <Ionicons name={icon} size={18} color={iconColor} />
      <View style={sStyles.row}>
        <Text style={[sStyles.value, { color: iconColor }]}>{value}</Text>
        {sub ? <Text style={sStyles.sub}>{sub}</Text> : null}
      </View>
      <Text style={sStyles.label}>{label}</Text>
    </View>
  );
}

function MacroCell({ icon, color, label, value }: {
  icon: IName; color: string; label: string; value: string;
}) {
  return (
    <View style={[mStyles.wrap, { borderColor: color + '30' }]}>
      <Ionicons name={icon} size={16} color={color} />
      <Text style={[mStyles.value, { color }]}>{value}</Text>
      <Text style={mStyles.label}>{label}</Text>
    </View>
  );
}

function QuickCard({ icon, label, accent, onPress }: {
  icon: IName; label: string; accent: string; onPress: () => void;
}) {
  return (
    <TouchableOpacity
      style={[qStyles.card, { borderColor: accent + '30' }]}
      onPress={onPress} activeOpacity={0.7}
    >
      <View style={[qStyles.iconWrap, { backgroundColor: accent + '18' }]}>
        <Ionicons name={icon} size={22} color={accent} />
      </View>
      <Text style={qStyles.label}>{label}</Text>
    </TouchableOpacity>
  );
}

const sStyles = StyleSheet.create({
  wrap: {
    flex: 1, alignItems: 'center', backgroundColor: COLORS.card,
    borderRadius: 14, padding: 14, gap: 4,
    borderWidth: 1, borderColor: COLORS.border,
  },
  row: { flexDirection: 'row', alignItems: 'baseline', gap: 2 },
  value: { fontSize: 20, fontWeight: '800' },
  sub: { color: COLORS.textMuted, fontSize: 11 },
  label: { color: COLORS.textMuted, fontSize: 9, fontWeight: '700', letterSpacing: 0.8, textAlign: 'center' },
});

const mStyles = StyleSheet.create({
  wrap: {
    flex: 1, alignItems: 'center', paddingVertical: 12,
    backgroundColor: COLORS.inputBg, borderRadius: 12, borderWidth: 1, gap: 4,
  },
  value: { fontSize: 15, fontWeight: '800' },
  label: { color: COLORS.textMuted, fontSize: 9, fontWeight: '700', letterSpacing: 0.5 },
});

const qStyles = StyleSheet.create({
  card: {
    width: 110, borderRadius: 16, padding: 14,
    borderWidth: 1, alignItems: 'center', gap: 10,
    backgroundColor: COLORS.card, marginRight: 10,
  },
  iconWrap: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  label: { color: COLORS.text, fontSize: 12, fontWeight: '700', textAlign: 'center' },
});

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  header: {
    paddingHorizontal: 20, paddingTop: 60, paddingBottom: 20,
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start',
  },
  greeting: { color: COLORS.textSecondary, fontSize: 13, fontWeight: '500' },
  name: { color: COLORS.text, fontSize: 26, fontWeight: '800', marginTop: 2 },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6 },
  goalBadge: {
    backgroundColor: alpha(COLORS.primaryBlue, 0.12), borderRadius: 8,
    paddingHorizontal: 10, paddingVertical: 5,
    flexDirection: 'row', alignItems: 'center', gap: 5,
    borderWidth: 1, borderColor: alpha(COLORS.primaryBlue, 0.25),
  },
  goalText: { color: COLORS.primaryBlue, fontSize: 10, fontWeight: '700', letterSpacing: 1 },
  notifBtn: {
    width: 36, height: 36, borderRadius: 10,
    backgroundColor: COLORS.card, borderWidth: 1, borderColor: COLORS.border,
    alignItems: 'center', justifyContent: 'center',
  },
  coachCard: {
    marginHorizontal: 16, marginBottom: 16,
    borderRadius: 18, padding: 16,
    borderWidth: 1, borderColor: alpha(COLORS.primaryGreen, 0.2),
  },
  coachLeft: { flexDirection: 'row', gap: 12, marginBottom: 12, alignItems: 'flex-start' },
  coachIcon: {
    width: 34, height: 34, borderRadius: 10,
    alignItems: 'center', justifyContent: 'center',
  },
  coachLabel: { color: COLORS.primaryGreen, fontSize: 10, fontWeight: '700', letterSpacing: 1.5, marginBottom: 4 },
  coachText: { color: COLORS.textSecondary, fontSize: 13, lineHeight: 19, flex: 1 },
  coachBtn: {
    alignSelf: 'flex-start',
    backgroundColor: COLORS.primaryGreen, borderRadius: 10,
    paddingVertical: 8, paddingHorizontal: 14,
    flexDirection: 'row', alignItems: 'center', gap: 5,
  },
  coachBtnText: { color: '#000', fontSize: 12, fontWeight: '700' },
  statsRow: { flexDirection: 'row', marginHorizontal: 16, gap: 10, marginBottom: 12 },
  card: {
    backgroundColor: COLORS.card, borderRadius: 18,
    padding: 16, marginHorizontal: 16, marginBottom: 12,
    borderWidth: 1, borderColor: COLORS.border,
  },
  cardLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 12 },
  cardLabel: { color: COLORS.textMuted, fontSize: 10, fontWeight: '700', letterSpacing: 1.5 },
  fatigueRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  fatigueLeft: { flexDirection: 'row', alignItems: 'baseline', gap: 3 },
  fatigueScore: { fontSize: 46, fontWeight: '800', lineHeight: 50 },
  fatigueDenom: { color: COLORS.textMuted, fontSize: 20 },
  fatigueRight: { alignItems: 'flex-end', gap: 5 },
  fatigueLabel: { fontSize: 11, fontWeight: '700', letterSpacing: 1 },
  barBg: { height: 5, backgroundColor: COLORS.border, borderRadius: 3, overflow: 'hidden' },
  barFill: { height: '100%' as any, borderRadius: 3 },
  macroGrid: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  waterRow: { flexDirection: 'row', alignItems: 'center' },
  waterText: { color: COLORS.textMuted, fontSize: 12 },
  sectionLabel: {
    color: COLORS.textMuted, fontSize: 10, fontWeight: '700', letterSpacing: 2,
    marginHorizontal: 16, marginBottom: 10, marginTop: 4,
  },
  quickScroll: { paddingHorizontal: 16, paddingBottom: 4, marginBottom: 12 },
  prRow: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', paddingVertical: 11,
    borderTopWidth: 1, borderTopColor: COLORS.border,
  },
  prLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  prName: { color: COLORS.textSecondary, fontSize: 14 },
  prWeight: { fontSize: 14, fontWeight: '700' },
});
