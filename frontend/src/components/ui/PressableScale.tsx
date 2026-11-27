import React, { useRef } from 'react';
import {
  Animated,
  Pressable,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { MOTION } from '../../theme/motion';

type Props = Omit<PressableProps, 'style'> & {
  style?: StyleProp<ViewStyle>;
  pressScale?: number;
};

/** UI-thread-safe tactile scale feedback shared by VYRN's interactive primitives. */
const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export default function PressableScale({
  style,
  pressScale = MOTION.pressScale,
  onPressIn,
  onPressOut,
  ...props
}: Props) {
  const scale = useRef(new Animated.Value(1)).current;

  const handlePressIn: NonNullable<PressableProps['onPressIn']> = (event) => {
    Animated.spring(scale, {
      toValue: pressScale,
      useNativeDriver: true,
      speed: MOTION.pressSpeed,
      bounciness: 2,
    }).start();
    onPressIn?.(event);
  };

  const handlePressOut: NonNullable<PressableProps['onPressOut']> = (event) => {
    Animated.spring(scale, {
      toValue: 1,
      useNativeDriver: true,
      speed: MOTION.pressReleaseSpeed,
      bounciness: 3,
    }).start();
    onPressOut?.(event);
  };

  return (
    <AnimatedPressable
      {...props}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      style={[style, { transform: [{ scale }] }]}
    />
  );
}
