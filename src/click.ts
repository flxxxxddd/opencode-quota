import type { MouseEvent } from "@opentui/core"

/** Activate on release, never on press/drag. Prevent text-selection interception. */
export function clickAction(action: () => void) {
  let pressed = false
  return {
    onMouseDown(event: MouseEvent) {
      if (event.button !== 0) return
      pressed = true
      event.preventDefault()
      event.stopPropagation()
    },
    onMouseUp(event: MouseEvent) {
      if (event.button !== 0) return
      event.preventDefault()
      event.stopPropagation()
      const activate = pressed && !event.isDragging
      pressed = false
      if (activate) action()
    },
    onMouseDrag() { pressed = false },
    onMouseOut() { pressed = false },
  }
}
