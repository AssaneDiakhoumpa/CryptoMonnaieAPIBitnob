import { NextResponse } from "next/server";

export class BackendConfigurationError extends Error {}

export class BackendConnectionError extends Error {}

export interface BackendResult {
  status: number;
  ok: boolean;
  data: unknown;
  contentType: string;
}

function removePreimages(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(removePreimages);
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).flatMap(([key, item]) =>
        key.toLowerCase() === "preimage" ? [] : [[key, removePreimages(item)]]
      )
    );
  }

  return value;
}

function errorMessage(payload: unknown, status: number): string {
  if (payload && typeof payload === "object") {
    const record = payload as Record<string, unknown>;
    if (typeof record.error === "string") return record.error;
    if (typeof record.detail === "string") return record.detail;
    if (record.detail && typeof record.detail === "object") {
      const detail = record.detail as Record<string, unknown>;
      if (typeof detail.error === "string") return detail.error;
      if (typeof detail.message === "string") return detail.message;
    }
    if (typeof record.message === "string") return record.message;
  }
  return `Erreur de l’API backend (${status}).`;
}

export async function requestBackend(
  path: string,
  init: RequestInit = {}
): Promise<Response> {
  const baseUrl = process.env.BACKEND_API_URL?.trim();
  const apiKey = process.env.APP_API_KEY?.trim();

  if (!baseUrl) {
    throw new BackendConfigurationError("BACKEND_API_URL n’est pas configurée.");
  }
  if (!apiKey || apiKey === "change-me") {
    throw new BackendConfigurationError(
      "APP_API_KEY doit être configurée avec la même valeur que FastAPI."
    );
  }

  let url: URL;
  try {
    url = new URL(path.replace(/^\/+/, ""), `${baseUrl.replace(/\/+$/, "")}/`);
  } catch {
    throw new BackendConfigurationError("BACKEND_API_URL doit être une URL valide.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new BackendConfigurationError("BACKEND_API_URL doit utiliser HTTP ou HTTPS.");
  }

  const headers = new Headers(init.headers);
  headers.set("X-API-Key", apiKey);
  headers.set("Accept", "application/json");

  try {
    return await fetch(url, { ...init, headers, cache: "no-store" });
  } catch {
    throw new BackendConnectionError("Impossible de joindre l’API backend.");
  }
}

export async function requestBackendJson(
  path: string,
  init: RequestInit = {}
): Promise<BackendResult> {
  const response = await requestBackend(path, init);
  const contentType = response.headers.get("content-type") ?? "";

  if (!contentType.includes("application/json")) {
    return {
      status: response.status,
      ok: response.ok,
      contentType,
      data: response.ok
        ? await response.text()
        : { error: `Erreur de l’API backend (${response.status}).` },
    };
  }

  let data: unknown;
  try {
    data = removePreimages(await response.json());
  } catch {
    data = { error: "Réponse JSON invalide de l’API backend." };
  }

  if (!response.ok) {
    data = { error: errorMessage(data, response.status) };
  }

  return { status: response.status, ok: response.ok, contentType, data };
}

export function backendJsonResponse(result: BackendResult): NextResponse {
  if (typeof result.data === "string") {
    return new NextResponse(result.data, {
      status: result.status,
      headers: { "Content-Type": result.contentType || "text/plain; charset=utf-8" },
    });
  }
  return NextResponse.json(result.data, { status: result.status });
}

export function backendErrorResponse(error: unknown): NextResponse {
  if (error instanceof BackendConfigurationError) {
    return NextResponse.json({ error: error.message }, { status: 503 });
  }
  if (error instanceof BackendConnectionError) {
    return NextResponse.json({ error: error.message }, { status: 502 });
  }
  return NextResponse.json(
    { error: error instanceof Error ? error.message : "Erreur interne du serveur." },
    { status: 500 }
  );
}

export function jsonBody(body: unknown): string {
  return JSON.stringify(body);
}
