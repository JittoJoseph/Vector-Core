# Market Discovery Research

> This document contains research findings gathered during strategy exploration. These findings are intended to provide context and accelerate future research. They are not implementation requirements and should be validated against current Polymarket APIs, documentation, and live market data before being relied upon.

## Research Goal

The objective was to identify a market family that:

- Naturally produces large numbers of NO-side opportunities.
- Is structurally similar across campaigns.
- Can be discovered algorithmically.
- Aligns with the Social Count Distribution Strategy.

Research focused on Polymarket count-distribution ladders involving social-media activity.

---

## Observed Market Structure

A typical campaign consists of:

- One parent event.
- Multiple mutually-exclusive count buckets.
- Exactly one bucket resolving YES.
- All remaining buckets resolving NO.

Example:

Event:

Elon Musk # tweets June 5 - June 12, 2026?

Buckets:

- 120-139
- 140-159
- 160-179
- 180-199
- 200-219
- 220-239
- 240-259
- 260-279

Exactly one bucket resolves YES.

All others resolve NO.

---

## Observed Campaign Families

During discovery, recurring campaign families were observed around:

- Elon Musk
- Donald Trump
- White House
- Zelenskyy
- Ted Cruz
- Khamenei
- CZ (Changpeng Zhao)
- NYC Mayor

This list should not be treated as exhaustive.

Future discovery should remain entity-agnostic and rely on market structure rather than specific names.

---

## Observed Naming Patterns

Common event title patterns included:

- Elon Musk # tweets June 5 - June 12, 2026?
- Donald Trump # Truth Social posts June 5 - June 12, 2026?
- White House # posts June 9 - June 16, 2026?

Observed keywords:

- tweets
- posts
- Truth Social posts

Future discovery should validate actual live patterns rather than relying solely on historical examples.

---

## Overlapping Campaign Windows

A single subject may have multiple active campaigns simultaneously.

Example:

- June 5 - June 12
- June 8 - June 10
- June 9 - June 16
- June 12 - June 19
- Monthly windows

Observed behavior suggests these campaigns operate independently and should be evaluated independently.

---

## Modal Bucket Observation

Across observed campaigns, probability distributions generally formed a recognizable peak.

Example:

| Bucket  | YES |
| ------- | --- |
| 180-199 | 8%  |
| 200-219 | 26% |
| 220-239 | 31% |
| 240-259 | 21% |
| 260-279 | 10% |

The highest YES-probability bucket naturally acts as a modal bucket.

This observation directly influenced the strategy described in `new-strategy.md`.

---

## Discovery Findings

Research indicated that:

- Count-distribution campaigns are significantly more relevant than generic ladder markets.
- Generic ladder discovery captures many unrelated markets.
- Market structure alone is insufficient for identifying strategy candidates.
- Additional classification is required to distinguish social-count campaigns from unrelated ladder events.

Examples of unrelated ladders observed:

- IPO valuation ranges
- Weather ranges
- Sports outcome distributions
- Election outcome distributions
- Sentencing distributions

These markets were considered outside strategy scope.

---

## API Observations

During exploration of Polymarket APIs:

Observed behaviors included:

- Parent event containing multiple child markets.
- Mutually-exclusive ladders appearing under a common event.
- Markets resolving as a single distribution.
- Overlapping campaigns existing simultaneously.

API payload structures should always be verified against current documentation and live responses.

---

## Data Quality Notes

Several implementation issues were discovered during experimentation:

- Assumptions about bucket ordering were not always reliable.
- Generic ladder detection produced false positives.
- Numeric parsing required careful handling of ranges beginning with zero.
- API fields occasionally differed from assumptions made during development.

Future implementations should prioritize validation against live data rather than relying on inferred structures.

---

## Key Takeaways

The strongest findings from research were:

1. Social-media count distributions appear frequently enough to support systematic discovery.
2. Multiple overlapping campaigns often exist for the same subject.
3. Probability distributions typically form a clear modal bucket.
4. Generic ladder discovery introduces significant noise.
5. Strategy performance depends heavily on candidate selection and classification quality.
6. Discovery logic should remain adaptable to future changes in Polymarket market structures.

For actual strategy rules, refer to `new-strategy.md`.
