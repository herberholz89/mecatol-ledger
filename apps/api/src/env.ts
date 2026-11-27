import type { AppUser } from './db/schema.js';

export interface Bindings {
  DATABASE_URL: string;
  /** Neon Auth URL for the branch, including its path (e.g. https://….neonauth…/neondb/auth). */
  NEON_AUTH_BASE_URL: string;
  /** Comma-separated emails that get the admin role. Optional. */
  ADMIN_EMAILS?: string;
  ASSETS: Fetcher;
}

export interface Variables {
  /** Set by `requireUser`. */
  user: AppUser;
}

export interface AppEnv {
  Bindings: Bindings;
  Variables: Variables;
}
