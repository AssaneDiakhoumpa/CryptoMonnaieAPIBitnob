import { NextRequest, NextResponse } from "next/server";
import {
  backendErrorResponse,
  backendJsonResponse,
  jsonBody,
  requestBackendJson,
} from "@/lib/backend/client";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      firstName,
      lastName,
      email,
      phoneNumber,
      idType,
      idNumber,
      dateOfBirth,
      line1,
      city,
      state,
      postalCode,
      country,
    } = body;
    if (
      !firstName?.trim() ||
      !lastName?.trim() ||
      !email?.trim() ||
      !phoneNumber?.trim() ||
      !idNumber?.trim() ||
      !dateOfBirth ||
      !line1?.trim() ||
      !city?.trim() ||
      !state?.trim() ||
      !postalCode?.trim() ||
      !country
    ) {
      return NextResponse.json(
        { error: "Tous les champs d’identité, de contact et d’adresse sont requis." },
        { status: 400 }
      );
    }

    const result = await requestBackendJson("/cards/kyc", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: jsonBody({
        customer: {
          first_name: firstName.trim(),
          last_name: lastName.trim(),
          email: email.trim(),
          phone_number: phoneNumber.trim(),
          date_of_birth: dateOfBirth,
          line1: line1.trim(),
          city: city.trim(),
          state: state.trim(),
          postal_code: postalCode.trim(),
          country,
        },
        id_type: idType,
        id_number: idNumber.trim(),
        id_front_image: body.idFrontImage,
      }),
    });
    if (!result.ok) return backendJsonResponse(result);

    const data =
      result.data && typeof result.data === "object"
        ? (result.data as Record<string, unknown>)
        : {};
    const bitnobData =
      data.data && typeof data.data === "object"
        ? (data.data as Record<string, unknown>)
        : {};
    const customerId = bitnobData.customer_id;
    if (typeof customerId !== "string" || !customerId) {
      return NextResponse.json(
        { error: "Bitnob n’a pas retourné le customer_id requis pour créer une carte." },
        { status: 502 }
      );
    }
    return NextResponse.json({
      success: true,
      customerId,
      status: bitnobData.status,
    });
  } catch (error) {
    return backendErrorResponse(error);
  }
}

export async function GET() {
  try {
    return backendJsonResponse(await requestBackendJson("/cards/kyc/customers"));
  } catch (error) {
    return backendErrorResponse(error);
  }
}
