# Social Count Distribution Strategy

## Overview

This strategy targets social-media count distribution markets on Polymarket.

Qualifying markets:

- Defined observation window.
- Multiple mutually-exclusive count ranges.
- Exactly one range resolves YES.
- All remaining ranges resolve NO.

Examples:

- Elon Musk # tweets June 5 - June 12, 2026?
- Donald Trump # Truth Social posts June 5 - June 12, 2026?
- White House # posts June 9 - June 16, 2026?

Example ladder:

| Range   | YES |
| ------- | --: |
| 120-139 | <1% |
| 140-159 | <1% |
| 160-179 |  1% |
| 180-199 |  8% |
| 200-219 | 26% |
| 220-239 | 31% |
| 240-259 | 21% |
| 260-279 | 10% |
| 280-299 |  4% |

Exactly one bucket resolves YES. All others resolve NO.

---

## Core Thesis

The strategy only takes NO positions.

The objective is not to predict the winning bucket. The objective is to identify buckets that are structurally unlikely to become the winning bucket and accumulate NO exposure at favorable prices.

No YES positions are taken.

---

## Modal Bucket

The modal bucket is the bucket with the highest YES probability.

Example:

| Range   | YES |
| ------- | --: |
| 200-219 | 26% |
| 220-239 | 31% |
| 240-259 | 21% |

The modal bucket is 220-239.

The modal bucket represents current market consensus and may change over time.

---

## Directional Constraint

Only buckets below the modal bucket are eligible.

Example:

| Range   | Status     |
| ------- | ---------- |
| 120-139 | Eligible   |
| 140-159 | Eligible   |
| 160-179 | Eligible   |
| 180-199 | Eligible   |
| 200-219 | Eligible   |
| 220-239 | Modal      |
| 240-259 | Ineligible |
| 260-279 | Ineligible |

The strategy never enters:

- The modal bucket.
- Buckets above the modal bucket.

---

## Rationale

Unexpected increases in activity typically push market expectations upward through the ladder.

As the modal bucket moves higher:

- Lower buckets become less likely to resolve YES.
- NO probabilities on lower buckets strengthen.
- Existing NO positions below the modal bucket benefit.

The strategy therefore aligns with upward expectation shifts rather than opposing them.

---

## Entry Criteria

A bucket becomes a candidate when:

1. It is below the current modal bucket.
2. Its NO side reaches the configured entry range.
3. Liquidity and execution requirements are satisfied.

Market consensus is the primary signal. The strategy does not attempt to forecast activity counts directly.

---

## Resolution

Events resolve when the observation window ends and the final count is known.

Exactly one bucket resolves YES.

All remaining buckets resolve NO.

The strategy seeks exposure to buckets expected to resolve NO.

---

## Time-to-Resolution (TTR)

When multiple candidates exist, preference is given to opportunities that resolve sooner.

Benefits:

- Faster capital return.
- Faster redeployment.
- Higher capital turnover.
- Shorter risk duration.

---

## Campaign Structure

A subject may have multiple overlapping campaigns.

Example:

- Elon Musk # tweets June 5 - June 12
- Elon Musk # tweets June 8 - June 10
- Elon Musk # tweets June 9 - June 16
- Elon Musk # tweets June 12 - June 19

Each campaign is evaluated independently.

Modal buckets, opportunities, positions, and resolutions are not shared between campaigns.

---

## Scope

This strategy is exclusively designed for social-media count distribution campaigns, including:

- Tweets
- Posts
- Truth Social posts

Political event markets, deadline markets, binary markets, sports markets, valuation markets, weather markets, and unrelated ladder structures are outside the scope of this strategy.
