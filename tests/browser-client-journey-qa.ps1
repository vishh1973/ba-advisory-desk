$ErrorActionPreference = "Stop"

$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
$bundledNodeRoot = "C:\Users\anand\.cache\codex-runtimes\codex-primary-runtime\dependencies\node"
$nodeExe = "$bundledNodeRoot\bin\node.exe"
if ($nodeCommand) {
  try {
    & $nodeCommand.Source --version *> $null
    if ($LASTEXITCODE -eq 0) {
      $nodeExe = $nodeCommand.Source
    }
  } catch {
    $nodeExe = "$bundledNodeRoot\bin\node.exe"
  }
}
if (!(Test-Path $nodeExe)) {
  throw "Node.js was not found. Install Node.js LTS or run this QA script from Codex with the bundled runtime available."
}
$localNodeModules = Join-Path (Split-Path -Parent $PSScriptRoot) "node_modules"
$env:NODE_PATH = (($localNodeModules, "$bundledNodeRoot\node_modules\.pnpm\node_modules", "$bundledNodeRoot\node_modules") -join [IO.Path]::PathSeparator)
$env:NODE_OPTIONS = (($env:NODE_OPTIONS, "--use-system-ca") -join " ").Trim()

$scriptPath = Join-Path $PSScriptRoot "browser-client-journey-qa.js"
& $nodeExe $scriptPath
if ($LASTEXITCODE -ne 0) {
  exit $LASTEXITCODE
}
