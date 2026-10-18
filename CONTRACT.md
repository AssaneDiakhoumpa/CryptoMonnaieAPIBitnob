# Contrat de l'equipe (toute modification = on previent le groupe)

## Proprietaires des fichiers (Repartition P1 a P5)
| Fichier / Dossier | Role | Proprietaire |
|---|---|---|
| `backend/app/` | API FastAPI, Client Bitnob, Routes paiements, services | **P1** |
| `db/` | Modeles SQLAlchemy, vues SQL (v_kpis), seed.py, database | **P2** |
| `ai/` | Agent Text-to-SQL, securite sql_guard, router IA | **P3** |
| `frontend/src/components/PosCheckout.jsx` | Caisse enregistreuse, QR Lightning, modal paiement | **P4** |
| `frontend/src/components/` (Dashboard, AiAssistant) | Tableaux de bord KPIs, chat assistant IA | **P5** |

## Variables d'environnement (noms exacts, lues UNIQUEMENT dans config.py)
BITNOB_CLIENT_ID, BITNOB_CLIENT_SECRET, BITNOB_BASE_URL, BITNOB_CUSTOMER_ID,
BITNOB_WEBHOOK_SECRET, DEMO_MODE, CONFIRM_PAYOUT, PORT, DATABASE_URL, GEMINI_API_KEY,
BACKEND_API_URL, APP_API_KEY

`BACKEND_API_URL` est lu uniquement par le serveur Next.js et désigne l'URL racine
accessible de FastAPI (sans suffixe de route). `APP_API_KEY` doit avoir la même valeur
côté serveur Next.js et côté FastAPI ; elle est envoyée uniquement dans `X-API-Key`.
Ne jamais exposer cette clé dans une variable `NEXT_PUBLIC_*`, le navigateur, le code
source ou les journaux.

## Routes
| Route | Corps | Reponse |
|---|---|---|
| POST /api/pay/create-invoice | { satoshis, description, customerName? } | { id, reference, paymentRequest, amountSat, status, expiresAt, qrCodeUrl } |
| GET /api/pay/status/{id} | | { id, status, paid, amountSat, demo? } |
| POST /api/pay/demo-pay/{id} | | { id, status, paid, demo, amountSat } (seulement si DEMO_MODE=true) |
| POST /api/settle/{id} | { xofAmount, beneficiary } | { ok, timeline } ou { already, timeline } |
| POST /webhooks/bitnob | corps brut Bitnob | 200 |
| GET /api/erp/kpis | | { todayRevenueXof, todayInvoicesCount, totalSatsCollected, ... } |
| GET /api/erp/invoices | | [ { id, reference, amountSat, status, description, createdAt } ] |
| POST /api/ai/query | { question } | { answer, sql, data } |
| GET /health | | { status, demo, db } |

Erreurs : toujours { "error": "message" } ; donnees invalides = 400.

### Routes FastAPI effectivement exposées

Les routes ci-dessous sont celles montées par `backend/app/main.py`. Elles utilisent
`X-API-Key`, sauf `/health` et `POST /webhooks/bitnob`. Les corps de ces routes sont
en `snake_case`, tels que définis par les schémas Python.

| Méthode et route | Corps / paramètres | Réponse et usage |
|---|---|---|
| GET `/health` | — | `{ status, mode, demo, db }` ; sonde de disponibilité |
| GET `/balances` | — | Objet Bitnob `data` contenant les soldes |
| GET `/whoami` | — | Objet Bitnob `data` du compte |
| GET `/payouts/countries` | — | Pays disponibles chez Bitnob |
| GET `/payouts/countries/{country}` | `country` ISO-2 | Détails et rails disponibles |
| GET `/payouts/banks/{country}` | `country` ISO-2 | Banques/opérateurs disponibles |
| POST `/payout/quote` | `QuoteIn` : `amount` ou `settlement_amount`, `country`, `from_asset`, `to_currency`, `source`, `chain?`, `reference?` | Devis Bitnob (`quote_id`, montant, devise, frais et expiration selon disponibilité Bitnob) |
| POST `/payout` | `{ quote: QuoteIn, beneficiary: Beneficiary, payment_reason?, reference? }` ; `Beneficiary`: `destination_type`, `country`, `account_name`, `account_number`, `bank_code?` | `{ quote, initialized, finalized }` ; exécute les trois étapes, dont le débit irréversible |
| GET `/payout/{payout_id}` | — | Statut du payout Bitnob |
| POST `/invoices` | `{ amount_sat, description, expiry_seconds?, customer_id?, reference? }` | Réponse Bitnob Lightning et `qr_svg_data_uri`, `qr_png_data_uri` |
| GET `/invoices` | `status?`, `direction?`, `page?`, `page_size?` | Liste Bitnob Lightning |
| GET `/invoices/{invoice_id}` | — | Facture Lightning ; les réponses publiques doivent exclure `preimage` |
| POST `/invoices/{invoice_id}/simulate-paid` | — | Facture payée, seulement en mode simulé |
| GET `/batches` | — | Lots du compte |
| POST `/batches` | CSV multipart : `file`, `name?`, `from_asset?`, `payment_reason?`, `default_destination_type?`, `strict?`, `allow_duplicates?` | Récapitulatif du lot et lignes rejetées |
| POST `/batches/manual` | `{ name?, from_asset?, payment_reason?, strict?, allow_duplicates?, beneficiaries[] }` ; lignes : `name`, `account_number`, `bank_code?`, `destination_type?`, `country`, `amount`, `currency` | Même récapitulatif que `/batches` |
| GET `/batches/{batch_id}` | — | Lot et `payouts` |
| POST `/batches/{batch_id}/execute` | — | `{ batch_id, status }` ; exécution asynchrone |
| POST `/batches/{batch_id}/retry` | — | `{ batch_id, retried }` |
| POST `/batches/{batch_id}/refresh` | — | Statuts actualisés depuis Bitnob |
| GET `/batches/{batch_id}/report.csv` | — | Rapport CSV |
| GET `/dashboard/summary` | — | Agrégats `totals`, `volume_by_currency`, `by_country`, `by_day`, `recent_batches`, `envelopes` |
| POST `/cards/kyc` | `CardKycIn` : `customer`, `id_type`, `id_number` et champs KYC documentés dans `backend/app/schemas.py` (`id_front_image` base64 requis sauf `bvn` / `nin`) | Réponse KYC Bitnob ; le statut final arrive de façon asynchrone |
| GET `/cards/kyc/customers` | — | Statuts KYC en mémoire : `pending`, `approved`, `rejected` (webhooks `virtualcard.user.kyc.pending`, `.complete`, `.failed`) |
| GET `/cards` | `status?`, `search?`, `cursor?`, `limit?` | Cartes Bitnob |
| GET `/cards/{card_id}` | — | Carte Bitnob |
| POST `/cards/{card_id}/simulate/{event_type}` | `event_type`: `authorization`, `settlement`, `reversal` ou `decline`; `amount_usd?` | Simulation de carte |
| POST `/envelopes` | `{ name, monthly_budget_usd, customer_id?, cardholder_name?, card_brand?, enforce_monthly_limit? }` ; `card_brand`: `visa` ou `mastercard` | `{ card_id, name, status, provisioning, last4, balance_usd, monthly_budget_usd, spent_usd }`, numéro complet non retourné |
| GET `/envelopes` | — | Enveloppes au même format masqué |
| GET `/envelopes/{card_id}` | — | Enveloppe |
| GET `/envelopes/{card_id}/transactions` | — | Transactions de carte |
| POST `/envelopes/{card_id}/recharge` | — | Recharge demandée |
| POST `/envelopes/{card_id}/freeze` / `/unfreeze` | — | Gèle / réactive la carte |
| GET `/alerts` | — | Alertes en mémoire |
| POST `/mock/credit` | `{ currency, amount }` | Crédite un solde simulé uniquement |
| POST `/mock/reset` | — | Réinitialise les données simulées |

`POST /api/ai/query` est décrit plus haut mais n'est pas actuellement monté par
`backend/app/main.py`; il ne doit être consommé qu'après activation explicite du routeur
IA et vérification de sa disponibilité de base de données.

### Adaptateurs Next.js internes

Le navigateur appelle le serveur Next.js sur les routes déjà présentes dans `Front/app/api`.
Celles-ci relaieront les opérations métier aux routes FastAPI ci-dessus. Le serveur Next.js
lit `BACKEND_API_URL` et `APP_API_KEY`, ajoute `X-API-Key` et ne transmet jamais la clé au
navigateur. Les réponses d'erreur des adaptateurs sont `{ "error": "message" }`.

| Route Next.js | Adaptation vers FastAPI |
|---|---|
| `/api/invoices` | `POST /invoices` et `GET /invoices` ; montant Lightning en satoshis |
| `/api/invoices/{id}` | `GET /invoices/{id}` |
| `/api/invoices/{id}/demo-pay` | `POST /invoices/{id}/simulate-paid` |
| `/api/transfers` | `GET ?resource=countries` ou `?resource=banks&country=...` retourne les réponses Bitnob brutes ; `POST { action: "quote" | "send", amountSent, currencySent, country, currencyReceived, recipientName, accountNumber, bankCode, method, paymentReason }` |
| `/api/bulk-payout` | CSV multipart vers `/batches` ; `POST` JSON avec `action: "prepare" | "confirm" | "retry" | "refresh"` et `batchId` lorsque requis ; correspond à `/batches/manual`, l'exécution, la relance et l'actualisation Bitnob ; `GET` pour consultation et `GET ?action=report&batchId=...` |
| `/api/cards/kyc` | `POST /cards/kyc` ; champs KYC et valeurs `id_type` tels que définis dans `backend/app/schemas.py`, image `id_front_image` en base64 sauf `bvn` / `nin` |
| `/api/cards/kyc` (GET) | `GET /cards/kyc/customers` |
| `/api/cards` | `GET /envelopes` et `POST /envelopes` |
| `/api/cards/{id}/status` | `POST /envelopes/{id}/freeze` ou `/unfreeze` |
| `/api/cards/{id}/transactions` | `GET /envelopes/{id}/transactions` |
| `/api/dashboard` | `GET /dashboard/summary` et `GET /balances` |
| `/api/assistant` | Aucun raccordement au routeur SQL tant que celui-ci n'est pas activé et validé |
| `/api/webhooks/bitnob` | Relais du corps brut et des en-têtes vers `POST /webhooks/bitnob` |

Le backend actuel ne persiste pas les factures, les enveloppes, les alertes ou les clients KYC.
Ces ressources restent en mémoire et peuvent disparaître au redémarrage. Les devis de payout
et leur taux Bitnob, pas un taux de change codé en dur, font foi. Une facture Lightning exige
un montant en satoshis ; aucun taux USD/BTC n'est défini par ce contrat.

### Statuts utilisés par l'intégration

- Payout : `PENDING`, `QUOTED`, `INITIATED`, `SUBMITTED`, `PROCESSING`, `SUCCESS`, `FAILED`, `EXPIRED`, `UNCERTAIN`.
- Lot : `DRAFT`, `VALIDATED`, `RUNNING`, `COMPLETED`, `PARTIAL`, `FAILED`, `CANCELLED`.
- KYC carte : `pending`, `approved`, `rejected` (émis par le traitement des webhooks `virtualcard.user.kyc.pending`, `.complete`, `.failed`).
- Carte : les commandes de statut utilisent `active` et `frozen`; l'API publique ne renvoie que les champs masqués de l'enveloppe. Tout statut non reconnu côté interface est affiché comme inconnu, sans commande de changement.

Les réponses des routes Bitnob `/payouts/countries` et `/payouts/banks/{country}` sont
documentées à partir des données disponibles dans `LECONS.md`; les formats d'autres pays
restent à vérifier. Les noms d'opérateur affichés dans les anciens écrans ne sont pas des
`bank_code` vérifiés et ne doivent pas être transmis comme tels. La création du devis puis
l'exécution `/payout` demandent deux devis distincts : le devis présenté à l'utilisateur ne
garantit donc pas le montant ou les frais du payout final.

Observation reçue pour le Sénégal : les exigences de `mobile_money` demandent `account_name`,
`account_number`, `network` et `sender`; les valeurs de `network` sont `orange`, `free`,
`expresso` et `wave`, les limites affichées sont 100–200000 XOF. L'API des banques a répondu
`banks: null` et `total: 0`. La correspondance de `network` avec `Beneficiary.bank_code`
n'étant pas confirmée, l'interface continue d'afficher le référentiel brut et ne transforme
pas ces valeurs en code de payout.

## Objet facture (camelCase dans notre API JSON, snake_case dans le code Python)
id, reference, paymentRequest, amountSat (nombre), status ("pending" | "paid"), paid (booleen)

## Conventions de nommage
- JSON de notre API : camelCase (amountSat, paymentRequest).
- Corps envoyes a Bitnob : snake_case comme dans leur documentation (customer_id, amount, payment_reason).
- Python : snake_case pour variables et fonctions. Statuts et evenements : uniquement ceux de constants.py.

## Fonctions partagees
- bitnob(method, path, body) -> dict (async) ; leve BitnobError avec .status et .body
- convert_sats_to_usdt(sats, ref) ; payout_to_mobile_money(xof_amount, beneficiary, reason, ref) (async)
