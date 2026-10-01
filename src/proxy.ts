import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";

export async function proxy(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Run on every request except static assets and auth routes
     * (auth routes handle their own session exchange).
     */
    "/((?!_next/static|_next/image|favicon\\.ico|api|auth|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|webmanifest|txt|xml)$).*)",
  ],
};
