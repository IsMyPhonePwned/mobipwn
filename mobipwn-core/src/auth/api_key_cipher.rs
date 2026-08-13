use aes_gcm::{
    aead::{Aead, AeadCore, KeyInit, OsRng},
    Aes256Gcm, Nonce,
};
use sha2::{Digest, Sha256};

const NONCE_LEN: usize = 12;

fn master_key() -> [u8; 32] {
    let material = std::env::var("MOBIPWN_API_KEY_ENCRYPTION_SECRET")
        .ok()
        .filter(|s| !s.is_empty())
        .or_else(|| {
            std::env::var("MOBIPWN_ADMIN_PASSWORD")
                .ok()
                .filter(|s| !s.is_empty())
        })
        .unwrap_or_else(|| {
            tracing::warn!(
                "MOBIPWN_API_KEY_ENCRYPTION_SECRET unset — using dev fallback; set a secret in production"
            );
            "mobipwn-dev-api-key-encryption".into()
        });
    let mut h = Sha256::new();
    h.update(b"mobipwn-api-key-v1:");
    h.update(material.as_bytes());
    h.finalize().into()
}

pub fn encrypt_api_key_token(plaintext: &str) -> anyhow::Result<String> {
    let cipher = Aes256Gcm::new_from_slice(&master_key())
        .map_err(|e| anyhow::anyhow!("cipher init: {e}"))?;
    let nonce = Aes256Gcm::generate_nonce(&mut OsRng);
    let ciphertext = cipher
        .encrypt(&nonce, plaintext.as_bytes())
        .map_err(|e| anyhow::anyhow!("encrypt: {e}"))?;
    let mut out = nonce.to_vec();
    out.extend(ciphertext);
    Ok(base64::Engine::encode(
        &base64::engine::general_purpose::STANDARD,
        out,
    ))
}

pub fn decrypt_api_key_token(encoded: &str) -> anyhow::Result<String> {
    let raw = base64::Engine::decode(&base64::engine::general_purpose::STANDARD, encoded.trim())
        .map_err(|e| anyhow::anyhow!("invalid ciphertext encoding: {e}"))?;
    if raw.len() <= NONCE_LEN {
        anyhow::bail!("ciphertext too short");
    }
    let (nonce_bytes, ciphertext) = raw.split_at(NONCE_LEN);
    let nonce = Nonce::from_slice(nonce_bytes);
    let cipher = Aes256Gcm::new_from_slice(&master_key())
        .map_err(|e| anyhow::anyhow!("cipher init: {e}"))?;
    let plain = cipher
        .decrypt(nonce, ciphertext)
        .map_err(|_| anyhow::anyhow!("decrypt failed — wrong encryption secret?"))?;
    String::from_utf8(plain).map_err(|e| anyhow::anyhow!("utf8: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn roundtrip_token() {
        let enc = encrypt_api_key_token("mpwn_deadbeef").unwrap();
        assert_eq!(decrypt_api_key_token(&enc).unwrap(), "mpwn_deadbeef");
    }
}
