import { NextResponse } from "next/server";

export const runtime = "nodejs";

/** Response deletion is not supported in Placecom (Google Forms parity without delete). */
export async function DELETE() {
  return NextResponse.json(
    { error: "Deleting responses is not supported in Placecom." },
    { status: 405 },
  );
}
