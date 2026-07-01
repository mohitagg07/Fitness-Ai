// VYRN — AI Coach Screen v3
// Full 7-card response system:
//   workout_plan  → WorkoutCard   (exercise table + rest + intensity)
//   live_set      → LiveSetCard   (set analysis + next action + insight)
//   nutrition_tip → NutritionCard (macro targets + advice)
//   recovery_advice→ RecoveryCard (score ring + tips)
//   progress_update→ ProgressCard (PR highlights + trend)
//   weekly_summary→ WeeklyCard   (7-day overview)
//   chat          → ChatBubble   (plain text + optional tips)
// The LLM returns structured JSON; the frontend picks the card.

import React, { useState, useRef, useEffect } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, FlatList,
  StyleSheet, KeyboardAvoidingView, Platform, ActivityIndicator,
  Alert, ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { coachApi, describeApiError } from '../../utils/api';
import { useStore } from '../../store';
import { COLORS, recoveryColor } from '../../theme/colors';
import Logo from '../shared/Logo';
import CoachMemoryModal from './CoachMemoryModal';

// ─── Suggestion chips shown on empty state ────────────────────────────────────
const SUGGESTIONS = [
  { icon: 'barbell-outline',    text: "What's my workout today?" },
  { icon: 'flash-outline',      text: "I just did Bench Press 80kg × 5 @ RPE 8" },
  { icon: 'pulse-outline',      text: "How's my recovery looking?" },
  { icon: 'time-outline',       text: "I only have 30 minutes today" },
  { icon: 'medical-outline',    text: "My shoulder is sore" },
  { icon: 'nutrition-outline',  text: "What should I eat to hit protein?" },
];

// ─── Shared primitives ────────────────────────────────────────────────────────
function CardShell({
  color,
  icon,
  label,
  accent,
  children,
}: {
  color: string;
  icon: string;
  label: string;
  accent: string;
  children: React.ReactNode;
}) {
  return (
    <View style={[C.shell, { borderColor: accent + '40', backgroundColor: color }]}>
      <View style={[C.shellHeader, { borderBottomColor: accent + '25' }]}>
        <Ionicons name={icon as any} size={13} color={accent} />
        <Text style={[C.shellLabel, { color: accent }]}>{label}</Text>
      </View>
      {children}
    </View>
  );
}

function TipRow({ text, accent = COLORS.recoveryHigh }: { text: string; accent?: string }) {
  return (
    <View style={C.tipRow}>
      <View style={[C.tipDot, { backgroundColor: accent }]} />
      <Text style={C.tipText}>{text}</Text>
    </View>
  );
}

// ─── 1. Workout Plan Card ─────────────────────────────────────────────────────
function WorkoutCard({ sd }: { sd: any }) {
  const exercises = sd.exercises || [];
  const summary   = sd.summary   || {};
  const tips      = sd.tips      || [];

  const intColor = (i: string) => {
    if (!i) return COLORS.textMuted;
    if (i === 'High')     return COLORS.recoveryLow;
    if (i === 'Moderate') return COLORS.recoveryMed;
    return COLORS.recoveryHigh;
  };
  const ic = intColor(summary.intensity);

  return (
    <CardShell color="#0B120A" icon="barbell-outline" label="TODAY'S WORKOUT" accent={COLORS.recoveryHigh}>
      {/* Intensity + meta row */}
      <View style={C.wMeta}>
        <View style={[C.intensityPill, { borderColor: ic }]}>
          <Text style={[C.intensityText, { color: ic }]}>
            {summary.intensity?.toUpperCase() || 'PLANNED'}
          </Text>
        </View>
        {summary.estimated_time && (
          <View style={C.metaChip}>
            <Ionicons name="time-outline" size={11} color={COLORS.textMuted} />
            <Text style={C.metaChipText}>{summary.estimated_time}</Text>
          </View>
        )}
        {sd.recovery != null && (
          <View style={C.metaChip}>
            <Ionicons name="pulse-outline" size={11} color={recoveryColor(sd.recovery)} />
            <Text style={[C.metaChipText, { color: recoveryColor(sd.recovery) }]}>
              {sd.recovery}%
            </Text>
          </View>
        )}
      </View>

      {/* Table */}
      <View style={C.tableWrap}>
        <View style={C.tableHead}>
          <Text style={[C.th, { flex: 2.2 }]}>EXERCISE</Text>
          <Text style={C.th}>SETS</Text>
          <Text style={C.th}>REPS</Text>
          <Text style={C.th}>LOAD</Text>
          <Text style={C.th}>REST</Text>
        </View>
        {exercises.map((ex: any, i: number) => (
          <View key={i} style={[C.tableRow, i % 2 === 1 && C.tableRowAlt]}>
            <View style={{ flex: 2.2 }}>
              <Text style={C.exName}>{ex.name}</Text>
              {ex.focus ? <Text style={C.exFocus}>{ex.focus}</Text> : null}
            </View>
            <Text style={C.td}>{ex.sets}</Text>
            <Text style={C.td}>{ex.reps}</Text>
            <Text style={C.td}>{ex.weight || '—'}</Text>
            <Text style={C.td}>{ex.rest   || '—'}</Text>
          </View>
        ))}
      </View>

      {/* Reason */}
      {summary.reason ? (
        <View style={C.reasonRow}>
          <Text style={C.reasonText}>{summary.reason}</Text>
        </View>
      ) : null}

      {/* Tips */}
      {tips.length > 0 && (
        <View style={C.tipsBlock}>
          {tips.map((t: string, i: number) => <TipRow key={i} text={t} />)}
        </View>
      )}
    </CardShell>
  );
}

// ─── 2. Live Set Card ─────────────────────────────────────────────────────────
function LiveSetCard({ sd }: { sd: any }) {
  const tips = sd.tips || [];
  return (
    <CardShell color="#08140F" icon="flash" label="SET ANALYSIS" accent={COLORS.strainGlow}>
      {sd.next_action && (
        <View style={C.nextActionBlock}>
          <Text style={C.nextActionLabel}>NEXT ACTION</Text>
          <Text style={C.nextActionText}>{sd.next_action}</Text>
        </View>
      )}
      {tips.length > 0 && (
        <View style={C.tipsBlock}>
          {tips.map((t: string, i: number) => <TipRow key={i} text={t} accent={COLORS.strainGlow} />)}
        </View>
      )}
      {sd.coach_insight && (
        <View style={C.insightBlock}>
          <Text style={C.insightText}>"{sd.coach_insight}"</Text>
        </View>
      )}
    </CardShell>
  );
}

// ─── 3. Recovery Card ─────────────────────────────────────────────────────────
function RecoveryCard({ sd }: { sd: any }) {
  const score = sd.recovery ?? 0;
  const rc    = recoveryColor(score);
  const tips  = sd.tips || [];
  const label = score >= 67 ? 'HIGH' : score >= 34 ? 'MEDIUM' : 'LOW';

  return (
    <CardShell color="#050F1A" icon="pulse-outline" label="RECOVERY STATUS" accent={COLORS.strain}>
      <View style={C.recoveryBody}>
        {/* Score block */}
        <View style={C.recoveryScoreBlock}>
          <Text style={[C.recoveryScoreNum, { color: rc }]}>{score}</Text>
          <Text style={C.recoveryScoreUnit}>%</Text>
          <View style={[C.recoveryZonePill, { backgroundColor: rc + '22', borderColor: rc + '66' }]}>
            <Text style={[C.recoveryZoneText, { color: rc }]}>{label}</Text>
          </View>
        </View>
        {/* Divider */}
        <View style={C.recoveryDivider} />
        {/* Tips */}
        <View style={C.recoveryTips}>
          {tips.length > 0
            ? tips.map((t: string, i: number) => <TipRow key={i} text={t} accent={COLORS.strain} />)
            : <Text style={C.emptyTip}>No specific recommendations today.</Text>
          }
        </View>
      </View>
    </CardShell>
  );
}

// ─── 4. Nutrition Card ────────────────────────────────────────────────────────
function NutritionCard({ sd }: { sd: any }) {
  const tips = sd.tips || [];
  // Optionally the backend may include macro targets
  const macros = sd.macros || null;

  return (
    <CardShell color="#120A00" icon="nutrition-outline" label="NUTRITION ADVICE" accent={COLORS.calories}>
      {macros && (
        <View style={C.macroRow}>
          {macros.protein != null && (
            <View style={C.macroChip}>
              <Text style={[C.macroVal, { color: COLORS.protein }]}>{macros.protein}g</Text>
              <Text style={C.macroLabel}>PROTEIN</Text>
            </View>
          )}
          {macros.carbs != null && (
            <View style={C.macroChip}>
              <Text style={[C.macroVal, { color: COLORS.carbs }]}>{macros.carbs}g</Text>
              <Text style={C.macroLabel}>CARBS</Text>
            </View>
          )}
          {macros.fat != null && (
            <View style={C.macroChip}>
              <Text style={[C.macroVal, { color: COLORS.fat }]}>{macros.fat}g</Text>
              <Text style={C.macroLabel}>FAT</Text>
            </View>
          )}
          {macros.calories != null && (
            <View style={C.macroChip}>
              <Text style={[C.macroVal, { color: COLORS.calories }]}>{macros.calories}</Text>
              <Text style={C.macroLabel}>KCAL</Text>
            </View>
          )}
        </View>
      )}
      {tips.length > 0 && (
        <View style={C.tipsBlock}>
          {tips.map((t: string, i: number) => <TipRow key={i} text={t} accent={COLORS.calories} />)}
        </View>
      )}
    </CardShell>
  );
}

// ─── 5. Progress / PR Card ────────────────────────────────────────────────────
function ProgressCard({ sd }: { sd: any }) {
  const tips = sd.tips || [];
  const prs  = sd.new_prs || sd.prs || [];

  return (
    <CardShell color="#0A0A16" icon="trophy-outline" label="PROGRESS UPDATE" accent={COLORS.recoveryBlue}>
      {prs.length > 0 && (
        <View style={C.prBlock}>
          <Text style={C.prBlockLabel}>NEW PRs</Text>
          {prs.map((pr: any, i: number) => (
            <View key={i} style={C.prRow}>
              <Ionicons name="trophy" size={14} color="#FFD700" />
              <Text style={C.prText}>
                {pr.exercise_name || pr.exercise}: {pr.weight_kg || pr.weight} kg × {pr.reps} reps
              </Text>
            </View>
          ))}
        </View>
      )}
      {sd.trend && (
        <View style={C.trendRow}>
          <Ionicons
            name={sd.trend === 'up' ? 'trending-up' : sd.trend === 'down' ? 'trending-down' : 'remove'}
            size={18}
            color={sd.trend === 'up' ? COLORS.recoveryHigh : sd.trend === 'down' ? COLORS.recoveryLow : COLORS.textMuted}
          />
          <Text style={C.trendText}>{sd.trend_label || sd.trend}</Text>
        </View>
      )}
      {tips.length > 0 && (
        <View style={C.tipsBlock}>
          {tips.map((t: string, i: number) => <TipRow key={i} text={t} accent={COLORS.recoveryBlue} />)}
        </View>
      )}
    </CardShell>
  );
}

// ─── 6. Weekly Summary Card ───────────────────────────────────────────────────
function WeeklyCard({ sd }: { sd: any }) {
  const days  = sd.days  || [];
  const stats = sd.stats || {};
  const tips  = sd.tips  || [];

  return (
    <CardShell color="#0A0A0A" icon="calendar-outline" label="WEEKLY SUMMARY" accent={COLORS.strain}>
      {/* Stat pills */}
      {Object.keys(stats).length > 0 && (
        <View style={C.weeklyStats}>
          {stats.sessions != null && (
            <View style={C.weeklyStatChip}>
              <Text style={C.weeklyStatVal}>{stats.sessions}</Text>
              <Text style={C.weeklyStatLabel}>SESSIONS</Text>
            </View>
          )}
          {stats.total_volume_kg != null && (
            <View style={C.weeklyStatChip}>
              <Text style={C.weeklyStatVal}>{Math.round(stats.total_volume_kg / 1000)}t</Text>
              <Text style={C.weeklyStatLabel}>VOLUME</Text>
            </View>
          )}
          {stats.avg_recovery != null && (
            <View style={C.weeklyStatChip}>
              <Text style={[C.weeklyStatVal, { color: recoveryColor(stats.avg_recovery) }]}>
                {stats.avg_recovery}%
              </Text>
              <Text style={C.weeklyStatLabel}>AVG REC</Text>
            </View>
          )}
          {stats.protein_days != null && (
            <View style={C.weeklyStatChip}>
              <Text style={C.weeklyStatVal}>{stats.protein_days}/7</Text>
              <Text style={C.weeklyStatLabel}>PROTEIN</Text>
            </View>
          )}
        </View>
      )}
      {/* Day-by-day mini view */}
      {days.length > 0 && (
        <View style={C.weekDays}>
          {days.map((d: any, i: number) => (
            <View key={i} style={C.weekDay}>
              <Text style={C.weekDayLabel}>{d.label || d.day}</Text>
              <View style={[
                C.weekDayDot,
                { backgroundColor: d.trained ? COLORS.recoveryHigh : d.rest ? COLORS.textDim : COLORS.recoveryLow }
              ]} />
            </View>
          ))}
        </View>
      )}
      {tips.length > 0 && (
        <View style={C.tipsBlock}>
          {tips.map((t: string, i: number) => <TipRow key={i} text={t} accent={COLORS.strain} />)}
        </View>
      )}
    </CardShell>
  );
}

// ─── 7. Chat bubble tips (fallback) ──────────────────────────────────────────
function ChatTipsCard({ tips }: { tips: string[] }) {
  if (!tips.length) return null;
  return (
    <View style={C.chatTipsCard}>
      {tips.map((t, i) => <TipRow key={i} text={t} />)}
    </View>
  );
}

// ─── Message renderer — picks the right card ──────────────────────────────────
function CoachMessage({ item }: { item: any }) {
  const sd        = item.structured_decision;
  const coachText = sd?.coach_message || item.content || '';

  const renderCard = () => {
    if (!sd) return null;
    switch (sd.response_type) {
      case 'workout_plan':    return (sd.exercises?.length > 0) ? <WorkoutCard   sd={sd} /> : null;
      case 'live_set':        return <LiveSetCard   sd={sd} />;
      case 'recovery_advice': return <RecoveryCard  sd={sd} />;
      case 'nutrition_tip':   return <NutritionCard sd={sd} />;
      case 'progress_update': return <ProgressCard  sd={sd} />;
      case 'weekly_summary':  return <WeeklyCard    sd={sd} />;
      default:
        return (sd.tips?.length > 0) ? <ChatTipsCard tips={sd.tips} /> : null;
    }
  };

  return (
    <>
      {coachText ? <Text style={S.messageText}>{coachText}</Text> : null}
      {renderCard()}
    </>
  );
}

// ─── Loading animation dots ───────────────────────────────────────────────────
function ThinkingDots() {
  const [dot, setDot] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setDot(d => (d + 1) % 4), 420);
    return () => clearInterval(t);
  }, []);
  const dots = '.'.repeat(dot) + '\u00A0'.repeat(3 - dot);
  return (
    <View style={S.thinkingRow}>
      <View style={S.thinkingAvatar}>
        <Ionicons name="flash" size={12} color={COLORS.recoveryHigh} />
      </View>
      <View style={S.thinkingBubble}>
        <Text style={S.thinkingText}>Coach is thinking{dots}</Text>
      </View>
    </View>
  );
}

// ─── Offline/fallback responses when backend is unreachable ──────────────────
const OFFLINE_RESPONSES: Record<string, string> = {
  default:
    "I'm having trouble reaching the server right now. " +
    "Make sure the backend is running and EXPO_PUBLIC_API_URL is set to your machine's LAN IP. " +
    "In the meantime, here's what I'd suggest: log your sets, check your recovery score on the dashboard, and keep your protein intake on track.",
  workout:
    "I can't pull your live plan right now (server offline), but here's a general template: " +
    "Warm-up 5 min → Main lifts 3–4 sets × 5 reps → Accessories 3 × 8–12 → Cool-down. " +
    "Use RPE 7–8 for main lifts. Log your sets when you're back online.",
  recovery:
    "Server is offline, so I can't check your real-time recovery data. " +
    "Rule of thumb: if you slept <7 hrs or feel sore/sluggish, drop intensity 20% today. " +
    "Prioritise sleep, hydration, and 0.8–1g protein per lb bodyweight.",
  nutrition:
    "Can't reach the server, but here's the universal formula: " +
    "protein = 0.8–1g per lb bodyweight, calories = TDEE ± 200 depending on your goal, " +
    "carbs = fill remaining calories after protein & fat. Log meals when reconnected.",
};

function getOfflineFallback(message: string): string {
  const m = message.toLowerCase();
  if (m.includes('workout') || m.includes('exercise') || m.includes('gym') || m.includes('train'))
    return OFFLINE_RESPONSES.workout;
  if (m.includes('recovery') || m.includes('tired') || m.includes('sore') || m.includes('sleep'))
    return OFFLINE_RESPONSES.recovery;
  if (m.includes('eat') || m.includes('protein') || m.includes('nutrition') || m.includes('calorie'))
    return OFFLINE_RESPONSES.nutrition;
  return OFFLINE_RESPONSES.default;
}

// ─── Main Screen ──────────────────────────────────────────────────────────────
export default function CoachScreen() {
  const [input, setInput]   = useState('');
  const [loading, setLoading] = useState(false);
  const [serverStatus, setServerStatus] = useState<'online' | 'offline' | 'unknown'>('unknown');
  const [memoryVisible, setMemoryVisible] = useState(false);
  const flatListRef = useRef<FlatList>(null);
  const { chatHistory, addChatMessage, setCnsFatigue, activeSession } = useStore();

  const sendMessage = async (text?: string) => {
    const message = text || input.trim();
    if (!message || loading) return;

    setInput('');
    addChatMessage('user', message);
    setLoading(true);

    try {
      const res  = await coachApi.chat(message, activeSession?.id);
      const data = res.data;

      setServerStatus('online');
      addChatMessage('assistant', data.reply, data.structured_decision);

      if (data.cns_fatigue_score != null) setCnsFatigue(data.cns_fatigue_score);

      if (data.emergency) {
        Alert.alert('⚠️ Training Stopped', 'Injury signal detected. See the message below.', [
          { text: 'Understood', style: 'default' },
        ]);
      }
      if (data.new_prs?.length > 0) {
        Alert.alert('🏆 New PR!', data.new_prs.map((p: any) => p.message).join('\n'));
      }
    } catch (err: any) {
      const { kind, message: errMsg } = describeApiError(err);
      setServerStatus('offline');
      // For network/server errors, give a helpful fallback instead of raw error
      if (kind === 'network' || kind === 'server' || kind === 'timeout') {
        const fallback = getOfflineFallback(message);
        addChatMessage('assistant', fallback);
      } else {
        addChatMessage('assistant', errMsg);
      }
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
    <View style={[S.bubble, item.role === 'user' ? S.userBubble : S.aiBubble]}>
      {item.role === 'assistant' && (
        <View style={S.roleLabelRow}>
          <Ionicons name="flash" size={10} color={COLORS.recoveryHigh} />
          <Text style={S.roleLabel}>COACH</Text>
        </View>
      )}
      {item.role === 'assistant'
        ? <CoachMessage item={item} />
        : <Text style={[S.messageText, S.userText]}>{item.content}</Text>
      }
    </View>
  );

  return (
    <KeyboardAvoidingView
      style={S.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={90}
    >
      {/* Header */}
      <View style={S.header}>
        <View style={S.headerTopRow}>
          <Logo size="sm" />
          <TouchableOpacity style={S.memoryBtn} onPress={() => setMemoryVisible(true)}>
            <Ionicons name="sparkles-outline" size={14} color={COLORS.primaryGreen} />
            <Text style={S.memoryBtnText}>Memory</Text>
          </TouchableOpacity>
        </View>
        <Text style={S.headerSub}>AI Coach</Text>
      </View>
      <CoachMemoryModal visible={memoryVisible} onClose={() => setMemoryVisible(false)} />

      {/* Offline warning banner */}
      {serverStatus === 'offline' && (
        <View style={S.offlineBanner}>
          <Ionicons name="cloud-offline-outline" size={13} color={COLORS.recoveryMed} />
          <Text style={S.offlineBannerText}>
            Server offline — responses are smart fallbacks. Check EXPO_PUBLIC_API_URL.
          </Text>
        </View>
      )}

      {/* Empty state */}
      {chatHistory.length === 0 ? (
        <ScrollView style={S.emptyScroll} contentContainerStyle={S.emptyContent}>
          <View style={S.emptyHero}>
            <View style={S.emptyIcon}>
              <Ionicons name="flash" size={28} color={COLORS.recoveryHigh} />
            </View>
            <Text style={S.emptyTitle}>What's the move today?</Text>
            <Text style={S.emptySubtitle}>
              Log a set, ask for a plan, or just tell me how you're feeling.
            </Text>
          </View>
          <View style={S.suggestions}>
            {SUGGESTIONS.map((s, i) => (
              <TouchableOpacity key={i} style={S.suggestion} onPress={() => sendMessage(s.text)}>
                <View style={S.suggestionIcon}>
                  <Ionicons name={s.icon as any} size={15} color={COLORS.recoveryHigh} />
                </View>
                <Text style={S.suggestionText}>{s.text}</Text>
                <Ionicons name="arrow-forward-outline" size={14} color={COLORS.textDim} />
              </TouchableOpacity>
            ))}
          </View>
        </ScrollView>
      ) : (
        <FlatList
          ref={flatListRef}
          data={chatHistory}
          keyExtractor={(_: unknown, i: number) => String(i)}
          renderItem={renderMessage}
          contentContainerStyle={S.messageList}
          showsVerticalScrollIndicator={false}
        />
      )}

      {/* Thinking indicator */}
      {loading && <ThinkingDots />}

      {/* Input row */}
      <View style={S.inputRow}>
        <TextInput
          style={S.input}
          value={input}
          onChangeText={setInput}
          placeholder="Log a set, ask anything..."
          placeholderTextColor={COLORS.textDim}
          multiline
          maxLength={2000}
          onSubmitEditing={() => sendMessage()}
          blurOnSubmit={false}
        />
        <TouchableOpacity
          style={[S.sendBtn, (!input.trim() || loading) && S.sendBtnOff]}
          onPress={() => sendMessage()}
          disabled={!input.trim() || loading}
        >
          <Ionicons
            name="arrow-up"
            size={18}
            color={input.trim() && !loading ? COLORS.background : COLORS.textDim}
          />
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

// ─── Card styles (C) ──────────────────────────────────────────────────────────
const C = StyleSheet.create({
  // Shell
  shell:       { borderRadius: 16, overflow: 'hidden', marginTop: 12, borderWidth: 1 },
  shellHeader: { flexDirection: 'row', alignItems: 'center', gap: 7,
                 paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: 1 },
  shellLabel:  { fontSize: 10, fontWeight: '700', letterSpacing: 1.6 },

  // Tips
  tipsBlock: { paddingHorizontal: 14, paddingVertical: 10, gap: 6 },
  tipRow:    { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  tipDot:    { width: 5, height: 5, borderRadius: 3, marginTop: 6 },
  tipText:   { color: COLORS.textSecondary, fontSize: 12, flex: 1, lineHeight: 18 },
  emptyTip:  { color: COLORS.textMuted, fontSize: 12 },

  // Workout card
  wMeta:         { flexDirection: 'row', alignItems: 'center', gap: 8,
                   paddingHorizontal: 14, paddingVertical: 10 },
  intensityPill: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  intensityText: { fontSize: 9, fontWeight: '800', letterSpacing: 1.2 },
  metaChip:      { flexDirection: 'row', alignItems: 'center', gap: 4,
                   backgroundColor: COLORS.cardElevated, borderRadius: 8,
                   paddingHorizontal: 8, paddingVertical: 3 },
  metaChipText:  { color: COLORS.textMuted, fontSize: 11, fontWeight: '600' },

  tableWrap:  { borderTopWidth: 1, borderTopColor: '#1A1A1A' },
  tableHead:  { flexDirection: 'row', paddingHorizontal: 14, paddingVertical: 6,
                backgroundColor: '#050505' },
  th:         { flex: 1, color: COLORS.recoveryHigh, fontSize: 9, fontWeight: '700', letterSpacing: 0.6 },
  tableRow:   { flexDirection: 'row', paddingHorizontal: 14, paddingVertical: 11, alignItems: 'flex-start' },
  tableRowAlt:{ backgroundColor: '#0A0A0A' },
  exName:     { color: '#E8E8E8', fontSize: 13, fontWeight: '600' },
  exFocus:    { color: COLORS.textMuted, fontSize: 11, marginTop: 2, fontStyle: 'italic' },
  td:         { flex: 1, color: '#AAAAAA', fontSize: 12, fontWeight: '500' },

  reasonRow:  { paddingHorizontal: 14, paddingVertical: 10,
                borderTopWidth: 1, borderTopColor: '#1A1A1A' },
  reasonText: { color: COLORS.textMuted, fontSize: 12, lineHeight: 18 },

  // Live set card
  nextActionBlock: { paddingHorizontal: 14, paddingTop: 12, paddingBottom: 8 },
  nextActionLabel: { color: COLORS.strainGlow, fontSize: 9, fontWeight: '800',
                     letterSpacing: 1.5, marginBottom: 4 },
  nextActionText:  { color: '#E8E8E8', fontSize: 20, fontWeight: '800', lineHeight: 26 },
  insightBlock:    { paddingHorizontal: 14, paddingVertical: 10,
                     borderTopWidth: 1, borderTopColor: '#111' },
  insightText:     { color: COLORS.textMuted, fontSize: 12, fontStyle: 'italic' },

  // Recovery card
  recoveryBody:       { flexDirection: 'row', padding: 14, alignItems: 'center', gap: 14 },
  recoveryScoreBlock: { alignItems: 'center', minWidth: 72 },
  recoveryScoreNum:   { fontSize: 42, fontWeight: '800', lineHeight: 48 },
  recoveryScoreUnit:  { color: COLORS.textMuted, fontSize: 14, fontWeight: '600', marginTop: -6 },
  recoveryZonePill:   { borderWidth: 1, borderRadius: 8, paddingHorizontal: 8,
                        paddingVertical: 3, marginTop: 6 },
  recoveryZoneText:   { fontSize: 9, fontWeight: '800', letterSpacing: 1.2 },
  recoveryDivider:    { width: 1, height: 52, backgroundColor: '#1E1E1E' },
  recoveryTips:       { flex: 1, gap: 6 },

  // Nutrition card
  macroRow:    { flexDirection: 'row', padding: 14, gap: 8, flexWrap: 'wrap' },
  macroChip:   { flex: 1, minWidth: 60, backgroundColor: COLORS.cardElevated,
                 borderRadius: 10, padding: 10, alignItems: 'center',
                 borderWidth: 1, borderColor: COLORS.border },
  macroVal:    { fontSize: 18, fontWeight: '800', color: COLORS.text },
  macroLabel:  { color: COLORS.textMuted, fontSize: 9, fontWeight: '700',
                 letterSpacing: 1, marginTop: 2 },

  // Progress card
  prBlock:      { paddingHorizontal: 14, paddingTop: 12, paddingBottom: 8 },
  prBlockLabel: { color: '#FFD700', fontSize: 9, fontWeight: '800', letterSpacing: 1.5, marginBottom: 8 },
  prRow:        { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  prText:       { color: '#E8E8E8', fontSize: 13, fontWeight: '600' },
  trendRow:     { flexDirection: 'row', alignItems: 'center', gap: 8,
                  paddingHorizontal: 14, paddingVertical: 10,
                  borderTopWidth: 1, borderTopColor: '#1A1A1A' },
  trendText:    { color: COLORS.textSecondary, fontSize: 13, fontWeight: '600' },

  // Weekly card
  weeklyStats:     { flexDirection: 'row', padding: 14, gap: 8 },
  weeklyStatChip:  { flex: 1, backgroundColor: COLORS.cardElevated, borderRadius: 10,
                     padding: 10, alignItems: 'center', borderWidth: 1, borderColor: COLORS.border },
  weeklyStatVal:   { fontSize: 20, fontWeight: '800', color: COLORS.text },
  weeklyStatLabel: { color: COLORS.textMuted, fontSize: 8, fontWeight: '700',
                     letterSpacing: 1, marginTop: 2 },
  weekDays:        { flexDirection: 'row', paddingHorizontal: 14, paddingBottom: 14, gap: 6 },
  weekDay:         { flex: 1, alignItems: 'center', gap: 5 },
  weekDayLabel:    { color: COLORS.textMuted, fontSize: 9, fontWeight: '600' },
  weekDayDot:      { width: 8, height: 8, borderRadius: 4 },

  // Chat tips
  chatTipsCard: { backgroundColor: COLORS.card, borderRadius: 12, marginTop: 8,
                  paddingHorizontal: 12, paddingVertical: 8,
                  borderWidth: 1, borderColor: COLORS.border },
});

// ─── Screen styles (S) ────────────────────────────────────────────────────────
const S = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },

  header: {
    paddingHorizontal: 20, paddingTop: 56, paddingBottom: 12,
    borderBottomWidth: 1, borderBottomColor: COLORS.border, gap: 4,
  },
  headerTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  memoryBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    borderWidth: 1, borderColor: COLORS.primaryGreen + '40', borderRadius: 8,
    paddingHorizontal: 10, paddingVertical: 6,
    backgroundColor: COLORS.primaryGreen + '10',
  },
  memoryBtnText: { color: COLORS.primaryGreen, fontSize: 11, fontWeight: '700' },
  headerSub: { color: COLORS.textMuted, fontSize: 12, fontWeight: '600', letterSpacing: 0.5 },
  offlineBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#1A1606', paddingVertical: 8, paddingHorizontal: 16,
    borderBottomWidth: 1, borderBottomColor: '#3A2F00',
  },
  offlineBannerText: { color: COLORS.recoveryMed, fontSize: 11, flex: 1, lineHeight: 16 },

  emptyScroll:   { flex: 1 },
  emptyContent:  { padding: 24, paddingTop: 32 },
  emptyHero:     { alignItems: 'center', marginBottom: 32 },
  emptyIcon:     { width: 56, height: 56, borderRadius: 18,
                   backgroundColor: COLORS.recoveryHigh + '18',
                   alignItems: 'center', justifyContent: 'center',
                   borderWidth: 1, borderColor: COLORS.recoveryHigh + '40',
                   marginBottom: 16 },
  emptyTitle:    { color: COLORS.text, fontSize: 22, fontWeight: '800', marginBottom: 8 },
  emptySubtitle: { color: COLORS.textMuted, fontSize: 14, textAlign: 'center', lineHeight: 20 },

  suggestions:    { gap: 8 },
  suggestion:     { backgroundColor: COLORS.card, borderRadius: 14, padding: 14,
                    borderWidth: 1, borderColor: COLORS.border,
                    flexDirection: 'row', alignItems: 'center', gap: 12 },
  suggestionIcon: { width: 32, height: 32, borderRadius: 10,
                    backgroundColor: COLORS.recoveryHigh + '18',
                    alignItems: 'center', justifyContent: 'center' },
  suggestionText: { color: COLORS.textSecondary, fontSize: 13, flex: 1 },

  messageList: { padding: 16, paddingBottom: 12 },
  bubble:      { marginBottom: 12, borderRadius: 18, padding: 14, maxWidth: '92%' },
  userBubble:  { backgroundColor: COLORS.userBubble, alignSelf: 'flex-end',
                 borderWidth: 1, borderColor: COLORS.strain + '40' },
  aiBubble:    { backgroundColor: COLORS.card, alignSelf: 'flex-start',
                 borderWidth: 1, borderColor: COLORS.border, maxWidth: '97%' },
  roleLabelRow:{ flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 6 },
  roleLabel:   { color: COLORS.recoveryHigh, fontSize: 9, fontWeight: '800', letterSpacing: 1.5 },
  messageText: { color: '#E8E8E8', fontSize: 15, lineHeight: 22 },
  userText:    { color: COLORS.text },

  thinkingRow:    { flexDirection: 'row', alignItems: 'center', gap: 10,
                    paddingHorizontal: 20, paddingVertical: 10 },
  thinkingAvatar: { width: 28, height: 28, borderRadius: 9,
                    backgroundColor: COLORS.recoveryHigh + '18',
                    alignItems: 'center', justifyContent: 'center',
                    borderWidth: 1, borderColor: COLORS.recoveryHigh + '30' },
  thinkingBubble: { backgroundColor: COLORS.card, borderRadius: 12, paddingHorizontal: 14,
                    paddingVertical: 8, borderWidth: 1, borderColor: COLORS.border },
  thinkingText:   { color: COLORS.textMuted, fontSize: 13 },

  inputRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 10,
              padding: 12, paddingBottom: 16, borderTopWidth: 1, borderTopColor: COLORS.border },
  input:    { flex: 1, backgroundColor: COLORS.cardElevated, borderRadius: 22,
              paddingHorizontal: 16, paddingVertical: 11, color: COLORS.text,
              fontSize: 15, maxHeight: 100, borderWidth: 1, borderColor: COLORS.borderLight },
  sendBtn:  { width: 42, height: 42, borderRadius: 21,
              backgroundColor: COLORS.recoveryHigh, alignItems: 'center', justifyContent: 'center',
              shadowColor: COLORS.recoveryHigh, shadowOpacity: 0.4,
              shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 4 },
  sendBtnOff: { backgroundColor: COLORS.cardElevated, shadowOpacity: 0, elevation: 0 },
});