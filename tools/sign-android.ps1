param(
    [Parameter(Mandatory=$true)][string]$Keystore,
    [string]$Alias = 'usv-groundstation',
    [string]$Output = '.reference/release/USV-GroundStation_0.1.0_arm64.apk'
)
$ErrorActionPreference = 'Stop'
if (!$env:USV_ANDROID_STORE_PASSWORD) { throw 'Missing USV_ANDROID_STORE_PASSWORD' }
$project = Split-Path -Parent $PSScriptRoot
$sdk = if ($env:ANDROID_HOME) { $env:ANDROID_HOME } else { $env:ANDROID_SDK_ROOT }
$buildTools = Join-Path $sdk 'build-tools/36.0.0'
$candidates = @(Get-ChildItem -LiteralPath (Join-Path $project 'src-tauri/gen/android/app/build/outputs/apk') -Recurse -Filter '*release-unsigned.apk')
if ($candidates.Count -ne 1) { throw "Expected one unsigned release APK, found $($candidates.Count)" }
$destination = [IO.Path]::GetFullPath((Join-Path $project $Output))
New-Item -ItemType Directory -Path (Split-Path -Parent $destination) -Force | Out-Null
$aligned = "$destination.aligned"
& (Join-Path $buildTools 'zipalign.exe') -f -p 4 $candidates[0].FullName $aligned
if ($LASTEXITCODE -ne 0) { throw 'zipalign failed' }
& (Join-Path $buildTools 'apksigner.bat') sign --ks $Keystore --ks-key-alias $Alias --ks-pass env:USV_ANDROID_STORE_PASSWORD --key-pass env:USV_ANDROID_STORE_PASSWORD --out $destination $aligned
if ($LASTEXITCODE -ne 0) { throw 'apksigner failed' }
Remove-Item -LiteralPath $aligned
& (Join-Path $buildTools 'apksigner.bat') verify --verbose --print-certs $destination
if ($LASTEXITCODE -ne 0) { throw 'APK verification failed' }
Get-FileHash -LiteralPath $destination -Algorithm SHA256
