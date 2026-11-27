import { existsSync } from 'node:fs';
import { defineConfig } from 'drizzle-kit';

// Locally, reuse the Worker's .dev.vars. In CI, DATABASE_URL comes from the environment.
if (!process.env.DATABASE_URL && existsSync('.dev.vars')) process.loadEnvFile('.dev.vars');

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './drizzle',
  // Migrations prefer Neon's direct (unpooled) connection when available.
  dbCredentials: { url: process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL ?? '' },
  strict: true,
  verbose: true,
});
