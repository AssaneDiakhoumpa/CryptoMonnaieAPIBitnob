import { NextRequest, NextResponse } from "next/server";
import {
  BackendConfigurationError,
  BackendConnectionError,
  requestBackend,
} from "@/lib/backend/client";

export async function POST(req: NextRequest) {
  try {
    const headers = new Headers();
    for (const name of ["content-type", "x-bitnob-signature", "x-bitnob-event-id"]) {
      const value = req.headers.get(name);
      if (value) headers.set(name, value);
    }
    const upstream = await requestBackend("/webhooks/bitnob", {
      method: "POST",
      headers,
      body: await req.arrayBuffer(),
    });
    const responseHeaders = new Headers();
    const contentType = upstream.headers.get("content-type");
    if (contentType) responseHeaders.set("content-type", contentType);
    return new NextResponse(await upstream.arrayBuffer(), {
      status: upstream.status,
      headers: responseHeaders,
    });
  } catch (error) {
    const status =
      error instanceof BackendConfigurationError
        ? 503
        : error instanceof BackendConnectionError
          ? 502
          : 500;
    const message =
      error instanceof Error ? error.message : "Erreur interne du serveur.";
    return NextResponse.json({ error: message }, { status });
  }
}
