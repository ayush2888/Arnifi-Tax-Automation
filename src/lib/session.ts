import { cookies } from "next/headers";

import { DEMO_CLIENT_ID, DEMO_USER_ID } from "@/config/product";

export type Session = { userId: string; clientId: string };

export async function readSession(): Promise<Session | null> {
  const jar = await cookies();
  const userId = jar.get("daftar_user")?.value;
  const clientId = jar.get("daftar_client")?.value;
  if (!userId || !clientId) return null;
  return { userId, clientId };
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

/** Dev/e2e helper — only when cookies already present. */
export async function requireSessionOrDemo(): Promise<Session> {
  const session = await readSession();
  if (!session) {
    return { userId: DEMO_USER_ID, clientId: DEMO_CLIENT_ID };
  }
  return session;
}

export const SESSION_COOKIE = {
  httpOnly: true,
  sameSite: "lax" as const,
  path: "/",
  secure: process.env.NODE_ENV === "production",
};
