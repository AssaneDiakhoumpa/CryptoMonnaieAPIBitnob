import { NextRequest, NextResponse } from "next/server";
import {
  backendErrorResponse,
  backendJsonResponse,
  jsonBody,
  requestBackendJson,
} from "@/lib/backend/client";
import { normalizeInvoice, normalizeInvoiceList } from "@/lib/backend/invoices";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const amountSat = Number(body.amountSat);
    const description = typeof body.description === "string" ? body.description.trim() : "";

    if (!Number.isSafeInteger(amountSat) || amountSat < 1 || amountSat > 20_000_000 || !description) {
      return NextResponse.json(
        { error: "Un montant entier en satoshis (1 à 20 000 000) et une description sont requis." },
        { status: 400 }
      );
    }

    const result = await requestBackendJson("/invoices", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: jsonBody({
        amount_sat: amountSat,
        description,
        customer_id: body.customerId,
        expiry_seconds: body.expirySeconds,
        reference: body.reference,
      }),
    });
    if (!result.ok) return backendJsonResponse(result);
    return NextResponse.json({ invoice: normalizeInvoice(result.data) }, { status: result.status });
  } catch (error) {
    return backendErrorResponse(error);
  }
}

export async function GET() {
  try {
    const result = await requestBackendJson("/invoices");
    if (!result.ok) return backendJsonResponse(result);
    return NextResponse.json({ invoices: normalizeInvoiceList(result.data) }, { status: result.status });
  } catch (error) {
    return backendErrorResponse(error);
  }
}
