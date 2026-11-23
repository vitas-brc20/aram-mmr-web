import { NextRequest, NextResponse } from "next/server";
import { handleApiRequest } from "@/server/mayhem_engine.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function proxy(
  req: NextRequest,
  context: { params: Promise<{ path: string[] }> }
) {
  const { path } = await context.params;
  const pathname = "/api/" + (path || []).join("/");
  const method = req.method || "GET";
  let bodyBuffer: Buffer | null = null;

  if (method !== "GET" && method !== "HEAD") {
    const ab = await req.arrayBuffer();
    if (ab.byteLength > 0) {
      bodyBuffer = Buffer.from(ab);
    }
  }

  const res = await handleApiRequest(
    pathname,
    method,
    req.nextUrl.searchParams,
    bodyBuffer
  );

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

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ path: string[] }> }
) {
  return proxy(req, context);
}

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ path: string[] }> }
) {
  return proxy(req, context);
}
