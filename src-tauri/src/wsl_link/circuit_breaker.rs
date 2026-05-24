use serde::{Deserialize, Serialize};

/// 熔断器默认失败阈值:连续 3 次失败后跳闸。
pub const DEFAULT_FAILURE_THRESHOLD: u32 = 3;

/// 熔断器默认 Open → HalfOpen 冷却窗口(毫秒)。
pub const DEFAULT_OPEN_TIMEOUT_MS: u64 = 30_000;

/// 熔断器三态:
/// - `Closed`:正常允许调用。
/// - `Open`:已跳闸,所有 `before_call` 返回 `Reject`,直到经过 `open_timeout_ms` 进入 `HalfOpen`。
/// - `HalfOpen`:允许少量探测调用;探测成功回到 `Closed`,失败重新跳闸到 `Open`。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum CircuitBreakerState {
    #[default]
    Closed,
    Open,
    HalfOpen,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CircuitBreakerDecision {
    Allow,
    Reject,
}

/// 简单的三态熔断器。
///
/// # 不变式
/// - `state == Open` 时 `opened_at_unix_ms` 必为 `Some`。其他状态下为 `None`。
/// - `failure_threshold >= 1`(`new` 会把入参钳到至少 1)。
///
/// # 并发约定
/// `CircuitBreaker` 本身不带锁。`before_call`、`record_success`、`record_failure`
/// 都接收 `&mut self`,调用方必须在外部串行化访问(例如外包一层 `Mutex`)。
/// 在 `HalfOpen` 状态下,`before_call` 不限流探测请求次数 —— 半开期间所有调用
/// 都会拿到 `Allow`,直到出现一次成功(回到 Closed)或失败(回到 Open)。
/// 如果需要"半开期间只放过 1 次探测"的语义,需要在调用方层面用单独的锁/信号量约束。
#[derive(Debug, Clone)]
pub struct CircuitBreaker {
    state: CircuitBreakerState,
    failure_count: u32,
    failure_threshold: u32,
    opened_at_unix_ms: Option<u64>,
    open_timeout_ms: u64,
}

impl CircuitBreaker {
    pub fn new(failure_threshold: u32, open_timeout_ms: u64) -> Self {
        Self {
            state: CircuitBreakerState::Closed,
            failure_count: 0,
            failure_threshold: failure_threshold.max(1),
            opened_at_unix_ms: None,
            open_timeout_ms,
        }
    }

    pub fn state(&self) -> CircuitBreakerState {
        self.state
    }

    /// 调用前询问熔断器是否放行。在 `Open` 状态下若 `open_timeout_ms` 已到,
    /// 会就地转换到 `HalfOpen` 并返回 `Allow`,把一次探测机会交给调用方。
    pub fn before_call(&mut self, now_unix_ms: u64) -> CircuitBreakerDecision {
        if self.state == CircuitBreakerState::Open {
            let elapsed = self
                .opened_at_unix_ms
                .map(|opened_at| now_unix_ms.saturating_sub(opened_at))
                .unwrap_or(0);
            if elapsed >= self.open_timeout_ms {
                self.state = CircuitBreakerState::HalfOpen;
                return CircuitBreakerDecision::Allow;
            }
            return CircuitBreakerDecision::Reject;
        }
        CircuitBreakerDecision::Allow
    }

    /// 记录一次成功调用,强制回到 `Closed` 并清空失败计数。
    pub fn record_success(&mut self) {
        self.state = CircuitBreakerState::Closed;
        self.failure_count = 0;
        self.opened_at_unix_ms = None;
    }

    /// 记录一次失败调用。
    ///
    /// - 在 `HalfOpen` 状态下立刻重新跳闸到 `Open`,并把 `opened_at_unix_ms` 重置为 `now_unix_ms`。
    /// - 在 `Closed` 状态下累加 `failure_count`,达到 `failure_threshold` 后跳闸。
    /// - 在 `Open` 状态下仍会累加计数 + 刷新 `opened_at_unix_ms`(等价于延长熔断窗口);
    ///   正常协议下调用方在 `Open` 状态拿到 `Reject` 不应再调用本方法,出现这种情况要么是
    ///   调用方 bug,要么是 race condition。见下方"candidate fix"注释。
    pub fn record_failure(&mut self, now_unix_ms: u64) {
        self.failure_count = self.failure_count.saturating_add(1);
        if self.state == CircuitBreakerState::HalfOpen
            || self.failure_count >= self.failure_threshold
        {
            self.state = CircuitBreakerState::Open;
            self.opened_at_unix_ms = Some(now_unix_ms);
        }
    }
}

impl Default for CircuitBreaker {
    fn default() -> Self {
        Self::new(DEFAULT_FAILURE_THRESHOLD, DEFAULT_OPEN_TIMEOUT_MS)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn breaker_opens_after_threshold() {
        let mut breaker = CircuitBreaker::new(2, 1_000);
        breaker.record_failure(10);
        assert_eq!(breaker.state(), CircuitBreakerState::Closed);
        breaker.record_failure(20);
        assert_eq!(breaker.state(), CircuitBreakerState::Open);
        assert_eq!(breaker.before_call(30), CircuitBreakerDecision::Reject);
    }

    #[test]
    fn breaker_half_opens_after_timeout() {
        let mut breaker = CircuitBreaker::new(1, 1_000);
        breaker.record_failure(10);
        assert_eq!(breaker.before_call(1_010), CircuitBreakerDecision::Allow);
        assert_eq!(breaker.state(), CircuitBreakerState::HalfOpen);
        breaker.record_success();
        assert_eq!(breaker.state(), CircuitBreakerState::Closed);
    }

    // 改动 4: Open 期间 timeout 未到必须返回 Reject,且不改变状态。
    #[test]
    fn breaker_rejects_before_open_timeout_elapses() {
        let mut breaker = CircuitBreaker::new(1, 1_000);
        breaker.record_failure(100);
        assert_eq!(breaker.state(), CircuitBreakerState::Open);
        assert_eq!(breaker.before_call(500), CircuitBreakerDecision::Reject);
        assert_eq!(breaker.state(), CircuitBreakerState::Open);
        // 边界:刚好等于 timeout 应当转半开(elapsed >= open_timeout_ms)。
        assert_eq!(breaker.before_call(1_100), CircuitBreakerDecision::Allow);
        assert_eq!(breaker.state(), CircuitBreakerState::HalfOpen);
    }

    // 改动 4: HalfOpen 状态下一次失败必须重新跳闸,且 opened_at_unix_ms 更新。
    #[test]
    fn breaker_reopens_on_half_open_failure_with_fresh_timestamp() {
        let mut breaker = CircuitBreaker::new(1, 1_000);
        breaker.record_failure(100);
        assert_eq!(breaker.before_call(1_200), CircuitBreakerDecision::Allow);
        assert_eq!(breaker.state(), CircuitBreakerState::HalfOpen);

        breaker.record_failure(1_500);
        assert_eq!(breaker.state(), CircuitBreakerState::Open);
        // opened_at 应当被刷新为半开探测失败的时刻,而不是最初的 100。
        assert_eq!(breaker.before_call(2_000), CircuitBreakerDecision::Reject);
        assert_eq!(breaker.before_call(2_500), CircuitBreakerDecision::Allow);
        assert_eq!(breaker.state(), CircuitBreakerState::HalfOpen);
    }

    // 改动 4: failure_threshold = 0 被钳为 1,一次失败就跳闸。
    #[test]
    fn breaker_clamps_zero_failure_threshold_to_one() {
        let mut breaker = CircuitBreaker::new(0, 1_000);
        breaker.record_failure(10);
        assert_eq!(breaker.state(), CircuitBreakerState::Open);
    }

    // 改动 4: 即使在 Open 状态(理论上调用方不该调到这里),record_success 也能强制回到 Closed。
    #[test]
    fn breaker_record_success_force_resets_from_any_state() {
        let mut breaker = CircuitBreaker::new(1, 1_000);
        breaker.record_failure(10);
        assert_eq!(breaker.state(), CircuitBreakerState::Open);
        breaker.record_success();
        assert_eq!(breaker.state(), CircuitBreakerState::Closed);
        assert_eq!(breaker.before_call(20), CircuitBreakerDecision::Allow);
    }
}