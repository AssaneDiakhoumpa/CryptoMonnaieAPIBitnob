import { NextRequest, NextResponse } from "next/server";
import {
  backendErrorResponse,
  backendJsonResponse,
  jsonBody,
  requestBackend,
  requestBackendJson,
} from "@/lib/backend/client";

export async function POST(req: NextRequest) {
  try {
    if (req.headers.get("content-type")?.includes("multipart/form-data")) {
      const form = await req.formData();
      const file = form.get("file");
      if (!(file instanceof File)) {
        return NextResponse.json({ error: "Le fichier CSV est requis." }, { status: 400 });
      }
      const backendForm = new FormData();
      backendForm.set("file", file, file.name);
      for (const field of ["name", "from_asset", "payment_reason", "default_destination_type", "strict", "allow_duplicates"]) {
        const value = form.get(field);
        if (typeof value === "string") backendForm.set(field, value);
      }
      return backendJsonResponse(
        await requestBackendJson("/batches", { method: "POST", body: backendForm })
      );
    }

    const body = await req.json();
    const { action, items, batchId } = body;

    if (action === "prepare") {
      if (!Array.isArray(items) || items.length === 0) {
        return NextResponse.json(
          { error: "Un lot doit contenir au moins un bénéficiaire." },
          { status: 400 }
        );
      }
      const beneficiaries = items.map((item: Record<string, unknown>) => ({
        name: item.name,
        account_number: item.phoneOrAccount,
        bank_code: item.bankCode,
        destination_type: item.destinationType || "mobile_money",
        country: item.country,
        amount: String(item.amount),
        currency: item.currency,
      }));
      return backendJsonResponse(
        await requestBackendJson("/batches/manual", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: jsonBody({
            name: body.name,
            from_asset: body.fromAsset || "USDT",
            payment_reason: body.paymentReason || "vendor_payment",
            strict: false,
            beneficiaries,
          }),
        })
      );
    }

    if (action === "confirm" && batchId) {
      return backendJsonResponse(
        await requestBackendJson(`/batches/${encodeURIComponent(batchId)}/execute`, {
          method: "POST",
        })
      );
    }

    if (action === "retry" && batchId) {
      return backendJsonResponse(
        await requestBackendJson(`/batches/${encodeURIComponent(batchId)}/retry`, {
          method: "POST",
        })
      );
    }

    if (action === "refresh" && batchId) {
      return backendJsonResponse(
        await requestBackendJson(`/batches/${encodeURIComponent(batchId)}/refresh`, {
          method: "POST",
        })
      );
    }

    return NextResponse.json(
      { error: "action doit être prepare, confirm, retry ou refresh." },
      { status: 400 }
    );
  } catch (error) {
    return backendErrorResponse(error);
  }
}

export async function GET(request: NextRequest) {
  try {
    const batchId = request.nextUrl.searchParams.get("batchId");
    if (request.nextUrl.searchParams.get("action") === "report") {
      if (!batchId) return NextResponse.json({ error: "batchId est requis." }, { status: 400 });
      const response = await requestBackend(
        `/batches/${encodeURIComponent(batchId)}/report.csv`
      );
      return new NextResponse(await response.text(), {
        status: response.status,
        headers: {
          "Content-Type": response.headers.get("content-type") || "text/csv; charset=utf-8",
          "Content-Disposition": response.headers.get("content-disposition") || "attachment",
        },
      });
    }
    return backendJsonResponse(
      await requestBackendJson(batchId ? `/batches/${encodeURIComponent(batchId)}` : "/batches")
    );
  } catch (error) {
    return backendErrorResponse(error);
  }
}
