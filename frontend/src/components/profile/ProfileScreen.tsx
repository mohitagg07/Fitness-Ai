// VYRN — Profile Screen
//
// Previously this screen rendered almost nothing: avatar initial, name,
// email, log out — every detail card (stats/PRs/injuries/equipment) was
// wrapped in a conditional that silently disappeared whenever that field
// was empty, which for most accounts is most fields. There was no way to
// edit anything and no photo upload, despite expo-image-picker already
// being a dependency and the backend's ProfileUpdate schema already
// supporting every field below.
//
// This version: real photo upload (POST /api/profile/avatar), a full
// edit screen wired to PUT /api/profile/me, real personal records pulled
// fresh from GET /api/profile/prs (not the lossy name->weight map in the
// global store), and working injury add/delete. Nothing here is a stub —
// every control on this screen does something against the real backend.

import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  Alert, ActivityIndicator, Modal, TextInput, Image, KeyboardAvoidingView, Platform,
} from 'react-native';
import { router } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Circle } from 'react-native-svg';
import { profileApi, dashboardApi, progressApi, describeApiError } from '../../utils/api';
import { useStore, actions } from '../../store';
import { COLORS } from '../../theme/colors';
import { FONTS } from '../../theme/typography';
import Logo from '../shared/Logo';

const APP_VERSION = '1.0.0';

const GOAL_COLORS: Record<string, string> = {
  bulk: '#4CAF50', cut: '#FF4500', recomp: '#9C27B0', maintain: '#2196F3',
};

// Small, purely-decorative rotating line under the name — same idea as the
// "Discipline today, strength forever" tagline in the reference design.
// Deterministic by day-of-year (not random) so it doesn't flicker between
// re-renders, and clearly cosmetic copy rather than anything presented as
// user data.
const TAGLINES = [
  'Discipline today, strength forever.',
  'Small reps. Big changes.',
  'Consistency beats intensity.',
  'Show up. That\u2019s the whole plan.',
  'Built one session at a time.',
];
function dailyTagline() {
  const dayOfYear = Math.floor((Date.now() - new Date(new Date().getFullYear(), 0, 0).getTime()) / 86400000);
  return TAGLINES[dayOfYear % TAGLINES.length];
}

const EQUIPMENT_OPTIONS = [
  'Barbell', 'Dumbbells', 'Kettlebells', 'Resistance Bands', 'Pull-up Bar',
  'Cable Machine', 'Squat Rack', 'Bench', 'Smith Machine', 'Bodyweight Only',
];

interface Profile {
  full_name?: string; username?: string; age?: number; gender?: string;
  height_cm?: number; weight_kg?: number; target_weight_kg?: number; body_fat_pct?: number;
  goal?: string; experience_level?: string; activity_level?: string;
  sleep_hours?: number; occupation?: string; daily_steps?: number;
  food_preference?: string; allergies?: string[]; food_restrictions?: string[];
  gym_or_home?: string; workout_days_per_week?: number; equipment?: string[];
  wake_time?: string; sleep_time?: string; workout_time_preference?: string;
  coach_style?: string; avatar_url?: string;
}
interface Injury { id: string; body_part: string; issue_type: string; severity: number; notes?: string; doctor_restriction?: boolean; }
interface PR { id: string; exercise_name: string; weight_kg: number; reps: number; achieved_at?: string; }

export default function ProfileScreen() {
  const { user, logout } = useStore();
  const [profile, setProfile] = useState<Profile>({});
  const [injuries, setInjuries] = useState<Injury[]>([]);
  const [prs, setPrs] = useState<PR[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [editVisible, setEditVisible] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  // Real signals only — no invented lifetime totals. workoutStreak comes
  // from the same dashboard summary the Home tab uses; sessionsThisWeek
  // from the real weekly-stats endpoint (already powers AnalyticsScreen).
  const [workoutStreak, setWorkoutStreak] = useState<number | null>(null);
  const [sessionsThisWeek, setSessionsThisWeek] = useState<number | null>(null);

  const loadAll = useCallback(async () => {
    setErrorMsg(null);
    try {
      const [meRes, prsRes] = await Promise.all([profileApi.getMe(), profileApi.getPRs()]);
      const freshProfile = meRes.data?.profile || {};
      setProfile(freshProfile);
      setInjuries(meRes.data?.injuries || []);
      setPrs(prsRes.data || []);
      // Keep the rest of the app (Dashboard header, etc.) in sync with
      // whatever we just loaded here.
      actions.updateProfile(freshProfile);
    } catch (err: any) {
      const { message } = describeApiError(err);
      setErrorMsg(message);
    }
    // Best-effort — these two are for the achievements strip only, so a
    // failure here shouldn't block the rest of the profile from loading.
    try {
      const [summaryRes, weeklyRes] = await Promise.all([
        dashboardApi.getSummary(), progressApi.getWeeklyStats(),
      ]);
      setWorkoutStreak(summaryRes.data?.workout_streak ?? null);
      setSessionsThisWeek(weeklyRes.data?.sessions_completed ?? null);
    } catch {
      // silently omit the achievements strip's live numbers
    }
  }, []);

  useEffect(() => {
    (async () => { setLoading(true); await loadAll(); setLoading(false); })();
  }, [loadAll]);

  const handleLogout = () => {
    Alert.alert('Log Out', 'Are you sure you want to log out?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Log Out', style: 'destructive',
        onPress: async () => { await logout(); router.replace('/login'); },
      },
    ]);
  };

  const pickAvatar = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Permission needed', 'Allow photo library access to set a profile picture.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });
    if (result.canceled || !result.assets?.[0]) return;

    const asset = result.assets[0];
    const mimeType = asset.mimeType || 'image/jpeg';
    setUploadingAvatar(true);
    try {
      const res = await profileApi.uploadAvatar(asset.uri, mimeType);
      setProfile((p) => ({ ...p, avatar_url: res.data.avatar_url }));
      // This was the actual bug behind "the dashboard never shows my
      // photo" — ProfileScreen updated its own local state but never told
      // the global store, so every other screen kept reading the old
      // (empty) avatar_url until the next full app restart.
      actions.updateProfile({ avatar_url: res.data.avatar_url });
    } catch (err: any) {
      const { message } = describeApiError(err);
      Alert.alert('Upload failed', message);
    } finally {
      setUploadingAvatar(false);
    }
  };

  const deleteInjury = (id: string) => {
    Alert.alert('Remove injury', 'Remove this from your injury profile?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove', style: 'destructive',
        onPress: async () => {
          try {
            await profileApi.deleteInjury(id);
            setInjuries((list) => list.filter((i) => i.id !== id));
          } catch {
            Alert.alert('Error', 'Could not remove injury.');
          }
        },
      },
    ]);
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={COLORS.primaryGreen} size="large" />
      </View>
    );
  }

  if (errorMsg && !profile.full_name) {
    return (
      <View style={[styles.center, { padding: 32 }]}>
        <Ionicons name="cloud-offline-outline" size={32} color={COLORS.textMuted} />
        <Text style={{ color: COLORS.textSecondary, fontSize: 13, textAlign: 'center', marginTop: 12 }}>{errorMsg}</Text>
        <TouchableOpacity style={styles.retryBtn} onPress={() => { setLoading(true); loadAll().finally(() => setLoading(false)); }}>
          <Text style={{ color: COLORS.primaryGreen, fontSize: 13, fontWeight: '700' }}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const bmi = profile.height_cm && profile.weight_kg
    ? +(profile.weight_kg / ((profile.height_cm / 100) ** 2)).toFixed(1)
    : null;

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.background }}>
      <EditProfileModal
        visible={editVisible}
        profile={profile}
        onClose={() => setEditVisible(false)}
        onSaved={(updated) => { setProfile(updated); setEditVisible(false); }}
      />

      <ScrollView style={styles.container}>
        <View style={styles.header}>
          <View style={styles.logoBar}><Logo size="sm" /></View>

          <TouchableOpacity style={styles.avatarWrap} onPress={pickAvatar} disabled={uploadingAvatar}>
            {profile.avatar_url ? (
              <Image source={{ uri: profile.avatar_url }} style={styles.avatarImg} />
            ) : (
              <View style={styles.avatarFallback}>
                <Text style={styles.avatarText}>
                  {(user?.full_name || profile?.full_name || 'A').charAt(0).toUpperCase()}
                </Text>
              </View>
            )}
            <View style={styles.avatarEditBadge}>
              {uploadingAvatar ? (
                <ActivityIndicator size="small" color="#000" />
              ) : (
                <Ionicons name="camera" size={14} color="#000" />
              )}
            </View>
          </TouchableOpacity>

          <Text style={styles.name}>{user?.full_name || profile?.full_name || 'Athlete'}</Text>
          <Text style={styles.email}>{user?.email}</Text>

          {profile?.goal && (
            <View style={[styles.goalBadge, { backgroundColor: (GOAL_COLORS[profile.goal] || '#555') + '22' }]}>
              <Text style={[styles.goalText, { color: GOAL_COLORS[profile.goal] || '#888' }]}>
                {profile.goal.toUpperCase()} PHASE · {(profile.experience_level || '—').toUpperCase()}
              </Text>
            </View>
          )}

          <TouchableOpacity style={styles.editBtn} onPress={() => setEditVisible(true)}>
            <Ionicons name="create-outline" size={14} color={COLORS.primaryGreen} />
            <Text style={styles.editBtnText}>Edit Profile</Text>
          </TouchableOpacity>
        </View>

        {/* Body stats */}
        <View style={styles.statsRow}>
          <Stat label="WEIGHT" value={profile.weight_kg ? `${profile.weight_kg} kg` : '—'} />
          <Stat label="HEIGHT" value={profile.height_cm ? `${profile.height_cm} cm` : '—'} />
          <Stat label="AGE" value={profile.age ? `${profile.age}` : '—'} />
          <Stat label="BMI" value={bmi ? `${bmi}` : '—'} />
        </View>

        {/* Training preferences */}
        <View style={styles.card}>
          <View style={styles.cardLabelRow}>
            <Ionicons name="settings-outline" size={13} color={COLORS.primaryGreen} />
            <Text style={styles.cardLabel}>TRAINING PREFERENCES</Text>
          </View>
          <DetailRow label="Coach style" value={cap(profile.coach_style) || 'Friendly'} />
          <DetailRow label="Activity level" value={cap(profile.activity_level?.replace('_', ' ')) || '—'} />
          <DetailRow label="Trains at" value={cap(profile.gym_or_home) || '—'} />
          <DetailRow label="Days / week" value={profile.workout_days_per_week ? String(profile.workout_days_per_week) : '—'} />
          <DetailRow label="Preferred time" value={cap(profile.workout_time_preference) || '—'} last />
        </View>

        {/* Equipment */}
        <View style={styles.card}>
          <View style={styles.cardLabelRow}>
            <Ionicons name="barbell-outline" size={13} color="#4CAF50" />
            <Text style={styles.cardLabel}>EQUIPMENT</Text>
          </View>
          {profile?.equipment?.length ? (
            <View style={styles.tagsRow}>
              {profile.equipment.map((e: string, i: number) => (
                <View key={i} style={styles.tag}><Text style={styles.tagText}>{e}</Text></View>
              ))}
            </View>
          ) : (
            <Text style={styles.emptyHint}>No equipment set. Tap Edit Profile to add what you have access to.</Text>
          )}
        </View>

        {/* Personal Records */}
        <View style={styles.card}>
          <View style={styles.cardLabelRow}>
            <Ionicons name="trophy-outline" size={13} color={COLORS.primaryGreen} />
            <Text style={styles.cardLabel}>PERSONAL RECORDS</Text>
          </View>
          {prs.length ? (
            prs.map((pr) => (
              <View key={pr.id} style={styles.prRow}>
                <Text style={styles.prName}>{pr.exercise_name}</Text>
                <Text style={styles.prWeight}>{pr.weight_kg} kg × {pr.reps}</Text>
              </View>
            ))
          ) : (
            <Text style={styles.emptyHint}>No PRs logged yet. They'll show up here automatically as you train.</Text>
          )}
        </View>

        {/* Injuries */}
        <View style={styles.card}>
          <View style={styles.cardLabelRow}>
            <Ionicons name="shield-checkmark-outline" size={13} color="#FF4500" />
            <Text style={styles.cardLabel}>INJURY PROFILE</Text>
          </View>
          {injuries.length ? (
            injuries.map((inj) => (
              <View key={inj.id} style={styles.injuryRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.injuryPart}>{cap(inj.body_part?.replace(/_/g, ' '))}</Text>
                  <Text style={styles.injuryType}>{cap(inj.issue_type)}{inj.doctor_restriction ? ' · Doctor restricted' : ''}</Text>
                </View>
                <View style={[styles.severityBadge, { backgroundColor: inj.severity >= 7 ? '#3A1A1A' : '#2A2A1A' }]}>
                  <Text style={[styles.severityText, { color: inj.severity >= 7 ? '#FF4500' : COLORS.primaryGreen }]}>
                    {inj.severity}/10
                  </Text>
                </View>
                <TouchableOpacity onPress={() => deleteInjury(inj.id)} style={{ marginLeft: 10 }}>
                  <Ionicons name="close-circle-outline" size={18} color={COLORS.textMuted} />
                </TouchableOpacity>
              </View>
            ))
          ) : (
            <Text style={styles.emptyHint}>No injuries on file. Your coach will avoid risky movements once you add one.</Text>
          )}
          <AddInjuryRow onAdded={(inj) => setInjuries((list) => [...list, inj])} />
        </View>

        {/* Nutrition preferences */}
        {(profile.food_preference || profile.allergies?.length || profile.food_restrictions?.length) && (
          <View style={styles.card}>
            <View style={styles.cardLabelRow}>
              <Ionicons name="nutrition-outline" size={13} color={COLORS.protein} />
              <Text style={styles.cardLabel}>NUTRITION</Text>
            </View>
            {profile.food_preference && <DetailRow label="Diet" value={cap(profile.food_preference)} />}
            {!!profile.allergies?.length && <DetailRow label="Allergies" value={profile.allergies.join(', ')} />}
            {!!profile.food_restrictions?.length && <DetailRow label="Restrictions" value={profile.food_restrictions.join(', ')} last />}
          </View>
        )}

        {/* Settings */}
        <View style={styles.card}>
          <View style={styles.cardLabelRow}>
            <Ionicons name="options-outline" size={13} color={COLORS.textSecondary} />
            <Text style={styles.cardLabel}>SETTINGS</Text>
          </View>
          <TouchableOpacity style={styles.settingsRow} onPress={() => setEditVisible(true)}>
            <Text style={styles.settingsRowText}>Edit Profile</Text>
            <Ionicons name="chevron-forward" size={16} color={COLORS.textMuted} />
          </TouchableOpacity>
        </View>

        <TouchableOpacity style={styles.logoutBtn} onPress={handleLogout}>
          <Ionicons name="log-out-outline" size={16} color="#FF4500" />
          <Text style={styles.logoutText}>Log Out</Text>
        </TouchableOpacity>

        <Text style={styles.versionText}>v{APP_VERSION}</Text>
        <View style={{ height: 32 }} />
      </ScrollView>
    </View>
  );
}

function cap(s?: string | null): string {
  if (!s) return '';
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function DetailRow({ label, value, last }: { label: string; value: string; last?: boolean }) {
  return (
    <View style={[styles.detailRow, last && { borderBottomWidth: 0 }]}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue}>{value}</Text>
    </View>
  );
}

// ─── Add Injury inline form ──────────────────────────────────────────────────
function AddInjuryRow({ onAdded }: { onAdded: (i: Injury) => void }) {
  const [open, setOpen] = useState(false);
  const [bodyPart, setBodyPart] = useState('');
  const [issueType, setIssueType] = useState('');
  const [severity, setSeverity] = useState('5');
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!bodyPart.trim() || !issueType.trim()) {
      Alert.alert('Missing info', 'Enter a body part and issue type.');
      return;
    }
    const sev = Math.min(10, Math.max(1, parseInt(severity, 10) || 5));
    setSaving(true);
    try {
      const res = await profileApi.addInjury({
        body_part: bodyPart.trim().toLowerCase().replace(/\s+/g, '_'),
        issue_type: issueType.trim(),
        severity: sev,
        doctor_restriction: false,
      });
      onAdded(res.data);
      setBodyPart(''); setIssueType(''); setSeverity('5'); setOpen(false);
    } catch {
      Alert.alert('Error', 'Could not add injury.');
    } finally {
      setSaving(false);
    }
  };

  if (!open) {
    return (
      <TouchableOpacity style={styles.addRowBtn} onPress={() => setOpen(true)}>
        <Ionicons name="add-circle-outline" size={16} color={COLORS.primaryGreen} />
        <Text style={styles.addRowText}>Add injury</Text>
      </TouchableOpacity>
    );
  }

  return (
    <View style={styles.addInjuryForm}>
      <TextInput style={styles.smallInput} placeholder="Body part (e.g. left shoulder)" placeholderTextColor={COLORS.textMuted} value={bodyPart} onChangeText={setBodyPart} />
      <TextInput style={styles.smallInput} placeholder="Issue (e.g. impingement)" placeholderTextColor={COLORS.textMuted} value={issueType} onChangeText={setIssueType} />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <TextInput style={[styles.smallInput, { flex: 0, width: 70 }]} placeholder="1-10" placeholderTextColor={COLORS.textMuted} value={severity} onChangeText={setSeverity} keyboardType="numeric" />
        <Text style={{ color: COLORS.textMuted, fontSize: 12 }}>severity</Text>
      </View>
      <View style={{ flexDirection: 'row', gap: 10, marginTop: 8 }}>
        <TouchableOpacity style={styles.cancelBtn} onPress={() => setOpen(false)}>
          <Text style={styles.cancelBtnText}>Cancel</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.saveSmallBtn} onPress={save} disabled={saving}>
          {saving ? <ActivityIndicator size="small" color="#000" /> : <Text style={styles.saveSmallBtnText}>Save</Text>}
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ─── Edit Profile Modal ──────────────────────────────────────────────────────
const GOALS = ['cut', 'bulk', 'maintain', 'recomp'];
const EXPERIENCE = ['beginner', 'intermediate', 'advanced', 'elite'];
const ACTIVITY = ['sedentary', 'light', 'moderate', 'very_active', 'extra_active'];
const LOCATIONS = ['home', 'gym', 'hybrid'];
const COACH_STYLES = ['friendly', 'strict', 'military'];
const TIME_PREFS = ['morning', 'afternoon', 'evening'];
const GENDERS = ['male', 'female', 'other'];

function EditProfileModal({
  visible, profile, onClose, onSaved,
}: { visible: boolean; profile: Profile; onClose: () => void; onSaved: (p: Profile) => void }) {
  const [form, setForm] = useState<Profile>(profile);
  const [saving, setSaving] = useState(false);

  useEffect(() => { if (visible) setForm(profile); }, [visible, profile]);

  const set = (k: keyof Profile, v: any) => setForm((f) => ({ ...f, [k]: v }));

  const toggleEquipment = (item: string) => {
    const cur = form.equipment || [];
    set('equipment', cur.includes(item) ? cur.filter((e) => e !== item) : [...cur, item]);
  };

  const save = async () => {
    if (form.height_cm != null && (form.height_cm < 100 || form.height_cm > 250)) {
      Alert.alert('Check height', 'Height should be between 100–250 cm.'); return;
    }
    if (form.weight_kg != null && (form.weight_kg < 30 || form.weight_kg > 300)) {
      Alert.alert('Check weight', 'Weight should be between 30–300 kg.'); return;
    }
    setSaving(true);
    try {
      const payload: any = {
        full_name: form.full_name, age: form.age, gender: form.gender,
        height_cm: form.height_cm, weight_kg: form.weight_kg,
        target_weight_kg: form.target_weight_kg, body_fat_pct: form.body_fat_pct,
        goal: form.goal, experience_level: form.experience_level, activity_level: form.activity_level,
        gym_or_home: form.gym_or_home, workout_days_per_week: form.workout_days_per_week,
        equipment: form.equipment, coach_style: form.coach_style,
        food_preference: form.food_preference,
        allergies: form.allergies, food_restrictions: form.food_restrictions,
        wake_time: form.wake_time, sleep_time: form.sleep_time,
        workout_time_preference: form.workout_time_preference,
      };
      const res = await profileApi.updateMe(payload);
      onSaved(res.data);
    } catch (err: any) {
      const { message } = describeApiError(err);
      Alert.alert('Could not save', message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView style={{ flex: 1, backgroundColor: COLORS.background }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.modalHeader}>
          <TouchableOpacity onPress={onClose}><Text style={styles.modalCancel}>Cancel</Text></TouchableOpacity>
          <Text style={styles.modalTitle}>Edit Profile</Text>
          <TouchableOpacity onPress={save} disabled={saving}>
            {saving ? <ActivityIndicator size="small" color={COLORS.primaryGreen} /> : <Text style={styles.modalSave}>Save</Text>}
          </TouchableOpacity>
        </View>

        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, paddingBottom: 48 }} keyboardShouldPersistTaps="handled">
          <Section title="BASICS">
            <FieldLabel text="Full name" />
            <TextInput style={styles.input} value={form.full_name || ''} onChangeText={(v) => set('full_name', v)} placeholder="Your name" placeholderTextColor={COLORS.textMuted} />

            <Row>
              <Col><FieldLabel text="Age" /><TextInput style={styles.input} value={form.age ? String(form.age) : ''} onChangeText={(v) => set('age', parseInt(v, 10) || undefined)} keyboardType="number-pad" placeholder="—" placeholderTextColor={COLORS.textMuted} /></Col>
              <Col><FieldLabel text="Gender" /><SegmentedRow options={GENDERS} value={form.gender} onChange={(v) => set('gender', v)} /></Col>
            </Row>

            <Row>
              <Col><FieldLabel text="Height (cm)" /><TextInput style={styles.input} value={form.height_cm ? String(form.height_cm) : ''} onChangeText={(v) => set('height_cm', parseFloat(v) || undefined)} keyboardType="decimal-pad" placeholder="—" placeholderTextColor={COLORS.textMuted} /></Col>
              <Col><FieldLabel text="Weight (kg)" /><TextInput style={styles.input} value={form.weight_kg ? String(form.weight_kg) : ''} onChangeText={(v) => set('weight_kg', parseFloat(v) || undefined)} keyboardType="decimal-pad" placeholder="—" placeholderTextColor={COLORS.textMuted} /></Col>
            </Row>
            <Row>
              <Col><FieldLabel text="Target weight (kg)" /><TextInput style={styles.input} value={form.target_weight_kg ? String(form.target_weight_kg) : ''} onChangeText={(v) => set('target_weight_kg', parseFloat(v) || undefined)} keyboardType="decimal-pad" placeholder="—" placeholderTextColor={COLORS.textMuted} /></Col>
              <Col><FieldLabel text="Body fat %" /><TextInput style={styles.input} value={form.body_fat_pct ? String(form.body_fat_pct) : ''} onChangeText={(v) => set('body_fat_pct', parseFloat(v) || undefined)} keyboardType="decimal-pad" placeholder="—" placeholderTextColor={COLORS.textMuted} /></Col>
            </Row>
          </Section>

          <Section title="GOAL & EXPERIENCE">
            <FieldLabel text="Goal" />
            <SegmentedRow options={GOALS} value={form.goal} onChange={(v) => set('goal', v)} />
            <FieldLabel text="Experience level" />
            <SegmentedRow options={EXPERIENCE} value={form.experience_level} onChange={(v) => set('experience_level', v)} />
            <FieldLabel text="Activity level" />
            <SegmentedRow options={ACTIVITY} value={form.activity_level} onChange={(v) => set('activity_level', v)} wrapLabels />
          </Section>

          <Section title="TRAINING SETUP">
            <FieldLabel text="Trains at" />
            <SegmentedRow options={LOCATIONS} value={form.gym_or_home} onChange={(v) => set('gym_or_home', v)} />
            <FieldLabel text="Coach style" />
            <SegmentedRow options={COACH_STYLES} value={form.coach_style} onChange={(v) => set('coach_style', v)} />
            <FieldLabel text="Preferred workout time" />
            <SegmentedRow options={TIME_PREFS} value={form.workout_time_preference} onChange={(v) => set('workout_time_preference', v)} />

            <FieldLabel text={`Workout days / week: ${form.workout_days_per_week ?? 4}`} />
            <View style={styles.stepperRow}>
              <TouchableOpacity style={styles.stepperBtn} onPress={() => set('workout_days_per_week', Math.max(1, (form.workout_days_per_week || 4) - 1))}>
                <Ionicons name="remove" size={16} color={COLORS.text} />
              </TouchableOpacity>
              <Text style={styles.stepperValue}>{form.workout_days_per_week ?? 4}</Text>
              <TouchableOpacity style={styles.stepperBtn} onPress={() => set('workout_days_per_week', Math.min(7, (form.workout_days_per_week || 4) + 1))}>
                <Ionicons name="add" size={16} color={COLORS.text} />
              </TouchableOpacity>
            </View>

            <FieldLabel text="Equipment you have access to" />
            <View style={styles.tagsRow}>
              {EQUIPMENT_OPTIONS.map((item) => {
                const active = (form.equipment || []).includes(item);
                return (
                  <TouchableOpacity key={item} style={[styles.chip, active && styles.chipActive]} onPress={() => toggleEquipment(item)}>
                    <Text style={[styles.chipText, active && styles.chipTextActive]}>{item}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </Section>

          <Section title="SCHEDULE">
            <Row>
              <Col><FieldLabel text="Wake time (HH:MM)" /><TextInput style={styles.input} value={form.wake_time || ''} onChangeText={(v) => set('wake_time', v)} placeholder="06:30" placeholderTextColor={COLORS.textMuted} /></Col>
              <Col><FieldLabel text="Sleep time (HH:MM)" /><TextInput style={styles.input} value={form.sleep_time || ''} onChangeText={(v) => set('sleep_time', v)} placeholder="22:30" placeholderTextColor={COLORS.textMuted} /></Col>
            </Row>
          </Section>

          <Section title="NUTRITION">
            <FieldLabel text="Diet" />
            <SegmentedRow options={['veg', 'non-veg', 'vegan', 'eggetarian']} value={form.food_preference} onChange={(v) => set('food_preference', v)} />
            <FieldLabel text="Allergies (comma separated)" />
            <TextInput style={styles.input} value={(form.allergies || []).join(', ')} onChangeText={(v) => set('allergies', v.split(',').map((s) => s.trim()).filter(Boolean))} placeholder="e.g. peanuts, shellfish" placeholderTextColor={COLORS.textMuted} />
            <FieldLabel text="Food restrictions (comma separated)" />
            <TextInput style={styles.input} value={(form.food_restrictions || []).join(', ')} onChangeText={(v) => set('food_restrictions', v.split(',').map((s) => s.trim()).filter(Boolean))} placeholder="e.g. no dairy" placeholderTextColor={COLORS.textMuted} />
          </Section>
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={{ marginBottom: 24 }}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}
function Row({ children }: { children: React.ReactNode }) {
  return <View style={{ flexDirection: 'row', gap: 12 }}>{children}</View>;
}
function Col({ children }: { children: React.ReactNode }) {
  return <View style={{ flex: 1 }}>{children}</View>;
}
function FieldLabel({ text }: { text: string }) {
  return <Text style={styles.fieldLabel}>{text}</Text>;
}
function SegmentedRow({ options, value, onChange, wrapLabels }: { options: string[]; value?: string | null; onChange: (v: string) => void; wrapLabels?: boolean }) {
  return (
    <View style={styles.segmentedRow}>
      {options.map((opt) => {
        const active = value === opt;
        return (
          <TouchableOpacity key={opt} style={[styles.segment, active && styles.segmentActive]} onPress={() => onChange(opt)}>
            <Text style={[styles.segmentText, active && styles.segmentTextActive]} numberOfLines={wrapLabels ? 2 : 1}>
              {cap(opt.replace(/_/g, ' '))}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  center: { flex: 1, backgroundColor: COLORS.background, justifyContent: 'center', alignItems: 'center' },
  header: { alignItems: 'center', paddingTop: 56, paddingBottom: 20, paddingHorizontal: 20 },
  logoBar: { alignSelf: 'stretch', marginBottom: 20 },

  avatarWrap: { width: 88, height: 88, marginBottom: 12 },
  avatarImg: { width: 88, height: 88, borderRadius: 44, backgroundColor: COLORS.cardElevated },
  avatarFallback: {
    width: 88, height: 88, borderRadius: 44,
    backgroundColor: COLORS.cardElevated, borderWidth: 2, borderColor: COLORS.primaryGreen,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarText: { color: COLORS.primaryGreen, fontSize: 34, fontWeight: '800' },
  avatarEditBadge: {
    position: 'absolute', bottom: 0, right: 0,
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: COLORS.primaryGreen, alignItems: 'center', justifyContent: 'center',
    borderWidth: 3, borderColor: COLORS.background,
  },

  name: { color: COLORS.text, fontSize: 22, fontWeight: '700', marginBottom: 4 },
  email: { color: COLORS.textMuted, fontSize: 13, marginBottom: 12 },
  goalBadge: { borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6, marginBottom: 14 },
  goalText: { fontSize: 11, fontWeight: '700', letterSpacing: 1 },

  editBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderColor: COLORS.primaryGreen + '50', borderRadius: 10, paddingHorizontal: 16, paddingVertical: 9, backgroundColor: COLORS.primaryGreen + '12' },
  editBtnText: { color: COLORS.primaryGreen, fontSize: 13, fontWeight: '700' },

  statsRow: {
    flexDirection: 'row', justifyContent: 'space-around',
    marginHorizontal: 16, marginBottom: 16,
    backgroundColor: COLORS.cardElevated, borderRadius: 16, padding: 16,
    borderWidth: 1, borderColor: COLORS.border,
  },
  stat: { alignItems: 'center' },
  statValue: { color: COLORS.text, fontSize: 17, fontWeight: '700' },
  statLabel: { color: COLORS.textMuted, fontSize: 10, marginTop: 2, letterSpacing: 0.5 },

  card: {
    backgroundColor: COLORS.cardElevated, borderRadius: 16,
    padding: 16, marginHorizontal: 16, marginBottom: 12,
    borderWidth: 1, borderColor: COLORS.border,
  },
  cardLabel: { color: COLORS.textMuted, fontSize: 11, fontWeight: '700', letterSpacing: 1.5 },
  cardLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 12 },

  detailRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  detailLabel: { color: COLORS.textSecondary, fontSize: 13 },
  detailValue: { color: COLORS.text, fontSize: 13, fontWeight: '600' },

  emptyHint: { color: COLORS.textMuted, fontSize: 12.5, lineHeight: 18 },

  prRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  prName: { color: '#C0C0C0', fontSize: 14 },
  prWeight: { color: COLORS.primaryGreen, fontSize: 14, fontWeight: '700' },

  injuryRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  injuryPart: { color: '#C0C0C0', fontSize: 14, fontWeight: '600' },
  injuryType: { color: COLORS.textSecondary, fontSize: 12, marginTop: 2 },
  severityBadge: { borderRadius: 8, padding: 6 },
  severityText: { fontSize: 12, fontWeight: '700' },

  addRowBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10 },
  addRowText: { color: COLORS.primaryGreen, fontSize: 13, fontWeight: '600' },
  addInjuryForm: { marginTop: 12, gap: 8 },
  smallInput: { backgroundColor: COLORS.inputBg, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, color: COLORS.text, fontSize: 13, borderWidth: 1, borderColor: COLORS.border },
  cancelBtn: { flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: 10, borderWidth: 1, borderColor: COLORS.border },
  cancelBtnText: { color: COLORS.textSecondary, fontSize: 13, fontWeight: '600' },
  saveSmallBtn: { flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: 10, backgroundColor: COLORS.primaryGreen },
  saveSmallBtnText: { color: '#000', fontSize: 13, fontWeight: '700' },

  tagsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tag: { backgroundColor: '#252525', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 },
  tagText: { color: COLORS.textSecondary, fontSize: 12 },

  settingsRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 10 },
  settingsRowText: { color: COLORS.text, fontSize: 14 },

  logoutBtn: {
    margin: 16, backgroundColor: COLORS.cardElevated,
    borderRadius: 14, padding: 16, alignItems: 'center',
    borderWidth: 1, borderColor: '#3A2020',
    flexDirection: 'row', justifyContent: 'center', gap: 8,
  },
  logoutText: { color: '#FF4500', fontSize: 14, fontWeight: '600' },
  versionText: { textAlign: 'center', color: COLORS.textDim, fontSize: 11, marginBottom: 8 },
  retryBtn: { marginTop: 16, backgroundColor: COLORS.cardElevated, borderRadius: 10, paddingHorizontal: 24, paddingVertical: 10, borderWidth: 1, borderColor: COLORS.border },

  // Modal
  modalHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingTop: 56, paddingBottom: 14, paddingHorizontal: 18,
    borderBottomWidth: 1, borderBottomColor: COLORS.border,
  },
  modalTitle: { color: COLORS.text, fontSize: 16, fontWeight: '700' },
  modalCancel: { color: COLORS.textSecondary, fontSize: 14 },
  modalSave: { color: COLORS.primaryGreen, fontSize: 14, fontWeight: '700' },

  sectionTitle: { color: COLORS.textMuted, fontSize: 11, fontWeight: '700', letterSpacing: 1.5, marginBottom: 12 },
  fieldLabel: { color: COLORS.textSecondary, fontSize: 12, marginBottom: 6, marginTop: 12 },
  input: { backgroundColor: COLORS.inputBg, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, color: COLORS.text, fontSize: 14, borderWidth: 1, borderColor: COLORS.border },

  segmentedRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  segment: { borderWidth: 1, borderColor: COLORS.border, borderRadius: 9, paddingHorizontal: 12, paddingVertical: 9, backgroundColor: COLORS.inputBg },
  segmentActive: { borderColor: COLORS.primaryGreen, backgroundColor: COLORS.primaryGreen + '18' },
  segmentText: { color: COLORS.textSecondary, fontSize: 12, fontWeight: '600' },
  segmentTextActive: { color: COLORS.primaryGreen },

  stepperRow: { flexDirection: 'row', alignItems: 'center', gap: 16, marginTop: 4 },
  stepperBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: COLORS.inputBg, borderWidth: 1, borderColor: COLORS.border, alignItems: 'center', justifyContent: 'center' },
  stepperValue: { color: COLORS.text, fontSize: 16, fontWeight: '700', width: 24, textAlign: 'center' },

  chip: { borderWidth: 1, borderColor: COLORS.border, borderRadius: 9, paddingHorizontal: 12, paddingVertical: 9, backgroundColor: COLORS.inputBg },
  chipActive: { borderColor: COLORS.primaryGreen, backgroundColor: COLORS.primaryGreen + '18' },
  chipText: { color: COLORS.textSecondary, fontSize: 12, fontWeight: '600' },
  chipTextActive: { color: COLORS.primaryGreen },
});