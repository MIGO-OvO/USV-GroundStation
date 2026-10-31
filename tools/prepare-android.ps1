param([string]$ProjectRoot = (Split-Path -Parent $PSScriptRoot))
$ErrorActionPreference = 'Stop'
$androidProject = Join-Path $ProjectRoot 'src-tauri/gen/android'
if (!(Test-Path -LiteralPath (Join-Path $androidProject 'app/build.gradle.kts'))) {
    throw '先执行 npm exec tauri -- android init --ci --skip-targets-install'
}
$appGradle = Join-Path $androidProject 'app/build.gradle.kts'
$text = Get-Content -LiteralPath $appGradle -Raw
$text = $text -replace 'compileSdk = \d+', 'compileSdk = 36' -replace 'targetSdk = \d+', 'targetSdk = 36'
$text = $text -replace 'optimization\s*\{\s*enable = true\s*\}', 'isMinifyEnabled = false'
$text = $text.Replace('manifestPlaceholders["usesCleartextTraffic"] = "false"', 'manifestPlaceholders["usesCleartextTraffic"] = "true"')
Set-Content -LiteralPath $appGradle -Value $text -Encoding utf8
$rootGradle = Join-Path $androidProject 'build.gradle.kts'
$text = (Get-Content -LiteralPath $rootGradle -Raw) -replace 'com.android.tools.build:gradle:[\d.]+', 'com.android.tools.build:gradle:8.13.2'
Set-Content -LiteralPath $rootGradle -Value $text -Encoding utf8
$buildSrcGradle = Join-Path $androidProject 'buildSrc/build.gradle.kts'
$text = (Get-Content -LiteralPath $buildSrcGradle -Raw) -replace 'com.android.tools.build:gradle:[\d.]+', 'com.android.tools.build:gradle:8.13.2'
Set-Content -LiteralPath $buildSrcGradle -Value $text -Encoding utf8
$wrapper = Join-Path $androidProject 'gradle/wrapper/gradle-wrapper.properties'
$text = (Get-Content -LiteralPath $wrapper -Raw) -replace 'gradle-[\d.]+-bin.zip', 'gradle-8.14.3-bin.zip'
Set-Content -LiteralPath $wrapper -Value $text -Encoding utf8
$kotlinDir = Join-Path $androidProject 'app/src/main/java/com/migo/usvgroundstation'
New-Item -ItemType Directory -Path $kotlinDir -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $ProjectRoot 'src-tauri/android/ExportPlugin.kt') -Destination $kotlinDir -Force
$gradleProperties = Join-Path $androidProject 'gradle.properties'
$text = (Get-Content -LiteralPath $gradleProperties -Raw) -replace 'org.gradle.jvmargs=.*', 'org.gradle.jvmargs=-Xmx1536m -XX:MaxMetaspaceSize=512m -Dfile.encoding=UTF-8'
if ($text -notmatch 'org.gradle.workers.max=') { $text += "`norg.gradle.workers.max=2`nkotlin.compiler.execution.strategy=in-process`n" }
Set-Content -LiteralPath $gradleProperties -Value $text -Encoding utf8
Write-Output 'Android: SDK 36, AGP 8.13.2, Gradle 8.14.3; native export installed.'
