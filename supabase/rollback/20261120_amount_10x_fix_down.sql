-- Rollback for the 2026-11-20 correction of news amounts stored 10x too small (see pipeline/site_v2/deal_quality.py).
-- Restores the values as they were before the fix.
update events e set amount_usd_m = v.old from (values
  (42244, 21), (25171, 8), (22759, 34), (17691, 34), (13062, 34), (11093, 34),
  (11345, 34), (10725, 34), (11212, 34), (11943, 34), (10770, 34), (7207, 45)
) as v(id, old) where e.id = v.id;
