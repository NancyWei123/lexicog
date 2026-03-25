use anyhow::{anyhow, Context, Result};
use chrono::{DateTime, NaiveDateTime, Utc};

pub const UTC_TIMESTAMP_FORMAT: &str = "%Y-%m-%dT%H:%M:%SZ";
const SQLITE_LEGACY_TIMESTAMP_FORMAT: &str = "%Y-%m-%d %H:%M:%S";

pub fn format_utc_timestamp(timestamp: DateTime<Utc>) -> String {
    timestamp.format(UTC_TIMESTAMP_FORMAT).to_string()
}

pub fn utc_now_string() -> String {
    format_utc_timestamp(Utc::now())
}

pub fn parse_stored_utc_timestamp(raw: &str) -> Result<DateTime<Utc>> {
    let trimmed = raw.trim();

    if let Ok(parsed) = DateTime::parse_from_rfc3339(trimmed) {
        return Ok(parsed.with_timezone(&Utc));
    }

    if let Ok(parsed) = NaiveDateTime::parse_from_str(trimmed, UTC_TIMESTAMP_FORMAT) {
        return Ok(parsed.and_utc());
    }

    if let Ok(parsed) = NaiveDateTime::parse_from_str(trimmed, SQLITE_LEGACY_TIMESTAMP_FORMAT) {
        return Ok(parsed.and_utc());
    }

    Err(anyhow!("unsupported UTC timestamp format `{}`", trimmed))
        .context("parse stored UTC timestamp")
}
