use std::time::{SystemTime, UNIX_EPOCH};

use super::types::{StateChangedPayload, TerminalState};

#[derive(Debug, Clone)]
pub struct StateMachine {
    state: TerminalState,
}

impl StateMachine {
    pub fn new(initial: TerminalState) -> Self {
        Self { state: initial }
    }

    pub fn state(&self) -> TerminalState {
        self.state
    }

    pub fn can_transition(from: TerminalState, to: TerminalState) -> bool {
        matches!(
            (from, to),
            (TerminalState::Booting, TerminalState::IdleInteractive)
                | (
                    TerminalState::IdleInteractive,
                    TerminalState::SwitchingToRun
                )
                | (TerminalState::SwitchingToRun, TerminalState::Running)
                | (
                    TerminalState::SwitchingToRun,
                    TerminalState::IdleInteractive
                )
                | (TerminalState::Running, TerminalState::SwitchingToIdle)
                | (
                    TerminalState::SwitchingToIdle,
                    TerminalState::IdleInteractive
                )
                | (TerminalState::IdleInteractive, TerminalState::Booting)
        )
    }

    pub fn transition(&mut self, to: TerminalState) -> Result<StateChangedPayload, String> {
        let from = self.state;
        if !Self::can_transition(from, to) {
            return Err(format!("非法终端状态转移：{from:?} -> {to:?}"));
        }
        self.state = to;
        Ok(StateChangedPayload {
            from,
            to,
            at_ms: now_ms(),
        })
    }
}

pub fn validate_active_run_invariant(
    state: TerminalState,
    active_run_present: bool,
) -> Result<(), String> {
    if active_run_present
        && !matches!(
            state,
            TerminalState::SwitchingToRun | TerminalState::Running | TerminalState::SwitchingToIdle
        )
    {
        return Err(format!("active_run 存在但状态为 {state:?}"));
    }
    if state == TerminalState::Running && !active_run_present {
        return Err("状态为 Running 但 active_run 为空".to_string());
    }
    Ok(())
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| i64::try_from(duration.as_millis()).unwrap_or(i64::MAX))
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_state_invariant_running_implies_active_run() {
        assert!(validate_active_run_invariant(TerminalState::Running, true).is_ok());
        assert!(validate_active_run_invariant(TerminalState::Running, false).is_err());
        assert!(validate_active_run_invariant(TerminalState::IdleInteractive, true).is_err());
        assert!(validate_active_run_invariant(TerminalState::SwitchingToRun, true).is_ok());
        assert!(validate_active_run_invariant(TerminalState::SwitchingToIdle, true).is_ok());
    }

    #[test]
    fn test_state_transitions_emit_event() {
        let mut machine = StateMachine::new(TerminalState::Booting);
        let event = machine
            .transition(TerminalState::IdleInteractive)
            .expect("Booting -> IdleInteractive 应合法");
        assert_eq!(event.from, TerminalState::Booting);
        assert_eq!(event.to, TerminalState::IdleInteractive);
        assert_eq!(machine.state(), TerminalState::IdleInteractive);

        assert!(machine.transition(TerminalState::Running).is_err());
    }

    #[test]
    fn test_idle_can_return_to_booting_after_interactive_exit() {
        let mut machine = StateMachine::new(TerminalState::IdleInteractive);
        let event = machine
            .transition(TerminalState::Booting)
            .expect("iPTY 退出后 IdleInteractive -> Booting 应合法");

        assert_eq!(event.from, TerminalState::IdleInteractive);
        assert_eq!(event.to, TerminalState::Booting);
        assert_eq!(machine.state(), TerminalState::Booting);
    }

    #[test]
    fn test_full_run_state_lifecycle() {
        let mut machine = StateMachine::new(TerminalState::Booting);

        for expected in [
            TerminalState::IdleInteractive,
            TerminalState::SwitchingToRun,
            TerminalState::Running,
            TerminalState::SwitchingToIdle,
            TerminalState::IdleInteractive,
        ] {
            let event = machine
                .transition(expected)
                .expect("完整 run 生命周期状态转移应合法");
            assert_eq!(event.to, expected);
            assert_eq!(machine.state(), expected);
        }
    }
}
