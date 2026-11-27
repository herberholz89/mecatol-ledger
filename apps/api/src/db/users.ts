import { eq, sql } from 'drizzle-orm';
import { createDb } from './client.js';
import { appUsers, type AppUser } from './schema.js';

/**
 * Creates or refreshes the app_users row for a signed-in Neon Auth user, in one round trip.
 * The email is refreshed from the session. Admins listed in ADMIN_EMAILS are promoted;
 * nobody is demoted here, so roles granted later by an admin stick.
 */
export async function upsertAppUser(
  databaseUrl: string,
  input: { id: string; email: string; isAdmin: boolean },
): Promise<AppUser> {
  const role = input.isAdmin ? 'admin' : 'user';
  const [row] = await createDb(databaseUrl)
    .insert(appUsers)
    .values({ id: input.id, email: input.email, role })
    .onConflictDoUpdate({
      target: appUsers.id,
      set: {
        email: input.email,
        role: input.isAdmin ? sql`'admin'` : sql`${appUsers.role}`,
      },
    })
    .returning();
  if (!row) throw new Error('upsert into app_users returned no row');
  return row;
}

export async function updateDisplayName(databaseUrl: string, id: string, displayName: string): Promise<AppUser> {
  const [row] = await createDb(databaseUrl)
    .update(appUsers)
    .set({ displayName })
    .where(eq(appUsers.id, id))
    .returning();
  if (!row) throw new Error(`app_users row ${id} not found`);
  return row;
}
