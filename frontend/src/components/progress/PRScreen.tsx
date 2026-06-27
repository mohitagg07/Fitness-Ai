// NeuroFit AI — Personal Records Screen
// Shows every exercise PR with the highest weight logged.
// PRs are auto-saved from WorkoutHUD when a new max is hit.

import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  RefreshControl, ActivityIndicator, TextInput,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { profileApi } from '../../utils/api';
import { COLORS } from '../../theme/colors';

interface PR {
  id: string;
  exercise_name: string;
  weight_kg: number;
  reps: number;
  achieved_at: string;
}

// Rough muscle group categorisation for section headers
const CATEGORIES: Record<string, string[]> = {
  CHEST: ['bench', 'press', 'fly', 'flye', 'push'],
  BACK: ['deadlift', 'row', 'pull', 'chin', 'lat'],
  LEGS: ['squat', 'lunge', 'leg', 'calf', 'rdl', 'hip thrust'],
  SHOULDERS: ['shoulder', 'overhead', 'ohp', 'lateral', 'front raise', 'arnold'],
  ARMS: ['curl', 'tricep', 'extension', 'dip', 'skull'],
  CORE: ['plank', 'crunch', 'ab', 'russian', 'sit-up'],
};

function getCategory(name: string): string {
  const lower = name.toLowerCase();
  for (const [cat, keywords] of Object.entries(CATEGORIES)) {
    if (keywords.some((kw) => lower.includes(kw))) return cat;
  }
  return 'OTHER';
}

function formatDate(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

function PRCard({ pr }: { pr: PR }) {
  return (
    <View style={styles.card}>
      <View style={styles.cardLeft}>
        <View style={styles.trophyWrap}>
          <Ionicons name="trophy" size={18} color="#FFD700" />
        </View>
        <View>
          <Text style={styles.exerciseName}>{pr.exercise_name}</Text>
          <Text style={styles.achievedDate}>{formatDate(pr.achieved_at)}</Text>
        </View>
      </View>
      <View style={styles.cardRight}>
        <Text style={styles.weight}>{pr.weight_kg}<Text style={styles.unit}> kg</Text></Text>
        <Text style={styles.reps}>{pr.reps} rep{pr.reps !== 1 ? 's' : ''}</Text>
      </View>
    </View>
  );
}

export default function PRScreen() {
  const [prs, setPrs] = useState<PR[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await profileApi.getPRs();
      // Sort by weight descending within each exercise, keep only max per exercise
      const data: PR[] = res.data || [];
      const maxByExercise: Record<string, PR> = {};
      for (const pr of data) {
        const key = pr.exercise_name.toLowerCase();
        if (!maxByExercise[key] || pr.weight_kg > maxByExercise[key].weight_kg) {
          maxByExercise[key] = pr;
        }
      }
      const sorted = Object.values(maxByExercise).sort((a, b) =>
        a.exercise_name.localeCompare(b.exercise_name)
      );
      setPrs(sorted);
    } catch {
      setError("Couldn't load PRs. Check your connection.");
    }
  }, []);

  useEffect(() => {
    (async () => {
      setLoading(true);
      await load();
      setLoading(false);
    })();
  }, [load]);

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const filtered = search.trim()
    ? prs.filter((p) => p.exercise_name.toLowerCase().includes(search.toLowerCase()))
    : prs;

  // Group by category
  const grouped: Record<string, PR[]> = {};
  for (const pr of filtered) {
    const cat = getCategory(pr.exercise_name);
    if (!grouped[cat]) grouped[cat] = [];
    grouped[cat].push(pr);
  }
  const categoryOrder = ['CHEST', 'BACK', 'LEGS', 'SHOULDERS', 'ARMS', 'CORE', 'OTHER'];
  const orderedGroups = categoryOrder.filter((c) => grouped[c]?.length > 0);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={COLORS.primaryGreen} size="large" />
        <Text style={styles.loadingText}>Loading PRs…</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>PERSONAL RECORDS</Text>
          <Text style={styles.subtitle}>{prs.length} exercise{prs.length !== 1 ? 's' : ''} tracked</Text>
        </View>
        <View style={styles.trophyBig}>
          <Ionicons name="trophy" size={28} color="#FFD700" />
        </View>
      </View>

      <View style={styles.searchWrap}>
        <Ionicons name="search-outline" size={16} color="#555" style={styles.searchIcon} />
        <TextInput
          style={styles.searchInput}
          placeholder="Search exercise…"
          placeholderTextColor="#555"
          value={search}
          onChangeText={setSearch}
        />
      </View>

      {error && (
        <View style={styles.errorBanner}>
          <Ionicons name="cloud-offline-outline" size={16} color={COLORS.danger} />
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity onPress={onRefresh}>
            <Text style={styles.retryText}>Retry</Text>
          </TouchableOpacity>
        </View>
      )}

      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.primaryGreen} />
        }
      >
        {prs.length === 0 && !error && (
          <View style={styles.empty}>
            <Ionicons name="barbell-outline" size={48} color="#333" />
            <Text style={styles.emptyTitle}>No PRs yet</Text>
            <Text style={styles.emptyBody}>
              Log a set in Workout mode and your PRs will appear here automatically.
            </Text>
          </View>
        )}

        {orderedGroups.map((cat) => (
          <View key={cat} style={styles.section}>
            <Text style={styles.sectionHeader}>{cat}</Text>
            {grouped[cat].map((pr) => (
              <PRCard key={pr.id || pr.exercise_name} pr={pr} />
            ))}
          </View>
        ))}

        <View style={{ height: 32 }} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  center: { flex: 1, backgroundColor: '#000', justifyContent: 'center', alignItems: 'center' },
  loadingText: { color: '#555', fontSize: 13, marginTop: 12 },
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start',
    paddingHorizontal: 20, paddingTop: 56, paddingBottom: 16,
  },
  title: { color: '#FFF', fontSize: 22, fontWeight: '800', letterSpacing: 1.5 },
  subtitle: { color: '#555', fontSize: 13, marginTop: 4 },
  trophyBig: {
    width: 52, height: 52, borderRadius: 16,
    backgroundColor: '#2A1F00', alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: '#FFD70030',
  },
  searchWrap: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#141414', borderRadius: 12,
    marginHorizontal: 16, marginBottom: 16,
    paddingHorizontal: 12, gap: 8,
    borderWidth: 1, borderColor: '#222',
  },
  searchIcon: { marginTop: 1 },
  searchInput: { flex: 1, color: '#FFF', fontSize: 14, paddingVertical: 12 },
  errorBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#1A0A0A', marginHorizontal: 16, marginBottom: 12,
    borderRadius: 10, padding: 12, borderWidth: 1, borderColor: '#FF002630',
  },
  errorText: { color: '#FF6666', fontSize: 13, flex: 1 },
  retryText: { color: COLORS.primaryGreen, fontSize: 13, fontWeight: '600' },
  empty: { alignItems: 'center', paddingTop: 60, paddingHorizontal: 40 },
  emptyTitle: { color: '#555', fontSize: 18, fontWeight: '700', marginTop: 16 },
  emptyBody: { color: '#444', fontSize: 13, textAlign: 'center', marginTop: 8, lineHeight: 20 },
  section: { marginBottom: 8 },
  sectionHeader: {
    color: '#444', fontSize: 11, fontWeight: '700', letterSpacing: 2,
    paddingHorizontal: 20, paddingVertical: 8,
    borderBottomWidth: 1, borderBottomColor: '#111',
  },
  card: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: '#0F0F0F', marginHorizontal: 16, marginVertical: 4,
    borderRadius: 14, padding: 16,
    borderWidth: 1, borderColor: '#1A1A1A',
  },
  cardLeft: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 },
  trophyWrap: {
    width: 36, height: 36, borderRadius: 10,
    backgroundColor: '#2A1F00', alignItems: 'center', justifyContent: 'center',
  },
  exerciseName: { color: '#E0E0E0', fontSize: 14, fontWeight: '600', flex: 1, flexWrap: 'wrap' },
  achievedDate: { color: '#444', fontSize: 11, marginTop: 2 },
  cardRight: { alignItems: 'flex-end', minWidth: 64 },
  weight: { color: '#FFD700', fontSize: 22, fontWeight: '800' },
  unit: { color: '#888', fontSize: 14, fontWeight: '400' },
  reps: { color: '#555', fontSize: 12, marginTop: 2 },
});
