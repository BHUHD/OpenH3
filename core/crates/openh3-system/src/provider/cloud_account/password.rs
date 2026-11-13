use super::{CloudAccountError as Error, Result, wire::Capabilities};
use aes_gcm::{
    Aes256Gcm, KeyInit, Nonce,
    aead::{Aead, Payload},
};
use base64::{Engine, engine::general_purpose::STANDARD};
use rsa::{Oaep, RsaPublicKey, pkcs8::DecodePublicKey, rand_core::OsRng, traits::PublicKeyParts};
use serde_json::{Value, json};

pub(super) fn password_fields(password: &str, policy: &Capabilities, new_password: bool) -> Result<Value> {
    if password.is_empty()
        || password.len() > 512
        || (new_password
            && (password.chars().count() < policy.password_min_length
                || password.chars().count() > policy.password_max_length))
    {
        return Err(Error::Input);
    }
    if !policy.password_encryption_required {
        return Ok(json!({"password": password}));
    }
    if !policy.password_encryption_formats.iter().any(|v| v == "v2")
        || policy.password_encryption_key_id.is_empty()
        || policy.password_encryption_key_id.len() > 64
    {
        return Err(Error::Policy);
    }
    let key = RsaPublicKey::from_public_key_pem(&policy.password_encryption_public_key).map_err(|_| Error::Protocol)?;
    if key.n().bits() < 2048 || key.n().bits() > 8192 {
        return Err(Error::Protocol);
    }
    let mut aes_key = [0u8; 32];
    let mut nonce = [0u8; 12];
    getrandom::getrandom(&mut aes_key).map_err(|_| Error::Storage)?;
    getrandom::getrandom(&mut nonce).map_err(|_| Error::Storage)?;
    let wrapped = key
        .encrypt(
            &mut OsRng,
            Oaep::new_with_label::<sha2::Sha256, _>("password-v2"),
            &aes_key,
        )
        .map_err(|_| Error::Protocol)?;
    let aad = format!("password-v2:{}", policy.password_encryption_key_id);
    let ciphertext = Aes256Gcm::new_from_slice(&aes_key)
        .map_err(|_| Error::Protocol)?
        .encrypt(
            Nonce::from_slice(&nonce),
            Payload {
                msg: password.as_bytes(),
                aad: aad.as_bytes(),
            },
        )
        .map_err(|_| Error::Protocol)?;
    Ok(
        json!({"password_encrypted": format!("v2.{}.{}.{}", STANDARD.encode(wrapped), STANDARD.encode(nonce), STANDARD.encode(ciphertext)), "encryption_key_id": policy.password_encryption_key_id}),
    )
}
