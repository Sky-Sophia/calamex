use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

const STREAM_STATE_TTL: Duration = Duration::from_secs(30 * 60);

#[derive(Debug, Clone)]
struct StreamState {
    cancelled: bool,
    registered_at: Instant,
}

static STREAMS: OnceLock<Mutex<HashMap<String, StreamState>>> = OnceLock::new();

fn streams() -> &'static Mutex<HashMap<String, StreamState>> {
    STREAMS.get_or_init(|| Mutex::new(HashMap::new()))
}

pub fn register(stream_id: &str) {
    if stream_id.trim().is_empty() {
        return;
    }

    let mut guard = streams()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());

    prune_expired_locked(&mut guard);

    guard.insert(
        stream_id.to_string(),
        StreamState {
            cancelled: false,
            registered_at: Instant::now(),
        },
    );
}

pub fn cancel(stream_id: &str) -> bool {
    if stream_id.trim().is_empty() {
        return false;
    }

    let mut guard = streams()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());

    prune_expired_locked(&mut guard);

    let Some(state) = guard.get_mut(stream_id) else {
        return false;
    };

    let was_already_cancelled = state.cancelled;
    state.cancelled = true;

    !was_already_cancelled
}

pub fn is_cancelled(stream_id: &str) -> bool {
    if stream_id.trim().is_empty() {
        return false;
    }

    let mut guard = streams()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());

    prune_expired_locked(&mut guard);

    guard
        .get(stream_id)
        .map(|state| state.cancelled)
        .unwrap_or(false)
}

pub fn finish(stream_id: &str) {
    if stream_id.trim().is_empty() {
        return;
    }

    let mut guard = streams()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());

    guard.remove(stream_id);

    prune_expired_locked(&mut guard);
}

fn prune_expired_locked(streams: &mut HashMap<String, StreamState>) {
    let now = Instant::now();

    streams.retain(|_, state| now.duration_since(state.registered_at) <= STREAM_STATE_TTL);
}

#[cfg(test)]
mod tests {
    use super::{cancel, finish, is_cancelled, register};

    #[test]
    fn registered_stream_is_not_cancelled_by_default() {
        let stream_id = "test-stream-default";

        register(stream_id);

        assert!(!is_cancelled(stream_id));

        finish(stream_id);
    }

    #[test]
    fn cancel_marks_registered_stream_as_cancelled() {
        let stream_id = "test-stream-cancel";

        register(stream_id);

        assert!(cancel(stream_id));
        assert!(is_cancelled(stream_id));

        finish(stream_id);
    }

    #[test]
    fn cancelling_same_stream_twice_returns_false_second_time() {
        let stream_id = "test-stream-double-cancel";

        register(stream_id);

        assert!(cancel(stream_id));
        assert!(!cancel(stream_id));
        assert!(is_cancelled(stream_id));

        finish(stream_id);
    }

    #[test]
    fn finish_removes_stream_state() {
        let stream_id = "test-stream-finish";

        register(stream_id);
        assert!(cancel(stream_id));
        assert!(is_cancelled(stream_id));

        finish(stream_id);

        assert!(!is_cancelled(stream_id));
    }

    #[test]
    fn cancel_unknown_stream_returns_false() {
        let stream_id = "test-stream-unknown";

        finish(stream_id);

        assert!(!cancel(stream_id));
        assert!(!is_cancelled(stream_id));
    }

    #[test]
    fn register_resets_previous_cancelled_state() {
        let stream_id = "test-stream-register-reset";

        register(stream_id);
        assert!(cancel(stream_id));
        assert!(is_cancelled(stream_id));

        register(stream_id);

        assert!(!is_cancelled(stream_id));

        finish(stream_id);
    }

    #[test]
    fn empty_stream_id_is_ignored() {
        register("");
        assert!(!cancel(""));
        assert!(!is_cancelled(""));
        finish("");
    }
}
