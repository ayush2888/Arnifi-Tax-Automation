import { randomUUID } from "node:crypto";

import { withUser } from "@/lib/db";
import { BooksError } from "@/server/books/errors";
import { assertSyntheticTenant } from "@/server/security-gate";

export async function listBooksSavedViews(userId: string, clientId: string) {
  return withUser(userId, async (db) => {
    await assertSyntheticTenant(db, clientId);
    const rows = await db.query(
      `SELECT id, name, scope, config, created_at AS "createdAt"
       FROM books_saved_views
       WHERE client_id = $1 AND (scope = 'shared' OR user_id = $2)
       ORDER BY name`,
      [clientId, userId],
    );
    return rows.rows;
  });
}

export async function createBooksSavedView(
  userId: string,
  clientId: string,
  body: { name: string; scope?: "personal" | "shared"; config?: Record<string, unknown> },
) {
  const name = body.name.trim();
  if (!name) throw new BooksError("view_name_required", "invalid_line");
  const scope = body.scope === "shared" ? "shared" : "personal";
  return withUser(userId, async (db) => {
    await assertSyntheticTenant(db, clientId);
    const id = randomUUID();
    await db.query(
      `INSERT INTO books_saved_views (id, client_id, user_id, name, scope, config)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb)`,
      [id, clientId, userId, name, scope, JSON.stringify(body.config ?? {})],
    );
    return { id, name, scope, config: body.config ?? {} };
  });
}

export async function updateBooksSavedView(
  userId: string,
  clientId: string,
  viewId: string,
  body: { name?: string; scope?: "personal" | "shared"; config?: Record<string, unknown> },
) {
  return withUser(userId, async (db) => {
    await assertSyntheticTenant(db, clientId);
    const row = await db.query(
      `SELECT id, user_id, name, scope, config FROM books_saved_views
       WHERE id = $1 AND client_id = $2`,
      [viewId, clientId],
    );
    if (!row.rowCount) throw new BooksError("view_not_found", "not_found");
    if (String(row.rows[0].user_id) !== userId && row.rows[0].scope !== "shared") {
      throw new BooksError("view_forbidden", "forbidden");
    }
    const name = body.name != null ? body.name.trim() : row.rows[0].name;
    const scope = body.scope ?? row.rows[0].scope;
    const config = body.config ?? row.rows[0].config;
    await db.query(
      `UPDATE books_saved_views SET name = $3, scope = $4, config = $5::jsonb
       WHERE id = $1 AND client_id = $2`,
      [viewId, clientId, name, scope, JSON.stringify(config)],
    );
    return { id: viewId, name, scope, config };
  });
}

export async function deleteBooksSavedView(userId: string, clientId: string, viewId: string) {
  return withUser(userId, async (db) => {
    await assertSyntheticTenant(db, clientId);
    const row = await db.query(
      `SELECT id, user_id FROM books_saved_views WHERE id = $1 AND client_id = $2`,
      [viewId, clientId],
    );
    if (!row.rowCount) throw new BooksError("view_not_found", "not_found");
    if (String(row.rows[0].user_id) !== userId) {
      throw new BooksError("view_forbidden", "forbidden");
    }
    await db.query(`DELETE FROM books_saved_views WHERE id = $1 AND client_id = $2`, [viewId, clientId]);
    return { id: viewId, deleted: true };
  });
}
