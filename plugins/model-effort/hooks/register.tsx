import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

// shortcut: the engine gives a mod no read of the current effort; the highlight starts empty
// and follows the last press. Upgrade when the API exposes the session's effort.
const chosenEffort = atom({ plugin: 'model-effort', key: 'chosenEffort' } as const, null)

const MODELS = [
  { label: 'Fable 5.2', id: 'claude-fable-5-2', family: 'fable' },
  { label: 'Opus 5.5', id: 'claude-opus-5-5', family: 'opus' },
  { label: 'Sonnet 5.5', id: 'claude-sonnet-5-5', family: 'sonnet' },
  { label: 'Haiku 5.5', id: 'claude-haiku-5-5', family: 'haiku' },
] as const

const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const

const COMMANDS = ['paste', 'btw', 'rewind', 'clear'] as const
type CommandName = (typeof COMMANDS)[number]

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const pad2 = (n: number) => String(n).padStart(2, '0')
const levelColor = (p: number, warn: number, danger: number) => (p >= danger ? 'red' : p >= warn ? 'yellow' : 'green')

// Under an hour: countdown; otherwise local time (the week's limit adds the day)
function resetLabel(iso: string | undefined, now: number, withDay: boolean): string {
  const at = iso ? Date.parse(iso) : NaN
  if (Number.isNaN(at)) return ''
  const left = at - now
  if (left < 3600000) return ` ${Math.max(0, Math.ceil(left / 60000))}m`
  const d = new Date(at)
  return ` ${withDay ? `${DAYS[d.getDay()]} ` : ''}${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}

export const register: Register = on => {
  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const engineLine = await next(e)
    const current = (await $.session.model()).toLowerCase()
    const effort = await read($, chosenEffort)

    // Usage is optional: a failed read leaves the ctx box with placeholders, never breaks the picker
    const usage = await $.session.usage().catch(() => undefined)
    const now = await $.clock.now()
    const limits = usage?.rateLimits ?? []
    const h5 = limits.find(l => l.kind === 'five_hour')
    const d7 = limits.find(l => l.kind === 'seven_day')
    const gauge = (label: string, p: number | undefined, warn: number, danger: number, extra = '') =>
      p === undefined ? (
        <Text dimColor>{`${label} --%`}</Text>
      ) : (
        <Box>
          <Text color={levelColor(p, warn, danger)}>{`${label} ${Math.round(p)}%`}</Text>
          <Text color="blue">{extra}</Text>
        </Box>
      )
    const clock = new Date(now)

    // shortcut: shows the first 5 branches, no scrolling; upgrade when a long list matters
    const repo = await $.session.repo().catch(() => null)
    const gitOut = repo
      ? await $.process.run(['git', 'branch', '--format=%(HEAD)%(refname:short)'], { timeoutMs: 3000 }).catch(() => undefined)
      : undefined
    const branches = gitOut?.exitCode === 0 ? gitOut.stdout.split(/\r?\n/).filter(Boolean).slice(0, 5) : []

    // A rejected run (unknown command, busy session) is a trust boundary: tell the person.
    const run = (command: string, args: string) =>
      $.command.run({ command, args }).catch((err: unknown) => {
        $.ui.toast(`/${command} failed: ${String((err as Error)?.message ?? err).slice(0, 80)}`)
        throw err
      })

    // shortcut: clipboard is read through Windows PowerShell; upgrade when the API can read a clipboard
    const paste = async () => {
      try {
        const r = await $.process.run(
          ['powershell', '-NoProfile', '-Command', '[Console]::OutputEncoding=[Text.Encoding]::UTF8; Get-Clipboard -Raw'],
          { timeoutMs: 5000 },
        )
        const text = r.stdout.replace(/\r?\n$/, '')
        if (r.exitCode !== 0 || text === '') return void $.ui.toast('paste: clipboard is empty or holds no text')
        await $.prompt.fill({ text, mode: 'insert' })
      } catch (err: unknown) {
        $.ui.toast(`paste failed: ${String((err as Error)?.message ?? err).slice(0, 80)}`)
      }
    }

    // /btw needs a question after its name, so the button only seeds the prompt
    const press: Record<CommandName, () => void> = {
      paste: () => void paste(),
      btw: () => void $.prompt.fill({ text: '/btw ', mode: 'insert' }),
      rewind: () => void run('rewind', '').catch(() => {}),
      clear: () => void run('clear', '').catch(() => {}),
    }

    return (
      <Box flexDirection="column">
        {engineLine}
        <Box justifyContent="center" width="100%">
        <Box flexDirection="column" borderStyle="round" borderColor="green" paddingX={1}>
          <Text bold color="green">model</Text>
          {MODELS.map(m => (
            <Button key={m.id} onPress={() => void run('model', m.id).catch(() => {})}>
              <Text bold={current.includes(m.family)} color={current.includes(m.family) ? 'cyan' : undefined}>
                {m.label}
              </Text>
            </Button>
          ))}
        </Box>
        <Box flexDirection="column" borderStyle="round" borderColor="magenta" paddingX={1} marginLeft={1}>
          <Text bold color="magenta">parameters</Text>
          {gauge('ctx', usage?.context?.percent ?? 0, 45, 60)}
          {gauge('5h', h5?.percentUsed, 70, 90, resetLabel(h5?.resetsAt, now, false))}
          {gauge('7d', d7?.percentUsed, 70, 90, resetLabel(d7?.resetsAt, now, true))}
          <Text dimColor>{`${pad2(clock.getHours())}:${pad2(clock.getMinutes())}`}</Text>
        </Box>
        <Box flexDirection="column" borderStyle="round" borderColor="blue" paddingX={1} marginLeft={1}>
          <Text bold color="blue">effort</Text>
          {EFFORTS.map(level => (
            <Button
              key={level}
              onPress={() =>
                void run('effort', level)
                  .then(() => update($, chosenEffort, () => level))
                  .catch(() => {})
              }
            >
              <Text bold={effort === level} color={effort === level ? 'cyan' : undefined}>
                {level}
              </Text>
            </Button>
          ))}
        </Box>
        <Box flexDirection="column" borderStyle="round" borderColor="yellow" paddingX={1} marginLeft={1}>
          <Text bold color="yellow">commands</Text>
          {COMMANDS.map(name => (
            <Button key={name} onPress={press[name]}>
              <Text>{`/${name}`}</Text>
            </Button>
          ))}
        </Box>
        <Box flexDirection="column" borderStyle="round" borderColor="magenta" paddingX={1} marginLeft={1}>
          <Text bold color="magenta">git</Text>
          {!repo ? (
            <Text dimColor>no git</Text>
          ) : branches.length === 0 ? (
            <Text dimColor>no commits</Text>
          ) : (
            branches.map(b => (
              <Text key={b} bold={b.startsWith('*')} color={b.startsWith('*') ? 'cyan' : undefined}>
                {b.slice(1)}
              </Text>
            ))
          )}
        </Box>
        </Box>
      </Box>
    )
  })
}
