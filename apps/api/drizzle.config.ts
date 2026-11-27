import { existsSync } from 'node:fs';
import { defineConfig } from 'drizzle-kit';

// Locally, reuse the Worker's .dev.vars. In CI, DATABASE_URL comes from the environment.
if (!process.env.DATABASE_URL && existsSync('.dev.vars')) process.loadEnvFile('.dev.vars');

/**
 * Neon's connection strings use sslmode=require. The pg driver already treats that as verify-full
 * but prints a deprecation warning, and drizzle-kit exits with code 1 (no error shown) when that
 * warning fires. Spelling out verify-full keeps today's behavior and silences the warning.
 */
function withExplicitSslMode(url: string): string {
  return url.replace(/([?&]sslmode=)(prefer|require|verify-ca)\b/, '$1verify-full');
}

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './drizzle',
  // Migrations prefer Neon's direct (unpooled) connection when available.
  dbCredentials: {
    url: withExplicitSslMode(process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL ?? ''),
  },
  strict: true,
  verbose: true,
});
