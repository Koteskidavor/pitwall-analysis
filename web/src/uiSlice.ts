import { createSlice, PayloadAction } from '@reduxjs/toolkit'
import { RootState } from './store'

export interface UiState {
  selectedSessionId: string | null
  selectedDriverId: string | null
}

const initialState: UiState = {
  selectedSessionId: null,
  selectedDriverId: null,
}

export const uiSlice = createSlice({
  name: 'ui',
  initialState,
  reducers: {
    setSelectedSessionId: (state, action: PayloadAction<string | null>) => {
      state.selectedSessionId = action.payload
    },
    // Driver selection is durable UI state (shared by the track map, leaderboard
    // and strategy panels), so it belongs in Redux. The playhead does not.
    selectDriver: (state, action: PayloadAction<string | null>) => {
      state.selectedDriverId = action.payload
    },
  },
})

export const { setSelectedSessionId, selectDriver } = uiSlice.actions
export const uiReducer = uiSlice.reducer

// Selectors
export const selectSelectedSessionId = (state: RootState) => state.ui.selectedSessionId
export const selectSelectedDriverId = (state: RootState) => state.ui.selectedDriverId