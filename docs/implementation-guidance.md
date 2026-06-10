# Implementation Guidance

This document provides architectural guidance for implementing the Social Count Distribution Strategy.

It is not a strategy specification and it is not a list of hard requirements.

Its purpose is to communicate implementation goals, constraints, and lessons learned from previous development iterations.

For strategy rules, refer to `new-strategy.md`.

For research findings, refer to `market-discovery-research.md`.

---

## Primary Objective

The goal is to adapt the existing system to support Social Count Distribution campaigns while preserving the strengths of the current architecture.

The previous deadline-market implementation contains substantial proven infrastructure that should be reused wherever practical.

Examples include:

- Data handling patterns.
- Market scanning architecture.
- Opportunity evaluation flow.
- Portfolio management.
- Position lifecycle management.
- Resolution handling.
- WebSocket integration.
- Dashboard architecture.
- UI interaction patterns.

The objective is not to rebuild the system from scratch.

---

## Research Expectations

Before implementation begins:

1. Read `new-strategy.md`.
2. Read `market-discovery-research.md`.
3. Read Polymarket documentation:
   - https://docs.polymarket.com/llms.txt

4. Review all relevant API documentation.
5. Review all relevant WebSocket documentation.
6. Validate assumptions against live API responses.

Research should be performed before major architectural decisions are made.

Previous implementation attempts relied too heavily on assumptions that were later proven incorrect.

Live data should be treated as the source of truth.

---

## Discovery System

Campaign discovery is a critical component of the strategy.

The implementation should not assume that scanning all events is the optimal approach.

Research should determine:

- Whether category-based filtering exists. even with category ids.
- Whether tag-based filtering exists.
- Whether event search endpoints exist.
- Whether more targeted API queries exist.
- Whether WebSocket subscriptions can assist discovery.

The objective is to discover relevant campaigns as efficiently as possible while minimizing unnecessary processing.

The implementation should be guided by actual Polymarket capabilities rather than assumptions.

---

## Campaign Classification

The strategy is intended for social-media count distribution campaigns.

Discovery logic should identify these campaigns reliably while excluding unrelated ladder structures.

Examples of unwanted ladders:

- IPO valuation ladders.
- Weather ladders.
- Sports ladders.
- Election ladders.
- Sentencing ladders.

Research should determine the most reliable classification approach using actual API data.

Avoid hardcoding assumptions unless necessary.

---

## Data Model

Backwards compatibility is not required.

The database schema may be redesigned as needed.

Existing deadline-market tables, relationships, and assumptions do not need to be preserved.

However:

- Simplicity should be preferred.
- Data duplication should be minimized.
- Redundant abstractions should be avoided.
- Proven architectural patterns should be retained where appropriate.

The goal is a cleaner model, not a larger one.

---

## Backend Philosophy

Preserve proven infrastructure whenever practical.

Examples:

- Scheduling.
- Scanning loops.
- Opportunity generation.
- Position management.
- Resolution processing.
- Risk controls.
- Logging.
- Monitoring.
- Data management
- Efficent data processing

The strategy model should change.

The engine quality should not regress.

Avoid introducing unnecessary complexity.

Avoid creating parallel systems when existing systems can be adapted.

---

## Frontend Philosophy

The previous command-center UI is considered a strong foundation.

Large visual redesigns are not desired.

The goal is to adapt the interface to the new strategy rather than replacing it.

Maintain:

- Overall layout.
- Visual hierarchy.
- Density.
- Navigation structure.
- Positions view.
- Trade history view.
- Dashboard feel.

Users should immediately recognize the application.

---

## Campaign Monitoring View

A new campaign-oriented view will likely be required.

The preferred direction is:

- Table-based.
- Dense.
- Information-focused.
- Consistent with existing dashboard styling.

Potential approach:

- One row per campaign.
- Expandable rows or accordion behavior.
- Expanding a campaign reveals its buckets.
- Modal bucket visibility.
- Candidate opportunities.
- Time-to-resolution information.

This should complement the existing dashboard rather than replace it. like add a new tab along with existing tabs for this.

---

## UI Principle

Favor clarity over visualization.

Previous experiments using ladder-distribution visualizations and radar-style displays added noise without improving decision-making.

The interface should make it immediately obvious:

- What campaigns exist.
- Which campaign is being evaluated.
- Which bucket is modal.
- Which buckets are candidates.
- Which positions are currently open.
- When capital is expected to return.

---

## Code Quality

The previous implementation accumulated unnecessary code during rapid iteration.

During implementation:

- Remove obsolete logic.
- Remove unused abstractions.
- Remove dead code.
- Avoid duplicate pathways.
- Avoid temporary solutions becoming permanent architecture.

Prefer fewer moving parts.

Prefer simpler systems.

Prefer maintainable systems.

---

## Success Criteria

A successful implementation should:

1. Discover relevant social count campaigns reliably.
2. Correctly identify ladder structures and buckets.
3. Correctly determine modal buckets.
4. Generate strategy opportunities according to `new-strategy.md`.
5. Preserve the strengths of the existing engine.
6. Preserve the strengths of the existing UI.
7. Reduce complexity where possible.
8. Be validated against real Polymarket data.
