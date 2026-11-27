import { healthResponseSchema, type HealthResponse } from '@mecatol/shared';

export async function fetchHealth(): Promise<HealthResponse> {
  const res = await fetch('/api/health');
  // 503 still carries a valid health body.
  if (!res.ok && res.status !== 503) throw new Error(`Health check failed: ${res.status}`);
  return healthResponseSchema.parse(await res.json());
}
