/*
 * ArchiveTune (2026)
 * © Rukamori — github.com/rukamori
 * GPL-3.0 License | Contributors: see git history
 * Do not remove or alter this notice. - Per GPL-3.0 Section 4 & Section 5
 */

package moe.rukamori.archivetune.playback.preload

import android.net.Uri
import androidx.media3.datasource.cache.Cache
import androidx.media3.datasource.cache.ContentMetadata
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import moe.rukamori.archivetune.di.DownloadCache
import moe.rukamori.archivetune.di.PlayerCache
import moe.rukamori.archivetune.playback.stream.AudioStreamRequest
import moe.rukamori.archivetune.playback.stream.ResolveAudioStreamUseCase
import moe.rukamori.archivetune.utils.YTPlayerUtils
import timber.log.Timber
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class NextStreamPreloader
    @Inject
    constructor(
        private val resolveAudioStream: ResolveAudioStreamUseCase,
        @PlayerCache private val playerCache: Cache,
        @DownloadCache private val downloadCache: Cache,
        private val moduleAudio: moe.rukamori.archivetune.modules.ResolveModuleAudioUseCase,
    ) {
        /** One upcoming song: how to resolve it, and the URI the player will open for it. */
        data class PreloadItem(
            val request: AudioStreamRequest,
            val uri: Uri?,
        )

        private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
        private val lock = Any()

        private var targets: List<PreloadItem> = emptyList()
        private var job: Job? = null

        /**
         * Downloads the first part of an upcoming song's audio into the player cache so playback
         * starts instantly. Set by the playback service, which owns the data sources.
         */
        @Volatile
        var warmAudioBytes: (suspend (PreloadItem) -> Unit)? = null

        /**
         * Called when an upcoming song still can't be loaded after retries, so the problem is
         * known before that song starts playing.
         */
        @Volatile
        var onUpcomingFailure: ((mediaId: String, cause: Throwable) -> Unit)? = null

        /** Preloads [items] in order (next song first). Songs that are already ready are skipped. */
        fun updateTargets(items: List<PreloadItem>) {
            val jobToStart =
                synchronized(lock) {
                    if (items == targets && job != null) return
                    if (items.isEmpty()) {
                        targets = emptyList()
                        job?.cancel()
                        job = null
                        return
                    }

                    val previousJob = job
                    val nextJob =
                        scope.launch(start = CoroutineStart.LAZY) {
                            for (item in items) {
                                preloadOne(item)
                            }
                        }

                    targets = items
                    job = nextJob
                    previousJob?.cancel()
                    nextJob
                }

            jobToStart.invokeOnCompletion { cause ->
                synchronized(lock) {
                    if (job === jobToStart) {
                        job = null
                        // Let the next playback event try again if something went wrong.
                        if (cause != null && cause !is CancellationException) targets = emptyList()
                    }
                }
            }
            jobToStart.start()
        }

        fun cancel() {
            val jobToCancel =
                synchronized(lock) {
                    targets = emptyList()
                    job.also { job = null }
                }
            jobToCancel?.cancel()
        }

        private suspend fun preloadOne(item: PreloadItem) {
            val mediaId = item.request.mediaId
            var attempt = 0
            while (true) {
                try {
                    preload(item.request)
                    warmAudioBytes?.invoke(item)
                    return
                } catch (cancellation: CancellationException) {
                    throw cancellation
                } catch (throwable: Throwable) {
                    attempt++
                    Timber.tag(LOG_TAG).w(
                        throwable,
                        "Preload attempt %d failed for %s",
                        attempt,
                        mediaId,
                    )
                    if (attempt > MAX_RETRIES) {
                        onUpcomingFailure?.invoke(mediaId, throwable)
                        return
                    }
                    // Throw away the possibly-bad link and get a fresh one before retrying.
                    resolveAudioStream.invalidate(mediaId)
                    YTPlayerUtils.invalidateCachedStreamUrls(mediaId)
                    delay(RETRY_DELAY_MS * attempt)
                }
            }
        }

        private suspend fun preload(request: AudioStreamRequest) {
            if (moduleAudio.enabled() && request.allowModules) {
                resolveAudioStream.preload(request)
                return
            }

            val cacheKey = request.mediaId
            if (playerCache.isFullyCached(cacheKey) || downloadCache.isFullyCached(cacheKey)) return

            // Resolving is cheap when the link is already known; the audio warm-up that follows
            // skips itself when the start of the song is already cached.
            resolveAudioStream.preload(request)
        }

        private fun Cache.isFullyCached(key: String): Boolean {
            val contentLength = getContentMetadata(key).get(ContentMetadata.KEY_CONTENT_LENGTH, -1L)
            return contentLength > 0L && isCached(key, 0L, contentLength)
        }

        private companion object {
            const val LOG_TAG = "AudioStreamResolver"
            const val MAX_RETRIES = 2
            const val RETRY_DELAY_MS = 1_500L
        }
    }
