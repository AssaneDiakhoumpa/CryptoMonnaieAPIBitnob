import { NextRequest } from "next/server";
import {
  backendErrorResponse,
  backendJsonResponse,
  requestBackendJson,
} from "@/lib/backend/client";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_request: NextRequest, { params }: RouteContext) {
  try {
    const { id } = await params;
    return backendJsonResponse(
      await requestBackendJson(
        `/envelopes/${encodeURIComponent(id)}/transactions`
      )
    );
  } catch (error) {
    return backendErrorResponse(error);
  }
}
