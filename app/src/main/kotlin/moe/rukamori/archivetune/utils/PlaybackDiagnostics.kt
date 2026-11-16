package moe.rukamori.archivetune.utils

import android.util.Log
import timber.log.Timber
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * Keeps the most recent info/warning/error log lines in memory so the playback error screen can
 * include them when the user taps Copy. This is how we see which stream clients were tried and why
 * each one failed, without needing a computer connected to the phone.
 */
object PlaybackDiagnostics : Timber.Tree() {
    private const val MAX_LINES = 70
    private const val MAX_LINE_LENGTH = 260
    private val lines = ArrayDeque<String>()
    private val clock = SimpleDateFormat("HH:mm:ss", Locale.US)

    override fun log(
        priority: Int,
        tag: String?,
        message: String,
        t: Throwable?,
    ) {
        val tagName = tag.orEmpty()
        if (priority < Log.INFO && !tagName.contains("Youtubei")) return
        val interesting =
            tagName.contains("YTPlayer") ||
                tagName.contains("MusicService") ||
                tagName.contains("AudioStream") ||
                tagName.contains("PoToken") ||
                tagName.contains("BotGuard") ||
                tagName.contains("Stream") ||
                tagName.contains("Youtubei")
        if (!interesting) return
        val level =
            when (priority) {
                Log.ERROR -> "E"
                Log.WARN -> "W"
                Log.INFO -> "I"
                else -> "D"
            }
        val throwable = t?.let { " | ${it.javaClass.simpleName}: ${it.message.orEmpty()}" }.orEmpty()
        val line = "${clock.format(Date())} $level/$tagName: $message$throwable".take(MAX_LINE_LENGTH)
        synchronized(lines) {
            lines.addLast(line)
            while (lines.size > MAX_LINES) lines.removeFirst()
        }
    }

    fun dump(): String = synchronized(lines) { lines.joinToString("\n") }
}
