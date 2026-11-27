// VYRN — Confetti burst for the Workout Complete moment
//
// Deliberately not a new dependency (no react-native-confetti-cannon /
// lottie) — built on RN's own Animated API, same primitive ScoreRing and
// DashboardSkeleton already use elsewhere in this codebase. ~28 small
// rects fall from a point near the top of the card, each with random
// horizontal drift, rotation, and a staggered start so the burst doesn't
// look mechanical. Plays once when `active` flips true, then unmounts.
import React, { useEffect, useMemo, useRef } from 'react';
import { View, Animated, StyleSheet, Dimensions } from 'react-native';
import { COLORS } from '../../theme/colors';
import { useReducedMotion } from '../../hooks/useReducedMotion';
const { width: SCREEN_W } = Dimensions.get('window');
const COLORS_POOL = [COLORS.primaryGreen, COLORS.strain, COLORS.recoveryMed, COLORS.strainGlow, '#FFFFFF'];
const PARTICLE_COUNT = 28;
interface Particle {
  id: number;
  x: number;
  color: string;
  size: number;
  delay: number;
  rotateDir: number;
  driftX: number;
}
function ConfettiBurst({ active }: { active: boolean }) {
  const anims = useRef<Animated.Value[]>([]).current;
  const reduceMotion = useReducedMotion();
  const particles: Particle[] = useMemo(() => {
    return Array.from({ length: PARTICLE_COUNT }).map((_, i) => ({
      id: i,
      x: Math.random() * SCREEN_W,
      color: COLORS_POOL[i % COLORS_POOL.length],
      size: 5 + Math.random() * 5,
      delay: Math.random() * 250,
      rotateDir: Math.random() > 0.5 ? 1 : -1,
      driftX: (Math.random() - 0.5) * 80,
    }));
  }, []);
  if (anims.length === 0) {
    particles.forEach(() => anims.push(new Animated.Value(0)));
  }
  useEffect(() => {
    // Always stop a previous burst before starting or suppressing another.
    // This matters when Android accessibility settings change while a modal
    // is open or when the user closes a celebration mid-flight.
    if (!active || reduceMotion) {
      anims.forEach((animation) => {
        animation.stopAnimation();
        animation.setValue(0);
      });
      return undefined;
    }

    const animations = particles.map((particle, index) =>
      Animated.timing(anims[index], {
        toValue: 1,
        duration: 1600 + particle.delay * 0.35,
        delay: particle.delay,
        useNativeDriver: true,
      }),
    );
    const burst = Animated.stagger(15, animations);
    burst.start();
    return () => {
      burst.stop();
      anims.forEach((animation) => animation.stopAnimation());
    };
  }, [active, reduceMotion, anims, particles]);
  if (!active || reduceMotion) return null;
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {particles.map((p, i) => {
        const translateY = anims[i].interpolate({ inputRange: [0, 1], outputRange: [-20, 420] });
        const translateX = anims[i].interpolate({ inputRange: [0, 1], outputRange: [0, p.driftX] });
        const rotate = anims[i].interpolate({
          inputRange: [0, 1],
          outputRange: [`0deg`, `${p.rotateDir * 540}deg`],
        });
        const opacity = anims[i].interpolate({ inputRange: [0, 0.8, 1], outputRange: [1, 1, 0] });
        return (
          <Animated.View
            key={p.id}
            style={{
              position: 'absolute',
              left: p.x,
              top: 0,
              width: p.size,
              height: p.size * 2,
              backgroundColor: p.color,
              borderRadius: 1,
              opacity,
              transform: [{ translateY }, { translateX }, { rotate }],
            }}
          />
        );
      })}
    </View>
  );
}

export default React.memo(ConfettiBurst);
