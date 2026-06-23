import React from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable } from 'react-native';

type Props = { children: React.ReactNode };
type State = { error: Error | null; info: string | null };

export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null, info: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[ErrorBoundary] Caught render error:', error, info);
    this.setState({ info: info.componentStack || null });
  }

  reset = () => this.setState({ error: null, info: null });

  render() {
    if (this.state.error) {
      return (
        <View style={styles.container}>
          <ScrollView contentContainerStyle={styles.scroll}>
            <Text style={styles.title}>Something crashed</Text>
            <Text style={styles.message}>{this.state.error.message}</Text>
            {this.state.info ? <Text style={styles.stack}>{this.state.info}</Text> : null}
            <Pressable style={styles.button} onPress={this.reset}>
              <Text style={styles.buttonText}>Try again</Text>
            </Pressable>
          </ScrollView>
        </View>
      );
    }
    return this.props.children;
  }
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a' },
  scroll: { padding: 24, paddingTop: 80 },
  title: { color: '#ff5555', fontSize: 20, fontWeight: '700', marginBottom: 12 },
  message: { color: '#ffffff', fontSize: 15, marginBottom: 16 },
  stack: { color: '#888888', fontSize: 11, fontFamily: 'monospace', marginBottom: 24 },
  button: { backgroundColor: '#3ddc6f', paddingVertical: 12, paddingHorizontal: 20, borderRadius: 10, alignSelf: 'flex-start' },
  buttonText: { color: '#000000', fontWeight: '700' },
});