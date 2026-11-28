import React, { Component, Suspense, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  StyleSheet,
  View,
  type ViewStyle,
} from 'react-native';
import { Canvas, useFrame } from '@react-three/fiber/native';
import {
  Group,
  Mesh,
} from 'three';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, alpha } from '../../theme/colors';
import { useReducedMotion } from '../../hooks/useReducedMotion';

type SceneProps = {
  size?: number;
  style?: ViewStyle;
};

function OrbModel({ reduceMotion }: { reduceMotion: boolean }) {
  const group = useRef<Group>(null);
  const core = useRef<Mesh>(null);
  const satellite = useRef<Group>(null);

  useFrame((state, delta) => {
    if (reduceMotion) return;
    if (group.current) {
      group.current.rotation.y += delta * 0.22;
      group.current.rotation.x = Math.sin(state.clock.elapsedTime * 0.28) * 0.075;
    }
    if (core.current) {
      const breath = 1 + Math.sin(state.clock.elapsedTime * 1.2) * 0.018;
      core.current.scale.setScalar(breath);
    }
    if (satellite.current) {
      satellite.current.rotation.y -= delta * 0.42;
    }
  });

  return (
    <>
      <ambientLight intensity={0.72} />
      <pointLight position={[2.8, 2.5, 3.5]} intensity={28} color="#D7C9FF" />
      <pointLight position={[-3, -1.5, 1.5]} intensity={18} color="#61DDF4" />
      <pointLight position={[0, -3, -3]} intensity={12} color="#FF8CAF" />
      <group ref={group} rotation={[0.1, -0.28, -0.12]}>
        <mesh ref={core}>
          <icosahedronGeometry args={[0.88, 3]} />
          <meshPhysicalMaterial
            color="#B7A0FF"
            emissive="#4F3B8F"
            emissiveIntensity={0.22}
            metalness={0.72}
            roughness={0.2}
            clearcoat={1}
            clearcoatRoughness={0.12}
          />
        </mesh>
        <mesh rotation={[0.9, 0.2, 0.28]}>
          <torusGeometry args={[1.17, 0.027, 12, 100]} />
          <meshStandardMaterial color="#D0FF55" emissive="#D0FF55" emissiveIntensity={0.5} metalness={0.7} roughness={0.25} />
        </mesh>
        <mesh rotation={[0.18, 1.08, -0.34]}>
          <torusGeometry args={[1.38, 0.018, 10, 100]} />
          <meshStandardMaterial color="#6EDDF6" emissive="#6EDDF6" emissiveIntensity={0.72} metalness={0.68} roughness={0.22} />
        </mesh>
        <group ref={satellite} rotation={[0.35, 0.3, 0]}>
          <mesh position={[1.38, 0.08, 0.12]}>
            <icosahedronGeometry args={[0.105, 1]} />
            <meshPhysicalMaterial color="#FF93B7" emissive="#B33B70" emissiveIntensity={0.35} metalness={0.62} roughness={0.24} />
          </mesh>
          <mesh position={[-1.08, -0.48, -0.1]}>
            <sphereGeometry args={[0.055, 16, 16]} />
            <meshStandardMaterial color="#D0FF55" emissive="#D0FF55" emissiveIntensity={0.6} />
          </mesh>
        </group>
      </group>
    </>
  );
}

class SceneBoundary extends Component<
  { children: React.ReactNode; fallback: React.ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error) {
    if (__DEV__) console.warn('[VYRN] Coach orb 3D scene unavailable', error);
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

function StaticOrbFallback({ size }: { size: number }) {
  return (
    <View style={[styles.fallback, { width: size, height: size, borderRadius: size / 2 }]}>
      <LinearGradient
        colors={[COLORS.coachPurple, COLORS.coachCyan, COLORS.coachCoral]}
        start={{ x: 0.08, y: 0 }}
        end={{ x: 0.92, y: 1 }}
        style={[StyleSheet.absoluteFill, { borderRadius: size / 2, opacity: 0.22 }]}
      />
      <View style={styles.fallbackRing}>
        <View style={styles.fallbackCore}>
          <Ionicons name="sparkles" size={28} color={COLORS.coachLavender} />
        </View>
      </View>
    </View>
  );
}

export default function CoachOrbScene({ size = 118, style }: SceneProps) {
  const reduceMotion = useReducedMotion();
  const [ready, setReady] = useState(false);

  return (
    <View style={[styles.container, { width: size, height: size }, style]}>
      <SceneBoundary fallback={<StaticOrbFallback size={size} />}>
        <Canvas
          style={{ width: size, height: size }}
          camera={{ position: [0, 0, 4.1], fov: 34, near: 0.1, far: 20 }}
          dpr={Platform.OS === 'android' ? 1 : 1.4}
          frameloop={reduceMotion ? 'demand' : 'always'}
          gl={{ alpha: true, antialias: Platform.OS !== 'android' }}
          onCreated={({ gl }) => {
            gl.setClearColor(0x080b11, 0);
            setReady(true);
          }}
        >
          <Suspense fallback={null}>
            <OrbModel reduceMotion={reduceMotion} />
          </Suspense>
        </Canvas>
        {!ready && (
          <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.loading]}>
            <ActivityIndicator color={COLORS.coachLavender} size="small" />
          </View>
        )}
      </SceneBoundary>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    overflow: 'visible',
    alignItems: 'center',
    justifyContent: 'center',
  },
  fallback: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: alpha(COLORS.coachLavender, 0.26),
    backgroundColor: COLORS.coachDeep,
  },
  fallbackRing: {
    width: '76%',
    height: '76%',
    borderRadius: 999,
    borderWidth: 1,
    borderColor: alpha(COLORS.coachCyan, 0.6),
    alignItems: 'center',
    justifyContent: 'center',
    transform: [{ rotate: '-24deg' }],
  },
  fallbackCore: {
    width: '68%',
    height: '68%',
    borderRadius: 999,
    backgroundColor: alpha(COLORS.coachPurple, 0.24),
    alignItems: 'center',
    justifyContent: 'center',
    transform: [{ rotate: '24deg' }],
  },
  loading: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
