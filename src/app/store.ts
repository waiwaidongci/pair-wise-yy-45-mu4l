import { configureStore } from '@reduxjs/toolkit'
import { samplingApi } from './api'
import { developmentReducer } from '../features/developmentSlice'

/**
 * 注意：不再把整个状态序列化到单一 localStorage key。
 * 旧实现两个窗口各自从旧快照启动、最后写入者整体覆盖对方；
 * 持久化与合并改由 features/collab 负责（按客户端追加日志 + 归并）。
 */
export const store = configureStore({
  reducer: {
    development: developmentReducer,
    [samplingApi.reducerPath]: samplingApi.reducer,
  },
  middleware: (getDefaultMiddleware) => getDefaultMiddleware().concat(samplingApi.middleware),
})

export type RootState = ReturnType<typeof store.getState>
export type AppDispatch = typeof store.dispatch
