import {
  backendErrorResponse,
  backendJsonResponse,
  requestBackendJson,
} from "@/lib/backend/client";

export async function GET() {
  try {
    const [summary, balances] = await Promise.all([
      requestBackendJson("/dashboard/summary"),
      requestBackendJson("/balances"),
    ]);
    if (!summary.ok) return backendJsonResponse(summary);
    if (!balances.ok) return backendJsonResponse(balances);
    return backendJsonResponse({
      ...summary,
      data: { summary: summary.data, balances: balances.data },
    });
  } catch (error) {
    return backendErrorResponse(error);
  }
}
