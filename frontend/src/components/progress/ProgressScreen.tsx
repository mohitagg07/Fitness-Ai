import React, { useEffect, useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  TextInput, Alert, ActivityIndicator,
} from 'react-native';
import { progressApi } from '../../utils/api';

export default function ProgressScreen() {
  const [metrics, setMetrics] = useState<any[]>([]);
  const [nutrition, setNutrition] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [weightInput, setWeightInput] = useState('');
  const [activeTab, setActiveTab] = useState<'body' | 'nutrition'>('body');

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const [mRes, nRes] = await Promise.all([
        progressApi.getMetrics(14),
        progressApi.getNutritionHistory(7),
      ]);
      setMetrics(mRes.data || []);
      setNutrition(nRes.data || []);
    } catch {}
    finally { setLoading(false); }
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
        <ActivityIndicator color="#FFD700" size="large" />
      </View>
    );
  }

  const latestWeight = metrics.find((m) => m.weight_kg)?.weight_kg;

  return (
    <ScrollView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Progress</Text>
        {latestWeight && (
          <Text style={styles.subtitle}>Current: {latestWeight} kg</Text>
        )}
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
            placeholderTextColor="#555"
            keyboardType="decimal-pad"
          />
          <TouchableOpacity style={styles.logBtn} onPress={logWeight}>
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
          <Text style={[styles.tabText, activeTab === 'body' && styles.tabTextActive]}>BODY</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'nutrition' && styles.tabActive]}
          onPress={() => setActiveTab('nutrition')}
        >
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
        <View style={styles.card}>
          <Text style={styles.cardLabel}>RECENT NUTRITION LOGS</Text>
          {nutrition.length === 0 ? (
            <Text style={styles.empty}>No nutrition logs yet.</Text>
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
      )}

      <View style={{ height: 24 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#121212' },
  center: { flex: 1, backgroundColor: '#121212', justifyContent: 'center', alignItems: 'center' },
  header: { padding: 24, paddingTop: 60 },
  title: { color: '#FFF', fontSize: 28, fontWeight: '800' },
  subtitle: { color: '#888', fontSize: 14, marginTop: 4 },
  card: {
    backgroundColor: '#1E1E1E', borderRadius: 16,
    padding: 16, marginHorizontal: 16, marginBottom: 12,
    borderWidth: 1, borderColor: '#2A2A2A',
  },
  cardLabel: { color: '#555', fontSize: 11, fontWeight: '700', letterSpacing: 1.5, marginBottom: 12 },
  row: { flexDirection: 'row', gap: 10 },
  input: {
    flex: 1, backgroundColor: '#252525',
    borderRadius: 12, padding: 14,
    color: '#FFF', fontSize: 16,
  },
  logBtn: {
    backgroundColor: '#FFD700', borderRadius: 12,
    paddingHorizontal: 20, justifyContent: 'center',
  },
  logBtnText: { color: '#000', fontWeight: '700', fontSize: 13 },
  tabs: {
    flexDirection: 'row', marginHorizontal: 16,
    marginBottom: 12, gap: 8,
  },
  tab: {
    flex: 1, paddingVertical: 10, borderRadius: 10,
    backgroundColor: '#1A1A1A', alignItems: 'center',
    borderWidth: 1, borderColor: '#2A2A2A',
  },
  tabActive: { backgroundColor: '#1E3A5F', borderColor: '#2A4A7F' },
  tabText: { color: '#555', fontSize: 12, fontWeight: '700', letterSpacing: 1 },
  tabTextActive: { color: '#FFD700' },
  empty: { color: '#555', fontSize: 13, textAlign: 'center', paddingVertical: 20 },
  metricRow: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: '#2A2A2A',
  },
  metricDate: { color: '#888', fontSize: 13 },
  metricSub: { color: '#555', fontSize: 11, marginTop: 2 },
  metricValue: { color: '#FFD700', fontSize: 15, fontWeight: '700' },
});
