/// Private encrypted account storage; deliberately not serializable or Debug.
#[derive(sqlx::FromRow)]
pub struct CloudAccountRow {
    pub owner: String,
    pub issuer: String,
    pub generation: i64,
    pub subject: Option<String>,
    pub device_id: Option<String>,
    pub provider_id: Option<String>,
    pub encrypted: Option<String>,
    pub state: String,
}
