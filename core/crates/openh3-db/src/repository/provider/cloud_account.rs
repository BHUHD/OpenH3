use crate::{CloudAccountRow, DbError, SqlitePool};

#[derive(Clone, Copy)]
pub struct SaveCloudAccount<'a> {
    pub owner: &'a str,
    pub issuer: &'a str,
    pub generation: i64,
    pub subject: &'a str,
    pub device_id: &'a str,
    pub provider_id: &'a str,
    pub encrypted: &'a str,
    pub state: &'a str,
}

/// Service-owned admission snapshot, bound to the exact authenticated grant.
pub struct SaveCloudCatalog<'a> {
    pub owner: &'a str,
    pub issuer: &'a str,
    pub generation: i64,
    pub subject: &'a str,
    pub provider_id: &'a str,
    /// Exact model IDs paired with one verified protocol each. No aliases.
    pub models: &'a [(String, String, bool)],
}

#[async_trait::async_trait]
pub trait ICloudAccountRepository: Send + Sync {
    async fn load(&self, owner: &str, issuer: &str) -> Result<Option<CloudAccountRow>, DbError>;
    /// Initialize a missing tombstone; never alter an existing grant or generation.
    async fn ensure_generation(&self, owner: &str, issuer: &str) -> Result<i64, DbError>;
    /// Atomically admit a new attempt only while disconnected or requiring reauth.
    async fn begin_login(&self, owner: &str, issuer: &str) -> Result<i64, DbError>;
    /// Clear locally and return the exact removed snapshot for best-effort revocation.
    async fn disconnect(&self, owner: &str, issuer: &str) -> Result<CloudAccountRow, DbError>;
    /// Clears secrets and disables the old provider before returning a new generation.
    async fn invalidate(&self, owner: &str, issuer: &str, expected: Option<i64>, reauth: bool) -> Result<i64, DbError>;
    /// Must insert a fresh provider and binding in the same transaction.
    async fn save_pending(&self, input: SaveCloudAccount<'_>) -> Result<(), DbError>;
    /// CAS commit of activation or rotation, including the provider enabled flag.
    async fn save_active(&self, input: SaveCloudAccount<'_>) -> Result<(), DbError>;
    async fn replace_catalog(&self, input: SaveCloudCatalog<'_>) -> Result<(), DbError>;
    async fn model_allowed(&self, input: SaveCloudCatalog<'_>, model: &str, protocol: &str) -> Result<bool, DbError>;
}

pub struct SqliteCloudAccountRepository {
    pool: SqlitePool,
}
impl SqliteCloudAccountRepository {
    pub fn new(pool: SqlitePool) -> Self {
        Self { pool }
    }
    async fn invalidate_row(
        &self,
        owner: &str,
        issuer: &str,
        expected: Option<i64>,
        reauth: bool,
    ) -> Result<CloudAccountRow, DbError> {
        let mut tx = self.pool.begin().await?;
        // The first write serializes this snapshot and its invalidation with
        // concurrent pending persistence, activation, and credential rotation.
        sqlx::query("INSERT OR IGNORE INTO cloud_accounts(owner, issuer, state) VALUES (?, ?, 'disconnected')")
            .bind(owner)
            .bind(issuer)
            .execute(&mut *tx)
            .await?;
        let row: CloudAccountRow = sqlx::query_as("SELECT * FROM cloud_accounts WHERE owner = ? AND issuer = ?")
            .bind(owner)
            .bind(issuer)
            .fetch_one(&mut *tx)
            .await?;
        if expected.is_some_and(|g| g != row.generation) {
            return Err(conflict());
        }
        if let Some(id) = &row.provider_id {
            sqlx::query(
                "UPDATE providers SET enabled = 0 WHERE id = ? AND user_id = ? AND managed_by = 'cloud_account'",
            )
            .bind(id)
            .bind(owner)
            .execute(&mut *tx)
            .await?;
        }
        sqlx::query("UPDATE cloud_accounts SET generation = generation + 1, subject = NULL, device_id = NULL, provider_id = NULL, encrypted = NULL, state = ? WHERE owner = ? AND issuer = ?")
            .bind(if reauth { "reauth_required" } else { "disconnected" }).bind(owner).bind(issuer).execute(&mut *tx).await?;
        tx.commit().await?;
        Ok(row)
    }
}

fn conflict() -> DbError {
    DbError::Conflict("Cloud account changed".into())
}

#[async_trait::async_trait]
impl ICloudAccountRepository for SqliteCloudAccountRepository {
    async fn replace_catalog(&self, p: SaveCloudCatalog<'_>) -> Result<(), DbError> {
        // Validate everything before opening a write transaction. The service
        // owns capability/pricing validation; this port admits only known modes.
        let mut ids = Vec::new();
        let mut settings = std::collections::BTreeMap::new();
        for (id, protocol, supports_tools) in p.models {
            if id.is_empty() || id.len() > 255 || ids.contains(id) {
                return Err(conflict());
            }
            let mode = match protocol.as_str() {
                "ChatCompletions" => "chat_completions",
                "Responses" => "responses",
                _ => return Err(conflict()),
            };
            ids.push(id.clone());
            settings.insert(
                id,
                serde_json::json!({"image_input":"unsupported","openai_api_mode":mode,"supports_tools":supports_tools}),
            );
        }
        let models = serde_json::to_string(&ids).map_err(|_| conflict())?;
        let settings = serde_json::to_string(&settings).map_err(|_| conflict())?;
        let mut tx = self.pool.begin().await?;
        if sqlx::query("UPDATE providers SET models = ?, model_settings = ?, model_enabled = NULL, model_protocols = NULL WHERE id = ? AND user_id = ? AND managed_by = 'cloud_account' AND EXISTS (SELECT 1 FROM cloud_accounts WHERE owner = ? AND issuer = ? AND generation = ? AND subject = ? AND provider_id = providers.id AND state = 'active')")
            .bind(models).bind(settings).bind(p.provider_id).bind(p.owner).bind(p.owner).bind(p.issuer).bind(p.generation).bind(p.subject).execute(&mut *tx).await?.rows_affected() != 1 { return Err(conflict()); }
        tx.commit().await?;
        Ok(())
    }
    async fn model_allowed(&self, p: SaveCloudCatalog<'_>, model: &str, protocol: &str) -> Result<bool, DbError> {
        let row: Option<(String, String)> = sqlx::query_as("SELECT models, model_settings FROM providers WHERE id = ? AND user_id = ? AND managed_by = 'cloud_account' AND enabled = 1 AND EXISTS (SELECT 1 FROM cloud_accounts WHERE owner = ? AND issuer = ? AND generation = ? AND subject = ? AND provider_id = providers.id AND state = 'active')")
            .bind(p.provider_id).bind(p.owner).bind(p.owner).bind(p.issuer).bind(p.generation).bind(p.subject).fetch_optional(&self.pool).await?;
        let Some((models, settings)) = row else {
            return Ok(false);
        };
        let models: Vec<String> = serde_json::from_str(&models).map_err(|_| conflict())?;
        let settings: std::collections::BTreeMap<String, serde_json::Value> =
            serde_json::from_str(&settings).map_err(|_| conflict())?;
        let mode = match protocol {
            "ChatCompletions" => "chat_completions",
            "Responses" => "responses",
            _ => return Ok(false),
        };
        Ok(models.iter().any(|id| id == model) && settings.get(model).is_some_and(|s| s["openai_api_mode"] == mode))
    }
    async fn load(&self, owner: &str, issuer: &str) -> Result<Option<CloudAccountRow>, DbError> {
        Ok(
            sqlx::query_as("SELECT * FROM cloud_accounts WHERE owner = ? AND issuer = ?")
                .bind(owner)
                .bind(issuer)
                .fetch_optional(&self.pool)
                .await?,
        )
    }
    async fn ensure_generation(&self, owner: &str, issuer: &str) -> Result<i64, DbError> {
        let mut tx = self.pool.begin().await?;
        sqlx::query("INSERT OR IGNORE INTO cloud_accounts(owner, issuer, state) VALUES (?, ?, 'disconnected')")
            .bind(owner)
            .bind(issuer)
            .execute(&mut *tx)
            .await?;
        let generation = sqlx::query_scalar("SELECT generation FROM cloud_accounts WHERE owner = ? AND issuer = ?")
            .bind(owner)
            .bind(issuer)
            .fetch_one(&mut *tx)
            .await?;
        tx.commit().await?;
        Ok(generation)
    }
    async fn begin_login(&self, owner: &str, issuer: &str) -> Result<i64, DbError> {
        let mut tx = self.pool.begin().await?;
        sqlx::query("INSERT OR IGNORE INTO cloud_accounts(owner, issuer, state) VALUES (?, ?, 'disconnected')")
            .bind(owner)
            .bind(issuer)
            .execute(&mut *tx)
            .await?;
        let generation = sqlx::query_scalar("UPDATE cloud_accounts SET generation = generation + 1, state = 'disconnected' WHERE owner = ? AND issuer = ? AND state IN ('disconnected', 'reauth_required') RETURNING generation")
            .bind(owner).bind(issuer).fetch_optional(&mut *tx).await?.ok_or_else(conflict)?;
        tx.commit().await?;
        Ok(generation)
    }
    async fn disconnect(&self, owner: &str, issuer: &str) -> Result<CloudAccountRow, DbError> {
        self.invalidate_row(owner, issuer, None, false).await
    }
    async fn invalidate(&self, owner: &str, issuer: &str, expected: Option<i64>, reauth: bool) -> Result<i64, DbError> {
        Ok(self.invalidate_row(owner, issuer, expected, reauth).await?.generation + 1)
    }
    async fn save_pending(&self, p: SaveCloudAccount<'_>) -> Result<(), DbError> {
        let mut tx = self.pool.begin().await?;
        let changed = sqlx::query(
            "UPDATE cloud_accounts SET subject = ?, device_id = ?, provider_id = ?, encrypted = ?, state = 'pending' WHERE owner = ? AND issuer = ? AND generation = ? AND state = 'disconnected'",
        );
        // Insert first: any failure of the CAS below rolls this fresh provider back.
        sqlx::query("INSERT INTO providers(id, user_id, platform, name, base_url, api_key_encrypted, managed_by, models, enabled, capabilities, model_settings, is_full_url, created_at, updated_at) VALUES (?, ?, 'new-api', 'Cloud account', ?, '', 'cloud_account', '[]', 0, '[]', '{}', 0, ?, ?)")
            .bind(p.provider_id).bind(p.owner).bind(p.issuer).bind(openh3_common::now_ms()).bind(openh3_common::now_ms()).execute(&mut *tx).await?;
        if changed
            .bind(p.subject)
            .bind(p.device_id)
            .bind(p.provider_id)
            .bind(p.encrypted)
            .bind(p.owner)
            .bind(p.issuer)
            .bind(p.generation)
            .execute(&mut *tx)
            .await?
            .rows_affected()
            != 1
        {
            return Err(conflict());
        }
        tx.commit().await?;
        Ok(())
    }
    async fn save_active(&self, p: SaveCloudAccount<'_>) -> Result<(), DbError> {
        let mut tx = self.pool.begin().await?;
        if !matches!(p.state, "pending" | "active") {
            return Err(conflict());
        }
        if sqlx::query("UPDATE cloud_accounts SET encrypted = ?, state = ? WHERE owner = ? AND issuer = ? AND generation = ? AND subject = ? AND device_id = ? AND provider_id = ? AND state IN ('pending','active')")
            .bind(p.encrypted).bind(p.state).bind(p.owner).bind(p.issuer).bind(p.generation).bind(p.subject).bind(p.device_id).bind(p.provider_id).execute(&mut *tx).await?.rows_affected() != 1 { return Err(conflict()); }
        if sqlx::query("UPDATE providers SET enabled = ? WHERE id = ? AND user_id = ? AND managed_by = 'cloud_account'")
            .bind(p.state == "active")
            .bind(p.provider_id)
            .bind(p.owner)
            .execute(&mut *tx)
            .await?
            .rows_affected()
            != 1
        {
            return Err(conflict());
        }
        tx.commit().await?;
        Ok(())
    }
}
