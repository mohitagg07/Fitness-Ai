import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  PanResponder,
  PixelRatio,
  StyleSheet,
  View,
} from 'react-native';
import { GLView, type ExpoWebGLRenderingContext } from 'expo-gl';
import { Renderer, THREE } from 'expo-three';

import { COLORS } from '../../theme/colors';
import Text from '../ui/Text';

type MuscleKey = 'Chest' | 'Back' | 'Shoulders' | 'Arms' | 'Core' | 'Legs';

type MusclePalette = Record<MuscleKey, string>;

type MuscleScene = {
  renderer: Renderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  root: THREE.Group;
  meshes: Map<MuscleKey, THREE.Mesh[]>;
  geometries: THREE.BufferGeometry[];
  materials: THREE.Material[];
};

const MUSCLE_KEYS: MuscleKey[] = ['Chest', 'Back', 'Shoulders', 'Arms', 'Core', 'Legs'];
const CANVAS_BACKGROUND = '#0B1510';
const NEUTRAL_BODY = '#34443B';
const NEUTRAL_DETAIL = '#26372E';

function toThreeColor(value: string): number {
  const normalized = String(value || '').replace('#', '').slice(0, 6);
  const parsed = Number.parseInt(normalized, 16);
  return Number.isFinite(parsed) ? parsed : 0xB9DE72;
}

function addEllipsoid(
  scene: MuscleScene,
  muscle: MuscleKey,
  position: [number, number, number],
  scale: [number, number, number],
  color: string,
  segments = 26,
) {
  const geometry = new THREE.SphereGeometry(1, segments, Math.max(16, segments - 6));
  const material = new THREE.MeshStandardMaterial({
    color: toThreeColor(color),
    roughness: 0.58,
    metalness: 0.04,
    emissive: 0x000000,
    emissiveIntensity: 0,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(position[0], position[1], position[2]);
  mesh.scale.set(scale[0], scale[1], scale[2]);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData.muscle = muscle;
  scene.root.add(mesh);
  scene.geometries.push(geometry);
  scene.materials.push(material);

  const existing = scene.meshes.get(muscle) || [];
  existing.push(mesh);
  scene.meshes.set(muscle, existing);
  return mesh;
}

function addNeutral(
  scene: MuscleScene,
  position: [number, number, number],
  scale: [number, number, number],
  color = NEUTRAL_BODY,
) {
  const geometry = new THREE.SphereGeometry(1, 28, 20);
  const material = new THREE.MeshStandardMaterial({
    color: toThreeColor(color),
    roughness: 0.7,
    metalness: 0.02,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(position[0], position[1], position[2]);
  mesh.scale.set(scale[0], scale[1], scale[2]);
  scene.root.add(mesh);
  scene.geometries.push(geometry);
  scene.materials.push(material);
  return mesh;
}

function buildMuscleModel(scene: MuscleScene, palette: MusclePalette) {
  // The body is a stylised 3D training model, not a medical/anatomical model.
  // Paired, shaded muscle volumes are intentionally kept lightweight.
  addNeutral(scene, [0, 1.35, 0], [0.18, 0.27, 0.17], NEUTRAL_DETAIL); // neck
  addNeutral(scene, [0, 1.72, 0], [0.25, 0.31, 0.23]); // head
  addNeutral(scene, [0, 0.54, 0], [0.49, 0.78, 0.28]); // torso silhouette
  addNeutral(scene, [0, -0.34, 0], [0.39, 0.29, 0.25]); // pelvis
  addNeutral(scene, [0, -0.69, 0], [0.35, 0.2, 0.23], NEUTRAL_DETAIL);

  // Pectorals and the latissimus dorsi sit on opposite sides of the torso.
  addEllipsoid(scene, 'Chest', [-0.235, 0.78, 0.245], [0.255, 0.245, 0.115], palette.Chest);
  addEllipsoid(scene, 'Chest', [0.235, 0.78, 0.245], [0.255, 0.245, 0.115], palette.Chest);
  addEllipsoid(scene, 'Back', [-0.255, 0.47, -0.235], [0.235, 0.5, 0.105], palette.Back);
  addEllipsoid(scene, 'Back', [0.255, 0.47, -0.235], [0.235, 0.5, 0.105], palette.Back);
  addEllipsoid(scene, 'Back', [0, 0.91, -0.16], [0.32, 0.25, 0.1], palette.Back);

  // Deltoids, upper arms and forearms.
  for (const side of [-1, 1]) {
    addEllipsoid(scene, 'Shoulders', [side * 0.53, 0.91, 0.015], [0.245, 0.245, 0.22], palette.Shoulders);
    addEllipsoid(scene, 'Arms', [side * 0.7, 0.48, 0.015], [0.17, 0.39, 0.17], palette.Arms);
    addEllipsoid(scene, 'Arms', [side * 0.79, -0.05, 0.055], [0.135, 0.39, 0.14], palette.Arms);
    addNeutral(scene, [side * 0.82, -0.43, 0.09], [0.105, 0.14, 0.1], NEUTRAL_DETAIL);
  }

  // Abdominal segments form a clear core region without implying a clinical scan.
  for (const side of [-1, 1]) {
    for (const row of [0.34, 0.08, -0.18]) {
      addEllipsoid(scene, 'Core', [side * 0.105, row, 0.267], [0.092, 0.105, 0.055], palette.Core, 20);
    }
  }

  // Quadriceps and lower legs.
  for (const side of [-1, 1]) {
    addEllipsoid(scene, 'Legs', [side * 0.215, -1.03, 0.015], [0.225, 0.53, 0.22], palette.Legs);
    addEllipsoid(scene, 'Legs', [side * 0.23, -1.67, -0.045], [0.155, 0.42, 0.16], palette.Legs);
    addNeutral(scene, [side * 0.23, -2.08, 0.07], [0.17, 0.105, 0.28], NEUTRAL_DETAIL);
  }

  // Fine joint lines and a subtle ground halo add depth without clutter.
  const waist = new THREE.Mesh(
    new THREE.TorusGeometry(0.34, 0.012, 8, 56),
    new THREE.MeshBasicMaterial({ color: 0x58705D, transparent: true, opacity: 0.48 }),
  );
  waist.rotation.x = Math.PI / 2;
  waist.position.y = -0.57;
  scene.root.add(waist);
  scene.geometries.push(waist.geometry);
  scene.materials.push(waist.material);

  const floorRing = new THREE.Mesh(
    new THREE.TorusGeometry(0.93, 0.008, 8, 80),
    new THREE.MeshBasicMaterial({ color: 0x3B6045, transparent: true, opacity: 0.62 }),
  );
  floorRing.rotation.x = Math.PI / 2;
  floorRing.position.y = -2.2;
  scene.root.add(floorRing);
  scene.geometries.push(floorRing.geometry);
  scene.materials.push(floorRing.material);
}

function applyMusclePalette(scene: MuscleScene, palette: MusclePalette, selected: MuscleKey) {
  MUSCLE_KEYS.forEach((key) => {
    const color = toThreeColor(palette[key]);
    (scene.meshes.get(key) || []).forEach((mesh) => {
      const material = mesh.material as THREE.MeshStandardMaterial;
      material.color.setHex(color);
      material.emissive.setHex(key === selected ? color : 0x000000);
      material.emissiveIntensity = key === selected ? 0.23 : 0;
    });
  });
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
  const [failed, setFailed] = useState(false);
  const sceneRef = useRef<MuscleScene | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);
  const paletteRef = useRef(musclePalette);
  const selectedRef = useRef(selectedMuscle);
  const rotationRef = useRef({ x: 0, y: 0, startX: 0, startY: 0 });
  const draggingRef = useRef(false);

  paletteRef.current = musclePalette;
  selectedRef.current = selectedMuscle;

  useEffect(() => {
    if (sceneRef.current) {
      applyMusclePalette(sceneRef.current, paletteRef.current, selectedRef.current);
    }
  }, [musclePalette, selectedMuscle]);

  useEffect(() => () => {
    cleanupRef.current?.();
    cleanupRef.current = null;
    sceneRef.current = null;
  }, []);

  const panResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => false,
    onMoveShouldSetPanResponder: (_, gesture) =>
      Math.abs(gesture.dx) > 3 || Math.abs(gesture.dy) > 3,
    onPanResponderGrant: () => {
      draggingRef.current = true;
      rotationRef.current.startX = rotationRef.current.x;
      rotationRef.current.startY = rotationRef.current.y;
    },
    onPanResponderMove: (_, gesture) => {
      rotationRef.current.y = rotationRef.current.startY + gesture.dx * 0.009;
      rotationRef.current.x = Math.max(
        -0.28,
        Math.min(0.28, rotationRef.current.startX - gesture.dy * 0.004),
      );
      if (sceneRef.current) {
        sceneRef.current.root.rotation.y = rotationRef.current.y;
        sceneRef.current.root.rotation.x = rotationRef.current.x;
      }
    },
    onPanResponderRelease: () => { draggingRef.current = false; },
    onPanResponderTerminate: () => { draggingRef.current = false; },
  }), []);

  const onContextCreate = (gl: ExpoWebGLRenderingContext) => {
    try {
      cleanupRef.current?.();

      const renderer = new Renderer({ gl, alpha: true, antialias: true });
      renderer.setPixelRatio(Math.min(PixelRatio.get(), 1.5));
      renderer.setSize(gl.drawingBufferWidth, gl.drawingBufferHeight);
      renderer.setClearColor(toThreeColor(CANVAS_BACKGROUND), 1);

      const scene = new THREE.Scene();
      scene.background = new THREE.Color(toThreeColor(CANVAS_BACKGROUND));
      const camera = new THREE.PerspectiveCamera(
        35,
        gl.drawingBufferWidth / Math.max(1, gl.drawingBufferHeight),
        0.1,
        40,
      );
      camera.position.set(0, -0.05, 6.6);
      camera.lookAt(0, -0.12, 0);

      scene.add(new THREE.HemisphereLight(0xD8F4DE, 0x15251B, 2.0));
      const keyLight = new THREE.DirectionalLight(0xF3FFF2, 2.2);
      keyLight.position.set(3.5, 5, 5);
      scene.add(keyLight);
      const rimLight = new THREE.DirectionalLight(0x8DCD9A, 1.1);
      rimLight.position.set(-4, 1, -4);
      scene.add(rimLight);
      const fillLight = new THREE.PointLight(0xB9DE72, 0.6, 8);
      fillLight.position.set(0, -1, 3);
      scene.add(fillLight);

      const root = new THREE.Group();
      scene.add(root);
      const model: MuscleScene = {
        renderer,
        scene,
        camera,
        root,
        meshes: new Map(),
        geometries: [],
        materials: [],
      };
      sceneRef.current = model;

      buildMuscleModel(model, paletteRef.current);
      applyMusclePalette(model, paletteRef.current, selectedRef.current);

      let stopped = false;
      let animationFrame = 0;
      const renderFrame = () => {
        if (stopped) return;
        if (!draggingRef.current) {
          root.rotation.y += 0.0023;
          rotationRef.current.y = root.rotation.y;
        }
        root.rotation.x = rotationRef.current.x;
        renderer.render(scene, camera);
        gl.endFrameEXP();
        animationFrame = requestAnimationFrame(renderFrame);
      };
      renderFrame();

      cleanupRef.current = () => {
        stopped = true;
        cancelAnimationFrame(animationFrame);
        model.geometries.forEach((geometry) => geometry.dispose());
        model.materials.forEach((material) => material.dispose());
        renderer.dispose();
      };
      setLoading(false);
    } catch (error) {
      if (__DEV__) console.warn('[VYRN] 3D muscle view failed to initialise', error);
      setFailed(true);
      setLoading(false);
      onFailure();
    }
  };

  if (failed) {
    return (
      <View style={styles.fallback}>
        <Text variant="caption" color={COLORS.textMuted} align="center">
          3D view is unavailable on this device. The 2D muscle map remains available.
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <GLView style={styles.glView} onContextCreate={onContextCreate} msaaSamples={2} />
      <View style={styles.dragLayer} {...panResponder.panHandlers}>
        <View style={styles.dragHint}>
          <Text variant="caption" color={COLORS.textMuted}>DRAG TO ROTATE</Text>
        </View>
      </View>
      {loading && (
        <View style={styles.loading}>
          <ActivityIndicator color={COLORS.primaryGreen} />
          <Text variant="caption" color={COLORS.textMuted}>Building 3D muscle model…</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
    height: 344,
    borderRadius: 18,
    overflow: 'hidden',
    backgroundColor: CANVAS_BACKGROUND,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  glView: { width: '100%', height: '100%' },
  dragLayer: { ...StyleSheet.absoluteFillObject, justifyContent: 'flex-end', alignItems: 'center' },
  dragHint: {
    marginBottom: 10,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 20,
    backgroundColor: 'rgba(5, 13, 8, 0.76)',
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
    height: 300,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: CANVAS_BACKGROUND,
    paddingHorizontal: 18,
  },
});
