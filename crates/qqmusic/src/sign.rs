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

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SkeySource {
    /// 来自 `p_skey`（优先）
    PSkey,
    /// 来自 `skey`
    Skey,
    /// 来自 `qm_keyst`（仅用于部分 QQ 客户端快捷登录的兜底，可能不被部分接口接受）
    QmKeyst,
    /// 未找到任何可用 key
    None,
}

/// 从 cookie 中选择用于计算 g_tk 的 key，并返回来源。
///
/// 设计原因（任务 D.1 + 诊断需求）：
/// - QQ 音乐/腾讯系接口通常更偏向使用 `p_skey` 计算 g_tk
/// - 若缺失再回退到 `skey`
/// - 最后才尝试 `qm_keyst`（历史兜底，但在本问题中已观察到可能导致 40000 unauthorized）
///
/// 安全约束：
/// - 本函数不打印任何 cookie value；调用方只能记录来源与长度。
pub fn extract_skey_selection(cookie: &str) -> (Option<String>, SkeySource) {
    let mut p_skey: Option<String> = None;
    let mut skey: Option<String> = None;
    let mut qm_keyst: Option<String> = None;

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

        if qm_keyst.is_none() {
            if let Some(stripped) = pair.strip_prefix("qm_keyst=") {
                let v = stripped.trim();
                if !v.is_empty() {
                    qm_keyst = Some(v.to_string());
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
    if let Some(v) = qm_keyst {
        return (Some(v), SkeySource::QmKeyst);
    }
    (None, SkeySource::None)
}

/// Extract skey or p_skey from cookie string for g_tk calculation
/// Fallback to qm_keyst for QQ client quick login
pub fn extract_skey_from_cookie(cookie: &str) -> Option<String> {
    // 任务 D.1：优先级调整为 `p_skey → skey → qm_keyst`，并记录选择来源（不打印 value）。
    let (value, source) = extract_skey_selection(cookie);
    match source {
        SkeySource::PSkey => log::debug!("using p_skey for g_tk calculation"),
        SkeySource::Skey => log::debug!("using skey for g_tk calculation"),
        SkeySource::QmKeyst => log::info!("using qm_keyst as skey fallback for g_tk calculation"),
        SkeySource::None => {}
    }
    value
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
    fn extract_skey_falls_back_to_qm_keyst() {
        let cookie = "uin=o123; qm_keyst=CCC";
        let (v, src) = extract_skey_selection(cookie);
        assert_eq!(src, SkeySource::QmKeyst);
        assert_eq!(v.as_deref(), Some("CCC"));
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
