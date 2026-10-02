import test from "node:test"
import assert from "node:assert/strict"
import type { MouseEvent } from "@opentui/core"
import { clickAction } from "../src/click.js"

function event(button = 0, isDragging = false) {
  const state = { prevented: false, stopped: false }
  return { state, value: { button, isDragging, preventDefault() { state.prevented = true }, stopPropagation() { state.stopped = true } } as unknown as MouseEvent }
}
test("click activates once on left release, not on press or hold", () => {
  let clicks = 0
  const control = clickAction(() => clicks++)
  const press = event()
  control.onMouseDown(press.value)
  assert.equal(clicks, 0)
  assert.deepEqual(press.state, { prevented: true, stopped: true })
  control.onMouseUp(event().value)
  control.onMouseUp(event().value)
  assert.equal(clicks, 1)
})
test("right clicks and orphan releases do not activate", () => {
  let clicks = 0
  const control = clickAction(() => clicks++)
  control.onMouseUp(event().value)
  control.onMouseDown(event(2).value)
  control.onMouseUp(event(2).value)
  assert.equal(clicks, 0)
})
test("drag or leaving the control cancels activation", () => {
  let clicks = 0
  const control = clickAction(() => clicks++)
  control.onMouseDown(event().value); control.onMouseDrag(); control.onMouseUp(event().value)
  control.onMouseDown(event().value); control.onMouseOut(); control.onMouseUp(event().value)
  control.onMouseDown(event().value); control.onMouseUp(event(0, true).value)
  assert.equal(clicks, 0)
})
