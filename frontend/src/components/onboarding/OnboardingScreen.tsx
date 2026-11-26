import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  ScrollView,
  Dimensions,
  KeyboardAvoidingView,
  Keyboard,
  Platform,
  ActivityIndicator,
  ImageBackground,
} from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withRepeat,
  withSequence,
  Easing,
} from 'react-native-reanimated';
import Svg, { Circle } from 'react-native-svg';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { profileApi } from '../../utils/api';
import { actions } from '../../store';
import { COLORS } from '../../theme/colors';

const { width: SCREEN_W } = Dimensions.get('window');
const RING_SIZE = 84;
const RING_STROKE = 5;
const RING_RADIUS = (RING_SIZE - RING_STROKE) / 2;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

type Gender = 'male' | 'female' | 'other';
type Goal = 'cut' | 'bulk' | 'maintain' | 'recomp';
type Experience = 'beginner' | 'intermediate' | 'advanced' | 'elite';
type Location = 'home' | 'gym' | 'hybrid';
type CoachStyle = 'friendly' | 'strict' | 'military';
type UsernameStatus = 'idle' | 'checking' | 'available' | 'taken' | 'invalid' | 'error';

const EQUIPMENT_OPTIONS = [
  { value: 'bodyweight', label: 'Bodyweight' },
  { value: 'dumbbell', label: 'Dumbbells' },
  { value: 'resistance_bands', label: 'Resistance bands' },
  { value: 'barbell', label: 'Barbell' },
  { value: 'bench', label: 'Bench' },
  { value: 'kettlebell', label: 'Kettlebell' },
  { value: 'pull_up_bar', label: 'Pull-up bar' },
  { value: 'cable', label: 'Cable' },
  { value: 'machine', label: 'Machines' },
];

interface FormState {
  full_name: string;
  username: string;
  dob: string; // "DD/MM/YYYY"
  gender: Gender | null;
  height_cm: string;
  weight_kg: string;
  target_weight_kg: string;
  goal: Goal | null;
  experience_level: Experience | null;
  gym_or_home: Location | null;
  equipment: string[];
  workout_days_per_week: number;
  food_preference: string | null;
  coach_style: CoachStyle | null;
}

const initialForm: FormState = {
  full_name: '',
  username: '',
  dob: '',
  gender: null,
  height_cm: '',
  weight_kg: '',
  target_weight_kg: '',
  goal: null,
  experience_level: null,
  gym_or_home: null,
  equipment: [],
  workout_days_per_week: 4,
  food_preference: null,
  coach_style: null,
};

// Four condensed slides covering every required OnboardingCreate field plus
// the highest-value optional ones. The backend model has 15+ fields across
// the original 8-slide spec; thinning that to 8 near-empty screens would be
// worse UX than 4 well-paced ones, so slides group related fields together.
const SLIDE_COUNT = 4;
const SLIDE_LABELS = ['Identity', 'About you', 'Training', 'Coach'];

// Parses "DD/MM/YYYY" into a Date, or null if it isn't a complete, real
// calendar date yet (e.g. still being typed, or "31/02/2000").
function parseDob(dob: string): Date | null {
  const match = dob.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) return null;
  const [, dd, mm, yyyy] = match;
  const day = Number(dd);
  const month = Number(mm);
  const year = Number(yyyy);
  const date = new Date(year, month - 1, day);
  // Reject overflow dates that Date() silently rolls forward, e.g. Feb 31.
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return null;
  }
  return date;
}

// Age in whole years as of today — this is what actually gets sent to the
// backend, which still stores/validates `age: int` (13–80). Collecting DOB
// instead of a raw age number means the value self-corrects every year
// instead of quietly going stale in the profile.
function ageFromDob(dob: string): number | null {
  const date = parseDob(dob);
  if (!date) return null;
  const today = new Date();
  let age = today.getFullYear() - date.getFullYear();
  const hasHadBirthdayThisYear =
    today.getMonth() > date.getMonth() ||
    (today.getMonth() === date.getMonth() && today.getDate() >= date.getDate());
  if (!hasHadBirthdayThisYear) age -= 1;
  return age;
}

const USERNAME_PATTERN = /^[a-zA-Z0-9_.]+$/;
function isUsernameFormatValid(username: string): boolean {
  return username.length >= 3 && username.length <= 30 && USERNAME_PATTERN.test(username);
}

function isSlideValid(slide: number, form: FormState, usernameStatus: UsernameStatus): boolean {
  switch (slide) {
    case 0: {
      const age = ageFromDob(form.dob);
      return (
        form.full_name.trim().length > 0 &&
        isUsernameFormatValid(form.username) &&
        usernameStatus === 'available' &&
        age !== null && age >= 13 && age <= 80 &&
        !!form.gender
      );
    }
    case 1:
      return !!form.height_cm && !!form.weight_kg && !!form.goal;
    case 2:
      return !!form.experience_level && !!form.gym_or_home;
    case 3:
      return !!form.coach_style;
    default:
      return false;
  }
}

export default function OnboardingScreen() {
  const scrollRef = useRef<ScrollView>(null);
  const [slide, setSlide] = useState(0);
  const [form, setForm] = useState<FormState>(initialForm);
  // Lives here (not inside SlideWelcome) because handleNext's validity gate
  // needs to know whether the in-flight availability check actually
  // resolved to "available" before letting the user past slide 0 — a
  // username that merely *looks* valid but hasn't been confirmed free
  // shouldn't pass silently.
  const [usernameStatus, setUsernameStatus] = useState<UsernameStatus>('idle');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Shown for ~700ms after a successful final submit, before navigating
  // away — a bare instant redirect reads as the app not having registered
  // the tap at all.
  const [showSuccess, setShowSuccess] = useState(false);

  // Session-lifetime cache: once a username has been checked, never hit the
  // backend for that exact string again in this onboarding session — covers
  // both "typed it, deleted it, typed it again" and picking a suggestion
  // that was already implicitly checked.
  const usernameCache = useRef<Map<string, 'available' | 'taken'>>(new Map());
  // Bumped to force a retry of the in-flight check after a network failure,
  // without changing the username itself (which wouldn't re-trigger the effect).
  const [retryTick, setRetryTick] = useState(0);

  const ringProgress = useSharedValue(1 / SLIDE_COUNT);
  // Subtle fade during slide transitions — dips opacity briefly instead of
  // the pager just snapping to the next screen instantly.
  const pagerOpacity = useSharedValue(1);

  // Debounced live check against GET /profile/username-available. Only
  // fires once format is already valid (3+ chars), checks the session
  // cache first, and a `cancelled` flag guards against a slow earlier
  // request overwriting the result of a newer one if the person keeps typing.
  useEffect(() => {
    const candidate = form.username.trim().toLowerCase();
    if (!candidate) {
      setUsernameStatus('idle');
      return;
    }
    if (!isUsernameFormatValid(candidate)) {
      setUsernameStatus('invalid');
      return;
    }
    const cached = usernameCache.current.get(candidate);
    if (cached) {
      setUsernameStatus(cached);
      return;
    }
    setUsernameStatus('checking');
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const res = await profileApi.checkUsername(candidate);
        if (cancelled) return;
        const result: 'available' | 'taken' = res.data?.available ? 'available' : 'taken';
        usernameCache.current.set(candidate, result);
        setUsernameStatus(result);
        if (result === 'available') {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        }
      } catch {
        if (!cancelled) setUsernameStatus('error');
      }
    }, 450);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [form.username, retryTick]);

  // useCallback here (and on handleNext/handleBack below) isn't just
  // tidiness — SlideWelcome is now wrapped in React.memo, and a stable
  // function reference is required for that memo to actually hold. Passing
  // a freshly-created arrow function on every OnboardingScreen render would
  // silently defeat the memo (props "change" every render even though
  // nothing meaningful did) and put us right back to all-slides-re-render.
  const retryUsernameCheck = useCallback(() => setRetryTick((t) => t + 1), []);

  const pagerFadeStyle = useAnimatedStyle(() => ({ opacity: pagerOpacity.value }));

  const goToSlide = useCallback((index: number) => {
    setSlide(index);
    pagerOpacity.value = withSequence(
      withTiming(0.35, { duration: 120, easing: Easing.out(Easing.cubic) }),
      withTiming(1, { duration: 220, easing: Easing.out(Easing.cubic) })
    );
    scrollRef.current?.scrollTo({ x: index * SCREEN_W, animated: true });
    ringProgress.value = withTiming((index + 1) / SLIDE_COUNT, { duration: 450 });
  }, [pagerOpacity, ringProgress]);

  const handleNext = useCallback(async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    if (!isSlideValid(slide, form, usernameStatus)) {
      setError(
        slide === 0 && usernameStatus === 'checking'
          ? 'Still checking that username — one second.'
          : 'Please fill in everything on this screen before continuing.'
      );
      return;
    }
    setError(null);
    Keyboard.dismiss();

    if (slide < SLIDE_COUNT - 1) {
      goToSlide(slide + 1);
      return;
    }

    // Final slide — submit to the backend. Age is derived from DOB here
    // rather than stored as its own form field, so it can never drift out
    // of sync with what the person actually entered.
    setSubmitting(true);
    try {
      const res = await profileApi.onboard({
        full_name: form.full_name.trim(),
        username: form.username.trim().toLowerCase(),
        age: ageFromDob(form.dob),
        gender: form.gender,
        height_cm: Number(form.height_cm),
        weight_kg: Number(form.weight_kg),
        target_weight_kg: form.target_weight_kg ? Number(form.target_weight_kg) : undefined,
        goal: form.goal,
        experience_level: form.experience_level,
        gym_or_home: form.gym_or_home,
        equipment: form.equipment,
        workout_days_per_week: form.workout_days_per_week,
        food_preference: form.food_preference ?? undefined,
        coach_style: form.coach_style,
      });
      // Previously the store was never updated here, so the Dashboard
      // (which reads profile.goal / profile.full_name from the store, not
      // from a fetch of its own) showed stale/empty values immediately
      // after onboarding until some other screen happened to call
      // profileApi.getMe(). The /onboard endpoint already returns the
      // saved row — use it directly instead of waiting on a second round trip.
      actions.setProfile(res.data || {}, [], []);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setSubmitting(false);
      setShowSuccess(true);
      setTimeout(() => router.replace('/(tabs)'), 700);
      return;
    } catch (e: any) {
      const detail = e?.response?.data?.detail;
      setError(
        typeof detail === 'string'
          ? detail
          : 'Something went wrong saving your profile. Check your connection and try again.'
      );
      setSubmitting(false);
    }
  }, [slide, form, usernameStatus, goToSlide]);

  const handleBack = useCallback(() => {
    if (slide === 0) return;
    goToSlide(slide - 1);
  }, [slide, goToSlide]);

  const isCheckingUsername = slide === 0 && usernameStatus === 'checking';
  // What the footer caption says beneath the ring button — premium apps
  // narrate what's happening instead of leaving a bare spinner to guess at.
  const footerCaption = submitting
    ? 'Creating account…'
    : isCheckingUsername
    ? 'Checking username…'
    : null;

  return (
    <ImageBackground
      source={require('../../../assets/onboarding-hero.png')}
      style={styles.bg}
      resizeMode="cover"
    >
      <View style={styles.scrim} />
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
      <Animated.View style={[styles.pager, pagerFadeStyle]}>
      <ScrollView
        ref={scrollRef}
        horizontal
        pagingEnabled
        scrollEnabled={false}
        showsHorizontalScrollIndicator={false}
      >
        <View style={[styles.slide, { width: SCREEN_W }]}>
          <SlideWelcome
            form={form}
            setForm={setForm}
            usernameStatus={usernameStatus}
            onRetryUsernameCheck={retryUsernameCheck}
            onSubmitLast={handleNext}
          />
        </View>
        <View style={[styles.slide, { width: SCREEN_W }]}>
          <SlideBody form={form} setForm={setForm} />
        </View>
        <View style={[styles.slide, { width: SCREEN_W }]}>
          <SlideTraining form={form} setForm={setForm} />
        </View>
        <View style={[styles.slide, { width: SCREEN_W }]}>
          <SlideCoach form={form} setForm={setForm} />
        </View>
      </ScrollView>
      </Animated.View>

      {error && (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}

      <View style={styles.footer}>
        {/* Contextual progress: which section, not just how many dots ── */}
        <View style={styles.progressLabelRow}>
          <Text style={styles.progressLabel}>{SLIDE_LABELS[slide]}</Text>
          <Text style={styles.progressLabelMuted}>{slide + 1}/{SLIDE_COUNT}</Text>
        </View>
        <View style={styles.segments}>
          {Array.from({ length: SLIDE_COUNT }).map((_, i) => (
            <View key={i} style={[styles.segment, i <= slide && styles.segmentActive]} />
          ))}
        </View>

        {footerCaption && <Text style={styles.footerCaption}>{footerCaption}</Text>}

        <View style={styles.controlsRow}>
          <Pressable
            onPress={handleBack}
            disabled={slide === 0}
            style={[styles.backButton, slide === 0 && styles.backButtonHidden]}
          >
            <Ionicons name="chevron-back" size={22} color="#9AA5B1" />
          </Pressable>

          <ProgressRing progress={(slide + 1) / SLIDE_COUNT}>
            <Pressable
              onPress={handleNext}
              disabled={submitting || isCheckingUsername}
              style={[
                styles.nextButton,
                (submitting || isCheckingUsername) && styles.nextButtonBusy,
              ]}
            >
              {submitting || isCheckingUsername ? (
                <ActivityIndicator color="#0A0A0A" />
              ) : (
                <Ionicons
                  name={slide === SLIDE_COUNT - 1 ? 'checkmark' : 'arrow-forward'}
                  size={26}
                  color="#0A0A0A"
                />
              )}
            </Pressable>
          </ProgressRing>

          <View style={styles.backButtonHidden} />
        </View>
      </View>
      </KeyboardAvoidingView>

      {/* Brief success beat before navigating away — confirms the tap
          landed instead of jumping straight to the dashboard. */}
      {showSuccess && (
        <View style={styles.successOverlay}>
          <View style={styles.successCheck}>
            <Ionicons name="checkmark" size={32} color="#0A0A0A" />
          </View>
          <Text style={styles.successText}>
            Welcome{form.full_name.trim() ? `, ${form.full_name.trim().split(' ')[0]}` : ''}
          </Text>
        </View>
      )}
    </ImageBackground>
  );
}

// ─── Circular progress ring, recreated from the Flutter reference's
// CircularPercentIndicator pattern using react-native-svg + Reanimated. ───
function ProgressRing({
  progress,
  children,
}: {
  progress: number;
  children: React.ReactNode;
}) {
  const dashOffset = RING_CIRCUMFERENCE * (1 - progress);

  return (
    <View style={styles.ringWrap}>
      <Svg width={RING_SIZE} height={RING_SIZE} style={StyleSheet.absoluteFill}>
        <Circle
          cx={RING_SIZE / 2}
          cy={RING_SIZE / 2}
          r={RING_RADIUS}
          stroke="#2A2A2A"
          strokeWidth={RING_STROKE}
          fill="none"
        />
        <Circle
          cx={RING_SIZE / 2}
          cy={RING_SIZE / 2}
          r={RING_RADIUS}
          stroke={COLORS.primaryGreen}
          strokeWidth={RING_STROKE}
          fill="none"
          strokeDasharray={`${RING_CIRCUMFERENCE} ${RING_CIRCUMFERENCE}`}
          strokeDashoffset={dashOffset}
          strokeLinecap="round"
          transform={`rotate(-90 ${RING_SIZE / 2} ${RING_SIZE / 2})`}
        />
      </Svg>
      {children}
    </View>
  );
}

// Inserts "/" as the person types digits, and strips anything they paste
// that isn't a digit — turns raw keystrokes into "DD/MM/YYYY" without a
// separate date-picker dependency.
function formatDobInput(prev: string, next: string): string {
  const digits = next.replace(/\D/g, '').slice(0, 8);
  const parts = [digits.slice(0, 2), digits.slice(2, 4), digits.slice(4, 8)].filter(Boolean);
  return parts.join('/');
}

// A wider, more natural-looking set of variations than "name/name_fit/name01" —
// still fully deterministic (no Math.random()) so the same name always
// suggests the same handles instead of reshuffling on every keystroke.
function suggestUsernames(fullName: string): string[] {
  const parts = fullName.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const first = (parts[0] || '').replace(/[^a-z0-9]/g, '');
  const lastInitial = (parts[1]?.[0] || '').replace(/[^a-z0-9]/g, '');
  if (!first) return [];

  const candidates = [
    lastInitial ? `${first}${lastInitial}` : `${first}x`,
    `${first}.fit`,
    `the${first}`,
    `${first}lift`,
    `${first}ai`,
    `${first}${(first.length * 7) % 90 + 10}`, // deterministic 2-digit suffix
  ];

  // De-dupe and drop anything shorter than the 3-char minimum the backend enforces.
  return Array.from(new Set(candidates)).filter((c) => c.length >= 3);
}

// ─── Inline field validation copy — shown as the person types, not just on submit ──
function nameError(name: string): string | null {
  if (!name) return null;
  return name.trim().length < 2 ? 'Minimum 2 characters' : null;
}

function usernameFormatError(username: string): string | null {
  if (!username) return null;
  if (username.length < 3 || username.length > 30) return '3–30 characters';
  if (!USERNAME_PATTERN.test(username)) return 'Only letters, numbers, _ or .';
  return null;
}

// Backend enforces 13–80 (see ProfileCreate in schemas/models.py) — this
// mirrors that exactly rather than inventing a stricter age gate the API
// wouldn't actually agree with.
function dobError(dob: string): string | null {
  if (dob.length < 10) return null;
  const age = ageFromDob(dob);
  if (age === null) return 'Not a real date';
  if (age < 13) return 'Must be 13 or older';
  if (age > 80) return 'Check the year';
  return null;
}

const USERNAME_STATUS_COPY: Record<UsernameStatus, { text: string; color: keyof typeof COLORS | null }> = {
  idle: { text: '', color: null },
  checking: { text: 'Checking…', color: 'textMuted' },
  available: { text: '✓ Available', color: 'primaryGreen' },
  taken: { text: 'Already taken', color: 'danger' },
  invalid: { text: '3+ letters, numbers, _ or .', color: 'textMuted' },
  error: { text: "Couldn't check — try again", color: 'warning' },
};

// ─── Slide 1: Identity (name, username, date of birth, gender) ─────────────
// All four slides live in the DOM at once (horizontal pager, scrollEnabled
// false — see the render below), so without memoization every keystroke
// on ANY slide re-rendered all four, including three the user can't even
// see. Each slide is wrapped in React.memo with a comparator that only
// looks at the specific `form` fields that slide actually reads — typing
// in the body-metrics slide no longer touches the identity/training/coach
// slides at all.
const SlideWelcome = React.memo(function SlideWelcome({
  form,
  setForm,
  usernameStatus,
  onRetryUsernameCheck,
  onSubmitLast,
}: {
  form: FormState;
  setForm: React.Dispatch<React.SetStateAction<FormState>>;
  usernameStatus: UsernameStatus;
  onRetryUsernameCheck: () => void;
  onSubmitLast: () => void;
}) {
  const age = ageFromDob(form.dob);
  const initial = form.full_name.trim().charAt(0).toUpperCase() || '?';
  const statusCopy = USERNAME_STATUS_COPY[usernameStatus];
  const suggestions = suggestUsernames(form.full_name).filter((s) => s !== form.username.toLowerCase());

  // Only show a field's error once the person has actually left it, not
  // while they're still mid-keystroke on the first character.
  const [touched, setTouched] = useState({ name: false, username: false, dob: false });
  const nameErr = touched.name ? nameError(form.full_name) : null;
  const usernameErr = touched.username ? usernameFormatError(form.username) : null;
  const dobErr = touched.dob ? dobError(form.dob) : null;

  // Focus-chaining refs — Next on the keyboard moves through the form the
  // way a native iOS/Android form does, instead of the person having to
  // tap each field by hand.
  const nameRef = useRef<TextInput>(null);
  const usernameRef = useRef<TextInput>(null);
  const dobRef = useRef<TextInput>(null);

  useEffect(() => {
    // Auto-focus the first field on mount so typing can start immediately.
    const t = setTimeout(() => nameRef.current?.focus(), 350);
    return () => clearTimeout(t);
  }, []);

  // Keyboard-aware avatar/heading shrink — Notion/Instagram-style, so the
  // form has more room once the keyboard is up instead of everything just
  // getting pushed off-screen.
  const keyboardProgress = useSharedValue(0);
  useEffect(() => {
    const showSub = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow',
      () => { keyboardProgress.value = withTiming(1, { duration: 220, easing: Easing.out(Easing.cubic) }); }
    );
    const hideSub = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide',
      () => { keyboardProgress.value = withTiming(0, { duration: 220, easing: Easing.out(Easing.cubic) }); }
    );
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  const headerAnimStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: keyboardProgress.value * -12 }],
    opacity: 1 - keyboardProgress.value * 0.15,
  }));
  const previewAnimStyle = useAnimatedStyle(() => ({
    transform: [{ scale: 1 - keyboardProgress.value * 0.18 }],
  }));

  // Shimmer pulse shown next to "Checking…" instead of a static spinner.
  const shimmer = useSharedValue(0.4);
  useEffect(() => {
    if (usernameStatus === 'checking') {
      shimmer.value = withRepeat(withSequence(withTiming(1, { duration: 500 }), withTiming(0.4, { duration: 500 })), -1, true);
    }
  }, [usernameStatus]);
  const shimmerStyle = useAnimatedStyle(() => ({ opacity: shimmer.value }));

  return (
    <View style={styles.slideContent}>
      <Animated.View style={headerAnimStyle}>
        <Text style={styles.slideTitle}>Your profile.</Text>
        <Text style={styles.slideSubtitle}>Choose a name and username. You can change these later.</Text>
      </Animated.View>

      {/* Compact live preview — one glance, not a full card */}
      <Animated.View style={[styles.identityPreview, previewAnimStyle]}>
        <View style={styles.identityAvatar}>
          <Text style={styles.identityAvatarText}>{initial}</Text>
        </View>
        <View>
          <Text style={styles.identityName} numberOfLines={1}>
            {form.full_name.trim() || 'Your name'}
          </Text>
          <Text style={styles.identityHandle} numberOfLines={1}>
            @{form.username.trim().toLowerCase() || 'username'}
          </Text>
        </View>
      </Animated.View>

      <Text style={styles.label}>Name</Text>
      <TextInput
        ref={nameRef}
        style={styles.input}
        placeholder="Full name"
        placeholderTextColor="#666"
        value={form.full_name}
        onChangeText={(v) => setForm((f) => ({ ...f, full_name: v }))}
        onBlur={() => setTouched((t) => ({ ...t, name: true }))}
        returnKeyType="next"
        onSubmitEditing={() => usernameRef.current?.focus()}
        blurOnSubmit={false}
      />
      {nameErr && <Text style={styles.fieldError}>{nameErr}</Text>}

      <View style={styles.labelRow}>
        <Text style={[styles.label, styles.labelInRow]}>Username</Text>
        {usernameStatus === 'checking' ? (
          <View style={styles.checkingRow}>
            <Text style={styles.usernameStatus}>Checking</Text>
            <Animated.View style={[styles.shimmerBar, shimmerStyle]} />
          </View>
        ) : usernameStatus === 'error' ? (
          <Pressable onPress={onRetryUsernameCheck} hitSlop={8}>
            <Text style={[styles.usernameStatus, { color: COLORS.warning }]}>Couldn't check — Retry</Text>
          </Pressable>
        ) : (
          !!statusCopy.text && (
            <Text style={[styles.usernameStatus, statusCopy.color && { color: COLORS[statusCopy.color] as string }]}>
              {statusCopy.text}
            </Text>
          )
        )}
      </View>
      <TextInput
        ref={usernameRef}
        style={styles.input}
        placeholder="username"
        placeholderTextColor="#666"
        autoCapitalize="none"
        autoCorrect={false}
        value={form.username}
        onChangeText={(v) => setForm((f) => ({ ...f, username: v.replace(/\s/g, '') }))}
        onBlur={() => setTouched((t) => ({ ...t, username: true }))}
        returnKeyType="next"
        onSubmitEditing={() => dobRef.current?.focus()}
        blurOnSubmit={false}
      />
      {usernameErr && <Text style={styles.fieldError}>{usernameErr}</Text>}
      {suggestions.length > 0 && (
        <View style={styles.chipRow}>
          {suggestions.map((s) => (
            <Pressable
              key={s}
              style={styles.chip}
              hitSlop={6}
              onPress={() => setForm((f) => ({ ...f, username: s }))}
            >
              <Text style={styles.chipText}>{s}</Text>
            </Pressable>
          ))}
        </View>
      )}

      <View style={styles.labelRow}>
        <Text style={[styles.label, styles.labelInRow]}>Date of birth</Text>
        {age !== null && !dobErr && <Text style={styles.usernameStatus}>{age} years old</Text>}
      </View>
      <TextInput
        ref={dobRef}
        style={styles.input}
        placeholder="DD/MM/YYYY"
        placeholderTextColor="#666"
        keyboardType="number-pad"
        maxLength={10}
        value={form.dob}
        onChangeText={(v) => setForm((f) => ({ ...f, dob: formatDobInput(f.dob, v) }))}
        onBlur={() => setTouched((t) => ({ ...t, dob: true }))}
        returnKeyType="done"
        onSubmitEditing={onSubmitLast}
      />
      {dobErr && <Text style={styles.fieldError}>{dobErr}</Text>}

      <Text style={styles.label}>Gender</Text>
      <SelectRow
        options={[
          { value: 'male', label: 'Male' },
          { value: 'female', label: 'Female' },
          { value: 'other', label: 'Other' },
        ]}
        selected={form.gender}
        onSelect={(v) => setForm((f) => ({ ...f, gender: v as Gender }))}
      />
    </View>
  );
}, (prev, next) =>
  prev.form.full_name === next.form.full_name &&
  prev.form.username === next.form.username &&
  prev.form.dob === next.form.dob &&
  prev.form.gender === next.form.gender &&
  prev.usernameStatus === next.usernameStatus &&
  prev.setForm === next.setForm &&
  prev.onRetryUsernameCheck === next.onRetryUsernameCheck &&
  prev.onSubmitLast === next.onSubmitLast);

// ─── Slide 2: Body metrics + goal ──────────────────────────────────────────
const SlideBody = React.memo(function SlideBody({
  form,
  setForm,
}: {
  form: FormState;
  setForm: React.Dispatch<React.SetStateAction<FormState>>;
}) {
  return (
    <View style={styles.slideContent}>
      <Text style={styles.slideTitle}>Your body.</Text>
      <Text style={styles.slideSubtitle}>This drives your calorie and macro targets.</Text>

      <View style={styles.row2}>
        <View style={styles.col}>
          <Text style={styles.label}>Height (cm)</Text>
          <TextInput
            style={styles.input}
            placeholder="175"
            placeholderTextColor="#666"
            keyboardType="decimal-pad"
            value={form.height_cm}
            onChangeText={(v) => setForm((f) => ({ ...f, height_cm: v.replace(/[^0-9.]/g, '') }))}
          />
        </View>
        <View style={styles.col}>
          <Text style={styles.label}>Weight (kg)</Text>
          <TextInput
            style={styles.input}
            placeholder="75"
            placeholderTextColor="#666"
            keyboardType="decimal-pad"
            value={form.weight_kg}
            onChangeText={(v) => setForm((f) => ({ ...f, weight_kg: v.replace(/[^0-9.]/g, '') }))}
          />
        </View>
      </View>

      <Text style={styles.label}>Target weight (kg) — optional</Text>
      <TextInput
        style={styles.input}
        placeholder="70"
        placeholderTextColor="#666"
        keyboardType="decimal-pad"
        value={form.target_weight_kg}
        onChangeText={(v) => setForm((f) => ({ ...f, target_weight_kg: v.replace(/[^0-9.]/g, '') }))}
      />

      <Text style={styles.label}>Goal</Text>
      <SelectRow
        options={[
          { value: 'cut', label: 'Fat Loss' },
          { value: 'bulk', label: 'Muscle Gain' },
          { value: 'recomp', label: 'Recomposition' },
          { value: 'maintain', label: 'Maintenance' },
        ]}
        selected={form.goal}
        onSelect={(v) => setForm((f) => ({ ...f, goal: v as Goal }))}
        wrap
      />
    </View>
  );
}, (prev, next) =>
  prev.form.height_cm === next.form.height_cm &&
  prev.form.weight_kg === next.form.weight_kg &&
  prev.form.target_weight_kg === next.form.target_weight_kg &&
  prev.form.goal === next.form.goal &&
  prev.setForm === next.setForm);

// ─── Slide 3: Training setup ────────────────────────────────────────────
const SlideTraining = React.memo(function SlideTraining({
  form,
  setForm,
}: {
  form: FormState;
  setForm: React.Dispatch<React.SetStateAction<FormState>>;
}) {
  return (
    <ScrollView
      style={styles.trainingScroll}
      contentContainerStyle={[styles.slideContent, styles.trainingContent]}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={styles.slideTitle}>Training.</Text>
      <Text style={styles.slideSubtitle}>Your Workout Agent uses this to build your plan.</Text>

      <Text style={styles.label}>Experience level</Text>
      <SelectRow
        options={[
          { value: 'beginner', label: 'Beginner' },
          { value: 'intermediate', label: 'Intermediate' },
          { value: 'advanced', label: 'Advanced' },
          { value: 'elite', label: 'Elite' },
        ]}
        selected={form.experience_level}
        onSelect={(v) => setForm((f) => ({ ...f, experience_level: v as Experience }))}
        wrap
      />

      <Text style={styles.label}>Where do you train?</Text>
      <SelectRow
        options={[
          { value: 'home', label: 'Home' },
          { value: 'gym', label: 'Gym' },
          { value: 'hybrid', label: 'Hybrid' },
        ]}
        selected={form.gym_or_home}
        onSelect={(v) => setForm((f) => ({
          ...f,
          gym_or_home: v as Location,
          // A home/hybrid athlete starts with bodyweight as the safe baseline.
          // A gym user who leaves equipment blank is treated as having full-gym access.
          equipment: v === 'gym'
            ? []
            : (f.equipment.length > 0 ? f.equipment : ['bodyweight']),
        }))}
      />

      <Text style={styles.label}>Equipment you can use</Text>
      <Text style={styles.helperText}>
        Select only what you have access to. For a full gym, you can leave this blank.
        Home workouts default to bodyweight if nothing else is selected.
      </Text>
      <View style={styles.chipRow}>
        {EQUIPMENT_OPTIONS.map((option) => {
          const selected = form.equipment.includes(option.value);
          return (
            <Pressable
              key={option.value}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: selected }}
              onPress={() => setForm((current) => ({
                ...current,
                equipment: selected
                  ? current.equipment.filter((item) => item !== option.value)
                  : [...current.equipment, option.value],
              }))}
              style={[styles.chip, selected && styles.chipActive]}
            >
              <Text style={[styles.chipText, selected && styles.chipTextActive]}>
                {option.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <Text style={styles.label}>Days per week: {form.workout_days_per_week}</Text>
      <View style={styles.stepperRow}>
        {[2, 3, 4, 5, 6, 7].map((d) => (
          <Pressable
            key={d}
            onPress={() => setForm((f) => ({ ...f, workout_days_per_week: d }))}
            style={[styles.stepperPill, form.workout_days_per_week === d && styles.stepperPillActive]}
          >
            <Text
              style={[
                styles.stepperText,
                form.workout_days_per_week === d && styles.stepperTextActive,
              ]}
            >
              {d}
            </Text>
          </Pressable>
        ))}
      </View>
    </ScrollView>
  );
}, (prev, next) =>
  prev.form.experience_level === next.form.experience_level &&
  prev.form.gym_or_home === next.form.gym_or_home &&
  prev.form.equipment === next.form.equipment &&
  prev.form.workout_days_per_week === next.form.workout_days_per_week &&
  prev.setForm === next.setForm);

// ─── Slide 4: Diet preference + coach style ─────────────────────────────
const SlideCoach = React.memo(function SlideCoach({
  form,
  setForm,
}: {
  form: FormState;
  setForm: React.Dispatch<React.SetStateAction<FormState>>;
}) {
  return (
    <View style={styles.slideContent}>
      <Text style={styles.slideTitle}>Almost there.</Text>
      <Text style={styles.slideSubtitle}>How should your AI Coach talk to you?</Text>

      <Text style={styles.label}>Diet preference — optional</Text>
      <SelectRow
        options={[
          { value: 'non-veg', label: 'Non-Veg' },
          { value: 'veg', label: 'Vegetarian' },
          { value: 'vegan', label: 'Vegan' },
          { value: 'eggetarian', label: 'Eggetarian' },
        ]}
        selected={form.food_preference}
        onSelect={(v) => setForm((f) => ({ ...f, food_preference: v }))}
        wrap
      />

      <Text style={styles.label}>Coach style</Text>
      <SelectRow
        options={[
          { value: 'friendly', label: 'Friendly' },
          { value: 'strict', label: 'Strict' },
          { value: 'military', label: 'Military' },
        ]}
        selected={form.coach_style}
        onSelect={(v) => setForm((f) => ({ ...f, coach_style: v as CoachStyle }))}
      />
    </View>
  );
}, (prev, next) =>
  prev.form.food_preference === next.form.food_preference &&
  prev.form.coach_style === next.form.coach_style &&
  prev.setForm === next.setForm);

// ─── Shared pill-select control (memoized: each renders on every keystroke
// of its slide otherwise, even though its own props rarely change) ───────
const SelectRow = React.memo(function SelectRow({
  options,
  selected,
  onSelect,
  wrap,
}: {
  options: { value: string; label: string }[];
  selected: string | null;
  onSelect: (v: string) => void;
  wrap?: boolean;
}) {
  return (
    <View style={[styles.selectRow, wrap && styles.selectRowWrap]}>
      {options.map((opt) => (
        <Pressable
          key={opt.value}
          onPress={() => onSelect(opt.value)}
          style={[styles.pill, selected === opt.value && styles.pillActive]}
        >
          <Text style={[styles.pillText, selected === opt.value && styles.pillTextActive]}>
            {opt.label}
          </Text>
        </Pressable>
      ))}
    </View>
  );
});

const styles = StyleSheet.create({
  bg: { flex: 1, backgroundColor: '#111111' },
  scrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(17,17,17,0.78)', // keeps form fields/text legible over the photo
  },
  container: { flex: 1, backgroundColor: 'transparent' },
  pager: { flex: 1 },
  slide: { flex: 1 },
  slideContent: { flex: 1, paddingHorizontal: 24, paddingTop: 64 },
  trainingScroll: { flex: 1 },
  trainingContent: { flexGrow: 1, paddingBottom: 24 },
  slideTitle: { fontSize: 30, fontWeight: '800', color: '#E8ECEF' },
  slideSubtitle: { fontSize: 14, color: '#9AA5B1', marginTop: 6, marginBottom: 28 },
  label: { fontSize: 12, fontWeight: '600', color: '#9AA5B1', marginBottom: 8, marginTop: 18, letterSpacing: 0.5 },
  input: {
    backgroundColor: '#141414',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    color: '#E8ECEF',
    borderWidth: 1,
    borderColor: '#2A2A2A',
  },
  fieldError: { color: COLORS.danger, fontSize: 12, marginTop: 6, fontWeight: '500' },
  row2: { flexDirection: 'row', gap: 12 },
  col: { flex: 1 },
  identityPreview: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    marginTop: 8, marginBottom: 4,
  },
  identityAvatar: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: COLORS.primaryGreen,
    alignItems: 'center', justifyContent: 'center',
  },
  identityAvatarText: { color: '#0A0A0A', fontSize: 18, fontWeight: '800' },
  identityName: { color: '#E8ECEF', fontSize: 15, fontWeight: '700' },
  identityHandle: { color: '#9AA5B1', fontSize: 12, marginTop: 1 },
  labelRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginTop: 18, marginBottom: 8,
  },
  labelInRow: { marginTop: 0, marginBottom: 0 },
  usernameStatus: { fontSize: 12, fontWeight: '600', color: '#9AA5B1' },
  checkingRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  shimmerBar: { width: 28, height: 8, borderRadius: 4, backgroundColor: '#2A2A2A' },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  chip: {
    paddingHorizontal: 14, paddingVertical: 10, borderRadius: 16, minHeight: 36,
    backgroundColor: '#171717', borderWidth: 1, borderColor: '#2A2A2A',
    alignItems: 'center', justifyContent: 'center',
  },
  chipText: { color: '#9AA5B1', fontSize: 12, fontWeight: '600' },
  chipActive: { backgroundColor: COLORS.primaryGreen, borderColor: COLORS.primaryGreen },
  chipTextActive: { color: '#0A0A0A' },
  helperText: { color: '#78838F', fontSize: 11, lineHeight: 16, marginTop: -2 },
  selectRow: { flexDirection: 'row', gap: 10 },
  selectRowWrap: { flexWrap: 'wrap' },
  pill: {
    paddingHorizontal: 16,
    paddingVertical: 13,
    minHeight: 44,
    borderRadius: 20,
    backgroundColor: '#171717',
    borderWidth: 1,
    borderColor: '#2A2A2A',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pillActive: { backgroundColor: COLORS.primaryGreen, borderColor: COLORS.primaryGreen },
  pillText: { color: '#9AA5B1', fontSize: 13, fontWeight: '600' },
  pillTextActive: { color: '#0A0A0A' },
  stepperRow: { flexDirection: 'row', gap: 8 },
  stepperPill: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: '#171717', borderWidth: 1, borderColor: '#2A2A2A',
    alignItems: 'center', justifyContent: 'center',
  },
  stepperPillActive: { backgroundColor: COLORS.primaryGreen, borderColor: COLORS.primaryGreen },
  stepperText: { color: '#9AA5B1', fontWeight: '700' },
  stepperTextActive: { color: '#0A0A0A' },
  errorBanner: {
    marginHorizontal: 24, marginBottom: 8,
    backgroundColor: '#2A1414', borderRadius: 10, padding: 12,
    borderWidth: 1, borderColor: '#5C2424',
  },
  errorText: { color: '#F25252', fontSize: 13 },
  footer: { paddingHorizontal: 24, paddingBottom: 28, paddingTop: 8 },
  progressLabelRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline',
    marginBottom: 8,
  },
  progressLabel: { color: '#E8ECEF', fontSize: 13, fontWeight: '700' },
  progressLabelMuted: { color: '#5C5C5C', fontSize: 12, fontWeight: '600' },
  segments: { flexDirection: 'row', gap: 6, marginBottom: 14 },
  segment: { flex: 1, height: 3, borderRadius: 2, backgroundColor: '#2A2A2A' },
  segmentActive: { backgroundColor: COLORS.primaryGreen },
  footerCaption: {
    textAlign: 'center', color: '#9AA5B1', fontSize: 12, fontWeight: '600', marginBottom: 8,
  },
  controlsRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  backButton: {
    width: 44, height: 44, borderRadius: 22,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#171717',
  },
  backButtonHidden: { opacity: 0, width: 44, height: 44 },
  ringWrap: { width: RING_SIZE, height: RING_SIZE, alignItems: 'center', justifyContent: 'center' },
  nextButton: {
    width: RING_SIZE - 20, height: RING_SIZE - 20, borderRadius: (RING_SIZE - 20) / 2,
    backgroundColor: COLORS.primaryGreen,
    alignItems: 'center', justifyContent: 'center',
  },
  nextButtonBusy: { backgroundColor: '#8FDC85' },
  successOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(17,17,17,0.96)',
    alignItems: 'center', justifyContent: 'center', gap: 16,
  },
  successCheck: {
    width: 64, height: 64, borderRadius: 32,
    backgroundColor: COLORS.primaryGreen,
    alignItems: 'center', justifyContent: 'center',
  },
  successText: { color: '#E8ECEF', fontSize: 18, fontWeight: '700' },
});