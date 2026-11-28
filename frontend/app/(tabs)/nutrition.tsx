import { useEffect } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import ProgressScreen from '../../src/components/progress/ProgressScreen';

/**
 * Dedicated Nutrition destination.
 *
 * Reuses the existing nutrition tracker and API cache. The openLog parameter
 * lets Coach and Home hand the athlete directly into meal entry.
 */
export default function NutritionTab() {
  const params = useLocalSearchParams<{ openLog?: string }>();

  useEffect(() => {
    if (params.openLog === '1') {
      router.setParams({ openLog: undefined });
    }
  }, [params.openLog]);

  return (
    <ProgressScreen
      initialTab="nutrition"
      initialOpenFood={params.openLog === '1'}
    />
  );
}
