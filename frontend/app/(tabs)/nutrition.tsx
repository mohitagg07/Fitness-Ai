import { useLocalSearchParams } from 'expo-router';
import ProgressScreen from '../../src/components/progress/ProgressScreen';

/**
 * Dedicated Nutrition destination.
 *
 * Reuses the existing nutrition tracker and API cache. The openLog parameter
 * lets Coach and Home hand the athlete directly into meal entry.
 */
export default function NutritionTab() {
  const params = useLocalSearchParams<{ openLog?: string }>();
  return (
    <ProgressScreen
      initialTab="nutrition"
      initialOpenFood={params.openLog === '1'}
    />
  );
}
