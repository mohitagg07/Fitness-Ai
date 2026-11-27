import React, { useState, useRef, useEffect } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  Alert, KeyboardAvoidingView, Platform, ScrollView, ActivityIndicator,
  Animated,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { authApi, profileApi } from '../../utils/api';
import { actions } from '../../store';
import { COLORS } from '../../theme/colors';

export default function AuthScreen() {
  const [mode, setMode] = useState<'login' | 'register'>('login');

  // Login state
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');

  // Register state
  const [regName, setRegName] = useState('');
  const [regEmail, setRegEmail] = useState('');
  const [regPassword, setRegPassword] = useState('');

  const [loading, setLoading] = useState(false);

  const fade = useRef(new Animated.Value(0)).current;
  const rise = useRef(new Animated.Value(16)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fade, { toValue: 1, duration: 420, useNativeDriver: true }),
      Animated.spring(rise, { toValue: 0, friction: 8, tension: 60, useNativeDriver: true }),
    ]).start();
  }, []);

  const handleLogin = async () => {
    if (!loginEmail.trim() || !loginPassword.trim()) {
      Alert.alert('Missing fields', 'Please enter your email and password.');
      return;
    }
    setLoading(true);
    try {
      const res = await authApi.login({ email: loginEmail.trim(), password: loginPassword });
      const { access_token, user_id } = res.data;
      await actions.setAuth({ id: user_id, email: loginEmail.trim() }, access_token);
      try {
        const profileRes = await profileApi.getMe();
        const d = profileRes.data;
        actions.setProfile(d.profile || {}, d.injuries || [], d.personal_records || []);
      } catch (profileErr) {
        // Login itself succeeded — don't block entry to the app over a
        // profile fetch failure. But silently eating this previously meant
        // a user could be looking at "Athlete" / empty cards everywhere
        // with no idea why. Log it so it's visible during development;
        // the Dashboard's own error state covers the in-app signal.
        if (__DEV__) {
          console.warn('[Login] Profile fetch failed after login:', profileErr);
        }
      }
      router.replace('/(tabs)');
    } catch (err: any) {
      Alert.alert('Login Failed', err?.response?.data?.detail || 'Check your credentials.');
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async () => {
    if (!regName.trim() || !regEmail.trim() || !regPassword.trim()) {
      Alert.alert('Missing fields', 'Please fill in all fields.');
      return;
    }
    if (regPassword.length < 8) {
      Alert.alert('Weak password', 'Password must be at least 8 characters.');
      return;
    }

    setLoading(true);
    try {
      const res = await authApi.register({
        full_name: regName.trim(),
        email: regEmail.trim(),
        password: regPassword,
      });
      if (res.data?.verification_required) {
        setLoginEmail(regEmail.trim());
        setMode('login');
        Alert.alert(
          'Verify your email',
          res.data.message || 'Check your inbox and confirm your email before signing in.'
        );
        return;
      }
      const { access_token, user_id } = res.data;
      if (!access_token || !user_id) {
        throw new Error('Registration did not return a sign-in session. Please try logging in.');
      }
      await actions.setAuth(
        { id: user_id, email: regEmail.trim(), full_name: regName.trim() },
        access_token
      );
      // BUG FIX: previously went straight to /(tabs), skipping onboarding
      // entirely. New users landed on an unconfigured dashboard — no goal,
      // no weight, no equipment, no coach style. The coach_agent and all
      // five decision agents need these fields to produce meaningful output;
      // without them they all fall back to defaults that produce generic
      // (and often wrong) advice. Route to /onboarding instead so the
      // profile is populated before the first dashboard load.
      router.replace('/onboarding');
    } catch (err: any) {
      Alert.alert(
        'Registration Failed',
        err?.code === 'ECONNABORTED'
          ? 'The signup request timed out. Your account may still have been created; check your inbox before trying again.'
          : err?.response?.data?.detail || err?.message || 'Cannot connect to server. Check your network and try again.'
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <LinearGradient
        colors={['#0B111A', '#0A0F17', '#121327']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFillObject}
      />
      <View pointerEvents="none" style={styles.orbitTop} />
      <View pointerEvents="none" style={styles.orbitBottom} />
      <ScrollView contentContainerStyle={styles.inner} keyboardShouldPersistTaps="handled">
        <Animated.View style={{ opacity: fade, transform: [{ translateY: rise }] }}>

          <View style={styles.brandHeader}>
            <View style={styles.brandMark}>
              <Ionicons name="pulse" size={25} color="#FFFFFF" />
            </View>
            <Text style={styles.brandName}>VYRN</Text>
          </View>
          <Text style={styles.headline}>A coach that gets to know you.</Text>
          <Text style={styles.subtitle}>Build a routine around your real life — one step at a time.</Text>

          {/* Toggle */}
          <View style={styles.toggle}>
            <TouchableOpacity
            style={[styles.toggleBtn, mode === 'login' && styles.toggleBtnActive]}
            onPress={() => setMode('login')}
          >
            <Text style={[styles.toggleText, mode === 'login' && styles.toggleTextActive]}>
              Sign in
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.toggleBtn, mode === 'register' && styles.toggleBtnActive]}
            onPress={() => setMode('register')}
          >
            <Text style={[styles.toggleText, mode === 'register' && styles.toggleTextActive]}>
              Create account
            </Text>
          </TouchableOpacity>
        </View>

        {/* Login Form */}
        {mode === 'login' && (
          <View style={styles.form}>
            <Text style={styles.label}>EMAIL</Text>
            <TextInput
              style={styles.input}
              value={loginEmail}
              onChangeText={setLoginEmail}
              placeholder="you@email.com"
              placeholderTextColor={COLORS.textMuted}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
            />
            <Text style={styles.label}>PASSWORD</Text>
            <TextInput
              style={styles.input}
              value={loginPassword}
              onChangeText={setLoginPassword}
              placeholder="••••••••"
              placeholderTextColor={COLORS.textMuted}
              secureTextEntry
            />
            <TouchableOpacity
              style={[styles.btn, loading && styles.btnDisabled]}
              onPress={handleLogin}
              disabled={loading}
            >
              {loading
                ? <ActivityIndicator color="#FFFFFF" />
                : <Text style={styles.btnText}>LOG IN</Text>}
            </TouchableOpacity>
          </View>
        )}

        {/* Register Form */}
        {mode === 'register' && (
          <View style={styles.form}>
            <Text style={styles.label}>FULL NAME</Text>
            <TextInput
              style={styles.input}
              value={regName}
              onChangeText={setRegName}
              placeholder="John Smith"
              placeholderTextColor={COLORS.textMuted}
              autoCorrect={false}
            />
            <Text style={styles.label}>EMAIL</Text>
            <TextInput
              style={styles.input}
              value={regEmail}
              onChangeText={setRegEmail}
              placeholder="you@email.com"
              placeholderTextColor={COLORS.textMuted}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
            />
            <Text style={styles.label}>PASSWORD</Text>
            <TextInput
              style={styles.input}
              value={regPassword}
              onChangeText={setRegPassword}
              placeholder="Min. 8 characters"
              placeholderTextColor={COLORS.textMuted}
              secureTextEntry
            />
            <TouchableOpacity
              style={[styles.btn, loading && styles.btnDisabled]}
              onPress={handleRegister}
              disabled={loading}
            >
              {loading
                ? <ActivityIndicator color="#FFFFFF" />
                : <Text style={styles.btnText}>Create account</Text>}
            </TouchableOpacity>
          </View>
        )}

        </Animated.View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  orbitTop: { position: 'absolute', top: -120, right: -105, width: 290, height: 290, borderRadius: 145, backgroundColor: 'rgba(208,255,85,0.055)', borderWidth: 1, borderColor: 'rgba(208,255,85,0.14)' },
  orbitBottom: { position: 'absolute', bottom: -165, left: -105, width: 320, height: 320, borderRadius: 160, backgroundColor: 'rgba(183,160,255,0.07)', borderWidth: 1, borderColor: 'rgba(183,160,255,0.16)' },
  inner: { flexGrow: 1, justifyContent: 'center', padding: 28, paddingTop: 56, paddingBottom: 40 },
  brandHeader: { alignItems: 'center', justifyContent: 'center', marginBottom: 27 },
  brandMark: { width: 66, height: 66, borderRadius: 23, backgroundColor: COLORS.primaryGreen, alignItems: 'center', justifyContent: 'center', marginBottom: 12, shadowColor: COLORS.primaryGreen, shadowOpacity: 0.24, shadowRadius: 24, shadowOffset: { width: 0, height: 7 }, elevation: 5 },
  brandName: { color: COLORS.text, fontSize: 23, fontWeight: '900', letterSpacing: 6 },
  headline: { color: COLORS.text, fontSize: 28, fontWeight: '800', letterSpacing: -0.9, textAlign: 'center', marginBottom: 7 },
  subtitle: { color: COLORS.textSecondary, fontSize: 13, lineHeight: 20, textAlign: 'center', marginBottom: 28, letterSpacing: 0.1, paddingHorizontal: 10 },
  toggle: {
    flexDirection: 'row',
    backgroundColor: COLORS.cardElevated,
    borderRadius: 18,
    padding: 5,
    marginBottom: 30,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  toggleBtn: { flex: 1, paddingVertical: 12, borderRadius: 14, alignItems: 'center' },
  toggleBtnActive: { backgroundColor: COLORS.primaryGreen },
  toggleText: { color: COLORS.textMuted, fontSize: 13, fontWeight: '600', letterSpacing: 0.1 },
  toggleTextActive: { color: COLORS.background },
  form: { gap: 10 },
  label: { color: COLORS.textSecondary, fontSize: 11, fontWeight: '700', letterSpacing: 1.1, marginBottom: 3 },
  input: {
    backgroundColor: COLORS.inputBg, borderRadius: 17,
    padding: 17, color: COLORS.text, fontSize: 15,
    borderWidth: 1, borderColor: COLORS.border, marginBottom: 8,
  },
  btn: {
    backgroundColor: COLORS.primaryGreen, borderRadius: 18,
    padding: 17, alignItems: 'center', marginTop: 8,
    shadowColor: COLORS.recoveryHigh, shadowOpacity: 0.35, shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 }, elevation: 5,
  },
  btnDisabled: { opacity: 0.6 },
  btnText: { color: COLORS.background, fontSize: 14, fontWeight: '700', letterSpacing: 0.2 },
});