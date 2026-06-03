DELETE FROM "orderbook_snapshots"
WHERE "market_id" IN (
  SELECT "id" FROM "deadline_markets"
  WHERE "classification_status" NOT IN ('candidate', 'traded')
     OR "family_kind" <> 'deadline_ladder'
);

DELETE FROM "opportunities"
WHERE "market_id" IN (
  SELECT "id" FROM "deadline_markets"
  WHERE "classification_status" NOT IN ('candidate', 'traded')
     OR "family_kind" <> 'deadline_ladder'
);

DELETE FROM "deadline_markets"
WHERE "classification_status" NOT IN ('candidate', 'traded')
   OR "family_kind" <> 'deadline_ladder';

DELETE FROM "event_families"
WHERE "family_kind" <> 'deadline_ladder';
