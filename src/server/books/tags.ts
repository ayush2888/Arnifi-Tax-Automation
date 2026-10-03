import { randomUUID } from "node:crypto";

import { withUser } from "@/lib/db";
import { BooksError } from "@/server/books/errors";
import { writeBooksAudit } from "@/server/books/audit";
import { assertSyntheticTenant } from "@/server/security-gate";

export async function listBooksTags(userId: string, clientId: string) {
  return withUser(userId, async (db) => {
    await assertSyntheticTenant(db, clientId);
    const rows = await db.query(
      `SELECT t.id, t.name, t.colour, t.created_at AS "createdAt",
              (
                SELECT count(DISTINCT tl.entry_id)::int
                FROM books_journal_lines tl, unnest(tl.tags) AS tg
                WHERE tl.client_id = $1 AND tg = t.name
              ) AS "usageCount"
       FROM books_tags t
       WHERE t.client_id = $1
       ORDER BY t.name`,
      [clientId],
    );
    return rows.rows.map((row) => ({ ...row, usageCount: Number(row.usageCount) }));
  });
}

export async function createBooksTag(
  userId: string,
  clientId: string,
  body: { name: string; colour?: string },
) {
  const name = body.name.trim();
  if (!name) throw new BooksError("tag_name_required", "invalid_line");
  return withUser(userId, async (db) => {
    await assertSyntheticTenant(db, clientId);
    const id = randomUUID();
    try {
      await db.query(
        `INSERT INTO books_tags (id, client_id, name, colour) VALUES ($1,$2,$3,$4)`,
        [id, clientId, name, body.colour || "#6B7280"],
      );
    } catch (error) {
      if (String(error).includes("unique") || String(error).includes("duplicate")) {
        throw new BooksError("tag_exists", "conflict");
      }
      throw error;
    }
    await writeBooksAudit(db, {
      clientId,
      actor: userId,
      action: "create",
      entity: "books_tag",
      entityId: id,
      after: { name },
    });
    return { id, name, colour: body.colour || "#6B7280" };
  });
}

export async function updateBooksTag(
  userId: string,
  clientId: string,
  tagId: string,
  body: { name?: string; colour?: string },
) {
  return withUser(userId, async (db) => {
    await assertSyntheticTenant(db, clientId);
    const before = await db.query(
      `SELECT id, name, colour FROM books_tags WHERE id = $1 AND client_id = $2`,
      [tagId, clientId],
    );
    if (!before.rowCount) throw new BooksError("tag_not_found", "not_found");
    const name = body.name != null ? body.name.trim() : before.rows[0].name;
    const colour = body.colour ?? before.rows[0].colour;
    await db.query(`UPDATE books_tags SET name = $3, colour = $4 WHERE id = $1 AND client_id = $2`, [
      tagId,
      clientId,
      name,
      colour,
    ]);
    await writeBooksAudit(db, {
      clientId,
      actor: userId,
      action: "update",
      entity: "books_tag",
      entityId: tagId,
      before: before.rows[0],
      after: { name, colour },
    });
    return { id: tagId, name, colour };
  });
}

export async function mergeBooksTags(
  userId: string,
  clientId: string,
  sourceTagId: string,
  targetTagId: string,
) {
  if (sourceTagId === targetTagId) {
    throw new BooksError("merge_same_tag", "invalid_line");
  }
  return withUser(userId, async (db) => {
    await assertSyntheticTenant(db, clientId);
    const tags = await db.query(
      `SELECT id, name FROM books_tags WHERE client_id = $1 AND id = ANY($2::uuid[])`,
      [clientId, [sourceTagId, targetTagId]],
    );
    if (tags.rowCount !== 2) throw new BooksError("tag_not_found", "not_found");
    const source = tags.rows.find((r) => String(r.id) === sourceTagId);
    const target = tags.rows.find((r) => String(r.id) === targetTagId);
    if (!source || !target) throw new BooksError("tag_not_found", "not_found");

    await db.query(
      `UPDATE books_journal_lines l
       SET tags = COALESCE(
         (SELECT array_agg(DISTINCT x ORDER BY x)
          FROM unnest(array_replace(l.tags, $2, $3)) AS x),
         '{}'::text[]
       )
       WHERE l.client_id = $1 AND $2 = ANY(l.tags)`,
      [clientId, source.name, target.name],
    );
    await db.query(`DELETE FROM books_tags WHERE id = $1 AND client_id = $2`, [sourceTagId, clientId]);
    await writeBooksAudit(db, {
      clientId,
      actor: userId,
      action: "merge",
      entity: "books_tag",
      entityId: targetTagId,
      before: { source: source.name },
      after: { target: target.name },
    });
    return { id: targetTagId, mergedFrom: sourceTagId, name: target.name };
  });
}

export async function deleteBooksTag(userId: string, clientId: string, tagId: string) {
  return withUser(userId, async (db) => {
    await assertSyntheticTenant(db, clientId);
    const before = await db.query(
      `SELECT id, name FROM books_tags WHERE id = $1 AND client_id = $2`,
      [tagId, clientId],
    );
    if (!before.rowCount) throw new BooksError("tag_not_found", "not_found");
    await db.query(`DELETE FROM books_tags WHERE id = $1 AND client_id = $2`, [tagId, clientId]);
    await writeBooksAudit(db, {
      clientId,
      actor: userId,
      action: "delete",
      entity: "books_tag",
      entityId: tagId,
      before: before.rows[0],
    });
    return { id: tagId, deleted: true };
  });
}
