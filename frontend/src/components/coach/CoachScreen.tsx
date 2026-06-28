// frontend/src/components/coach/CoachScreen.tsx
//
// WHAT CHANGED vs previous version:
//   1. StructuredResponse now renders ALL four sections for session_plan
//      (MissionCard + WorkoutTable + DecisionsTable + NutritionTable)
//      matching exactly the screenshots you shared.
//   2. WorkoutTable / DecisionsTable / NutritionTable already existed — kept intact.
//   3. The MissionCard now also surfaces mission.goal / mission.workout_type
//      from the new JSON shape: { mission: { goal, recovery, workout_type } }
//   4. Backend response shape expected (from coach_agent.py session_plan):
//      {
//        mode: "session_plan",
//        mission: { goal, recovery, workout_type },
//        analysis, ai_decision, next_action, coaching_cue, coach_insight,
//        workout: [{ exercise, sets, reps, weight, rpe, rest }],
//        decisions: [{ decision, reason }],
//        nutrition: { calories, protein, carbs, fat, water_l, diet_note }
//      }

import React, { useState, useRef, useEffect } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, FlatList,
  StyleSheet, KeyboardAvoidingView, Platform, ActivityIndicator,
  Alert, ScrollView,
} from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { Ionicons } from '@expo/vector-icons';
import { coachApi, describeApiError } from '../../utils/api';
import { useStore } from '../../store';
import { COLORS } from '../../theme/colors';

// ── Quick suggestions ────────────────────────────────────────────────────────
const SUGGESTIONS = [
  "Give me today's workout",
  "I deadlifted 150kg × 3, RPE 9",
  "Only 30 minutes — what can I do?",
  "My shoulder is clicking today",
  "How's my recovery looking?",
  "I missed yesterday's session",
];

// ── Recovery Ring ────────────────────────────────────────────────────────────
function RecoveryRing({
  recovery,
  workoutType,
}: {
  recovery: number;
  workoutType?: string;
}) {
  const size = 80;
  const stroke = 7;
  const radius = (size - stroke) / 2;
  const circ = 2 * Math.PI * radius;
  const pct = Math.max(0, Math.min(1, recovery / 100));
  const color =
    recovery >= 70 ? '#16EC06' : recovery >= 40 ? '#FFDE00' : '#FF0026';

  return (
    <View style={ringStyles.wrap}>
      <Svg width={size} height={size}>
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke="#1A1A1A"
          strokeWidth={stroke}
          fill="none"
        />
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={color}
          strokeWidth={stroke}
          fill="none"
          strokeDasharray={`${circ} ${circ}`}
          strokeDashoffset={circ * (1 - pct)}
          strokeLinecap="round"
          rotation={-90}
          origin={`${size / 2}, ${size / 2}`}
        />
      </Svg>
      <View style={ringStyles.center}>
        <Text style={[ringStyles.value, { color }]}>{recovery}</Text>
        <Text style={ringStyles.pct}>%</Text>
      </View>
      {workoutType && (
        <Text style={ringStyles.label}>{workoutType.toUpperCase()}</Text>
      )}
    </View>
  );
}

const ringStyles = StyleSheet.create({
  wrap: { alignItems: 'center', width: 80 },
  center: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    alignItems: 'center', justifyContent: 'center', flexDirection: 'row',
  },
  value: { fontSize: 20, fontFamily: 'Inter_700Bold' },
  pct: { color: '#555', fontSize: 11, fontFamily: 'Inter_400Regular', marginTop: 4 },
  label: {
    color: '#555', fontSize: 9, fontFamily: 'Inter_700Bold',
    letterSpacing: 1, marginTop: 4,
  },
});

// ── Workout Table ─────────────────────────────────────────────────────────────
// Renders the "💪 Workout Plan" table matching screenshot 1
function WorkoutTable({ workout }: { workout: any[] }) {
  if (!workout || workout.length === 0) return null;
  return (
    <View style={tableStyles.card}>
      <View style={tableStyles.titleRow}>
        <Text style={tableStyles.titleEmoji}>💪</Text>
        <Text style={tableStyles.title}>Workout Plan</Text>
      </View>
      {/* Header */}
      <View style={tableStyles.headerRow}>
        <Text style={[tableStyles.headerCell, { flex: 2.2 }]}>Exercise</Text>
        <Text style={tableStyles.headerCell}>Sets</Text>
        <Text style={tableStyles.headerCell}>Reps</Text>
        <Text style={tableStyles.headerCell}>Weight</Text>
        <Text style={tableStyles.headerCell}>RPE</Text>
        <Text style={tableStyles.headerCell}>Rest</Text>
      </View>
      {/* Rows */}
      {workout.map((ex, i) => (
        <View
          key={i}
          style={[tableStyles.dataRow, i % 2 === 1 && tableStyles.dataRowAlt]}
        >
          <Text
            style={[tableStyles.dataCell, { flex: 2.2 }]}
            numberOfLines={2}
          >
            {ex.exercise}
          </Text>
          <Text style={tableStyles.dataCell}>{ex.sets}</Text>
          <Text style={tableStyles.dataCell}>{ex.reps}</Text>
          <Text
            style={[
              tableStyles.dataCell,
              { color: COLORS.primaryGreen, fontFamily: 'Inter_700Bold' },
            ]}
          >
            {ex.weight}
          </Text>
          <Text style={tableStyles.dataCell}>{ex.rpe}</Text>
          <Text style={tableStyles.dataCell}>{ex.rest}</Text>
        </View>
      ))}
    </View>
  );
}

const tableStyles = StyleSheet.create({
  card: {
    backgroundColor: '#111', borderRadius: 16, padding: 16,
    marginTop: 10, borderWidth: 1, borderColor: '#222',
  },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  titleEmoji: { fontSize: 18 },
  title: { color: '#FFF', fontSize: 16, fontFamily: 'Inter_700Bold' },
  headerRow: {
    flexDirection: 'row', paddingBottom: 8,
    borderBottomWidth: 1, borderBottomColor: '#2A2A2A', marginBottom: 4,
  },
  headerCell: {
    flex: 1, color: '#666', fontSize: 11,
    fontFamily: 'Inter_700Bold', letterSpacing: 0.5,
  },
  dataRow: {
    flexDirection: 'row', paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: '#1A1A1A',
  },
  dataRowAlt: { backgroundColor: '#141414', borderRadius: 6 },
  dataCell: { flex: 1, color: '#CCC', fontSize: 12, fontFamily: 'Inter_400Regular' },
});

// ── AI Decisions Table ────────────────────────────────────────────────────────
// Renders the "🤖 AI Decisions" table matching screenshot 2
function DecisionsTable({ decisions }: { decisions: any[] }) {
  if (!decisions || decisions.length === 0) return null;
  return (
    <View style={decStyles.card}>
      <View style={decStyles.titleRow}>
        <Text style={decStyles.titleEmoji}>🤖</Text>
        <Text style={decStyles.title}>AI Decisions</Text>
      </View>
      <View style={decStyles.headerRow}>
        <Text style={[decStyles.headerCell, { flex: 1.5 }]}>Decision</Text>
        <Text style={decStyles.headerCell}>Reason</Text>
      </View>
      {decisions.map((d, i) => (
        <View
          key={i}
          style={[decStyles.dataRow, i % 2 === 1 && decStyles.dataRowAlt]}
        >
          <Text
            style={[
              decStyles.dataCell,
              { flex: 1.5, color: '#FFF', fontFamily: 'Inter_600SemiBold' },
            ]}
          >
            {d.decision}
          </Text>
          <Text style={decStyles.dataCell}>{d.reason}</Text>
        </View>
      ))}
    </View>
  );
}

const decStyles = StyleSheet.create({
  card: {
    backgroundColor: '#111', borderRadius: 16, padding: 16,
    marginTop: 10, borderWidth: 1, borderColor: '#222',
  },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  titleEmoji: { fontSize: 18 },
  title: { color: '#FFF', fontSize: 16, fontFamily: 'Inter_700Bold' },
  headerRow: {
    flexDirection: 'row', paddingBottom: 8,
    borderBottomWidth: 1, borderBottomColor: '#2A2A2A', marginBottom: 4,
  },
  headerCell: {
    flex: 1, color: '#666', fontSize: 11,
    fontFamily: 'Inter_700Bold', letterSpacing: 0.5,
  },
  dataRow: {
    flexDirection: 'row', paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: '#1A1A1A', gap: 12,
  },
  dataRowAlt: { backgroundColor: '#141414', borderRadius: 6 },
  dataCell: { flex: 1, color: '#AAA', fontSize: 12, fontFamily: 'Inter_400Regular' },
});

// ── Nutrition Targets Table ───────────────────────────────────────────────────
// Renders the "🥗 Nutrition Targets" table matching screenshot 3
function NutritionTable({ nutrition }: { nutrition: any }) {
  if (!nutrition) return null;
  const rows = [
    { label: 'Calories', value: `${nutrition.calories} kcal`, color: '#FF9D5C' },
    { label: 'Protein',  value: `${nutrition.protein} g`,     color: '#4ADE80' },
    { label: 'Carbs',    value: `${nutrition.carbs} g`,       color: '#60A5FA' },
    { label: 'Fat',      value: `${nutrition.fat} g`,         color: '#FBBF24' },
    { label: 'Water',    value: `${nutrition.water_l ?? 3.5} L`, color: '#38BDF8' },
  ];
  return (
    <View style={nutStyles.card}>
      <View style={nutStyles.titleRow}>
        <Text style={nutStyles.titleEmoji}>🥗</Text>
        <Text style={nutStyles.title}>Nutrition Targets</Text>
      </View>
      <View style={nutStyles.headerRow}>
        <Text style={[nutStyles.headerCell, { flex: 2 }]}>Target</Text>
        <Text style={[nutStyles.headerCell, { textAlign: 'right' }]}>Amount</Text>
      </View>
      {rows.map((row, i) => (
        <View
          key={i}
          style={[nutStyles.dataRow, i % 2 === 1 && nutStyles.dataRowAlt]}
        >
          <Text style={[nutStyles.dataCell, { flex: 2 }]}>{row.label}</Text>
          <Text
            style={[
              nutStyles.dataCell,
              { color: row.color, fontFamily: 'Inter_700Bold', textAlign: 'right' },
            ]}
          >
            {row.value}
          </Text>
        </View>
      ))}
      {nutrition.diet_note && (
        <View style={nutStyles.dietNote}>
          <Ionicons name="leaf-outline" size={12} color={COLORS.primaryGreen} />
          <Text style={nutStyles.dietNoteText}>{nutrition.diet_note}</Text>
        </View>
      )}
    </View>
  );
}

const nutStyles = StyleSheet.create({
  card: {
    backgroundColor: '#111', borderRadius: 16, padding: 16,
    marginTop: 10, borderWidth: 1, borderColor: '#222',
  },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  titleEmoji: { fontSize: 18 },
  title: { color: '#FFF', fontSize: 16, fontFamily: 'Inter_700Bold' },
  headerRow: {
    flexDirection: 'row', paddingBottom: 8,
    borderBottomWidth: 1, borderBottomColor: '#2A2A2A', marginBottom: 4,
  },
  headerCell: {
    flex: 1, color: '#666', fontSize: 11,
    fontFamily: 'Inter_700Bold', letterSpacing: 0.5,
  },
  dataRow: {
    flexDirection: 'row', paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: '#1A1A1A',
  },
  dataRowAlt: { backgroundColor: '#141414', borderRadius: 6 },
  dataCell: { flex: 1, color: '#CCC', fontSize: 13, fontFamily: 'Inter_400Regular' },
  dietNote: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    marginTop: 10, backgroundColor: '#0F2010', borderRadius: 8, padding: 10,
  },
  dietNoteText: {
    color: '#4ADE80', fontSize: 12,
    fontFamily: 'Inter_400Regular', flex: 1,
  },
});

// ── Mission Card ──────────────────────────────────────────────────────────────
// Top-level card: recovery ring + goal badge + AI decision + next action
function MissionCard({ sd }: { sd: any }) {
  // Support both shapes:
  //   • New: sd.mission = { goal, recovery, workout_type }
  //   • Legacy: sd.recovery directly on sd
  const recovery =
    sd.mission?.recovery ?? sd.recovery ?? 0;
  const workoutType =
    sd.mission?.workout_type ?? sd.workout_type ?? undefined;
  const goal = sd.mission?.goal ?? sd.goal ?? undefined;

  return (
    <View style={missionStyles.card}>
      {/* Recovery ring + mission badge */}
      <View style={missionStyles.topRow}>
        <RecoveryRing recovery={recovery} workoutType={workoutType} />
        <View style={missionStyles.missionInfo}>
          {goal && (
            <View style={missionStyles.goalBadge}>
              <Text style={missionStyles.goalText}>{goal.toUpperCase()}</Text>
            </View>
          )}
          {sd.analysis && (
            <Text style={missionStyles.analysis}>{sd.analysis}</Text>
          )}
        </View>
      </View>

      {/* AI Decision highlight box */}
      {sd.ai_decision && (
        <View style={missionStyles.decisionBox}>
          <View style={missionStyles.decisionLabel}>
            <Ionicons name="flash" size={11} color={COLORS.primaryGreen} />
            <Text style={missionStyles.decisionLabelText}>AI DECISION</Text>
          </View>
          <Text style={missionStyles.decisionText}>{sd.ai_decision}</Text>
        </View>
      )}

      {/* Next action + coaching cue */}
      {(sd.next_action || sd.coaching_cue) && (
        <View style={missionStyles.row}>
          {sd.next_action && (
            <View style={missionStyles.pill}>
              <Text style={missionStyles.pillLabel}>NEXT</Text>
              <Text style={missionStyles.pillValue}>{sd.next_action}</Text>
            </View>
          )}
          {sd.coaching_cue && (
            <View style={[missionStyles.pill, { flex: 1.4 }]}>
              <Text style={missionStyles.pillLabel}>CUE</Text>
              <Text style={missionStyles.pillValue}>{sd.coaching_cue}</Text>
            </View>
          )}
        </View>
      )}

      {sd.coach_insight && (
        <Text style={missionStyles.insight}>{sd.coach_insight}</Text>
      )}
    </View>
  );
}

const missionStyles = StyleSheet.create({
  card: {
    backgroundColor: '#111', borderRadius: 16, padding: 16,
    borderWidth: 1, borderColor: '#222',
  },
  topRow: { flexDirection: 'row', gap: 16, alignItems: 'center', marginBottom: 14 },
  missionInfo: { flex: 1, gap: 6 },
  goalBadge: {
    backgroundColor: COLORS.primaryGreen + '20', borderRadius: 8,
    paddingHorizontal: 10, paddingVertical: 4, alignSelf: 'flex-start',
  },
  goalText: {
    color: COLORS.primaryGreen, fontSize: 10,
    fontFamily: 'Inter_700Bold', letterSpacing: 1,
  },
  analysis: {
    color: '#AAA', fontSize: 13,
    fontFamily: 'Inter_400Regular', lineHeight: 18,
  },
  decisionBox: {
    backgroundColor: '#0C1F0C', borderRadius: 12, padding: 12,
    marginBottom: 12, borderWidth: 1, borderColor: '#1A3A1A',
  },
  decisionLabel: {
    flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 6,
  },
  decisionLabelText: {
    color: COLORS.primaryGreen, fontSize: 10,
    fontFamily: 'Inter_700Bold', letterSpacing: 1.5,
  },
  decisionText: { color: '#FFF', fontSize: 14, fontFamily: 'Inter_600SemiBold', lineHeight: 20 },
  row: { flexDirection: 'row', gap: 10, marginBottom: 10 },
  pill: {
    flex: 1, backgroundColor: '#181818', borderRadius: 10,
    padding: 10, borderWidth: 1, borderColor: '#252525',
  },
  pillLabel: {
    color: '#555', fontSize: 9, fontFamily: 'Inter_700Bold',
    letterSpacing: 1, marginBottom: 4,
  },
  pillValue: { color: '#DDD', fontSize: 12, fontFamily: 'Inter_400Regular', lineHeight: 16 },
  insight: {
    color: '#666', fontSize: 12, fontFamily: 'Inter_400Regular',
    fontStyle: 'italic', textAlign: 'center', marginTop: 4,
  },
});

// ── Structured Message Renderer ───────────────────────────────────────────────
// For session_plan: MissionCard → WorkoutTable → DecisionsTable → NutritionTable
// For live_set / chat: MissionCard only
function StructuredResponse({ sd }: { sd: any }) {
  const isSessionPlan = sd?.mode === 'session_plan';
  return (
    <ScrollView showsVerticalScrollIndicator={false} nestedScrollEnabled>
      <MissionCard sd={sd} />
      {isSessionPlan && <WorkoutTable workout={sd.workout} />}
      {isSessionPlan && <DecisionsTable decisions={sd.decisions} />}
      {isSessionPlan && <NutritionTable nutrition={sd.nutrition} />}
    </ScrollView>
  );
}

// ── Main Coach Screen ─────────────────────────────────────────────────────────
export default function CoachScreen() {
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const flatListRef = useRef<FlatList>(null);
  const { chatHistory, addChatMessage, setCnsFatigue, activeSession } = useStore();

  const sendMessage = async (text?: string) => {
    const message = text || input.trim();
    if (!message || loading) return;

    setInput('');
    addChatMessage('user', message);
    setLoading(true);

    try {
      const res = await coachApi.chat(message, activeSession?.id);
      const data = res.data;

      // Pass structured_decision so CoachScreen can render cards/tables
      addChatMessage('assistant', data.reply, data.structured_decision);

      if (data.cns_fatigue_score != null) setCnsFatigue(data.cns_fatigue_score);

      if (data.emergency) {
        Alert.alert(
          'Workout Terminated',
          'Injury signal detected. Follow the R.I.C.E protocol.',
        );
      }
      if (data.new_prs?.length > 0) {
        Alert.alert(
          'New PR! 🏆',
          data.new_prs.map((p: any) => p.message).join('\n'),
        );
      }
    } catch (err: any) {
      const { message: errMsg } = describeApiError(err);
      addChatMessage('assistant', errMsg);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (chatHistory.length > 0) {
      setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 100);
    }
  }, [chatHistory.length]);

  const renderMessage = ({ item }: { item: any }) => {
    // User bubble
    if (item.role === 'user') {
      return (
        <View style={styles.userBubble}>
          <Text style={styles.userText}>{item.content}</Text>
        </View>
      );
    }

    // Assistant — render structured cards if we have a decision object,
    // otherwise fall back to plain text
    const sd = item.structured_decision;
    const hasStructured =
      sd && (sd.workout || sd.decisions || sd.analysis || sd.ai_decision);

    return (
      <View style={styles.aiBubble}>
        <View style={styles.roleLabelRow}>
          <Ionicons name="flash" size={10} color={COLORS.primaryGreen} />
          <Text style={styles.roleLabel}>NEUROFIT COACH</Text>
        </View>
        {hasStructured ? (
          <StructuredResponse sd={sd} />
        ) : (
          <Text style={styles.messageText}>{item.content}</Text>
        )}
      </View>
    );
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={90}
    >
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerIcon}>
          <Ionicons name="flash" size={20} color={COLORS.primaryGreen} />
        </View>
        <View>
          <Text style={styles.headerTitle}>AI Coach</Text>
          <Text style={styles.headerSub}>Your personal AI spotter</Text>
        </View>
      </View>

      {/* Empty state with suggestions */}
      {chatHistory.length === 0 ? (
        <View style={styles.emptyState}>
          <Text style={styles.emptyTitle}>What's the move today?</Text>
          <Text style={styles.emptySubtitle}>
            Tell me what you lifted, what you're feeling, or what you need.
          </Text>
          <View style={styles.suggestions}>
            {SUGGESTIONS.map((s, i) => (
              <TouchableOpacity
                key={i}
                style={styles.suggestion}
                onPress={() => sendMessage(s)}
              >
                <Text style={styles.suggestionText}>{s}</Text>
                <Ionicons name="arrow-forward-outline" size={14} color="#555" />
              </TouchableOpacity>
            ))}
          </View>
        </View>
      ) : (
        <FlatList
          ref={flatListRef}
          data={chatHistory}
          keyExtractor={(_, i) => String(i)}
          renderItem={renderMessage}
          contentContainerStyle={styles.messageList}
          showsVerticalScrollIndicator={false}
        />
      )}

      {/* Typing indicator */}
      {loading && (
        <View style={styles.loadingRow}>
          <ActivityIndicator color={COLORS.primaryGreen} size="small" />
          <Text style={styles.loadingText}>Coach thinking...</Text>
        </View>
      )}

      {/* Input bar */}
      <View style={styles.inputRow}>
        <TextInput
          style={styles.input}
          value={input}
          onChangeText={setInput}
          placeholder="Tell me what you lifted, or ask anything..."
          placeholderTextColor="#555"
          multiline
          maxLength={2000}
        />
        <TouchableOpacity
          style={[
            styles.sendBtn,
            (!input.trim() || loading) && styles.sendBtnDisabled,
          ]}
          onPress={() => sendMessage()}
          disabled={!input.trim() || loading}
        >
          <Ionicons
            name="arrow-up"
            size={18}
            color={input.trim() && !loading ? '#000' : '#333'}
          />
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0A0A0A' },
  header: {
    paddingHorizontal: 20, paddingTop: 60, paddingBottom: 12,
    borderBottomWidth: 1, borderBottomColor: '#1A1A1A',
    flexDirection: 'row', alignItems: 'center', gap: 12,
  },
  headerIcon: {
    width: 36, height: 36, borderRadius: 10,
    backgroundColor: '#1A2535', alignItems: 'center', justifyContent: 'center',
  },
  headerTitle: { color: '#FFF', fontSize: 20, fontFamily: 'Inter_700Bold' },
  headerSub: {
    color: '#555', fontSize: 12,
    fontFamily: 'Inter_400Regular', marginTop: 1,
  },
  messageList: { padding: 16, paddingBottom: 8 },
  userBubble: {
    marginBottom: 12, borderRadius: 16, padding: 14,
    maxWidth: '85%', backgroundColor: '#1E3A5F', alignSelf: 'flex-end',
  },
  userText: { color: '#FFF', fontSize: 15, fontFamily: 'Inter_400Regular', lineHeight: 22 },
  aiBubble: { marginBottom: 16, alignSelf: 'flex-start', width: '100%' },
  roleLabelRow: {
    flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 8,
  },
  roleLabel: {
    color: COLORS.primaryGreen, fontSize: 10,
    fontFamily: 'Inter_700Bold', letterSpacing: 1.5,
  },
  messageText: {
    color: '#E8E8E8', fontSize: 15,
    fontFamily: 'Inter_400Regular', lineHeight: 22,
  },
  emptyState: { flex: 1, padding: 24, justifyContent: 'center' },
  emptyTitle: {
    color: '#FFF', fontSize: 22,
    fontFamily: 'Inter_700Bold', marginBottom: 8,
  },
  emptySubtitle: {
    color: '#888', fontSize: 14,
    fontFamily: 'Inter_400Regular', marginBottom: 28, lineHeight: 20,
  },
  suggestions: { gap: 8 },
  suggestion: {
    backgroundColor: '#141414', borderRadius: 12, padding: 14,
    borderWidth: 1, borderColor: '#222',
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
  },
  suggestionText: {
    color: '#C0C0C0', fontSize: 13,
    fontFamily: 'Inter_400Regular', flex: 1,
  },
  loadingRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 20, paddingVertical: 8, gap: 10,
  },
  loadingText: {
    color: COLORS.primaryGreen, fontSize: 13,
    fontFamily: 'Inter_400Regular',
  },
  inputRow: {
    flexDirection: 'row', alignItems: 'flex-end',
    padding: 12, backgroundColor: '#111',
    borderTopWidth: 1, borderTopColor: '#1A1A1A', gap: 8,
  },
  input: {
    flex: 1, backgroundColor: '#1A1A1A', borderRadius: 20,
    paddingHorizontal: 16, paddingTop: 10, paddingBottom: 10,
    color: '#FFF', fontSize: 15, fontFamily: 'Inter_400Regular', maxHeight: 120,
  },
  sendBtn: {
    backgroundColor: COLORS.primaryGreen, width: 40, height: 40,
    borderRadius: 20, alignItems: 'center', justifyContent: 'center',
  },
  sendBtnDisabled: { backgroundColor: '#222' },
});