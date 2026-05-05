status: yellow
owner: ai-agent
key_gaps:
  - Mastra sidecar runtime is in use, but the packaged sidecar binary is not wired into the Tauri build yet.
  - Dangerous tool execution is blocked behind approval policy and still needs Rust command-backed implementations.
next_upgrade:
  - Package Node sidecar as a Tauri sidecar binary and stream AgentUiEvent over a long-lived channel.
