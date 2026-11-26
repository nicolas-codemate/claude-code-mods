import type { NavigationHistory, ViewedPlace } from '../types'
import { HISTORY_LIMIT } from './constants'

export const EMPTY_HISTORY: NavigationHistory = { places: [], index: -1 }

function withPlaceAt(places: readonly ViewedPlace[], index: number, place: ViewedPlace): ViewedPlace[] {
  return places.map((existingPlace, placeIndex) => (placeIndex === index ? place : existingPlace))
}

// A jump leaves the place shown, remembered as it was scrolled, drops what "forward" still held and lands on the new
// place. The first place ever shown has nothing to leave.
export function historyAfterJump(history: NavigationHistory, leftPlace: ViewedPlace | null, landingPlace: ViewedPlace): NavigationHistory {
  const keptPlaces = history.places.slice(0, history.index + 1)
  const placesBeforeLanding = leftPlace === null || keptPlaces.length === 0 ? keptPlaces : withPlaceAt(keptPlaces, keptPlaces.length - 1, leftPlace)
  const places = [...placesBeforeLanding, landingPlace].slice(-HISTORY_LIMIT)

  return { places, index: places.length - 1 }
}

export function canGoBack(history: NavigationHistory): boolean {
  return history.index > 0
}

export function canGoForward(history: NavigationHistory): boolean {
  return history.index >= 0 && history.index < history.places.length - 1
}

// Moving through the history remembers how the place being left was scrolled, so coming back finds it as it was.
export function historyAfterStep(
  history: NavigationHistory,
  leftPlace: ViewedPlace | null,
  step: 1 | -1,
): { history: NavigationHistory; place: ViewedPlace } | null {
  const targetIndex = history.index + step
  const targetPlace = history.places[targetIndex]
  if (targetPlace === undefined) {
    return null
  }
  const places = leftPlace === null ? history.places : withPlaceAt(history.places, history.index, leftPlace)

  return { history: { places, index: targetIndex }, place: targetPlace }
}
