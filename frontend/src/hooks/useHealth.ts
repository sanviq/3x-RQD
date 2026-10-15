import { useEffect, useState } from 'react';
import { getHealth } from '../api/roadQuality';
import type { HealthResponse } from '../types/api';
export function useHealth() {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError('');
    getHealth(controller.signal).then(value => { if (!controller.signal.aborted) setHealth(value); })
      .catch(error => { if (!controller.signal.aborted) { setHealth(null); setError(error.message); } })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [attempt]);
  return { health, loading, error, retry: () => setAttempt(x => x + 1) };
}
