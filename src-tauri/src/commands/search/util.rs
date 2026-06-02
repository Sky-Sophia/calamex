pub(super) fn require_replacement_query(query: &str) -> Result<String, String> {
    let query = query.trim().to_string();
    if query.is_empty() {
        return Err("替换前请先输入搜索内容。".to_string());
    }
    Ok(query)
}

pub(super) fn count_to_u32(value: usize, label: &str) -> Result<u32, String> {
    u32::try_from(value).map_err(|_| format!("{label}超出支持范围。"))
}

pub(super) fn u64_to_u32(value: u64, label: &str) -> Result<u32, String> {
    u32::try_from(value).map_err(|_| format!("{label}超出支持范围。"))
}

pub(super) fn i64_to_i32(value: i64, label: &str) -> Result<i32, String> {
    i32::try_from(value).map_err(|_| format!("{label}超出支持范围。"))
}

pub(super) fn hash_text(value: &str) -> String {
    format!("blake3:{}", blake3::hash(value.as_bytes()).to_hex())
}

pub(super) fn trim_line(line: &str) -> String {
    line.trim_end_matches(['\r', '\n']).to_string()
}

pub(super) fn byte_to_char_offset(value: &str, byte_offset: usize) -> usize {
    value[..byte_offset.min(value.len())].chars().count()
}
