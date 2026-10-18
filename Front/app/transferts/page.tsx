"use client";

import React, { useEffect, useState } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { ToastProvider, useToast } from "@/components/ui/Toast";
import { CryptoAsset, Transfer, TransferMethod } from "@/types";
import {
  ArrowRight,
  Smartphone,
  Building2,
  Banknote,
  Send,
  CheckCircle2,
  MoreVertical,
  History,
} from "lucide-react";
import { cn } from "@/lib/utils";

function TransfertsContent() {
  const { success, error } = useToast();

  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [selectedCountryCode, setSelectedCountryCode] = useState("SN");
  const [amountSent, setAmountSent] = useState<number>(100);
  const [currencySent, setCurrencySent] = useState<CryptoAsset>("USDT");
  const [currencyReceived, setCurrencyReceived] = useState("");
  const [method, setMethod] = useState<TransferMethod>("mobile_money");
  const [bankCode, setBankCode] = useState("");
  const [payoutCountries, setPayoutCountries] = useState<unknown>(null);
  const [payoutBanks, setPayoutBanks] = useState<unknown>(null);
  const [phoneNumber, setPhoneNumber] = useState("");
  const [recipientName, setRecipientName] = useState("");
  const [notes, setNotes] = useState("");

  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isQuoting, setIsQuoting] = useState(false);
  const [quote, setQuote] = useState<Record<string, unknown> | null>(null);

  useEffect(() => {
    let active = true;
    fetch("/api/transfers?resource=countries")
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Référentiel Bitnob indisponible.");
        if (active) setPayoutCountries(data);
      })
      .catch((referenceError: Error) => error("Pays Bitnob indisponibles", referenceError.message));
    return () => {
      active = false;
    };
  }, [error]);

  useEffect(() => {
    let active = true;
    fetch(`/api/transfers?resource=banks&country=${encodeURIComponent(selectedCountryCode)}`)
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Référentiel Bitnob indisponible.");
        if (active) setPayoutBanks(data);
      })
      .catch((referenceError: Error) => error("Banques Bitnob indisponibles", referenceError.message));
    return () => {
      active = false;
    };
  }, [error, selectedCountryCode]);

  const handleCountryChange = (code: string) => {
    setSelectedCountryCode(code.toUpperCase());
    setCurrencyReceived("");
    setBankCode("");
    setPayoutBanks(null);
  };

  const handleInitiateTransfer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (amountSent <= 0) {
      error("Montant invalide", "Veuillez saisir un montant supérieur à 0.");
      return;
    }
    if (!bankCode.trim()) {
      error("Code Bitnob requis", "Saisissez le bank_code exact retourné par le référentiel Bitnob.");
      return;
    }
    if (!/^[A-Z]{2}$/.test(selectedCountryCode) || !/^[A-Z]{3}$/.test(currencyReceived.trim().toUpperCase())) {
      error("Référentiel incomplet", "Saisissez le pays et la devise tels qu’ils figurent dans les réponses Bitnob affichées.");
      return;
    }
    if (method === "mobile_money" && !phoneNumber.trim()) {
      error("Numéro requis", "Veuillez renseigner le numéro de mobile du bénéficiaire.");
      return;
    }
    if (method === "cash_pickup") {
      error("Méthode indisponible", "Bitnob ne propose pas le retrait Cash pickup sur cette API.");
      return;
    }

    setIsQuoting(true);
    try {
      const response = await fetch("/api/transfers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "quote",
          amountSent,
          currencySent,
          country: selectedCountryCode,
          currencyReceived: currencyReceived.trim().toUpperCase(),
          recipientName: recipientName.trim(),
          accountNumber:
            phoneNumber.trim(),
          bankCode: bankCode.trim(),
          method,
          paymentReason: "vendor_payment",
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Bitnob n’a pas retourné de devis.");
      setQuote(data as Record<string, unknown>);
      setIsConfirmOpen(true);
    } catch (quoteError) {
      error(
        "Devis indisponible",
        quoteError instanceof Error ? quoteError.message : "Erreur inconnue."
      );
    } finally {
      setIsQuoting(false);
    }
  };

  const handleConfirmTransfer = async () => {
    setIsProcessing(true);
    try {
      const response = await fetch("/api/transfers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "send",
          amountSent,
          currencySent,
          country: selectedCountryCode,
          currencyReceived: currencyReceived.trim().toUpperCase(),
          recipientName: recipientName.trim(),
          accountNumber:
            phoneNumber.trim(),
          bankCode: bankCode.trim(),
          method,
          paymentReason: "vendor_payment",
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Bitnob n’a pas confirmé le payout.");
      setQuote(data as Record<string, unknown>);
      const newTransfer: Transfer = {
        id: String(
          (data.initialized as Record<string, unknown>)?.id ??
          (data.finalized as Record<string, unknown>)?.id ??
          "—"
        ),
        recipientName: recipientName.trim(),
        recipientCountry: selectedCountryCode,
        countryCode: selectedCountryCode,
        method,
        operator: bankCode.trim(),
        phoneNumber: phoneNumber.trim(),
        amountSent,
        currencySent,
        amountReceived: null,
        currencyReceived: currencyReceived.trim().toUpperCase(),
        fee: null,
        exchangeRate: null,
        status: "processing",
        date: "—",
        estimatedDelivery: "Statut fourni par Bitnob",
        notes: notes || undefined,
      };

      setTransfers((current) => [newTransfer, ...current]);
      setIsConfirmOpen(false);
      success(
        "Transfert initié !",
        `${amountSent} ${currencySent} transmis à Bitnob pour ${selectedCountryCode}.`
      );
    } catch (payoutError) {
      error(
        "Transfert refusé",
        payoutError instanceof Error ? payoutError.message : "Erreur inconnue."
      );
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Title */}
      <div>
        <h1 className="text-2xl sm:text-3xl font-extrabold text-gray-900 tracking-tight">
          Transférer de l&apos;argent
        </h1>
        <p className="text-sm text-gray-500 mt-1">
          Envoyez de l&apos;argent à vos partenaires, proches ou bénéficiaires en Afrique et dans le monde.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* Left Form: Détails du transfert */}
        <div className="lg:col-span-7 bg-white p-6 sm:p-8 rounded-2xl border border-[#EAECEF] shadow-sm">
          <h2 className="text-base font-bold text-gray-900 mb-6">
            Détails du transfert
          </h2>

          <form onSubmit={handleInitiateTransfer} className="space-y-5">
            {/* Montant à envoyer */}
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1.5">
                Montant à envoyer
              </label>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <input
                    type="number"
                    min="1"
                    step="any"
                    value={amountSent || ""}
                    onChange={(e) => setAmountSent(parseFloat(e.target.value) || 0)}
                    className="w-full px-4 py-2.5 text-sm bg-white border border-gray-200 focus:border-[#F5C200] focus:ring-2 focus:ring-[#F5C200]/20 rounded-xl text-gray-900 font-bold outline-none"
                    placeholder="100"
                  />
                </div>
                <div className="w-32 shrink-0">
                  <select
                    value={currencySent}
                    onChange={(e) => {
                      if (e.target.value === "BTC" || e.target.value === "USDT" || e.target.value === "USDC") {
                        setCurrencySent(e.target.value);
                      }
                    }}
                    className="w-full px-3 py-2.5 text-sm bg-[#F5F6F9] border border-gray-200 rounded-xl font-bold text-gray-900 outline-none cursor-pointer focus:border-[#F5C200]"
                  >
                    <option value="USDT">USDT</option>
                    <option value="USDC">USDC</option>
                    <option value="BTC">BTC</option>
                  </select>
                </div>
              </div>
            </div>

            {/* Pays de destination */}
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1.5">
                Pays de destination
              </label>
              <input
                required
                maxLength={2}
                value={selectedCountryCode}
                onChange={(e) => handleCountryChange(e.target.value)}
                placeholder="Code ISO-2 retourné par Bitnob"
                className="w-full px-4 py-2.5 text-sm uppercase bg-white border border-gray-200 rounded-xl text-gray-900 font-medium outline-none focus:border-[#F5C200]"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1.5">
                Devise de destination (`to_currency`)
              </label>
              <input
                required
                maxLength={3}
                value={currencyReceived}
                onChange={(e) => setCurrencyReceived(e.target.value.toUpperCase())}
                placeholder="Code exact du référentiel Bitnob"
                className="w-full px-4 py-2.5 text-sm uppercase bg-white border border-gray-200 rounded-xl outline-none focus:border-[#F5C200]"
              />
            </div>

            {/* Méthode de réception */}
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-2">
                Méthode de réception
              </label>
              <div className="grid grid-cols-2 gap-2.5">
                <button
                  type="button"
                  onClick={() => setMethod("mobile_money")}
                  className={cn(
                    "flex flex-col sm:flex-row items-center justify-center gap-2 p-3 rounded-xl border text-xs font-bold transition-all text-center",
                    method === "mobile_money"
                      ? "bg-[#FFFBEB] border-[#F5C200] text-gray-900 shadow-sm"
                      : "border-gray-200 text-gray-500 hover:border-gray-300"
                  )}
                >
                  <Smartphone className="w-4 h-4 text-[#F5C200] shrink-0" />
                  <span>Mobile Money</span>
                </button>

                <button
                  type="button"
                  onClick={() => setMethod("bank_account")}
                  className={cn(
                    "flex flex-col sm:flex-row items-center justify-center gap-2 p-3 rounded-xl border text-xs font-bold transition-all text-center",
                    method === "bank_account"
                      ? "bg-[#FFFBEB] border-[#F5C200] text-gray-900 shadow-sm"
                      : "border-gray-200 text-gray-500 hover:border-gray-300"
                  )}
                >
                  <Building2 className="w-4 h-4 text-[#F5C200] shrink-0" />
                  <span>Compte bancaire</span>
                </button>

                <button
                  type="button"
                  disabled
                  className={cn(
                    "hidden flex-col sm:flex-row items-center justify-center gap-2 p-3 rounded-xl border text-xs font-bold text-center",
                    "border-gray-200 text-gray-400"
                  )}
                >
                  <Banknote className="w-4 h-4 text-[#F5C200] shrink-0" />
                  <span>Cash pickup</span>
                </button>
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1.5">
                Code banque/opérateur Bitnob (`bank_code`)
              </label>
              <input
                type="text"
                required
                value={bankCode}
                onChange={(e) => setBankCode(e.target.value)}
                placeholder="Saisir le code exact du référentiel Bitnob"
                className="w-full px-4 py-2.5 text-sm bg-white border border-gray-200 rounded-xl outline-none focus:border-[#F5C200]"
              />
            </div>

            <details className="rounded-xl border border-gray-200 p-3 text-xs">
              <summary className="cursor-pointer font-semibold text-gray-700">
                Référentiels Bitnob bruts (à vérifier)
              </summary>
              <p className="mt-3 font-semibold">Pays disponibles</p>
              <pre className="mt-1 max-h-40 overflow-auto rounded-lg bg-slate-950 p-2 text-[10px] text-slate-100">
                {JSON.stringify(payoutCountries, null, 2)}
              </pre>
              <p className="mt-3 font-semibold">Banques / opérateurs pour {selectedCountryCode}</p>
              <pre className="mt-1 max-h-40 overflow-auto rounded-lg bg-slate-950 p-2 text-[10px] text-slate-100">
                {JSON.stringify(payoutBanks, null, 2)}
              </pre>
            </details>

            {/* Numéro de téléphone or Account */}
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1.5">
                {method === "mobile_money"
                  ? "Numéro de téléphone"
                  : method === "bank_account"
                  ? "IBAN / Numéro de compte bancaire"
                  : "Numéro de pièce d'identité (CNI/Passeport)"}
              </label>
              <div className="flex gap-2">
                <input
                  required
                  type="text"
                  value={phoneNumber}
                  onChange={(e) => setPhoneNumber(e.target.value)}
                  placeholder={
                    method === "mobile_money"
                      ? "+221771234567"
                      : "IBAN / numéro de compte"
                  }
                  className="flex-1 px-4 py-2.5 text-sm bg-white border border-gray-200 focus:border-[#F5C200] focus:ring-2 focus:ring-[#F5C200]/20 rounded-xl text-gray-900 outline-none"
                />
              </div>
            </div>

            {/* Bénéficiaire */}
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1.5">
                Nom complet du bénéficiaire
              </label>
              <input
                type="text"
                value={recipientName}
                onChange={(e) => setRecipientName(e.target.value)}
                placeholder="Ex: Sadio Diallo"
                className="w-full px-4 py-2.5 text-sm bg-white border border-gray-200 focus:border-[#F5C200] focus:ring-2 focus:ring-[#F5C200]/20 rounded-xl text-gray-900 outline-none"
              />
            </div>

            {/* Notes (optionnel) */}
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1.5">
                Notes (optionnel)
              </label>
              <input
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Ex: Paiement fournisseur"
                className="w-full px-4 py-2.5 text-sm bg-white border border-gray-200 focus:border-[#F5C200] rounded-xl text-gray-900 outline-none"
              />
            </div>

            {/* Submit Button */}
            <div className="pt-2">
              <button
                type="submit"
                disabled={isQuoting}
                className="w-full py-3.5 px-6 rounded-xl bg-[#F5C200] hover:bg-[#E5B500] text-[#0f172a] font-extrabold text-sm shadow-md shadow-[#F5C200]/25 transition-all duration-150 transform active:scale-[0.99] flex items-center justify-center gap-2 disabled:opacity-60"
              >
              <span>{isQuoting ? "Demande du devis..." : "Obtenir un devis Bitnob"}</span>
                <ArrowRight className="w-4 h-4 stroke-[3]" />
              </button>
            </div>
          </form>
        </div>

        {/* Right side: Résumé du transfert + Transferts récents */}
        <div className="lg:col-span-5 space-y-6">
          {/* Résumé du transfert (Mockup Screen 3 Top Right) */}
          <div className="bg-white p-6 rounded-2xl border border-[#EAECEF] shadow-sm">
            <h3 className="text-base font-bold text-gray-900">Réponse Bitnob</h3>
            <p className="text-xs text-gray-500 mt-1">
              Le JSON brut reçu du devis ou du dernier payout est affiché ci-dessous.
            </p>
            {quote ? (
              <pre className="mt-3 max-h-64 overflow-auto rounded-xl bg-slate-950 p-3 text-[11px] text-slate-100">
                {JSON.stringify(quote, null, 2)}
              </pre>
            ) : (
              <p className="mt-4 text-sm text-gray-500">Demandez un devis pour afficher les conditions.</p>
            )}
          </div>

          {/* Transferts récents */}
          <div className="bg-white p-6 rounded-2xl border border-[#EAECEF] shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-bold text-gray-900">
                Transferts récents
              </h3>
            </div>

            <div className="divide-y divide-gray-100">
              {transfers.slice(0, 3).map((tr) => (
                <div
                  key={tr.id}
                  className="py-3.5 flex items-center justify-between gap-3 text-xs"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-emerald-50 text-emerald-600 font-bold flex items-center justify-center shrink-0">
                      <span className="text-[9px]">{tr.countryCode}</span>
                    </div>
                    <div>
                      <div className="font-bold text-gray-900">
                        {tr.recipientName}
                      </div>
                      <div className="text-[11px] text-gray-500">
                        {tr.recipientCountry} • {tr.operator}
                      </div>
                    </div>
                  </div>

                  <div className="text-right flex items-center gap-3">
                    <div>
                      <div className="font-bold text-gray-900">
                        {tr.amountSent} {tr.currencySent}
                      </div>
                      <div className="text-[11px] text-gray-400">
                        {tr.amountReceived === null
                          ? "Montant à confirmer"
                          : `${tr.amountReceived.toLocaleString("fr-FR")} ${tr.currencyReceived}`}
                      </div>
                    </div>
                    <StatusBadge status={tr.status} size="sm" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Confirmation Dialog */}
      <ConfirmDialog
        isOpen={isConfirmOpen}
        onClose={() => setIsConfirmOpen(false)}
        onConfirm={handleConfirmTransfer}
        isLoading={isProcessing}
        title="Confirmer l'envoi du transfert"
        description={`Le payout est irréversible. La route d’exécution demande un nouveau devis Bitnob : relisez la réponse affichée et confirmez uniquement si les conditions sont acceptables.`}
        confirmLabel="Confirmer le transfert"
        cancelLabel="Vérifier les détails"
        variant="primary"
      />
    </div>
  );
}

export default function TransfertsPage() {
  return (
    <ToastProvider>
      <AppLayout>
        <TransfertsContent />
      </AppLayout>
    </ToastProvider>
  );
}
