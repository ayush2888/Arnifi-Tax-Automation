import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { DEMO_CLIENT_ID, DEMO_USER_ID } from "@/config/product";

export function middleware(request: NextRequest) {
  if (request.nextUrl.pathname.startsWith("/api")) return NextResponse.next();
  if (request.cookies.get("daftar_user") && request.cookies.get("daftar_client")) {
    return NextResponse.next();
  }
  const response = NextResponse.redirect(request.nextUrl);
  response.cookies.set("daftar_user", DEMO_USER_ID, { httpOnly: true, sameSite: "lax", path: "/" });
  response.cookies.set("daftar_client", DEMO_CLIENT_ID, { httpOnly: true, sameSite: "lax", path: "/" });
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg).*)"],
};
