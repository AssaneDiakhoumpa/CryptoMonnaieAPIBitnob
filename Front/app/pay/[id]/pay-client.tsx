"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { InvoiceQRCode } from "@/components/invoices/InvoiceQRCode";
import {
  Copy,
  Check,
  ShieldCheck,
  Clock,
  ArrowLeft,
  CheckCircle2,
} from "lucide-react";
import { useToast } from "@/components/ui/Toast";

interface Invoice {
  id: string;
  reference: string;
  amountSat: number;
  status: string;
  description: string;
  paymentRequest?: string;
}

interface PayClientProps {
  id: string;
}

export function PayClient({ id }: PayClientProps) {
  const { success, error } = useToast();
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [isDemo, setIsDemo] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [isPaying, setIsPaying] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let active = true;
    const loadInvoice = async () => {
      try {
        const response = await fetch(`/api/invoices/${encodeURIComponent(id)}`);
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Facture introuvable.");
        if (active) {
          setInvoice(data as Invoice);
          setLoadError("");
        }
      } catch (loadFailure) {
        if (active) {
          setLoadError(
            loadFailure instanceof Error ? loadFailure.message : "Erreur de chargement."
          );
        }
      }
    };
    const loadHealth = async () => {
      try {
        const response = await fetch("/api/health");
        const data = await response.json();
        if (active && response.ok) setIsDemo(data.demo === true);
      } catch {
        if (active) setIsDemo(false);
      }
    };

    void loadInvoice();
    void loadHealth();
    const interval = window.setInterval(() => void loadInvoice(), 5000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [id]);

  const handleCopyRequest = async () => {
    if (!invoice?.paymentRequest) return;
    await navigator.clipboard.writeText(invoice.paymentRequest);
    setCopied(true);
    success("Facture copiée", "Collez la facture Lightning dans votre portefeuille.");
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDemoPayment = async () => {
    setIsPaying(true);
    try {
      const response = await fetch(`/api/invoices/${encodeURIComponent(id)}/demo-pay`, {
        method: "POST",
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Paiement simulé refusé.");
      setInvoice(data as Invoice);
    } catch (paymentError) {
      error(
        "Simulation impossible",
        paymentError instanceof Error ? paymentError.message : "Erreur inconnue."
      );
    } finally {
      setIsPaying(false);
    }
  };

  const isPaid = invoice?.status === "paid";

  return (
    <div className="min-h-screen bg-[#F8F9FB] flex flex-col items-center justify-center p-4 sm:p-6">
      <div className="max-w-md w-full bg-white rounded-3xl border border-[#EAECEF] shadow-xl overflow-hidden">
        {/* Brand Top Banner */}
        <div className="bg-[#0f172a] p-6 text-white text-center relative">
          <Link
            href="/"
            className="absolute left-5 top-5 p-1.5 rounded-lg bg-white/10 text-gray-300 hover:text-white"
            title="Retour à l'application"
          >
            <ArrowLeft className="w-4 h-4" />
          </Link>

          <div className="inline-flex items-center gap-2 mb-2">
            <div className="w-8 h-8 rounded-xl bg-[#F5C200] flex items-center justify-center text-[#0f172a] font-black text-sm">
              S
            </div>
            <span className="font-extrabold text-lg tracking-tight">
              Sunu<span className="text-[#F5C200]">Pay</span> Checkout
            </span>
          </div>

          <p className="text-xs text-gray-400">
            Passerelle de règlement sécurisée pour freelances et entreprises
          </p>
        </div>

        {/* Invoice Summary */}
        <div className="p-6 border-b border-gray-100 bg-gray-50/50">
          <div className="flex items-center justify-between text-xs text-gray-500 mb-1">
            <span>Facture #{id}</span>
            <span className="flex items-center gap-1 text-emerald-600 font-semibold">
              <Clock className="w-3.5 h-3.5" /> {invoice?.status ?? "Chargement"}
            </span>
          </div>

          <div className="flex items-center justify-between">
            <h2 className="text-base font-bold text-gray-900">{invoice?.description ?? "Facture"}</h2>
            <div className="text-right">
              <span className="text-2xl font-black text-gray-900">
                {invoice ? invoice.amountSat.toLocaleString("fr-FR") : "—"}
              </span>
              <span className="text-xs text-gray-400 block">satoshis (Lightning)</span>
            </div>
          </div>
        </div>

        {loadError ? (
          <div role="alert" className="p-8 text-center text-sm text-rose-700">{loadError}</div>
        ) : isPaid ? (
          /* Payment Confirmed State */
          <div className="p-8 text-center space-y-4">
            <div className="w-16 h-16 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center mx-auto">
              <CheckCircle2 className="w-10 h-10" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-gray-900">
                Paiement reçu avec succès !
              </h3>
              <p className="text-xs text-gray-500 mt-1">
                Le backend confirme que cette facture Lightning est réglée.
              </p>
            </div>
            <div className="p-4 bg-gray-50 rounded-xl text-xs font-mono text-gray-600 text-left space-y-1">
              <div>Réf : {invoice?.reference}</div>
              <div>Montant : {invoice?.amountSat.toLocaleString("fr-FR")} satoshis</div>
            </div>
            <Link
              href="/"
              className="inline-block w-full py-3 rounded-xl bg-[#F5C200] text-[#0f172a] font-bold text-sm shadow-md"
            >
              Retourner au Dashboard
            </Link>
          </div>
        ) : (
          /* Payment Form & QR code */
          <div className="p-6 space-y-6">
            <div>
              <p className="text-xs font-semibold text-gray-600 text-center">
                Paiement Bitcoin via Lightning
              </p>
            </div>

            {/* QR Code and Exact Amount */}
            <div className="flex flex-col items-center">
              <div className="text-sm font-extrabold text-gray-900 mb-2">
                Envoyez exactement :{" "}
                <span className="text-[#D4A300]">
                  {invoice?.amountSat.toLocaleString("fr-FR")} satoshis
                </span>
              </div>
              {invoice?.paymentRequest && <InvoiceQRCode value={invoice.paymentRequest} size={180} />}
              <span className="text-[11px] text-gray-400 mt-2">Réseau Bitcoin Lightning</span>
            </div>

            {/* Address Input + Copy */}
            <div>
              <label className="block text-[11px] font-semibold text-gray-500 mb-1">
                Facture Lightning BOLT11
              </label>
              <div className="flex items-center bg-[#F5F6F9] border border-gray-200 rounded-xl p-1.5 focus-within:border-[#F5C200]">
                <input
                  type="text"
                  readOnly
                  value={invoice?.paymentRequest ?? ""}
                  className="bg-transparent text-xs text-gray-700 px-2 font-mono flex-1 outline-none select-all truncate"
                />
                <button
                  onClick={handleCopyRequest}
                  className="p-2 rounded-lg bg-white hover:bg-gray-100 text-gray-700 shadow-sm border border-gray-200 shrink-0"
                >
                  {copied ? (
                    <Check className="w-4 h-4 text-emerald-600" />
                  ) : (
                    <Copy className="w-4 h-4" />
                  )}
                </button>
              </div>
            </div>

            {isDemo && (
            <div className="pt-2">
              <button
                type="button"
                disabled={isPaying}
                onClick={handleDemoPayment}
                className="w-full py-3 rounded-xl bg-gray-900 hover:bg-black text-white text-xs font-bold transition-colors flex items-center justify-center gap-2"
              >
                <ShieldCheck className="w-4 h-4 text-[#F5C200]" />
                <span>{isPaying ? "Simulation..." : "Simuler le paiement (Démo)"}</span>
              </button>
            </div>
            )}
          </div>
        )}
      </div>

      <div className="mt-6 text-center text-xs text-gray-400 flex items-center gap-1.5">
        <ShieldCheck className="w-4 h-4 text-emerald-500" />
        <span>Paiement crypté et protégé par SunuPay Gateway</span>
      </div>
    </div>
  );
}
