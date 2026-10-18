"use client";

import React, { useCallback, useEffect, useState } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { ToastProvider, useToast } from "@/components/ui/Toast";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { BulkRecipientItem } from "@/types";
import {
  UploadCloud,
  CheckCircle2,
  AlertTriangle,
  Play,
  RotateCw,
  RefreshCw,
  Download,
  Layers,
} from "lucide-react";
import { cn } from "@/lib/utils";

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function mapPayout(value: unknown, index: number): BulkRecipientItem {
  const payout = object(value);
  const rawStatus = String(payout.status ?? "PENDING");
  const status: BulkRecipientItem["status"] =
    rawStatus === "SUCCESS" ? "completed"
      : rawStatus === "FAILED" || rawStatus === "EXPIRED" ? "failed"
        : rawStatus === "UNCERTAIN" ? "uncertain"
          : rawStatus === "PENDING" ? "pending" : "processing";
  return {
    id: String(payout.id ?? index),
    rowIndex: Number(payout.line) || index + 1,
    name: String(payout.name ?? ""),
    phoneOrAccount: String(payout.account_number ?? ""),
    country: String(payout.country ?? ""),
    currency: String(payout.currency ?? ""),
    amount: Number(payout.amount) || 0,
    operator: String(payout.bank_code ?? ""),
    status,
    errorMessage: typeof payout.error === "string" ? payout.error : undefined,
  };
}

function MasseContent() {
  const { success, error } = useToast();

  const [csvText, setCsvText] = useState("");
  const [items, setItems] = useState<BulkRecipientItem[]>([]);
  const [batches, setBatches] = useState<Record<string, unknown>[]>([]);
  const [batchId, setBatchId] = useState("");
  const [activeStep, setActiveStep] = useState<"upload" | "review" | "executing" | "history">("upload");

  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  const [isExecuting, setIsExecuting] = useState(false);

  const parseAndValidateCSV = async (text: string) => {
    if (!text.trim()) {
      error("Fichier vide", "Veuillez fournir un CSV avec au moins une ligne de données.");
      return;
    }
    try {
      const form = new FormData();
      form.set("file", new File([text], "beneficiaries.csv", { type: "text/csv" }));
      form.set("from_asset", "USDT");
      form.set("default_destination_type", "mobile_money");
      form.set("strict", "false");
      const response = await fetch("/api/bulk-payout", {
        method: "POST",
        body: form,
      });
      const prepared = await response.json();
      if (!response.ok) throw new Error(prepared.error || "Le backend a refusé le lot.");
      const preparedBatch = object(prepared.batch);
      const id = typeof preparedBatch.id === "string" ? preparedBatch.id : "";
      if (!id) throw new Error("Le backend n’a pas retourné d’identifiant de lot.");
      setBatchId(id);
      setBatches((current) => [preparedBatch, ...current]);
      const detailResponse = await fetch(`/api/bulk-payout?batchId=${encodeURIComponent(id)}`);
      const detail = await detailResponse.json();
      if (!detailResponse.ok) throw new Error(detail.error || "Impossible de charger le détail du lot.");
      const payouts = Array.isArray(detail.payouts) ? detail.payouts : [];
      const rejected = Array.isArray(prepared.rejected_rows) ? prepared.rejected_rows : [];
      const rejectedItems = rejected.map((entry: unknown, index: number) => {
        const item = object(entry);
        const raw = object(item.data);
        return {
          id: `rejected-${String(item.line ?? index)}`,
          rowIndex: Number(item.line) || index + 1,
          name: String(raw.name ?? ""),
          phoneOrAccount: String(raw.account_number ?? ""),
          country: String(raw.country ?? ""),
          currency: String(raw.currency ?? ""),
          amount: Number(raw.amount) || 0,
          operator: String(raw.bank_code ?? ""),
          status: "invalid" as const,
          errorMessage: Array.isArray(item.errors) ? item.errors.join(" • ") : "Ligne rejetée par le backend.",
        };
      });
      setItems([...payouts.map(mapPayout), ...rejectedItems]);
      setActiveStep("review");
      success("Lot préparé", `${payouts.length} paiement(s) validé(s), ${rejectedItems.length} ligne(s) rejetée(s).`);
    } catch (prepareError) {
      error(
        "Préparation impossible",
        prepareError instanceof Error ? prepareError.message : "Erreur inconnue."
      );
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
      const content = evt.target?.result as string;
      if (content) {
        setCsvText(content);
        parseAndValidateCSV(content);
      }
    };
    reader.readAsText(file);
  };

  const validItems = items.filter((i) => ["valid", "pending", "processing", "completed"].includes(i.status));
  const invalidItems = items.filter((i) => i.status === "invalid");
  const totalsByCurrency = validItems.reduce<Record<string, number>>((totals, item) => {
    totals[item.currency] = (totals[item.currency] || 0) + item.amount;
    return totals;
  }, {});
  const tabs: { id: "upload" | "review" | "history"; label: string }[] = [
    { id: "upload", label: "1. Importer un fichier CSV" },
    { id: "review", label: `2. Vérification & Totaux (${items.length})` },
    { id: "history", label: "Historique des lots" },
  ];

  const refreshBatch = useCallback(async () => {
    if (!batchId) return "";
    const response = await fetch(`/api/bulk-payout?batchId=${encodeURIComponent(batchId)}`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Impossible d’actualiser le lot.");
    setItems([
      ...(Array.isArray(data.payouts) ? data.payouts.map(mapPayout) : []),
      ...items.filter((item) => item.status === "invalid"),
    ]);
    const status = String(object(data.batch).status ?? "");
    return status;
  }, [batchId, items]);

  useEffect(() => {
    fetch("/api/bulk-payout")
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Impossible de charger l’historique.");
        if (Array.isArray(data)) setBatches(data.map(object));
      })
      .catch((loadError: Error) => error("Historique indisponible", loadError.message));
  }, [error]);

  useEffect(() => {
    if (activeStep !== "executing" || !batchId) return;
    let active = true;
    let timer: number;
    const poll = async () => {
      try {
        const status = await refreshBatch();
        if (!active) return;
        if (["COMPLETED", "PARTIAL", "FAILED", "CANCELLED"].includes(status)) {
          setIsExecuting(false);
          setActiveStep("review");
          success("Lot actualisé", `Statut backend : ${status}.`);
          return;
        }
        timer = window.setTimeout(poll, 2500);
      } catch (pollError) {
        if (active) error("Suivi indisponible", pollError instanceof Error ? pollError.message : "Erreur inconnue.");
      }
    };
    timer = window.setTimeout(poll, 2000);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [activeStep, batchId, error, refreshBatch, success]);

  const handleStartBatchExecution = async () => {
    if (!batchId) {
      error("Lot introuvable", "Préparez le lot avant son exécution.");
      return;
    }
    setIsConfirmOpen(false);
    setIsExecuting(true);
    setActiveStep("executing");
    try {
      const response = await fetch("/api/bulk-payout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "confirm", batchId }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Le backend a refusé l’exécution.");
      success("Exécution transmise", `Statut backend : ${String(data.status ?? "—")}.`);
    } catch (executionError) {
      setIsExecuting(false);
      setActiveStep("review");
      error(
        "Exécution impossible",
        executionError instanceof Error ? executionError.message : "Erreur inconnue."
      );
    }
  };

  const handleRetryFailedItem = async () => {
    if (!batchId) return;
    try {
      const response = await fetch("/api/bulk-payout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "retry", batchId }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Le backend a refusé la relance.");
      success("Relance transmise", `${String(data.retried ?? 0)} paiement(s) relancé(s).`);
      await refreshBatch();
    } catch (retryError) {
      error("Relance impossible", retryError instanceof Error ? retryError.message : "Erreur inconnue.");
    }
  };

  const handleRefreshFromBitnob = async () => {
    if (!batchId) return;
    try {
      const response = await fetch("/api/bulk-payout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "refresh", batchId }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Impossible d’actualiser les statuts Bitnob.");
      await refreshBatch();
      if (Array.isArray(data.errors) && data.errors.length > 0) {
        error("Actualisation partielle", `${data.errors.length} statut(s) n’ont pas pu être actualisés.`);
      } else {
        success("Statuts actualisés", `${Number(data.updated) || 0} paiement(s) mis à jour depuis Bitnob.`);
      }
    } catch (refreshError) {
      error(
        "Actualisation impossible",
        refreshError instanceof Error ? refreshError.message : "Erreur inconnue."
      );
    }
  };

  const handleDownloadReport = async () => {
    if (!batchId) return;
    try {
      const response = await fetch(`/api/bulk-payout?action=report&batchId=${encodeURIComponent(batchId)}`);
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Impossible de télécharger le rapport.");
      }
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = `rapport-paiements-${batchId}.csv`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (reportError) {
      error("Rapport indisponible", reportError instanceof Error ? reportError.message : "Erreur inconnue.");
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl sm:text-3xl font-extrabold text-gray-900 tracking-tight">
              Paiements de masse
            </h1>
            <span className="text-xs bg-[#FFF9E6] text-amber-800 font-bold px-2.5 py-1 rounded-full border border-[#F5C200]/40 flex items-center gap-1">
              <Layers className="w-3.5 h-3.5 text-[#F5C200]" />
              Multi-Pays Bitnob
            </span>
          </div>
          <p className="text-sm text-gray-500 mt-1">
            Payez des dizaines de livreurs, prestataires et salariés en Afrique (Sénégal, Nigéria, Ghana) en un seul clic.
          </p>
        </div>

        <button
          onClick={() => setActiveStep("history")}
          className="px-4 py-2.5 rounded-xl bg-[#0f172a] text-white text-xs font-bold"
        >
          Historique des lots
        </button>
      </div>

      {/* Step navigation tabs */}
      <div className="flex items-center gap-2 border-b border-gray-200">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveStep(tab.id)}
            className={cn(
              "py-3 px-4 text-xs font-bold border-b-2 transition-all",
              activeStep === tab.id || (activeStep === "executing" && tab.id === "review")
                ? "border-[#F5C200] text-gray-900"
                : "border-transparent text-gray-400 hover:text-gray-700"
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Step 1: Upload CSV Area */}
      {activeStep === "upload" && (
        <div className="space-y-6">
          <div className="bg-white p-8 rounded-2xl border-2 border-dashed border-gray-200 hover:border-[#F5C200] transition-colors text-center">
            <div className="w-16 h-16 rounded-2xl bg-[#FFF9E6] text-[#F5C200] flex items-center justify-center mx-auto mb-4 shadow-sm">
              <UploadCloud className="w-8 h-8" />
            </div>

            <h3 className="text-base font-bold text-gray-900">
              Déposez votre fichier CSV de bénéficiaires
            </h3>
            <p className="text-xs text-gray-500 mt-1 max-w-md mx-auto">
              Colonnes attendues : <code>name, account_number, bank_code, amount, currency, country</code>.
              bank_code doit être le code Bitnob vérifié, pas un nom d’opérateur supposé.
            </p>

            <div className="mt-5 flex items-center justify-center gap-3">
              <label className="cursor-pointer px-5 py-2.5 rounded-xl bg-[#F5C200] hover:bg-[#E5B500] text-[#0f172a] text-xs font-bold shadow-md shadow-[#F5C200]/25 transition-all">
                <span>Parcourir les fichiers</span>
                <input
                  type="file"
                  accept=".csv"
                  onChange={handleFileUpload}
                  className="hidden"
                />
              </label>

            </div>
          </div>

          {/* Quick manual paste area */}
          <div className="bg-white p-6 rounded-2xl border border-[#EAECEF] shadow-sm">
            <h4 className="text-xs font-bold text-gray-700 uppercase tracking-wider mb-2">
              Ou collez le contenu CSV brut directement :
            </h4>
            <textarea
              rows={5}
              value={csvText}
              onChange={(e) => setCsvText(e.target.value)}
              placeholder="name,account_number,bank_code,amount,currency,country&#10;Mamadou Diallo,+221774501234,CODE_BITNOB,25000,XOF,SN"
              className="w-full p-3 font-mono text-xs bg-gray-50 border border-gray-200 rounded-xl focus:border-[#F5C200] outline-none"
            />
            <div className="mt-3 flex justify-end">
              <button
                onClick={() => parseAndValidateCSV(csvText)}
                disabled={!csvText.trim()}
                className="px-5 py-2 rounded-xl bg-[#0f172a] text-white hover:bg-[#1e293b] text-xs font-bold disabled:opacity-50 transition-colors"
              >
                Analyser et Valider
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Step 2 & 3: Review & Execution Table */}
      {(activeStep === "review" || activeStep === "executing") && items.length > 0 && (
        <div className="space-y-6">
          {/* Executive Totals Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
            <div className="p-5 rounded-2xl bg-[#0f172a] text-white border border-[#1e293b] shadow-sm">
              <span className="text-[11px] font-medium uppercase tracking-wider text-gray-400">
                Total Débité (USDT)
              </span>
              <div className="text-2xl font-black mt-1 text-[#F5C200]">
                {Object.entries(totalsByCurrency).map(([currency, amount]) => `${amount.toLocaleString("fr-FR")} ${currency}`).join(" · ") || "—"}
              </div>
              <span className="text-xs text-gray-400 mt-0.5 block">
                Frais réels disponibles après devis/exécution Bitnob.
              </span>
            </div>

            <div className="p-5 rounded-2xl bg-white border border-[#EAECEF] shadow-sm">
              <span className="text-[11px] font-medium uppercase tracking-wider text-gray-500">
                Sénégal 🇸🇳
              </span>
              <div className="text-xl font-bold mt-1 text-gray-900">
                {items
                  .filter((i) => i.country === "SN" && i.status !== "invalid")
                  .reduce((acc, i) => acc + i.amount, 0)
                  .toLocaleString("fr-FR")}{" "}
                XOF
              </div>
              <span className="text-xs text-emerald-600 font-semibold">
                {items.filter((i) => i.country === "SN" && i.status !== "invalid").length} livreurs
              </span>
            </div>

            <div className="p-5 rounded-2xl bg-white border border-[#EAECEF] shadow-sm">
              <span className="text-[11px] font-medium uppercase tracking-wider text-gray-500">
                Nigéria 🇳🇬
              </span>
              <div className="text-xl font-bold mt-1 text-gray-900">
                {items
                  .filter((i) => i.country === "NG" && i.status !== "invalid")
                  .reduce((acc, i) => acc + i.amount, 0)
                  .toLocaleString("fr-FR")}{" "}
                NGN
              </div>
              <span className="text-xs text-emerald-600 font-semibold">
                {items.filter((i) => i.country === "NG" && i.status !== "invalid").length} livreurs
              </span>
            </div>

            <div className="p-5 rounded-2xl bg-white border border-[#EAECEF] shadow-sm">
              <span className="text-[11px] font-medium uppercase tracking-wider text-gray-500">
                Ghana 🇬🇭
              </span>
              <div className="text-xl font-bold mt-1 text-gray-900">
                {items
                  .filter((i) => i.country === "GH" && i.status !== "invalid")
                  .reduce((acc, i) => acc + i.amount, 0)
                  .toLocaleString("fr-FR")}{" "}
                GHS
              </div>
              <span className="text-xs text-emerald-600 font-semibold">
                {items.filter((i) => i.country === "GH" && i.status !== "invalid").length} livreurs
              </span>
            </div>
          </div>

          {/* Validation Notice Banner (Highlighting 2 detected errors as in hackathon rubric) */}
          {invalidItems.length > 0 && (
            <div className="p-4 rounded-2xl bg-rose-50 border border-rose-200 text-rose-900 text-xs flex items-start justify-between gap-4">
              <div className="flex items-start gap-2.5">
                <AlertTriangle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
                <div>
                  <span className="font-bold">
                    Contrôle de conformité : {invalidItems.length} erreurs détectées dans le fichier.
                  </span>
                  <p className="text-[11px] text-rose-700 mt-0.5">
                    Ces lignes seront automatiquement ignorées lors du lancement pour éviter tout rejet réseau. Vous pouvez les corriger ou continuer avec les {validItems.length} bénéficiaires valides.
                  </p>
                </div>
              </div>

              <span className="bg-rose-100 text-rose-800 px-2.5 py-1 rounded-full font-bold text-[11px] shrink-0">
                {validItems.length} prêts / {items.length} total
              </span>
            </div>
          )}

          {/* Execution Progress Bar (if executing) */}
          {activeStep === "executing" && (
            <div className="p-5 bg-[#0f172a] text-white rounded-2xl shadow-md space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="font-bold flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-[#F5C200] animate-ping" />
                  Traitement du lot en cours sur l&apos;API Bitnob...
                </span>
                <span className="font-mono text-[#F5C200] font-bold">Statut actualisé par le backend</span>
              </div>
              <div className="w-full bg-gray-800 rounded-full h-2.5 overflow-hidden">
                <div className="bg-[#F5C200] h-full w-1/2 animate-pulse rounded-full" />
              </div>
            </div>
          )}

          {/* Table of items */}
          <div className="bg-white rounded-2xl border border-[#EAECEF] p-6 shadow-sm space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h3 className="text-base font-bold text-gray-900">
                  Liste des bénéficiaires du lot
                </h3>
                <p className="text-xs text-gray-500">
                  Détail de chaque paiement avant décaissement groupé
                </p>
              </div>

              <div className="flex items-center gap-2">
                {activeStep === "executing" && !isExecuting && (
                  <button
                    onClick={handleDownloadReport}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-bold transition-colors"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Exporter le rapport</span>
                  </button>
                )}

                {activeStep === "review" && (
                  <>
                    {batchId && (
                      <button
                        onClick={handleRefreshFromBitnob}
                        className="inline-flex items-center gap-2 px-3 py-2.5 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold text-xs transition-all"
                      >
                        <RefreshCw className="w-4 h-4" />
                        <span>Actualiser depuis Bitnob</span>
                      </button>
                    )}
                    <button
                      onClick={() => setIsConfirmOpen(true)}
                      disabled={validItems.length === 0}
                      className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#F5C200] hover:bg-[#E5B500] text-[#0f172a] font-extrabold text-xs shadow-md shadow-[#F5C200]/25 transition-all"
                    >
                      <Play className="w-4 h-4 fill-current" />
                      <span>Lancer le lot ({validItems.length} paiements)</span>
                    </button>
                  </>
                )}
              </div>
            </div>

            <div className="overflow-x-auto max-h-[500px]">
              <table className="w-full text-left border-collapse text-xs">
                <thead className="sticky top-0 bg-white z-10">
                  <tr className="border-b border-gray-100 text-[11px] font-semibold text-gray-400 uppercase tracking-wider">
                    <th className="pb-3 px-3">#</th>
                    <th className="pb-3 px-3">Bénéficiaire</th>
                    <th className="pb-3 px-3">Pays & Opérateur</th>
                    <th className="pb-3 px-3">Numéro / Compte</th>
                    <th className="pb-3 px-3">Montant local</th>
                    <th className="pb-3 px-3">Équiv. USDT</th>
                    <th className="pb-3 px-3">Statut</th>
                    <th className="pb-3 px-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {items.map((it) => (
                    <tr
                      key={it.id}
                      className={cn(
                        "hover:bg-gray-50/80 transition-colors",
                        it.status === "invalid" && "bg-rose-50/30",
                        it.status === "failed" && "bg-amber-50/40"
                      )}
                    >
                      <td className="py-3 px-3 text-gray-400 font-mono">{it.rowIndex}</td>
                      <td className="py-3 px-3 font-semibold text-gray-900">{it.name}</td>
                      <td className="py-3 px-3">
                        <span className="font-medium text-gray-700">
                          {it.country === "SN"
                            ? "🇸🇳 Sénégal"
                            : it.country === "NG"
                            ? "🇳🇬 Nigéria"
                            : "🇬🇭 Ghana"}
                        </span>
                        <span className="text-gray-400 block text-[11px]">{it.operator}</span>
                      </td>
                      <td className="py-3 px-3 font-mono text-gray-800">
                        {it.phoneOrAccount}
                      </td>
                      <td className="py-3 px-3 font-bold text-gray-900">
                        {it.amount.toLocaleString("fr-FR")} {it.currency}
                      </td>
                      <td className="py-3 px-3 font-semibold text-gray-600 font-mono">
                        {it.amountUSDT === undefined ? "—" : `$${it.amountUSDT.toFixed(2)}`}
                      </td>
                      <td className="py-3 px-3">
                        {it.status === "valid" && (
                          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                            Prêt
                          </span>
                        )}
                        {it.status === "invalid" && (
                          <span
                            className="inline-flex items-center gap-1 text-[10px] font-semibold text-rose-700 bg-rose-50 px-2 py-0.5 rounded-full border border-rose-200"
                            title={it.errorMessage}
                          >
                            <AlertTriangle className="w-3 h-3 text-rose-500 shrink-0" />
                            {it.errorMessage || "Invalide"}
                          </span>
                        )}
                        {it.status === "processing" && (
                          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full border border-amber-200 animate-pulse">
                            En cours...
                          </span>
                        )}
                        {it.status === "pending" && (
                          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-gray-700 bg-gray-100 px-2 py-0.5 rounded-full">
                            En attente
                          </span>
                        )}
                        {it.status === "uncertain" && (
                          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-800 bg-amber-50 px-2 py-0.5 rounded-full">
                            Vérification requise
                          </span>
                        )}
                        {it.status === "completed" && (
                          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
                            <CheckCircle2 className="w-3 h-3 text-emerald-500" />
                            Payé
                          </span>
                        )}
                        {it.status === "failed" && (
                          <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-amber-800 bg-amber-50 px-2 py-0.5 rounded-full border border-amber-200">
                            Échec
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-3 text-right">
                        {it.status === "failed" && (
                          <button
                            onClick={() => handleRetryFailedItem()}
                            className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-bold rounded-lg bg-[#F5C200] text-[#0f172a] hover:bg-[#E5B500] shadow-sm"
                          >
                            <RotateCw className="w-3 h-3" />
                            <span>Relancer le lot</span>
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Step 4: History of batches */}
      {activeStep === "history" && (
        <div className="bg-white rounded-2xl border border-[#EAECEF] p-6 shadow-sm space-y-4">
          <h3 className="text-base font-bold text-gray-900">
            Historique des lots exécutés
          </h3>
          {batches.length ? (
            <pre className="max-h-96 overflow-auto rounded-xl bg-slate-950 p-4 text-xs text-slate-100">
              {JSON.stringify(batches, null, 2)}
            </pre>
          ) : (
            <p className="text-sm text-gray-500">Aucun lot retourné par le backend.</p>
          )}
        </div>
      )}

      {/* Confirmation Modal before firing Bitnob Payouts */}
      <ConfirmDialog
        isOpen={isConfirmOpen}
        onClose={() => setIsConfirmOpen(false)}
        onConfirm={handleStartBatchExecution}
        title="Lancer le lot de paiements de masse"
        description={`Vous allez transmettre au backend le lot de ${validItems.length} paiement(s). L’exécution réelle est soumise à la configuration CONFIRM_PAYOUT côté backend.`}
        confirmLabel="Confirmer et Envoyer"
        cancelLabel="Vérifier la liste"
        variant="primary"
      />
    </div>
  );
}

export default function MassePage() {
  return (
    <ToastProvider>
      <AppLayout>
        <MasseContent />
      </AppLayout>
    </ToastProvider>
  );
}
