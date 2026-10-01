import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseConfig } from "./config";

const PUBLIC_PATHS = ["/login", "/signup"];

/** Paths that should always pass through untouched (auth callbacks, sign-out). */
function isAuthRoute(pathname: string): boolean {
  return pathname.startsWith("/auth");
}

/**
 * Refreshes the Supabase session cookie on every matched request and
 * enforces auth redirects:
 *   - not signed in + protected path  → /login
 *   - signed in + /login|/signup      → /
 */
export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const { pathname } = request.nextUrl;

  let url: string;
  let anonKey: string;
  try {
    ({ url, anonKey } = getSupabaseConfig());
  } catch (error) {
    // Supabase isn't configured yet — let the auth pages render (their forms
    // show the setup error on submit) and explain the problem elsewhere.
    if (PUBLIC_PATHS.includes(pathname)) return supabaseResponse;
    const message = error instanceof Error ? error.message : "Supabase is not configured.";
    return new NextResponse(
      `<!doctype html><html lang="en"><meta charset="utf-8"><title>Chatter — setup required</title>` +
        `<body style="font-family:system-ui;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0">` +
        `<div style="max-width:28rem;padding:1.5rem;text-align:center">` +
        `<h1 style="font-size:1.125rem;margin:0 0 .5rem">Setup required</h1>` +
        `<p style="color:#64748b;font-size:.875rem;line-height:1.5">${message}</p>` +
        `</div></body></html>`,
      { status: 503, headers: { "content-type": "text/html; charset=utf-8" } }
    );
  }

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        supabaseResponse = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          supabaseResponse.cookies.set(name, value, options)
        );
      },
    },
  });

  // IMPORTANT: do not run code between createServerClient and getUser(),
  // otherwise users may be randomly logged out.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user && !PUBLIC_PATHS.includes(pathname) && !isAuthRoute(pathname)) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = "/login";
    redirectUrl.search = "";
    return NextResponse.redirect(redirectUrl);
  }

  if (user && (pathname === "/login" || pathname === "/signup")) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = "/";
    redirectUrl.search = "";
    return NextResponse.redirect(redirectUrl);
  }

  return supabaseResponse;
}
