import type { CommitGraphLine } from '../../types'
import type { Theme } from './theme'

// The Desktop lays the pane out in cells of about this many CSS pixels across.
export const DESKTOP_PIXELS_PER_COLUMN = 8
// About the height of a Desktop row: a slightly shorter row clips the drawing around its middle, and the lanes still
// meet from row to row.
export const GRAPH_ROW_PIXELS = 20
export const HEADER_TILES_PIXELS = 38

const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif"
const TILE_GAP_PIXELS = 6
const TILE_COLUMNS = 12
const VIEWED_TILE_COLUMNS = 15
// A lane moves to its neighbor within this distance of the row's middle and runs straight above and below it, so a
// clipped row still meets the next one on the lane's own column.
const CURVE_HALF_HEIGHT_PIXELS = 5
const NODE_RADIUS_PIXELS = 3.5

export function escapeXml(text: string): string {
  return text.replace(/[&<>"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[character] ?? character)
}

function svgDocument(width: number, height: number, body: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${body}</svg>`
}

export type HeaderTile =
  | { kind: 'count'; label: string; value: string }
  | { kind: 'lines'; label: string; addedLines: number; removedLines: number }
  | { kind: 'progress'; label: string; done: number; total: number }

export const LINES_TO_VIEW_TILE_LABEL = 'To view'

export function tileColumnsOf(tile: HeaderTile): number {
  return tile.kind === 'progress' ? VIEWED_TILE_COLUMNS : TILE_COLUMNS
}

export function headerTilesWidthOf(tiles: HeaderTile[]): number {
  return tiles.reduce((width, tile) => width + tileColumnsOf(tile) * DESKTOP_PIXELS_PER_COLUMN, 0) + TILE_GAP_PIXELS * Math.max(0, tiles.length - 1)
}

export function headerTilesSvg(theme: Theme, tiles: HeaderTile[]): string {
  let left = 0
  const drawnTiles = tiles.map(tile => {
    const width = tileColumnsOf(tile) * DESKTOP_PIXELS_PER_COLUMN
    const drawnTile = tileSvg(theme, tile, left, width)
    left += width + TILE_GAP_PIXELS
    return drawnTile
  })

  return svgDocument(headerTilesWidthOf(tiles), HEADER_TILES_PIXELS, drawnTiles.join(''))
}

function tileSvg(theme: Theme, tile: HeaderTile, left: number, width: number): string {
  const textLeft = left + 9
  const frame = `<rect x="${left + 0.5}" y="0.5" width="${width - 1}" height="${HEADER_TILES_PIXELS - 1}" rx="7" fill="${theme.tileFill}" stroke="${theme.border}"/>`
  const label = `<text x="${textLeft}" y="13" font-family="${FONT}" font-size="10" fill="${theme.muted}">${escapeXml(tile.label)}</text>`
  const valueAttributes = `x="${textLeft}" y="29" font-family="${FONT}" font-size="13" font-weight="600" font-variant-numeric="tabular-nums"`

  if (tile.kind === 'count') {
    return `${frame}${label}<text ${valueAttributes} fill="${theme.heading}">${escapeXml(tile.value)}</text>`
  }
  if (tile.kind === 'lines') {
    return `${frame}${label}<text ${valueAttributes}><tspan fill="${theme.added}">+${tile.addedLines}</tspan><tspan fill="${theme.removed}"> −${tile.removedLines}</tspan></text>`
  }

  const isComplete = tile.total > 0 && tile.done >= tile.total
  const barLeft = textLeft + 38
  const barWidth = Math.max(10, left + width - 9 - barLeft)
  const filledWidth = tile.total > 0 ? Math.round((barWidth * Math.min(tile.done, tile.total)) / tile.total) : 0
  const barColor = isComplete ? theme.added : theme.accent

  return (
    `${frame}${label}<text ${valueAttributes} fill="${isComplete ? theme.added : theme.heading}">${tile.done}/${tile.total}</text>` +
    `<rect x="${barLeft}" y="22" width="${barWidth}" height="5" rx="2.5" fill="${theme.border}"/>` +
    (filledWidth > 0 ? `<rect x="${barLeft}" y="22" width="${filledWidth}" height="5" rx="2.5" fill="${barColor}"/>` : '')
  )
}

const EIGHTHS = ['', '▏', '▎', '▍', '▌', '▋', '▊', '▉']

// The terminal's progress bar: whole cells, then one cell filled by eighths, so it moves smoothly in a few cells.
export function progressBarCells(done: number, total: number, cells: number): { filled: string; rest: string } {
  const filledEighths = total > 0 ? Math.round((cells * 8 * Math.min(done, total)) / total) : 0
  const wholeCells = Math.floor(filledEighths / 8)
  const partialCell = EIGHTHS[filledEighths % 8] ?? ''
  const filled = '█'.repeat(wholeCells) + partialCell

  return { filled, rest: ' '.repeat(cells - wholeCells - (partialCell ? 1 : 0)) }
}

// git log --graph draws its lanes with characters two columns apart: a commit `*` (`o` for the base), a lane going
// on `|`, a lane moving one column over `/` or `\`, a lane joining across `_` or `-`. Each row is drawn from its own
// characters and those of the rows around it, which say whether a commit's lane comes from above or goes on below.
export function commitGraphRowSvg(
  theme: Theme,
  graphLines: readonly CommitGraphLine[],
  lineIndex: number,
  graphColumns: number,
  isSelected: boolean,
): string {
  const graph = graphLines[lineIndex]?.graph ?? ''
  const above = graphLines[lineIndex - 1]?.graph ?? ''
  const below = graphLines[lineIndex + 1]?.graph ?? ''
  const height = GRAPH_ROW_PIXELS
  const middle = height / 2
  const centerOf = (column: number) => (column + 0.5) * DESKTOP_PIXELS_PER_COLUMN
  const laneColorOf = (column: number) => laneColor(theme, column)
  const stroke = (color: string) => `fill="none" stroke="${color}" stroke-width="1.6" stroke-linecap="round"`
  const lanes: string[] = []
  const nodes: string[] = []

  ;[...graph].forEach((character, column) => {
    const center = centerOf(column)
    if (character === '|') {
      lanes.push(`<path d="M${center} 0V${height}" ${stroke(laneColorOf(column))}/>`)
    } else if (character === '/' || character === '\\') {
      const topCenter = centerOf(character === '/' ? column + 1 : column - 1)
      const bottomCenter = centerOf(character === '/' ? column - 1 : column + 1)
      const curveTop = middle - CURVE_HALF_HEIGHT_PIXELS
      const curveBottom = middle + CURVE_HALF_HEIGHT_PIXELS
      lanes.push(
        `<path d="M${bottomCenter} ${height}V${curveBottom}C${bottomCenter} ${middle} ${topCenter} ${middle} ${topCenter} ${curveTop}V0" ${stroke(laneColorOf(column + 1))}/>`,
      )
    } else if (character === '_' || character === '-' || character === '.') {
      const halfColumn = DESKTOP_PIXELS_PER_COLUMN / 2
      lanes.push(`<path d="M${center - halfColumn} ${middle}H${center + halfColumn}" ${stroke(laneColorOf(column))}/>`)
    } else if (character === '*' || character === 'o') {
      const color = isSelected ? theme.accent : laneColorOf(column)
      if (reachesDownTo(above, column)) {
        lanes.push(`<path d="M${center} 0V${middle}" ${stroke(laneColorOf(column))}/>`)
      }
      if (reachesUpTo(below, column)) {
        lanes.push(`<path d="M${center} ${middle}V${height}" ${stroke(laneColorOf(column))}/>`)
      }
      if (character === 'o') {
        nodes.push(`<circle cx="${center}" cy="${middle}" r="${NODE_RADIUS_PIXELS}" fill="${theme.tileFill}" stroke="${theme.muted}" stroke-width="1.4"/>`)
      } else {
        if (isSelected) {
          nodes.push(`<circle cx="${center}" cy="${middle}" r="${NODE_RADIUS_PIXELS + 2.5}" fill="none" stroke="${color}" stroke-width="1.2" opacity="0.6"/>`)
        }
        nodes.push(`<circle cx="${center}" cy="${middle}" r="${NODE_RADIUS_PIXELS}" fill="${color}"/>`)
      }
    }
  })

  return svgDocument(graphColumns * DESKTOP_PIXELS_PER_COLUMN, height, lanes.join('') + nodes.join(''))
}

// The row above ends on this column: a lane or a commit on it, or a lane moving onto it.
function reachesDownTo(graph: string, column: number): boolean {
  return ['|', '*', 'o'].includes(graph[column] ?? '') || graph[column - 1] === '\\' || graph[column + 1] === '/'
}

// The row below starts from this column.
function reachesUpTo(graph: string, column: number): boolean {
  return ['|', '*', 'o'].includes(graph[column] ?? '') || graph[column + 1] === '\\' || graph[column - 1] === '/'
}

// Lanes sit two columns apart; each one keeps its color from row to row.
function laneColor(theme: Theme, column: number): string {
  const palette = [theme.hunk, theme.directory, theme.gitHubThread, theme.added, theme.commitSha, theme.removed]
  return palette[Math.floor(column / 2) % palette.length] ?? theme.hunk
}
