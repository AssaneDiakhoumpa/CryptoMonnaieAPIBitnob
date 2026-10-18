"use client";

import React, { useState, useRef, useEffect } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { ToastProvider, useToast } from "@/components/ui/Toast";
import {
  Sparkles,
  Send,
  Bot,
  User,
  Copy,
  FilePlus,
  Database,
  ChevronDown,
} from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";

interface ChatMessage {
  id: string;
  sender: "user" | "assistant";
  content: string;
  timestamp: string;
  computation?: {
    type: string;
    details: Record<string, string | number>;
  };
}

const INITIAL_MESSAGES: ChatMessage[] = [
  {
    id: "msg-1",
    sender: "assistant",
    content: `Bonjour ! Je suis l'assistant SunuPay en lecture seule.

Les analyses de paiements, les taux, les frais et les transactions ne sont pas encore raccordés à des données vérifiées. Je ne confirmerai donc aucun montant et n'exécuterai aucune opération.

Vous pouvez poser une question ; je vous indiquerai si elle nécessite le service d'analyse ERP, qui n'est pas disponible actuellement.`,
    timestamp: "À l'instant",
  },
];

const SUGGESTIONS = [
  "Pourquoi les analyses de paiements ne sont-elles pas disponibles ?",
  "Peux-tu exécuter un paiement ?",
  "Les taux de change affichés sont-ils vérifiés ?",
];

function SqlCollapsible({ code }: { code: string }) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="my-1.5 rounded-xl border border-gray-200 bg-white overflow-hidden text-xs shadow-xs">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between px-3 py-1.5 text-gray-500 hover:text-gray-900 hover:bg-gray-50 transition-colors text-left"
      >
        <div className="flex items-center gap-1.5">
          <Database className="w-3.5 h-3.5 text-amber-500" />
          <span className="text-[11px] font-semibold text-gray-700">
            Requête SQL (en arrière-plan)
          </span>
        </div>
        <span className="text-[10px] text-gray-400 font-medium flex items-center gap-1">
          {isOpen ? "Masquer" : "Afficher"}
          <ChevronDown
            className={cn("w-3.5 h-3.5 transition-transform duration-200", isOpen && "rotate-180")}
          />
        </span>
      </button>

      {isOpen && (
        <div className="p-3 bg-[#0f172a] text-slate-200 text-[11px] font-mono border-t border-gray-200 overflow-x-auto">
          <pre className="text-emerald-400 whitespace-pre-wrap leading-relaxed">{code}</pre>
        </div>
      )}
    </div>
  );
}

function FormattedMessage({ content, isUser }: { content: string; isUser: boolean }) {
  if (isUser) {
    return <div className="whitespace-pre-wrap">{content}</div>;
  }

  const lines = content.split("\n");
  const elements: React.ReactNode[] = [];
  let inCodeBlock = false;
  let codeBlockLines: string[] = [];
  let listItems: string[] = [];

  const renderInline = (raw: string): React.ReactNode => {
    // Process markdown tokens: `code`, **bold**, *italic*
    const tokens = raw.split(/(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*)/g);

    return tokens.map((part, index) => {
      if (part.startsWith("`") && part.endsWith("`") && part.length > 2) {
        return (
          <code
            key={index}
            className="px-1.5 py-0.5 rounded bg-gray-200/80 text-gray-800 font-mono text-[11px] font-semibold border border-gray-300/50"
          >
            {part.slice(1, -1)}
          </code>
        );
      }
      if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
        return (
          <strong key={index} className="font-bold text-gray-950">
            {part.slice(2, -2)}
          </strong>
        );
      }
      if (part.startsWith("*") && part.endsWith("*") && part.length > 2) {
        return (
          <span key={index} className="text-gray-800 font-medium">
            {part.slice(1, -1)}
          </span>
        );
      }
      // Clean any accidental dangling asterisks
      const cleaned = part.replace(/\*\*/g, "").replace(/\*/g, "");
      return <React.Fragment key={index}>{cleaned}</React.Fragment>;
    });
  };

  const flushList = () => {
    if (listItems.length > 0) {
      const items = [...listItems];
      elements.push(
        <ul key={`list-${elements.length}`} className="my-1.5 space-y-1.5 pl-0.5">
          {items.map((item, idx) => (
            <li key={idx} className="flex items-start gap-2 text-xs sm:text-sm text-gray-800 leading-relaxed">
              <span className="w-1.5 h-1.5 rounded-full bg-[#F5C200] mt-1.5 shrink-0" />
              <span>{renderInline(item)}</span>
            </li>
          ))}
        </ul>
      );
      listItems = [];
    }
  };

  const flushCode = () => {
    if (codeBlockLines.length > 0) {
      const code = codeBlockLines.join("\n");
      elements.push(
        <SqlCollapsible key={`code-${elements.length}`} code={code} />
      );
      codeBlockLines = [];
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.trim().startsWith("```")) {
      if (inCodeBlock) {
        flushCode();
        inCodeBlock = false;
      } else {
        flushList();
        inCodeBlock = true;
      }
      continue;
    }

    if (inCodeBlock) {
      codeBlockLines.push(line);
      continue;
    }

    // List item (- item, * item, • item, 1. item)
    const listMatch = line.match(/^(\s*[-*•]|\s*\d+[\.)])\s+(.+)$/);
    if (listMatch) {
      listItems.push(listMatch[2]);
      continue;
    } else {
      flushList();
    }

    // Heading (# Header, ## Header, ### Header)
    if (line.trim().startsWith("#")) {
      const headingText = line.replace(/^#+\s*/, "");
      elements.push(
        <h4 key={`heading-${i}`} className="font-bold text-xs sm:text-sm text-gray-950 mt-2 mb-1">
          {renderInline(headingText)}
        </h4>
      );
      continue;
    }

    if (!line.trim()) {
      elements.push(<div key={`empty-${i}`} className="h-1" />);
      continue;
    }

    // Paragraph
    elements.push(
      <p key={`p-${i}`} className="text-xs sm:text-sm text-gray-800 leading-relaxed">
        {renderInline(line)}
      </p>
    );
  }

  flushList();
  flushCode();

  return <div className="space-y-1">{elements}</div>;
}

function AssistantContent() {
  const { success } = useToast();
  const [messages, setMessages] = useState<ChatMessage[]>(INITIAL_MESSAGES);
  const [inputQuery, setInputQuery] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isTyping]);

  const handleSendMessage = async (textToSend?: string) => {
    const query = textToSend || inputQuery;
    if (!query.trim() || isTyping) return;

    const userMsg: ChatMessage = {
      id: `user-${messages.length}`,
      sender: "user",
      content: query,
      timestamp: "À l'instant",
    };

    setMessages((prev) => [...prev, userMsg]);
    if (!textToSend) setInputQuery("");
    setIsTyping(true);

    try {
      const res = await fetch("/api/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: query,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Erreur de communication avec le serveur");
      }

      const assistantMsg: ChatMessage = {
        id: `assistant-${messages.length + 1}`,
        sender: "assistant",
        content: data.reply,
        timestamp: "À l'instant",
        computation: data.computation,
      };

      setMessages((prev) => [...prev, assistantMsg]);
    } catch (err: unknown) {
      console.error("[Assistant Frontend]", err);
      const errorMsg: ChatMessage = {
        id: `assistant-${messages.length + 1}`,
        sender: "assistant",
        content: `Désolé, une erreur est survenue lors de la communication avec l'assistant : ${err instanceof Error ? err.message : "Erreur réseau"}. Vous pouvez réessayer.`,
        timestamp: "À l'instant",
      };
      setMessages((prev) => [...prev, errorMsg]);
    } finally {
      setIsTyping(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto space-y-4">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl sm:text-2xl font-extrabold text-gray-900 tracking-tight">
              Assistant IA SunuPay
            </h1>
            <span className="text-[11px] bg-[#FFF9E6] text-amber-800 font-bold px-2 py-0.5 rounded-full border border-[#F5C200]/40 flex items-center gap-1">
              <Sparkles className="w-3 h-3 text-[#F5C200]" />
              Lecture seule
            </span>
          </div>
          <p className="text-xs text-gray-500 mt-0.5">
            Les analyses financières restent désactivées tant que les données réelles ne sont pas raccordées.
          </p>
        </div>

        <div className="flex items-center gap-2 self-start sm:self-auto">
          <span className="text-[11px] text-gray-500 bg-white px-2.5 py-1 rounded-lg border border-gray-200">
            Données financières non connectées
          </span>
        </div>
      </div>

      {/* Main Chat Container - Compact Width & Length */}
      <div className="bg-white rounded-2xl border border-[#EAECEF] shadow-sm flex flex-col h-[480px] overflow-hidden">
        {/* Messages Stream */}
        <div className="flex-1 p-3.5 sm:p-4 overflow-y-auto space-y-3">
          {messages.map((msg) => {
            const isUser = msg.sender === "user";
            const computation = msg.computation;

            return (
              <div
                key={msg.id}
                className={cn(
                  "flex items-start gap-2.5",
                  isUser ? "flex-row-reverse" : "flex-row"
                )}
              >
                {/* Avatar */}
                <div
                  className={cn(
                    "w-7 h-7 rounded-lg flex items-center justify-center shrink-0 font-bold text-xs shadow-xs",
                    isUser
                      ? "bg-[#0f172a] text-[#F5C200]"
                      : "bg-[#F5C200] text-[#0f172a]"
                  )}
                >
                  {isUser ? <User className="w-3.5 h-3.5" /> : <Bot className="w-3.5 h-3.5" />}
                </div>

                {/* Message Bubble */}
                <div
                  className={cn(
                    "max-w-[85%] rounded-xl p-3 text-xs sm:text-sm leading-relaxed",
                    isUser
                      ? "bg-[#0f172a] text-white"
                      : "bg-[#F8F9FA] text-gray-900 border border-gray-100"
                  )}
                >
                  <FormattedMessage content={msg.content} isUser={isUser} />

                  {/* Computation Action Button */}
                  {computation?.type === "fee_calc" && (
                    <div className="mt-3 pt-2.5 border-t border-gray-200 flex flex-wrap gap-2">
                      <Link
                        href="/factures"
                        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#F5C200] text-[#0f172a] font-bold text-xs shadow-xs hover:bg-[#E5B500] transition-colors"
                      >
                        <FilePlus className="w-3 h-3" />
                        <span>Créer cette facture ({computation.details.invoiceAmountUSDT} USDT)</span>
                      </Link>

                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(
                            `Facture: ${computation.details.invoiceAmountUSDT} USDT pour recevoir ${computation.details.targetNetXOF} FCFA`
                          );
                          success("Copié !", "Détail du calcul copié dans le presse-papiers.");
                        }}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white border border-gray-200 text-gray-700 text-xs font-semibold hover:bg-gray-50"
                      >
                        <Copy className="w-3 h-3" />
                        <span>Copier</span>
                      </button>
                    </div>
                  )}

                  <div
                    className={cn(
                      "text-[10px] mt-1.5",
                      isUser ? "text-gray-400 text-right" : "text-gray-400"
                    )}
                  >
                    {msg.timestamp}
                  </div>
                </div>
              </div>
            );
          })}

          {isTyping && (
            <div className="flex items-center gap-2.5">
              <div className="w-7 h-7 rounded-lg bg-[#F5C200] text-[#0f172a] flex items-center justify-center shrink-0">
                <Bot className="w-3.5 h-3.5" />
              </div>
              <div className="bg-[#F8F9FA] p-2.5 rounded-xl border border-gray-100 flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce" />
                <span className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce [animation-delay:0.2s]" />
                <span className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce [animation-delay:0.4s]" />
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Suggestion Chips */}
        <div className="px-3.5 py-1.5 bg-gray-50/80 border-t border-gray-100 flex items-center gap-1.5 overflow-x-auto">
          <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider shrink-0">
            Exemples :
          </span>
          {SUGGESTIONS.map((s, idx) => (
            <button
              key={idx}
              onClick={() => handleSendMessage(s)}
              className="text-[11px] bg-white hover:bg-[#FFF9E6] hover:border-[#F5C200] text-gray-700 px-2.5 py-0.5 rounded-full border border-gray-200 whitespace-nowrap transition-colors shrink-0"
            >
              {s}
            </button>
          ))}
        </div>

        {/* Input Bar */}
        <div className="p-3 border-t border-gray-200 bg-white">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleSendMessage();
            }}
            className="flex items-center gap-2"
          >
            <input
              type="text"
              value={inputQuery}
              onChange={(e) => setInputQuery(e.target.value)}
              placeholder="Posez une question sur vos calculs, frais ou transactions..."
              className="flex-1 px-3.5 py-2 text-xs sm:text-sm bg-[#F5F6F9] border border-transparent focus:border-[#F5C200] focus:bg-white rounded-xl text-gray-900 placeholder-gray-400 outline-none transition-all"
            />
            <button
              type="submit"
              disabled={!inputQuery.trim() || isTyping}
              className="p-2.5 bg-[#F5C200] hover:bg-[#E5B500] text-[#0f172a] rounded-xl font-bold shadow-sm disabled:opacity-50 disabled:cursor-not-allowed transition-all"
            >
              <Send className="w-4 h-4" />
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

export default function AssistantPage() {
  return (
    <ToastProvider>
      <AppLayout>
        <AssistantContent />
      </AppLayout>
    </ToastProvider>
  );
}
