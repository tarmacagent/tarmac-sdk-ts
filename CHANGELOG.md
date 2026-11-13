# Changelog

## Unreleased

- Automatic retries with exponential backoff (`retries`, `backoffMs` on `createTarmacClient`). Swap requests are never re-sent after a network failure.
- Network failures now throw `TarmacToolError` with code `NETWORK_ERROR` instead of a raw `TypeError`.
- `createTarmacClientFromEnv()` and `client.attachFromEnv()` read `TARMAC_URL`, `TARMAC_RUN_ID` and `TARMAC_RUN_TOKEN`.
- `client.health()` reports which run modes a server can serve.

## 0.1.0

- First release: `createTarmacClient`, `runAgent`, `attach`, typed tools (`getContext`, `getBalances`, `getQuote`, `requestSwap`, `finish`) and `TarmacToolError`.
