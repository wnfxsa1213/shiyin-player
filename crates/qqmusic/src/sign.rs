use md5::{Md5, Digest};
use rand::RngCore;
use serde_json::Value;

pub fn generate_guid() -> String {
    let mut buf = [0u8; 16];
    rand::thread_rng().fill_bytes(&mut buf);
    buf.iter().map(|b| format!("{b:02x}")).collect()
}

pub fn sign_request(data: &Value) -> String {
    let text = data.to_string();
    let hash = Md5::digest(text.as_bytes());
    format!("{hash:x}")
}
