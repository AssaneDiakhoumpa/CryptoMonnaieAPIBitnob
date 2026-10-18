import { NextRequest } from "next/server";
import {
  backendErrorResponse,
  backendJsonResponse,
  requestBackendJson,
} from "@/lib/backend/client";
import { normalizeInvoice } from "@/lib/backend/invoices";
import { NextResponse } from "next/server";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(_request: NextRequest, { params }: RouteContext) {
  try {
    const { id } = await params;
    const result = await requestBackendJson(
      `/invoices/${encodeURIComponent(id)}/simulate-paid`,
      { method: "POST" }
    );
    if (!result.ok) return backendJsonResponse(result);
    return NextResponse.json(normalizeInvoice(result.data), { status: result.status });
  } catch (error) {
    return backendErrorResponse(error);
  }
}
