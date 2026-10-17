import { useEffect } from 'react'
import { useAppDispatch, useAppSelector } from './store'
import {
  DEFAULT_SEEK_MS,
  rewind,
  seekBy,
  selectIsPlaying,
  setPlaying,
} from './playbackSlice'

const INTERACTIVE_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON', 'A'])

function isInteractiveTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return INTERACTIVE_TAGS.has(target.tagName) || target.isContentEditable
}

// Global playback shortcuts: Space toggles play/pause, arrows scrub by 5s.
export function usePlaybackKeyboard(): void {
  const dispatch = useAppDispatch()
  const playing = useAppSelector(selectIsPlaying)

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || isInteractiveTarget(event.target)) return

      switch (event.key) {
        case ' ':
        case 'Spacebar':
          event.preventDefault()
          dispatch(setPlaying(!playing))
          break
        case 'ArrowLeft':
          event.preventDefault()
          dispatch(rewind(DEFAULT_SEEK_MS))
          break
        case 'ArrowRight':
          event.preventDefault()
          dispatch(seekBy(DEFAULT_SEEK_MS))
          break
        default:
          break
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [dispatch, playing])
}
