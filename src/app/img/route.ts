import { NextRequest, NextResponse } from "next/server";
import { handleApiRequest } from "@/server/mayhem_engine.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const res = await handleApiRequest("/img", "GET", req.nextUrl.searchParams, null);
  const headers = new Headers(res.headers);
  const body =
    typeof res.body === "string"
      ? res.body
      : Buffer.isBuffer(res.body)
        ? new Uint8Array(res.body)
        : res.body;

  return new NextResponse(body as BodyInit, {
    status: res.status,
    headers,
  });
}
