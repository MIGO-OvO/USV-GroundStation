param([string]$Binary = 'target/release/usv-groundstation.exe')
$ErrorActionPreference = 'Stop'

# WebView2 150+ ignores environment overrides in elevated hosts.
# Use the supported machine policy only on the disposable Actions runner.
if ($env:GITHUB_ACTIONS -ne 'true') { throw 'Run this CI harness in GitHub Actions; use native-smoke.mjs locally.' }
$elevated = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
Write-Output "Native smoke runner elevated: $elevated"
if (!$elevated) {
    node tools/native-smoke.mjs $Binary
    exit $LASTEXITCODE
}

$listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 0)
$listener.Start()
$env:USV_NATIVE_CDP_PORT = $listener.LocalEndpoint.Port
$listener.Stop()
$key = 'HKLM:\Software\Policies\Microsoft\Edge\WebView2\AdditionalBrowserArguments'
$name = [IO.Path]::GetFileName($Binary)
$previous = Get-ItemPropertyValue -LiteralPath $key -Name $name -ErrorAction SilentlyContinue
New-Item -Path $key -Force | Out-Null
try {
    New-ItemProperty -LiteralPath $key -Name $name -PropertyType String -Value "--remote-debugging-port=$env:USV_NATIVE_CDP_PORT" -Force | Out-Null
    node tools/native-smoke.mjs $Binary
    $smokeExit = $LASTEXITCODE
} finally {
    if ($null -eq $previous) { Remove-ItemProperty -LiteralPath $key -Name $name }
    else { Set-ItemProperty -LiteralPath $key -Name $name -Value $previous }
    Remove-Item Env:USV_NATIVE_CDP_PORT
}
exit $smokeExit
