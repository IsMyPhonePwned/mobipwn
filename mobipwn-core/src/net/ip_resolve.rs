//! Resolve IPv6 encodings (NAT64 well-known prefix, IPv4-mapped) to embedded IPv4 for enrichment.

use std::net::{IpAddr, Ipv4Addr};

/// NAT64 well-known prefix `64:ff9b::/96` (RFC 8215) — last 32 bits carry IPv4.
const NAT64_WKP_PREFIX: [u8; 12] = [0x00, 0x64, 0xff, 0x9b, 0, 0, 0, 0, 0, 0, 0, 0];

/// Strip a zone id suffix (`fe80::1%wlan0` → `fe80::1`).
pub fn strip_ip_zone(raw: &str) -> &str {
    if let Some((host, _)) = raw.split_once('%') {
        host.trim()
    } else {
        raw.trim()
    }
}

/// Extract embedded IPv4 from NAT64 WKP, IPv4-mapped IPv6, or plain IPv4.
pub fn embedded_ipv4(raw: &str) -> Option<Ipv4Addr> {
    let ip = strip_ip_zone(raw);
    if ip.is_empty() || ip == "::" {
        return None;
    }
    let parsed: IpAddr = if let Some(rest) = ip.strip_prefix("::ffff:") {
        if rest.contains('.') {
            rest.parse().ok()?
        } else {
            ip.parse().ok()?
        }
    } else {
        ip.parse().ok()?
    };
    embedded_ipv4_from_addr(&parsed)
}

fn embedded_ipv4_from_addr(addr: &IpAddr) -> Option<Ipv4Addr> {
    match addr {
        IpAddr::V4(v4) => Some(*v4),
        IpAddr::V6(v6) => {
            if let Some(v4) = v6.to_ipv4_mapped() {
                return Some(v4);
            }
            let octets = v6.octets();
            if octets[..12] == NAT64_WKP_PREFIX {
                return Some(Ipv4Addr::new(octets[12], octets[13], octets[14], octets[15]));
            }
            None
        }
    }
}

/// Host part of socket addresses, preferring embedded IPv4 when present.
pub fn resolve_display_host(raw: &str) -> String {
    let raw = raw.trim();
    if raw.is_empty() {
        return String::new();
    }
    let host = if raw.starts_with('[') {
        if let Some(end) = raw.find(']') {
            &raw[1..end]
        } else {
            raw
        }
    } else if raw.matches(':').count() == 1 {
        if let Some((host, _)) = raw.split_once(':') {
            if !host.is_empty()
                && !host.contains('/')
                && host.chars().all(|c| c.is_ascii_digit() || c == '.')
            {
                return host.to_string();
            }
            host
        } else {
            raw
        }
    } else {
        raw
    };
    if let Some(v4) = embedded_ipv4(host) {
        return v4.to_string();
    }
    host.to_string()
}

pub fn is_public_ipv4(v4: &Ipv4Addr) -> bool {
    !v4.is_private()
        && !v4.is_loopback()
        && !v4.is_link_local()
        && !v4.is_broadcast()
        && !v4.is_unspecified()
        && !v4.is_documentation()
}

/// Normalize a public routable IPv4 for VT/GeoIP enrichment keys and API calls.
pub fn normalize_ip_for_enrichment(raw: &str) -> Option<String> {
    let v4 = embedded_ipv4(raw)?;
    if !is_public_ipv4(&v4) {
        return None;
    }
    Some(v4.to_string())
}

/// ClickHouse expression matching [`normalize_ip_for_enrichment`] for IP columns.
pub fn clickhouse_ip_indicator_key(column: &str) -> String {
    format!(
        "multiIf(\
         startsWith(toString({column}), '64:ff9b:'), \
         IPv4NumToString(reinterpretAsUInt32(substring(IPv6StringToNum(assumeNotNull(toIPv6OrNull(toString({column})))), 13, 4))), \
         replaceRegexpOne(replaceRegexpOne(toString({column}), '^::ffff:', ''), '%.+$', '')\
         )"
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn nat64_well_known_prefix_to_ipv4() {
        assert_eq!(
            embedded_ipv4("64:ff9b::253b:1955").map(|a| a.to_string()),
            Some("37.59.25.85".into())
        );
        assert_eq!(
            resolve_display_host("64:ff9b::253b:1955"),
            "37.59.25.85"
        );
    }

    #[test]
    fn ipv4_mapped_to_ipv4() {
        assert_eq!(
            embedded_ipv4("::ffff:8.8.8.8").map(|a| a.to_string()),
            Some("8.8.8.8".into())
        );
        assert_eq!(
            normalize_ip_for_enrichment("::ffff:8.8.8.8").as_deref(),
            Some("8.8.8.8")
        );
    }

    #[test]
    fn skips_private_and_link_local() {
        assert!(normalize_ip_for_enrichment("10.0.0.1").is_none());
        assert!(normalize_ip_for_enrichment("fe80::1%eth0").is_none());
        assert!(normalize_ip_for_enrichment("192.168.8.183%wlan0").is_none());
    }

    #[test]
    fn nat64_private_embedded_ipv4_skipped() {
        assert!(normalize_ip_for_enrichment("64:ff9b::c0a8:0101").is_none());
    }

    #[test]
    fn clickhouse_key_handles_nat64() {
        let expr = clickhouse_ip_indicator_key("dest_ip");
        assert!(expr.contains("64:ff9b:"));
        assert!(expr.contains("dest_ip"));
    }
}
