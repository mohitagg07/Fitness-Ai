import React, { Component, MutableRefObject, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, PanResponder, StyleSheet, View } from 'react-native';
import { Canvas, useFrame } from '@react-three/fiber/native';
import * as THREE from 'three';

import { COLORS } from '../../theme/colors';
import Text from '../ui/Text';

type MuscleKey = 'Chest' | 'Back' | 'Shoulders' | 'Arms' | 'Core' | 'Legs';
type MusclePalette = Record<MuscleKey, string>;

type SceneControls = {
  rotationX: number;
  rotationY: number;
  startX: number;
  startY: number;
  dragging: boolean;
};

type MuscleProps = {
  muscle: MuscleKey;
  palette: MusclePalette;
  selected: MuscleKey;
  position: [number, number, number];
  rotation?: [number, number, number];
  length: number;
  radius: number;
  depth?: number;
};

const CANVAS_BACKGROUND = '#09130E';
const BODY_BASE = '#35483D';
const BODY_DARK = '#28392F';

const TORSO_PROFILE = [
  new THREE.Vector2(0, -0.78),
  new THREE.Vector2(0.26, -0.76),
  new THREE.Vector2(0.39, -0.59),
  new THREE.Vector2(0.37, -0.28),
  new THREE.Vector2(0.43, 0.10),
  new THREE.Vector2(0.54, 0.48),
  new THREE.Vector2(0.50, 0.68),
  new THREE.Vector2(0.28, 0.87),
  new THREE.Vector2(0, 0.90),
];

function MuscleBelly({
  muscle,
  palette,
  selected,
  position,
  rotation = [0, 0, 0],
  length,
  radius,
  depth = 0.62,
}: MuscleProps) {
  const profile = useMemo(() => [
    new THREE.Vector2(0, -length * 0.5),
    new THREE.Vector2(radius * 0.48, -length * 0.43),
    new THREE.Vector2(radius * 0.82, -length * 0.28),
    new THREE.Vector2(radius, -length * 0.05),
    new THREE.Vector2(radius * 0.94, length * 0.15),
    new THREE.Vector2(radius * 0.70, length * 0.34),
    new THREE.Vector2(radius * 0.34, length * 0.47),
    new THREE.Vector2(0, length * 0.5),
  ], [length, radius]);

  const color = palette[muscle] || '#788A7B';
  const isSelected = selected === muscle;

  return (
    <mesh position={position} rotation={rotation} scale={[1, 1, depth]} castShadow receiveShadow>
      <latheGeometry args={[profile, 28]} />
      <meshStandardMaterial
        color={color}
        roughness={0.48}
        metalness={0.055}
        emissive={isSelected ? color : '#000000'}
        emissiveIntensity={isSelected ? 0.24 : 0}
      />
    </mesh>
  );
}

function BodyVolume({
  position,
  scale,
  color = BODY_BASE,
}: {
  position: [number, number, number];
  scale: [number, number, number];
  color?: string;
}) {
  return (
    <mesh position={position} scale={scale} castShadow receiveShadow>
      <sphereGeometry args={[1, 32, 24]} />
      <meshStandardMaterial color={color} roughness={0.72} metalness={0.025} />
    </mesh>
  );
}

function RecoveryAvatar({
  selectedMuscle,
  musclePalette,
  controls,
}: {
  selectedMuscle: MuscleKey;
  musclePalette: MusclePalette;
  controls: MutableRefObject<SceneControls>;
}) {
  const root = useRef<THREE.Group>(null);

  useFrame((_, delta) => {
    if (!root.current) return;
    const step = Math.min(delta, 0.05);
    if (!controls.current.dragging) controls.current.rotationY += step * 0.115;
    root.current.rotation.y = controls.current.rotationY;
    root.current.rotation.x = controls.current.rotationX;
  });

  const m = (muscle: MuscleKey, position: [number, number, number], length: number, radius: number,
    rotation: [number, number, number] = [0, 0, 0], depth = 0.62) => (
      <MuscleBelly
        key={muscle + '-' + position.join('-')}
        muscle={muscle}
        palette={musclePalette}
        selected={selectedMuscle}
        position={position}
        rotation={rotation}
        length={length}
        radius={radius}
        depth={depth}
      />
    );

  return (
    <>
      <group ref={root} position={[0, -0.08, 0]} scale={0.93}>
        {/* Neutral structural silhouette: head, neck, torso, pelvis and limb foundations. */}
        <BodyVolume position={[0, 1.64, 0]} scale={[0.22, 0.28, 0.19]} color={BODY_BASE} />
        <BodyVolume position={[0, 1.30, 0]} scale={[0.13, 0.22, 0.13]} color={BODY_DARK} />
        <mesh position={[0, 0.28, 0]} castShadow receiveShadow>
          <latheGeometry args={[TORSO_PROFILE, 48]} />
          <meshStandardMaterial color={BODY_BASE} roughness={0.68} metalness={0.035} />
        </mesh>
        <BodyVolume position={[0, -0.52, 0]} scale={[0.38, 0.26, 0.23]} color={BODY_DARK} />
        <BodyVolume position={[-0.60, 0.43, 0]} scale={[0.14, 0.42, 0.14]} />
        <BodyVolume position={[0.60, 0.43, 0]} scale={[0.14, 0.42, 0.14]} />
        <BodyVolume position={[-0.73, -0.04, 0.015]} scale={[0.105, 0.39, 0.11]} color={BODY_DARK} />
        <BodyVolume position={[0.73, -0.04, 0.015]} scale={[0.105, 0.39, 0.11]} color={BODY_DARK} />
        <BodyVolume position={[-0.22, -1.00, 0]} scale={[0.19, 0.56, 0.18]} />
        <BodyVolume position={[0.22, -1.00, 0]} scale={[0.19, 0.56, 0.18]} />
        <BodyVolume position={[-0.23, -1.66, -0.015]} scale={[0.13, 0.43, 0.13]} color={BODY_DARK} />
        <BodyVolume position={[0.23, -1.66, -0.015]} scale={[0.13, 0.43, 0.13]} color={BODY_DARK} />
        <BodyVolume position={[-0.23, -2.08, 0.09]} scale={[0.15, 0.10, 0.26]} color={BODY_DARK} />
        <BodyVolume position={[0.23, -2.08, 0.09]} scale={[0.15, 0.10, 0.26]} color={BODY_DARK} />

        {/* Chest: paired pectoral bellies, angled along the fibre direction. */}
        {m('Chest', [-0.235, 0.77, 0.255], 0.43, 0.19, [0, 0, -0.32], 0.54)}
        {m('Chest', [0.235, 0.77, 0.255], 0.43, 0.19, [0, 0, 0.32], 0.54)}

        {/* Back: upper trapezius and latissimus, visible as the model turns. */}
        {m('Back', [-0.145, 0.91, -0.205], 0.43, 0.13, [0, 0, -0.30], 0.62)}
        {m('Back', [0.145, 0.91, -0.205], 0.43, 0.13, [0, 0, 0.30], 0.62)}
        {m('Back', [-0.285, 0.39, -0.235], 0.70, 0.18, [0, 0, -0.13], 0.56)}
        {m('Back', [0.285, 0.39, -0.235], 0.70, 0.18, [0, 0, 0.13], 0.56)}

        {/* Deltoid caps wrap the shoulder joint rather than reading as flat circles. */}
        {m('Shoulders', [-0.535, 0.91, 0.02], 0.32, 0.17, [0, 0, -0.74], 0.83)}
        {m('Shoulders', [0.535, 0.91, 0.02], 0.32, 0.17, [0, 0, 0.74], 0.83)}

        {/* Arms: biceps, triceps and forearm flexor mass. */}
        {m('Arms', [-0.625, 0.48, 0.13], 0.48, 0.135, [0, 0, -0.12], 0.74)}
        {m('Arms', [0.625, 0.48, 0.13], 0.48, 0.135, [0, 0, 0.12], 0.74)}
        {m('Arms', [-0.635, 0.48, -0.105], 0.47, 0.12, [0, 0, -0.12], 0.70)}
        {m('Arms', [0.635, 0.48, -0.105], 0.47, 0.12, [0, 0, 0.12], 0.70)}
        {m('Arms', [-0.735, -0.02, 0.09], 0.46, 0.105, [0, 0, -0.06], 0.75)}
        {m('Arms', [0.735, -0.02, 0.09], 0.46, 0.105, [0, 0, 0.06], 0.75)}

        {/* Core: segmented rectus abdominis with paired oblique walls. */}
        {m('Core', [-0.105, 0.37, 0.285], 0.17, 0.078, [0, 0, -0.04], 0.45)}
        {m('Core', [0.105, 0.37, 0.285], 0.17, 0.078, [0, 0, 0.04], 0.45)}
        {m('Core', [-0.105, 0.13, 0.286], 0.17, 0.078, [0, 0, -0.04], 0.45)}
        {m('Core', [0.105, 0.13, 0.286], 0.17, 0.078, [0, 0, 0.04], 0.45)}
        {m('Core', [-0.10, -0.11, 0.275], 0.16, 0.074, [0, 0, -0.04], 0.45)}
        {m('Core', [0.10, -0.11, 0.275], 0.16, 0.074, [0, 0, 0.04], 0.45)}
        {m('Core', [-0.315, 0.03, 0.15], 0.46, 0.085, [0, 0, -0.54], 0.62)}
        {m('Core', [0.315, 0.03, 0.15], 0.46, 0.085, [0, 0, 0.54], 0.62)}

        {/* Legs: glute shelf, quadriceps, hamstrings, calves and tibialis. */}
        {m('Legs', [-0.235, -0.64, 0.13], 0.33, 0.17, [0, 0, -0.08], 0.72)}
        {m('Legs', [0.235, -0.64, 0.13], 0.33, 0.17, [0, 0, 0.08], 0.72)}
        {m('Legs', [-0.22, -1.00, 0.155], 0.73, 0.155, [0, 0, -0.035], 0.78)}
        {m('Legs', [0.22, -1.00, 0.155], 0.73, 0.155, [0, 0, 0.035], 0.78)}
        {m('Legs', [-0.22, -1.00, -0.13], 0.70, 0.135, [0, 0, -0.025], 0.72)}
        {m('Legs', [0.22, -1.00, -0.13], 0.70, 0.135, [0, 0, 0.025], 0.72)}
        {m('Legs', [-0.23, -1.66, -0.015], 0.58, 0.12, [0, 0, -0.025], 0.82)}
        {m('Legs', [0.23, -1.66, -0.015], 0.58, 0.12, [0, 0, 0.025], 0.82)}
      </group>

      {/* A restrained instrument platform gives the model depth and a clear centre. */}
      <mesh position={[0, -2.22, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.88, 0.012, 10, 88]} />
        <meshBasicMaterial color="#63816A" transparent opacity={0.62} />
      </mesh>
      <mesh position={[0, -2.24, 0]}>
        <cylinderGeometry args={[0.70, 0.78, 0.055, 64]} />
        <meshStandardMaterial color="#17271D" roughness={0.62} metalness={0.16} />
      </mesh>
      <mesh position={[0, 0.12, -0.78]} rotation={[0, 0, 0]}>
        <torusGeometry args={[1.72, 0.007, 8, 96]} />
        <meshBasicMaterial color="#335441" transparent opacity={0.36} />
      </mesh>
    </>
  );
}

function RecoveryScene({
  selectedMuscle,
  musclePalette,
  controls,
}: {
  selectedMuscle: MuscleKey;
  musclePalette: MusclePalette;
  controls: MutableRefObject<SceneControls>;
}) {
  return (
    <>
      <color attach="background" args={[CANVAS_BACKGROUND]} />
      <hemisphereLight args={['#E5F5E7', '#17251B', 1.45]} />
      <ambientLight intensity={0.34} />
      <directionalLight position={[3.8, 5.5, 5]} intensity={2.0} color="#F2FFF2" />
      <directionalLight position={[-4, 1.5, -4]} intensity={1.45} color="#8DCB9A" />
      <pointLight position={[0, -1.2, 3.2]} intensity={0.62} distance={8} color="#B9DE72" />
      <RecoveryAvatar selectedMuscle={selectedMuscle} musclePalette={musclePalette} controls={controls} />
    </>
  );
}

class SceneBoundary extends Component<{
  children: React.ReactNode;
  onFailure: () => void;
}, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error) {
    if (__DEV__) console.warn('[VYRN] R3F muscle scene failed', error);
    this.props.onFailure();
  }

  render() {
    if (this.state.failed) {
      return (
        <View style={styles.fallback}>
          <Text variant="caption" color={COLORS.textMuted} align="center">
            3D rendering is unavailable on this device. The front and back recovery maps are still available.
          </Text>
        </View>
      );
    }
    return this.props.children;
  }
}

export default function ThreeMuscleScene({
  selectedMuscle,
  musclePalette,
  onFailure,
}: {
  selectedMuscle: MuscleKey;
  musclePalette: MusclePalette;
  onFailure: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const controls = useRef<SceneControls>({
    rotationX: 0,
    rotationY: 0,
    startX: 0,
    startY: 0,
    dragging: false,
  });

  const panResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => false,
    onMoveShouldSetPanResponder: (_, gesture) =>
      Math.abs(gesture.dx) > 4 || Math.abs(gesture.dy) > 4,
    onPanResponderGrant: () => {
      controls.current.dragging = true;
      controls.current.startX = controls.current.rotationX;
      controls.current.startY = controls.current.rotationY;
    },
    onPanResponderMove: (_, gesture) => {
      controls.current.rotationY = controls.current.startY + gesture.dx * 0.008;
      controls.current.rotationX = Math.max(
        -0.36,
        Math.min(0.36, controls.current.startX - gesture.dy * 0.0035),
      );
    },
    onPanResponderRelease: () => { controls.current.dragging = false; },
    onPanResponderTerminate: () => { controls.current.dragging = false; },
  }), []);

  return (
    <View style={styles.container}>
      <SceneBoundary onFailure={onFailure}>
        <Canvas
          style={styles.canvas}
          camera={{ position: [0, 0.04, 7.55], fov: 33, near: 0.1, far: 40 }}
          dpr={1.15}
          onCreated={({ gl }) => {
            gl.setClearColor(CANVAS_BACKGROUND, 1);
            setLoading(false);
          }}
        >
          <RecoveryScene selectedMuscle={selectedMuscle} musclePalette={musclePalette} controls={controls} />
        </Canvas>
      </SceneBoundary>
      <View style={styles.dragLayer} {...panResponder.panHandlers}>
        <View style={styles.sceneLabel}>
          <View style={styles.sceneDot} />
          <Text variant="caption" color={COLORS.textSecondary}>3D MUSCLE MAP</Text>
        </View>
        <View style={styles.dragHint}>
          <Text variant="caption" color={COLORS.textMuted}>DRAG TO ROTATE · 360° VIEW</Text>
        </View>
      </View>
      {loading && (
        <View style={styles.loading}>
          <ActivityIndicator color={COLORS.primaryGreen} />
          <Text variant="caption" color={COLORS.textMuted}>Preparing 3D model…</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
    height: 374,
    borderRadius: 22,
    overflow: 'hidden',
    backgroundColor: CANVAS_BACKGROUND,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
  },
  canvas: { width: '100%', height: '100%' },
  dragLayer: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 12,
    paddingBottom: 10,
  },
  sceneLabel: {
    alignSelf: 'flex-start',
    marginLeft: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingHorizontal: 10,
    paddingVertical: 7,
    backgroundColor: 'rgba(5, 14, 9, 0.76)',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(185, 222, 114, 0.16)',
  },
  sceneDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: COLORS.primaryGreen },
  dragHint: {
    paddingHorizontal: 11,
    paddingVertical: 6,
    borderRadius: 20,
    backgroundColor: 'rgba(5, 13, 8, 0.78)',
    borderWidth: 1,
    borderColor: 'rgba(185, 222, 114, 0.16)',
  },
  loading: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
    backgroundColor: CANVAS_BACKGROUND,
  },
  fallback: {
    width: '100%',
    height: 340,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: CANVAS_BACKGROUND,
    padding: 24,
  },
});
