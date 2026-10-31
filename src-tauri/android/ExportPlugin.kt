package com.migo.usvgroundstation

import android.app.Activity
import android.content.Intent
import androidx.activity.result.ActivityResult
import app.tauri.annotation.ActivityCallback
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import java.io.File
import java.util.concurrent.Executors

@InvokeArg
class ExportArgs { lateinit var path: String }

@TauriPlugin
class ExportPlugin(private val activity: Activity) : Plugin(activity) {
    private val writer = Executors.newSingleThreadExecutor()

    private fun source(invoke: Invoke): File {
        val file = File(invoke.parseArgs(ExportArgs::class.java).path).canonicalFile
        val exports = File(activity.cacheDir, "exports").canonicalFile
        require(file.parentFile == exports && file.isFile) { "导出源文件无效" }
        return file
    }

    @Command
    fun save(invoke: Invoke) {
        try {
            val file = source(invoke)
            val mime = when (file.extension.lowercase()) {
                "zip" -> "application/zip"
                "csv" -> "text/csv"
                "json" -> "application/json"
                else -> "application/octet-stream"
            }
            val intent = Intent(Intent.ACTION_CREATE_DOCUMENT).apply {
                addCategory(Intent.CATEGORY_OPENABLE)
                type = mime
                putExtra(Intent.EXTRA_TITLE, file.name)
            }
            startActivityForResult(invoke, intent, "exportChosen")
        } catch (e: Exception) { invoke.reject(e.message ?: "无法打开文件保存界面") }
    }

    @ActivityCallback
    private fun exportChosen(invoke: Invoke, result: ActivityResult) {
        if (result.resultCode != Activity.RESULT_OK || result.data?.data == null) {
            runCatching { source(invoke).delete() }
            invoke.reject("已取消保存")
            return
        }
        val uri = result.data!!.data!!
        writer.execute {
            try {
                val file = source(invoke)
                val output = activity.contentResolver.openOutputStream(uri, "wt")
                    ?: throw IllegalStateException("无法写入所选位置")
                output.use { target -> file.inputStream().use { it.copyTo(target) } }
                file.delete()
                invoke.resolve(JSObject().apply { put("uri", uri.toString()) })
            } catch (e: Exception) { invoke.reject(e.message ?: "保存失败，请重试导出") }
        }
    }
}
