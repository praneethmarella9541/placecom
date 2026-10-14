import { NextResponse } from "next/server";

import { getPublicConnection } from "@/lib/integrations/connections";
import { getOrgContext, isOrgError } from "@/lib/org-context";

export const runtime = "nodejs";

/**
 * GET /api/integrations — which connectors this account has linked. Open to everyone in the
 * workspace (staff need to know whether "Find email" is available) and deliberately thin: whether
 * a connector works, never its key, credits or who connected it.
 */
export async function GET(request: Request) {
  const ctx = await getOrgContext(request);
  if (isOrgError(ctx)) return ctx;

  const lusha = await getPublicConnection(ctx.svc, ctx.mailboxOwnerId, "lusha");
  return NextResponse.json({
    connections: {
      lusha: { connected: lusha.connected && lusha.status === "connected", status: lusha.status },
    },
  });
}
