//! Canonical MUDM platform labels (mobile + endpoint).

pub const ANDROID: &str = "android";
pub const IOS: &str = "ios";
/// Server/workstation/agent telemetry (process, network, file).
pub const ENDPOINT: &str = "endpoint";

/// Normalize ingest/vector aliases to a canonical platform slug.
pub fn canonical(platform: &str) -> String {
    match platform.trim().to_lowercase().as_str() {
        "" | "unknown" => ENDPOINT.to_string(),
        "vector" => ENDPOINT.to_string(),
        "endpoint" => ENDPOINT.to_string(),
        "android" => ANDROID.to_string(),
        "ios" => IOS.to_string(),
        other => other.to_string(),
    }
}

pub fn is_mobile(platform: &str) -> bool {
    matches!(platform.trim().to_lowercase().as_str(), "android" | "ios")
}

pub fn is_endpoint(platform: &str) -> bool {
    canonical(platform) == ENDPOINT
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn vector_maps_to_endpoint() {
        assert_eq!(canonical("vector"), ENDPOINT);
        assert_eq!(canonical("endpoint"), ENDPOINT);
    }

    #[test]
    fn mobile_unchanged() {
        assert_eq!(canonical("android"), ANDROID);
        assert!(is_mobile("ios"));
        assert!(!is_endpoint("android"));
    }
}
