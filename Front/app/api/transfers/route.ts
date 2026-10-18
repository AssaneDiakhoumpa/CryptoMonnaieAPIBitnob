import { NextRequest, NextResponse } from "next/server";
import {
  backendErrorResponse,
  backendJsonResponse,
  jsonBody,
  requestBackendJson,
} from "@/lib/backend/client";

function payoutBody(body: Record<string, unknown>) {
  const method = body.method;
  const destinationType =
    method === "bank_account" ? "bank" : method === "mobile_money" ? "mobile_money" : null;
  if (!destinationType) {
    throw new Error("Le backend ne prend pas en charge ce mode de retrait.");
  }

  return {
    quote: {
      amount: String(body.amountSent),
      country: body.country,
      from_asset: body.currencySent,
      to_currency: body.currencyReceived,
      source: "offchain",
      reference: body.reference,
    },
    beneficiary: {
      destination_type: destinationType,
      country: body.country,
      account_name: body.recipientName,
      account_number: body.accountNumber,
      bank_code: body.bankCode,
    },
    payment_reason: body.paymentReason,
    reference: body.reference,
  };
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    if (body.action !== "quote" && body.action !== "send") {
      return NextResponse.json({ error: "action doit être quote ou send." }, { status: 400 });
    }
    if (
      !Number.isFinite(Number(body.amountSent)) ||
      Number(body.amountSent) <= 0 ||
      !body.recipientName ||
      !body.accountNumber ||
      !body.bankCode ||
      !body.country ||
      !body.currencyReceived
    ) {
      return NextResponse.json(
        { error: "Montant, bénéficiaire, compte, pays et devise de destination sont requis." },
        { status: 400 }
      );
    }

    const payout = payoutBody(body);
    const action = body.action;
    const result = await requestBackendJson(
      action === "quote" ? "/payout/quote" : "/payout",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: jsonBody(action === "quote" ? payout.quote : payout),
      }
    );
    return backendJsonResponse(result);
  } catch (error) {
    return backendErrorResponse(error);
  }
}

export async function GET(request: NextRequest) {
  try {
    const resource = request.nextUrl.searchParams.get("resource");
    if (resource === "countries") {
      return backendJsonResponse(await requestBackendJson("/payouts/countries"));
    }
    if (resource === "banks") {
      const country = request.nextUrl.searchParams.get("country")?.toUpperCase() ?? "";
      if (!/^[A-Z]{2}$/.test(country)) {
        return NextResponse.json({ error: "country doit être un code ISO-2." }, { status: 400 });
      }
      return backendJsonResponse(
        await requestBackendJson(`/payouts/banks/${encodeURIComponent(country)}`)
      );
    }
    return NextResponse.json({ error: "resource doit être countries ou banks." }, { status: 400 });
  } catch (error) {
    return backendErrorResponse(error);
  }
}
