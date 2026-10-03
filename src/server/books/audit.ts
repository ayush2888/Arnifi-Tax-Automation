import type { PoolClient } from "pg";

export async function writeBooksAudit(
  db: PoolClient,
  body: {
    clientId: string;
    actor: string;
    action: string;
    entity: string;
    entityId: string;
    before?: unknown;
    after?: unknown;
    source?: string;
  },
) {
  await db.query(
    `INSERT INTO books_audit_events (
       client_id, actor, action, entity, entity_id, before_json, after_json, source
     ) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8)`,
    [
      body.clientId,
      body.actor,
      body.action,
      body.entity,
      body.entityId,
      body.before == null ? null : JSON.stringify(body.before),
      body.after == null ? null : JSON.stringify(body.after),
      body.source || "app",
    ],
  );
}

export async function listBooksAudit(userId: string, clientId: string, entityId: string) {
  const { withUser } = await import("@/lib/db");
  const { assertSyntheticTenant } = await import("@/server/security-gate");
  return withUser(userId, async (db) => {
    await assertSyntheticTenant(db, clientId);
    const rows = await db.query(
      `SELECT id, action, entity, entity_id AS "entityId", before_json AS "before",
              after_json AS "after", source, at, actor
       FROM books_audit_events
       WHERE client_id = $1 AND entity_id = $2
       ORDER BY at DESC
       LIMIT 200`,
      [clientId, entityId],
    );
    return rows.rows;
  });
}
