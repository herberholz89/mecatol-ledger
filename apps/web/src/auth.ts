import { createAuthClient } from '@neon/auth';

/**
 * Talks to Neon Auth through the Worker's same-origin `/api/auth` proxy, so the session cookie is
 * first-party. Sign-in is a 6-digit email code only.
 */
export const authClient = createAuthClient(`${window.location.origin}/api/auth`);

interface AuthResult {
  error: { code?: string; message?: string; status?: number } | null;
}

/** Better Auth error codes worth a friendlier message. */
const MESSAGES: Record<string, string> = {
  INVALID_OTP: 'That code is wrong. Check the email and try again.',
  OTP_EXPIRED: 'That code has expired. Send a new one.',
  TOO_MANY_ATTEMPTS: 'Too many wrong codes. Send a new one.',
};

function throwOnError(result: AuthResult, fallback: string): void {
  const { error } = result;
  if (!error) return;
  if (error.status === 429) throw new Error('Too many attempts. Wait a minute and try again.');
  throw new Error((error.code && MESSAGES[error.code]) || error.message || fallback);
}

export async function sendSignInCode(email: string): Promise<void> {
  throwOnError(await authClient.emailOtp.sendVerificationOtp({ email, type: 'sign-in' }), 'Could not send the code');
}

export async function signInWithCode(email: string, otp: string): Promise<void> {
  throwOnError(await authClient.signIn.emailOtp({ email, otp }), 'That code is wrong or has expired');
}

export async function signOut(): Promise<void> {
  throwOnError(await authClient.signOut(), 'Could not sign out');
}
