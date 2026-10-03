import type { PoolClient } from "pg";

import { BooksError } from "@/server/books/errors";

/** Post / reverse / lock: actor must be admin or approver, and not the preparer. */
export async function requireDualControlActor(
  db: PoolClient,
  actorUserId: string,
  preparerUserId: string | null | undefined,
  action: "post" | "reverse" | "lock",
) {
  const roleRow = await db.query(`SELECT role FROM users WHERE id = $1`, [actorUserId]);
  if (!roleRow.rowCount) throw new BooksError("user_not_found", "forbidden");
  const role = String(roleRow.rows[0].role);
  if (!["admin", "approver"].includes(role)) {
    throw new BooksError(`${action}_requires_approver`, "forbidden");
  }
  if (preparerUserId && preparerUserId === actorUserId) {
    throw new BooksError(`${action}_preparer_cannot_approve`, "forbidden");
  }
}

export async function requireApproverOrAdmin(db: PoolClient, actorUserId: string, action: string) {
  const roleRow = await db.query(`SELECT role FROM users WHERE id = $1`, [actorUserId]);
  if (!roleRow.rowCount) throw new BooksError("user_not_found", "forbidden");
  const role = String(roleRow.rows[0].role);
  if (!["admin", "approver"].includes(role)) {
    throw new BooksError(`${action}_requires_approver`, "forbidden");
  }
}
