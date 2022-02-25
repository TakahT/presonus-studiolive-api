import { PacketHeader } from './constants'

export function analysePacket(
  packet /* Buffer */,
  ignoreLengthMismatch = false
) {
  if (!PacketHeader.matches(packet)) {
    console.warn('Ignoring irrelevant packet', packet)
    return [null, null]
  }

  const note = false
  const payloadLength = packet.slice(4, 6).readUInt16LE()
  if (payloadLength + 6 !== packet.length) {
    if (!ignoreLengthMismatch) {
      console.warn(
        `Packet is meant to be ${payloadLength +
        6} bytes long, but is actually ${packet.length} bytes long`
      )
      return [null, null]
    }
  }

  const messageCode = packet.slice(6, 8).toString()
  // Skip bytes 8-11 (pair)
  const data = packet.slice(12)

  return [messageCode, data, note]
}

export interface SubscriptionOptions {
  /**
   * Application name
   */
  clientName?: string

  /**
   * Application internal name
   */
  clientInternalName?: string

  /**
   * Device name
   */
  clientDescription?: string // Name

  /**
   * Device ID
   */
  clientIdentifier?: string

  /**
   * ???
   */
  clientOptions?: string
}

export function craftSubscribe(overrides: SubscriptionOptions = {}) {
  const data = {
    id: 'Subscribe',
    clientName: 'UC-Surface',
    clientInternalName: 'ucremoteapp',
    clientType: 'Android',
    clientDescription: 'User', // Name of the client
    clientIdentifier: 'eb9857e4f6426ed5', // ID of the client
    clientOptions: 'perm users levl redu rtan',
    clientEncoding: 23117,
    ...overrides
  }

  return Buffer.concat([
    Buffer.from([0xf2, 0x00, 0x00, 0x00]),
    Buffer.from(JSON.stringify(data, null, ' '))
  ])
}

export function onOffCode(bool) {
  return Buffer.from(bool ? [0x00, 0x00, 0x80, 0x3f] : [0x00, 0x00, 0x00, 0x00])
}

export function onOffEval(bytes) {
  if (bytes.equals(new Uint8Array([0x00, 0x00, 0x80, 0x3f]))) {
    return true
  } else if (bytes.equals(new Uint8Array([0x00, 0x00, 0x00, 0x00]))) {
    return false
  }
  return bytes
}
