"use client";

import React, { useState } from "react";
import { VirtualCard } from "@/types";
import { Wifi, Eye, EyeOff, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";

interface VirtualCardItemProps {
  card: VirtualCard;
  onToggleStatus?: (id: string) => void;
  className?: string;
}

export function VirtualCardItem({
  card,
  onToggleStatus,
  className,
}: VirtualCardItemProps) {
  const [showSensitive, setShowSensitive] = useState(false);

  // Background and text styles depending on card theme
  const getThemeStyles = () => {
    switch (card.theme) {
      case "yellow":
        return {
          container:
            "bg-gradient-to-br from-[#F5C200] via-[#E8B800] to-[#D4A300] text-[#0f172a] shadow-lg shadow-[#F5C200]/20",
          logo: "text-[#0f172a]",
          mutedText: "text-[#0f172a]/70",
          subtleBorder: "border-[#0f172a]/10",
        };
      case "silver":
        return {
          container:
            "bg-gradient-to-br from-[#E2E8F0] via-[#CBD5E1] to-[#94A3B8] text-slate-900 shadow-md",
          logo: "text-slate-900",
          mutedText: "text-slate-700",
          subtleBorder: "border-slate-400/20",
        };
      case "black":
      default:
        return {
          container:
            "bg-gradient-to-br from-[#1e293b] via-[#151d30] to-[#0f172a] text-white shadow-xl shadow-[#0f172a]/30 border border-[#334155]",
          logo: "text-white",
          mutedText: "text-slate-400",
          subtleBorder: "border-white/10",
        };
    }
  };

  const theme = getThemeStyles();

  return (
    <div
      className={cn(
        "relative w-72 sm:w-80 h-44 sm:h-48 rounded-2xl p-5 flex flex-col justify-between shrink-0 select-none transition-all duration-200 transform hover:-translate-y-1 hover:shadow-2xl overflow-hidden",
        theme.container,
        className
      )}
    >
      {/* Decorative background watermarks */}
      <div className="absolute -right-8 -bottom-8 w-36 h-36 rounded-full bg-white/5 pointer-events-none" />

      {/* Top Row: Brand & Status toggle */}
      <div className="flex items-center justify-between z-10">
        <div className="flex items-center gap-2">
          <div className="flex items-center font-bold tracking-tight text-sm">
            <span className={theme.logo}>Sunu</span>
            <span className={card.theme === "yellow" ? "text-[#0f172a]" : "text-[#F5C200]"}>
              Pay
            </span>
          </div>
          <span
            className={cn(
              "text-[9px] uppercase tracking-wider font-semibold px-1.5 py-0.5 rounded",
              card.theme === "yellow"
                ? "bg-[#0f172a]/10 text-[#0f172a]"
                : "bg-white/10 text-white"
            )}
          >
            Virtual
          </span>
        </div>

        <div className="flex items-center gap-2">
          <Wifi className={cn("w-4 h-4 rotate-90", theme.mutedText)} />
          {card.status !== "unknown" && (
          <button
            onClick={() => onToggleStatus?.(card.id)}
            className={cn(
              "w-8 h-4.5 rounded-full p-0.5 transition-colors relative",
              card.status === "active"
                ? card.theme === "yellow"
                  ? "bg-[#0f172a]"
                  : "bg-[#F5C200]"
                : "bg-gray-400"
            )}
            title={card.status === "active" ? "Carte active (Cliquer pour geler)" : "Carte gelée"}
          >
            <div
              className={cn(
                "w-3.5 h-3.5 rounded-full transition-transform",
                card.theme === "yellow" ? "bg-white" : "bg-[#0f172a]",
                card.status === "active" ? "translate-x-3.5" : "translate-x-0"
              )}
            />
          </button>
          )}
        </div>
      </div>

      {/* Card Number */}
      <div className="z-10 my-1">
        <div className="flex items-center justify-between">
          <div className="font-mono text-base sm:text-lg font-bold tracking-widest">
            {showSensitive && card.cardNumber ? card.cardNumber : card.maskedNumber}
          </div>
          {card.cardNumber && (
          <button
            onClick={() => setShowSensitive(!showSensitive)}
            className={cn("p-1 rounded opacity-70 hover:opacity-100", theme.mutedText)}
            aria-label="Afficher/Masquer le numéro"
          >
            {showSensitive ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
          </button>
          )}
        </div>
      </div>

      {/* Bottom Row: Card Holder, Expiry & Mastercard Logo */}
      <div className="flex items-end justify-between z-10 text-xs">
        <div>
          <span className={cn("text-[9px] uppercase tracking-wider block", theme.mutedText)}>
            Titulaire
          </span>
          <span className="font-bold tracking-wide">{card.cardHolder}</span>
        </div>

        <div className="text-center">
          <span className={cn("text-[9px] uppercase tracking-wider block", theme.mutedText)}>
            Expire
          </span>
          <span className="font-mono font-bold">{card.expiryDate || "—"}</span>
        </div>

        <span className="text-[9px] font-bold uppercase">
          {card.brand === "unknown" ? "Bitnob" : card.brand}
        </span>
      </div>
    </div>
  );
}
