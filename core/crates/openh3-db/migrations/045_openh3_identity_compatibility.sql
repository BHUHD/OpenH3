-- Product branding only. Assistant IDs, definition IDs, overlays, snapshots,
-- scheduled-job JSON and user-authored content are durable data contracts.
-- Keep them intact; the runtime accepts both old and new Butler names.
-- Builtin bootstrap refreshes product-owned labels and resource references
-- while reusing the existing definition ID and all of its user preferences.
UPDATE agent_metadata
SET name = 'OpenH3 Core',
    icon = '/api/assets/logos/brand/openh3.png'
WHERE id = '632f31d2'
  AND agent_type = 'aionrs'
  AND agent_source = 'internal';
