"use client";

import React, { useCallback, useEffect, useState } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { StatCard } from "@/components/ui/StatCard";
import { VirtualCardItem } from "@/components/cards/VirtualCardItem";
import { ToastProvider, useToast } from "@/components/ui/Toast";
import { VirtualCard } from "@/types";
import { Plus, X, ShieldAlert, CreditCard, ArrowRight, ShieldCheck, ArrowLeftRight, Wallet } from "lucide-react";
import { cn } from "@/lib/utils";

interface BackendCard {
  card_id?: unknown;
  name?: unknown;
  status?: unknown;
  last4?: unknown;
  balance_usd?: unknown;
  monthly_budget_usd?: unknown;
  spent_usd?: unknown;
}

function toVirtualCard(value: unknown): VirtualCard | null {
  if (!value || typeof value !== "object") return null;
  const card = value as BackendCard;
  if (typeof card.card_id !== "string" || !card.card_id) return null;
  const status =
    card.status === "active" || card.status === "frozen"
      ? card.status
      : "unknown";
  const last4 = typeof card.last4 === "string" ? card.last4 : "";
  return {
    id: card.card_id,
    maskedNumber: last4 ? `•••• •••• •••• ${last4}` : "Numéro masqué par Bitnob",
    last4,
    cardHolder: typeof card.name === "string" ? card.name : "",
    brand: "unknown",
    cardType: "virtual",
    status,
    balance: Number(card.balance_usd) || 0,
    monthlyLimit: Number(card.monthly_budget_usd) || 0,
    spentThisMonth: Number(card.spent_usd) || 0,
    theme: "yellow",
  };
}

function CartesContent() {
  const { success, info, error: toastError } = useToast();
  const [cards, setCards] = useState<VirtualCard[]>([]);
  const [isLoadingCards, setIsLoadingCards] = useState(true);
  const [cardsError, setCardsError] = useState("");
  const [selectedCardTransactions, setSelectedCardTransactions] = useState<unknown>(null);
  const [transactionCardId, setTransactionCardId] = useState("");
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isKycModalOpen, setIsKycModalOpen] = useState(false);

  const [kycStatus, setKycStatus] = useState("unverified");
  const [kycCustomerId, setKycCustomerId] = useState("");
  const [kycIdType, setKycIdType] = useState<"national_id" | "passport" | "drivers_license" | "nin">("national_id");
  const [kycIdNumber, setKycIdNumber] = useState("");
  const [kycFirstName, setKycFirstName] = useState("");
  const [kycLastName, setKycLastName] = useState("");
  const [kycEmail, setKycEmail] = useState("");
  const [kycPhoneNumber, setKycPhoneNumber] = useState("");
  const [kycDateOfBirth, setKycDateOfBirth] = useState("");
  const [kycLine1, setKycLine1] = useState("");
  const [kycCity, setKycCity] = useState("");
  const [kycState, setKycState] = useState("");
  const [kycPostalCode, setKycPostalCode] = useState("");
  const [kycCountry, setKycCountry] = useState("SEN");
  const [kycIdFrontImage, setKycIdFrontImage] = useState("");
  const [isSubmittingKyc, setIsSubmittingKyc] = useState(false);
  const [isCreatingCard, setIsCreatingCard] = useState(false);

  const [newCardName, setNewCardName] = useState("");
  const [newCardLimit, setNewCardLimit] = useState(1000);
  const [newCardTheme, setNewCardTheme] = useState<"yellow" | "black" | "silver">("yellow");

  const loadCards = useCallback(async () => {
    const response = await fetch("/api/cards");
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Impossible de charger les cartes.");
    if (!Array.isArray(data)) throw new Error("Réponse inattendue du service cartes.");
    setCards(data.map(toVirtualCard).filter((card): card is VirtualCard => card !== null));
  }, []);

  const refreshKycStatus = useCallback(async () => {
    const response = await fetch("/api/cards/kyc");
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Impossible de vérifier le statut KYC.");
    if (!data || typeof data !== "object") return;
    const customers = Object.entries(data as Record<string, unknown>);
    const latest = customers.at(-1);
    if (!latest || !latest[1] || typeof latest[1] !== "object") return;
    const [customerId, customer] = latest as [string, Record<string, unknown>];
    setKycCustomerId(customerId);
    if (typeof customer.status === "string") setKycStatus(customer.status);
  }, []);

  useEffect(() => {
    let active = true;
    Promise.all([loadCards(), refreshKycStatus()])
      .catch((loadError: Error) => {
        if (active) {
          setCardsError(loadError.message);
        }
      })
      .finally(() => {
        if (active) setIsLoadingCards(false);
      });
    return () => {
      active = false;
    };
  }, [loadCards, refreshKycStatus]);

  useEffect(() => {
    if (!kycCustomerId || kycStatus !== "pending") return;
    const timer = window.setInterval(() => {
      refreshKycStatus().catch((refreshError: Error) => setCardsError(refreshError.message));
    }, 5000);
    return () => window.clearInterval(timer);
  }, [kycCustomerId, kycStatus, refreshKycStatus]);

  const handleOpenCardCreation = () => {
    if (kycStatus !== "approved") {
      info(
        "Vérification KYC requise",
        "Conformément aux exigences Bitnob, veuillez valider votre identité avant d'émettre une carte."
      );
      setIsKycModalOpen(true);
      return;
    }
    setIsModalOpen(true);
  };

  const handleSubmitKyc = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!kycIdNumber.trim() || !kycFirstName.trim() || !kycLastName.trim() ||
        !kycEmail.trim() || !kycPhoneNumber.trim() || !kycDateOfBirth ||
        !kycLine1.trim() || !kycCity.trim() || !kycState.trim() || !kycPostalCode.trim()) {
      toastError("Informations manquantes", "Complétez les champs d’identité, de contact et d’adresse.");
      return;
    }
    if (kycIdType !== "nin" && !kycIdFrontImage) {
      toastError("Document requis", "Ajoutez le recto de votre pièce d’identité.");
      return;
    }

    setIsSubmittingKyc(true);
    try {
      const res = await fetch("/api/cards/kyc", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          firstName: kycFirstName.trim(),
          lastName: kycLastName.trim(),
          email: kycEmail.trim(),
          phoneNumber: kycPhoneNumber.trim(),
          idType: kycIdType,
          idNumber: kycIdNumber.trim(),
          dateOfBirth: kycDateOfBirth,
          line1: kycLine1.trim(),
          city: kycCity.trim(),
          state: kycState.trim(),
          postalCode: kycPostalCode.trim(),
          country: kycCountry,
          idFrontImage: kycIdFrontImage || undefined,
        }),
      });

      const data = await res.json();
      if (res.ok && data.success) {
        setKycCustomerId(data.customerId);
        setKycStatus(typeof data.status === "string" ? data.status : "pending");
        setIsKycModalOpen(false);
        info("Dossier KYC transmis", "La création de carte sera disponible après confirmation du statut par Bitnob.");
      } else {
        toastError("Erreur KYC", data.error || "Impossible de valider les documents auprès de Bitnob.");
      }
    } catch (submissionError) {
      toastError(
        "Erreur KYC",
        submissionError instanceof Error ? submissionError.message : "Impossible de joindre Bitnob."
      );
    } finally {
      setIsSubmittingKyc(false);
    }
  };

  const handleToggleCardStatus = async (id: string) => {
    const card = cards.find((item) => item.id === id);
    if (!card || card.status === "unknown") return;
    const nextStatus = card.status === "active" ? "frozen" : "active";
    try {
      const response = await fetch(`/api/cards/${encodeURIComponent(id)}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: nextStatus }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Bitnob n’a pas modifié le statut de la carte.");
      setCards((current) =>
        current.map((item) => item.id === id ? { ...item, status: nextStatus } : item)
      );
      success(
        nextStatus === "frozen" ? "Carte gelée" : "Carte réactivée",
        `La carte •••• ${card.last4} a été mise à jour.`
      );
    } catch (statusError) {
      toastError(
        "Modification impossible",
        statusError instanceof Error ? statusError.message : "Erreur inconnue."
      );
    }
  };

  const handleCreateCard = async (e: React.FormEvent) => {
    e.preventDefault();
    if (kycStatus !== "approved" || !kycCustomerId) {
      toastError("KYC requis", "Bitnob doit avoir approuvé le profil avant la création d’une carte.");
      return;
    }
    setIsCreatingCard(true);
    try {
      const response = await fetch("/api/cards", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newCardName.trim(),
          monthlyBudgetUsd: newCardLimit,
          customerId: kycCustomerId,
          cardholderName: newCardName.trim(),
          cardBrand: "mastercard",
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Bitnob n’a pas créé la carte.");
      const card = toVirtualCard(data);
      if (!card) throw new Error("Réponse de création de carte invalide.");
      setCards((current) => [{ ...card, theme: newCardTheme }, ...current]);
      setIsModalOpen(false);
      success("Carte créée", `Enveloppe « ${newCardName.trim()} » créée par Bitnob.`);
    } catch (creationError) {
      toastError(
        "Création impossible",
        creationError instanceof Error ? creationError.message : "Erreur inconnue."
      );
    } finally {
      setIsCreatingCard(false);
    }
  };

  const loadCardTransactions = async (id: string) => {
    setTransactionCardId(id);
    setSelectedCardTransactions(null);
    try {
      const response = await fetch(`/api/cards/${encodeURIComponent(id)}/transactions`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Impossible de charger les transactions.");
      setSelectedCardTransactions(data);
    } catch (transactionLoadError) {
      toastError(
        "Transactions indisponibles",
        transactionLoadError instanceof Error ? transactionLoadError.message : "Erreur inconnue."
      );
      setTransactionCardId("");
    }
  };

  const totalSpent = cards.reduce((sum, card) => sum + card.spentThisMonth, 0);
  const totalBudget = cards.reduce((sum, card) => sum + card.monthlyLimit, 0);
  const totalBalance = cards.reduce((sum, card) => sum + card.balance, 0);

  return (
    <div className="space-y-6">
      {/* Header Row: Title & Action */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-2xl sm:text-3xl font-extrabold text-gray-900 tracking-tight">
              Mes cartes
            </h1>
            {kycStatus === "approved" ? (
              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs font-bold">
                <ShieldCheck className="w-3.5 h-3.5" />
                <span>KYC Bitnob approuvé</span>
              </span>
            ) : kycStatus === "pending" ? (
              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-amber-50 border border-amber-200 text-amber-700 text-xs font-bold">
                <ShieldAlert className="w-3.5 h-3.5" />
                <span>KYC en attente</span>
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-amber-50 border border-amber-200 text-amber-700 text-xs font-bold">
                <ShieldAlert className="w-3.5 h-3.5" />
                <span>KYC Requis</span>
              </span>
            )}
          </div>
          <p className="text-sm text-gray-500 mt-1">
            Émettez et gérez vos cartes virtuelles sécurisées pour vos paiements en ligne et dépenses professionnelles.
          </p>
        </div>

        <button
          onClick={handleOpenCardCreation}
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#F5C200] hover:bg-[#E5B500] text-[#0f172a] font-bold text-sm shadow-md shadow-[#F5C200]/25 transition-all duration-150 transform hover:-translate-y-0.5 active:translate-y-0 self-start sm:self-auto"
        >
          <Plus className="w-4 h-4 stroke-[3]" />
          <span>Créer une carte</span>
        </button>
      </div>

      {/* KYC Compliance Banner if not yet approved */}
      {kycStatus !== "approved" && (
        <div className="p-4 rounded-2xl bg-[#FFFBEB] border border-[#FDE68A] flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 animate-fadeIn">
          <div className="flex items-start gap-3">
            <div className="p-2 rounded-xl bg-[#F5C200] text-[#0F172A] shrink-0 mt-0.5">
              <ShieldAlert className="w-5 h-5" />
            </div>
            <div>
              <div className="text-sm font-bold text-[#92400E]">
                {kycStatus === "pending" ? "Vérification KYC en attente chez Bitnob" : "Vérification d'identité (KYC) requise par Bitnob"}
              </div>
              <p className="text-xs text-[#B45309] mt-0.5 leading-relaxed max-w-2xl">
                {kycStatus === "pending"
                  ? "Le dossier est transmis. La création de carte sera débloquée après réception du webhook de validation."
                  : "L'émission de cartes virtuelles nécessite la validation préalable de votre identité par Bitnob."}
              </p>
            </div>
          </div>
          <button
            onClick={() => kycStatus === "pending"
              ? refreshKycStatus().catch((refreshError: Error) => toastError("Actualisation impossible", refreshError.message))
              : setIsKycModalOpen(true)}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-[#0F172A] hover:bg-slate-800 text-white font-bold text-xs shrink-0 transition-colors shadow-xs"
          >
            <span>{kycStatus === "pending" ? "Actualiser le statut" : "Vérifier mon identité"}</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Top 4 Stat Cards - Uni-couleur & Compact */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
        {/* Dépenses totales */}
        <StatCard
          title="Dépenses totales"
          value={`$${totalSpent.toFixed(2)}`}
          variant="white"
          allowMask
          icon={
            <div className="w-6 h-6 rounded-full bg-[#FFF9E6] text-[#E5B500] flex items-center justify-center shrink-0 border border-[#F5C200]/30 shadow-xs">
              <Wallet className="w-3.5 h-3.5" />
            </div>
          }
          subValue="Dépenses retournées par Bitnob"
        />

        {/* Cartes actives */}
        <StatCard
          title="Cartes actives"
          value={`${cards.filter((c) => c.status === "active").length}`}
          subValue={`${cards.length} enveloppe(s) Bitnob`}
          variant="white"
          icon={
            <div className="w-6 h-6 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0 border border-emerald-200/60 shadow-xs">
              <CreditCard className="w-3.5 h-3.5" />
            </div>
          }
        />

        {/* Limite totale */}
        <StatCard
          title="Limite totale"
          value={`$${totalBudget.toLocaleString("fr-FR")}`}
          subValue={`dont $${totalSpent.toLocaleString("fr-FR")} dépensé`}
          variant="white"
          icon={
            <div className="w-6 h-6 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center shrink-0 border border-blue-200/60 shadow-xs">
              <ShieldCheck className="w-3.5 h-3.5" />
            </div>
          }
        />

        {/* Transactions */}
        <StatCard
          title="Solde disponible"
          value={`$${totalBalance.toLocaleString("fr-FR")}`}
          subValue="Solde des cartes retourné par Bitnob"
          variant="white"
          icon={
            <div className="w-6 h-6 rounded-full bg-slate-100 text-slate-700 flex items-center justify-center shrink-0 border border-slate-200/60 shadow-xs">
              <ArrowLeftRight className="w-3.5 h-3.5" />
            </div>
          }
        />
      </div>

      {/* Middle Row: Mes Cartes Carousel & Dépenses par catégorie */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
        {/* Virtual Cards List / Carousel */}
        <div className="lg:col-span-7 bg-white p-6 rounded-2xl border border-[#EAECEF] shadow-sm flex flex-col justify-between">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-base font-bold text-gray-900">Mes cartes</h3>
              <p className="text-xs text-gray-500 mt-0.5">
                Cartes Mastercard sécurisées avec contrôle du plafond
              </p>
            </div>
            <span className="text-xs bg-amber-50 text-amber-800 font-semibold px-2.5 py-1 rounded-full border border-amber-200/60">
              {cards.length} configurées
            </span>
          </div>

          {/* Horizontal scroll cards container */}
          <div className="flex items-center gap-4 overflow-x-auto pb-4 pt-1 px-1">
            {cards.map((card) => (
              <VirtualCardItem
                key={card.id}
                card={card}
                onToggleStatus={handleToggleCardStatus}
              />
            ))}
          </div>

          <div className="flex items-center justify-between pt-3 border-t border-gray-100 text-xs text-gray-500">
            <span>Cliquez sur l&apos;interrupteur pour geler/dégeler une carte</span>
            <span className="font-semibold text-gray-700">3DS Ready</span>
          </div>
        </div>

        {/* Dépenses par catégorie (Donut Chart) */}
        {cardsError && (
          <p className="text-sm text-rose-700" role="alert">{cardsError}</p>
        )}
        {isLoadingCards && <p className="text-sm text-gray-500">Chargement des cartes Bitnob…</p>}
        {!isLoadingCards && cards.length === 0 && !cardsError && (
          <p className="text-sm text-gray-500">Aucune enveloppe retournée par Bitnob.</p>
        )}
      </div>

      {/* Enveloppes Budgétaires Cloisonnées (Bitnob Hackathon Scenario) */}
      <div className="bg-white rounded-2xl border border-[#EAECEF] p-6 shadow-sm space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-base font-bold text-gray-900">
                Enveloppes budgétaires par carte virtuelle
              </h3>
              <span className="text-[10px] bg-amber-100 text-amber-900 font-bold px-2 py-0.5 rounded-full">
                Bitnob Virtual Cards
              </span>
            </div>
            <p className="text-xs text-gray-500 mt-0.5">
              Enveloppes et budgets retournés par l’API backend.
            </p>
          </div>

          <span className="text-xs text-gray-400 font-medium">Rechargement auto le 1er du mois</span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-2">
          {cards.map((card) => (
            <div key={card.id} className="p-4 rounded-xl border border-gray-200 bg-white space-y-3">
              <div className="flex items-center justify-between">
                <span className="font-bold text-gray-900 text-sm">{card.cardHolder || card.id}</span>
                <span className="text-xs text-gray-500">{card.status}</span>
              </div>
              <div className="flex items-baseline justify-between">
                <span className="text-xl font-black text-gray-900">${card.balance.toFixed(2)}</span>
                <span className="text-xs text-gray-500">/ ${card.monthlyLimit.toFixed(2)}</span>
              </div>
              <p className="text-[11px] text-gray-500">Carte masquée •••• {card.last4 || "—"}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-[#EAECEF] p-6 shadow-sm space-y-4">
        <div>
          <h3 className="text-base font-bold text-gray-900">Transactions de carte</h3>
          <p className="text-xs text-gray-500 mt-0.5">
            Réponse Bitnob affichée sans présumer de champs transactionnels non confirmés.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {cards.map((card) => (
            <button
              key={card.id}
              type="button"
              onClick={() => loadCardTransactions(card.id)}
              className={cn(
                "px-3 py-2 rounded-lg border text-xs font-semibold",
                transactionCardId === card.id ? "border-[#F5C200] bg-[#FFFBEB]" : "border-gray-200"
              )}
            >
              {card.cardHolder || card.id}
            </button>
          ))}
        </div>
        {selectedCardTransactions !== null && (
          <pre className="max-h-80 overflow-auto rounded-xl bg-slate-950 p-4 text-xs text-slate-100">
            {JSON.stringify(selectedCardTransactions, null, 2)}
          </pre>
        )}
      </div>

      {/* Create Card Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="fixed inset-0 bg-[#0f172a]/60 backdrop-blur-sm"
            onClick={() => setIsModalOpen(false)}
          />

          <div className="relative bg-white rounded-2xl shadow-2xl border border-gray-100 max-w-md w-full p-6 z-10 animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between pb-3 border-b border-gray-100">
              <div className="flex items-center gap-2">
                <CreditCard className="w-5 h-5 text-[#F5C200]" />
                <h3 className="text-base font-bold text-gray-900">
                  Créer une carte virtuelle
                </h3>
              </div>
              <button
                onClick={() => setIsModalOpen(false)}
                className="text-gray-400 hover:text-gray-600 p-1"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="my-4 p-3 bg-amber-50 rounded-xl border border-amber-200/60 flex items-start gap-2.5 text-xs text-amber-900 leading-relaxed">
              <ShieldAlert className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
              <p>
                La demande crée une enveloppe auprès de Bitnob. Le numéro complet et le CVV ne sont jamais exposés par cette interface.
              </p>
            </div>

            <form onSubmit={handleCreateCard} className="space-y-4 text-xs">
              <div>
                <label className="block font-semibold text-gray-700 mb-1">
                  Nom sur la carte
                </label>
                <input
                  type="text"
                  required
                  value={newCardName}
                  onChange={(e) => setNewCardName(e.target.value)}
                  className="w-full px-3.5 py-2.5 text-sm uppercase bg-white border border-gray-200 rounded-xl focus:border-[#F5C200] outline-none"
                />
              </div>

              <div>
                <label className="block font-semibold text-gray-700 mb-1">
                  Plafond mensuel ($ USD)
                </label>
                <input
                  type="number"
                  min="50"
                  max="10000"
                  step="50"
                  required
                  value={newCardLimit}
                  onChange={(e) => setNewCardLimit(parseInt(e.target.value) || 500)}
                  className="w-full px-3.5 py-2.5 text-sm bg-white border border-gray-200 rounded-xl focus:border-[#F5C200] outline-none font-bold"
                />
              </div>

              <div>
                <label className="block font-semibold text-gray-700 mb-1.5">
                  Style visuel de la carte
                </label>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => setNewCardTheme("yellow")}
                    className={cn(
                      "p-2.5 rounded-xl border font-bold text-center transition-all",
                      newCardTheme === "yellow"
                        ? "border-[#F5C200] bg-[#FFFBEB] text-[#0f172a] shadow-sm"
                        : "border-gray-200 text-gray-500"
                    )}
                  >
                    Gold Sunu
                  </button>
                  <button
                    type="button"
                    onClick={() => setNewCardTheme("black")}
                    className={cn(
                      "p-2.5 rounded-xl border font-bold text-center transition-all",
                      newCardTheme === "black"
                        ? "border-[#0f172a] bg-[#0f172a] text-white shadow-sm"
                        : "border-gray-200 text-gray-500"
                    )}
                  >
                    Navy Bitnob
                  </button>
                  <button
                    type="button"
                    onClick={() => setNewCardTheme("silver")}
                    className={cn(
                      "p-2.5 rounded-xl border font-bold text-center transition-all",
                      newCardTheme === "silver"
                        ? "border-slate-400 bg-slate-100 text-slate-800 shadow-sm"
                        : "border-gray-200 text-gray-500"
                    )}
                  >
                    Silver
                  </button>
                </div>
              </div>

              <div className="pt-3 border-t border-gray-100 flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 text-xs font-semibold text-gray-600 hover:bg-gray-100 rounded-xl"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  disabled={isCreatingCard}
                  className="px-5 py-2.5 text-xs font-bold bg-[#F5C200] hover:bg-[#E5B500] text-[#0f172a] rounded-xl shadow-md shadow-[#F5C200]/25 disabled:opacity-50"
                >
                  {isCreatingCard ? "Création..." : "Créer l’enveloppe"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Bitnob KYC Verification Modal */}
      {isKycModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-fadeIn">
          <div className="w-full max-w-lg bg-white rounded-2xl shadow-2xl border border-gray-100 overflow-hidden">
            {/* Modal Header */}
            <div className="p-5 border-b border-gray-100 bg-[#0F172A] text-white flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-[#F5C200] text-[#0F172A]">
                  <ShieldCheck className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-extrabold text-sm sm:text-base text-white">
                    Vérification d&apos;identité KYC
                  </h3>
                  <span className="text-[10px] text-amber-300 font-bold uppercase tracking-wider">
                    Conformité obligatoire Bitnob
                  </span>
                </div>
              </div>
              <button
                onClick={() => setIsKycModalOpen(false)}
                className="p-1.5 text-slate-400 hover:text-white rounded-lg transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Form */}
            <form onSubmit={handleSubmitKyc} className="p-6 space-y-4 text-xs">
              <div className="p-3 rounded-xl bg-blue-50 border border-blue-200 text-blue-900 leading-relaxed">
                <span className="font-bold">Pourquoi cette vérification ?</span>
                <p className="text-[11px] text-blue-800 mt-0.5">
                  Les champs sont transmis à Bitnob pour vérification. Le statut final est communiqué de manière asynchrone.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <input required aria-label="Prénom" placeholder="Prénom"
                  value={kycFirstName} onChange={(e) => setKycFirstName(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-white border border-gray-200 rounded-xl" />
                <input required aria-label="Nom" placeholder="Nom"
                  value={kycLastName} onChange={(e) => setKycLastName(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-white border border-gray-200 rounded-xl" />
                <input required type="email" aria-label="Adresse e-mail" placeholder="Adresse e-mail"
                  value={kycEmail} onChange={(e) => setKycEmail(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-white border border-gray-200 rounded-xl" />
                <input required type="tel" aria-label="Téléphone" placeholder="Téléphone"
                  value={kycPhoneNumber} onChange={(e) => setKycPhoneNumber(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-white border border-gray-200 rounded-xl" />
              </div>

              {/* ID Type */}
              <div>
                <label className="block font-bold text-gray-700 mb-1">
                  Type de pièce d&apos;identité <span className="text-rose-500">*</span>
                </label>
                <select
                  value={kycIdType}
                  onChange={(e) => {
                    if (["national_id", "passport", "drivers_license", "nin"].includes(e.target.value)) {
                      setKycIdType(e.target.value as typeof kycIdType);
                    }
                  }}
                  className="w-full px-3.5 py-2.5 bg-white border border-gray-200 rounded-xl font-medium focus:border-[#F5C200] outline-none"
                >
                  <option value="national_id">Carte Nationale d&apos;Identité (CNI / NIN)</option>
                  <option value="nin">NIN</option>
                  <option value="passport">Passeport biométrique</option>
                  <option value="drivers_license">Permis de conduire officiel</option>
                </select>
              </div>

              {/* ID Number & Birth Date */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-gray-700 mb-1">
                    Numéro de la pièce <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="ex: 1759199200341"
                    value={kycIdNumber}
                    onChange={(e) => setKycIdNumber(e.target.value)}
                    className="w-full px-3.5 py-2.5 bg-white border border-gray-200 rounded-xl font-medium focus:border-[#F5C200] outline-none"
                  />
                </div>

                <div>
                  <label className="block font-bold text-gray-700 mb-1">
                    Date de naissance <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="date"
                    required
                    value={kycDateOfBirth}
                    onChange={(e) => setKycDateOfBirth(e.target.value)}
                    className="w-full px-3.5 py-2.5 bg-white border border-gray-200 rounded-xl font-medium focus:border-[#F5C200] outline-none"
                  />
                </div>
              </div>

              {kycIdType !== "nin" && (
                <div>
                  <label className="block font-bold text-gray-700 mb-1">
                    Recto du document (image, 1 Mo maximum) <span className="text-rose-500">*</span>
                  </label>
                  <input
                    required
                    type="file"
                    accept="image/*"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      setKycIdFrontImage("");
                      if (!file) return;
                      if (!file.type.startsWith("image/") || file.size > 1_048_576) {
                        toastError("Document invalide", "Choisissez une image de 1 Mo maximum.");
                        event.target.value = "";
                        return;
                      }
                      const reader = new FileReader();
                      reader.onload = () => {
                        if (typeof reader.result === "string") {
                          setKycIdFrontImage(reader.result.split(",")[1] || "");
                        }
                      };
                      reader.onerror = () => toastError("Lecture impossible", "Impossible de lire le document.");
                      reader.readAsDataURL(file);
                    }}
                    className="w-full px-3.5 py-2.5 bg-white border border-gray-200 rounded-xl"
                  />
                </div>
              )}

              {/* Address: Line 1, City, Country */}
              <div>
                <label className="block font-bold text-gray-700 mb-1">
                  Adresse de résidence <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="ex: 14 Rue des Almadies"
                  value={kycLine1}
                  onChange={(e) => setKycLine1(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-white border border-gray-200 rounded-xl font-medium focus:border-[#F5C200] outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-gray-700 mb-1">
                    Ville <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="Dakar"
                    value={kycCity}
                    onChange={(e) => setKycCity(e.target.value)}
                    className="w-full px-3.5 py-2.5 bg-white border border-gray-200 rounded-xl font-medium focus:border-[#F5C200] outline-none"
                  />
                </div>

                <div>
                  <label className="block font-bold text-gray-700 mb-1">
                    Pays <span className="text-rose-500">*</span>
                  </label>
                  <select
                    value={kycCountry}
                    onChange={(e) => setKycCountry(e.target.value)}
                    className="w-full px-3.5 py-2.5 bg-white border border-gray-200 rounded-xl font-medium focus:border-[#F5C200] outline-none"
                  >
                    <option value="SEN">Sénégal (SEN)</option>
                    <option value="NGA">Nigéria (NGA)</option>
                    <option value="GHA">Ghana (GHA)</option>
                    <option value="CIV">Côte d&apos;Ivoire (CIV)</option>
                    <option value="CMR">Cameroun (CMR)</option>
                  </select>
                </div>
                <input required aria-label="Région / état" placeholder="Région / état"
                  value={kycState} onChange={(e) => setKycState(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-white border border-gray-200 rounded-xl" />
                <input required aria-label="Code postal" placeholder="Code postal"
                  value={kycPostalCode} onChange={(e) => setKycPostalCode(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-white border border-gray-200 rounded-xl" />
              </div>

              <div className="pt-3 border-t border-gray-100 flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setIsKycModalOpen(false)}
                  className="px-4 py-2 font-semibold text-gray-600 hover:bg-gray-100 rounded-xl"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingKyc}
                  className="px-5 py-2.5 font-bold bg-[#F5C200] hover:bg-[#E5B500] text-[#0f172a] rounded-xl shadow-md shadow-[#F5C200]/25 disabled:opacity-50"
                >
                  {isSubmittingKyc ? "Vérification en cours..." : "Valider mon identité"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default function CartesPage() {
  return (
    <ToastProvider>
      <AppLayout>
        <CartesContent />
      </AppLayout>
    </ToastProvider>
  );
}
