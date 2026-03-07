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

/// Calculate g_tk from skey or p_skey for QQ Music API authentication
/// Algorithm: hash = 5381; for each char: hash += (hash << 5) + char_code
pub fn calculate_g_tk(skey: &str) -> i64 {
    let mut hash: i64 = 5381;
    for ch in skey.chars() {
        hash = hash.wrapping_add((hash << 5).wrapping_add(ch as i64));
    }
    hash & 0x7fffffff // Keep positive
}

/// Extract uin from cookie string
/// Cookie format: "uin=o123456; other=value; ..."
pub fn extract_uin_from_cookie(cookie: &str) -> Option<String> {
    for pair in cookie.split(';') {
        let pair = pair.trim();
        if let Some(stripped) = pair.strip_prefix("uin=") {
            let uin = stripped.trim();
            // QQ Music uin format: "o123456" or "123456"
            // Remove 'o' prefix if present
            return Some(uin.strip_prefix('o').unwrap_or(uin).to_string());
        }
        // Also try p_uin as fallback
        if let Some(stripped) = pair.strip_prefix("p_uin=") {
            let uin = stripped.trim();
            return Some(uin.strip_prefix('o').unwrap_or(uin).to_string());
        }
    }
    None
}

/// Extract a specific cookie value by key name from a cookie string.
/// Cookie format: "key1=value1; key2=value2; ..."
pub fn extract_cookie_value(cookie: &str, key: &str) -> Option<String> {
    let prefix = format!("{key}=");
    for pair in cookie.split(';') {
        let pair = pair.trim();
        if let Some(stripped) = pair.strip_prefix(&prefix) {
            let v = stripped.trim();
            if !v.is_empty() {
                return Some(v.to_string());
            }
        }
    }
    None
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SkeySource {
    /// 来自 `p_skey`（优先）
    PSkey,
    /// 来自 `skey`
    Skey,
    /// 未找到任何可用 key（现代登录使用 qqmusic_key，由 musicu_post 直接提取）
    None,
}

/// 从 cookie 中选择用于计算传统 g_tk 的 key，并返回来源。
///
/// 优先级：p_skey > skey > None
///
/// 背景：老式登录（PC 客户端、浏览器）会下发 p_skey/skey 用于 CSRF 计算。
/// 现代 WebView 登录不下发这两者，而是提供 qqmusic_key；
/// musicu_post 会直接读取 qqmusic_key 计算 g_tk 和 g_tk_new_20200303。
///
/// 安全约束：本函数不打印任何 cookie value，调用方只能记录来源与长度。
pub fn extract_skey_selection(cookie: &str) -> (Option<String>, SkeySource) {
    let mut p_skey: Option<String> = None;
    let mut skey: Option<String> = None;

    for pair in cookie.split(';') {
        let pair = pair.trim();

        if p_skey.is_none() {
            if let Some(stripped) = pair.strip_prefix("p_skey=") {
                let v = stripped.trim();
                if !v.is_empty() {
                    p_skey = Some(v.to_string());
                    continue;
                }
            }
        }

        if skey.is_none() {
            if let Some(stripped) = pair.strip_prefix("skey=") {
                let v = stripped.trim();
                if !v.is_empty() {
                    skey = Some(v.to_string());
                    continue;
                }
            }
        }
    }

    if let Some(v) = p_skey {
        return (Some(v), SkeySource::PSkey);
    }
    if let Some(v) = skey {
        return (Some(v), SkeySource::Skey);
    }
    (None, SkeySource::None)
}

/// Extract skey or p_skey from cookie string for g_tk calculation.
/// Returns None for modern WebView logins that only provide qqmusic_key.
/// In that case, musicu_post uses qqmusic_key directly.
pub fn extract_skey_from_cookie(cookie: &str) -> Option<String> {
    let (value, source) = extract_skey_selection(cookie);
    match source {
        SkeySource::PSkey => log::debug!("using p_skey for g_tk calculation"),
        SkeySource::Skey => log::debug!("using skey for g_tk calculation"),
        SkeySource::None => {
            log::debug!("no p_skey/skey found; musicu_post will use qqmusic_key for g_tk");
        }
    }
    value
}

/// Single-pass cookie parser for QQ Music API fields.
/// Avoids repeated O(n) traversals of the cookie string in hot paths like `musicu_post`.
pub struct CookieView<'a> {
    pub uin: Option<&'a str>,
    pub skey: Option<&'a str>,
    pub p_skey: Option<&'a str>,
    pub qqmusic_key: Option<&'a str>,
    pub login_type: Option<&'a str>,
    pub p_lskey: Option<&'a str>,
    pub lskey: Option<&'a str>,
}

impl<'a> CookieView<'a> {
    pub fn parse(cookie: &'a str) -> Self {
        let mut view = Self {
            uin: None, skey: None, p_skey: None,
            qqmusic_key: None, login_type: None,
            p_lskey: None, lskey: None,
        };
        for pair in cookie.split(';') {
            let pair = pair.trim();
            let Some((key, value)) = pair.split_once('=') else { continue };
            let value = value.trim();
            if value.is_empty() { continue; }
            match key.trim() {
                "uin" | "p_uin" => if view.uin.is_none() { view.uin = Some(value) },
                "skey" => if view.skey.is_none() { view.skey = Some(value) },
                "p_skey" => if view.p_skey.is_none() { view.p_skey = Some(value) },
                "qqmusic_key" => if view.qqmusic_key.is_none() { view.qqmusic_key = Some(value) },
                "login_type" => if view.login_type.is_none() { view.login_type = Some(value) },
                "p_lskey" => if view.p_lskey.is_none() { view.p_lskey = Some(value) },
                "lskey" => if view.lskey.is_none() { view.lskey = Some(value) },
                _ => {}
            }
        }
        view
    }

    /// Get uin with 'o' prefix stripped (numeric form).
    pub fn uin_numeric(&self) -> Option<&'a str> {
        self.uin.map(|u| u.strip_prefix('o').unwrap_or(u))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extract_skey_prefers_p_skey_over_skey() {
        let cookie = "uin=o123; skey=AAA; p_skey=BBB; qm_keyst=CCC";
        let (v, src) = extract_skey_selection(cookie);
        assert_eq!(src, SkeySource::PSkey);
        assert_eq!(v.as_deref(), Some("BBB"));
    }

    #[test]
    fn extract_skey_falls_back_to_skey() {
        let cookie = "uin=o123; skey=AAA; qm_keyst=CCC";
        let (v, src) = extract_skey_selection(cookie);
        assert_eq!(src, SkeySource::Skey);
        assert_eq!(v.as_deref(), Some("AAA"));
    }

    #[test]
    fn extract_skey_returns_none_without_p_skey_or_skey() {
        let cookie = "uin=o123; qm_keyst=CCC; qqmusic_key=DDD";
        let (v, src) = extract_skey_selection(cookie);
        assert_eq!(src, SkeySource::None);
        assert_eq!(v, None);
    }

    #[test]
    fn extract_skey_ignores_empty_values() {
        let cookie = "p_skey=; skey=AAA; qm_keyst=";
        let (v, src) = extract_skey_selection(cookie);
        assert_eq!(src, SkeySource::Skey);
        assert_eq!(v.as_deref(), Some("AAA"));
    }

    #[test]
    fn calculate_g_tk_golden_case() {
        // golden：按当前实现（djb 风格 + 0x7fffffff）计算
        assert_eq!(calculate_g_tk("test"), 2090756197);
    }
}
