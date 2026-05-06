use std::time::Instant;

use serde::Serialize;
use thiserror::Error;

use super::{
    config::WslLinkTransportConfig,
    retry::BackoffPolicy,
    state_machine::{WslLinkConnectionState, WslLinkEvent, WslLinkStateError, WslLinkStateMachine},
    types::{WslLinkMetrics, WslLinkResumeFrame, WslLinkTransportKind},
};

pub trait WslLinkTransportAdapter {
    fn kind(&self) -> WslLinkTransportKind;
    fn is_available(&self) -> bool;
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WslLinkConnectPlan {
    pub primary: WslLinkTransportKind,
    pub next_backoff_ms: u64,
}

#[derive(Debug, Error)]
pub enum WslLinkManagerError {
    #[error("WSL Link 状态转移失败：{0}")]
    State(#[from] WslLinkStateError),
}

#[derive(Debug)]
pub struct WslLinkManager {
    state_machine: WslLinkStateMachine,
    backoff_policy: BackoffPolicy,
    transport_config: WslLinkTransportConfig,
    metrics: WslLinkMetrics,
    connect_started_at: Option<Instant>,
    reconnect_attempt: u32,
    last_ack_server_seq: u64,
    last_client_seq: u64,
}

impl WslLinkManager {
    pub fn new(transport_config: WslLinkTransportConfig) -> Self {
        Self {
            state_machine: WslLinkStateMachine::new(),
            backoff_policy: BackoffPolicy::default(),
            transport_config,
            metrics: WslLinkMetrics {
                active_transport: None,
                rtt_ms: None,
                reconnects_total: 0,
                inflight_requests: 0,
                last_error: None,
            },
            connect_started_at: None,
            reconnect_attempt: 0,
            last_ack_server_seq: 0,
            last_client_seq: 0,
        }
    }

    pub fn state(&self) -> WslLinkConnectionState {
        self.state_machine.state()
    }

    pub fn metrics(&self) -> WslLinkMetrics {
        self.metrics.clone()
    }

    pub fn config(&self) -> WslLinkTransportConfig {
        self.transport_config
    }

    pub fn start_connecting(&mut self) -> Result<(), WslLinkManagerError> {
        self.state_machine.transition(WslLinkEvent::Start)?;
        self.connect_started_at = Some(Instant::now());
        Ok(())
    }

    pub fn begin_manual_connect_attempt(&mut self) -> Result<(), WslLinkManagerError> {
        match self.state() {
            WslLinkConnectionState::Idle | WslLinkConnectionState::Closed => {
                self.state_machine.transition(WslLinkEvent::Start)?;
            }
            WslLinkConnectionState::Backoff => {
                self.state_machine
                    .transition(WslLinkEvent::BackoffElapsed)?;
            }
            WslLinkConnectionState::Degraded => {
                self.state_machine.transition(WslLinkEvent::HeartbeatDead)?;
            }
            WslLinkConnectionState::Ready
            | WslLinkConnectionState::Connecting
            | WslLinkConnectionState::Reconnecting
            | WslLinkConnectionState::Resuming => {}
        }
        self.connect_started_at = Some(Instant::now());
        Ok(())
    }

    pub fn connect_plan(&self) -> WslLinkConnectPlan {
        WslLinkConnectPlan {
            primary: self.transport_config.primary_transport(),
            next_backoff_ms: self
                .backoff_policy
                .delay_for_attempt(self.reconnect_attempt)
                .as_millis()
                .min(u128::from(u64::MAX)) as u64,
        }
    }

    pub fn record_handshake_ok(
        &mut self,
        active_transport: WslLinkTransportKind,
    ) -> Result<(), WslLinkManagerError> {
        self.metrics.active_transport = Some(active_transport);
        self.metrics.last_error = None;
        self.reconnect_attempt = 0;

        match self.state() {
            WslLinkConnectionState::Connecting => {
                self.state_machine.transition(WslLinkEvent::HandshakeOk)?;
            }
            WslLinkConnectionState::Reconnecting => {
                self.state_machine.transition(WslLinkEvent::TransportOk)?;
            }
            _ => {}
        }

        Ok(())
    }

    pub fn record_connect_error(
        &mut self,
        error_message: impl Into<String>,
    ) -> Result<(), WslLinkManagerError> {
        self.metrics.last_error = Some(error_message.into());
        self.metrics.active_transport = None;
        self.metrics.reconnects_total = self.metrics.reconnects_total.saturating_add(1);
        self.reconnect_attempt = self.reconnect_attempt.saturating_add(1);

        match self.state() {
            WslLinkConnectionState::Connecting | WslLinkConnectionState::Reconnecting => {
                self.state_machine.transition(WslLinkEvent::ConnectError)?;
            }
            WslLinkConnectionState::Resuming => {
                self.state_machine.transition(WslLinkEvent::ResumeError)?;
            }
            _ => {}
        }

        Ok(())
    }

    pub fn mark_heartbeat_miss(&mut self) -> Result<(), WslLinkManagerError> {
        if self.state() == WslLinkConnectionState::Ready {
            self.state_machine.transition(WslLinkEvent::HeartbeatMiss)?;
        }
        Ok(())
    }

    pub fn mark_heartbeat_ok(&mut self) -> Result<(), WslLinkManagerError> {
        if self.state() == WslLinkConnectionState::Degraded {
            self.state_machine.transition(WslLinkEvent::HeartbeatOk)?;
        }
        Ok(())
    }

    pub fn mark_heartbeat_dead(&mut self) -> Result<(), WslLinkManagerError> {
        if self.state() == WslLinkConnectionState::Degraded {
            self.state_machine.transition(WslLinkEvent::HeartbeatDead)?;
            self.connect_started_at = Some(Instant::now());
        }
        Ok(())
    }

    pub fn mark_resumed(&mut self) -> Result<(), WslLinkManagerError> {
        if self.state() == WslLinkConnectionState::Resuming {
            self.state_machine.transition(WslLinkEvent::ResumeOk)?;
        }
        Ok(())
    }

    pub fn resume_frame(&self, session_id: impl Into<String>) -> WslLinkResumeFrame {
        WslLinkResumeFrame {
            session_id: session_id.into(),
            last_ack_server_seq: self.last_ack_server_seq,
            last_client_seq: self.last_client_seq,
        }
    }

    pub fn allocate_client_seq(&mut self) -> u64 {
        self.last_client_seq = self.last_client_seq.saturating_add(1);
        self.last_client_seq
    }

    pub fn record_request_ack(&mut self, ack_client_seq: u64, server_seq: u64) {
        self.last_client_seq = self.last_client_seq.max(ack_client_seq);
        self.last_ack_server_seq = self.last_ack_server_seq.max(server_seq);
    }

    pub fn record_heartbeat_ack(
        &mut self,
        active_transport: WslLinkTransportKind,
        ack_client_seq: u64,
        server_seq: u64,
        rtt_ms: u64,
    ) -> Result<(), WslLinkManagerError> {
        self.mark_heartbeat_ok()?;
        self.metrics.active_transport = Some(active_transport);
        self.metrics.rtt_ms = Some(rtt_ms);
        self.metrics.last_error = None;
        self.record_request_ack(ack_client_seq, server_seq);
        Ok(())
    }

    pub fn stop(&mut self) -> Result<(), WslLinkManagerError> {
        if !matches!(
            self.state(),
            WslLinkConnectionState::Idle | WslLinkConnectionState::Closed
        ) {
            self.state_machine.transition(WslLinkEvent::Stop)?;
        }
        self.metrics.active_transport = None;
        Ok(())
    }
}

impl Default for WslLinkManager {
    fn default() -> Self {
        Self::new(WslLinkTransportConfig::default())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn manager_builds_single_channel_plan() {
        let mut manager = WslLinkManager::default();
        manager.start_connecting().expect("start should work");

        let plan = manager.connect_plan();

        assert_eq!(plan.primary, WslLinkTransportKind::VsockGrpc);
        assert!(plan.next_backoff_ms >= 1);
    }

    #[test]
    fn manager_records_resume_ack_state_from_server_ack() {
        let mut manager = WslLinkManager::default();

        assert_eq!(manager.allocate_client_seq(), 1);
        manager.record_request_ack(1, 7);

        let resume = manager.resume_frame("s1");

        assert_eq!(resume.last_ack_server_seq, 7);
        assert_eq!(resume.last_client_seq, 1);
    }

    #[test]
    fn manager_enters_backoff_after_connect_error() {
        let mut manager = WslLinkManager::default();
        manager.start_connecting().expect("start should work");
        manager
            .record_connect_error("connect failed")
            .expect("first error should work");
        assert_eq!(manager.state(), WslLinkConnectionState::Backoff);

        let plan = manager.connect_plan();

        assert!(plan.next_backoff_ms >= 1);
    }

    #[test]
    fn manager_manual_attempt_retries_from_backoff() {
        let mut manager = WslLinkManager::default();
        manager.start_connecting().expect("start should work");
        manager
            .record_connect_error("connect failed")
            .expect("error should record");

        manager
            .begin_manual_connect_attempt()
            .expect("manual retry should work");

        assert_eq!(manager.state(), WslLinkConnectionState::Connecting);
    }
}
