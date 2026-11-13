-- Server-owned account integration marker; NULL keeps existing BYOK behavior.
-- SQLite ADD COLUMN has no IF NOT EXISTS; SQLx applies this migration once.
ALTER TABLE providers ADD COLUMN managed_by TEXT;
