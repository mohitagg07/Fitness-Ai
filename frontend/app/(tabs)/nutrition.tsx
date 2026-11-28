import ProgressScreen from '../../src/components/progress/ProgressScreen';

/**
 * Dedicated Nutrition destination.
 *
 * Reuses the existing nutrition tracker and its API/cache rather than
 * introducing a second data implementation or duplicating nutrition state.
 */
export default function NutritionTab() {
  return <ProgressScreen initialTab="nutrition" />;
}
