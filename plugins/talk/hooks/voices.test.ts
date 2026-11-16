import { expect, test } from 'claude-code/testing'

import { piperChoicesOf, piperSpeakerOf, piperVoiceKeyOf } from './voices'

const entry = (code: string, name: string, quality: string, speakers: Record<string, number> = {}) => ({
  files: { [`${code.split('_')[0]}/${code}/${name}/${quality}/${code}-${name}-${quality}.onnx`]: { size_bytes: 63_000_000 } },
  name,
  quality,
  num_speakers: Math.max(1, Object.keys(speakers).length),
  language: { code, family: code.split('_')[0] ?? '' },
  speaker_id_map: speakers,
})

test('the Piper voices of the language are listed, one per speaker, low quality and crowds left out', async () => {
  const catalog = {
    'fr_FR-gilles-low': entry('fr_FR', 'gilles', 'low'),
    'fr_FR-siwis-medium': entry('fr_FR', 'siwis', 'medium'),
    'fr_FR-upmc-medium': entry('fr_FR', 'upmc', 'medium', { jessica: 0, pierre: 1 }),
    'fr_FR-mls-medium': entry('fr_FR', 'mls', 'medium', Object.fromEntries(Array.from({ length: 125 }, (_, index) => [`${index}`, index]))),
    'en_US-lessac-medium': entry('en_US', 'lessac', 'medium'),
  }

  expect(piperChoicesOf(catalog, 'fr')).toEqual([
    { value: 'fr_FR-siwis-medium', label: 'Siwis', download: 'fr/fr_FR/siwis/medium/fr_FR-siwis-medium', sizeBytes: 63_000_000 },
    { value: 'fr_FR-upmc-medium#jessica', label: 'Upmc Jessica', download: 'fr/fr_FR/upmc/medium/fr_FR-upmc-medium', sizeBytes: 63_000_000 },
    { value: 'fr_FR-upmc-medium#pierre', label: 'Upmc Pierre', download: 'fr/fr_FR/upmc/medium/fr_FR-upmc-medium', sizeBytes: 63_000_000 },
  ])
  expect(piperChoicesOf(catalog, 'en')).toEqual([{ value: 'en_US-lessac-medium', label: 'Lessac US', download: 'en/en_US/lessac/medium/en_US-lessac-medium', sizeBytes: 63_000_000 }])
})

test('a voice of several speakers names the speaker after its key', async () => {
  expect(piperVoiceKeyOf('fr_FR-upmc-medium#pierre')).toBe('fr_FR-upmc-medium')
  expect(piperSpeakerOf('fr_FR-upmc-medium#pierre')).toBe('pierre')
  expect(piperSpeakerOf('fr_FR-siwis-medium')).toBe(null)
})
