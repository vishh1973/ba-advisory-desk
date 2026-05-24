$ErrorActionPreference = "Stop"

$nodeRoot = "C:\Users\anand\.cache\codex-runtimes\codex-primary-runtime\dependencies\node"
$env:NODE_PATH = "$nodeRoot\node_modules\.pnpm\node_modules;$nodeRoot\node_modules"
$env:NODE_OPTIONS = (($env:NODE_OPTIONS, "--use-system-ca") -join " ").Trim()

& "$nodeRoot\bin\node.exe" "$PSScriptRoot\browser-client-journey-qa.js"
if ($LASTEXITCODE -ne 0) {
  exit $LASTEXITCODE
}
