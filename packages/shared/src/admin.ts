import { z } from 'zod';
import { ROLES } from './auth.js';
import { EXPANSIONS } from './factions.js';

// Admin-only bodies and responses: faction management and users & roles.

export const FACTION_NAME_MAX = 60;

export const factionNameSchema = z
  .string()
  .trim()
  .min(1, 'Enter a name')
  .max(FACTION_NAME_MAX, `At most ${FACTION_NAME_MAX} characters`);

/** Body of `POST /api/factions`. */
export const createFactionSchema = z.object({
  name: factionNameSchema,
  expansion: z.enum(EXPANSIONS, 'Pick an expansion'),
});
export type CreateFaction = z.infer<typeof createFactionSchema>;

/** Body of `PATCH /api/factions/:id`: rename, move to another expansion, archive or unarchive. */
export const updateFactionSchema = z
  .object({
    name: factionNameSchema.optional(),
    expansion: z.enum(EXPANSIONS, 'Pick an expansion').optional(),
    archived: z.boolean().optional(),
  })
  .refine((v) => v.name !== undefined || v.expansion !== undefined || v.archived !== undefined, 'Nothing to change');
export type UpdateFaction = z.infer<typeof updateFactionSchema>;

/** A row of `GET /api/users`. */
export const adminUserSchema = z.object({
  id: z.uuid(),
  email: z.string(),
  displayName: z.string().nullable(),
  role: z.enum(ROLES),
  createdAt: z.string(),
  /** Games this user logged. */
  games: z.number().int(),
  /** Players in this user's roster. */
  players: z.number().int(),
  /** Listed in ADMIN_EMAILS: promoted on every sign-in, so their role can't be changed here. */
  adminByEmail: z.boolean(),
});
export type AdminUser = z.infer<typeof adminUserSchema>;

/** Body of `PATCH /api/users/:id`. */
export const updateUserSchema = z.object({ role: z.enum(ROLES, 'Pick a role') });
export type UpdateUser = z.infer<typeof updateUserSchema>;
