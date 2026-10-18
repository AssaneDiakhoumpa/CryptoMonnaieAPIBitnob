"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { Plus, ArrowRight, Wallet } from "lucide-react";
import { AppLayout } from "@/components/layout/AppLayout";
import { StatCard } from "@/components/ui/StatCard";
import { ToastProvider } from "@/components/ui/Toast";

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export default function DashboardPage() {
  const [dashboard, setDashboard] = useState<Record<string, unknown>>({});
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    fetch("/api/dashboard")
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Impossible de charger le tableau de bord.");
        return data;
      })
      .then((data: unknown) => {
        if (active) setDashboard(record(data));
      })
      .catch((loadError: Error) => {
        if (active) setError(loadError.message);
      });
    return () => {
      active = false;
    };
  }, []);

  const summary = record(dashboard.summary);
  const totals = record(summary.totals);
  const byDay = Array.isArray(summary.by_day) ? summary.by_day.map(record) : [];
  const recentBatches = Array.isArray(summary.recent_batches) ? summary.recent_batches : [];
  const maxPayouts = Math.max(1, ...byDay.map((item) => Number(item.payouts) || 0));

  return (
    <ToastProvider>
      <AppLayout>
        <div className="space-y-6">
          {/* Header Row: Greeting & Action */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h1 className="text-2xl sm:text-3xl font-extrabold text-gray-900 tracking-tight">
                Bonjour
              </h1>
              <p className="text-sm text-gray-500 mt-1">
                Voici un aperçu de vos activités aujourd&apos;hui.
              </p>
            </div>

            <div className="flex items-center gap-3">
              <Link
                href="/factures"
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#F5C200] hover:bg-[#E5B500] text-[#0f172a] font-bold text-sm shadow-md shadow-[#F5C200]/25 transition-all duration-150 transform hover:-translate-y-0.5 active:translate-y-0"
              >
                <Plus className="w-4 h-4 stroke-[3]" />
                <span>Créer une facture</span>
              </Link>
            </div>
          </div>

          {/* Balances Row: 4 Cards - Uni-couleur & Compact */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
            {/* Card 1: Solde total */}
            <StatCard
              title="Solde total"
              value={String(totals.payouts ?? "—")}
              variant="white"
              allowMask
              icon={
                <div className="w-6 h-6 rounded-full bg-[#FFF9E6] text-[#E5B500] flex items-center justify-center shrink-0 border border-[#F5C200]/30 shadow-xs">
                  <Wallet className="w-3.5 h-3.5" />
                </div>
              }
              badge={{
                text: "Payouts du compte",
                trend: "neutral",
              }}
            />

            {/* Card 2: Bitcoin */}
            <StatCard
              title="Payouts réussis"
              value={String(totals.success ?? "—")}
              variant="white"
              icon={<Wallet className="w-4 h-4" />}
            />

            {/* Card 3: USDT */}
            <StatCard
              title="Payouts échoués"
              value={String(totals.failed ?? "—")}
              variant="white"
              icon={<Wallet className="w-4 h-4" />}
            />

            {/* Card 4: USDC */}
            <StatCard
              title="En cours"
              value={String(totals.in_progress ?? "—")}
              variant="white"
              icon={<Wallet className="w-4 h-4" />}
            />
          </div>

          {error && <p role="alert" className="text-sm text-rose-700">{error}</p>}

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 bg-white rounded-2xl border border-[#EAECEF] p-6 shadow-sm">
              <h3 className="text-base font-bold text-gray-900">Payouts par jour</h3>
              <p className="text-xs text-gray-500 mt-0.5">Données calculées par le backend</p>
              <div className="mt-5 space-y-3">
                {byDay.map((item, index) => {
                  const count = Number(item.payouts) || 0;
                  return (
                    <div key={String(item.date ?? index)} className="grid grid-cols-[90px_1fr_40px] items-center gap-3 text-xs">
                      <span className="text-gray-500">{String(item.date ?? "—")}</span>
                      <div className="h-2 rounded-full bg-gray-100">
                        <div className="h-2 rounded-full bg-[#F5C200]" style={{ width: `${(count / maxPayouts) * 100}%` }} />
                      </div>
                      <span className="text-right font-semibold">{count}</span>
                    </div>
                  );
                })}
                {!byDay.length && <p className="text-sm text-gray-500">Aucune donnée journalière disponible.</p>}
              </div>
            </div>
            <div className="lg:col-span-1 bg-white rounded-2xl border border-[#EAECEF] p-6 shadow-sm">
              <h3 className="text-base font-bold text-gray-900">Soldes Bitnob</h3>
              <p className="text-xs text-gray-500 mt-0.5">Réponse reçue du backend</p>
              <pre className="mt-4 max-h-64 overflow-auto rounded-xl bg-slate-950 p-3 text-[11px] text-slate-100">
                {JSON.stringify(dashboard.balances ?? null, null, 2)}
              </pre>
            </div>
          </div>

          {/* Bottom Row: Transactions récentes */}
          <div className="bg-white rounded-2xl border border-[#EAECEF] p-6 shadow-sm">
            <div className="flex items-center justify-between mb-5">
              <div>
                <h3 className="text-base font-bold text-gray-900">
                  Transactions récentes
                </h3>
                <p className="text-xs text-gray-500 mt-0.5">
                  Lots de paiements récents
                </p>
              </div>

              <Link
                href="/paiements"
                className="inline-flex items-center gap-1.5 text-xs font-bold text-gray-700 hover:text-black group"
              >
                <span>Voir tout</span>
                <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition-transform" />
              </Link>
            </div>

            {recentBatches.length ? (
              <pre className="max-h-80 overflow-auto rounded-xl bg-slate-950 p-4 text-xs text-slate-100">
                {JSON.stringify(recentBatches, null, 2)}
              </pre>
            ) : (
              <p className="text-sm text-gray-500">Aucun lot récent retourné par le backend.</p>
            )}
          </div>
        </div>
      </AppLayout>
    </ToastProvider>
  );
}
