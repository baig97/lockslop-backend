-- Preserve the raw resource and existing revision: the underlying video data is unchanged.
UPDATE content_payloads p
SET payload = p.payload->'items'->0
FROM entities e
WHERE p.entity_id=e.id
  AND e.entity_type='youtube_video'
  AND p.provider='youtube_data_api_v3'
  AND jsonb_typeof(p.payload->'items')='array'
  AND p.payload->'items'->0->>'id'=e.external_id;
--> statement-breakpoint
-- Invalid legacy envelopes cannot be assigned to this entity; refresh them on demand.
UPDATE content_payloads
SET status='stale'
WHERE provider='youtube_data_api_v3' AND payload ? 'items';
