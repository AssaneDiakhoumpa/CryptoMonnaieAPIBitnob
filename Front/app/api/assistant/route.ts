import { NextRequest, NextResponse } from "next/server";
import { generateAssistantReply } from "@/lib/assistant-engine";
const MAX_MESSAGE_LENGTH = 4000;
const UNAVAILABLE_REPLY =
  "Les analyses financières, les taux, les frais et les recherches de transactions ne sont pas raccordés à des données vérifiées. Je ne peux donc pas confirmer de montants. Je n’exécute pas non plus de paiements, de modifications de données ou de requêtes SQL. Le service d’analyse de l’ERP n’est pas disponible pour le moment.";

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "Le corps de la requête doit être un JSON valide." },
      { status: 400 }
    );
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Le corps de la requête doit être un objet JSON." }, { status: 400 });
  }

  const message = (body as Record<string, unknown>).message;
  if (typeof message !== "string" || !message.trim()) {
    return NextResponse.json(
      { error: "Veuillez fournir un message textuel valide." },
      { status: 400 }
    );
  }
  if (message.length > MAX_MESSAGE_LENGTH) {
    return NextResponse.json(
      { error: `Le message ne peut pas dépasser ${MAX_MESSAGE_LENGTH} caractères.` },
      { status: 400 }
    );
  }

  const result = generateAssistantReply(message.trim());
  const isSecurityRequest = result.computation?.type === "security_block";

  return NextResponse.json({
    success: true,
    reply: isSecurityRequest
      ? "Je ne peux ni exécuter de paiements, ni modifier des données, ni exécuter des instructions SQL. Aucune action n’a été effectuée."
      : UNAVAILABLE_REPLY,
    ...(isSecurityRequest ? { computation: result.computation } : {}),
    provider: "Assistant local en lecture seule",
  });
}
