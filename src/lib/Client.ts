import { EventEmitter } from 'events'

import Discovery from './Discovery'
import type DiscoveryType from './types/DiscoveryType'

import DataClient from './util/DataClient'
import MeterServer from './MeterServer'
import { CHACTIONS, MESSAGETYPES } from './constants'

import {
  analysePacket,
  createPacket
} from './util/MessageProtocol'

import { parseChannelString } from './util/channelUtil'
import { intToLE, shortToLE } from './util/bufferUtil'

import handleZBPacket from './packetParser/ZB'
import handleJMPacket from './packetParser/JM'
import handlePVPacket from './packetParser/PV'

import SubscriptionOptions from './types/SubscriptionOptions'
import { craftSubscribe, unsubscribePacket } from './util/subscriptionUtil'
import handleMSPacket from './packetParser/MS'
import CacheProvider from './util/CacheProvider'
import { ZlibNode } from './util/zlib/zlibNodeParser'
import { getZlibValue } from './util/zlib/zlibUtil'
import { linearVolumeTo32, logVolumeTo32, onOff, transitionValue } from './util/valueUtil'
import ChannelSelector from './types/ChannelSelector'
import { simplifyPathTokens, tokenisePath, valueTransform } from './util/treeUtil'
import ChannelCount from './types/ChannelCount'

// Forward discovery events
const discovery = new Discovery()

type fnCallback<T = any> = (obj: T) => void;
type dataFnCallback<T = any> = (obj: {
  code: any,
  data: T
}) => void;

export declare interface Client {
  on(event: MESSAGETYPES, listener: fnCallback): this;
  on(event: 'data', listener: dataFnCallback): this;
  once(event: MESSAGETYPES, listener: fnCallback): this;
  once(event: 'data', listener: dataFnCallback): this;
  off(event: MESSAGETYPES, listener: fnCallback): this;
  off(event: 'data', listener: dataFnCallback): this;
  addListener(event: MESSAGETYPES, listener: fnCallback): this;
  addListener(event: 'data', listener: dataFnCallback): this;
  removeListener(event: MESSAGETYPES, listener: fnCallback): this;
  removeListener(event: 'data', listener: dataFnCallback): this;
  removeAllListeners(event: MESSAGETYPES): this;
  removeAllListeners(event: 'data'): this;
}

// eslint-disable-next-line no-redeclare
export class Client extends EventEmitter {
  readonly serverHost: string
  readonly serverPort: number
  readonly serverPortUDP: number

  meteringClient: Awaited<ReturnType<typeof MeterServer>>
  meteringData: any

  channelCounts: ChannelCount

  readonly state: ReturnType<typeof CacheProvider>
  private zlibData?: ZlibNode

  private conn: ReturnType<typeof DataClient>
  private connectPromise: Promise<Client>

  constructor(host: string, port: number = 53000) {
    super()
    if (!host) throw new Error('Host address not supplied')

    this.serverHost = host
    this.serverPort = port
    this.serverPortUDP = 52704

    this.meteringClient = null
    this.meteringData = {}

    this.conn = DataClient(this.handleRecvPacket.bind(this))

    this.state = CacheProvider({
      get: (key) => this.zlibData ? getZlibValue(this.zlibData, key) : null
    })

    this.on(MESSAGETYPES.ZLIB, (ZB) => {
      this.zlibData = ZB
    })

    this.on(MESSAGETYPES.Setting, ({ name, value }) => {
      name = simplifyPathTokens(tokenisePath(name))

      value = valueTransform(name, value, {
        'line.*.volume'(value: Buffer) {
          return value.readInt32LE()
        }
      })

      this.state.set(name, value)
    })
  }

  static async discover(timeout = 10 * 1000) {
    const devices: { [serial: string]: DiscoveryType } = {}
    const func = device => {
      devices[device.serial] = device
    }

    discovery.on('discover', func)
    await discovery.start(timeout)
    discovery.off('discover', func)

    return Object.values(devices)
  }

  /**
   * Subscribe to the metering data
   */
  async meterSubscribe(port?: number) {
    port = port || this.serverPortUDP
    this.meteringClient = await MeterServer.call(this, port, this.channelCounts, (meterData) => this.emit('meter', meterData))
    this._sendPacket(MESSAGETYPES.Hello, shortToLE(port), 0x00)
  }

  /**
   * Unsubscribe from the metering data
   */
  meterUnsubscribe() {
    if (!this.meteringClient) return
    this.meteringClient.close()
    this.meteringClient = null
  }

  async connect(subscribeData?: SubscriptionOptions) {
    if (this.connectPromise) return this.connectPromise
    return (this.connectPromise = new Promise((resolve, reject) => {
      const rejectHandler = (err: Error) => {
        this.connectPromise = null
        return reject(err)
      }

      this.conn.once('error', rejectHandler)

      this.conn.connect(this.serverPort, this.serverHost, () => {
        // #region Connection handshake
        Promise.all([
          /**
           * Await for the first zlib response to resolve channel counts
           */
          new Promise((resolve) => {
            const zlibInitCallback = () => {
              this.removeListener(MESSAGETYPES.ZLIB, zlibInitCallback)
              this.channelCounts = {
                line: Object.keys(this.state.get('line')).length,
                return /* aka tape? */: Object.keys(this.state.get('return')).length,
                fxReturn /* fxbus == fxreturn */: Object.keys(this.state.get('fxreturn')).length,
                aux: Object.keys(this.state.get('aux')).length,
                main: Object.keys(this.state.get('main')).length
              }

              resolve(this)
            }
            this.addListener(MESSAGETYPES.ZLIB, zlibInitCallback)
          }),

          /**
           * Await for the subscription success
           */
          new Promise((resolve) => {
            const subscribeCallback = data => {
              if (data.id === 'SubscriptionReply') {
                this.removeListener(MESSAGETYPES.JSON, subscribeCallback)
                resolve(this)
              }
            }
            this.addListener(MESSAGETYPES.JSON, subscribeCallback)
          })
        ]).then(() => {
          this.conn.removeListener('error', rejectHandler)

          this.emit('connected')
          resolve(this)
        })

        // Send subscription request
        this._sendPacket(MESSAGETYPES.JSON, craftSubscribe(subscribeData))
        // #endregion

        // #region Keep alive
        // Send a KeepAlive packet every second
        const keepAliveLoop = setInterval(() => {
          if (this.conn.destroyed) {
            clearInterval(keepAliveLoop)
            return
          }
          this._sendPacket(MESSAGETYPES.KeepAlive)
        }, 1000)
        // #endregion
      })
    }))
  }

  async close() {
    this.meterUnsubscribe()
    await this._sendPacket(MESSAGETYPES.JSON, unsubscribePacket).then(() => {
      this.conn.destroy()
    })
  }

  /**
   * Analyse, decode and emit packets
   */
  private handleRecvPacket(packet) {
    let [messageCode, data] = analysePacket(packet)
    if (messageCode === null) return

    // Handle message types
    // eslint-disable-next-line
    const handlers: { [k in MESSAGETYPES]?: (data) => any } = {
      [MESSAGETYPES.JSON]: handleJMPacket,
      [MESSAGETYPES.Setting]: handlePVPacket,
      [MESSAGETYPES.ZLIB]: handleZBPacket,
      [MESSAGETYPES.FaderPosition]: handleMSPacket,
      [MESSAGETYPES.DeviceList]: null,
      [MESSAGETYPES.Unknown1]: null,
      [MESSAGETYPES.Unknown3]: null
    }

    if (Object.prototype.hasOwnProperty.call(handlers, messageCode)) {
      data = handlers[messageCode]?.call?.(this, data) ?? data
    } else {
      console.warn('Unhandled message code', messageCode)
    }

    this.emit(messageCode, data)
    this.emit('data', { code: messageCode, data })
  }

  sendList(key) {
    this._sendPacket(
      MESSAGETYPES.FileResource,
      Buffer.concat([
        Buffer.from([0x01, 0x00]),
        Buffer.from('List' + key.toString()),
        Buffer.from([0x00, 0x00])
      ])
    )
  }

  /**
   * Send bytes to the console
   */
  private async _sendPacket(...params: Parameters<typeof createPacket>) {
    return new Promise((resolve) => {
      const bytes = createPacket(...params)
      this.conn.write(bytes, null, (resp) => {
        resolve(resp)
      })
    })
  }

  /**
   * **INTERNAL** Send a mute/unmute command to the target
   */
  private _setMuteState(selector: ChannelSelector, state) {
    this._sendPacket(
      MESSAGETYPES.Setting,
      Buffer.concat([
        Buffer.from(`${parseChannelString(selector)}/${CHACTIONS.MUTE}\x00\x00\x00`),
        onOff.encode(state)
      ])
    )
  }

  /**
   * Mute a given channel
   */
  mute(selector: ChannelSelector) {
    this.setMute(selector, true)
  }

  /**
   * Unmute a given channel
   */
  unmute(selector: ChannelSelector) {
    this.setMute(selector, false)
  }

  /**
   * Toggle the mute status of a channel
   */
  toggleMute(selector: ChannelSelector) {
    const currentState = this.state.get(`${parseChannelString(selector)}/${CHACTIONS.MUTE}`)
    this.setMute(selector, !currentState)
  }

  /**
   * Set the mute status of a channel
   */
  setMute(selector: ChannelSelector, status: boolean) {
    this._setMuteState(selector, status)
  }

  /**
   * **INTERNAL** Send a level command to the target
   */
  private _setLevel(this: Client, selector: ChannelSelector, level, duration: number = 0): Promise<null> {
    const channelString = parseChannelString(selector)
    const target = `${channelString}/${CHACTIONS.VOLUME}`

    const assertReturn = () => {
      // Additional time to wait for response
      return new Promise<null>((resolve) => {
        // 0ms timeout - queue event loop
        setTimeout(() => {
          this.state.set(target, level)
          resolve(null)
        }, 0)
      })
    }

    const set = (level) => {
      this._sendPacket(
        MESSAGETYPES.Setting,
        Buffer.concat([
          Buffer.from(`${target}\x00\x00\x00`),
          intToLE(level)
        ])
      )
    }

    if (!duration) {
      set(level)
      return assertReturn()
    }

    // Transitioning to zero is hard because the numbers go from 0x3f800000 to 0x3a...... then suddenly 0
    // So if we see transition to/from 0, we transition to/from 0x3a...... first
    const currentLevel = this.state.get(target, 0)

    // console.log(`Change ${target} from ${currentLevel} to ${level}`)

    // Don't do anything if we already are on the same level
    // Unlikely because of the approximation values
    if (currentLevel === level) {
      return assertReturn()
    }

    const pseudoZeroLevel = linearVolumeTo32(1)
    // If the target level is 0, transition to the smallest non-zero level
    if (level === 0) {
      return new Promise((resolve) => {
        transitionValue(
          currentLevel || pseudoZeroLevel,
          pseudoZeroLevel,
          duration,
          (v) => set(v),
          async () => {
            // After transition, finally set the level to 0
            set(0)
            resolve(await assertReturn())
          }
        )
      })
    } else {
      return new Promise((resolve) => {
        // If currentLevel == 0, then short circuit to use the smallest non-zero value (linear 1)
        transitionValue(
          currentLevel || pseudoZeroLevel,
          level, duration,
          (v) => set(v),
          async () => {
            resolve(await assertReturn())
          }

        )
      })
    }
  }

  /**
   * Set volume (decibels)
   * 
   * @param channel 
   * @param level range: -84 dB to 10 dB
   */
  async setChannelVolumeDb(selector: ChannelSelector, decibel: number, duration?: number) {
    return this._setLevel(selector, logVolumeTo32(decibel), duration)
  }

  /**
   * Set volume (pseudo intensity)
   * 
   * @description Sound is difficult, so this function attempts to provide a "what-you-see-is-what-you-get" interface to control the volume levels.  
   *              `100` Sets the fader to the top (aka +10 dB)  
   *              `72` Sets the fader to unity (aka 0 dB) or a value close enough  
   *              `0` Sets the fader to the bottom (aka -84 dB)
   * @see http://www.sengpielaudio.com/calculator-levelchange.htm
   */
  async setChannelVolumeLinear(selector: ChannelSelector, linearLevel: number, duration?: number) {
    /**
     * 🚒 🧯 🧨 🚒 🧯 🧨 
     * 🔥 this is fine 🔥 
     * 🚒 🧯 🧨 🚒 🧯 🧨
     * https://preview.redd.it/j4886fi37yh71.gif?format=mp4&s=df2258d4a78e0933515e0c445a96c8ee7b3f89c4
     * 
     * Every 10dB is a 10x change
     * 20dB means 100x
     * 30dB means 1000x
     */
    return this._setLevel(selector, linearVolumeTo32(linearLevel), duration)
  }

  /**
   * Look at metering data and adjust channel fader so that the level is of a certain loudness
   * NOTE: This is not perceived loudness. Not very practical, but useful in a pinch?
   * 
   * @param channel 
   * @param level 
   * @param duration 
   */
  async normaliseChannelTo(channel, level, duration?: number) {
    // TODO:
  }
}

export default Client
