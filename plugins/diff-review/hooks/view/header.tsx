import type { PullRequestSummary, ReviewView } from '../../types'
import { HEADER_COLUMNS_WITHOUT_TILES, VIEW_LABELS, VIEW_ORDER, VIEW_SHORTCUTS } from '../constants'
import type { ShortcutAction } from '../keymap'
import { DESKTOP_PIXELS_PER_COLUMN, HEADER_TILES_PIXELS, LINES_TO_VIEW_TILE_LABEL, headerTilesSvg, headerTilesWidthOf, progressBarCells } from './drawings'
import type { HeaderTile } from './drawings'
import type { ExplorerActions, GitHubPage, ViewElements } from './types'

export function renderHeader(
  ui: ViewElements,
  input: {
    view: ReviewView
    location: string
    hasUncommittedChanges: boolean
    unpushedCommitCount: number
    pullRequest: PullRequestSummary | null
    viewedCount: { viewed: number; total: number }
    linesToView: { addedLines: number; removedLines: number }
    tiles: HeaderTile[]
    bodyColumns: number
    gitHubPage: GitHubPage | null
    hotkeyOf: (action: ShortcutAction) => string | undefined
    actions: ExplorerActions
  },
) {
  const { Box, Svg, Text } = ui
  const { gitHubPage, pullRequest, viewedCount } = input
  const tiles = tilesThatFit(input.tiles, input.bodyColumns, Svg ? desktopTilesColumns : terminalTilesColumns)

  // The tabs' row is as tall as the tiles: the layout counts three rows for it, one for the location, one for the pull
  // request's line and one left empty under the header.
  return (
    <Box flexDirection="column" paddingLeft={1} paddingBottom={1}>
      <Box flexDirection="row" alignItems="center" height={3}>
        {VIEW_ORDER.map(view => {
          const isActive = view === input.view
          return renderPill(ui, {
            key: `view-${view}`,
            hotkey: input.hotkeyOf(VIEW_SHORTCUTS[view]),
            text: viewTabTextOf(view, input.unpushedCommitCount),
            isActive,
            isDim: !isActive,
            isEmpty: view === 'uncommitted' && !input.hasUncommittedChanges,
            onPress: () => input.actions.switchView(view),
            marginRight: 1,
          })
        })}
        <Box flexGrow={1} />
        {Svg && tiles.length > 0 && (
          <Box flexShrink={0} height={3} marginLeft={1} flexDirection="column" justifyContent="center" overflow="hidden">
            <Svg
              source={headerTilesSvg(ui.theme, tiles)}
              alt={tiles.map(describeTile).join(', ')}
              width={headerTilesWidthOf(tiles)}
              height={HEADER_TILES_PIXELS}
            />
          </Box>
        )}
        {!Svg && tiles.map(tile => renderTerminalTile(ui, tile))}
        {gitHubPage &&
          renderPill(ui, {
            key: 'open-on-github',
            hotkey: input.hotkeyOf('openOnGitHub'),
            text: `${gitHubPage.description} on GitHub ↗`,
            onPress: () => input.actions.openOnGitHub(gitHubPage),
            marginLeft: 1,
            // The pull request's own page already has its link under the tabs, PR #n; the key still opens it.
            isHidden: gitHubPage.url === pullRequest?.url,
          })}
        {renderPill(ui, { key: 'help', hotkey: input.hotkeyOf('toggleHelp'), text: 'help', onPress: () => input.actions.toggleHelp(), marginLeft: 1 })}
        {renderPill(ui, { key: 'refresh', text: 'refresh', onPress: () => input.actions.refresh(), marginLeft: 1 })}
        {renderPill(ui, { key: 'close', text: 'close', onPress: () => input.actions.close(), marginLeft: 1 })}
      </Box>
      <Box height={1} overflow="hidden" marginLeft={2}>
        <Text color={ui.theme.muted} wrap="truncate-start">
          {input.location}
        </Text>
      </Box>
      {pullRequest && renderPullRequestLine(ui, pullRequest, viewedCount, input.linesToView, {
          isViewedTileShown: tiles.some(tile => tile.kind === 'progress'),
          isLinesToViewTileShown: tiles.some(tile => tile.kind === 'lines' && tile.label === LINES_TO_VIEW_TILE_LABEL),
        })}
    </Box>
  )
}

function renderPullRequestLine(
  ui: ViewElements,
  pullRequest: PullRequestSummary,
  viewedCount: { viewed: number; total: number },
  linesToView: { addedLines: number; removedLines: number },
  shownTiles: { isViewedTileShown: boolean; isLinesToViewTileShown: boolean },
) {
  const { Box, Link, Text } = ui

  return (
    <Box flexDirection="row" height={1} overflow="hidden" marginLeft={2}>
      <Text color={ui.theme.accent} bold>
        <Link href={pullRequest.url}>PR #{pullRequest.number} ↗</Link>
      </Text>
      {!shownTiles.isViewedTileShown && (
        <Text color={viewedCount.viewed === viewedCount.total ? ui.theme.added : ui.theme.muted}>
          {'  ·  '}
          {viewedCount.viewed}/{viewedCount.total} files viewed on GitHub
        </Text>
      )}
      {!shownTiles.isLinesToViewTileShown && viewedCount.viewed < viewedCount.total && (
        <Text color={ui.theme.muted}>
          {shownTiles.isViewedTileShown ? '  ·  ' : ', '}
          <Text color={ui.theme.added}>+{linesToView.addedLines}</Text> <Text color={ui.theme.removed}>−{linesToView.removedLines}</Text>
          {' to view'}
        </Text>
      )}
    </Box>
  )
}

type Pill = {
  key: string
  hotkey?: string
  text: string
  isActive?: boolean
  isDim?: boolean
  // Drawn without its fill: the view holds nothing.
  isEmpty?: boolean
  isHidden?: boolean
  onPress: () => Promise<void>
  marginLeft?: number
  marginRight?: number
}

function viewTabTextOf(view: ReviewView, unpushedCommitCount: number): string {
  switch (view) {
    case 'commits':
      return unpushedCommitCount > 0 ? `${VIEW_LABELS[view]} ↑${unpushedCommitCount}` : VIEW_LABELS[view]
    case 'uncommitted':
    case 'pr':
      return VIEW_LABELS[view]
  }
}

// The terminal takes a Button's click on its label alone: the pill is that label on a fill, with no border or padding
// around it, so a click anywhere on it presses. A plain Button draws its hotkey before the label (`1: `).
function renderPill(ui: ViewElements, pill: Pill) {
  const { Box, Button } = ui

  return (
    <Box
      key={`${pill.key}-box`}
      display={pill.isHidden ? 'none' : 'flex'}
      flexShrink={0}
      height={1}
      backgroundColor={pill.isActive ? ui.theme.accentBorder : pill.isEmpty ? undefined : ui.theme.border}
      marginLeft={pill.marginLeft}
      marginRight={pill.marginRight}
    >
      <Button
        key={pill.key}
        plain
        dimColor={pill.isDim}
        hotkey={pill.hotkey}
        label={pill.hotkey ? `${pill.text} ` : ` ${pill.text} `}
        onPress={pill.onPress}
      />
    </Box>
  )
}

// The last tiles give way first when the header runs out of room.
function tilesThatFit(tiles: HeaderTile[], bodyColumns: number, columnsOf: (tiles: HeaderTile[]) => number): HeaderTile[] {
  const fittingTiles = [...tiles]
  while (fittingTiles.length > 0 && HEADER_COLUMNS_WITHOUT_TILES + columnsOf(fittingTiles) > bodyColumns) {
    fittingTiles.pop()
  }

  return fittingTiles
}

function desktopTilesColumns(tiles: HeaderTile[]): number {
  return Math.ceil(headerTilesWidthOf(tiles) / DESKTOP_PIXELS_PER_COLUMN)
}

const TERMINAL_PROGRESS_CELLS = 8
// A tile's frame and inner padding, and the gap before it.
const TERMINAL_TILE_CHROME_COLUMNS = 5

function terminalTilesColumns(tiles: HeaderTile[]): number {
  return tiles.reduce((columns, tile) => columns + terminalTileText(tile).length + TERMINAL_TILE_CHROME_COLUMNS, 0)
}

function terminalTileText(tile: HeaderTile): string {
  if (tile.kind === 'lines') {
    return `${tile.label} +${tile.addedLines} −${tile.removedLines}`
  }
  if (tile.kind === 'progress') {
    return `${tile.label} ${tile.done}/${tile.total} ${' '.repeat(TERMINAL_PROGRESS_CELLS)}`
  }

  return `${tile.label} ${tile.value}`
}

function renderTerminalTile(ui: ViewElements, tile: HeaderTile) {
  const { Box, Text } = ui
  const label = <Text color={ui.theme.muted}>{tile.label} </Text>
  let value
  if (tile.kind === 'lines') {
    value = (
      <Text bold>
        <Text color={ui.theme.added}>+{tile.addedLines}</Text> <Text color={ui.theme.removed}>−{tile.removedLines}</Text>
      </Text>
    )
  } else if (tile.kind === 'progress') {
    const isComplete = tile.total > 0 && tile.done >= tile.total
    const bar = progressBarCells(tile.done, tile.total, TERMINAL_PROGRESS_CELLS)
    value = (
      <Text>
        <Text bold color={isComplete ? ui.theme.added : ui.theme.heading}>
          {tile.done}/{tile.total}{' '}
        </Text>
        <Text color={isComplete ? ui.theme.added : ui.theme.accent} backgroundColor={ui.theme.border}>
          {bar.filled}
        </Text>
        <Text backgroundColor={ui.theme.border}>{bar.rest}</Text>
      </Text>
    )
  } else {
    value = (
      <Text bold color={ui.theme.heading}>
        {tile.value}
      </Text>
    )
  }

  return (
    <Box
      key={`tile-${tile.label}`}
      flexShrink={0}
      marginLeft={1}
      paddingX={1}
      borderStyle="round"
      borderColor={ui.theme.border}
      backgroundColor={ui.theme.panelBackground}
    >
      <Text>
        {label}
        {value}
      </Text>
    </Box>
  )
}

function describeTile(tile: HeaderTile): string {
  if (tile.kind === 'lines') {
    return `${tile.label} ${tile.addedLines} added, ${tile.removedLines} removed`
  }
  if (tile.kind === 'progress') {
    return `${tile.label} ${tile.done} of ${tile.total}`
  }

  return `${tile.label} ${tile.value}`
}
