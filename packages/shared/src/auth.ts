import { z } from 'zod';

export const ROLES = ['user', 'admin'] as const;
export type Role = (typeof ROLES)[number];

/** Step 1 of sign-in: the address a 6-digit code is sent to. */
export const signInEmailSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email('Enter a valid email address')),
});

/** Step 2 of sign-in: the code from the email. */
export const signInCodeSchema = z.object({
  otp: z
    .string()
    .trim()
    .regex(/^\d{6}$/, 'Enter the 6-digit code from the email'),
});

export const DISPLAY_NAME_MAX = 40;

export const displayNameSchema = z
  .string()
  .trim()
  .min(1, 'Enter a display name')
  .max(DISPLAY_NAME_MAX, `At most ${DISPLAY_NAME_MAX} characters`);

/** Body of `PATCH /api/me`. */
export const updateMeSchema = z.object({ displayName: displayNameSchema });
export type UpdateMe = z.infer<typeof updateMeSchema>;

/** Response of `GET /api/me` and `PATCH /api/me`. */
export const meResponseSchema = z.object({
  id: z.uuid(),
  email: z.string(),
  displayName: z.string().nullable(),
  role: z.enum(ROLES),
  createdAt: z.string(),
});
export type MeResponse = z.infer<typeof meResponseSchema>;

/** Parses `ADMIN_EMAILS` ("a@x.com, B@y.com") into a lowercased set. */
export function parseAdminEmails(value: string | undefined): Set<string> {
  return new Set(
    (value ?? '')
      .split(',')
      .map((e) => e.trim().toLowerCase())
      .filter((e) => e.length > 0),
  );
}
