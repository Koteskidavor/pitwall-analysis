import { createSlice, PayloadAction } from '@reduxjs/toolkit'
import { RootState } from './store'

export interface UiState {
  selectedSessionId: string | null
}

const initialState: UiState = {
  selectedSessionId: null,
}

export const uiSlice = createSlice({
  name: 'ui',
  initialState,
  reducers: {
    setSelectedSessionId: (state, action: PayloadAction<string | null>) => {
      state.selectedSessionId = action.payload
    },
  },
})

export const { setSelectedSessionId } = uiSlice.actions
export const uiReducer = uiSlice.reducer

// Selectors
export const selectSelectedSessionId = (state: RootState) => state.ui.selectedSessionId