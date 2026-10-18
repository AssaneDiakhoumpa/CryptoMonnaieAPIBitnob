# Nom du projet : A completer

> Description : A completer

**Equipe :** A completer  
**Hackathon :** Code & Chain Dakar (live  Bitnob v2)

---

## Architecture

```text
[Navigateur / Client Web]
         |
         | 1. Creer facture / Consulter statut / Payer demo
         v
  [Next.js Frontend] -----> [FastAPI Backend] ---> [API Bitnob v2 (Sandbox)]
   (Port 3000)         (Port 8000)  Appel signe      (Lightning API)
         ^                 (HMAC-SHA256)
         |
         +-------------------------------- [Bitnob Webhooks]
                    3. Notification POST
                       (Signature & event dedup)
```

### Flux des donnees
1. **Creation facture :** Le navigateur appelle `POST /api/pay/create-invoice`, le backend signe et appelle Bitnob pour generer une facture Lightning (BOLT11) et un QR code.
2. **Paiement et Webhook :** Lors d'un reglement (ou via webhook test/tunnel), Bitnob notifie `POST /webhooks/bitnob`. Le backend valide la signature HMAC, dedoublonne par `event_id` et met a jour l'etat de la facture.
3. **Suivi :** Le front interroge `GET /api/pay/status/{id}` jusqu'a confirmation du paiement.

---

## Installation et lancement (PowerShell Windows)

Depuis la racine du dépôt, créez l'environnement backend, installez les dépendances, puis installez celles du Front :

```powershell
py -m venv backend\.venv
backend\.venv\Scripts\python.exe -m pip install -r backend\requirements.txt
Push-Location Front
npm ci
Pop-Location
```

Lancez `.\start-dev.ps1`. Au premier démarrage, le script crée les fichiers locaux `.env` et `.env.local` depuis leurs exemples puis s'arrête pour vous laisser les configurer. `BACKEND_API_URL` doit viser `http://localhost:8000`. Remplacez le placeholder `APP_API_KEY` dans les deux fichiers par la même clé, puis relancez le script.

- Interface web Next.js : [http://localhost:3000](http://localhost:3000)
- API FastAPI et documentation OpenAPI : [http://localhost:8000/docs](http://localhost:8000/docs)

---

## Contrat d'API (Routes)

Conforme a [CONTRACT.md](file:///c:/Users/amath/Documents/hackathon-bitnob/hackathon-bitnob-py/CONTRACT.md) et [docs/api-contract.md](file:///c:/Users/amath/Documents/hackathon-bitnob/hackathon-bitnob-py/docs/api-contract.md) :

| Methode | Route | Corps | Reponse attendue |
|---|---|---|---|
| `POST` | `/api/pay/create-invoice` | `{ "satoshis": 1000, "description": "...", "customerName": "..." }` | `{ "id", "reference", "paymentRequest", "amountSat", "status", "expiresAt", "qrCodeUrl" }` |
| `GET` | `/api/pay/status/{id}` | *(aucun)* | `{ "id", "status", "paid", "amountSat", "demo" }` |
| `POST` | `/api/pay/demo-pay/{id}` | *(aucun)* | `{ "id", "status", "paid", "demo", "amountSat" }` *(uniquement si DEMO_MODE=true)* |
| `POST` | `/api/settle/{id}` | `{ "xofAmount": 5000, "beneficiary": "..." }` | `{ "ok", "timeline" }` ou `{ "already", "timeline" }` |
| `POST` | `/webhooks/bitnob` | *(corps brut Bitnob)* | `200` (FastAPI lit `await request.body()`) |
| `GET` | `/api/erp/kpis` | *(aucun)* | `{ "todayRevenueXof", "todayInvoicesCount", "totalSatsCollected", ... }` |
| `GET` | `/api/erp/invoices` | *(aucun)* | `[ { "id", "reference", "amountSat", "status", "customerName", ... } ]` |
| `POST` | `/api/ai/query` | `{ "question": "..." }` | `{ "answer", "sql", "data" }` |
| `GET` | `/health` | *(aucun)* | `{ "status": "success", "demo": true/false, "db": "connected" }` |

Toutes les erreurs renvoient le format unifie `{ "error": "message descriptif" }`.

---

## Ce qui est simule (Transparence Demo)

Le paiement de la demonstration est **simule** :
- Le bouton "Simuler le paiement" utilise la route `POST /api/pay/demo-pay/{id}` pour faire basculer la facture locale au statut `paid`.
- En sandbox Bitnob, les retraits/paiements Lightning sortants ne sont pas approvisionnes ("Lightning withdrawals feature is currently not available").
- Cette simulation permet de demontrer l'integralite du flux frontend/backend de maniere fluide et honnete pendant le hackathon.

---

## Securite

- **Secrets :** Ne jamais commiter `.env`. Le fichier `.gitignore` bloque strictement `.env`, `.venv/` et `PROGRESS.md`.
- **Mode Demo :** Definir `DEMO_MODE=false` hors demonstration pour desactiver les routes de simulation de paiement.
- **Verification de signature :** Les requetes sortantes vers Bitnob sont signees par HMAC-SHA256 (`CLIENT_ID:TIMESTAMP:NONCE:BODY`).
- **Donnees sensibles :** La `preimage` d'une facture ne doit jamais etre retournee au frontend ni loggee.
