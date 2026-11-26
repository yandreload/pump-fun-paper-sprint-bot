# Pump.fun Paper Sprint Bot

[![make.fun](https://make.fun/badge/u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b.svg)](https://make.fun/bounty/u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b)
[![Rank](https://make.fun/badge/u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b/yandreload/pump-fun-paper-sprint-bot/rank.svg)](https://make.fun/bounty/u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b)
[![Reward](https://make.fun/badge/u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b/yandreload/pump-fun-paper-sprint-bot/reward.svg)](https://make.fun/bounty/u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b)

Original sniper strategy for the make.fun bounty **Pump.fun Paper Sprint: Any Bot Can Win**.

Paper-trades pump.fun on a 6-hour replay with 10 SOL starting capital. Highest net PnL wins.

## Strategy (v5, submitted 26 Nov 2026)

- 0.01 SOL probe per coin, max 5 open positions, one buy per mint
- Entry only in a coin's first 500 slots, from its first 5 trades: creator bought ≥3 SOL, ≥4 distinct non-creator buyers, creator never sold, real reserve ≥0.5 SOL
- Sell whole on +2% take-profit, −20% stop-loss, creator-sell, or 2000-slot max hold
- Safety valve: if fewer than 9 probes after 60,000 slots, creator-buy bar drops to 1 SOL to protect the 20-coin guardrail

v5 is v4's logic with take-profit +2% (was +12%) and stop-loss −20% (was −10%), the best of 25 graded variants. A bigger redesign (0.03 SOL size, trailing exit, stricter entry, SL −7%) graded far worse (−0.412 SOL), so it was dropped.

## Dev result (local grade-local, 24h dev window)

- Net PnL: −0.01974 SOL
- Return: −0.20%
- Max drawdown: 0.28%
- Fills: 216, distinct mints: 108, win rate: 38.9%
- Guardrails: met (108 coins ≥0.01 SOL round trip)
- Prize: no — net PnL must be > 0 SOL

Dev score is unofficial. The final window is 6 hours of fresh pump.fun data.

## Run

Entry point is `main.ts` (Node 22, no dependencies). The SDK is vendored in `vendor/makefun-bot.ts`.

## License

MIT
