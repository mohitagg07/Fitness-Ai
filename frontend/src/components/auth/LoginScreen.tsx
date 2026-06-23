/**
 * NeuroFit AI — Auth Screen (Login + Register combined)
 *
 * After successful REGISTER  → /onboarding
 * After successful LOGIN:
 *   - onboarding_complete=false → /onboarding
 *   - onboarding_complete=true  → /(tabs)
 *
 * Password validation: min 8 chars, at least one digit.
 * Email validation: basic regex before hitting the server.
 */
import React, { useState, useRef, useEffect } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  Alert, KeyboardAvoidingView, Platform, ScrollView,
  ActivityIndicator, Image, Animated,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { authApi, profileApi } from '../../utils/api';
import { actions } from '../../store';
import { storage } from '../../utils/storage';
import { COLORS } from '../../theme/colors';

const HERO_URL =
  'https://images.unsplash.com/photo-1517838277536-f5f99be501cd?w=1200&q=80&auto=format&fit=crop';

function validateEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}
function validatePassword(pw: string): string | null {
  if (pw.length < 8)    return 'Password must be at least 8 characters.';
  if (!/\d/.test(pw))   return 'Password must contain at least one number.';
  return null;
}

export default function AuthScreen() {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [loginEmail,    setLoginEmail]    = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [regName,       setRegName]       = useState('');
  const [regEmail,      setRegEmail]      = useState('');
  const [regPassword,   setRegPassword]   = useState('');
  const [regConfirm,    setRegConfirm]    = useState('');
  const [showPw,        setShowPw]        = useState(false);
  const [loading,       setLoading]       = useState(false);

  const fade = useRef(new Animated.Value(0)).current;
  const rise = useRef(new Animated.Value(18)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fade, { toValue: 1, duration: 450, useNativeDriver: true }),
      Animated.spring(rise, { toValue: 0, friction: 8, tension: 60, useNativeDriver: true }),
    ]).start();
  }, []);

  // Re-animate when mode changes
  const switchMode = (m: 'login' | 'register') => {
    fade.setValue(0);
    rise.setValue(12);
    setMode(m);
    Animated.parallel([
      Animated.timing(fade, { toValue: 1, duration: 280, useNativeDriver: true }),
      Animated.spring(rise, { toValue: 0, friction: 9, tension: 70, useNativeDriver: true }),
    ]).start();
  };

  const handleLogin = async () => {
    if (!loginEmail.trim() || !loginPassword.trim()) {
      Alert.alert('Missing fields', 'Please enter your email and password.');
      return;
    }
    if (!validateEmail(loginEmail)) {
      Alert.alert('Invalid email', 'Please enter a valid email address.');
      return;
    }
    setLoading(true);
    try {
      const res = await authApi.login({ email: loginEmail.trim(), password: loginPassword });
      const { access_token, user_id } = res.data;
      await actions.setAuth({ id: user_id, email: loginEmail.trim() }, access_token);

      // Fetch profile to check onboarding state
      try {
        const pRes = await profileApi.getMe();
        const d = pRes.data;
        actions.setProfile(d.profile || {}, d.injuries || [], d.personal_records || []);
        // Cache for offline onboarding check on next cold start
        await storage.setItem('neurofit_profile', JSON.stringify(d.profile || {}));
        if (!d.profile?.onboarding_complete) {
          router.replace('/onboarding');
          return;
        }
      } catch {
        // Profile fetch failed — go to onboarding to be safe
        router.replace('/onboarding');
        return;
      }
      router.replace('/(tabs)');
    } catch (err: any) {
      Alert.alert('Login failed', err?.response?.data?.detail || 'Check your credentials and try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async () => {
    if (!regName.trim() || !regEmail.trim() || !regPassword.trim()) {
      Alert.alert('Missing fields', 'Please fill in all fields.');
      return;
    }
    if (!validateEmail(regEmail)) {
      Alert.alert('Invalid email', 'Please enter a valid email address.');
      return;
    }
    const pwErr = validatePassword(regPassword);
    if (pwErr) { Alert.alert('Weak password', pwErr); return; }
    if (regPassword !== regConfirm) {
      Alert.alert('Passwords do not match', 'Both password fields must be identical.');
      return;
    }
    setLoading(true);
    try {
      const res = await authApi.register({
        full_name: regName.trim(),
        email:     regEmail.trim(),
        password:  regPassword,
      });
      const { access_token, user_id } = res.data;
      await actions.setAuth(
        { id: user_id, email: regEmail.trim(), full_name: regName.trim() },
        access_token,
      );
      // New users always go to onboarding
      router.replace('/onboarding');
    } catch (err: any) {
      Alert.alert(
        'Registration failed',
        err?.response?.data?.detail || 'Cannot connect to server. Make sure the backend is running.',
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
      <Image source={{ uri: HERO_URL }} style={styles.hero} resizeMode="cover" />
      <LinearGradient
        colors={['#00000033', '#000000CC', '#000000']}
        style={styles.overlay}
      />

      <ScrollView contentContainerStyle={styles.inner} keyboardShouldPersistTaps="handled">
        <Animated.View style={{ opacity: fade, transform: [{ translateY: rise }] }}>

          {/* Logo */}
          <LinearGradient colors={[COLORS.recoveryHigh, '#00A8E8']} style={styles.logo}>
            <Ionicons name="barbell" size={32} color="#000" />
          </LinearGradient>
          <Text style={styles.appName}>NeuroFit AI</Text>
          <Text style={styles.tagline}>Your AI gym spotter</Text>

          {/* Toggle */}
          <View style={styles.toggle}>
            {(['login', 'register'] as const).map((m) => (
              <TouchableOpacity
                key={m}
                style={[styles.toggleBtn, mode === m && styles.toggleActive]}
                onPress={() => switchMode(m)}
              >
                <Text style={[styles.toggleTxt, mode === m && styles.toggleTxtActive]}>
                  {m === 'login' ? 'LOG IN' : 'SIGN UP'}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* ── Login form ── */}
          {mode === 'login' && (
            <View style={styles.form}>
              <Text style={styles.label}>EMAIL</Text>
              <TextInput
                style={styles.input}
                value={loginEmail}
                onChangeText={setLoginEmail}
                placeholder="you@email.com"
                placeholderTextColor="#444"
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
              />

              <Text style={styles.label}>PASSWORD</Text>
              <View style={styles.pwWrap}>
                <TextInput
                  style={[styles.input, { flex: 1, marginBottom: 0 }]}
                  value={loginPassword}
                  onChangeText={setLoginPassword}
                  placeholder="••••••••"
                  placeholderTextColor="#444"
                  secureTextEntry={!showPw}
                />
                <TouchableOpacity style={styles.eyeBtn} onPress={() => setShowPw(!showPw)}>
                  <Ionicons name={showPw ? 'eye-off-outline' : 'eye-outline'} size={20} color="#555" />
                </TouchableOpacity>
              </View>

              <TouchableOpacity
                style={[styles.btn, loading && styles.btnOff]}
                onPress={handleLogin}
                disabled={loading}
              >
                {loading
                  ? <ActivityIndicator color="#000" />
                  : <Text style={styles.btnTxt}>LOG IN</Text>}
              </TouchableOpacity>

              {/* Security note */}
              <View style={styles.securityBadge}>
                <Ionicons name="lock-closed-outline" size={12} color="#555" />
                <Text style={styles.securityTxt}>
                  Your data is secured with JWT + bcrypt. Only you can see your stats.
                </Text>
              </View>
            </View>
          )}

          {/* ── Register form ── */}
          {mode === 'register' && (
            <View style={styles.form}>
              <Text style={styles.label}>FULL NAME</Text>
              <TextInput
                style={styles.input}
                value={regName}
                onChangeText={setRegName}
                placeholder="John Smith"
                placeholderTextColor="#444"
                autoCorrect={false}
              />
              <Text style={styles.label}>EMAIL</Text>
              <TextInput
                style={styles.input}
                value={regEmail}
                onChangeText={setRegEmail}
                placeholder="you@email.com"
                placeholderTextColor="#444"
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
              />
              <Text style={styles.label}>PASSWORD</Text>
              <View style={styles.pwWrap}>
                <TextInput
                  style={[styles.input, { flex: 1, marginBottom: 0 }]}
                  value={regPassword}
                  onChangeText={setRegPassword}
                  placeholder="Min 8 chars, 1 number"
                  placeholderTextColor="#444"
                  secureTextEntry={!showPw}
                />
                <TouchableOpacity style={styles.eyeBtn} onPress={() => setShowPw(!showPw)}>
                  <Ionicons name={showPw ? 'eye-off-outline' : 'eye-outline'} size={20} color="#555" />
                </TouchableOpacity>
              </View>
              <Text style={styles.label}>CONFIRM PASSWORD</Text>
              <TextInput
                style={styles.input}
                value={regConfirm}
                onChangeText={setRegConfirm}
                placeholder="Repeat password"
                placeholderTextColor="#444"
                secureTextEntry={!showPw}
              />
              {regPassword.length > 0 && regConfirm.length > 0 && regPassword !== regConfirm && (
                <Text style={styles.pwMismatch}>Passwords do not match</Text>
              )}

              <TouchableOpacity
                style={[styles.btn, loading && styles.btnOff]}
                onPress={handleRegister}
                disabled={loading}
              >
                {loading
                  ? <ActivityIndicator color="#000" />
                  : <Text style={styles.btnTxt}>CREATE ACCOUNT</Text>}
              </TouchableOpacity>

              <View style={styles.securityBadge}>
                <Ionicons name="shield-checkmark-outline" size={12} color="#555" />
                <Text style={styles.securityTxt}>
                  Your account is private — nobody else can access your workouts or stats.
                </Text>
              </View>
            </View>
          )}
        </Animated.View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  hero: { position: 'absolute', top: 0, left: 0, right: 0, height: '55%', opacity: 0.4 },
  overlay: { position: 'absolute', top: 0, left: 0, right: 0, height: '70%' },
  inner: { flexGrow: 1, justifyContent: 'center', padding: 28, paddingTop: 80 },
  logo: {
    width: 72, height: 72, borderRadius: 20,
    alignItems: 'center', justifyContent: 'center',
    alignSelf: 'center', marginBottom: 12,
  },
  appName: { color: COLORS.recoveryHigh, fontSize: 32, fontWeight: '800', textAlign: 'center', letterSpacing: 2 },
  tagline: { color: '#666', fontSize: 13, textAlign: 'center', marginBottom: 32, letterSpacing: 1 },
  toggle: {
    flexDirection: 'row', backgroundColor: '#111',
    borderRadius: 14, padding: 4, marginBottom: 24,
    borderWidth: 1, borderColor: '#1F1F1F',
  },
  toggleBtn: { flex: 1, paddingVertical: 11, borderRadius: 10, alignItems: 'center' },
  toggleActive: { backgroundColor: COLORS.recoveryHigh },
  toggleTxt: { color: '#555', fontSize: 12, fontWeight: '700', letterSpacing: 1 },
  toggleTxtActive: { color: '#000' },
  form: { gap: 4 },
  label: { color: '#555', fontSize: 10, fontWeight: '700', letterSpacing: 1.5, marginTop: 10, marginBottom: 4 },
  input: {
    backgroundColor: '#111', borderRadius: 12,
    padding: 15, color: '#FFF', fontSize: 15,
    borderWidth: 1, borderColor: '#222', marginBottom: 4,
  },
  pwWrap: { flexDirection: 'row', alignItems: 'center', gap: 0, marginBottom: 4 },
  eyeBtn: {
    position: 'absolute', right: 14,
    height: '100%', justifyContent: 'center',
  },
  pwMismatch: { color: COLORS.danger, fontSize: 12, marginBottom: 4 },
  btn: {
    backgroundColor: COLORS.recoveryHigh, borderRadius: 14,
    padding: 16, alignItems: 'center', marginTop: 12,
  },
  btnOff: { opacity: 0.55 },
  btnTxt: { color: '#000', fontSize: 14, fontWeight: '800', letterSpacing: 1 },
  securityBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: '#0A1A0A', borderRadius: 10,
    padding: 10, marginTop: 14,
    borderWidth: 1, borderColor: '#1A2E1A',
  },
  securityTxt: { color: '#555', fontSize: 11, flex: 1, lineHeight: 16 },
});
