# Lider ⇄ Chatbot integration

For the Lider team. Everything below is live on
`https://chatbot.tural.ai/api/partner/lider`.

## The split

Lider holds the customer's money. Lider decides whether they can afford
something and deducts the balance. Chatbot never mirrors that balance —
a second copy of someone's money only creates a reconciliation problem.

So the flow is always: **Lider checks → Lider deducts → Lider tells
chatbot what to apply → chatbot applies it and reports back.**

If the chatbot call fails, Lider should refund the deduction. If it
times out, retry with the same `transactionId` (see Idempotency).

## Authentication

Every partner call carries a shared key:

```
Authorization: Bearer <LIDER_API_KEY>
```

The key is set by a chatbot admin under Admin → Payments and given to
you out of band. It is compared in constant time; a wrong key returns
`401` with `{"code":"unauthorized"}`.

## Idempotency

`POST /purchase/plan` and `POST /purchase/credits` both require
`transactionId` — Lider's own transaction id. It is stored unique.

- First call: applies the purchase, returns `applied: true`.
- Any repeat: changes nothing, returns `alreadyApplied: true`.

This is what makes retrying safe. Never generate a fresh id for a
retry — that would grant the plan twice.

## Connecting an account

A chatbot user and a Lider user have to be proven to be the same person
before anything can be bought. Neither side implements an OAuth server;
the proof is a single-use token.

1. The user clicks **Connect Lider** on the chatbot billing page.
2. Chatbot mints a token (15 minutes, single use) and redirects to the
   configured **Lider Connect URL** with:
   `?token=<token>&return_url=<where to send them back>`
3. Lider signs the user in however it normally does.
4. Lider calls, server-to-server:

```http
POST /api/partner/lider/link
Authorization: Bearer <key>
Content-Type: application/json

{ "token": "<from the query string>", "liderUserId": "12345", "liderEmail": "a@b.c" }
```

5. Chatbot binds the accounts and burns the token. Send the user back to
   `return_url`.

The token proves a specific chatbot user asked for this; the API key
proves the callback is really Lider. Neither is sufficient alone.

Errors worth handling: `token_expired`, `token_used`, `already_linked`
(that Lider account is bound to a different chatbot account).

## Endpoints

### `GET /plans`

What to show on the purchase screen. Prices live here, so Lider never
has to keep a copy in sync.

```json
{
  "success": true,
  "plans": [
    { "id": "uuid", "name": "Pro", "price": 49, "currency": "USD",
      "interval": "month", "monthlyCredits": 500000,
      "maxAgents": 5, "maxWhatsappAccounts": 3, "…": "…" }
  ],
  "credits": { "perUsd": 10000, "minimumUsd": 5 }
}
```

### `GET /account?liderUserId=12345`

Current state of a linked account — use it to show "you are on Pro,
382,140 credits left" before offering an upgrade.

Returns `404 not_linked` if the accounts were never connected.

### `POST /purchase/plan`

```json
{ "liderUserId": "12345", "planId": "uuid", "amountUsd": 49, "transactionId": "LID-88213" }
```

Sets the plan on the user and on every workspace they own, so the
paid-for features actually switch on.

```json
{ "success": true, "applied": true, "userId": "uuid",
  "plan": { "id": "uuid", "name": "Pro", "price": 49, "monthlyCredits": 500000 } }
```

### `POST /purchase/credits`

```json
{ "liderUserId": "12345", "amountUsd": 25, "transactionId": "LID-88214" }
```

Optional `workspaceId` — omit it and the credits go to the user's first
workspace, which is the right answer for the overwhelming majority who
have exactly one.

```json
{ "success": true, "applied": true, "credits": 250000, "workspaceId": "uuid" }
```

Credits are granted at `perUsd` from `GET /plans` (currently 10,000 per
USD). They do not expire at the end of the month.

## Errors

All errors are `{ "success": false, "code": "...", "message": "..." }`.

| code | status | meaning |
|---|---|---|
| `unauthorized` | 401 | missing or wrong API key |
| `not_configured` | 503 | admin hasn't set the key on the chatbot side |
| `not_linked` | 404 | no chatbot account bound to that `liderUserId` |
| `no_plan` / `plan_inactive` | 404 / 400 | bad `planId` |
| `no_workspace` | 404 | account has no workspace to credit |
| `bad_token` / `token_expired` / `token_used` | 404 / 400 | connect handshake |
| `already_linked` | 409 | that Lider account belongs to someone else here |

`message` is written to be shown to a person; `code` is what to branch
on.

## A note on referrals

A purchase made through Lider earns the referrer the same commission a
card payment would. Nothing extra to send — where the money came from
is not the referrer's concern.
