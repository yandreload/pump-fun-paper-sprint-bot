// Pump.fun Paper Sprint bot — submitted entry (26 Nov 2026).
// v5: the best variant found by sweeping the kit's local grader.
// It is v4's original sniper logic with two tunables changed:
// take-profit +2% (was +12%) and stop-loss -20% (was -10%).
// Everything else — entry filter, 0.01 SOL probes, creator-sell exit,
// max hold 2000 slots, probe-tier valve — is v4 unchanged.
//
// Why not the "bigger" v5 redesign (0.03 SOL size, trailing exit, stricter
// entry, SL -7%)? It was built and swept too, and it graded far worse
// (-0.412 SOL vs v4's -0.048 SOL): the trailing exit gives back the coins
// that spike +12-25% and then fall, the "reserves still growing" filter
// buys at the top of a momentum spike, and 0.03 SOL size triples the
// per-trade losses. The sweep covered 25 variants; the +2%/-20% pair was
// the least-bad of all of them, and the kit's own 80-combo pilot grid
// found nothing positive either (best -0.0674 SOL).
//
// v5 dev result: PnL -19,744,088 lamports (-0.01974 SOL), return -0.20%,
// max drawdown 0.28%, fills 216, distinct mints 108, win rate 38.9%.
// Stress (6 copies): median -0.0475 SOL, p10 -0.0727, p90 -0.0097, all 6
// copies negative. NOT prize-eligible (needs PnL > 0 SOL) — the dev window
// contains no positive-expectancy sniper configuration at these fee levels,
// and the tuned numbers are the least-bad, not a winning edge.
//
// Idea: pump.fun launches are mostly noise. A launch is only worth a tiny
// probe when its own creator puts real money in (dev buy >= 3 SOL across the
// first five trades) and at least four other wallets buy with them, with the
// creator never selling. Every probe is 0.01 SOL, so a loser costs almost
// nothing. A probe is sold whole as soon as it is up 2%, down 20%, the
// creator sells, or it has sat for 2000 slots. No pyramiding, no holding for
// a miracle: the edge is many cheap, fast, filtered shots, not one big bet.
//
// One safety valve: the guardrails need at least 20 round-tripped coins, so
// if the run has lasted 60,000 slots and fewer than 9 probes have gone in,
// the dev-buy bar drops to 1 SOL for the rest of the run (the "probe tier").
// On a busy run the valve never opens and the strict filter stands alone.
//
// The bot talks to the harness through the vendored SDK shim
// (vendor/makefun-bot.ts). The harness sends hello, then one batch per slot,
// then done; the bot answers each batch with at most one reply (the orders
// decided on that slot). Orders decided on the batch for slot s fill at
// slot s + 2 (the harness latency_slots). Everything here is a pure function
// of the hello and the batches, so the two graded executions agree
// byte for byte: no clock, no environment, no Math.random.

import { LAMPORTS_PER_SOL, runBot, type Batch, type BotState, type OrderInput } from './vendor/makefun-bot.ts';

// --- tunables (lamports unless noted) ---------------------------------------
const FIRST_BUY = LAMPORTS_PER_SOL / 100n; // 0.01 SOL probe
const TAKE_PROFIT = 1.02; // sell the whole probe when its value is +2% over cost
const STOP_LOSS = 0.80; // sell the whole probe when its value is -20% under cost
const MAX_HOLD_SLOTS = 2000; // sell whatever is left after this many slots
const ENTRY_AGE_SLOTS = 500; // only consider a coin in its first 500 slots
const MIN_DEV_BUY = (LAMPORTS_PER_SOL * 3n); // creator buys >= 3 SOL in first 5 trades
const PROBE_MIN_DEV_BUY = LAMPORTS_PER_SOL; // probe tier: creator buys >= 1 SOL
const MIN_BUYERS = 4; // distinct non-creator buyers in the first 5 trades
const MIN_REAL_SOL = LAMPORTS_PER_SOL / 2n; // curve must hold >= 0.5 SOL real
const MAX_SLIPPAGE_BPS = 10_000; // wide open: a 0.01 SOL fill is never worth refusing
// Probe-tier gate: open the loose filter only if the run is old and quiet.
const GATE_SLOTS = 60_000;
const GATE_COINS = 9;

// --- per-mint tape -----------------------------------------------------------
interface Tape {
  createdSlot: number | null;
  creator: string | null;
  firstTrades: { isBuy: boolean; user: string; quote: bigint }[];
  creatorSold: boolean;
  decided: boolean;
  buySlot: number | null;
}

const tapes = new Map<string, Tape>();

// Probe-tier gate state: the slot the run started on, how many probes have
// been sent, and whether the loose filter has opened.
let firstSlot: number | null = null;
let probesSent = 0;
let probeTierOpen = false;

function tapeFor(mint: string): Tape {
  let t = tapes.get(mint);
  if (t === undefined) {
    t = { createdSlot: null, creator: null, firstTrades: [], creatorSold: false, decided: false, buySlot: null };
    tapes.set(mint, t);
  }
  return t;
}

/** Mark price of a mint in lamports per token unit, from its latest reserves. */
function markPrice(state: BotState, mint: string): number | null {
  const curve = state.curves.get(mint);
  if (curve === undefined) return null;
  if (curve.virtual_token_reserves <= 0n || curve.virtual_quote_reserves <= 0n) return null;
  return Number(curve.virtual_quote_reserves) / Number(curve.virtual_token_reserves);
}

/** Current value of a held position in lamports (float, for comparisons only). */
function positionValueLamports(state: BotState, mint: string, tokens: bigint): number | null {
  const price = markPrice(state, mint);
  if (price === null) return null;
  return Number(tokens) * price;
}

await runBot({
  onBatch(state, batch: Batch): OrderInput[] {
    const orders: OrderInput[] = [];
    const slot = state.slot;
    const txFee = state.txFeeLamports();
    if (firstSlot === null) firstSlot = slot;
    if (!probeTierOpen && slot - firstSlot > GATE_SLOTS && probesSent < GATE_COINS) {
      probeTierOpen = true;
    }

    // 1) Fold this batch's events into the per-mint tapes.
    for (const e of batch.events) {
      const t = tapeFor(e.mint);
      if (e.event === 'CreateEvent') {
        t.createdSlot = e.slot;
        t.creator = e.creator;
      } else if (e.event === 'TradeEvent') {
        if (t.firstTrades.length < 5) {
          t.firstTrades.push({ isBuy: e.is_buy, user: e.user, quote: BigInt(e.quote_amount) });
        }
        if (t.creator !== null && e.user === t.creator && !e.is_buy) t.creatorSold = true;
      } else if (e.event === 'CompleteEvent') {
        // Curve is done; the harness closes any position in it itself.
      }
    }

    // 2) Exits first: sell whole positions on take-profit, stop-loss,
    // creator-sell, or max hold. A sell decided here fills at slot + 2.
    for (const [mint, holding] of state.positions) {
      const t = tapes.get(mint);
      const value = positionValueLamports(state, mint, holding.token_amount);
      if (value === null) continue;
      const cost = Number(holding.cost_lamports);
      const buySlot = t?.buySlot;
      const tooOld = buySlot !== null && buySlot !== undefined && slot - buySlot > MAX_HOLD_SLOTS;
      if (
        t?.creatorSold === true ||
        value >= cost * TAKE_PROFIT ||
        value <= cost * STOP_LOSS ||
        tooOld
      ) {
        orders.push({ side: 'sell', mint, token_amount: holding.token_amount, max_slippage_bps: MAX_SLIPPAGE_BPS });
      }
    }
    const selling = new Set(orders.filter((o) => o.side === 'sell').map((o) => o.mint));

    // 3) Entries: one 0.01 SOL probe per launch that passes the filter,
    // decided once per mint while it is still young.
    for (const e of batch.events) {
      if (orders.length >= state.hello.caps.max_orders_per_batch) break;
      const mint = e.mint;
      if (selling.has(mint)) continue;
      const t = tapeFor(mint);
      if (t.decided || state.positions.has(mint)) continue;
      if (t.createdSlot === null) {
        // First seen through a trade, not its CreateEvent: treat this slot
        // as its birth so the age window still applies.
        t.createdSlot = slot;
      }
      const age = slot - t.createdSlot;
      if (age > ENTRY_AGE_SLOTS) {
        t.decided = true;
        continue;
      }
      if (t.firstTrades.length < 2) continue;
      if (t.creatorSold) {
        t.decided = true;
        continue;
      }
      // Filter on the first five trades only: the creator's own buys and
      // how many other wallets bought with them.
      let devBuy = 0n;
      const buyers = new Set<string>();
      for (const tr of t.firstTrades) {
        if (tr.isBuy && t.creator !== null && tr.user === t.creator) devBuy += tr.quote;
        if (tr.isBuy && tr.user !== t.creator) buyers.add(tr.user);
      }
      if (devBuy < (probeTierOpen ? PROBE_MIN_DEV_BUY : MIN_DEV_BUY) || buyers.size < MIN_BUYERS) continue;
      const curve = state.curves.get(mint);
      if (curve === undefined || curve.complete) {
        t.decided = true;
        continue;
      }
      if (curve.real_quote_reserves < MIN_REAL_SOL) continue;
      if (state.committedPositionCount() >= state.hello.caps.max_open_positions) continue;
      const cap = state.maxBuyLamports(mint);
      const amount = cap < FIRST_BUY ? cap : FIRST_BUY;
      if (amount < FIRST_BUY) continue; // guardrail needs >= 0.01 SOL round trips
      if (state.freeCashLamports() < amount + txFee) continue;
      orders.push({ side: 'buy', mint, quote_lamports: amount, max_slippage_bps: MAX_SLIPPAGE_BPS });
      t.decided = true;
      t.buySlot = slot;
      probesSent += 1;
    }

    return orders;
  },
});
