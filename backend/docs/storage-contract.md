# Contrat de stockage PostgreSQL

Le backend dépend de l'interface `BatchRepository` (`app/repo/base.py`).
Quand `DATABASE_URL` est renseignée, `SupabaseRepo` utilise PostgreSQL via psycopg asynchrone ;
sans cette variable, `MemoryRepo` est utilisé pour les tests et le développement local.
Le schéma doit avoir été migré avec `db/scripts/migrate.py` avant de démarrer le backend.

## Méthodes (toutes `async`)
| Méthode | Comportement |
|---|---|
| `create_batch(batch, payouts)` | Insère le lot, les bénéficiaires et les lignes de paiement dans une transaction |
| `get_batch(id)` / `list_batches()` | `list_batches` : plus récent d'abord |
| `save_batch(batch)` | Met à jour le statut et les dates du lot |
| `get_payout(id)` / `list_payouts(batch_id=None)` | Triés par `line` ; sans `batch_id` = tous |
| `save_payout(payout)` | Enregistre les identifiants et la réponse de cotation de la tentative courante |
| `start_payout_attempt(payout_id)` | Appelle la fonction SQL `start_payout_attempt()` et renvoie la référence d'essai |
| `apply_payout_status(payout, origin, event_id)` | Appelle `apply_payout_event()` ; la réussite n'est acceptée que depuis un webhook |
| `find_payout(reference=..., bitnob_payout_id=...)` | Retrouve une ligne à partir de sa référence de ligne/essai ou de l'identifiant Bitnob |
| `register_webhook_event(...)` | Insère l'événement une fois dans `webhook_events` |
| `finish_webhook_event(event_id)` | Renseigne `processed_at` après traitement |

## Correspondance avec PostgreSQL

`Batch` est stocké dans `batches`, les coordonnées bénéficiaires dans `beneficiaries`,
la ligne du paiement dans `payouts`, et chaque tentative dans `payout_attempts`.
Les montants décimaux du backend sont convertis en unités minimales entières via l'exposant
de `currencies`. Les références d'essai et les statuts finaux sont gérés par les fonctions
et déclencheurs SQL de la migration v3, pas par un upsert de la ligne métier.
La réponse Bitnob de cotation est conservée en JSON ; `source_minor` et `fee_source_minor`
restent NULL tant que les unités exactes de ces champs n'ont pas été confirmées.

L'API actuelle utilise un seul `X-API-Key` partagé. Pour satisfaire `owner_id`, le repository
exige exactement un utilisateur `admin` actif dans `users` ; il échoue explicitement si
aucun ou plusieurs administrateurs sont actifs. Une future authentification multi-utilisateur
devra fournir l'identité du propriétaire au repository.

## Entité `Batch`
| Champ | Type | Notes |
|---|---|---|
| id | uuid (texte) | généré par le backend |
| name | texte | |
| status | texte | DRAFT, VALIDATED, RUNNING, COMPLETED, PARTIAL, FAILED, CANCELLED |
| from_asset | texte | BTC, USDT ou USDC |
| payment_reason | texte | |
| created_at, updated_at | timestamptz | |
| executed_at | timestamptz, nullable | |

## Entité `Payout`
| Champ | Type | Notes |
|---|---|---|
| id | uuid (texte) | |
| batch_id | uuid | référence vers Batch |
| line | entier | ligne du CSV |
| reference | texte, **unique** | envoyée à Bitnob, sert à relier les webhooks |
| attempts | entier | nombre de relances |
| name, account_number | texte | |
| bank_code | texte, nullable | |
| destination_type | texte | bank, mobile_money, swift |
| country | texte (2) | ISO alpha-2 |
| amount | **numeric** | montant reçu (précision : 20,8) |
| currency | texte (3) | |
| status | texte | PENDING, QUOTED, INITIATED, SUBMITTED, PROCESSING, SUCCESS, FAILED, EXPIRED, UNCERTAIN |
| quote_id, bitnob_payout_id | texte, nullable | `bitnob_payout_id` à indexer |
| quote | json, nullable | réponse brute de Bitnob |
| fee | numeric, nullable | |
| error, error_stage | texte, nullable | stage restitué depuis `failure_reason` lorsque disponible |
| created_at, updated_at | timestamptz | |
| completed_at | timestamptz, nullable | |

Index utiles : `payouts(batch_id)`, `payouts(reference)` unique, `payouts(bitnob_payout_id)`, `payouts(status)`, `payouts(created_at)`.

## Hors périmètre de cette intégration

Les routes de factures ne lisent/écrivent pas encore la table `invoices`. Les enveloppes,
alertes et clients KYC restent dans `app/services/envelopes.py` et ne sont pas persistés.
Leur intégration nécessite un contrat d'échange complémentaire, notamment pour les champs
client requis par `invoices` et pour l'événement Bitnob qui confirme une facture payée ;
ces valeurs ne sont pas déduites ici.

## Vues pour le tableau de bord et l'assistant IA
`GET /dashboard/summary` est aujourd'hui calculé en Python (`app/services/dashboard.py`).
Les vues SQL peuvent produire exactement le même JSON ; le format de réponse ne change pas.
