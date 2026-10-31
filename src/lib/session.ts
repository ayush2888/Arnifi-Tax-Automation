import { cookies } from "next/headers";

import { DEMO_USER_ID } from "@/config/product";

export type Session = { userId: string; clientId: string };

export async function readSession(): Promise<Session | null> {
  const jar = await cookies();
  const userId = jar.get("daftar_user")?.value;
  const clientId = jar.get("daftar_client")?.value;
  if (!userId) return null;
  // clientId may be empty when the accountant has no company yet (create from Home).
  return { userId, clientId: clientId || "" };
}

export class SessionError extends Error {
  code = "unauthorized" as const;
  constructor() {
    super("unauthorized");
    this.name = "SessionError";
  }
}

export async function requireSession(): Promise<Session> {
  const session = await readSession();
  if (!session) throw new SessionError();
  return session;
}

/**
 * Dev/e2e helper when cookies are missing.
 * Never invents a lab/colleague client id — callers must set client via /api/session.
 */
export async function requireSessionOrDemo(): Promise<Session> {
  const session = await readSession();
  if (!session) {
    return { userId: DEMO_USER_ID, clientId: "" };
  }
  return session;
}

export const SESSION_COOKIE = {
  httpOnly: true,
  sameSite: "lax" as const,
  path: "/",
  secure: process.env.NODE_ENV === "production",
};
