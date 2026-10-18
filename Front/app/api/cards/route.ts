import { NextRequest } from "next/server";
import {
  backendErrorResponse,
  backendJsonResponse,
  jsonBody,
  requestBackendJson,
} from "@/lib/backend/client";

export async function GET() {
  try {
    return backendJsonResponse(await requestBackendJson("/envelopes"));
  } catch (error) {
    return backendErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const monthlyBudget = Number(body.monthlyBudgetUsd);

    if (!name || !Number.isFinite(monthlyBudget) || monthlyBudget <= 0 || !body.customerId) {
      return Response.json(
        { error: "Le nom, le budget mensuel et le customerId KYC sont requis." },
        { status: 400 }
      );
    }

    return backendJsonResponse(
      await requestBackendJson("/envelopes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: jsonBody({
          name,
          monthly_budget_usd: monthlyBudget,
          customer_id: body.customerId,
          cardholder_name: body.cardholderName,
          card_brand: body.cardBrand,
          enforce_monthly_limit: true,
        }),
      })
    );
  } catch (error) {
    return backendErrorResponse(error);
  }
}
