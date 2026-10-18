# Lecons Bitnob (observees en sandbox ; "non confirme" = a verifier)

## Authentification
- Base https://api.bitnob.com. L'environnement (sandbox ou production) depend des cles : GET /api/whoami l'indique.
- En-tetes : X-Auth-Client, X-Auth-Timestamp (secondes), X-Auth-Nonce (16 octets en hex), X-Auth-Signature.
- Signature = HMAC-SHA256 en hex, cle = client secret, message = CLIENT_ID:TIMESTAMP:NONCE:CORPS.
- GET : corps vide. On signe EXACTEMENT la chaine JSON envoyee.

## Factures Lightning
- Il faut un customer_id (POST /api/customers) avant de creer une facture.
- POST /api/lightning/invoices { customer_id, amount (sats), description, expiry (s), reference }.
- La reponse est sous data : id, request (BOLT11), payment_hash, amount_sat (CHAINE), status, expires_at. Pas de champ "invoice".
- expires_at : ISO a la creation, timestamp Unix (chaine) a la lecture.
- GET /api/lightning/invoices/:id : statut observe "pending". Valeur "paye" non confirme.
- La reponse de lecture contient preimage : ne JAMAIS l'envoyer au client ni la logger.
- Sandbox = testnet : factures "lntb...", illisibles par les portefeuilles du reseau principal. En production : "lnbc...".
- Payer une facture est indisponible sur notre compte ("Lightning withdrawals feature is currently not available").

## Webhooks
- Corps : { data, event, event_id }. En-tetes : x-bitnob-signature, x-bitnob-event-id.
- Le content-type est parfois double ("application/json, application/json") : le parseur JSON d'Express le rejette.
  Solution FastAPI : lire `await request.body()` (corps brut) sans modele Pydantic sur la route webhook.
- Repondre 200 vite ; dedoublonner par event_id ; ne crediter que sur webhook, jamais sur le front.
- Evenements attendus : transfer.success (Lightning), deposit.success (on-chain). Jamais vus sur un vrai paiement.
- Retrouver la facture via data.reference : non confirme.
- httpx : signer et envoyer les MEMES octets (content=, pas json=) ; JSON compact : separators=(',', ':').
- Algorithme exact de x-bitnob-signature : non confirme (main.py teste plusieurs formats et logge le bon).
- webhook.test : livre en 200 via un tunnel (cloudflared). L'adresse du tunnel change a chaque redemarrage.

## Trading et payouts (squelette settlement.py)
- Trading : POST /api/trading/quotes puis POST /api/trading/orders (base_currency, quote_currency, side, quantity en BTC,
  quote_id, reference). Les reponses reelles n'ont jamais ete vues : elles sont loggees.
- Payouts : devis, initialize, finalize. Statuts : QUOTE, INITIATED, PENDING, COMPLETED ou FAILED.
  Le devis expire vite. finalize = debit irreversible et exige un solde (CONFIRM_PAYOUT=true pour l'autoriser).
- Senegal (SN) : exigences pays observees dans la reponse fournie le 2026-10-18T12:04:07.095278505Z ; les banques ont ete relues le 2026-10-18T14:09:07.589177857Z.
- Extrait brut pertinent des exigences SN :
```json
{
  "success": true,
  "message": "Country requirements retrieved successfully",
  "data": {
    "code": "SN",
    "name": "Senegal",
    "dial_code": "221",
    "destination_types": {
      "mobile_money": {
        "fields": [
          {"key": "account_name", "required": true},
          {"key": "account_number", "required": true, "pattern": "^(\\+?221[7]\\d{8}|[7]\\d{8})$"},
          {"key": "network", "required": true, "options": [
            {"label": "Orange", "value": "orange"},
            {"label": "Free", "value": "free"},
            {"label": "Expresso", "value": "expresso"},
            {"label": "Wave", "value": "wave"}
          ]},
          {"key": "sender", "required": true}
        ],
        "banks": [],
        "limits": {"min_amount": "100", "max_amount": "200000", "currency": "XOF"}
      },
      "swift": {
        "label": "International Wire (SWIFT)",
        "limits": {"min_amount": "1", "max_amount": "2000000", "currency": "USD"}
      }
    }
  },
  "timestamp": "2026-10-18T12:04:07.095278505Z"
}
```
- Reponse brute `GET /payouts/banks/SN` : `{"success":true,"message":"Banks retrieved successfully","data":{"banks":null,"country_code":"SN","country_name":"Senegal","total":0},"timestamp":"2026-10-18T14:09:07.589177857Z"}`.
- Le sens de `network` par rapport a `Beneficiary.bank_code` n'est pas confirme ; ne pas envoyer les valeurs Orange/Free/Expresso/Wave comme `bank_code` sans preuve.

## Limites de la sandbox
- Soldes a 0 (BTC, USDT, USDC). Pas de moyen connu de financer le BTC.
- Comptes virtuels : NGN seulement, exige BVN, date de naissance et telephone nigerian.

## Environnement de dev
- Windows + PowerShell. Dans PowerShell, curl est un alias : utiliser Invoke-RestMethod ou curl.exe.
- Port deja pris (EADDRINUSE) : un ancien processus node tourne encore.
- uvicorn --reload ne surveille pas .env : relancer a la main apres modification.
- Fichiers en fins de ligne Windows (CRLF) : les remplacements multi-lignes echouent si on l'ignore.
- Windows : lancer Python via .venv\Scripts\python.exe (evite le blocage d'activation des scripts PowerShell).
- Apres chaque modification : python -m py_compile <fichier>.
