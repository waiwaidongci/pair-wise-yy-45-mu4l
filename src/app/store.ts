import { configureStore } from '@reduxjs/toolkit'
import { samplingApi } from './api'
import { developmentReducer } from '../features/developmentSlice'
import { syncMiddleware } from './sync'

const persistedKey = 'garment-sampling-draft-v1'
const recoveryKey = 'garment-sampling-recovery-v1'

let persistTimer: ReturnType<typeof setTimeout> | null = null

/** 完整草稿持久化：主草稿 + 带时间戳的恢复快照，供崩溃后恢复最近完整草稿 */
function persist() {
  const state = store.getState().development
  localStorage.setItem(persistedKey, JSON.stringify(state))
  localStorage.setItem(recoveryKey, JSON.stringify({ savedAt: new Date().toISOString(), state }))
}

export const store = configureStore({
  reducer: {
    development: developmentReducer,
    [samplingApi.reducerPath]: samplingApi.reducer,
  },
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware().concat(samplingApi.middleware, syncMiddleware),
})

store.subscribe(() => {
  if (persistTimer) clearTimeout(persistTimer)
  persistTimer = setTimeout(persist, 400)
})

export type RootState = ReturnType<typeof store.getState>
export type AppDispatch = typeof store.dispatch
