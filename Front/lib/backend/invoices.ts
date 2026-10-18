export interface BackendInvoice {
  id: string;
  reference: string;
  amountSat: number;
  status: string;
  description: string;
  paymentRequest?: string;
  expiresAt?: string;
  qrCodeUrl?: string;
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function normalizeInvoice(value: unknown): BackendInvoice {
  const outer = objectValue(value);
  const data = objectValue(outer.data);
  const invoice = objectValue(data.invoice ?? outer.invoice ?? outer.data ?? value);
  return {
    id: String(invoice.id ?? ""),
    reference: String(invoice.reference ?? invoice.id ?? ""),
    amountSat: Number(invoice.amount_sat ?? invoice.amount ?? 0),
    status: String(invoice.status ?? "pending"),
    description: String(invoice.description ?? ""),
    paymentRequest:
      typeof invoice.request === "string" ? invoice.request : undefined,
    expiresAt:
      typeof invoice.expires_at === "string" ? invoice.expires_at : undefined,
    qrCodeUrl:
      typeof invoice.qr_png_data_uri === "string"
        ? invoice.qr_png_data_uri
        : typeof invoice.qr_svg_data_uri === "string"
          ? invoice.qr_svg_data_uri
          : undefined,
  };
}

export function normalizeInvoiceList(value: unknown): BackendInvoice[] {
  const outer = objectValue(value);
  const data = outer.data;
  const items = Array.isArray(data)
    ? data
    : Array.isArray(objectValue(data).invoices)
      ? (objectValue(data).invoices as unknown[])
      : Array.isArray(outer.invoices)
        ? (outer.invoices as unknown[])
        : [];
  return items.map(normalizeInvoice);
}
