# Mercado Pago fixtures

What `MercadoPagoGatewayAdapter` is tested against (milestone 30 Task 05). Loaded as **raw text**
through `index.ts` — the adapter reads amounts from the characters of a response, so a fixture is
never re-serialised.

Two kinds of file live here, and the name says which:

- **RECORDED** — every file whose name does **not** start with `derived-`. A raw response of the
  Mercado Pago API, taken from the sandbox with a Brazilian test seller's credentials on 2026-11-26
  and 2026-11-27, then scrubbed. Nothing in it was written from documentation.
- **DERIVED** — every file whose name starts with `derived-`. Never observed. Built from a recorded
  file by changing the fields listed below, or (the deliveries) from the provider's published
  `x-signature` scheme with a secret made up for these fixtures. They exist because the test account
  could not produce the real thing; Task 16 re-records them on staging.

## How the recorded ones were obtained

Credentials were read from the environment only and never written anywhere. Payments were made by a
person in a browser, as a test buyer, on Checkout Pro links (the Payments API refuses to create a
payment with these credentials: `401`, cause code `7`); everything else is a plain API call.

| File | Call | Notes |
|---|---|---|
| `preference-created.json` | `POST /checkout/preferences` → `201` | Sent **by this adapter** (methods `card`, R$ 180,50); the spec holds the exact request body. |
| `preference-same-key-first.json`, `preference-same-key-second.json` | `POST /checkout/preferences` twice, same `X-Idempotency-Key`, same body → `201`, `201` | Two different preference ids: preferences are **not** idempotent on the key. |
| `preference-paid-card.json` | `GET /checkout/preferences/{id}` → `200` | The preference the card payment was made on (created without an expiry). |
| `preference-unknown-404.json` | `GET /checkout/preferences/{unknown id}` → `404` | |
| `preference-invalid-400.json` | `POST /checkout/preferences` with no items → `400` | |
| `payment-approved-account-money.json` | `GET /v1/payments/{id}` → `200` | Approved, paid with the buyer's Mercado Pago balance (`account_money`). |
| `payment-partially-refunded.json` | same payment after a partial refund | `status: approved`, `status_detail: partially_refunded`, one refund. |
| `payment-refunded.json` | same payment after the rest was refunded | `status: refunded`, two refunds. |
| `payment-approved-card.json` | `GET /v1/payments/{id}` → `200` | Approved, `credit_card` / `visa`, one instalment. |
| `payment-pending-boleto.json` | `GET /v1/payments/{id}` → `200` | `pending` / `pending_waiting_payment`, `ticket` / `bolbradesco`. |
| `payment-approved-foreign-reference.json` | `GET /v1/payments/{id}` → `200` | A payment on the account that no checkout of ours created (its `external_reference` is the provider's own). |
| `payment-unknown-404.json` | `GET /v1/payments/999999999999` → `404` | |
| `payment-unauthorized-401.json` | `GET /v1/payments/{id}` with a made-up token → `401` | Cause code `5`. |
| `search-by-reference-card.json`, `search-by-reference-boleto.json` | `GET /v1/payments/search?external_reference=…` → `200` | One result each. |
| `search-empty.json` | same search, a reference nobody paid → `200` | |
| `refund-partial-201.json` | `POST /v1/payments/{id}/refunds` for R$ 2,34 → `201` | |
| `refund-partial-same-key-201.json` | the same call repeated with the same `X-Idempotency-Key` → `201` | **Same refund id**: refunds are idempotent on the key. |
| `refund-rest-201.json` | `POST …/refunds` for the remaining R$ 10,00 → `201` | |
| `refund-over-balance-400.json` | `POST …/refunds` above what is left → `400` | Cause code `120013`. |
| `refund-quota-429.json` | refunds fired back to back → `429` | `refund_quota_exceeded`; a different body shape. |
| `refund-unauthorized-401.json` | `POST …/refunds` on the card payment → `401` | Cause code `7`: this test account may refund a balance payment, not a card one. |

### Scrubbing

Done by text replacement on the raw body, so key order, types and every number token are exactly as
recorded (checked: same shape, same numbers apart from the account ids below). Replaced:

- the payer's e-mail → `payer@example.invalid`; document number → zeros; payer, seller and
  application ids → `1000000001`-style placeholders (the seller id is also the prefix of a
  preference id, replaced there too); the seller's display name; the buyer's IP address;
- card data: `bin`, `first_six_digits`, `last_four_digits`, the card id, the cardholder name, the
  authorisation code, the acquirer's merchant account id;
- boleto data: barcode, digitable line, the ticket URL, the verification code;
- the provider-side idempotency key (it embeds the application id).

Amounts, dates, statuses, payment and refund ids, references and every other field are untouched.
No access token, public key or webhook secret was ever in a response.

## The derived ones

| File | Built from | What was changed |
|---|---|---|
| `derived-payment-rejected-card.json` | `payment-approved-card` | `status: rejected`, `status_detail: cc_rejected_other_reason`, `date_approved: null`, a new id and reference. |
| `derived-payment-in-process-card.json` | `payment-approved-card` | `status: in_process`, `status_detail: pending_contingency`, `date_approved: null`, a new id and reference. |
| `derived-payment-charged-back.json` | `payment-approved-card` | `status: charged_back`, `status_detail: in_process`. |
| `derived-payment-approved-pix.json` | `payment-approved-account-money` | `payment_type_id: bank_transfer`, `payment_method_id: pix` (and `payment_method`), a new id and reference. |
| `derived-payment-pending-pix.json` | the file above | `status: pending`, `status_detail: pending_waiting_transfer`, `date_approved: null`. |
| `derived-payment-cancelled-expired.json` | `payment-pending-boleto` | `status: cancelled`, `status_detail: expired`. |
| `derived-payment-refunded-single-refund.json` | `payment-refunded` | The first refund removed and the second one's amount set to the full `12.34` — a payment refunded in one go. |
| `derived-payment-usd.json` | `payment-approved-card` | `currency_id: USD` (to prove the adapter refuses it). |
| `derived-payment-three-decimals.json` | `payment-approved-card` | `transaction_amount: 12.345` (to prove the adapter never rounds). |
| `derived-search-two-payments.json` | `search-by-reference-card` | A rejected copy of the result placed before the approved one; `paging.total: 2`. |
| `derived-webhook-payment-created.json`, `derived-webhook-payment-updated.json`, `derived-webhook-merchant-order.json` | the published notification format | A whole delivery — query, `x-signature`, `x-request-id`, body — signed over `id:<data.id>;request-id:<x-request-id>;ts:<ts>;` with HMAC-SHA256 and the made-up secret `MP_FIXTURE_WEBHOOK_SECRET` of `index.ts`. |

The status and method names used in the derived payments (`rejected`, `in_process`, `charged_back`,
`cancelled` / `expired`, `bank_transfer` / `pix`) come from the provider's published lists, not from
an observation.

## What could not be observed at all

- **A signed notification.** It needs a public URL registered in the provider panel and the secret
  the panel then issues. The body shape, the notification `id` used as the event id, the unit of
  `ts` and the manifest are the published ones.
- **Pix.** The test seller has no Pix key: its payment methods list cards, boleto and account
  balance only.
- **A chargeback.** Neither how the payment reads while one is open, nor how a won or a lost one
  ends.
- **A rejected, cancelled or expired payment**, and a refund made in a single call for the full
  amount (the card refund is refused on this account; the balance payment was refunded in two parts).

## Rules for changing this directory

- A new recorded file is a raw response, scrubbed as above; say in the table how it was obtained.
- A file that was edited by hand, or generated, is named `derived-…` and listed with its source.
- The task's leak check stays empty for this whole directory, this file included: no access-token
  prefix of either kind and no test-account e-mail domain. The adapter spec asserts it for every file.
