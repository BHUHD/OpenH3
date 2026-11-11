use super::*;
use std::collections::HashSet;

fn require(valid: bool) -> Result<()> {
    if valid { Ok(()) } else { Err(Error::Protocol) }
}
fn text(s: &str, max: usize) -> bool {
    !s.is_empty() && s.len() <= max && !s.chars().any(char::is_control)
}
fn integer(s: &str) -> bool {
    let digits = s.strip_prefix('-').unwrap_or(s);
    !digits.is_empty() && digits.bytes().all(|c| c.is_ascii_digit()) && s.len() <= 40
}
fn decimal(s: &str) -> bool {
    let mut parts = s.split('.');
    let whole = parts.next().unwrap_or("");
    !whole.is_empty()
        && whole.bytes().all(|b| b.is_ascii_digit())
        && parts
            .next()
            .is_none_or(|p| !p.is_empty() && p.bytes().all(|b| b.is_ascii_digit()))
        && parts.next().is_none()
        && s.len() <= 128
}
fn quota(q: &CloudAccountQuota) -> bool {
    q.unit == "new_api_quota" && integer(&q.amount)
}
fn preference(s: &str) -> bool {
    matches!(
        s,
        "subscription_first" | "wallet_first" | "subscription_only" | "wallet_only"
    )
}
fn observation(start: i64, as_of: i64) -> bool {
    start >= 0 && as_of >= start
}
pub(super) fn validate_wallet(w: &CloudAccountWalletResponse) -> Result<()> {
    require(observation(w.read_started_at, w.as_of) && preference(&w.billing_preference))?;
    for (v, available) in [(&w.wallet_balance, "available"), (&w.device_limit, "limited")] {
        require(v.reason.as_ref().is_none_or(|s| text(s, 256)))?;
        require(match v.status.as_str() {
            status if status == available => v.amount.as_ref().is_some_and(quota),
            "unavailable" => v.amount.is_none(),
            "unlimited" if available == "limited" => v.amount.is_none(),
            _ => false,
        })?;
    }
    require(
        matches!(w.subscriptions.status.as_str(), "available" | "unavailable")
            && (w.subscriptions.status == "available" || w.subscriptions.items.is_empty()),
    )?;
    let mut ids = HashSet::new();
    for sub in &w.subscriptions.items {
        require(
            text(&sub.id, 64)
                && ids.insert(&sub.id)
                && matches!(sub.allowance_state.as_str(), "committed_snapshot" | "reset_pending")
                && quota(&sub.used)
                && sub.expires_at >= 0
                && sub.next_reset_at >= 0
                && if sub.unlimited {
                    sub.remaining.is_none()
                } else {
                    sub.remaining.as_ref().is_some_and(quota)
                },
        )?;
    }
    Ok(())
}
pub(super) fn validate_usage(u: &CloudAccountUsageResponse, q: &CloudAccountUsageQuery) -> Result<()> {
    require(
        observation(u.read_started_at, u.as_of)
            && u.completeness == "not_reconciled"
            && u.page == q.page
            && u.page_size == q.page_size
            && matches!(u.status.as_str(), "available" | "unavailable")
            && u.reason.as_ref().is_none_or(|s| text(s, 256)),
    )?;
    if u.status == "unavailable" {
        return require(u.items.as_ref().is_none_or(Vec::is_empty) && !u.has_more && u.reason.is_some());
    }
    let items = u.items.as_ref().ok_or(Error::Protocol)?;
    require(items.len() <= q.page_size as usize)?;
    let mut ids = HashSet::new();
    for item in items {
        require(
            text(&item.id, 64)
                && ids.insert(&item.id)
                && item.created_at >= 0
                && matches!(
                    (item.kind.as_str(), item.direction.as_str()),
                    ("consume", "debit") | ("refund", "credit")
                )
                && item.quota.as_ref().is_none_or(quota)
                && item.model.len() <= 256
                && item.request_id.len() <= 1024
                && integer(&item.prompt_tokens)
                && integer(&item.completion_tokens)
                && item.token_id.as_ref().is_none_or(|s| text(s, 64))
                && item.device_id.as_ref().is_none_or(|s| text(s, 64)),
        )?;
        if let Some(funding) = &item.funding {
            for (key, value) in funding {
                require(match key.as_str() {
                    "billing_source" => matches!(value.as_str(), "wallet" | "subscription"),
                    "billing_preference" => preference(value),
                    "subscription_id"
                    | "subscription_plan_id"
                    | "subscription_pre_consumed"
                    | "subscription_post_delta"
                    | "subscription_total"
                    | "subscription_used"
                    | "subscription_remain"
                    | "subscription_consumed"
                    | "wallet_quota_deducted" => value.parse::<i64>().is_ok(),
                    _ => false,
                })?;
            }
        }
    }
    Ok(())
}
pub(super) fn validate_catalog(c: Catalog) -> Result<CloudAccountModelsResponse> {
    require(
        matches!(c.status.as_str(), "available" | "unavailable")
            && c.reason.as_ref().is_none_or(|s| text(s, 256))
            && c.quote_semantics == "observed_rules_not_frozen_final_charge"
            && (c.status == "available" || c.models.is_empty()),
    )?;
    let mut keys = HashSet::new();
    let mut models: Vec<CloudAccountModel> = c.models.into_iter().map(Into::into).collect();
    for m in &models {
        require(
            text(&m.model_id, 255)
                && m.model_id.trim() == m.model_id
                && text(&m.display_name, 4096)
                && text(&m.provider, 4096)
                && text(&m.compatibility_version, 4096)
                && !m.evidence.is_empty()
                && m.evidence.len() <= 1_048_576
                && keys.insert((m.model_id.clone(), m.protocol.clone()))
                && !m.quotes.is_empty(),
        )?;
        let mut groups = HashSet::new();
        for q in &m.quotes {
            require(
                text(&q.group, 256)
                    && groups.insert(&q.group)
                    && decimal(&q.group_ratio)
                    && decimal(&q.quota_per_usd)
                    && q.quota_per_usd.bytes().any(|b| matches!(b, b'1'..=b'9'))
                    && text(&q.version, 4096)
                    && matches!(
                        q.cache_write_mode.as_str(),
                        "none" | "standard" | "claude_ttl" | "openai_ttl"
                    ),
            )?;
            for value in [
                &q.input,
                &q.output,
                &q.cache_read,
                &q.cache_write,
                &q.cache_write_1h,
                &q.cache_write_12h,
                &q.per_request,
                &q.implied_search_usd_per_request,
            ]
            .into_iter()
            .flatten()
            {
                require(decimal(value))?;
            }
            require(match q.kind.as_str() {
                "token" => {
                    q.unit == "USD_per_million_tokens"
                        && q.input.is_some()
                        && q.output.is_some()
                        && q.cache_read.is_some()
                        && q.cache_write.is_some()
                        && q.per_request.is_none()
                        && q.expression.is_none()
                }
                "request" => q.unit == "USD_per_request" && q.per_request.is_some() && q.expression.is_none(),
                "dynamic_expression" => {
                    q.unit == "USD_by_effective_expression"
                        && q.expression.as_ref().is_some_and(|s| !s.is_empty() && s.len() <= 65536)
                        && q.expression_semantics.as_deref()
                            == Some("mature_billing_engine_versioned_expression_then_group_ratio_and_quota_conversion")
                        && q.per_request.is_none()
                }
                _ => false,
            })?;
            if let Some(fees) = &q.function_surcharges_usd_per_1000_calls {
                for (name, value) in fees {
                    require(text(name, 1024) && decimal(value))?;
                }
            }
            if let Some(fee) = &q.conditional_violation_surcharge {
                require(
                    decimal(&fee.usd)
                        && fee.condition == "existing_violation_fee_signal_after_normal_refund_quota_rounding_applies",
                )?;
            }
        }
    }
    let mut counts = HashMap::new();
    for m in &models {
        *counts.entry(m.model_id.clone()).or_insert(0) += 1;
    }
    for m in &mut models {
        m.selection_unavailable_reason = if counts[&m.model_id] > 1 {
            Some("ambiguous_model_protocol")
        } else if m.purpose != "text"
            || m.input_capabilities != ["text"]
            || !matches!(m.protocol.as_str(), "ChatCompletions" | "Responses")
            || m.context_limit <= 0
            || m.max_output_tokens == 0
            || m.max_output_tokens > m.context_limit as u64
        {
            Some("unsupported_verification")
        } else {
            None
        }
        .map(str::to_owned);
    }
    Ok(CloudAccountModelsResponse {
        status: c.status,
        reason: c.reason,
        quote_semantics: c.quote_semantics,
        models,
    })
}
