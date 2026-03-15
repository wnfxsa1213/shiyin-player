/// Normalize an artist name for cross-source matching.
///
/// Applies: lowercase, trim, collapse whitespace, strip common punctuation.
/// This enables matching "周杰伦" across Netease and QQ Music, as well as
/// "Jay Chou" vs "jay chou" or "JAY CHOU".
pub fn normalize_artist(name: &str) -> String {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return String::new();
    }

    let lowered = trimmed.to_lowercase();

    // Collapse multiple whitespace/separators into a single space
    let mut result = String::with_capacity(lowered.len());
    let mut prev_space = false;
    for ch in lowered.chars() {
        if ch.is_whitespace() || ch == '/' || ch == '、' || ch == '·' {
            if !prev_space && !result.is_empty() {
                result.push(' ');
                prev_space = true;
            }
        } else {
            result.push(ch);
            prev_space = false;
        }
    }

    // Trim trailing space
    if result.ends_with(' ') {
        result.pop();
    }

    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_normalize_basic() {
        assert_eq!(normalize_artist("Jay Chou"), "jay chou");
        assert_eq!(normalize_artist("  jay  chou  "), "jay chou");
        assert_eq!(normalize_artist("JAY CHOU"), "jay chou");
    }

    #[test]
    fn test_normalize_chinese() {
        assert_eq!(normalize_artist("周杰伦"), "周杰伦");
        assert_eq!(normalize_artist(" 周杰伦 "), "周杰伦");
    }

    #[test]
    fn test_normalize_separators() {
        assert_eq!(normalize_artist("A/B"), "a b");
        assert_eq!(normalize_artist("A、B"), "a b");
        assert_eq!(normalize_artist("A·B"), "a b");
    }

    #[test]
    fn test_normalize_empty() {
        assert_eq!(normalize_artist(""), "");
        assert_eq!(normalize_artist("   "), "");
    }
}
