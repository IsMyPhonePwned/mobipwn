//! Golden mPL queries — parse + SQL compile (nano doc-style hunts).
//! Goal: ≥95% compile on a growing set; formal port of 30 public nano examples is not done yet.

use mobipwn_search::{generate_clickhouse_sql, parse_mpl};

fn compiles(query: &str) {
    let q = parse_mpl(query).expect("parse");
    generate_clickhouse_sql(&q, "mobipwn", None, None).expect("sql");
}

#[test]
fn golden_investigation_queries() {
    let cases = [
        r#"last 24h platform="android""#,
        r#"now-7d platform="ios""#,
        r#"@timestamp last 1h source="case-001""#,
        r#"source="case-001" parser="Network""#,
        r#"platform IN ("android", "ios")"#,
        r#"parser NOT IN ("Heartbeat")"#,
        r#"bundle_id=* dest_ip=*"#,
        r#"platform="android" | stats count by parser | head 20"#,
        r#"source="case-001" | stats values bundle_id by parser | head 50"#,
        r#"source="case-001" | stats list process_name by device_id | head 10"#,
        r#"platform="android" | eval risk=if(severity="high",1,0) | head 100"#,
        r#"platform="android" | rename bundle_id AS package | fields package message"#,
        r#"bundle_id=*bitchat* | fields timestamp, source, bundle_id, parser, action, message | sort -timestamp | head 100"#,
        r#"parser="Network" | lookup src_ip | head 50"#,
        r#"dest_ip=* | lookup geo dest_ip | stats count by geo_country"#,
        r#"platform="android" | rex ip=(\d+\.\d+\.\d+\.\d+) field=message"#,
        r#"platform="android" | join device_id [ platform="ios" | head 5 ]"#,
        r#"platform="android" | timechart span=1h count by parser limit=5"#,
        r#"process_name="com.google.android.gms" | sort -timestamp | head 200"#,
        r#"source="case-001" parser="Crash" data_type="android:bugreport:tombstone" process_name=* | head 200"#,
        r#"source="case-001" parser="Crash" (data_type="android:bugreport:anr_file" OR data_type="android:bugreport:anr_trace") | head 100"#,
        r#"(data_type=*tombstone_backtrace* AND (function=*QuramDngOpcodeScalePerColumn::processArea*)) | head 500"#,
        r#"platform="android", | head 100"#,
        r#"platform="android", file_hash!="" | head 100"#,
        r#"platform="android" | stats count by bundle_id, | head 100"#,
        r#"parser="Package" platform="android" data_type=*package_metadata* installer=* installer NOT IN ("com.android.vending", "com.google.android.packageinstaller", "com.android.packageinstaller", "null") | head 100"#,
        r#"parser="Package" installer=* !installer="com.android.vending" !installer="null" | stats count by bundle_id, installer | head 100"#,
        r#"platform="ios" parser="network_iocs" dest_ip=* | head 50"#,
        r#"bundle_id="com.example.app" | stats count by source, parser | head 50"#,
        r#"source="case-001" | timechart span=1d count by parser limit=5"#,
    ];
    for q in cases {
        compiles(q);
    }
}

#[test]
fn golden_compile_rate_at_least_95_percent() {
    let cases = [
        (true, r#"last 24h platform="android""#),
        (true, r#"now-7d platform="ios""#),
        (true, r#"platform IN ("android")"#),
        (true, r#"platform="android" | eval x=1"#),
        (true, r#"platform="android" | rename bundle_id AS pkg"#),
        (true, r#"dest_ip=* | lookup dest_ip"#),
        (false, r#"platform="android" | lookup device_id"#), // unsupported field
        (true, r#"platform="android" | stats dc device_id"#),
        (true, r#"* | head 1"#), // broad — still parses; admission may reject at runtime
    ];
    let ok = cases
        .iter()
        .filter(|(expect_ok, q)| {
            let compiles = parse_mpl(q)
                .ok()
                .and_then(|p| generate_clickhouse_sql(&p, "mobipwn", None, None).ok())
                .is_some();
            compiles == *expect_ok
        })
        .count();
    let rate = ok as f64 / cases.len() as f64;
    assert!(
        rate >= 0.95,
        "compile rate {rate:.0}% ({ok}/{}) below 95%",
        cases.len()
    );
}
