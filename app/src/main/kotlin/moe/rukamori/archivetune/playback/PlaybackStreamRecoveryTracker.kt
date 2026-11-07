/*
 * ArchiveTune (2026)
 * © Rukamori — github.com/rukamori
 * GPL-3.0 License | Contributors: see git history
 * Do not remove or alter this notice. - Per GPL-3.0 Section 4 & Section 5
 */

package moe.rukamori.archivetune.playback

internal class PlaybackStreamRecoveryTracker {
    private var attemptedMediaId: String? = null
    private var attempts = 0

    // Each failed attempt blocks the stream source that failed, so every retry tries a different
    // one. Allow several so the app can work through its fallbacks before showing an error.
    fun registerRetryAttempt(mediaId: String): Boolean {
        if (attemptedMediaId != mediaId) {
            attemptedMediaId = mediaId
            attempts = 0
        }
        if (attempts >= MAX_RETRIES_PER_SONG) return false
        attempts++
        return true
    }

    fun onPlaybackRecovered(mediaId: String?) {
        if (mediaId != null && attemptedMediaId == mediaId) {
            attemptedMediaId = null
            attempts = 0
        }
    }

    fun onMediaItemChanged(currentMediaId: String?) {
        if (attemptedMediaId != currentMediaId) {
            attemptedMediaId = null
            attempts = 0
        }
    }

    private companion object {
        const val MAX_RETRIES_PER_SONG = 4
    }
}
