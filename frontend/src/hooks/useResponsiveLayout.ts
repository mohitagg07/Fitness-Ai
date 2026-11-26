import { useWindowDimensions } from 'react-native';

export const SCREEN_BREAKPOINTS = {
  tablet: 720,
  desktop: 1080,
} as const;

/**
 * Shared layout metrics for responsive screen composition.
 * Feature state and business logic stay in their existing hooks/store;
 * screens only use this to choose composition and available content width.
 */
export function useResponsiveLayout() {
  const { width, height, fontScale } = useWindowDimensions();
  const isTablet = width >= SCREEN_BREAKPOINTS.tablet;
  const isDesktop = width >= SCREEN_BREAKPOINTS.desktop;

  return {
    width,
    height,
    fontScale,
    isTablet,
    isDesktop,
    columns: isDesktop ? 3 : isTablet ? 2 : 1,
    pageMaxWidth: isDesktop ? 1200 : isTablet ? 960 : 640,
    gutter: width < 360 ? 14 : isTablet ? 24 : 18,
    sectionGap: isTablet ? 20 : 14,
  };
}
