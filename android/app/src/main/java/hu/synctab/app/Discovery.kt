package hu.synctab.app

import org.json.JSONObject
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.InetSocketAddress
import java.net.SocketTimeoutException

/**
 * A master gép UDP szórásos hirdetéseit figyeli (41234-es port, JSON: {"app":"synctab","name":..,"port":..}).
 * A feladó címét használjuk, nem a hirdetésben lévőt, mert az a hálózaton biztosan elérhető.
 */
class Discovery(private val onFound: (host: String, port: Int, name: String) -> Unit) : Thread("synctab-discovery") {

    @Volatile
    private var running = true
    private var socket: DatagramSocket? = null

    override fun run() {
        try {
            val s = DatagramSocket(null).apply {
                reuseAddress = true
                bind(InetSocketAddress(PORT))
                soTimeout = 1000
            }
            socket = s
            val buf = ByteArray(1024)
            while (running) {
                try {
                    val p = DatagramPacket(buf, buf.size)
                    s.receive(p)
                    val json = JSONObject(String(p.data, 0, p.length, Charsets.UTF_8))
                    if (json.optString("app") != "synctab") continue
                    val port = json.optInt("port", 8080)
                    val name = json.optString("name", "Master")
                    onFound(p.address.hostAddress ?: continue, port, name)
                } catch (_: SocketTimeoutException) {
                    // csak az ébresztés a leállítás figyeléséhez
                } catch (_: Exception) {
                    // hibás csomag: nem érdekes
                }
            }
        } catch (_: Exception) {
            // a port foglalt vagy nincs hálózat: kézi cím akkor is megadható
        } finally {
            socket?.close()
        }
    }

    fun stopNow() {
        running = false
        socket?.close()
    }

    companion object {
        const val PORT = 41234
    }
}
