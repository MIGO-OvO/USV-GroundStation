# Android 构建与部署

按本轮要求，Android 构建与发布已暂停，CI 仅保留 Windows NSIS。以下保留已有适配和构建记录，供后续恢复时使用。此前生成的 APK 使用重设计前的界面，不能作为本轮浅色/深色界面的验证结果。

首版目标为 Android 8.0（API 26）以上 ARM64 平板，使用与 Windows 相同的 Rust 控制核心。支持 UDP/TCP、ROS HTTP、MapLibre WebGL、相同的工作区与文件导出。Windows 串口选项在 Android 隐藏，USB 串口未实现。

## 可重复构建

需要 Node.js 24、Rust stable、JDK 17、Android SDK 36、build-tools 36.0.0 和 NDK 27.2.12479018。本项目不要求全局安装到特定路径；设置环境变量即可。

```powershell
$env:JAVA_HOME='C:\path\to\jdk-17'
$env:ANDROID_HOME='C:\path\to\android-sdk'
$env:ANDROID_SDK_ROOT=$env:ANDROID_HOME
$env:NDK_HOME="$env:ANDROID_HOME\ndk\27.2.12479018"
$env:PATH="$env:JAVA_HOME\bin;$env:ANDROID_HOME\platform-tools;$env:PATH"
sdkmanager 'platform-tools' 'platforms;android-36' 'build-tools;36.0.0' 'ndk;27.2.12479018'
rustup target add aarch64-linux-android
npm ci
npm exec tauri -- android init --ci --skip-targets-install
./tools/prepare-android.ps1
npm exec tauri -- android build --target aarch64 --apk --ci
```

Tauri 生成工程位于忽略的 `src-tauri/gen/android`。`prepare-android.ps1` 固定 SDK 36、AGP 8.13.2、Gradle 8.14.3，安装本项目原生文件导出组件并限制构建并行度；每次重新初始化后运行。默认模板所用 SDK 37 在本次实际 SDK 仓库中不可用，不能直接采用。

APK 在 `src-tauri/gen/android/app/build/outputs/apk/`。未签名 release APK 需使用 Android `zipalign` 和 `apksigner` 签名后安装。已有项目签名材料保留在本机及 GitHub encrypted secrets 中；不将 keystore 或密码提交 Git。当前 CI 不执行 Android 构建或签名。

## 网络与权限

应用声明 INTERNET。UDP/TCP 在 Rust 中运行；HTTP 使用 Rust client，前端不直接访问设备。构建脚本允许现有局域网 ROS HTTP 服务。首版没有 Android 运行时局域网权限适配，目标 SDK 固定为 36；提高 SDK 时需重新核查权限变化。

系统文件选择器使用 `ACTION_CREATE_DOCUMENT`，用户选择 CSV/ZIP/JSON 保存位置。应用先写私有缓存，再由原生组件复制到所选 URI；取消不会显示保存成功。不申请全盘存储权限。

## 生命周期

切换 React 工作区或重新初始化地图不销毁 Rust actor。Android 转屏由 Tauri Activity 处理，身份数据库保存在应用私有数据目录。进程被系统杀死后，下次启动分配新 session，旧任务转 unknown 并禁止 START 重放。

首版没有后台 foreground service 或系统级常驻保证。应用退后台、锁屏、省电限制可能暂停或杀死进程；实际船控时保持前台和亮屏，不能依赖手机后台维持 GCS 失联保护。飞控和 ROS 的硬件保护继续执行。后台、旋转、锁屏及网络切换需要在目标平板上按验收清单验证。

## 实际验证边界

此前本机生成过ARM64 Release APK，并用项目专用RSA3072密钥签名，apksigner校验通过。证书SHA256指纹为 `8dad5649db176f60a95712013c0ed3ff44be395f2d9ca36f1f8d29277f30ce66`。该产物使用旧界面，本轮不发布。响应式浏览器测试不能替代 Android WebView、触摸、GPU、网络和生命周期验收。本机未连接 Android 设备或模拟器，未执行 APK 安装和设备端控制。

本机发布密钥保存在忽略的 `.reference/release-signing/usv-groundstation.p12`，密码以当前Windows用户的DPAPI加密保存在同目录 `password.dpapi.xml`。两项GitHub encrypted secrets供CI签名。维护者应另行安全备份密钥及可恢复的密码；仅复制DPAPI文件到其他账户无法解密。后续升级必须保留同一签名密钥。
