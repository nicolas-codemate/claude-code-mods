import { expect, test } from 'claude-code/testing'

import { wavDurationMs } from './wav'

const wavOf = (byteRate: number, dataBytes: number, declaredDataSize: number): Uint8Array => {
  const bytes = new Uint8Array(44 + dataBytes)
  const view = new DataView(bytes.buffer)
  const writeAscii = (offset: number, text: string) => [...text].forEach((character, index) => (bytes[offset + index] = character.charCodeAt(0)))
  writeAscii(0, 'RIFF')
  writeAscii(8, 'WAVE')
  writeAscii(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint32(28, byteRate, true)
  writeAscii(36, 'data')
  view.setUint32(40, declaredDataSize, true)
  return bytes
}

test('the length of a WAV file is read off its header', async () => {
  expect(wavDurationMs(wavOf(1000, 500, 500))).toBe(500)
})

test('a streamed WAV with no data size is measured to the end of the file', async () => {
  expect(wavDurationMs(wavOf(1000, 250, 0xffffffff))).toBe(250)
})

test('a file that is no WAV has no length', async () => {
  expect(wavDurationMs(new TextEncoder().encode('{"error":"quota"}'))).toBe(null)
})
