import React, { useEffect, useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  TextInput, Alert, ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { progressApi, describeApiError } from '../../utils/api';
import { COLORS } from '../../theme/colors';
import NutritionSearchModal from './NutritionSearchModal';

export default function ProgressScreen() {
  const [metrics, setMetrics] = useState<any[]>([]);
  const [nutrition, setNutrition] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [weightInput, setWeightInput] = useState('');
  const [activeTab, setActiveTab] = useState<'body' | 'nutrition'>('body');
  const [logFoodVisible, setLogFoodVisible] = useState(false);

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const [mRes, nRes] = await Promise.all([
        progressApi.getMetrics(14),
        progressApi.getNutritionHistory(7),
      ]);
      setMetrics(mRes.data || []);
      setNutrition(nRes.data || []);
    } catch (err: any) {
      // Previously a bare `catch {}` — a failed fetch rendered identically
      // to "you genuinely have no data yet," which is misleading and gives
      // no path to recover other than guessing to pull-to-refresh.
      const { message } = describeApiError(err);
      setErrorMsg(message);
    } finally {
      setLoading(false);
    }
  };

  const logWeight = async () => {
    const w = parseFloat(weightInput);
    if (!w || w < 30 || w > 300) {
      Alert.alert('Invalid weight', 'Enter a weight between 30 and 300 kg.');
      return;
    }
    try {
      await progressApi.logMetrics({ weight_kg: w });
      setWeightInput('');
      loadData();
      Alert.alert('Logged ✓', `${w} kg recorded.`);
    } catch {
      Alert.alert('Error', 'Could not save weight.');
    }
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={COLORS.primaryGreen} size="large" />
      </View>
    );
  }

  const latestWeight = metrics.find((m) => m.weight_kg)?.weight_kg;

  // Real derived stats — no hardcoded numbers. All computed from whatever
  // the backend actually returned, so this row is honest about having
  // nothing to show when there's genuinely nothing logged yet.
  const weighInsWithData = metrics.filter((m) => m.weight_kg);
  const oldestWeight = weighInsWithData[weighInsWithData.length - 1]?.weight_kg;
  const weightDelta = latestWeight && oldestWeight ? +(latestWeight - oldestWeight).toFixed(1) : null;
  const logsThisWeek = nutrition.length;
  const avgCalories = nutrition.length > 0
    ? Math.round(nutrition.reduce((sum, n) => sum + (n.calories || 0), 0) / nutrition.length)
    : null;

  return (
    <ScrollView style={styles.container}>
      <View style={styles.header}>
        <View style={styles.headerRow}>
          <View style={styles.headerIcon}>
            <Ionicons name="stats-chart" size={18} color={COLORS.primaryGreen} />
          </View>
          <Text style={styles.title}>Progress</Text>
        </View>
        {latestWeight && (
          <Text style={styles.subtitle}>Current: {latestWeight} kg</Text>
        )}
      </View>

      {errorMsg && (
        <View style={styles.errorBanner}>
          <Ionicons name="alert-circle-outline" size={16} color={COLORS.recoveryLow} />
          <Text style={styles.errorBannerText}>{errorMsg}</Text>
        </View>
      )}

      {/* Stat summary — hero card (current weight + trend) beside two
          stacked smaller cards (nutrition logs this week, avg calories).
          Layout pattern adapted from a reference fitness app; values are
          all real, derived from state above — never placeholder numbers. */}
      <View style={styles.statsRow}>
        <View style={styles.heroStatCard}>
          <Ionicons name="trending-up-outline" size={20} color={COLORS.primaryGreen} />
          {latestWeight ? (
            <>
              <Text style={styles.heroStatValue}>{latestWeight}</Text>
              <Text style={styles.heroStatUnit}>kg current</Text>
              {weightDelta !== null && (
                <Text style={[
                  styles.heroStatDelta,
                  { color: weightDelta <= 0 ? COLORS.recoveryHigh : COLORS.calories },
                ]}>
                  {weightDelta > 0 ? '+' : ''}{weightDelta} kg over period
                </Text>
              )}
            </>
          ) : (
            <Text style={styles.heroStatEmpty}>Log a weigh-in to see your trend</Text>
          )}
        </View>

        <View style={styles.stackedStats}>
          <View style={styles.smallStatCard}>
            <Ionicons name="restaurant-outline" size={16} color={COLORS.strain} />
            <Text style={styles.smallStatValue}>{logsThisWeek}</Text>
            <Text style={styles.smallStatLabel}>meals logged</Text>
          </View>
          <View style={styles.smallStatCard}>
            <Ionicons name="flame-outline" size={16} color={COLORS.calories} />
            <Text style={styles.smallStatValue}>{avgCalories ?? '—'}</Text>
            <Text style={styles.smallStatLabel}>avg kcal/day</Text>
          </View>
        </View>
      </View>

      {/* Log Weight */}
      <View style={styles.card}>
        <Text style={styles.cardLabel}>LOG BODYWEIGHT</Text>
        <View style={styles.row}>
          <TextInput
            style={styles.input}
            value={weightInput}
            onChangeText={setWeightInput}
            placeholder="kg"
            placeholderTextColor={COLORS.textMuted}
            keyboardType="decimal-pad"
          />
          <TouchableOpacity style={styles.logBtn} onPress={logWeight}>
            <Ionicons name="add-circle-outline" size={15} color="#000" />
            <Text style={styles.logBtnText}>LOG</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Tabs */}
      <View style={styles.tabs}>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'body' && styles.tabActive]}
          onPress={() => setActiveTab('body')}
        >
          <Ionicons
            name="body-outline"
            size={14}
            color={activeTab === 'body' ? COLORS.primaryGreen : COLORS.textMuted}
          />
          <Text style={[styles.tabText, activeTab === 'body' && styles.tabTextActive]}>BODY</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'nutrition' && styles.tabActive]}
          onPress={() => setActiveTab('nutrition')}
        >
          <Ionicons
            name="restaurant-outline"
            size={14}
            color={activeTab === 'nutrition' ? COLORS.primaryGreen : COLORS.textMuted}
          />
          <Text style={[styles.tabText, activeTab === 'nutrition' && styles.tabTextActive]}>NUTRITION</Text>
        </TouchableOpacity>
      </View>

      {activeTab === 'body' && (
        <View style={styles.card}>
          <Text style={styles.cardLabel}>WEIGHT HISTORY</Text>
          {metrics.length === 0 ? (
            <Text style={styles.empty}>No data yet. Log your bodyweight above.</Text>
          ) : (
            metrics.filter((m) => m.weight_kg).map((m, i) => (
              <View key={i} style={styles.metricRow}>
                <Text style={styles.metricDate}>{m.recorded_date || '—'}</Text>
                <Text style={styles.metricValue}>{m.weight_kg} kg</Text>
              </View>
            ))
          )}
        </View>
      )}

      {activeTab === 'nutrition' && (
        <>
          {/* Primary entry point into the FatSecret-backed search + quick-log
              flow. Lives above the manual history list so the fast path
              (search → tap → grams → log) is what people reach for first;
              the list below remains the fallback/record of what's logged. */}
          <TouchableOpacity
            style={styles.logFoodBtn}
            onPress={() => setLogFoodVisible(true)}
          >
            <Ionicons name="search" size={16} color="#000" />
            <Text style={styles.logFoodBtnText}>LOG FOOD</Text>
          </TouchableOpacity>

          <View style={styles.card}>
            <Text style={styles.cardLabel}>RECENT NUTRITION LOGS</Text>
            {nutrition.length === 0 ? (
              <Text style={styles.empty}>No nutrition logs yet. Tap "Log Food" above to search and add one.</Text>
            ) : (
              nutrition.map((n, i) => (
                <View key={i} style={styles.metricRow}>
                  <View>
                    <Text style={styles.metricDate}>{n.log_date}</Text>
                    <Text style={styles.metricSub}>P: {n.protein_g}g · C: {n.carbs_g}g · F: {n.fat_g}g</Text>
                  </View>
                  <Text style={styles.metricValue}>{n.calories} kcal</Text>
                </View>
              ))
            )}
          </View>
        </>
      )}

      <View style={{ height: 24 }} />

      <NutritionSearchModal
        visible={logFoodVisible}
        onClose={() => setLogFoodVisible(false)}
        onLogged={loadData}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  center: { flex: 1, backgroundColor: COLORS.background, justifyContent: 'center', alignItems: 'center' },
  header: { padding: 24, paddingTop: 60 },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  headerIcon: {
    width: 34, height: 34, borderRadius: 10,
    backgroundColor: COLORS.cardElevated, alignItems: 'center', justifyContent: 'center',
  },
  title: { color: COLORS.text, fontSize: 28, fontWeight: '800' },
  subtitle: { color: COLORS.textSecondary, fontSize: 14, marginTop: 4 },
  errorBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: COLORS.recoveryLow + '1A', borderRadius: 12,
    marginHorizontal: 16, marginBottom: 16, padding: 12,
    borderWidth: 1, borderColor: COLORS.recoveryLow + '40',
  },
  errorBannerText: { color: COLORS.recoveryLow, fontSize: 12, flex: 1 },
  statsRow: {
    flexDirection: 'row', gap: 10,
    marginHorizontal: 16, marginBottom: 16,
  },
  heroStatCard: {
    flex: 1.1, backgroundColor: COLORS.cardElevated, borderRadius: 16,
    padding: 16, borderWidth: 1, borderColor: COLORS.borderLight,
    justifyContent: 'center', minHeight: 130,
  },
  heroStatValue: { color: COLORS.text, fontSize: 34, fontWeight: '800', marginTop: 8 },
  heroStatUnit: { color: COLORS.textSecondary, fontSize: 13, fontWeight: '600', marginTop: 2 },
  heroStatDelta: { fontSize: 12, fontWeight: '700', marginTop: 8 },
  heroStatEmpty: { color: COLORS.textMuted, fontSize: 13, marginTop: 10, lineHeight: 18 },
  stackedStats: { flex: 1, gap: 10 },
  smallStatCard: {
    flex: 1, backgroundColor: COLORS.cardElevated, borderRadius: 16,
    padding: 14, borderWidth: 1, borderColor: COLORS.borderLight,
    justifyContent: 'center',
  },
  smallStatValue: { color: COLORS.text, fontSize: 20, fontWeight: '800', marginTop: 6 },
  smallStatLabel: { color: COLORS.textSecondary, fontSize: 11, fontWeight: '600', marginTop: 2 },
  card: {
    backgroundColor: COLORS.cardElevated, borderRadius: 16,
    padding: 16, marginHorizontal: 16, marginBottom: 12,
    borderWidth: 1, borderColor: COLORS.borderLight,
  },
  cardLabel: { color: COLORS.textMuted, fontSize: 11, fontWeight: '700', letterSpacing: 1.5, marginBottom: 12 },
  row: { flexDirection: 'row', gap: 10 },
  input: {
    flex: 1, backgroundColor: COLORS.inputBg,
    borderRadius: 12, padding: 14,
    color: COLORS.text, fontSize: 16,
  },
  logBtn: {
    backgroundColor: COLORS.primaryGreen, borderRadius: 12,
    paddingHorizontal: 18, justifyContent: 'center',
    flexDirection: 'row', alignItems: 'center', gap: 5,
  },
  logBtnText: { color: '#000', fontWeight: '700', fontSize: 13 },
  tabs: {
    flexDirection: 'row', marginHorizontal: 16,
    marginBottom: 12, gap: 8,
  },
  tab: {
    flex: 1, paddingVertical: 10, borderRadius: 10,
    backgroundColor: COLORS.cardElevated, alignItems: 'center',
    borderWidth: 1, borderColor: COLORS.borderLight,
    flexDirection: 'row', justifyContent: 'center', gap: 6,
  },
  tabActive: { backgroundColor: COLORS.primaryBlue + '26', borderColor: COLORS.primaryBlue + '55' },
  tabText: { color: COLORS.textMuted, fontSize: 12, fontWeight: '700', letterSpacing: 1 },
  tabTextActive: { color: COLORS.primaryGreen },
  logFoodBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: COLORS.primaryGreen, borderRadius: 14,
    marginHorizontal: 16, marginBottom: 12, paddingVertical: 14,
  },
  logFoodBtnText: { color: '#000', fontWeight: '800', fontSize: 13, letterSpacing: 1 },
  empty: { color: COLORS.textMuted, fontSize: 13, textAlign: 'center', paddingVertical: 20, lineHeight: 18 },
  metricRow: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: COLORS.borderLight,
  },
  metricDate: { color: COLORS.textSecondary, fontSize: 13 },
  metricSub: { color: COLORS.textMuted, fontSize: 11, marginTop: 2 },
  metricValue: { color: COLORS.primaryGreen, fontSize: 15, fontWeight: '700' },
});
