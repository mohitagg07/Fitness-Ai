// VYRN — Today's Timeline
//
// Answers "what happened today?" — a chronological feed assembled from
// personal_records, ai_timeline_events, and program_versions (all real
// DB rows, zero mock content). Renamed from the original Coach Timeline
// card onto the new Home layout; the data source is unchanged.

import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../../theme/colors';
import api from '../../utils/api';

interface TimelineEvent {
  type: string;
  icon: string;
  color: string;
  title: string;
  detail: string | null;
  date: string;
}

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

function formatDate(iso: string) {
  if (!iso) return '';
  const d = new Date(iso);
  const today = new Date();
  const diffDays = Math.floor((today.getTime() - d.getTime()) / 86400000);
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays}d ago`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export default function TimelineCard() {
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [collapsed, setCollapsed] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await api.get('/coach/coach-timeline');
        setEvents(res.data.timeline || []);
      } catch {}
      setLoading(false);
    })();
  }, []);

  const visibleEvents = collapsed ? events.slice(0, 4) : events.slice(0, 12);

  if (!loading && events.length === 0) return null;

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <Ionicons name="time-outline" size={13} color={COLORS.strainGlow} />
        <Text style={styles.label}>TODAY'S TIMELINE</Text>
      </View>

      {loading ? (
        <ActivityIndicator color={COLORS.recoveryHigh} size="small" style={{ marginVertical: 8 }} />
      ) : (
        <>
          {visibleEvents.map((event, i) => (
            <View key={i} style={styles.eventRow}>
              {/* Line segment */}
              <View style={styles.lineCol}>
                <View style={[styles.dot, { backgroundColor: event.color }]} />
                {i < visibleEvents.length - 1 && <View style={styles.line} />}
              </View>
              {/* Content */}
              <View style={styles.eventContent}>
                <View style={styles.eventTitleRow}>
                  <Ionicons name={event.icon as IoniconName} size={12} color={event.color} />
                  <Text style={styles.eventTitle}>{event.title}</Text>
                </View>
                {event.detail ? <Text style={styles.eventDetail}>{event.detail}</Text> : null}
                <Text style={styles.eventDate}>{formatDate(event.date)}</Text>
              </View>
            </View>
          ))}

          {events.length > 4 && (
            <TouchableOpacity onPress={() => setCollapsed(p => !p)} style={styles.showMoreBtn}>
              <Text style={styles.showMoreText}>
                {collapsed ? `Show ${events.length - 4} more` : 'Show less'}
              </Text>
              <Ionicons name={collapsed ? 'chevron-down' : 'chevron-up'} size={12} color={COLORS.strainGlow} />
            </TouchableOpacity>
          )}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: 16, marginBottom: 14,
    backgroundColor: '#0A0A12', borderRadius: 18,
    padding: 18, borderWidth: 1, borderColor: COLORS.strainGlow + '25',
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 16 },
  label: { color: COLORS.strainGlow, fontSize: 10, fontWeight: '800', letterSpacing: 1.5 },
  eventRow: { flexDirection: 'row', gap: 12, marginBottom: 0 },
  lineCol: { alignItems: 'center', width: 14, paddingTop: 2 },
  dot: { width: 8, height: 8, borderRadius: 4, marginBottom: 2 },
  line: { width: 1.5, flex: 1, backgroundColor: '#1C1C2C', minHeight: 24 },
  eventContent: { flex: 1, paddingBottom: 14 },
  eventTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 2 },
  eventTitle: { color: '#E0E0E0', fontSize: 13, fontWeight: '600', flex: 1 },
  eventDetail: { color: '#5C6B6E', fontSize: 11, lineHeight: 16, marginBottom: 2 },
  eventDate: { color: '#3F4A4C', fontSize: 10 },
  showMoreBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    alignSelf: 'center', paddingTop: 4,
  },
  showMoreText: { color: COLORS.strainGlow, fontSize: 11, fontWeight: '600' },
});
