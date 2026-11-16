package moe.rukamori.archivetune.utils

import okhttp3.Dns
import java.net.Inet4Address
import java.net.InetAddress

/**
 * Makes lookups return IPv4 addresses when the host has any.
 *
 * YouTube ties each stream link to the internet address that requested it. On mobile networks that
 * have both IPv4 and IPv6, the request for the link and the request for the audio can leave over
 * different address types, and YouTube then answers the audio request with HTTP 403. Using IPv4
 * for both keeps them consistent. Hosts with no IPv4 address still resolve normally.
 */
object Ipv4PreferredDns {
    fun wrap(base: Dns): Dns =
        object : Dns {
            override fun lookup(hostname: String): List<InetAddress> {
                val all = base.lookup(hostname)
                val ipv4 = all.filterIsInstance<Inet4Address>()
                return if (ipv4.isNotEmpty()) ipv4 else all
            }
        }

    /** Follows whatever [YouTube.dns] currently is (system or DNS-over-HTTPS), IPv4 first. */
    fun followingYouTubeDns(): Dns =
        object : Dns {
            override fun lookup(hostname: String): List<InetAddress> =
                wrap(moe.rukamori.archivetune.innertube.YouTube.dns).lookup(hostname)
        }
}
