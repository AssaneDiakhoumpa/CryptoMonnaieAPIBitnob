import { NextRequest } from "next/server";
import {
  backendErrorResponse,
  backendJsonResponse,
  requestBackendJson,
} from "@/lib/backend/client";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(request: NextRequest, { params }: RouteContext) {
  try {
    const { id } = await params;
    const { status } = await request.json();
    if (status !== "active" && status !== "frozen") {
      return Response.json({ error: "status doit être active ou frozen." }, { status: 400 });
    }
    const action = status === "frozen" ? "freeze" : "unfreeze";
    return backendJsonResponse(
      await requestBackendJson(
        `/envelopes/${encodeURIComponent(id)}/${action}`,
        { method: "POST" }
      )
    );
  } catch (error) {
    return backendErrorResponse(error);
  }
}
