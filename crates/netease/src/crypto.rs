use aes::Aes128;
use base64::{engine::general_purpose, Engine as _};
use cbc::cipher::{block_padding::Pkcs7, BlockEncryptMut, KeyIvInit};
use cbc::Encryptor;
use rand::distributions::Alphanumeric;
use rand::Rng;
use rsa::BigUint;
use rustplayer_core::SourceError;
use std::sync::OnceLock;

const PRESET_KEY: &str = "0CoJUm6Qyw8W8jud";
const IV: &str = "0102030405060708";
const PUB_KEY: &str = "010001";
const MODULUS: &str = "00e0b509f6259df8642dbc35662901477df22677ec152b5ff68ace615bb7b725152b3ab17a876aea8a5aa76d2e417629ec4ee341f56135fccf695280104e0312ecbda92557c93870114af6c9d05c4f7f0c3685b7a46bee255932575cce10b424d813cfe4875d3e82047b97ddef52741d546b8e289dc6935b3ece0462db0a22b8e7";

fn aes_cbc_encrypt(plain: &str, key: &str) -> Result<String, SourceError> {
    let cipher = Encryptor::<Aes128>::new_from_slices(key.as_bytes(), IV.as_bytes())
        .map_err(|e| SourceError::Internal(format!("aes init: {e}")))?;
    let plain_bytes = plain.as_bytes();
    let block_size = 16;
    let padded_len = plain_bytes.len() + (block_size - plain_bytes.len() % block_size);
    let mut buf = vec![0u8; padded_len];
    buf[..plain_bytes.len()].copy_from_slice(plain_bytes);
    let encrypted = cipher.encrypt_padded_mut::<Pkcs7>(&mut buf, plain_bytes.len())
        .map_err(|_| SourceError::Internal("aes encrypt failed".into()))?;
    Ok(general_purpose::STANDARD.encode(encrypted))
}

fn random_key() -> String {
    rand::thread_rng()
        .sample_iter(Alphanumeric)
        .take(16)
        .map(|b| b as char)
        .collect()
}

static RSA_EXP: OnceLock<BigUint> = OnceLock::new();
static RSA_MODULUS: OnceLock<BigUint> = OnceLock::new();

fn rsa_encrypt(sec_key: &str) -> Result<String, SourceError> {
    let reversed: String = sec_key.chars().rev().collect();
    let hex: String = reversed.as_bytes().iter().map(|b| format!("{b:02x}")).collect();

    let text = BigUint::parse_bytes(hex.as_bytes(), 16)
        .ok_or_else(|| SourceError::Internal("rsa text parse failed".into()))?;
    let exp = RSA_EXP.get_or_init(|| {
        BigUint::parse_bytes(PUB_KEY.as_bytes(), 16).expect("invalid RSA PUB_KEY constant")
    });
    let modulus = RSA_MODULUS.get_or_init(|| {
        BigUint::parse_bytes(MODULUS.as_bytes(), 16).expect("invalid RSA MODULUS constant")
    });

    let enc = text.modpow(exp, modulus);
    let mut enc_hex = enc.to_str_radix(16);
    if enc_hex.len() < 256 {
        enc_hex = format!("{:0>256}", enc_hex);
    }
    Ok(enc_hex)
}

pub fn weapi_encrypt(text: &str) -> Result<(String, String), SourceError> {
    let sec_key = random_key();
    let enc_text = aes_cbc_encrypt(text, PRESET_KEY)?;
    let params = aes_cbc_encrypt(&enc_text, &sec_key)?;
    let enc_sec_key = rsa_encrypt(&sec_key)?;
    Ok((params, enc_sec_key))
}
