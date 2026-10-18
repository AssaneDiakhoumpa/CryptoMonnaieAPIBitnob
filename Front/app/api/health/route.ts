import {
  backendErrorResponse,
  backendJsonResponse,
  requestBackendJson,
} from "@/lib/backend/client";

export async function GET() {
  try {
    return backendJsonResponse(await requestBackendJson("/health"));
  } catch (error) {
    return backendErrorResponse(error);
  }
}
