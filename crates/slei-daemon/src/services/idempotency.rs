pub(crate) fn namespaced_key(namespace: &str, key: &str) -> Option<String> {
    let key = key.trim();
    if key.is_empty() {
        None
    } else {
        Some(format!("{namespace}:{key}"))
    }
}
