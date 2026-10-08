import type { ClientModule } from 'claude-code'

type DividerProps = { rows: number; color: string; draggingColor: string }

type DividerState = { isDragging: boolean }

// The divider between the file list and the diff: pressed and dragged, it reports how many columns it moved, from
// where the press started, once the button comes up. The pane applies the new width then, not during the drag,
// since moving the divider while dragging would shift the cells its moves are counted in.
const Divider: ClientModule<DividerProps, DividerState> = (props, surface) => {
  const { Box, Text } = surface.elements
  if (surface.state === undefined) {
    surface.onPointer(event => {
      if (event.type === 'down' && event.button === 'left') {
        surface.setState({ isDragging: true })
        surface.post({ phase: 'start' })
      } else if (event.type === 'up' && surface.state?.isDragging) {
        surface.setState({ isDragging: false })
        surface.post({ phase: 'end', movedColumns: event.x })
      }
    })
    surface.setState({ isDragging: false })
  }
  const color = surface.state?.isDragging ? props.draggingColor : props.color

  return (
    <Box flexDirection="column">
      {Array.from({ length: Math.max(1, props.rows) }, () => (
        <Text color={color}>{surface.state?.isDragging ? '┃' : '│'}</Text>
      ))}
    </Box>
  )
}

export default Divider
