# New Direction

## Overview

The new system moves away from short-duration BTC prediction markets and instead focuses on event-driven Polymarket markets.

The primary focus is on markets built around a specific event occurring before a given deadline.

Examples:

- Will Netanyahu leave office by May 15?
- Will Netanyahu leave office by June 1?
- Will Netanyahu leave office by July 1?

Or:

- Will Strait of Hormuz traffic return to normal by May 15?
- Will Strait of Hormuz traffic return to normal by June 1?
- Will Strait of Hormuz traffic return to normal by July 1?

These markets often exist as a family of related date-based outcomes centered around the same underlying event.

---

## Core Thesis

As a deadline approaches, market participants usually gain a much clearer understanding of whether an event is realistically going to occur before that specific date.

When very little time remains and the event still has not happened, the market may become highly confident that the answer will be "No".

Example:

Event:
"Will X happen by June 15?"

Current date:
June 13

Market belief:
The event appears increasingly unlikely to occur before June 15.

Market pricing:

- YES = 0.04
- NO = 0.96

The system's goal is to identify situations like this and take the NO side when the probability of the event occurring before the deadline appears extremely low.

If the event does not occur before the specified date, the NO position settles at $1.00.

The profit comes from capturing the remaining gap between the entry price and settlement value.

---

## Desired Approach

The system should focus on discovering and analyzing deadline-driven event markets across Polymarket.

It should understand:

- The underlying event being discussed
- The specific deadline associated with each market
- Relationships between markets that reference the same event but different dates
- Resolution rules and settlement conditions
- Current market pricing
- Time remaining until the relevant deadline

The system should identify opportunities where:

- The deadline is approaching
- The event has not yet occurred
- Market participants already strongly favor NO
- The remaining return is still meaningful
- Orderbook liquidity is sufficient for realistic execution

---

## Important Notes

This is currently a thesis, not a proven strategy.

Implementation should be driven by research and real market data rather than assumptions.

The system should investigate actual Polymarket markets, market structures, resolution rules, liquidity, pricing behavior, and opportunity frequency before making implementation decisions.

The existing orderbook realism, fill simulation, position tracking, settlement handling, and portfolio accounting concepts remain valuable and should be adapted where appropriate.

BTC-specific discovery logic, momentum logic, distance calculations, and other strategy-specific assumptions from the existing system should not drive the new design.
