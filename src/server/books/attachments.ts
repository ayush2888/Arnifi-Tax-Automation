import { createHash, randomUUID } from "node:crypto";

import { withUser } from "@/lib/db";
import { putObject } from "@/lib/storage";
import { BooksError } from "@/server/books/errors";
import { writeBooksAudit } from "@/server/books/audit";
import { assertSyntheticTenant } from "@/server/security-gate";

export async function listBooksJournalAttachments(
  userId: string,
  clientId: string,
  entryId: string,
) {
  return withUser(userId, async (db) => {
    await assertSyntheticTenant(db, clientId);
    const entry = await db.query(
      `SELECT id FROM books_journal_entries WHERE id = $1 AND client_id = $2`,
      [entryId, clientId],
    );
    if (!entry.rowCount) throw new BooksError("journal_not_found", "not_found");
    const rows = await db.query(
      `SELECT a.id, a.file_id AS "fileId", a.created_at AS "createdAt",
              f.original_name AS "originalName", f.detected_mime AS "mime", f.size
       FROM books_journal_attachments a
       JOIN files f ON f.id = a.file_id
       WHERE a.entry_id = $1 AND a.client_id = $2
       ORDER BY a.created_at`,
      [entryId, clientId],
    );
    return rows.rows.map((r) => ({ ...r, size: Number(r.size) }));
  });
}

export async function uploadBooksJournalAttachment(
  userId: string,
  clientId: string,
  entryId: string,
  content: Buffer,
  filename: string,
  mime: string,
) {
  return withUser(userId, async (db) => {
    await assertSyntheticTenant(db, clientId);
    const entry = await db.query(
      `SELECT id, status FROM books_journal_entries WHERE id = $1 AND client_id = $2`,
      [entryId, clientId],
    );
    if (!entry.rowCount) throw new BooksError("journal_not_found", "not_found");

    const digest = createHash("sha256").update(content).digest("hex");
    const fileId = randomUUID();
    const attachId = randomUUID();
    const key = `clients/${clientId}/books/journals/${entryId}/${fileId}`;
    await putObject(key, content, mime || "application/octet-stream");
    await db.query(
      `INSERT INTO files (id, client_id, sha256, original_name, detected_mime, size, storage_key, uploaded_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        fileId,
        clientId,
        digest,
        filename,
        mime || "application/octet-stream",
        content.length,
        key,
        userId,
      ],
    );
    await db.query(
      `INSERT INTO books_journal_attachments (id, entry_id, client_id, file_id)
       VALUES ($1,$2,$3,$4)`,
      [attachId, entryId, clientId, fileId],
    );
    await writeBooksAudit(db, {
      clientId,
      actor: userId,
      action: "attach",
      entity: "books_journal_entry",
      entityId: entryId,
      after: { fileId, filename },
    });
    return {
      id: attachId,
      fileId,
      originalName: filename,
      mime: mime || "application/octet-stream",
      size: content.length,
    };
  });
}

/** Staging upload before entry exists; client passes returned fileIds on create. */
export async function uploadBooksAttachmentStaging(
  userId: string,
  clientId: string,
  content: Buffer,
  filename: string,
  mime: string,
) {
  return withUser(userId, async (db) => {
    await assertSyntheticTenant(db, clientId);
    const digest = createHash("sha256").update(content).digest("hex");
    const existing = await db.query(
      `SELECT id FROM files WHERE client_id = $1 AND sha256 = $2 LIMIT 1`,
      [clientId, digest],
    );
    if (existing.rowCount) {
      return {
        fileId: String(existing.rows[0].id),
        originalName: filename,
        duplicate: true,
      };
    }
    const fileId = randomUUID();
    const key = `clients/${clientId}/books/staging/${fileId}`;
    await putObject(key, content, mime || "application/octet-stream");
    await db.query(
      `INSERT INTO files (id, client_id, sha256, original_name, detected_mime, size, storage_key, uploaded_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        fileId,
        clientId,
        digest,
        filename,
        mime || "application/octet-stream",
        content.length,
        key,
        userId,
      ],
    );
    return { fileId, originalName: filename, duplicate: false };
  });
}

export async function linkBooksJournalAttachments(
  db: import("pg").PoolClient,
  clientId: string,
  entryId: string,
  fileIds: string[],
) {
  for (const fileId of fileIds) {
    await db.query(
      `INSERT INTO books_journal_attachments (entry_id, client_id, file_id)
       VALUES ($1,$2,$3)
       ON CONFLICT (entry_id, file_id) DO NOTHING`,
      [entryId, clientId, fileId],
    );
  }
}
