$ErrorActionPreference = 'Stop'

function Find-WebView2 {
    $roots = @(
        "${env:ProgramFiles(x86)}\Microsoft\EdgeWebView\Application",
        "$env:ProgramFiles\Microsoft\EdgeWebView\Application",
        "$env:LOCALAPPDATA\Microsoft\EdgeWebView\Application"
    )
    foreach ($runtimeRoot in $roots) {
        if (Test-Path -LiteralPath $runtimeRoot) {
            $runtime = Get-ChildItem -Path "$runtimeRoot\*\msedgewebview2.exe" -File | Select-Object -First 1
            if ($runtime) { return $runtime }
        }
    }
}

$runtime = Find-WebView2
if (!$runtime) {
    Write-Output 'WebView2 Runtime is absent; installing the Microsoft Evergreen Runtime.'
    $installer = Join-Path $env:TEMP 'USV-WebView2Setup.exe'
    Invoke-WebRequest 'https://go.microsoft.com/fwlink/p/?LinkId=2124703' -OutFile $installer
    $signature = Get-AuthenticodeSignature -LiteralPath $installer
    if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notmatch 'O=Microsoft Corporation') {
        throw 'WebView2 installer signature is not valid for Microsoft Corporation'
    }
    $install = Start-Process -FilePath $installer -ArgumentList '/silent', '/install' -WindowStyle Hidden -Wait -PassThru
    if ($install.ExitCode -ne 0) { throw "WebView2 installation failed: $($install.ExitCode)" }
    $runtime = Find-WebView2
    if (!$runtime) { throw 'WebView2 Runtime executable is missing after installation' }
}
Write-Output "WebView2 $($runtime.VersionInfo.ProductVersion): $($runtime.FullName)"
