import { importBatchSchema } from '@mecatol/shared';
import { Hono } from 'hono';
import { requireUser } from '../auth/middleware.js';
import { getDb } from '../db/connections.js';
import { createImport, deleteImport, listImports } from '../db/imports.js';
import type { AppEnv } from '../env.js';
import { parseId, parseOr400 } from '../http-error.js';

export const importsRoute = new Hono<AppEnv>()
  /** Your own imports, newest first. */
  .get('/', requireUser, async (c) => c.json(await listImports(getDb(c.env.DATABASE_URL), c.var.user.id)))
  /** A spreadsheet already parsed and reviewed in the browser. All games are written or none. */
  .post('/', requireUser, async (c) => {
    const batch = parseOr400(importBatchSchema, await c.req.json().catch(() => null));
    return c.json(await createImport(getDb(c.env.DATABASE_URL), c.var.user, batch), 201);
  })
  /** Undo: deletes the batch and its games. Importer or admin. */
  .delete('/:id', requireUser, async (c) => {
    await deleteImport(getDb(c.env.DATABASE_URL), parseId(c.req.param('id'), 'Import'), c.var.user);
    return c.body(null, 204);
  });
