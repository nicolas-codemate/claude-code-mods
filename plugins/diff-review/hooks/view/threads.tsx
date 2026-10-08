import type { ReviewThread } from '../../types'
import { CANCEL_QUESTION_KEY, DICTATE_QUESTION_KEY, DISMISS_THREAD_KEY_PREFIX, REPLY_INPUT_KEY_PREFIX } from '../constants'
import { isLastExchangeDone } from '../questions'
import type { ExplorerActions, QuestionState, ViewElements } from './types'

export const THREAD_INDENT = 16

export function renderThreadsAndQuestion(
  ui: ViewElements,
  input: {
    anchorKey: string
    threads: ReviewThread[]
    questionState: QuestionState
    actions: ExplorerActions
    ask: (question: string) => Promise<void>
    armForPrompt: () => Promise<void>
  },
) {
  const { Box } = ui
  const { anchorKey, questionState } = input

  return (
    <Box flexDirection="column" flexShrink={0}>
      {input.threads
        .filter(thread => thread.anchorKey === anchorKey)
        .map(thread => renderThread(ui, thread, input.actions, questionState.isAnswerPulseLit))}
      {questionState.anchorWithOpenInput === anchorKey &&
        questionState.isQuestionFieldShown &&
        renderQuestionField(ui, questionState.questionFieldKey, input)}
      {questionState.armedAnchorKey === anchorKey && renderArmedBanner(ui, input.actions)}
    </Box>
  )
}

export function renderThread(ui: ViewElements, thread: ReviewThread, actions: ExplorerActions, isAnswerPulseLit: boolean) {
  const { Box, Button, Input, Markdown, Text } = ui

  return (
    <Box
      flexDirection="column"
      flexShrink={0}
      marginLeft={THREAD_INDENT}
      marginRight={2}
      marginY={1}
      borderStyle="round"
      borderColor={ui.theme.accentBorder}
      backgroundColor={ui.theme.threadBackground}
      paddingX={1}
    >
      <Box key={`thread-header-${thread.id}`} flexDirection="row">
        <Box flexGrow={1}>
          <Text color={ui.theme.accent} bold>
            ◆ Claude
            {!isLastExchangeDone(thread) && <Text color={ui.theme.accent}>{isAnswerPulseLit ? '  ●' : '  ○'}</Text>}
          </Text>
        </Box>
        <Button
          key={`${DISMISS_THREAD_KEY_PREFIX}${thread.id}`}
          plain
          dimColor
          hover={{ color: ui.theme.accent }}
          label="× close"
          onPress={() => actions.dismissThread(thread.id)}
        />
      </Box>
      {thread.exchanges.map((exchange, exchangeIndex) => (
        <Box flexDirection="column" flexShrink={0} marginTop={exchangeIndex === 0 ? 0 : 1}>
          <Text color={ui.theme.accent}>
            {'› '}
            {exchange.question}
          </Text>
          {exchange.answer === '' ? (
            <Text color={ui.theme.muted}>{exchange.status === 'queued' ? 'queued…' : 'Claude is thinking…'}</Text>
          ) : (
            <Markdown text={exchange.answer} />
          )}
        </Box>
      ))}
      {thread.isContextCleared && <Text color={ui.theme.muted}>Conversation cleared since: a reply sends this thread again.</Text>}
      {isLastExchangeDone(thread) && (
        <Box flexDirection="row" flexShrink={0} marginTop={1}>
          <Text color={ui.theme.muted}>↳ </Text>
          <Box flexGrow={1}>
            <Input
              key={`${REPLY_INPUT_KEY_PREFIX}${thread.id}`}
              placeholder="reply…"
              onSubmit={value => actions.replyInThread(thread.id, value)}
            />
          </Box>
          <Box flexShrink={0} marginLeft={1}>
            <Button
              key={`dictate-reply-${thread.id}`}
              variant="primary"
              label="↓ dictate in prompt"
              onPress={() => actions.armReply(thread.id)}
            />
          </Box>
        </Box>
      )}
    </Box>
  )
}

function renderQuestionField(
  ui: ViewElements,
  questionFieldKey: string,
  input: { actions: ExplorerActions; ask: (question: string) => Promise<void>; armForPrompt: () => Promise<void> },
) {
  const { Box, Button, Input } = ui

  return (
    <Box
      flexDirection="column"
      flexShrink={0}
      marginLeft={THREAD_INDENT}
      marginRight={2}
      marginY={1}
      borderStyle="round"
      borderColor={ui.theme.accent}
      backgroundColor={ui.theme.threadBackground}
      paddingX={1}
    >
      <Input
        key={questionFieldKey}
        autoFocus
        onInput={value => input.actions.updateQuestionDraft(value)}
        placeholder="Type your question, Enter to send"
        onSubmit={value => input.ask(value)}
      />
      {/* The arrows and Tab follow the order written: the down arrow from the field reaches the dictation button first. */}
      <Box flexDirection="row">
        <Box flexGrow={1}>
          <Button
            key={DICTATE_QUESTION_KEY}
            plain
            dimColor
            hover={{ color: ui.theme.accent }}
            label="↓ dictate in the prompt instead"
            onPress={() => input.armForPrompt()}
          />
        </Box>
        <Box key="cancel-question-box" flexShrink={0} marginLeft={1}>
          <Button
            key={CANCEL_QUESTION_KEY}
            plain
            dimColor
            hover={{ color: ui.theme.accent }}
            label="× cancel"
            onPress={() => input.actions.closeQuestion()}
          />
        </Box>
      </Box>
    </Box>
  )
}

function renderArmedBanner(ui: ViewElements, actions: ExplorerActions) {
  const { Box, Button, Text } = ui

  return (
    <Box flexDirection="row" flexShrink={0} marginLeft={THREAD_INDENT} marginY={1} borderStyle="round" borderColor={ui.theme.commitSha} paddingX={1}>
      <Box flexGrow={1}>
        <Text color={ui.theme.commitSha}>Ask from the prompt below: click it, then type or hold Space to dictate, Enter to send.</Text>
      </Box>
      <Button key="disarm-question" label="× cancel" onPress={() => actions.disarmQuestion()} />
    </Box>
  )
}
