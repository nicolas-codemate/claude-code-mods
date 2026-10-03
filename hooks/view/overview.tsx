import type { PullRequestSummary, ReviewThread } from '../../types'
import { ASK_BUTTON_KEY_PREFIX } from '../constants'
import type { ShortcutAction } from '../keymap'
import { overviewAnchorKeyOf } from '../questions'
import { renderLineCounts, renderThreadNavigation } from './labels'
import { renderThreadsAndQuestion } from './threads'
import type { ExplorerActions, QuestionState, ThreadNavigation, ViewElements } from './types'

export type OverviewInput = {
  pullRequest: PullRequestSummary
  blocks: string[]
  blockOffset: number
  visibleBlocks: number
  threads: ReviewThread[]
  questionState: QuestionState
  threadNavigation: ThreadNavigation
  hotkeyOf: (action: ShortcutAction) => string | undefined
  actions: ExplorerActions
}

export function renderOverview(ui: ViewElements, input: OverviewInput) {
  const { Box, Button, Markdown, Text } = ui
  const { pullRequest } = input
  const shownBlocks = input.blocks.slice(input.blockOffset, input.blockOffset + input.visibleBlocks)

  return (
    <Box flexDirection="column">
      <Box flexDirection="row" flexShrink={0} backgroundColor={ui.theme.headerBackground} paddingX={1}>
        <Box flexGrow={1}>
          <Text bold color={ui.theme.heading} wrap="truncate-end">
            {pullRequest.overviewHeadline}
          </Text>
        </Box>
        {renderThreadNavigation(ui, input.threadNavigation, input.hotkeyOf, input.actions)}
        {input.blocks.length > 1 && (
          <Text color={ui.theme.muted}>
            {input.blockOffset + 1}–{input.blocks.length}
            {'   '}
          </Text>
        )}
        <Text>
          {renderLineCounts(ui, pullRequest.additions, pullRequest.deletions)}
          <Text color={ui.theme.muted}>
            {'  ·  '}
            {pullRequest.changedFiles} file{pullRequest.changedFiles > 1 ? 's' : ''}
          </Text>
        </Text>
      </Box>
      {shownBlocks.map((block, shownBlockIndex) => {
        const blockIndex = input.blockOffset + shownBlockIndex
        const anchorKey = overviewAnchorKeyOf(pullRequest.number, blockIndex, block)
        return (
          <Box key={`block-${blockIndex}`} flexDirection="column" flexShrink={0} marginBottom={1}>
            <Box flexDirection="row">
              <Box width={4} flexShrink={0}>
                <Box display="none" hover={{ display: 'flex' }}>
                  <Button
                    key={`${ASK_BUTTON_KEY_PREFIX}overview-${blockIndex}`}
                    plain
                    label="[+]"
                    onPress={() => input.actions.openQuestion(anchorKey)}
                  />
                </Box>
              </Box>
              <Box flexGrow={1} flexShrink={1} flexDirection="column">
                <Markdown text={block} />
              </Box>
            </Box>
            {renderThreadsAndQuestion(ui, {
              anchorKey,
              threads: input.threads,
              questionState: input.questionState,
              actions: input.actions,
              ask: question => input.actions.askAboutOverviewBlock(anchorKey, blockIndex, question),
              armForPrompt: () => input.actions.armOverviewQuestion(anchorKey, blockIndex),
            })}
          </Box>
        )
      })}
    </Box>
  )
}
