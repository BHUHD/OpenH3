-- Binding/display facts only. NULL means unavailable, including pre-migration history.
-- Never evidence of a request, charge, settlement, or task total.
ALTER TABLE messages ADD COLUMN model_source TEXT;
