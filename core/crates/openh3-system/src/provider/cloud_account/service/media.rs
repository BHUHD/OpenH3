//! Grant-bound media catalog, inference, and resumable video job handles.
use super::*;
use base64::{Engine, engine::general_purpose::STANDARD};
use sha2::{Digest, Sha256};
use std::{collections::HashSet, future::Future, time::Duration};

const MIB: usize = 1024 * 1024;
const IMAGE_LIMIT: usize = 32 * MIB;
const REFERENCE_LIMIT: usize = 8 * MIB;
const VIDEO_LIMIT: usize = 256 * MIB;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct MediaCatalog {
    models: Vec<CloudMediaModel>,
}
#[derive(Deserialize)]
struct ImageResult {
    data: [ImageData; 1],
}
#[derive(Deserialize)]
struct ImageData {
    b64_json: String,
}
#[derive(Deserialize)]
struct RemoteJob {
    id: String,
    status: CloudMediaStatus,
}

fn media_account_key(owner: &str, issuer: &str, subject: &str) -> Result<String> {
    let identity =
        serde_json::to_vec(&("openh3:media:account:v1", owner, issuer, subject)).map_err(|_| Error::Storage)?;
    Ok(format!("{:x}", Sha256::digest(identity)))
}

fn binding_id(s: &Stored) -> Result<String> {
    if !label(&s.account.id, 64) || contains_grant_secret(&s.account.id, s) {
        return Err(Error::Protocol);
    }
    // Length-delimited JSON fields prevent ambiguity between owners, issuers or devices.
    let identity = serde_json::to_vec(&(
        &s.owner,
        &s.issuer,
        &s.account.id,
        &s.provider_id,
        &s.credentials.device_id,
        s.generation,
    ))
    .map_err(|_| Error::Storage)?;
    Ok(format!("{:x}", Sha256::digest(identity)))
}

fn label(value: &str, max: usize) -> bool {
    !value.is_empty() && value.len() <= max && value.trim() == value && !value.chars().any(char::is_control)
}

fn validate_catalog(models: &[CloudMediaModel], grant: &Stored) -> Result<()> {
    let mut ids = HashSet::new();
    if models.len() > 2048 {
        return Err(Error::Protocol);
    }
    for m in models {
        if !label(&m.model_id, 256)
            || !label(&m.display_name, 256)
            || contains_grant_secret(&m.model_id, grant)
            || contains_grant_secret(&m.display_name, grant)
            || !ids.insert(&m.model_id)
            || m.capabilities.is_empty()
            || m.capabilities.iter().enumerate().any(|(i, cap)| {
                m.capabilities[..i].contains(cap)
                    || !matches!(
                        (m.kind, cap),
                        (CloudMediaKind::Image, CloudMediaCapability::TextToImage)
                            | (
                                CloudMediaKind::Video,
                                CloudMediaCapability::TextToVideo | CloudMediaCapability::ImageToVideo
                            )
                    )
            })
        {
            return Err(Error::Protocol);
        }
    }
    Ok(())
}

fn media_body(model: String, prompt: String, size: Option<String>, image: bool) -> Result<serde_json::Value> {
    if !label(&model, 256) || prompt.trim().is_empty() || prompt.len() > 32000 || prompt.contains('\0') {
        return Err(Error::Input);
    }
    let mut body = json!({"model":model,"prompt":prompt});
    if let Some(size) = size {
        let dimension = |s: &str| {
            !s.starts_with('0')
                && s.bytes().all(|b| b.is_ascii_digit())
                && s.parse::<u32>().is_ok_and(|n| (1..=4096).contains(&n))
        };
        if !(image && size == "auto" || size.split_once('x').is_some_and(|(w, h)| dimension(w) && dimension(h))) {
            return Err(Error::Input);
        }
        body["size"] = size.into();
    }
    Ok(body)
}

fn image_mime(bytes: &[u8]) -> Option<&'static str> {
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        Some("image/png")
    } else if bytes.starts_with(&[0xff, 0xd8, 0xff]) {
        Some("image/jpeg")
    } else if bytes.starts_with(b"RIFF") && bytes.get(8..12) == Some(b"WEBP") {
        Some("image/webp")
    } else {
        None
    }
}
fn decode_image(data: &str, limit: usize) -> Option<(&'static str, Vec<u8>)> {
    if data.len() > limit.div_ceil(3) * 4 {
        return None;
    }
    let bytes = STANDARD.decode(data).ok()?;
    if bytes.len() > limit {
        return None;
    }
    Some((image_mime(&bytes)?, bytes))
}
fn task_id(id: &str) -> bool {
    id.strip_prefix("task_").is_some_and(|suffix| {
        (1..=128).contains(&suffix.len())
            && suffix
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
    })
}

impl CloudAccountService {
    async fn media_catalog_for(&self, s: &Stored) -> Result<Vec<CloudMediaModel>> {
        let response = self
            .gateway()?
            .get::<MediaCatalog>("media-models", Some(&s.credentials.access_token))
            .await;
        let models = match self.invalidate_auth(s, response).await {
            Ok(catalog) => catalog.models,
            Err(Error::MediaCatalogMissing) => vec![],
            Err(error) => return Err(error),
        };
        validate_catalog(&models, s)?;
        self.check_generation(&s.owner, s.generation).await?;
        Ok(models)
    }

    pub async fn media_models(&self, owner: &str) -> Result<CloudMediaModels> {
        let s = self.connected(owner).await?;
        let models = self.media_catalog_for(&s).await?;
        Ok(CloudMediaModels {
            binding: binding_id(&s)?,
            account_key: media_account_key(&s.owner, &s.issuer, &s.account.id)?,
            account_id: s.account.id,
            models,
        })
    }

    /// Check access to a local artifact without refreshing credentials or contacting the gateway.
    pub async fn media_session(&self, owner: &str) -> Result<CloudMediaSession> {
        let s = self.read(owner).await?.ok_or(Error::Authentication)?;
        if s.inference_key.is_none() || s.credentials.session_expires_at <= now() {
            return Err(Error::Authentication);
        }
        self.check_generation(owner, s.generation).await?;
        Ok(CloudMediaSession {
            binding: binding_id(&s)?,
            account_key: media_account_key(&s.owner, &s.issuer, &s.account.id)?,
            account_id: s.account.id,
        })
    }

    async fn media_grant(&self, owner: &str, expected: &str) -> Result<Stored> {
        let previous = self.read(owner).await?.ok_or(Error::Authentication)?;
        if binding_id(&previous)? != expected {
            return Err(Error::Conflict);
        }
        self.usable_grant(previous).await
    }

    async fn admitted(&self, owner: &str, binding: &str, model: &str, cap: CloudMediaCapability) -> Result<Stored> {
        let s = self.media_grant(owner, binding).await?;
        let kind = match cap {
            CloudMediaCapability::TextToImage => CloudMediaKind::Image,
            CloudMediaCapability::TextToVideo | CloudMediaCapability::ImageToVideo => CloudMediaKind::Video,
        };
        let catalog = self.media_catalog_for(&s).await?;
        let selected = catalog
            .iter()
            .find(|m| m.model_id == model && m.kind == kind)
            .ok_or(Error::MediaModelUnavailable)?;
        if !selected.capabilities.contains(&cap) {
            return Err(Error::MediaCapabilityUnsupported);
        }
        Ok(s)
    }

    async fn while_connected<T>(&self, s: &Stored, action: impl Future<Output = Result<T>>) -> Result<T> {
        let bound = self.inference_binding(&s.owner, &s.provider_id).await?;
        if bound.generation != s.generation || bound.subject != s.account.id || bound.issuer != s.issuer {
            return Err(Error::Conflict);
        }
        let mut lifetime = bound.lifetime;
        let remaining = s.credentials.session_expires_at.saturating_sub(now());
        if remaining <= 0 {
            return Err(Error::Authentication);
        }
        let result = tokio::select! {
            biased;
            _ = lifetime.wait_for(|invalid| *invalid) => return Err(Error::Conflict),
            _ = tokio::time::sleep(Duration::from_secs(remaining as u64)) => return Err(Error::Authentication),
            result = action => result,
        };
        self.check_generation(&s.owner, s.generation).await?;
        // An inference 401 can come from the supplier. Only a native account
        // response can invalidate the grant; the paid request is never replayed.
        if matches!(result, Err(Error::Authentication)) {
            let current = self.media_grant(&s.owner, &binding_id(s)?).await?;
            let response = self
                .gateway()?
                .get::<Me>("me", Some(&current.credentials.access_token))
                .await;
            let profile = self.invalidate_auth(&current, response).await?;
            self.check_generation(&s.owner, s.generation).await?;
            if profile.account.id != s.account.id {
                return Err(Error::Protocol);
            }
            return Err(Error::Policy);
        }
        result
    }

    async fn infer(&self, s: &Stored, path: &str, body: Option<&serde_json::Value>, limit: usize) -> Result<Vec<u8>> {
        let key = s.inference_key.as_deref().ok_or(Error::Authentication)?;
        self.while_connected(s, self.gateway()?.media_call(path, key, body, limit))
            .await
    }

    fn transfer_slot(&self) -> Result<tokio::sync::SemaphorePermit<'_>> {
        self.media_transfers
            .try_acquire()
            .map_err(|_| Error::RateLimited { retry_after: Some(2) })
    }

    pub async fn generate_image(&self, owner: &str, input: CloudMediaImageRequest) -> Result<(&'static str, Vec<u8>)> {
        let _slot = self.transfer_slot()?;
        let model = input.model;
        let mut body = media_body(model.clone(), input.prompt, input.size, true)?;
        body["response_format"] = "b64_json".into();
        body["n"] = 1.into();
        let s = self
            .admitted(owner, &input.binding, &model, CloudMediaCapability::TextToImage)
            .await?;
        let bytes = self
            .infer(
                &s,
                "v1/images/generations",
                Some(&body),
                IMAGE_LIMIT.div_ceil(3) * 4 + 65536,
            )
            .await?;
        let output: ImageResult = serde_json::from_slice(&bytes).map_err(|_| Error::Protocol)?;
        drop(bytes);
        let image = decode_image(&output.data[0].b64_json, IMAGE_LIMIT).ok_or(Error::Protocol)?;
        self.check_generation(owner, s.generation).await?;
        Ok(image)
    }

    /// A domain-separated encryption key keeps arbitrary external task IDs out of
    /// local storage, and prevents a caller from turning status into a generic proxy.
    fn media_job_key(&self) -> [u8; 32] {
        Sha256::new()
            .chain_update(b"openh3:media:job:v1\0")
            .chain_update(self.encryption_key)
            .finalize()
            .into()
    }

    pub async fn create_video(&self, owner: &str, input: CloudMediaVideoRequest) -> Result<CloudMediaJob> {
        let _slot = self.transfer_slot()?;
        let model = input.model;
        let mut body = media_body(model.clone(), input.prompt, input.size, false)?;
        if let Some(seconds) = input.seconds {
            if !(1..=3600).contains(&seconds) {
                return Err(Error::Input);
            }
            body["seconds"] = seconds.to_string().into();
        }
        let cap = if let Some(reference) = input.reference {
            let (mime, bytes) = decode_image(&reference.data, REFERENCE_LIMIT).ok_or(Error::Input)?;
            if mime != reference.mime_type {
                return Err(Error::Input);
            }
            drop(bytes);
            body["input_reference"] = format!("data:{mime};base64,{}", reference.data).into();
            CloudMediaCapability::ImageToVideo
        } else {
            CloudMediaCapability::TextToVideo
        };
        let s = self.admitted(owner, &input.binding, &model, cap).await?;
        let bytes = self.infer(&s, "v1/videos", Some(&body), 65536).await?;
        let remote: RemoteJob = serde_json::from_slice(&bytes).map_err(|_| Error::Protocol)?;
        if !task_id(&remote.id) {
            return Err(Error::Protocol);
        }
        let payload = serde_json::to_string(&(input.binding, remote.id)).map_err(|_| Error::Storage)?;
        let job_id = encrypt_string(&payload, &self.media_job_key()).map_err(|_| Error::Storage)?;
        Ok(CloudMediaJob {
            job_id,
            status: remote.status,
        })
    }

    async fn open_job(&self, owner: &str, input: &CloudMediaJobRequest) -> Result<(Stored, String)> {
        if input.job_id.len() > 1024 {
            return Err(Error::Input);
        }
        let s = self.media_grant(owner, &input.binding).await?;
        let payload = decrypt_string(&input.job_id, &self.media_job_key()).map_err(|_| Error::MediaJobNotFound)?;
        let (binding, id): (String, String) = serde_json::from_str(&payload).map_err(|_| Error::MediaJobNotFound)?;
        if binding != input.binding || !task_id(&id) {
            return Err(Error::MediaJobNotFound);
        }
        Ok((s, id))
    }

    pub async fn video_status(&self, owner: &str, input: CloudMediaJobRequest) -> Result<CloudMediaJob> {
        let (s, id) = self.open_job(owner, &input).await?;
        let bytes = self.infer(&s, &format!("v1/videos/{id}"), None, 65536).await?;
        let remote: RemoteJob = serde_json::from_slice(&bytes).map_err(|_| Error::Protocol)?;
        if remote.id != id {
            return Err(Error::Protocol);
        }
        Ok(CloudMediaJob {
            job_id: input.job_id,
            status: remote.status,
        })
    }

    pub async fn video_content(&self, owner: &str, input: CloudMediaJobRequest) -> Result<(&'static str, Vec<u8>)> {
        let _slot = self.transfer_slot()?;
        let (s, id) = self.open_job(owner, &input).await?;
        let bytes = self
            .infer(&s, &format!("v1/videos/{id}/content"), None, VIDEO_LIMIT)
            .await?;
        if bytes.get(4..8) != Some(b"ftyp") || bytes.len() < 12 {
            return Err(Error::Protocol);
        }
        Ok(("video/mp4", bytes))
    }
}
