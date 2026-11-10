-- Tombstones retain generations so late remote responses cannot resurrect logout.
CREATE TABLE IF NOT EXISTS cloud_accounts (
    owner TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    issuer TEXT NOT NULL,
    generation INTEGER NOT NULL DEFAULT 0,
    subject TEXT,
    device_id TEXT,
    provider_id TEXT REFERENCES providers(id),
    encrypted TEXT,
    state TEXT NOT NULL CHECK (state IN ('disconnected', 'reauth_required', 'pending', 'active')),
    PRIMARY KEY (owner, issuer)
);
