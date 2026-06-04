$ErrorActionPreference = 'Stop'
$root = 'D:\com.xiaojianc\my_desktop_app'
$enc  = New-Object System.Text.UTF8Encoding($false)

function Apply-Edits {
  param([string]$relPath, [object[]]$pairs)
  $path = Join-Path $root $relPath
  if (-not (Test-Path -LiteralPath $path)) { throw "missing file: $path" }
  $text = [System.IO.File]::ReadAllText($path)
  $orig = $text
  $nl = if ($text.Contains("`r`n")) { "`r`n" } else { "`n" }
  $i = 0
  foreach ($p in $pairs) {
    $i++
    $old = ($p.old -join $nl)
    $new = ($p.new -join $nl)
    if ($text.Contains($new)) { Write-Host ("  [{0}] already applied, skip" -f $i); continue }
    $count = ([regex]::Matches($text, [regex]::Escape($old))).Count
    if ($count -ne 1) { throw ("anchor #{0} matched {1} times (expected 1) in {2}: {3}" -f $i,$count,$relPath,$p.old[0]) }
    $text = $text.Replace($old, $new)
  }
  if ($text -ne $orig) { [System.IO.File]::WriteAllText($path, $text, $enc); Write-Host ("updated:   {0}" -f $relPath) }
  else { Write-Host ("unchanged: {0}" -f $relPath) }
}

# ---- 1) src/types/ai/sidecar.ts : 新增 orchestrate 类型 ----
Apply-Edits 'src\types\ai\sidecar.ts' @(
  @{
    old = @(
      'export interface IAgentSidecarStreamEventPayload {'
      '  sessionId: string;'
      '  seq: number;'
      '  event: TAgentUiEvent;'
      '}'
    )
    new = @(
      'export interface IAgentSidecarStreamEventPayload {'
      '  sessionId: string;'
      '  seq: number;'
      '  event: TAgentUiEvent;'
      '}'
      ''
      '/* ============================================================================'
      ' * Native orchestration (orchestration workflow) request / response'
      ' *'
      ' * Single-channel orchestration: start streams events (reusing TAgentUiEvent'
      ' * via the existing ai:sidecar-stream window event); resume is a plain JSON'
      ' * call. Shapes mirror Rust AgentSidecarOrchestrateRequest /'
      ' * AgentSidecarOrchestrateResumeRequest / AgentSidecarOrchestratePayload.'
      ' * ========================================================================== */'
      ''
      'export interface IAgentSidecarOrchestrateRequest {'
      '  sessionId?: string;'
      '  goal: string;'
      '  threadId?: string;'
      '  modelConfig?: IAgentSidecarModelConfig;'
      '}'
      ''
      "export type TAgentSidecarOrchestrateDecision = 'approve' | 'reject';"
      ''
      'export interface IAgentSidecarOrchestrateResumeRequest {'
      '  runId: string;'
      '  decision: TAgentSidecarOrchestrateDecision;'
      '  reason?: string;'
      '  modelConfig?: IAgentSidecarModelConfig;'
      '}'
      ''
      'export interface IAgentSidecarOrchestratePayload {'
      '  runId: string;'
      '  result: TJsonValue | null;'
      '}'
    )
  }
)

# ---- 2) src/types/tauri/index.ts : ITauriService 加方法 + import ----
Apply-Edits 'src\types\tauri\index.ts' @(
  @{
    old = @(
      '  IAgentSidecarExecuteRequest,'
      '  IAgentSidecarHealthPayload,'
    )
    new = @(
      '  IAgentSidecarExecuteRequest,'
      '  IAgentSidecarOrchestrateRequest,'
      '  IAgentSidecarOrchestrateResumeRequest,'
      '  IAgentSidecarOrchestratePayload,'
      '  IAgentSidecarHealthPayload,'
    )
  },
  @{
    old = @(
      '  agentSidecarRestoreCheckpoint('
      '    payload: IAgentSidecarCheckpointRestoreRequest,'
      '  ): Promise<IAgentSidecarResponsePayload>;'
      '  onAgentSidecarStream('
    )
    new = @(
      '  agentSidecarRestoreCheckpoint('
      '    payload: IAgentSidecarCheckpointRestoreRequest,'
      '  ): Promise<IAgentSidecarResponsePayload>;'
      '  agentSidecarOrchestrate('
      '    payload: IAgentSidecarOrchestrateRequest,'
      '  ): Promise<IAgentSidecarOrchestratePayload>;'
      '  agentSidecarOrchestrateResume('
      '    payload: IAgentSidecarOrchestrateResumeRequest,'
      '  ): Promise<IAgentSidecarOrchestratePayload>;'
      '  onAgentSidecarStream('
    )
  }
)

# ---- 3) src/services/tauri.sidecar.ts : IPC 包装 + Pick + 门面对象 ----
Apply-Edits 'src\services\tauri.sidecar.ts' @(
  @{
    old = @('type TSidecarTauriService = Pick<')
    new = @(
      'const agentSidecarOrchestrateIpc = ('
      "  payload: TSidecarRequest<'agentSidecarOrchestrate'>,"
      '  options?: IIpcCallOptions,'
      "): Promise<TSidecarResult<'agentSidecarOrchestrate'>> =>"
      '  callSpectaCommand('
      '    {'
      "      command: 'agent_sidecar_orchestrate',"
      "      guardHint: 'Start native orchestration workflow via Node sidecar',"
      "      audit: 'sensitive',"
      '      timeoutMs: AGENT_SIDECAR_TASK_TIMEOUT_MS,'
      '      input: payload,'
      '      measureInput: measureAiChatInput,'
      '      signal: options?.signal,'
      '    },'
      '    () => commands.agentSidecarOrchestrate(payload),'
      '  );'
      ''
      'const agentSidecarOrchestrateResumeIpc = ('
      "  payload: TSidecarRequest<'agentSidecarOrchestrateResume'>,"
      '  options?: IIpcCallOptions,'
      "): Promise<TSidecarResult<'agentSidecarOrchestrateResume'>> =>"
      '  callSpectaCommand('
      '    {'
      "      command: 'agent_sidecar_orchestrate_resume',"
      "      guardHint: 'Resume Agent sidecar orchestration workflow (approval gate)',"
      "      audit: 'sensitive',"
      '      timeoutMs: AGENT_SIDECAR_TASK_TIMEOUT_MS,'
      '      input: payload,'
      '      signal: options?.signal,'
      '    },'
      '    () => commands.agentSidecarOrchestrateResume(payload),'
      '  );'
      ''
      'type TSidecarTauriService = Pick<'
    )
  },
  @{
    old = @(
      "  | 'agentSidecarRestoreCheckpoint'"
      "  | 'onAgentSidecarStream'"
    )
    new = @(
      "  | 'agentSidecarRestoreCheckpoint'"
      "  | 'agentSidecarOrchestrate'"
      "  | 'agentSidecarOrchestrateResume'"
      "  | 'onAgentSidecarStream'"
    )
  },
  @{
    old = @(
      '  agentSidecarRestoreCheckpoint: agentSidecarRestoreCheckpointIpc,'
      ''
      '  async onAgentSidecarStream(handler) {'
    )
    new = @(
      '  agentSidecarRestoreCheckpoint: agentSidecarRestoreCheckpointIpc,'
      ''
      '  agentSidecarOrchestrate: agentSidecarOrchestrateIpc,'
      ''
      '  agentSidecarOrchestrateResume: agentSidecarOrchestrateResumeIpc,'
      ''
      '  async onAgentSidecarStream(handler) {'
    )
  }
)

# ---- 4) src/services/ipc/ai.service.ts : 门面方法 + import ----
Apply-Edits 'src\services\ipc\ai.service.ts' @(
  @{
    old = @(
      '  IAgentSidecarExecuteRequest,'
      '  IAgentSidecarHealthPayload,'
    )
    new = @(
      '  IAgentSidecarExecuteRequest,'
      '  IAgentSidecarOrchestrateRequest,'
      '  IAgentSidecarOrchestrateResumeRequest,'
      '  IAgentSidecarOrchestratePayload,'
      '  IAgentSidecarHealthPayload,'
    )
  },
  @{
    old = @(
      '    return tauriService.agentSidecarRestoreCheckpoint(payload);'
      '  },'
      '  onSidecarStream('
    )
    new = @(
      '    return tauriService.agentSidecarRestoreCheckpoint(payload);'
      '  },'
      '  sidecarOrchestrate('
      '    payload: IAgentSidecarOrchestrateRequest,'
      '  ): Promise<IAgentSidecarOrchestratePayload> {'
      '    return tauriService.agentSidecarOrchestrate(payload);'
      '  },'
      '  sidecarOrchestrateResume('
      '    payload: IAgentSidecarOrchestrateResumeRequest,'
      '  ): Promise<IAgentSidecarOrchestratePayload> {'
      '    return tauriService.agentSidecarOrchestrateResume(payload);'
      '  },'
      '  onSidecarStream('
    )
  }
)

Write-Host ''
Write-Host 'Step 2 plumbing applied. Now run:  pnpm typecheck'