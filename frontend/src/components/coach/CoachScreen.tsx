// NeuroFit AI — AI Coach Screen
// FIXED: structured card rendering for workout tables and AI decisions

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

const SUGGESTIONS = [
  "Give me today's chest workout",
  "I deadlifted 150kg x 3 with straps, RPE 9",
  "Only 30 minutes today, what can I do?",
  "My shoulder is clicking today",
  "How's my CNS fatigue looking?",
  "I missed yesterday's session",
];

// Detects if the reply contains a markdown table and renders it as a card
function parseWorkoutTable(text: string): { rows: string[][]; remainder: string } | null {
  const lines = text.split('\n');
  const tableLines: string[] = [];
  const beforeLines: string[] = [];
  const afterLines: string[] = [];
  let inTable = false;
  let pastTable = false;

  for (const line of lines) {
    if (!pastTable && line.trim().startsWith('|')) {
      inTable = true;
      tableLines.push(line);
    } else if (inTable) {
      pastTable = true;
      afterLines.push(line);
    } else {
      beforeLines.push(line);
    }
  }

  if (tableLines.length < 2) return null;

  const rows = tableLines
    .filter((l) => !l.match(/^\s*\|[-:\s|]+\|\s*$/)) // skip separator rows
    .map((l) =>
      l
        .split('|')
        .slice(1, -1)
        .map((c) => c.trim())
    );

  return {
    rows,
    remainder: [...beforeLines, ...afterLines].join('\n').trim(),
  };
}

// Detects key:value metric lines like "Recovery ✅ Excellent"
function parseMetricLines(text: string): { metrics: [string, string][]; remainder: string } | null {
  const lines = text.split('\n');
  const metricLines: [string, string][] = [];
  const others: string[] = [];
  for (const line of lines) {
    const m = line.match(/^([^:•\-]+?)\s{2,}(.+)$/);
    if (m && m[1].trim().length < 30) {
      metricLines.push([m[1].trim(), m[2].trim()]);
    } else {
      others.push(line);
    }
  }
  if (metricLines.length < 2) return null;
  return { metrics: metricLines, remainder: others.join('\n').trim() };
}

function WorkoutTableCard({ rows }: { rows: string[][] }) {
  const [header, ...body] = rows;
  return (
    <View style={tableStyles.card}>
      <View style={tableStyles.headerRow}>
        {header.map((h, i) => (
          <Text key={i} style={tableStyles.headerCell}>{h}</Text>
        ))}
      </View>
      {body.map((row, ri) => (
        <View key={ri} style={[tableStyles.row, ri % 2 === 0 && tableStyles.rowAlt]}>
          {row.map((cell, ci) => (
            <Text key={ci} style={tableStyles.cell}>{cell}</Text>
          ))}
        </View>
      ))}
    </View>
  );
}

function MetricCard({ metrics }: { metrics: [string, string][] }) {
  return (
    <View style={tableStyles.metricCard}>
      {metrics.map(([label, value], i) => (
        <View key={i} style={tableStyles.metricRow}>
          <Text style={tableStyles.metricLabel}>{label}</Text>
          <Text style={tableStyles.metricValue}>{value}</Text>
        </View>
      ))}
    </View>
  );
}

function CoachMessage({ content }: { content: string }) {
  const tableResult = parseWorkoutTable(content);
  if (tableResult) {
    return (
      <>
        {tableResult.remainder ? (
          <Text style={styles.messageText}>{tableResult.remainder}</Text>
        ) : null}
        <WorkoutTableCard rows={tableResult.rows} />
      </>
    );
  }

  const metricResult = parseMetricLines(content);
  if (metricResult) {
    return (
      <>
        {metricResult.remainder ? (
          <Text style={styles.messageText}>{metricResult.remainder}</Text>
        ) : null}
        <MetricCard metrics={metricResult.metrics} />
      </>
    );
  }

  return <Text style={styles.messageText}>{content}</Text>;
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

      addChatMessage('assistant', data.reply);

      if (data.cns_fatigue_score !== null && data.cns_fatigue_score !== undefined) {
        setCnsFatigue(data.cns_fatigue_score);
      }

      if (data.emergency) {
        Alert.alert(
          'Workout Terminated',
          'Injury signal detected. Follow the R.I.C.E protocol in the message below.',
          [{ text: 'Understood', style: 'default' }]
        );
      }

      if (data.new_prs && data.new_prs.length > 0) {
        Alert.alert('New PR!', data.new_prs.map((p: any) => p.message).join('\n'));
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
        <CoachMessage content={item.content} />
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
        <View style={styles.headerIcon}>
          <Ionicons name="flash" size={20} color={COLORS.primaryGreen} />
        </View>
        <View>
          <Text style={styles.headerTitle}>AI Coach</Text>
          <Text style={styles.headerSub}>Your personal AI spotter</Text>
        </View>
      </View>

      {chatHistory.length === 0 ? (
        <View style={styles.emptyState}>
          <Text style={styles.emptyTitle}>What's the move today?</Text>
          <Text style={styles.emptySubtitle}>
            Tell me what you lifted, what you're feeling, or what you need.
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
          keyExtractor={(_, i) => String(i)}
          renderItem={renderMessage}
          contentContainerStyle={styles.messageList}
          showsVerticalScrollIndicator={false}
        />
      )}

      {loading && (
        <View style={styles.loadingRow}>
          <ActivityIndicator color={COLORS.primaryGreen} size="small" />
          <Text style={styles.loadingText}>Coach thinking...</Text>
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

const tableStyles = StyleSheet.create({
  card: {
    backgroundColor: '#1A1A1A', borderRadius: 12, overflow: 'hidden',
    marginTop: 8, borderWidth: 1, borderColor: '#2A2A2A',
  },
  headerRow: {
    flexDirection: 'row', backgroundColor: '#0C1F17',
    paddingVertical: 8, paddingHorizontal: 10,
  },
  headerCell: {
    flex: 1, color: COLORS.primaryGreen, fontSize: 11,
    fontWeight: '700', letterSpacing: 0.5,
  },
  row: { flexDirection: 'row', paddingVertical: 7, paddingHorizontal: 10 },
  rowAlt: { backgroundColor: '#161616' },
  cell: { flex: 1, color: '#C8D2D4', fontSize: 12 },
  metricCard: {
    backgroundColor: '#1A1A1A', borderRadius: 12, overflow: 'hidden',
    marginTop: 8, borderWidth: 1, borderColor: '#2A2A2A',
  },
  metricRow: {
    flexDirection: 'row', justifyContent: 'space-between',
    paddingVertical: 8, paddingHorizontal: 12,
    borderBottomWidth: 1, borderBottomColor: '#222',
  },
  metricLabel: { color: '#888', fontSize: 12 },
  metricValue: { color: '#EEE', fontSize: 12, fontWeight: '600' },
});

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#121212' },
  header: {
    paddingHorizontal: 20, paddingTop: 60, paddingBottom: 12,
    borderBottomWidth: 1, borderBottomColor: '#2A2A2A',
    flexDirection: 'row', alignItems: 'center', gap: 12,
  },
  headerIcon: {
    width: 36, height: 36, borderRadius: 10,
    backgroundColor: '#1A2535', alignItems: 'center', justifyContent: 'center',
  },
  headerTitle: { color: '#FFF', fontSize: 20, fontWeight: '700' },
  headerSub: { color: '#555', fontSize: 12, marginTop: 1 },
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
