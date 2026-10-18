# Bitnob Backend Kit (FastAPI) – v0.3

## Démarrage
```bash
cp .env.example .env      # CLIENT_ID / CLIENT_SECRET, PUBLIC_BASE_URL (ngrok)
docker compose up --build
# Swagger : http://localhost:8000/docs  (bouton Authorize : X-API-Key)
```
Tests hors-ligne (API Bitnob simulée) : `pip install -r requirements-dev.txt && pytest`

## Architecture
```
app/
├── main.py  config.py  deps.py  schemas.py
├── bitnob/            # INTÉGRATION : parle à Bitnob
│   ├── client.py      #   HTTP + signature HMAC
│   ├── payouts.py     #   quote -> initialize -> finalize
│   ├── cards.py       #   KYC, création, recharge, gel, transactions
│   ├── lightning.py   #   factures Bitcoin
│   └── units.py       #   USD <-> micro-unités (1 USD = 1 000 000)
├── domain.py          # entités Batch / Payout (indépendantes du stockage)
├── repo/              # STOCKAGE : base.py (interface), memory.py, supabase.py (à faire par la DB)
├── services/
│   ├── bulk.py        # MÉTIER : import, exécution, relance, statuts, webhooks payouts
│   ├── csv_import.py  # lecture + validation du CSV
│   ├── dashboard.py   # KPIs
│   └── envelopes.py   # MÉTIER : alertes, gel auto, vue publique (mémoire pour l'instant)
└── routers/           # API exposée
    ├── bitnob_proxy.py  # /whoami /balances /payouts/* /payout*
    ├── batches.py       # /batches/* (paiements de masse)
    ├── dashboard.py     # /dashboard/summary
    ├── cards.py         # /cards/*
    ├── envelopes.py     # /envelopes/* /alerts
    ├── invoices.py      # /invoices/*
    └── webhooks.py      # /webhooks/bitnob
```

## Mode simulé (sans Bitnob, sans wallet crédité)
```bash
# .env : BITNOB_MOCK=true   (aucun identifiant nécessaire)
docker compose up --build
curl localhost:8000/health        # {"status":"ok","mode":"mock"}
```
Tout le backend répond comme Bitnob : paiements de masse, cartes, KYC, factures Lightning, et les **webhooks sont envoyés par le faux Bitnob lui-même** (les statuts avancent seuls, toutes les `MOCK_DELAY_SECONDS`).
Passer au vrai Bitnob = `BITNOB_MOCK=false` + vos identifiants, rien d'autre à changer.

**Comptes de démonstration** (derniers chiffres du `account_number`) :
| Fin du numéro | Résultat |
|---|---|
| `0000` | paiement refusé : `FAILED` |
| `9999` | paiement expiré : `EXPIRED` (fonds recrédités) |
| `5000` | erreur 500 et webhook perdu : `UNCERTAIN`, puis `POST /batches/{id}/refresh` → `SUCCESS` |
| autre | succès |

**Outils du mode simulé :** `GET /mock/state`, `POST /mock/credit {"currency":"USDC","amount":500}` (le « faucet » qui manque au sandbox), `POST /mock/reset` (tout remettre à zéro avant une démo), `POST /invoices/{id}/simulate-paid`, `POST /cards/{id}/simulate/settlement?amount_usd=25`.
Frontend : afficher un bandeau « MODE SIMULÉ » quand `GET /health` renvoie `"mode":"mock"`.

## Persistance PostgreSQL / Supabase

Sans `DATABASE_URL`, les lots et paiements utilisent `MemoryRepo` et sont perdus au redémarrage.
Pour activer la persistance, renseigner `DATABASE_URL` dans `backend/.env` et appliquer les
migrations du dossier `db` avant de démarrer l'API. La chaîne de connexion ne doit pas être
commise. Le backend s'appuie sur les fonctions SQL de la migration v3 pour créer les tentatives
et faire évoluer les statuts ; en mode PostgreSQL, la base refuse de marquer un payout réussi à
partir d'un simple polling API.

Cette première intégration persiste les lots, bénéficiaires, paiements et webhooks. Les factures,
enveloppes, alertes et clients KYC ne sont pas encore persistés.

Comme l'API actuelle utilise une clé partagée et non une identité utilisateur, la base doit
contenir exactement un administrateur actif dans `users`. La route `/health` inclut `db: true`
quand la connexion configurée répond, et `db: false` sinon ou en mode mémoire.

## Documentation pour l'équipe
- `docs/api-contract.md` : tous les endpoints (frontend, IA)
- `docs/storage-contract.md` : contrat de stockage PostgreSQL
- `docs/example_beneficiaries.csv` : fichier d'exemple

## Endpoints cartes et factures
| Route | Rôle |
|---|---|
| POST `/cards/kyc` | Vérifie le titulaire (asynchrone) |
| GET `/cards/kyc/customers` | Statut KYC des clients (maj par webhook) |
| GET `/cards`, `/cards/{id}` | Cartes brutes Bitnob |
| POST `/cards/{id}/simulate/{authorization\|settlement\|reversal\|decline}` | SANDBOX : fausse dépense |
| POST `/envelopes` | Crée une enveloppe = une carte financée au budget |
| GET `/envelopes`, `/envelopes/{id}` | Nom, solde restant, dépensé, 4 derniers chiffres (jamais le PAN) |
| GET `/envelopes/{id}/transactions` | Dépenses de l'enveloppe |
| POST `/envelopes/{id}/recharge`, `/envelopes/recharge-all` | Remonte au budget (recharge mensuelle) |
| POST `/envelopes/{id}/freeze`, `/unfreeze` | Gel manuel |
| GET `/alerts` | Alertes (solde bas, carte gelée, refus) |
| POST `/invoices` | Facture Lightning + QR (SVG et PNG en data URI) |
| GET `/invoices/{id}`, `/invoices/{id}/qr.svg` | Statut (paid = payée) et image QR |

## Parcours de test en sandbox
1. `GET /whoami`
2. `POST /cards/kyc` -> récupérer `customer_id` (attendre l'approbation) -> le mettre dans `DEFAULT_CARD_CUSTOMER_ID`
3. `POST /envelopes` `{"name":"Meta Ads","monthly_budget_usd":"30"}`
4. `GET /envelopes/{card_id}` jusqu'à `provisioning = completed`
5. `POST /cards/{card_id}/simulate/settlement` -> webhook -> alerte / gel automatique
6. `POST /invoices` `{"amount_sat":1000,"description":"Test"}` -> scanner le QR

## À savoir
- Montants des cartes en micro-unités ; Lightning en satoshis (conversion déjà faite côté code pour les cartes).
- Création de carte asynchrone : `status=pending` puis `active`.
- Recharge limitée à 1 / 30 s par carte ; résiliation impossible avant 24 h.
- Facture Lightning : pas de webhook documenté, on interroge `GET /invoices/{id}`.
- Les champs de `customer` du Card KYC sont transmis tels quels : s'ils sont refusés, comparer avec le playground Bitnob.
