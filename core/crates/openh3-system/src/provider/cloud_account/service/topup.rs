use super::*;

const JS_MAX: i64 = 9_007_199_254_740_991;
fn payment_id(value: &str, minimum: usize) -> bool {
    (minimum..=64).contains(&value.len())
        && value
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || c == b'_' || c == b'-')
}
fn input(amount: i64, method: &str) -> Result<()> {
    if !(1..=JS_MAX).contains(&amount) || !payment_id(method, 1) {
        return Err(Error::Input);
    }
    Ok(())
}
fn quote(q: &CloudAccountTopupQuote) -> Result<()> {
    let money: Vec<_> = q.payable_money.split('.').collect();
    if input(q.amount, &q.payment_method).is_err()
        || !matches!(q.amount_unit.as_str(), "USD" | "CNY" | "TOKENS" | "CUSTOM")
        || !matches!(q.payment_method.as_str(), "alipay" | "wxpay" | "qqpay")
        || q.provider != "epay_v1"
        || q.currency != "CNY"
        || q.quota_unit != "new_api_quota"
        || q.fee_scope != "gateway_payable_total"
        || money.len() != 2
        || money[0].is_empty()
        || money[0].len() > 14
        || money[1].len() != 2
        || !q.payable_money.bytes().all(|c| c.is_ascii_digit() || c == b'.')
        || !q.payable_money.bytes().any(|c| matches!(c, b'1'..=b'9'))
        || q.credited_quota.is_empty()
        || q.credited_quota.len() > 16
        || !q.credited_quota.bytes().all(|c| c.is_ascii_digit())
        || !q.credited_quota.parse::<i64>().is_ok_and(|n| (1..=JS_MAX).contains(&n))
        || [&q.conversion_version, &q.quote_version]
            .iter()
            .any(|v| v.len() != 64 || !v.bytes().all(|c| c.is_ascii_hexdigit()))
    {
        return Err(Error::Protocol);
    }
    Ok(())
}
/// Exclude only credentials belonging to the currently authenticated grant.
fn contains_grant_secret(value: &str, s: &Stored) -> bool {
    [
        Some(s.credentials.access_token.as_str()),
        Some(s.credentials.refresh_token.as_str()),
        s.inference_key.as_deref(),
    ]
    .into_iter()
    .flatten()
    .any(|secret| !secret.is_empty() && value.contains(secret))
}
/// Parse for safety, retain the original signed bytes for the handoff.
fn checkout(value: &str, s: &Stored) -> Result<()> {
    if value.len() > 8192
        || !value.starts_with("https://")
        || value[8..]
            .split(['/', '?', '#'])
            .next()
            .is_some_and(|authority| authority.contains('@'))
        || contains_grant_secret(value, s)
        || value.chars().any(|c| c.is_control() || c.is_whitespace() || c == '\\')
    {
        return Err(Error::Protocol);
    }
    let u = reqwest::Url::parse(value).map_err(|_| Error::Protocol)?;
    if u.scheme() != "https"
        || u.host_str().is_none()
        || !u.username().is_empty()
        || u.password().is_some()
        || u.fragment().is_some()
    {
        return Err(Error::Protocol);
    }
    // Decode only for inspection. This covers the original path/authority/query
    // bytes (including text URL canonicalization may remove), while host_str
    // also checks the URL parser's canonical hostname. Never rewrite the handoff.
    let decoded = percent_encoding::percent_decode_str(value).decode_utf8_lossy();
    if contains_grant_secret(&decoded, s) || u.host_str().is_some_and(|host| contains_grant_secret(host, s)) {
        return Err(Error::Protocol);
    }
    for (key, value) in u.query_pairs() {
        if matches!(
            key.to_ascii_lowercase().as_str(),
            "key"
                | "api_key"
                | "merchant_key"
                | "access_token"
                | "refresh_token"
                | "inference_key"
                | "authorization"
                | "password"
        ) || value.chars().any(|c| c.is_control() || c == '\\')
            || contains_grant_secret(&key, s)
            || contains_grant_secret(&value, s)
        {
            return Err(Error::Protocol);
        }
    }
    Ok(())
}
fn order(o: &CloudAccountTopupOrder, s: &Stored, issue: bool) -> Result<()> {
    quote(&CloudAccountTopupQuote {
        amount: o.amount,
        amount_unit: o.amount_unit.clone(),
        payment_method: o.payment_method.clone(),
        provider: o.provider.clone(),
        payable_money: o.payable_money.clone(),
        currency: o.currency.clone(),
        credited_quota: o.credited_quota.clone(),
        quota_unit: o.quota_unit.clone(),
        conversion_version: o.conversion_version.clone(),
        quote_version: o.quote_version.clone(),
        fee_scope: o.fee_scope.clone(),
    })?;
    if o.owner_id != s.account.id
        || !payment_id(&o.order_id, 1)
        || [o.created_at, o.completed_at, o.handoff_expires_at]
            .iter()
            .any(|n| !(0..=JS_MAX).contains(n))
        || !matches!(o.handoff_status.as_str(), "available" | "unavailable" | "expired")
        || o.expiry_scope != "local_handoff_only"
        || o.checkout_url.is_some()
            && (!issue || o.status != CloudAccountTopupStatus::Pending || o.handoff_status != "available")
    {
        return Err(Error::Protocol);
    }
    if let Some(url) = &o.checkout_url {
        checkout(url, s)?;
    }
    Ok(())
}
impl CloudAccountService {
    pub async fn topup_options(&self, owner: &str) -> Result<CloudAccountTopupOptionsResponse> {
        let s = self.connected(owner).await?;
        let response = self
            .gateway()?
            .post::<TopupOptions>("topup/options", &json!({}), Some(&s.credentials.access_token))
            .await;
        let result = self.invalidate_auth(&s, response).await?.0;
        if result.options.len() > 96
            || !matches!(result.status.as_str(), "available" | "unavailable")
            || (result.status == "available") == result.options.is_empty()
            || result.unsupported_providers.len() > 32
            || result.unsupported_providers.iter().any(|v| !payment_id(v, 1))
        {
            return Err(Error::Protocol);
        }
        for q in &result.options {
            quote(q)?;
        }
        self.check_generation(owner, s.generation).await?;
        Ok(result)
    }
    pub async fn topup_quote(
        &self,
        owner: &str,
        request: CloudAccountTopupQuoteRequest,
    ) -> Result<CloudAccountTopupQuote> {
        input(request.amount, &request.payment_method)?;
        let s = self.connected(owner).await?;
        let response = self
            .gateway()?
            .post::<TopupQuote>("topup/quote", &request, Some(&s.credentials.access_token))
            .await;
        let result = self.invalidate_auth(&s, response).await?.0;
        quote(&result)?;
        if result.amount != request.amount || result.payment_method != request.payment_method {
            return Err(Error::Protocol);
        }
        self.check_generation(owner, s.generation).await?;
        Ok(result)
    }
    /// Explicit replay preserves caller-supplied key and original quote. No automatic retry.
    pub async fn topup_create(
        &self,
        owner: &str,
        request: CloudAccountCreateTopupRequest,
    ) -> Result<CloudAccountTopupOrder> {
        input(request.amount, &request.payment_method)?;
        if request.quote_version.len() != 64 || !payment_id(&request.idempotency_key, 16) {
            return Err(Error::Input);
        }
        let s = self.connected(owner).await?;
        let response = self
            .gateway()?
            .post::<TopupOrder>("topup/create", &request, Some(&s.credentials.access_token))
            .await;
        let result = self.invalidate_auth(&s, response).await?.0;
        order(&result, &s, true)?;
        if result.amount != request.amount
            || result.payment_method != request.payment_method
            || result.quote_version != request.quote_version
        {
            return Err(Error::Protocol);
        }
        self.check_generation(owner, s.generation).await?;
        Ok(result)
    }
    pub async fn topup_orders(
        &self,
        owner: &str,
        query: CloudAccountTopupOrdersQuery,
    ) -> Result<CloudAccountTopupOrdersResponse> {
        if query.order_id.len() > 64
            || !(0..=JS_MAX).contains(&query.before_id)
            || query.page_size > 50
            || !matches!(query.status.as_str(), "" | "pending" | "paid" | "failed" | "expired")
        {
            return Err(Error::Input);
        }
        let s = self.connected(owner).await?;
        let response = self
            .gateway()?
            .post::<TopupOrders>("topup/orders", &query, Some(&s.credentials.access_token))
            .await;
        let result = self.invalidate_auth(&s, response).await?.0;
        let size = if query.page_size == 0 { 20 } else { query.page_size };
        if result.items.len() > size as usize
            || !(0..=JS_MAX).contains(&result.next_before_id)
            || result.items.is_empty() && (result.has_more || result.next_before_id != 0)
            || !result.items.is_empty() && result.next_before_id == 0
            || query.before_id > 0 && !result.items.is_empty() && result.next_before_id >= query.before_id
        {
            return Err(Error::Protocol);
        }
        for item in &result.items {
            order(item, &s, false)?;
            if !query.order_id.is_empty() && item.order_id != query.order_id {
                return Err(Error::Protocol);
            }
            let status = match item.status {
                CloudAccountTopupStatus::Pending => "pending",
                CloudAccountTopupStatus::Paid => "paid",
                CloudAccountTopupStatus::Failed => "failed",
                CloudAccountTopupStatus::Expired => "expired",
            };
            if !query.status.is_empty() && query.status != status {
                return Err(Error::Protocol);
            }
        }
        self.check_generation(owner, s.generation).await?;
        Ok(result)
    }
}
