import type { PullRequestSummary, ReviewThread } from '../../types'
import { ASK_BUTTON_KEY_PREFIX } from '../constants'
import type { ShortcutAction } from '../keymap'
import { descriptionBlocksOf, isListItemBlock, readingSectionsOf, splitListItemIndentation } from '../markdown'
import { overviewAnchorKeyOf, overviewThreadsOffTheDescription } from '../questions'
import { renderLineCounts, renderMarkdownWithImages, renderThreadNavigation } from './labels'
import { renderThread, renderThreadsAndQuestion, THREAD_INDENT } from './threads'
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
  isReadAloudAvailable: boolean
  actions: ExplorerActions
}

export function renderOverview(ui: ViewElements, input: OverviewInput) {
  const { Box, Button, Text } = ui
  const { pullRequest } = input
  const shownBlocks = input.blocks.slice(input.blockOffset, input.blockOffset + input.visibleBlocks)
  const threadsOffDescription = input.blockOffset === 0 ? overviewThreadsOffTheDescription(input.threads, pullRequest.number, input.blocks) : []
  // The title without its `#123`, then the description.
  const titleAndDescription = [pullRequest.overviewHeadline.replace(/^#\d+\s+/, ''), ...descriptionBlocksOf(input.blocks)].join('\n\n')
  const gutterColumns = input.isReadAloudAvailable ? 7 : 4
  const sectionTextByStartBlock = new Map(readingSectionsOf(input.blocks).map(section => [section.startBlockIndex, section.text]))

  return (
    <Box flexDirection="column">
      <Box flexDirection="row" flexShrink={0} backgroundColor={ui.theme.headerBackground} paddingX={1}>
        <Box flexGrow={1} flexShrink={1} minWidth={0}>
          <Text bold color={ui.theme.heading} wrap="truncate-end">
            {pullRequest.overviewHeadline}
          </Text>
        </Box>
        {renderThreadNavigation(ui, input.threadNavigation, input.hotkeyOf, input.actions)}
        {input.isReadAloudAvailable && (
          <Box flexShrink={0} marginRight={3}>
            <Button key="read-overview" plain label="▶ read aloud" onPress={() => input.actions.readAloud(titleAndDescription)} />
          </Box>
        )}
        {input.blocks.length > 1 && (
          <Box flexShrink={0}>
            <Text color={ui.theme.muted}>
              {input.blockOffset + 1}–{input.blocks.length}
              {'   '}
            </Text>
          </Box>
        )}
        <Box flexShrink={0}>
          <Text>
            {renderLineCounts(ui, pullRequest.additions, pullRequest.deletions)}
            <Text color={ui.theme.muted}>
              {'  ·  '}
              {pullRequest.changedFiles} file{pullRequest.changedFiles > 1 ? 's' : ''}
            </Text>
          </Text>
        </Box>
      </Box>
      {threadsOffDescription.map(thread => (
        <Box key={`thread-off-description-${thread.id}`} flexDirection="column" flexShrink={0}>
          <Box marginLeft={THREAD_INDENT} marginTop={1} flexShrink={0}>
            <Text color={ui.theme.muted}>Its part of the description was rewritten since:</Text>
          </Box>
          {renderThread(ui, thread, input.actions, input.questionState.isAnswerPulseLit)}
        </Box>
      ))}
      {shownBlocks.map((block, shownBlockIndex) => {
        const blockIndex = input.blockOffset + shownBlockIndex
        const anchorKey = overviewAnchorKeyOf(pullRequest.number, blockIndex, block)
        const nextBlock = input.blocks[blockIndex + 1]
        const isFollowedBySameList = isListItemBlock(block) && nextBlock !== undefined && isListItemBlock(nextBlock)
        const { indentation, text } = splitListItemIndentation(block)
        const sectionText = input.isReadAloudAvailable ? sectionTextByStartBlock.get(blockIndex) : undefined
        return (
          <Box key={`block-${blockIndex}`} flexDirection="column" flexShrink={0} marginBottom={isFollowedBySameList ? 0 : 1}>
            <Box flexDirection="row">
              <Box width={gutterColumns} flexShrink={0}>
                <Box display="none" hover={{ display: 'flex' }} flexDirection="row" columnGap={1}>
                  <Button
                    key={`${ASK_BUTTON_KEY_PREFIX}overview-${blockIndex}`}
                    plain
                    label="[+]"
                    onPress={() => input.actions.openQuestion(anchorKey)}
                  />
                  {sectionText !== undefined && (
                    <Button key={`read-overview-${blockIndex}`} plain label="▶" onPress={() => input.actions.readAloud(sectionText)} />
                  )}
                </Box>
              </Box>
              <Box flexGrow={1} flexShrink={1} flexDirection="column" paddingLeft={indentation}>
                {renderMarkdownWithImages(ui, `overview-block-${blockIndex}`, text, input.actions)}
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
