# Changelog

## Unreleased

- Automatic retries with exponential backoff (`retries`, `backoffMs` on `createTarmacClient`). Swap requests are never re-sent after a network failure.
- Network failures now throw `TarmacToolError` with code `NETWORK_ERROR` instead of a raw `TypeError`.

## 0.1.0

- First release: `createTarmacClient`, `runAgent`, `attach`, typed tools (`getContext`, `getBalances`, `getQuote`, `requestSwap`, `finish`) and `TarmacToolError`.
