/**
 * Device discovery client
 * Listen to the `discover` event with <Discover>.on('discover', callback)
 */

import { analysePacket } from './util/MessageProtocol'
import { EventEmitter } from 'events'
import * as dgram from 'dgram'
import DiscoveryType from './types/DiscoveryType'

export default class extends EventEmitter {
  socket: dgram.Socket

  /**
   * Scan for devices
   * 
   * @param timeout Duration (in milliseconds) to discover for, or indefinitely if empty
   * @returns 
   */
  async start(timeout = null) {
    return new Promise<void>((resolve, reject) => {
      this.stop()
      this.setup()

      if (timeout !== null) {
        setTimeout(() => {
          this.stop()
          resolve()
        }, timeout)
      }
    })
  }

  /**
   * Shut down discovery client
   */
  stop() {
    if (this.socket !== undefined) {
      this.socket.close()
      this.socket = undefined
    }
  }

  /**
   * Setup routine
   */
  private setup() {
    // Listen to broadcast on port 47809
    const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true })
    socket.bind(47809, '0.0.0.0')
    socket.on('listening', function () {
      this.setBroadcast(true)
    })

    socket.on('message', (packet, rinfo) => {
      const [code, data] = analysePacket(packet, true)
      if (!code) return

      const port = data.slice(4, 6).readUInt16LE()
      // Split data by null byte
      const fragments = []
      for (
        let payload = data.slice(20), cur = 0, f: Buffer;
        cur < payload.length;
        cur += f.length + 1
      ) {
        fragments.push(
          (f = payload.slice(cur, payload.indexOf('\x00', cur))).toString()
        )
      }

      // eslint-disable-next-line
      const [nameA, _, serial, nameB] = fragments
      
      if (!serial) return
      
      // nameA: Model number for device image identification
      // nameB: ???
      this.emit('discover', {
        name: nameA,
        serial,
        ip: rinfo.address,
        port: port,
        timestamp: new Date()
      } as DiscoveryType)
    })

    this.socket = socket
  }
}
