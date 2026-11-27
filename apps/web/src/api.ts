import {
  healthResponseSchema,
  meResponseSchema,
  type HealthResponse,
  type MeResponse,
  type UpdateMe,
} from '@mecatol/shared';

export async function fetchHealth(): Promise<HealthResponse> {
  const res = await fetch('/api/health');
  // 503 still carries a valid health body.
  if (!res.ok && res.status !== 503) throw new Error(`Health check failed: ${res.status}`);
  return healthResponseSchema.parse(await res.json());
}

/** The signed-in user, or null when signed out. */
export async function fetchMe(): Promise<MeResponse | null> {
  const res = await fetch('/api/me');
  if (res.status === 401) return null;
  if (!res.ok) throw new Error(`Loading your account failed: ${res.status}`);
  return meResponseSchema.parse(await res.json());
}

export async function updateMe(body: UpdateMe): Promise<MeResponse> {
  const res = await fetch('/api/me', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Saving failed: ${res.status}`);
  return meResponseSchema.parse(await res.json());
}
