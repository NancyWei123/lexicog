use crate::util::datetime::format_utc_timestamp;
use chrono::{Duration, Utc};

const MIN_EASINESS_FACTOR: f64 = 1.3;

#[derive(Debug, Clone)]
pub struct Sm2Result {
    pub repetition_count: i32,
    pub easiness_factor: f64,
    pub interval_days: i32,
    pub next_review_at: String,
}

/// Calculate the next review state from a 0-5 quality score.
///
/// Failed recalls (`q < 3`) use short relearning delays, and successful recalls
/// apply the updated easiness factor immediately.
pub fn calculate_sm2(
    current_repetition: i32,
    current_ef: f64,
    current_interval: i32,
    quality: i32,
) -> Sm2Result {
    let quality = quality.clamp(0, 5);
    let new_ef = next_easiness_factor(current_ef, quality);

    let (new_rep, new_interval, next_review) = if quality < 3 {
        let relearning_delay = relearning_delay_for_quality(quality);
        (0, 0, Utc::now() + relearning_delay)
    } else {
        let new_rep = current_repetition + 1;
        let new_interval = match new_rep {
            1 => 1,
            2 => 6,
            _ => ((current_interval.max(1) as f64) * new_ef).round() as i32,
        };
        let bounded_interval = new_interval.max(1);
        (
            new_rep,
            bounded_interval,
            Utc::now() + Duration::days(bounded_interval as i64),
        )
    };

    Sm2Result {
        repetition_count: new_rep,
        easiness_factor: round_to_2dp(new_ef),
        interval_days: new_interval,
        next_review_at: format_utc_timestamp(next_review),
    }
}

fn next_easiness_factor(current_ef: f64, quality: i32) -> f64 {
    let q = quality as f64;
    let ef_delta = 0.1 - (5.0 - q) * (0.08 + (5.0 - q) * 0.02);
    (current_ef + ef_delta).max(MIN_EASINESS_FACTOR)
}

fn relearning_delay_for_quality(quality: i32) -> Duration {
    match quality {
        0 => Duration::minutes(10),
        1 => Duration::hours(4),
        2 => Duration::hours(12),
        _ => Duration::days(1),
    }
}

fn round_to_2dp(value: f64) -> f64 {
    (value * 100.0).round() / 100.0
}
