// VYRN — Program Health
//
// Answers "is my program still the right one?" — real version history +
// on-demand adaptive rewrite. Calls GET /api/program/versions (real data,
// unchanged from the original Program Evolution card). Deliberately does
// NOT show a fabricated "96% health score" — there's no backend field
// for that — so the status row shows only real values: version count
// and last-updated date.
//
// Text-density pass: the version diff (trigger + explanation + full
// change list) is real, sometimes-long content that most people won't
// read every day. It's collapsed behind "View changes" by default —
// the status row + version chips are enough to scan in 3 seconds; the
// full diff is one tap away, not force-fed.

import React, { useState, useEffect } from 'react';
import {
  View, StyleSheet, TouchableOpacity, ActivityIndicator, Alert, LayoutAnimation, Platform, UIManager,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, alpha } from '../../theme/colors';
import { SPACING, RADIUS } from '../../theme/spacing';
import { ELEVATION, ICON_SIZE } from '../../theme/layout';
import Text from '../ui/Text';
import Button from '../ui/Button';
import SectionLabel from '../ui/SectionLabel';
import api from '../../utils/api';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

interface ChangeItem {
  type: string;
  description: string;
  exercise?: string;
  swap_to?: string;
  adjustment: string;
}

interface ProgramVersion {
  id: string;
  version_number: number;
  trigger: string;
  explanation: string;
  changes: ChangeItem[] | string;
  created_at: string;
}

function parseChanges(raw: ChangeItem[] | string): ChangeItem[] {
  if (Array.isArray(raw)) return raw;
  try { return JSON.parse(raw); } catch { return []; }
}

function triggerIcon(trigger: string) {
  if (trigger.includes('plateau')) return 'trending-up-outline';
  if (trigger.includes('recovery')) return 'heart-outline';
  if (trigger.includes('eating') || trigger.includes('protein')) return 'nutrition-outline';
  return 'git-branch-outline';
}

function changeTypeColor(type: string) {
  if (type === 'volume_reduction') return COLORS.recoveryMed;
  if (type === 'intensity_increase') return COLORS.recoveryHigh;
  if (type === 'exercise_swap') return COLORS.strainGlow;
  if (type === 'deload') return COLORS.strain;
  return COLORS.textSecondary;
}

function formatDate(iso: string) {
  if (!iso) return 'Unknown';
  const d = new Date(iso);
  const today = new Date();
  const diffDays = Math.floor((today.getTime() - d.getTime()) / 86400000);
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays}d ago`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export default function ProgramHealthCard() {
  const [versions, setVersions] = useState<ProgramVersion[]>([]);
  const [loading, setLoading] = useState(true);
  const [rewriting, setRewriting] = useState(false);
  const [selectedVersion, setSelectedVersion] = useState<number>(0);
  const [showDiff, setShowDiff] = useState(false);

  const load = async () => {
    try {
      const res = await api.get('/program/versions');
      const v = res.data.versions || [];
      setVersions(v);
      if (v.length > 0) setSelectedVersion(v[0].version_number);
    } catch {}
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const handleRewrite = async () => {
    setRewriting(true);
    try {
      const res = await api.post('/program/rewrite');
      if (res.data.rewrite_triggered) {
        await load();
        Alert.alert(
          `Program v${res.data.version_number} Ready`,
          res.data.explanation,
          [{ text: 'Got it', style: 'default' }]
        );
      } else {
        Alert.alert('No Rewrite Needed', res.data.explanation || 'All patterns are within normal range.');
      }
    } catch {
      Alert.alert('Error', 'Could not run program rewriter. Try again shortly.');
    }
    setRewriting(false);
  };

  const toggleDiff = () => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setShowDiff((v) => !v);
  };

  if (!loading && versions.length === 0) {
    return (
      <View style={styles.card}>
        <SectionLabel label="PROGRAM HEALTH" icon="git-branch-outline" color={COLORS.strain} />
        <Text variant="caption" color={COLORS.textMuted} numberOfLines={2} style={{ lineHeight: 17, marginBottom: SPACING.md }}>
          No rewrites yet — the coach adjusts your program when it detects a plateau or recovery issue.
        </Text>
        <Button label="Check Now" icon="refresh" size="sm" accentColor={COLORS.strain} loading={rewriting} onPress={handleRewrite} />
      </View>
    );
  }

  const active = versions.find(v => v.version_number === selectedVersion) || versions[0];
  const changes = active ? parseChanges(active.changes) : [];

  return (
    <View style={styles.card}>
      <SectionLabel label="PROGRAM HEALTH" icon="git-branch-outline" color={COLORS.strain} />

      {versions.length > 0 && (
        <View style={styles.statusRow}>
          <View style={styles.statusItem}>
            <Text variant="h2" numeric color={COLORS.text}>v{versions[0]?.version_number ?? 1}</Text>
            <Text variant="caption" color={COLORS.textMuted}>Current version</Text>
          </View>
          <View style={styles.statusDivider} />
          <View style={styles.statusItem}>
            <Text variant="h2" numeric color={COLORS.text}>{formatDate(versions[0]?.created_at)}</Text>
            <Text variant="caption" color={COLORS.textMuted}>Last updated</Text>
          </View>
        </View>
      )}

      {loading ? (
        <ActivityIndicator color={COLORS.recoveryHigh} size="small" style={{ marginVertical: 8 }} />
      ) : (
        <>
          <View style={styles.chipRow}>
            {[...versions].reverse().map(v => (
              <TouchableOpacity
                key={v.version_number}
                style={[styles.chip, selectedVersion === v.version_number && styles.chipActive]}
                onPress={() => { setSelectedVersion(v.version_number); setShowDiff(false); }}
              >
                <Text style={[styles.chipText, selectedVersion === v.version_number && styles.chipTextActive]}>
                  v{v.version_number}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {active && (
            <>
              <TouchableOpacity style={styles.triggerRow} activeOpacity={0.7} onPress={toggleDiff}>
                <Ionicons name={triggerIcon(active.trigger) as any} size={13} color={COLORS.recoveryMed} />
                <Text variant="caption" weight="bold" color={COLORS.recoveryMed} style={{ letterSpacing: 0.8, flex: 1 }}>
                  {active.trigger.replace(/_/g, ' ').toUpperCase()}
                </Text>
                <Text variant="caption" color={COLORS.textMuted}>{changes.length} change{changes.length === 1 ? '' : 's'}</Text>
                <Ionicons name={showDiff ? 'chevron-up' : 'chevron-down'} size={ICON_SIZE.xs} color={COLORS.textMuted} />
              </TouchableOpacity>

              {showDiff && (
                <View style={styles.diffBlock}>
                  <Text variant="caption" color={COLORS.textSecondary} numberOfLines={3} style={{ lineHeight: 18, marginBottom: SPACING.sm }}>
                    {active.explanation}
                  </Text>
                  <View style={styles.changesList}>
                    {changes.map((c, i) => (
                      <View key={i} style={styles.changeRow}>
                        <View style={[styles.changeDot, { backgroundColor: changeTypeColor(c.type) }]} />
                        <Text variant="caption" color={COLORS.text} numberOfLines={1} style={{ flex: 1 }}>{c.description}</Text>
                        <View style={[styles.adjustmentChip, { borderColor: alpha(changeTypeColor(c.type), 0.4) }]}>
                          <Text style={[styles.adjustmentText, { color: changeTypeColor(c.type) }]}>{c.adjustment}</Text>
                        </View>
                      </View>
                    ))}
                  </View>
                </View>
              )}
            </>
          )}

          <Button
            label="Rewrite Program"
            icon="refresh"
            size="sm"
            accentColor={COLORS.strain}
            loading={rewriting}
            onPress={handleRewrite}
            style={{ marginTop: SPACING.md }}
          />
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: SPACING.lg, marginBottom: SPACING.md,
    backgroundColor: COLORS.card, borderRadius: RADIUS.card,
    padding: SPACING.xl, borderWidth: 1, borderColor: COLORS.cardBorder,
    ...ELEVATION.low,
  },
  statusRow: {
    flexDirection: 'row', alignItems: 'center', marginBottom: SPACING.md,
    paddingBottom: SPACING.md, borderBottomWidth: 1, borderBottomColor: COLORS.cardBorder,
  },
  statusItem: { flex: 1 },
  statusDivider: { width: 1, height: 28, backgroundColor: COLORS.cardBorder, marginHorizontal: SPACING.md },
  chipRow: { flexDirection: 'row', gap: 6, marginBottom: SPACING.md, flexWrap: 'wrap' },
  chip: {
    paddingVertical: 5, paddingHorizontal: 10, borderRadius: RADIUS.badge,
    backgroundColor: COLORS.cardElevated, borderWidth: 1, borderColor: COLORS.border,
  },
  chipActive: { backgroundColor: alpha(COLORS.strain, 0.16), borderColor: alpha(COLORS.strain, 0.6) },
  chipText: { color: COLORS.textMuted, fontSize: 11, fontWeight: '700' },
  chipTextActive: { color: COLORS.strain },
  triggerRow: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: SPACING.xs },
  diffBlock: {
    marginTop: SPACING.sm, backgroundColor: COLORS.cardElevated, borderRadius: RADIUS.badge + 4,
    padding: SPACING.md,
  },
  changesList: { gap: SPACING.sm },
  changeRow: { flexDirection: 'row', gap: SPACING.sm, alignItems: 'center' },
  changeDot: { width: 6, height: 6, borderRadius: 3 },
  adjustmentChip: {
    borderWidth: 1, borderRadius: RADIUS.badge - 2, paddingVertical: 2, paddingHorizontal: 6,
  },
  adjustmentText: { fontSize: 9, fontWeight: '800', letterSpacing: 0.5 },
});
