import { createSlice, type PayloadAction } from '@reduxjs/toolkit'
import type { CollabChange, SessionCheckpoint } from './collab/types'
import type { Identity } from './collab/identity'
import type { Round } from '../api/types'

type DevelopmentState = {
  selectedId: string
  roundA: Round
  roundB: Round
  activeAnnotation: string | null

  /** 当前窗口身份（提交人 / 窗口标签） */
  identity: Identity | null
  bootAt: number

  /** 已同步进共享日志的全部提交（按时间排序、按 id 幂等） */
  syncedChanges: CollabChange[]
  /** 本窗口已产生、尚未并入共享日志的提交（锁定前必须让用户决定） */
  pending: CollabChange[]
  /** 评审草稿输入框未保存文本，按样衣 id 索引（崩溃恢复用） */
  editors: Record<string, string>

  /** 启动时发现的异常退出检查点（待用户确认恢复 / 放弃） */
  recovered: (SessionCheckpoint & { fromWindow: string }) | null
  /** 正常关闭但仍有未并入改动时的静默恢复记录 */
  resumedPending: { count: number; fromWindow: string } | null

  /** 在线协作窗口数与最近一次同步时间（含其他窗口的同步） */
  peerCount: number
  lastSyncAt: number | null
  /** 状态版本号，外部 storage 事件触发自增以驱动派生视图重算 */
  version: number
}

const initialState: DevelopmentState = {
  selectedId: 'SMP-26018',
  roundA: '第二轮',
  roundB: '第三轮',
  activeAnnotation: null,
  identity: null,
  bootAt: 0,
  syncedChanges: [],
  pending: [],
  editors: {},
  recovered: null,
  resumedPending: null,
  peerCount: 1,
  lastSyncAt: null,
  version: 0,
}

const slice = createSlice({
  name: 'development',
  initialState,
  reducers: {
    hydrate(
      state,
      action: PayloadAction<{
        identity: Identity
        bootAt: number
        syncedChanges: CollabChange[]
        pending: CollabChange[]
        editors: Record<string, string>
      }>,
    ) {
      state.identity = action.payload.identity
      state.bootAt = action.payload.bootAt
      state.syncedChanges = action.payload.syncedChanges
      state.pending = action.payload.pending
      state.editors = action.payload.editors
    },
    selectSample(state, action: PayloadAction<string>) {
      state.selectedId = action.payload
      state.activeAnnotation = null
    },
    setRounds(state, action: PayloadAction<{ a?: Round; b?: Round }>) {
      if (action.payload.a) state.roundA = action.payload.a
      if (action.payload.b) state.roundB = action.payload.b
    },
    toggleAnnotation(state, action: PayloadAction<string | null>) {
      state.activeAnnotation = action.payload
    },
    setIdentity(state, action: PayloadAction<Identity>) {
      state.identity = action.payload
    },

    /** 本地新增提交：先进入 pending，视图立即体现，但尚未并入共享日志 */
    queueLocal(state, action: PayloadAction<CollabChange>) {
      if (state.syncedChanges.some((item) => item.id === action.payload.id)) return
      if (state.pending.some((item) => item.id === action.payload.id)) return
      state.pending.push(action.payload)
    },
    /** 一批提交已写入共享日志（可能含别的窗口）：从 pending 移除并刷新合并结果 */
    commitSynced(state, action: PayloadAction<{ changes: CollabChange[]; syncedAt: number }>) {
      const committed = new Set(action.payload.changes.map((item) => item.id))
      state.pending = state.pending.filter((item) => !committed.has(item.id))
      state.syncedChanges = action.payload.changes
      state.lastSyncAt = action.payload.syncedAt
    },
    /** 其他窗口写入 / 任何 storage 变化：重新收集合并 */
    refreshSynced(state, action: PayloadAction<{ changes: CollabChange[]; at: number }>) {
      state.syncedChanges = action.payload.changes
      state.lastSyncAt = action.payload.at
      state.version += 1
    },
    /** 放弃本地未并入提交 */
    discardPending(state, action: PayloadAction<string[]>) {
      const ids = new Set(action.payload)
      state.pending = state.pending.filter((item) => !ids.has(item.id))
    },
    /** 未并入改动已另存为锁定修订：从 pending 移除（修订提交已写日志） */
    pendingSavedAsRevision(state, action: PayloadAction<string[]>) {
      const ids = new Set(action.payload)
      state.pending = state.pending.filter((item) => !ids.has(item.id))
    },
    setEditor(state, action: PayloadAction<{ sampleId: string; value: string }>) {
      state.editors[action.payload.sampleId] = action.payload.value
    },
    setRecovered(state, action: PayloadAction<(SessionCheckpoint & { fromWindow: string }) | null>) {
      state.recovered = action.payload
    },
    setResumedPending(state, action: PayloadAction<{ count: number; fromWindow: string } | null>) {
      state.resumedPending = action.payload
    },
    setPeerInfo(state, action: PayloadAction<{ peerCount: number }>) {
      state.peerCount = action.payload.peerCount
    },
  },
})

export const {
  selectSample,
  setRounds,
  toggleAnnotation,
  setIdentity,
  hydrate,
  queueLocal,
  commitSynced,
  refreshSynced,
  discardPending,
  pendingSavedAsRevision,
  setEditor,
  setRecovered,
  setResumedPending,
  setPeerInfo,
} = slice.actions
export const developmentReducer = slice.reducer
