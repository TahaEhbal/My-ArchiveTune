/*
 * ArchiveTune (2026)
 * © Rukamori — github.com/rukamori
 * GPL-3.0 License | Contributors: see git history
 * Do not remove or alter this notice. - Per GPL-3.0 Section 4 & Section 5
 */

package moe.rukamori.archivetune.repository

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.sync.withPermit
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import moe.rukamori.archivetune.db.MusicDatabase
import moe.rukamori.archivetune.db.entities.PlaylistEntity
import moe.rukamori.archivetune.db.entities.PlaylistSongMap
import moe.rukamori.archivetune.innertube.YouTube
import moe.rukamori.archivetune.innertube.models.SongItem
import moe.rukamori.archivetune.innertube.models.WatchEndpoint
import moe.rukamori.archivetune.models.toMediaMetadata
import timber.log.Timber
import java.time.Duration
import java.time.LocalDateTime
import javax.inject.Inject
import javax.inject.Singleton

sealed interface RecommendedPlaylistResult {
    data class Success(
        val count: Int,
    ) : RecommendedPlaylistResult

    /** "the main playlist" doesn't exist (or has no usable songs) yet. */
    data object NoSource : RecommendedPlaylistResult

    /** YouTube Music didn't return anything (usually: offline). */
    data object NothingFound : RecommendedPlaylistResult
}

/**
 * Builds the "Recommended for you" playlist from the songs in "the main playlist".
 *
 * How it works:
 *  1. Every song in the source playlist is a "seed" (a random sample of at most [MaxSeeds] per
 *     refresh, so each refresh surfaces different picks and the number of requests stays sane).
 *  2. For each seed we ask YouTube Music for its related songs. A related song earns points from
 *     every seed that suggests it, with more points the higher it sits in that seed's list.
 *  3. Artists you already have lots of songs from in the source playlist add a bonus.
 *  4. Songs already in the source playlist are dropped, the rest are sorted best-first.
 *
 * The playlist has no fixed size: it keeps every song whose score is a meaningful fraction of the
 * best one, so a bigger / more varied source playlist produces a longer list.
 */
@Singleton
class RecommendedPlaylistRepository
    @Inject
    constructor(
        private val database: MusicDatabase,
    ) {
        private val mutex = Mutex()
        private val _isRefreshing = MutableStateFlow(false)
        val isRefreshing: StateFlow<Boolean> = _isRefreshing.asStateFlow()

        /** Creates the (empty) playlist entry if it doesn't exist so it shows up in the library. */
        suspend fun ensurePlaylistExists() =
            withContext(Dispatchers.IO) {
                if (database.getPlaylistById(PLAYLIST_ID) == null) {
                    database.withTransaction {
                        insert(
                            PlaylistEntity(
                                id = PLAYLIST_ID,
                                name = PLAYLIST_NAME,
                                browseId = null,
                                bookmarkedAt = LocalDateTime.now(),
                                isEditable = true,
                            ),
                        )
                    }
                }
            }

        /** Regenerates the playlist if it is empty or older than [MaxAgeHours]. */
        suspend fun refreshIfStale() {
            ensurePlaylistExists()
            val playlist = database.getPlaylistById(PLAYLIST_ID)
            val lastUpdate = database.playlistLastUpdateTime(PLAYLIST_ID)
            val stale =
                (playlist?.songCount ?: 0) == 0 ||
                    lastUpdate == null ||
                    Duration.between(lastUpdate, LocalDateTime.now()).toHours() >= MaxAgeHours
            if (stale) refresh()
        }

        suspend fun refresh(): RecommendedPlaylistResult {
            if (!mutex.tryLock()) return RecommendedPlaylistResult.NothingFound
            _isRefreshing.value = true
            return try {
                withContext(Dispatchers.IO) { generate() }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                Timber.w(e, "Failed to build recommended playlist")
                RecommendedPlaylistResult.NothingFound
            } finally {
                _isRefreshing.value = false
                mutex.unlock()
            }
        }

        private suspend fun generate(): RecommendedPlaylistResult {
            ensurePlaylistExists()
            val sourceId =
                database.playlistIdByNameIgnoreCase(SOURCE_PLAYLIST_NAME)
                    ?: return RecommendedPlaylistResult.NoSource
            val sourceSongs = database.getPlaylistSongs(sourceId).map { it.song }
            val sourceIds = sourceSongs.mapTo(HashSet()) { it.id }

            val seeds =
                sourceSongs
                    .filter { !it.song.isLocal && it.id.length == YOUTUBE_VIDEO_ID_LENGTH }
                    .shuffled()
                    .take(MaxSeeds)
            if (seeds.isEmpty()) return RecommendedPlaylistResult.NoSource

            // How much of the source playlist each artist makes up -> taste signal.
            val artistShare =
                sourceSongs
                    .flatMap { song -> song.artists.map { it.id } }
                    .groupingBy { it }
                    .eachCount()

            val limiter = Semaphore(ConcurrentRequests)
            val related: List<List<SongItem>> =
                coroutineScope {
                    seeds
                        .map { seed ->
                            async { limiter.withPermit { loadRelated(seed.id) } }
                        }.awaitAll()
                }

            val scores = HashMap<String, Double>()
            val items = HashMap<String, SongItem>()
            val seedHits = HashMap<String, Int>()
            related.forEach { list ->
                list
                    .filter { it.id !in sourceIds && it.id.length == YOUTUBE_VIDEO_ID_LENGTH }
                    .distinctBy { it.id }
                    .forEachIndexed { rank, item ->
                        items.putIfAbsent(item.id, item)
                        // Higher in a seed's list = stronger match.
                        scores.merge(item.id, 1.0 / (1.0 + rank / 8.0), { a, b -> a + b })
                        seedHits.merge(item.id, 1, { a, b -> a + b })
                    }
            }
            if (items.isEmpty()) return RecommendedPlaylistResult.NothingFound

            val ranked =
                items.values
                    .map { item ->
                        val artistBonus =
                            item.artists
                                .mapNotNull { artist -> artist.id?.let { artistShare[it] } }
                                .maxOrNull()
                                ?.coerceAtMost(MaxArtistBonusSongs)
                                ?.times(ARTIST_BONUS_PER_SONG)
                                ?: 0.0
                        // Songs suggested by several different seeds are the safest bets.
                        val consensus = (seedHits[item.id] ?: 1) - 1
                        item to (scores.getValue(item.id) + artistBonus + consensus * CONSENSUS_BONUS)
                    }.sortedByDescending { it.second }

            val best = ranked.first().second
            val cutoff = best * MinScoreFractionOfBest
            val chosen =
                ranked
                    .filter { it.second >= cutoff }
                    .take(AbsoluteMaxSongs)
                    .map { it.first }
            if (chosen.isEmpty()) return RecommendedPlaylistResult.NothingFound

            database.withTransaction {
                clearPlaylist(PLAYLIST_ID)
                chosen.forEachIndexed { index, item ->
                    insert(item.toMediaMetadata())
                    insert(
                        PlaylistSongMap(
                            playlistId = PLAYLIST_ID,
                            songId = item.id,
                            position = index,
                        ),
                    )
                }
                getPlaylistById(PLAYLIST_ID)?.playlist?.let { entity ->
                    update(entity.copy(lastUpdateTime = LocalDateTime.now()))
                }
            }
            return RecommendedPlaylistResult.Success(chosen.size)
        }

        private suspend fun loadRelated(songId: String): List<SongItem> =
            try {
                withTimeoutOrNull(PER_SEED_TIMEOUT_MS) {
                    val next = YouTube.next(WatchEndpoint(videoId = songId)).getOrNull()
                    val relatedSongs =
                        next
                            ?.relatedEndpoint
                            ?.let { YouTube.related(it).getOrNull()?.songs }
                            .orEmpty()
                    (relatedSongs + next?.items.orEmpty()).filter { it.id != songId }
                }.orEmpty()
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                emptyList()
            }

        companion object {
            const val PLAYLIST_ID = "LPRecommendedForYou"
            const val PLAYLIST_NAME = "Recommended for you"
            const val SOURCE_PLAYLIST_NAME = "the main playlist"

            private const val YOUTUBE_VIDEO_ID_LENGTH = 11
            private const val MaxSeeds = 40
            private const val ConcurrentRequests = 4
            private const val PER_SEED_TIMEOUT_MS = 20_000L
            private const val MaxAgeHours = 24L
            private const val MaxArtistBonusSongs = 5
            private const val ARTIST_BONUS_PER_SONG = 0.15
            private const val CONSENSUS_BONUS = 0.5
            private const val MinScoreFractionOfBest = 0.2
            private const val AbsoluteMaxSongs = 400
        }
    }
