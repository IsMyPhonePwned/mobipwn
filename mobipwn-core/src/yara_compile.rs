//! Compile YARA-X rule sources into serialized `.yarc` blobs for Rusty Magpie.

use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use yara_x::Compiler;

pub fn compile_yara_source(source: &str) -> Result<Vec<u8>, String> {
    let trimmed = source.trim();
    if trimmed.is_empty() {
        return Err("rule source is empty".into());
    }
    let mut compiler = Compiler::new();
    compiler
        .add_source(trimmed)
        .map_err(|e| format!("{e}"))?;
    let rules = compiler.build();
    let mut out = Vec::new();
    rules
        .serialize_into(&mut out)
        .map_err(|e| format!("{e}"))?;
    Ok(out)
}

pub fn compile_yara_sources(sources: &[&str]) -> Result<Vec<u8>, String> {
    let non_empty: Vec<&str> = sources
        .iter()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .collect();
    if non_empty.is_empty() {
        return Err("no rule sources to compile".into());
    }
    let mut compiler = Compiler::new();
    for source in non_empty {
        compiler
            .add_source(source)
            .map_err(|e| format!("{e}"))?;
    }
    let rules = compiler.build();
    let mut out = Vec::new();
    rules
        .serialize_into(&mut out)
        .map_err(|e| format!("{e}"))?;
    Ok(out)
}

pub fn encode_yarc(bytes: &[u8]) -> String {
    BASE64.encode(bytes)
}

pub fn decode_yarc(encoded: &str) -> Result<Vec<u8>, String> {
    BASE64
        .decode(encoded.trim())
        .map_err(|e| format!("invalid base64 yarc: {e}"))
}
