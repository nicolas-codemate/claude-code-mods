const ascii = (bytes: Uint8Array, offset: number): string => String.fromCharCode(...bytes.subarray(offset, offset + 4))

// The length of a WAV file's sound, read off its header; null for a file that is no WAV. A streamed WAV may declare its
// data chunk with no size, so the data is measured to the end of the file.
export const wavDurationMs = (bytes: Uint8Array): number | null => {
  if (bytes.length < 12 || ascii(bytes, 0) !== 'RIFF' || ascii(bytes, 8) !== 'WAVE') return null
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let byteRate: number | null = null
  let offset = 12
  while (offset + 8 <= bytes.length) {
    const chunkId = ascii(bytes, offset)
    const chunkSize = view.getUint32(offset + 4, true)
    if (chunkId === 'fmt ' && offset + 16 <= bytes.length) byteRate = view.getUint32(offset + 16, true)
    if (chunkId === 'data') {
      if (byteRate === null || byteRate === 0) return null
      const available = bytes.length - (offset + 8)
      const dataSize = chunkSize === 0 || chunkSize === 0xffffffff || chunkSize > available ? available : chunkSize
      return (dataSize / byteRate) * 1000
    }
    offset += 8 + chunkSize + (chunkSize % 2)
  }
  return null
}
