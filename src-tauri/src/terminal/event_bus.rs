use std::sync::RwLock;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

use super::types::{
    RunChunkPayload, RunCompletedPayload, RunStartedPayload, StateChangedPayload,
    TerminalDataPayload,
};

pub const TERMINAL_DATA_EVENT: &str = "terminal:data";
pub const TERMINAL_RUN_CHUNK_EVENT: &str = "terminal:run-chunk";
pub const TERMINAL_RUN_COMPLETED_EVENT: &str = "terminal:run-completed";
pub const TERMINAL_RUN_STARTED_EVENT: &str = "terminal:run-started";
pub const TERMINAL_INTERACTIVE_READY_EVENT: &str = "terminal:interactive-ready";
pub const TERMINAL_INTERACTIVE_EXITED_EVENT: &str = "terminal:interactive-exited";
pub const TERMINAL_STATE_CHANGED_EVENT: &str = "terminal:state-changed";

#[derive(Default)]
pub struct EventBus {
    app: RwLock<Option<AppHandle>>,
}

impl EventBus {
    pub fn attach_app(&self, app: AppHandle) {
        if let Ok(mut guard) = self.app.write() {
            *guard = Some(app);
        }
    }

    pub fn emit_terminal_data(&self, payload: TerminalDataPayload) {
        self.emit(TERMINAL_DATA_EVENT, payload);
    }

    pub fn emit_run_chunk(&self, payload: RunChunkPayload) {
        self.emit(TERMINAL_RUN_CHUNK_EVENT, payload);
    }

    pub fn emit_run_started(&self, payload: RunStartedPayload) {
        self.emit(TERMINAL_RUN_STARTED_EVENT, payload);
    }

    pub fn emit_run_completed(&self, payload: RunCompletedPayload) {
        self.emit(TERMINAL_RUN_COMPLETED_EVENT, payload);
    }

    pub fn emit_state_changed(&self, payload: StateChangedPayload) {
        self.emit(TERMINAL_STATE_CHANGED_EVENT, payload);
    }

    fn emit<T>(&self, event: &str, payload: T)
    where
        T: Serialize + Clone,
    {
        let Ok(guard) = self.app.read() else {
            return;
        };
        let Some(app) = guard.as_ref() else {
            return;
        };
        let Some(window) = app.get_webview_window("main") else {
            return;
        };
        let _ = window.emit(event, payload);
    }
}
