$ErrorActionPreference = 'Stop'
$root = 'D:\com.xiaojianc\my_desktop_app'
$enc  = New-Object System.Text.UTF8Encoding($false)

function Save-IfChanged($path, $orig, $next) {
  if ($next -ne $orig) {
    [System.IO.File]::WriteAllText($path, $next, $enc)
    Write-Host "updated: $path"
  } else {
    Write-Host "unchanged: $path"
  }
}

# ---- 1) server.ts : orchestration gate default-on ----
$p1 = Join-Path $root 'agent-sidecar/src/server.ts'
if (-not (Test-Path $p1)) { throw "missing: $p1" }
$c1 = [System.IO.File]::ReadAllText($p1)
$o1 = $c1
$nl1 = if ($c1.Contains("`r`n")) { "`r`n" } else { "`n" }

if ($c1.IndexOf('isOrchestrationWorkflowDisabled') -lt 0) {
  $anchor1 = "const ORCHESTRATION_RUN_TTL_MS = 30 * 60 * 1000;"
  if ($c1.IndexOf($anchor1) -lt 0) { throw 'server.ts: TTL anchor not found' }
  $lines = @(
    "// Orchestration is enabled by default; it is disabled only when",
    "// AGENT_ORCHESTRATION_WORKFLOW is explicitly set to '0' or 'false'. The flag was",
    "// only an off-by-default migration gate while the per-phase channel was primary;",
    "// the native orchestration channel is now the default path.",
    "const isOrchestrationWorkflowDisabled = (): boolean => {",
    "  const raw = (process.env.AGENT_ORCHESTRATION_WORKFLOW ?? '').trim().toLowerCase();",
    "  return raw === '0' || raw === 'false';",
    "};"
  )
  $helper = ($lines -join $nl1)
  $c1 = $c1.Replace($anchor1, $anchor1 + $nl1 + $nl1 + $helper)
}

$cond = "process.env.AGENT_ORCHESTRATION_WORKFLOW !== '1'"
$n = ([regex]::Matches($c1, [regex]::Escape($cond))).Count
if ($n -gt 0) {
  $c1 = $c1.Replace($cond, "isOrchestrationWorkflowDisabled()")
  Write-Host "  flipped $n gate(s)"
}
Save-IfChanged $p1 $o1 $c1

# ---- 2) server.orchestrate.spec.ts : disabled-case must set flag=0 ----
$p2 = Join-Path $root 'agent-sidecar/src/server.orchestrate.spec.ts'
if (-not (Test-Path $p2)) { throw "missing: $p2" }
$c2 = [System.IO.File]::ReadAllText($p2)
$o2 = $c2
$nl2 = if ($c2.Contains("`r`n")) { "`r`n" } else { "`n" }

$blockOld = "  it('returns 404 when the orchestration workflow flag is disabled', async () => {" + $nl2 + "    delete process.env[ORCHESTRATION_FLAG];"
$blockNew = "  it('returns 404 when the orchestration workflow flag is explicitly disabled', async () => {" + $nl2 + "    process.env[ORCHESTRATION_FLAG] = '0';"
if ($c2.IndexOf($blockOld) -ge 0) {
  $c2 = $c2.Replace($blockOld, $blockNew)
} elseif ($c2.IndexOf("process.env[ORCHESTRATION_FLAG] = '0';") -lt 0) {
  throw 'spec: disabled-case block anchor not found'
}
Save-IfChanged $p2 $o2 $c2

Write-Host "done."