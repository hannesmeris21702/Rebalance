# Cetus CLMM Rebalance Bot

Minimal single-sided rebalance bot for Cetus on Sui. It polls a configured pool, removes out-of-range liquidity (collecting fees), and zaps fresh liquidity on the correct side using the Cetus SDK.

## Setup

1. Copy `.env.example` to `.env` and fill in values:
   - `SUI_NETWORK`: `mainnet` or `testnet`.
   - `SUI_RPC_URL`: fullnode URL (optional when using defaults).
   - `SUI_PRIVATE_KEY`: `suiprivkey...` string.
   - `POOL_ID`, `LOWER_TICK`, `UPPER_TICK`: target pool and range.
   - `CHECK_INTERVAL_SECONDS`: polling interval.
   - `ZAP_AMOUNT_A` / `ZAP_AMOUNT_B`: raw token amounts for single-sided zap.
   - `ZAP_SLIPPAGE_BPS`: slippage in basis points for zap estimation.

2. Install dependencies:

```bash
npm install
```

## Run

```bash
npm start
```

The bot logs each action and treats `MoveAbort(0)` as non-retryable.

## Test

```bash
npm test
```
