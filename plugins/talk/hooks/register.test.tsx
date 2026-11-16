import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

const BAND = {
  plugin: 'talk',
  component: 'AbovePrompt',
  requestId: 'above-prompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 12, bodyColumns: 100, scroll: { offset: 0, bodyRows: 12 }, view: {} },
} as const

const COMPOSE_INPUT = { model: 'claude-opus-5-5', promptModel: 'claude-opus-5-5', surfaces: ['terminal'], tools: [], outputStyle: null, traits: [] } as const

const TYPED_AT_PROMPT = { origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 200 } } as const

const NO_OUTPUT = { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false }

const oneSecondWavBase64 = (): string => {
  const bytes = new Uint8Array(44 + 1000)
  const view = new DataView(bytes.buffer)
  const writeAscii = (offset: number, text: string) => [...text].forEach((character, index) => (bytes[offset + index] = character.charCodeAt(0)))
  writeAscii(0, 'RIFF')
  writeAscii(8, 'WAVE')
  writeAscii(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint32(28, 1000, true)
  writeAscii(36, 'data')
  view.setUint32(40, 1000, true)
  return btoa(String.fromCharCode(...bytes))
}

// The engine beneath the mod: a session, and the band Claude Code draws when the mod leaves it.
const standInForTheEngine = (on: On, environment: Readonly<Record<string, string>> = {}) => {
  on('command.register', () => ({ value: { command: 'talk' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('env.get', (_, e) => ({ value: environment[e.name] }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('prompt.submit', (_, e) => ({ text: e.text }))
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })
}

const machineWithoutVoice = (on: On) => {
  on('fs.exists', () => ({ value: false }))
  on('process.run', (_, e) => ({ value: { ...NO_OUTPUT, stdout: e.argv[0] === 'uname' ? 'Linux\n' : '' } }))
}

// A machine with Piper and pw-play, whose player sounds for ten seconds of the test's clock.
const machineWithPiper = (on: On, clock: { sleep: (ms: number) => Promise<void> }) => {
  on('fs.exists', () => ({ value: true }))
  on('fs.list', () => ({ value: [{ name: 'fr_FR-test-medium.onnx', kind: 'file', size: 1, mtimeMs: 0, isLink: false }] }))
  on('fs.read', () => ({ value: { base64: oneSecondWavBase64() } }))
  on('process.run', (_, e) => {
    const stdout = e.argv[0] === 'uname' ? 'Linux\n' : e.argv[0] === 'sh' ? 'pw-play\npiper\n' : e.argv[0] === 'mktemp' ? '/tmp/talk-test\n' : ''
    return { value: { ...NO_OUTPUT, stdout } }
  })
  on('process.spawn', async function* () {
    await clock.sleep(10_000)
    return { value: { code: 0, signal: null } }
  })
}

test('talk mode asks Claude for spoken answers and shows them above the prompt until it is turned off', async ($, on) => {
  const clock = mock.clock(on)
  standInForTheEngine(on)
  machineWithoutVoice(on)
  on('prompt.compose', () => ({ sections: [{ id: 'engine', text: 'You are Claude Code.', scope: 'shared' }] }))

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  const before = await $.prompt.compose(COMPOSE_INPUT)
  expect(before.sections.map(section => section.id)).toEqual(['engine'])

  const turnedOn = await $.command.run({ command: 'talk', args: '', ...TYPED_AT_PROMPT })
  expect('text' in turnedOn ? turnedOn.text : '').toContain('Talk mode on (French)')
  const during = await $.prompt.compose(COMPOSE_INPUT)
  expect(during.sections.map(section => section.id)).toEqual(['engine', 'talk:voice-conversation'])
  expect(during.sections[1]?.text).toContain('in French')

  await $.turn.complete({ answer: 'On peut **commencer** par le cache.', durationMs: 10, isAborted: false, turnId: 'turn-1', reason: 'answer' })
  await clock.settle()
  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect((await band.find({ type: 'Text', text: /No voice available/ }))?.text).toContain('Piper')
  // The sentence of the answer, its Markdown marks gone.
  expect((await band.find({ type: 'Text', text: /commencer/ }))?.text).toBe('On peut commencer par le cache.')
  await band.unmount()

  await $.command.run({ command: 'talk', args: 'off', ...TYPED_AT_PROMPT })
  const after = await $.prompt.compose(COMPOSE_INPUT)
  expect(after.sections.map(section => section.id)).toEqual(['engine'])
  const bandWhenOff = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect((await bandWhenOff.find({ type: 'Text', text: /engine/ }))?.text).toBe('engine')
  await bandWhenOff.unmount()
})

test('the band shows the answer being read; a turn Claude Code starts by itself leaves the voice, a message the person sends cuts it', async ($, on) => {
  const clock = mock.clock(on)
  standInForTheEngine(on)
  machineWithPiper(on, clock)

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run({ command: 'talk', args: '', ...TYPED_AT_PROMPT })
  await $.turn.complete({ answer: 'Première idée. Puis une seconde.', durationMs: 10, isAborted: false, turnId: 'turn-1', reason: 'answer' })
  await clock.advance(500)
  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  const phaseShown = async () => /· (\w+)/.exec((await band.find({ type: 'Text', text: /^● Talk · / }))?.text ?? '')?.[1]
  expect(await phaseShown()).toBe('Speaking')
  // The whole answer, to read it at a glance while it is heard.
  expect((await band.find({ type: 'Text', text: /idée/ }))?.text).toBe('Première idée. Puis une seconde.')

  await $.turn.start({ text: 'A note Claude Code sends after a command', turnId: 'turn-of-the-engine' })
  await clock.advance(500)
  expect(await phaseShown()).toBe('Speaking')

  await $.prompt.submit({ text: 'On en reparle', wait: false, origin: { kind: 'composer' } })
  expect(await phaseShown()).toBe('Stopped')
  await clock.advance(20_000)
  await band.unmount()
})

test('the stop of the band cuts the voice, and the band then offers to read the answer again', async ($, on) => {
  const clock = mock.clock(on)
  standInForTheEngine(on)
  machineWithPiper(on, clock)

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run({ command: 'talk', args: '', ...TYPED_AT_PROMPT })
  await $.command.run({ command: 'talk', args: 'test', ...TYPED_AT_PROMPT })
  await clock.advance(500)
  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect((await band.find({ type: 'Button', text: /stop/ }))?.key).toBe('stop')

  await band.press({ key: 'stop' })
  expect((await band.find({ type: 'Text', text: /^● Talk · / }))?.text).toBe('● Talk · Stopped')
  expect((await band.find({ type: 'Button', text: /replay/ }))?.key).toBe('replay')
  await clock.advance(10_000)
  await band.unmount()
})

test('each setting of the band opens its own choices, saved as /config does', { options: { speed: 1.25 } }, async ($, on) => {
  const written: { key: string; value: unknown }[] = []
  const row = (field: string, kind: 'choice' | 'number') => ({ key: `talk.${field}`, label: field, kind, value: '', provider: { kind: 'engine' }, isLocked: false })
  standInForTheEngine(on)
  machineWithoutVoice(on)
  on('config.list', () => ({ value: [row('engine', 'choice'), row('speed', 'number'), row('language', 'choice')] as never }))
  on('config.set', (_, e) => {
    written.push({ key: e.key, value: e.value })
    return { value: e.value }
  })

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run({ command: 'talk', args: '', ...TYPED_AT_PROMPT })
  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect((await band.find({ type: 'Text', text: /^1\.25x$/ }))?.text).toBe('1.25x')

  // The speed opens the speeds; the voice opens the voices in their place.
  await band.press({ key: 'setting-speed' })
  await band.press({ key: 'speed-1.50' })
  await band.press({ key: 'faster' })
  await band.press({ key: 'setting-engine' })
  expect(await band.find({ type: 'Button', text: /^1\.50x$/ })).toBe(undefined)
  await band.press({ key: 'engine-openai' })

  expect(written).toEqual([
    { key: 'talk.speed', value: 1.5 },
    { key: 'talk.speed', value: 1.3 },
    { key: 'talk.engine', value: 'openai' },
  ])
  await band.unmount()
})

test('with no cloud voice and no Piper, turning talk mode on installs Piper and a voice of the language by itself', async ($, on) => {
  const clock = mock.clock(on)
  const commands: string[] = []
  standInForTheEngine(on)
  on('fs.exists', () => ({ value: false }))
  on('process.run', (_, e) => {
    commands.push(e.argv.slice(0, 3).join(' '))
    return { value: { ...NO_OUTPUT, stdout: e.argv[0] === 'uname' ? 'Linux\n' : '' } }
  })

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run({ command: 'talk', args: '', ...TYPED_AT_PROMPT })
  await clock.settle()

  expect(commands).toEqual(expect.arrayContaining([
    'python3 -m venv',
    '/.local/share/piper/venv/bin/pip install --quiet',
    'sh -c set -e; mkdir -p "$1"; for suffix in .onnx.json .onnx; do curl -fsSL -o "$1/$2$suffix.part" "$3$suffix"; mv "$1/$2$suffix.part" "$1/$2$suffix"; done',
  ]))
})

test('a cloud voice with its key leaves the machine as it is', async ($, on) => {
  const clock = mock.clock(on)
  const commands: string[] = []
  standInForTheEngine(on, { ELEVENLABS_API_KEY: 'a-key' })
  on('fs.exists', () => ({ value: false }))
  on('process.run', (_, e) => {
    commands.push(e.argv[0] ?? '')
    return { value: { ...NO_OUTPUT, stdout: e.argv[0] === 'uname' ? 'Linux\n' : e.argv[0] === 'sh' ? 'pw-play\n' : '' } }
  })

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run({ command: 'talk', args: '', ...TYPED_AT_PROMPT })
  await clock.settle()

  expect(commands).not.toContain('python3')
})

test('a machine lacking what the install needs is told the command of its own system', async ($, on) => {
  const clock = mock.clock(on)
  standInForTheEngine(on)
  on('fs.exists', (_, e) => ({ value: e.path === '/etc/os-release' }))
  on('fs.read', () => ({ value: 'ID=ubuntu\nID_LIKE=debian\n' }))
  on('process.run', (_, e) => {
    const lacksVenv = e.argv[0] === 'python3' && e.argv[1] === '-c'
    return { value: { ...NO_OUTPUT, exitCode: lacksVenv ? 1 : 0, stdout: e.argv[0] === 'uname' ? 'Linux\n' : '' } }
  })

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run({ command: 'talk', args: '', ...TYPED_AT_PROMPT })
  await clock.settle()

  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect((await band.find({ type: 'Text', text: /needs/ }))?.text).toBe(
    'The local voice needs the venv module of python3. Run: sudo apt install python3-venv  then /talk setup.',
  )
  await band.unmount()
})
