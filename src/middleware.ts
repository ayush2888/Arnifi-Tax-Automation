import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const PUBLIC = new Set(["/login"]);

export function middleware(request: NextRequest) {
  const path = request.nextUrl.pathname;
  if (path.startsWith("/api") || path.startsWith("/_next") || path === "/favicon.ico" || path === "/icon.svg") {
    return NextResponse.next();
  }
  const hasSession =
    Boolean(request.cookies.get("daftar_user")?.value) &&
    Boolean(request.cookies.get("daftar_client")?.value);

  if (PUBLIC.has(path)) {
    if (hasSession && path === "/login") {
      return NextResponse.redirect(new URL("/books", request.url));
    }
    return NextResponse.next();
  }

  if (!hasSession) {
    const login = new URL("/login", request.url);
    login.searchParams.set("next", path);
    return NextResponse.redirect(login);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg).*)"],
};
