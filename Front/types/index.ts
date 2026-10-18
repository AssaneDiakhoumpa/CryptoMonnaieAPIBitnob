export type CryptoAsset = "BTC" | "USDT" | "USDC";
export type FiatCurrency = "USD" | "EUR" | "XOF";
export type AllCurrency = CryptoAsset | FiatCurrency;

export type InvoiceStatus = "draft" | "pending" | "paid" | "expired" | "failed";

export interface Invoice {
  id: string;
  invoiceNumber: string;
  clientName: string;
  description: string;
  amount: number;
  currency: FiatCurrency | CryptoAsset;
  acceptedCryptos: CryptoAsset[];
  dueDate?: string;
  notes?: string;
  status: InvoiceStatus;
  createdAt: string;
  shareableUrl: string;
  paymentAddress?: {
    BTC?: string;
    USDT?: string;
    USDC?: string;
  };
  paidAmount?: number;
  paidCurrency?: CryptoAsset;
}

export type TransactionStatus = "confirmed" | "pending" | "failed";
export type TransactionType = "payment_received" | "transfer_sent" | "card_spend" | "crypto_deposit";

export interface Transaction {
  id: string;
  client: string;
  type: string;
  rawType: TransactionType;
  amount: number;
  currency: string;
  status: TransactionStatus;
  date: string;
  txHash?: string;
  network?: string;
  fee?: number;
}

export type TransferStatus = "completed" | "processing" | "failed";
export type TransferMethod = "mobile_money" | "bank_account" | "cash_pickup";

export interface Transfer {
  id: string;
  recipientName: string;
  recipientCountry: string;
  countryCode: string;
  method: TransferMethod;
  operator: string;
  phoneNumber?: string;
  accountNumber?: string;
  amountSent: number;
  currencySent: CryptoAsset | FiatCurrency;
  amountReceived: number | null;
  currencyReceived: string;
  fee: number | null;
  exchangeRate: number | null;
  status: TransferStatus;
  date: string;
  estimatedDelivery: string;
  notes?: string;
}

export interface VirtualCard {
  id: string;
  cardNumber?: string;
  maskedNumber: string;
  last4: string;
  cardHolder: string;
  expiryDate?: string;
  cvv?: string;
  brand: "mastercard" | "visa" | "unknown";
  cardType: "virtual" | "physical";
  status: "active" | "frozen" | "cancelled" | "unknown";
  balance: number;
  monthlyLimit: number;
  spentThisMonth: number;
  theme: "yellow" | "black" | "silver";
}

export interface CardExpense {
  id: string;
  merchant: string;
  category: string;
  amount: number;
  currency: string;
  cardLast4: string;
  date: string;
  status: "completed" | "pending";
}

export interface AssistantMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: string;
  actionSuggestions?: string[];
  computationResult?: {
    type: "fee_calc" | "fx_rate" | "tx_lookup";
    details: Record<string, string | number>;
  };
}

export type BulkBatchStatus = "draft" | "validated" | "processing" | "completed" | "partial" | "failed";
export type BulkItemStatus = "valid" | "invalid" | "pending" | "processing" | "completed" | "failed" | "uncertain";

export interface BulkRecipientItem {
  id: string;
  rowIndex: number;
  name: string;
  phoneOrAccount: string;
  country: string; // 'SN' | 'NG' | 'GH' | 'CI'
  currency: string; // 'XOF' | 'NGN' | 'GHS'
  amount: number; // in local fiat
  amountUSDT?: number;
  operator: string;
  status: BulkItemStatus;
  errorMessage?: string;
  txReference?: string;
}

export interface BulkBatch {
  id: string;
  title: string;
  description: string;
  totalRecipients: number;
  validCount: number;
  invalidCount: number;
  totalAmountLocal: Record<string, number>; // e.g. { XOF: 1500000, NGN: 850000, GHS: 12000 }
  totalAmountUSDT: number;
  estimatedFeesUSDT: number;
  status: BulkBatchStatus;
  createdAt: string;
  completedAt?: string;
  items: BulkRecipientItem[];
}
