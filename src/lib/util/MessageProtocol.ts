import { CByte, PacketHeader } from '../constants'
import { shortToLE } from './bufferUtil'

type MessageCode = string
/**
 * Decode packet buffer
 * @returns message code
 * @returns buffer
 */
export function analysePacket(
  packet: Buffer,
  ignoreLengthMismatch = false
): [Number, MessageCode, Buffer] {
  if (!PacketHeader.matches(packet)) {
    console.warn('Ignoring irrelevant packet', packet)
    return [-1, null, null]
  }

  const payloadLength = packet.slice(4, 6).readUInt16LE()
  if (payloadLength + 6 !== packet.length) {
    if (!ignoreLengthMismatch) {
      console.warn(`Packet is meant to be ${payloadLength + 6} bytes long, but is actually ${packet.length} bytes long`)
      return [-1, null, null]
    }
  }

  return [
    packet.slice(4, 6).readUInt16LE(),
    packet.slice(6, 8).toString(),
    // Skip bytes 8-11 (identifier pair)
    packet.slice(12)
  ]
}

/**
 * Craft a packet
 * 
 * @param messageCode 
 * @param data 
 * @param customA 
 * @param customB 
 * @returns 
 */
export function createPacket(messageCode: Buffer | string, data?: Buffer | string, customA?: any, customB?: any) {
  if (!data) data = Buffer.allocUnsafe(0)
  const connIdentity = Buffer.from([
    customA ?? CByte.A,
    0x00,
    customB ?? CByte.B,
    0x00
  ])
  if (connIdentity.length !== 4) throw Error('connIdentity')

  const lengthLE = shortToLE(
    messageCode.length + connIdentity.length + data.length
  )
  if (lengthLE.length !== 2) throw Error('lengthLE')

  // Use allocUnsafe for performance improvements
  const b = Buffer.alloc(
    PacketHeader.length +
    lengthLE.length +
    messageCode.length +
    connIdentity.length +
    data.length
  )

  let cursor = 0
  b.fill(PacketHeader)
  b.fill(lengthLE, (cursor += PacketHeader.length))
  b.write(messageCode instanceof Buffer ? messageCode.toString() : messageCode, (cursor += lengthLE.length))
  b.fill(connIdentity, (cursor += messageCode.length))

  if (typeof data === 'string') b.write(data, (cursor += connIdentity.length))
  else b.fill(data, (cursor += connIdentity.length))

  return b
}
