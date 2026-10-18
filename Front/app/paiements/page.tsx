"use client";

import React, { useEffect, useState } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { StatCard } from "@/components/ui/StatCard";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { ToastProvider, useToast } from "@/components/ui/Toast";
import { BackendInvoice } from "@/lib/backend/invoices";
import {
  Search,
  Download,
  CheckCircle2,
  Clock,
  X,
  Wallet,
} from "lucide-react";

function PaiementsContent() {
  const { success } = useToast();
  const [invoices, setInvoices] = useState<BackendInvoice[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [selectedInvoice, setSelectedInvoice] = useState<BackendInvoice | null>(null);

  useEffect(() => {
    let active = true;

    async function loadInvoices() {
      setIsLoading(true);
      setLoadError("");
      try {
        const response = await fetch("/api/invoices", { cache: "no-store" });
        const payload = await response.json();
        if (!response.ok) {
          throw new Error(
            typeof payload.error === "string" ? payload.error : "Impossible de charger les factures."
          );
        }
        if (!Array.isArray(payload.invoices)) {
          throw new Error("Réponse invalide du service de factures.");
        }
        if (active) setInvoices(payload.invoices as BackendInvoice[]);
      } catch (error) {
        if (active) {
          setLoadError(error instanceof Error ? error.message : "Impossible de charger les factures.");
        }
      } finally {
        if (active) setIsLoading(false);
      }
    }

    void loadInvoices();
    return () => {
      active = false;
    };
  }, []);

  const filteredInvoices = invoices.filter((invoice) => {
    const query = searchQuery.toLowerCase();
    const matchesSearch = [
      invoice.reference,
      invoice.id,
      invoice.description,
      String(invoice.amountSat),
    ].some((value) => value.toLowerCase().includes(query));
    const status = invoice.status.toLowerCase();
    const matchesStatus =
      typeFilter === "all" ||
      (typeFilter === "paid" && status === "paid") ||
      (typeFilter === "pending" && status === "pending") ||
      (typeFilter === "other" && status !== "paid" && status !== "pending");
    return matchesSearch && matchesStatus;
  });

  const paidInvoices = invoices.filter((invoice) => invoice.status.toLowerCase() === "paid");
  const pendingInvoices = invoices.filter((invoice) => invoice.status.toLowerCase() === "pending");
  const totalPaidSats = paidInvoices.reduce((total, invoice) => total + invoice.amountSat, 0);

  const handleExportCSV = () => {
    const escapeCell = (value: string) => {
      const safeValue = /^[\s]*[=+\-@]/.test(value) ? `'${value}` : value;
      return `"${safeValue.replace(/"/g, '""')}"`;
    };
    const rows = [
      ["reference", "description", "amountSat", "status", "expiresAt"],
      ...filteredInvoices.map((invoice) => [
        invoice.reference,
        invoice.description,
        String(invoice.amountSat),
        invoice.status,
        invoice.expiresAt ?? "",
      ]),
    ];
    const csv = rows.map((row) => row.map(escapeCell).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "factures-lightning.csv";
    link.click();
    URL.revokeObjectURL(url);
    success("Export CSV prêt", "Le relevé de transactions a été téléchargé.");
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-gray-900 tracking-tight">
            Paiements
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Consultez et exportez les factures Lightning disponibles depuis le backend.
          </p>
        </div>

        <button
          onClick={handleExportCSV}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white border border-gray-200 text-gray-700 hover:text-black hover:border-gray-300 text-xs font-bold shadow-sm transition-colors self-start sm:self-auto"
        >
          <Download className="w-4 h-4" />
          <span>Exporter le relevé (CSV)</span>
        </button>
      </div>

      {/* Stats summary - Uni-couleur & Compact */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
        <StatCard
          title="Encaissement confirmé"
          value={isLoading || loadError ? "—" : `${totalPaidSats.toLocaleString("fr-FR")} sats`}
          subValue={`${paidInvoices.length} facture(s) payée(s) parmi les factures listées`}
          variant="white"
          icon={
            <div className="w-6 h-6 rounded-full bg-[#FFF9E6] text-[#E5B500] flex items-center justify-center shrink-0 border border-[#F5C200]/30 shadow-xs">
              <Wallet className="w-3.5 h-3.5" />
            </div>
          }
        />
        <StatCard
          title="Factures en attente"
          value={isLoading || loadError ? "—" : pendingInvoices.length.toLocaleString("fr-FR")}
          subValue="Statut communiqué par le backend"
          variant="white"
          icon={
            <div className="w-6 h-6 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center shrink-0 border border-blue-200/60 shadow-xs">
              <Clock className="w-3.5 h-3.5" />
            </div>
          }
        />
        <StatCard
          title="Factures listées"
          value={isLoading || loadError ? "—" : invoices.length.toLocaleString("fr-FR")}
          subValue={isLoading ? "Chargement…" : loadError ? "Données indisponibles" : "Réponse de l’API"}
          variant="white"
          icon={
            <div className="w-6 h-6 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0 border border-emerald-200/60 shadow-xs">
              <CheckCircle2 className="w-3.5 h-3.5" />
            </div>
          }
        />
      </div>

      {/* Main Table Card */}
      <div className="bg-white rounded-2xl border border-[#EAECEF] p-6 shadow-sm space-y-6">
        {/* Filter controls */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="relative flex-1 max-w-md">
            <Search className="w-4 h-4 text-gray-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Rechercher par référence, description ou montant en sats..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2 text-sm bg-[#F5F6F9] border border-transparent focus:border-[#F5C200] rounded-xl text-gray-900 placeholder-gray-400 outline-none"
            />
          </div>

          <div className="flex items-center gap-2">
            {[
              { id: "all", label: "Toutes" },
              { id: "paid", label: "Payées" },
              { id: "pending", label: "En attente" },
              { id: "other", label: "Autres statuts" },
            ].map((f) => (
              <button
                key={f.id}
                onClick={() => setTypeFilter(f.id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                  typeFilter === f.id
                    ? "bg-[#0f172a] text-white"
                    : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {/* Transactions Table */}
        {loadError && (
          <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
            {loadError}
          </p>
        )}
        {isLoading ? (
          <p className="py-12 text-center text-sm text-gray-500">Chargement des factures…</p>
        ) : filteredInvoices.length === 0 ? (
          <p className="py-12 text-center text-sm text-gray-500">
            {loadError ? "Les factures ne sont pas disponibles." : "Aucune facture ne correspond à votre recherche."}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-gray-100 text-[11px] font-semibold text-gray-400 uppercase tracking-wider">
                  <th className="pb-3 px-4 font-medium">Référence</th>
                  <th className="pb-3 px-4 font-medium">Description</th>
                  <th className="pb-3 px-4 font-medium">Montant</th>
                  <th className="pb-3 px-4 font-medium">Statut</th>
                  <th className="pb-3 px-4 font-medium text-right">Expiration</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50 text-sm">
                {filteredInvoices.map((invoice) => (
                  <tr
                    key={invoice.id}
                    onClick={() => setSelectedInvoice(invoice)}
                    className="cursor-pointer hover:bg-gray-50/80 transition-colors"
                  >
                    <td className="py-3.5 px-4 font-mono text-xs font-semibold text-gray-900">
                      {invoice.reference || invoice.id}
                    </td>
                    <td className="py-3.5 px-4 text-gray-600">{invoice.description || "Facture Lightning"}</td>
                    <td className="py-3.5 px-4 font-semibold text-gray-900">
                      {invoice.amountSat.toLocaleString("fr-FR")} sats
                    </td>
                    <td className="py-3.5 px-4">
                      <StatusBadge status={invoice.status} />
                    </td>
                    <td className="py-3.5 px-4 text-right text-xs text-gray-500 whitespace-nowrap">
                      {invoice.expiresAt ? new Date(invoice.expiresAt).toLocaleString("fr-FR") : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Transaction Details Modal */}
      {selectedInvoice && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="fixed inset-0 bg-[#0f172a]/60 backdrop-blur-sm"
            onClick={() => setSelectedInvoice(null)}
          />

          <div className="relative bg-white rounded-2xl shadow-2xl border border-gray-100 max-w-md w-full p-6 z-10 animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between pb-3 border-b border-gray-100">
              <h3 className="text-base font-bold text-gray-900">
                Détails de la facture
              </h3>
              <button
                onClick={() => setSelectedInvoice(null)}
                className="text-gray-400 hover:text-gray-600 p-1"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="py-4 space-y-3.5 text-xs">
              <div className="flex items-center justify-between py-1 border-b border-gray-50">
                <span className="text-gray-500">Référence</span>
                <span className="font-mono font-bold text-gray-900">
                  {selectedInvoice.reference || selectedInvoice.id}
                </span>
              </div>

              <div className="flex items-center justify-between py-1 border-b border-gray-50">
                <span className="text-gray-500">Description</span>
                <span className="font-bold text-gray-900">
                  {selectedInvoice.description || "Facture Lightning"}
                </span>
              </div>

              <div className="flex items-center justify-between py-1 border-b border-gray-50">
                <span className="text-gray-500">Montant facturé</span>
                <span className="text-base font-black text-gray-900">
                  {selectedInvoice.amountSat.toLocaleString("fr-FR")} sats
                </span>
              </div>

              <div className="flex items-center justify-between py-1 border-b border-gray-50">
                <span className="text-gray-500">Statut</span>
                <StatusBadge status={selectedInvoice.status} />
              </div>

              {selectedInvoice.paymentRequest && (
                <div className="flex items-center justify-between py-1 border-b border-gray-50">
                  <span className="text-gray-500">Facture Lightning</span>
                  <span className="font-mono text-gray-700 bg-gray-100 px-2 py-0.5 rounded text-[11px] max-w-[65%] truncate">
                    {selectedInvoice.paymentRequest}
                  </span>
                </div>
              )}

              <div className="flex items-center justify-between py-1">
                <span className="text-gray-500">Expiration</span>
                <span className="text-gray-700">
                  {selectedInvoice.expiresAt ? new Date(selectedInvoice.expiresAt).toLocaleString("fr-FR") : "—"}
                </span>
              </div>
            </div>

            <div className="pt-3 border-t border-gray-100 flex justify-end">
              <button
                onClick={() => setSelectedInvoice(null)}
                className="px-4 py-2 text-xs font-bold bg-gray-900 text-white rounded-xl"
              >
                Fermer
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function PaiementsPage() {
  return (
    <ToastProvider>
      <AppLayout>
        <PaiementsContent />
      </AppLayout>
    </ToastProvider>
  );
}
