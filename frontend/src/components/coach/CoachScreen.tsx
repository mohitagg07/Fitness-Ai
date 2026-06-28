// NeuroFit AI — AI Coach Screen v2
// Rich card rendering: workout cards, nutrition cards, recovery cards, progress cards.
// No more raw text bubbles for structured responses.

import React, { useState, useRef, useEffect } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, FlatList,
  StyleSheet, KeyboardAvoidingView, Platform, ActivityIndicator,
  Alert, ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { coachApi, describeApiError } from '../../utils/api';
import { useStore } from '../../store';
import { COLORS } from '../../theme/colors';
import Logo from '../shared/Logo';

const SUGGESTIONS = [
  "What's my workout today?",
  "I just did Bench Press 80kg × 5 @ RPE 8",
  "How's my recovery looking?",
  "I only have 30 minutes today",
  "My shoulder is sore",
  "What should I eat to hit protein?",
];

// ─── Workout Plan Card ────────────────────────────────────────────────────────
function WorkoutPlanCard({ decision }: { decision: any }) {
  const exercises = decision.exercises || [];
  const summary = decision.summary || {};
  const tips = decision.tips || [];

  const intensityColor = (intensity: string) => {
    if (!intensity) return '#888';
    if (intensity === 'High') return COLORS.recoveryLow;
    if (intensity === 'Moderate') return COLORS.recoveryMed;
    if (intensity === 'Low' || intensity === 'Recovery') return COLORS.recoveryHigh;
    return '#888';
  };

  return (
    <View style={cardStyles.workoutCard}>
      {/* Header */}
      <View style={cardStyles.cardHeader}>
        <View style={cardStyles.headerLeft}>
          <Ionicons name="barbell-outline" size={14} color={COLORS.primaryGreen} />
          <Text style={cardStyles.cardTitle}>TODAY'S WORKOUT</Text>
        </View>
        <View style={[cardStyles.intensityBadge, { borderColor: intensityColor(summary.intensity) }]}>
          <Text style={[cardStyles.intensityText, { color: intensityColor(summary.intensity) }]}>
            {summary.intensity?.toUpperCase() || 'PLANNED'}
          </Text>
        </View>
      </View>

      {/* Exercise table */}
      <View style={cardStyles.tableHeader}>
        <Text style={[cardStyles.tableHead, { flex: 2 }]}>EXERCISE</Text>
        <Text style={cardStyles.tableHead}>SETS</Text>
        <Text style={cardStyles.tableHead}>REPS</Text>
        <Text style={cardStyles.tableHead}>WEIGHT</Text>
      </View>
      {exercises.map((ex: any, i: number) => (
        <View key={i} style={[cardStyles.tableRow, i % 2 === 0 && cardStyles.tableRowAlt]}>
          <View style={{ flex: 2 }}>
            <Text style={cardStyles.exName}>{ex.name}</Text>
            {ex.focus ? <Text style={cardStyles.exFocus}>{ex.focus}</Text> : null}
          </View>
          <Text style={cardStyles.tableCell}>{ex.sets}</Text>
          <Text style={cardStyles.tableCell}>{ex.reps}</Text>
          <Text style={cardStyles.tableCell}>{ex.weight}</Text>
        </View>
      ))}

      {/* Summary row */}
      {(summary.estimated_time || summary.reason) && (
        <View style={cardStyles.summaryRow}>
          {summary.estimated_time && (
            <View style={cardStyles.summaryChip}>
              <Ionicons name="time-outline" size={12} color="#888" />
              <Text style={cardStyles.summaryChipText}>{summary.estimated_time}</Text>
            </View>
          )}
          {summary.reason && (
            <Text style={cardStyles.summaryReason}>{summary.reason}</Text>
          )}
        </View>
      )}

      {/* Tips */}
      {tips.length > 0 && (
        <View style={cardStyles.tipsContainer}>
          {tips.map((tip: string, i: number) => (
            <View key={i} style={cardStyles.tipRow}>
              <View style={cardStyles.tipDot} />
              <Text style={cardStyles.tipText}>{tip}</Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

// ─── Recovery Card ────────────────────────────────────────────────────────────
function RecoveryCard({ decision }: { decision: any }) {
  const recovery = decision.recovery ?? 0;
  const tips = decision.tips || [];
  const recoveryColor = recovery >= 67 ? COLORS.recoveryHigh : recovery >= 34 ? COLORS.recoveryMed : COLORS.recoveryLow;

  return (
    <View style={cardStyles.recoveryCard}>
      <View style={cardStyles.cardHeader}>
        <Ionicons name="pulse-outline" size={14} color={COLORS.strain} />
        <Text style={cardStyles.cardTitle}>RECOVERY STATUS</Text>
      </View>
      <View style={cardStyles.recoveryRow}>
        <View style={cardStyles.recoveryMetric}>
          <Text style={[cardStyles.recoveryScore, { color: recoveryColor }]}>{recovery}%</Text>
          <Text style={cardStyles.recoveryLabel}>RECOVERY</Text>
        </View>
        <View style={cardStyles.recoveryDivider} />
        <View style={{ flex: 1 }}>
          {tips.map((tip: string, i: number) => (
            <View key={i} style={cardStyles.tipRow}>
              <View style={cardStyles.tipDot} />
              <Text style={cardStyles.tipText}>{tip}</Text>
            </View>
          ))}
        </View>
      </View>
    </View>
  );
}

// ─── Nutrition Card ───────────────────────────────────────────────────────────
function NutritionCard({ decision }: { decision: any }) {
  const tips = decision.tips || [];
  return (
    <View style={cardStyles.nutritionCard}>
      <View style={cardStyles.cardHeader}>
        <Ionicons name="nutrition-outline" size={14} color={COLORS.calories} />
        <Text style={cardStyles.cardTitle}>NUTRITION ADVICE</Text>
      </View>
      {tips.map((tip: string, i: number) => (
        <View key={i} style={cardStyles.tipRow}>
          <View style={[cardStyles.tipDot, { backgroundColor: COLORS.calories }]} />
          <Text style={cardStyles.tipText}>{tip}</Text>
        </View>
      ))}
    </View>
  );
}

// ─── Live Set Card ────────────────────────────────────────────────────────────
function LiveSetCard({ decision }: { decision: any }) {
  const tips = decision.tips || [];
  return (
    <View style={cardStyles.liveSetCard}>
      <View style={cardStyles.cardHeader}>
        <Ionicons name="flash" size={14} color={COLORS.primaryGreen} />
        <Text style={cardStyles.cardTitle}>SET ANALYSIS</Text>
      </View>
      {decision.next_action && (
        <Text style={cardStyles.nextAction}>{decision.next_action}</Text>
      )}
      {tips.map((tip: string, i: number) => (
        <View key={i} style={cardStyles.tipRow}>
          <View style={cardStyles.tipDot} />
          <Text style={cardStyles.tipText}>{tip}</Text>
        </View>
      ))}
      {decision.coach_insight && (
        <Text style={cardStyles.coachInsight}>"{decision.coach_insight}"</Text>
      )}
    </View>
  );
}

// ─── Message renderer ─────────────────────────────────────────────────────────
function CoachMessage({ item }: { item: any }) {
  const sd = item.structured_decision;

  // coach_message is always shown as the main bubble text
  const coachText = sd?.coach_message || item.content || '';

  const renderCard = () => {
    if (!sd) return null;
    switch (sd.response_type) {
      case 'workout_plan':
        return sd.exercises?.length > 0 ? <WorkoutPlanCard decision={sd} /> : null;
      case 'live_set':
        return <LiveSetCard decision={sd} />;
      case 'recovery_advice':
        return <RecoveryCard decision={sd} />;
      case 'nutrition_tip':
        return <NutritionCard decision={sd} />;
      default:
        // chat / progress_update — just text + tips
        if ((sd.tips || []).length > 0) {
          return (
            <View style={cardStyles.tipsContainer}>
              {(sd.tips || []).map((tip: string, i: number) => (
                <View key={i} style={cardStyles.tipRow}>
                  <View style={cardStyles.tipDot} />
                  <Text style={cardStyles.tipText}>{tip}</Text>
                </View>
              ))}
            </View>
          );
        }
        return null;
    }
  };

  return (
    <>
      {coachText ? <Text style={styles.messageText}>{coachText}</Text> : null}
      {renderCard()}
    </>
  );
}

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

      // Store structured_decision alongside the message so CoachMessage can render it
      addChatMessage('assistant', data.reply, data.structured_decision);

      if (data.cns_fatigue_score !== null && data.cns_fatigue_score !== undefined) {
        setCnsFatigue(data.cns_fatigue_score);
      }

      if (data.emergency) {
        Alert.alert(
          '⚠️ Training Stopped',
          'Injury signal detected. See the message below.',
          [{ text: 'Understood', style: 'default' }]
        );
      }

      if (data.new_prs && data.new_prs.length > 0) {
        Alert.alert('🏆 New PR!', data.new_prs.map((p: any) => p.message).join('\n'));
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

  const renderMessage = ({ item }: { item: any }) => (
    <View style={[styles.bubble, item.role === 'user' ? styles.userBubble : styles.aiBubble]}>
      {item.role === 'assistant' && (
        <View style={styles.roleLabelRow}>
          <Ionicons name="flash" size={10} color={COLORS.primaryGreen} />
          <Text style={styles.roleLabel}>NEUROFIT COACH</Text>
        </View>
      )}
      {item.role === 'assistant' ? (
        <CoachMessage item={item} />
      ) : (
        <Text style={[styles.messageText, styles.userText]}>{item.content}</Text>
      )}
    </View>
  );

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={90}
    >
      {/* Header */}
      <View style={styles.header}>
        <Logo size="sm" />
        <Text style={styles.headerSub}>AI Coach</Text>
      </View>

      {chatHistory.length === 0 ? (
        <View style={styles.emptyState}>
          <Text style={styles.emptyTitle}>What's the move today?</Text>
          <Text style={styles.emptySubtitle}>
            Tell me what you lifted, how you're feeling, or what you need.
          </Text>
          <View style={styles.suggestions}>
            {SUGGESTIONS.map((s, i) => (
              <TouchableOpacity key={i} style={styles.suggestion} onPress={() => sendMessage(s)}>
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
          keyExtractor={(_: unknown, i: number) => String(i)}
          renderItem={renderMessage}
          contentContainerStyle={styles.messageList}
          showsVerticalScrollIndicator={false}
        />
      )}

      {loading && (
        <View style={styles.loadingRow}>
          <ActivityIndicator color={COLORS.primaryGreen} size="small" />
          <Text style={styles.loadingText}>Coach is thinking...</Text>
        </View>
      )}

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
          style={[styles.sendBtn, (!input.trim() || loading) && styles.sendBtnDisabled]}
          onPress={() => sendMessage()}
          disabled={!input.trim() || loading}
        >
          <Ionicons name="arrow-up" size={18} color={input.trim() && !loading ? COLORS.background : COLORS.textMuted} />
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const cardStyles = StyleSheet.create({
  workoutCard: {
    backgroundColor: '#111', borderRadius: 14, overflow: 'hidden',
    marginTop: 10, borderWidth: 1, borderColor: '#222',
  },
  recoveryCard: {
    backgroundColor: '#0A1520', borderRadius: 14, overflow: 'hidden',
    marginTop: 10, borderWidth: 1, borderColor: '#1A2A3A',
  },
  nutritionCard: {
    backgroundColor: '#1A0F00', borderRadius: 14, overflow: 'hidden',
    marginTop: 10, borderWidth: 1, borderColor: '#2A1800',
  },
  liveSetCard: {
    backgroundColor: '#0C1F17', borderRadius: 14, overflow: 'hidden',
    marginTop: 10, borderWidth: 1, borderColor: '#163A22',
  },
  cardHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 12, paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: '#1E1E1E',
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 },
  cardTitle: {
    color: '#888', fontSize: 10, fontWeight: '700', letterSpacing: 1.5,
  },
  intensityBadge: {
    borderWidth: 1, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2,
  },
  intensityText: { fontSize: 9, fontWeight: '700', letterSpacing: 1 },
  tableHeader: {
    flexDirection: 'row', paddingHorizontal: 12, paddingVertical: 6,
    backgroundColor: '#0A0A0A',
  },
  tableHead: {
    flex: 1, color: COLORS.primaryGreen, fontSize: 9,
    fontWeight: '700', letterSpacing: 0.5,
  },
  tableRow: { flexDirection: 'row', paddingHorizontal: 12, paddingVertical: 10, alignItems: 'flex-start' },
  tableRowAlt: { backgroundColor: '#0D0D0D' },
  exName: { color: '#E8E8E8', fontSize: 13, fontWeight: '600' },
  exFocus: { color: '#555', fontSize: 11, marginTop: 2, fontStyle: 'italic' },
  tableCell: { flex: 1, color: '#AAA', fontSize: 13, fontWeight: '500' },
  summaryRow: {
    flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8,
    paddingHorizontal: 12, paddingVertical: 8, borderTopWidth: 1, borderTopColor: '#1A1A1A',
  },
  summaryChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: '#1A1A1A', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4,
  },
  summaryChipText: { color: '#888', fontSize: 11 },
  summaryReason: { color: '#666', fontSize: 12, flex: 1 },
  tipsContainer: { paddingHorizontal: 12, paddingVertical: 8, gap: 6 },
  tipRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginBottom: 4 },
  tipDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: COLORS.primaryGreen, marginTop: 5 },
  tipText: { color: '#AAA', fontSize: 12, flex: 1, lineHeight: 17 },
  recoveryRow: { flexDirection: 'row', padding: 12, alignItems: 'center', gap: 12 },
  recoveryMetric: { alignItems: 'center' },
  recoveryScore: { fontSize: 32, fontWeight: '800' },
  recoveryLabel: { color: '#555', fontSize: 9, fontWeight: '700', letterSpacing: 1, marginTop: 2 },
  recoveryDivider: { width: 1, height: 40, backgroundColor: '#1E1E1E' },
  nextAction: { color: COLORS.primaryGreen, fontSize: 18, fontWeight: '700', margin: 12 },
  coachInsight: { color: '#555', fontSize: 12, fontStyle: 'italic', margin: 12, marginTop: 4 },
});

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#121212' },
  header: {
    paddingHorizontal: 20, paddingTop: 60, paddingBottom: 12,
    borderBottomWidth: 1, borderBottomColor: '#2A2A2A',
    gap: 4,
  },
  headerSub: { color: '#888', fontSize: 13, fontWeight: '600' },
  messageList: { padding: 16, paddingBottom: 8 },
  bubble: { marginBottom: 12, borderRadius: 16, padding: 14, maxWidth: '90%' },
  userBubble: { backgroundColor: '#1E3A5F', alignSelf: 'flex-end' },
  aiBubble: {
    backgroundColor: '#1E1E1E', alignSelf: 'flex-start',
    borderWidth: 1, borderColor: '#2A2A2A', maxWidth: '96%',
  },
  roleLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 6 },
  roleLabel: { color: COLORS.primaryGreen, fontSize: 10, fontWeight: '700', letterSpacing: 1.5 },
  messageText: { color: '#E8E8E8', fontSize: 15, lineHeight: 22 },
  userText: { color: '#FFF' },
  emptyState: { flex: 1, padding: 24, justifyContent: 'center' },
  emptyTitle: { color: '#FFF', fontSize: 22, fontWeight: '700', marginBottom: 8 },
  emptySubtitle: { color: '#888', fontSize: 14, marginBottom: 28, lineHeight: 20 },
  suggestions: { gap: 8 },
  suggestion: {
    backgroundColor: '#1E1E1E', borderRadius: 12,
    padding: 14, borderWidth: 1, borderColor: '#2A2A2A',
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
  },
  suggestionText: { color: '#C0C0C0', fontSize: 13, flex: 1 },
  loadingRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 20, paddingVertical: 8, gap: 10,
  },
  loadingText: { color: '#555', fontSize: 13 },
  inputRow: {
    flexDirection: 'row', alignItems: 'flex-end', gap: 10,
    padding: 12, borderTopWidth: 1, borderTopColor: '#2A2A2A',
  },
  input: {
    flex: 1, backgroundColor: '#2A2A2A', borderRadius: 22,
    paddingHorizontal: 16, paddingVertical: 10, color: '#FFF',
    fontSize: 15, maxHeight: 100,
  },
  sendBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: COLORS.primaryGreen, alignItems: 'center', justifyContent: 'center',
  },
  sendBtnDisabled: { backgroundColor: '#2A2A2A' },
});