import { useEffect } from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { router } from 'expo-router';
import { storage } from '../src/utils/storage';

export default function Index() {
  useEffect(() => {
    (async () => {
      try {
        const token = await storage.getItem('fitai_token');
        router.replace(token ? '/(tabs)' : '/login');
      } catch {
        router.replace('/login');
      }
    })();
  }, []);

  return (
    <View style={styles.container}>
      <ActivityIndicator color="#FFD700" size="large" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#121212', justifyContent: 'center', alignItems: 'center' },
});