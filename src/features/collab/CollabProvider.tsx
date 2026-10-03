import { createContext, useContext, useEffect, useMemo, useRef, type ReactNode } from 'react'
import { useAppDispatch, useAppSelector } from '../../app/hooks'
import {
  commitSynced,
  discardPending,
  hydrate,
  queueLocal,
  refreshSynced,
  setPeerInfo,
  setRecovered,
  setResumedPending,
} from '../developmentSlice'
import { getIdentity, saveIdentity, writeHeartbeat, type Identity } from './identity'
import { collabEngine } from './engine'
import { collabStorage } from './storage'
import { materialize, type CollabView } from './materialize'
import type { CollabChange, SessionCheckpoint } from './types'
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  Typography,
} from '@mui/material'
import RestartAltIcon from '@mui/icons-material/RestartAlt'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline'

const HEARTBEAT_MS = 2000
const PEER_STALE_MS = 8000

type CollabContextValue = {
  identity: Identity
  view: CollabView
  /** 本窗口未并入共享日志的全部提交 */
  pending: CollabChange[]
  pendingForSample: (sampleId: string) => CollabChange[]
  /** 产生一条本地提交（立即上屏，等待同步） */
  queue: (change: CollabChange) => void
  /** 把待并入提交同步给所有窗口；重复同步幂等，只生效一次 */
  syncNow: (changes?: CollabChange[]) => void
  /** 关键操作（锁定 / 解锁 / 另存修订）直接追加进共享日志，避免两步之间崩溃丢失 */
  appendNow: (changes: CollabChange[]) => void
  updateAuthor: (author: string) => void
}

const CollabContext = createContext<CollabContextValue | null>(null)

const countPeers = (selfId: string) => {
  const now = Date.now()
  let count = 0
  for (const id of collabStorage.allClientIds()) {
    const hb = collabStorage.readHeartbeat(id)
    if (hb && now - hb.at < PEER_STALE_MS) count += 1
  }
  if (count === 0 && collabStorage.readHeartbeat(selfId)) count = 1
  return Math.max(1, count)
}

const summarizeCheckpoint = (cp: SessionCheckpoint) => {
  const annotations = cp.pending.filter((item) => item.type === 'annotation-add').length
  const proposals = cp.pending.filter((item) => item.type === 'proposal-add').length
  const drafts = cp.pending.filter((item) => item.type === 'draft-save').length
  const decisions = cp.pending.filter((item) => item.type === 'proposal-decide').length
  return { annotations, proposals, drafts, decisions, editors: Object.values(cp.editors).filter((v) => v.trim()).length }
}

export function CollabProvider({ children }: { children: ReactNode }) {
  const dispatch = useAppDispatch()
  const state = useAppSelector((root) => root.development)

  const bootRef = useRef(false)
  const bootAtRef = useRef(0)
  const identityRef = useRef<Identity | null>(null)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // 始终让 ref 指向最新身份，供定时器 / 关闭回调读取
  useEffect(() => {
    identityRef.current = state.identity
  }, [state.identity])

  // ---- 启动（仅一次，幂等）：迁移旧数据 → 身份 → 扫描崩溃会话 → 归并日志 → 注水 ----
  useEffect(() => {
    if (bootRef.current) return
    bootRef.current = true

    collabStorage.migrateLegacyIfNeeded()
    const identity = getIdentity()
    identityRef.current = identity
    const bootAt = Date.now()
    bootAtRef.current = bootAt

    // 同标签页刷新 / 重开：先看自己的检查点
    const ownCp = collabStorage.readCheckpoint(identity.clientId)
    let initialPending: CollabChange[] = []
    let initialEditors: Record<string, string> = {}
    if (ownCp && !ownCp.cleanExit) {
      dispatch(setRecovered({ ...ownCp, fromWindow: ownCp.windowLabel }))
      initialPending = ownCp.pending
      initialEditors = { ...ownCp.editors }
    } else if (ownCp) {
      // 正常关闭：静默恢复未同步改动一次，随后清掉检查点避免重复并入
      initialPending = ownCp.pending
      initialEditors = { ...ownCp.editors }
      if (initialPending.length) {
        dispatch(setResumedPending({ count: initialPending.length, fromWindow: ownCp.windowLabel }))
      }
      collabEngine.removeCheckpoint(identity)
    }

    // 其他窗口遗留的检查点：崩溃的稍后弹窗确认，正常关闭的静默并入
    const scan = collabEngine.scanSessions(identity.clientId)
    for (const session of scan.closed) {
      initialPending = [...initialPending, ...session.cp.pending]
      initialEditors = { ...initialEditors, ...session.cp.editors }
      collabEngine.clearSession(session.clientId)
    }
    if (scan.crashed.length) {
      dispatch(setRecovered({ ...scan.crashed[0].cp, fromWindow: scan.crashed[0].cp.windowLabel }))
    }

    dispatch(
      hydrate({
        identity,
        bootAt,
        syncedChanges: collabEngine.collectAll(),
        pending: initialPending,
        editors: initialEditors,
      }),
    )
    writeHeartbeat(identity, bootAt)
    dispatch(setPeerInfo({ peerCount: countPeers(identity.clientId) }))
  }, [dispatch])

  // ---- 心跳定时器：独立 effect，StrictMode 卸载重建也能恢复 ----
  useEffect(() => {
    const tick = () => {
      const identity = identityRef.current
      if (!identity) return
      writeHeartbeat(identity, bootAtRef.current || Date.now())
      dispatch(setPeerInfo({ peerCount: countPeers(identity.clientId) }))
    }
    tick()
    const heartbeat = setInterval(tick, HEARTBEAT_MS)
    return () => clearInterval(heartbeat)
  }, [dispatch])

  // ---- 跨窗口：其他窗口写日志 / 心跳时重新归并 ----
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (!event.key) return
      if (event.key.startsWith('garment-log-')) {
        dispatch(refreshSynced({ changes: collabEngine.collectAll(), at: Date.now() }))
      } else if (event.key.startsWith('garment-hb-')) {
        if (identityRef.current) dispatch(setPeerInfo({ peerCount: countPeers(identityRef.current.clientId) }))
      }
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [dispatch])

  // ---- 最近完整草稿检查点：本地提交 / 输入变化后防抖落盘 ----
  useEffect(() => {
    if (!state.identity) return
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      collabEngine.writeCheckpoint(state.identity!, {
        pending: state.pending,
        editors: state.editors,
        cleanExit: false,
      })
    }, 400)
  }, [state.pending, state.editors, state.identity])

  // ---- 正常关闭：标记 cleanExit，并令心跳立即失活，窗口标签可被重开重新认领 ----
  useEffect(() => {
    const flush = () => {
      const identity = identityRef.current
      if (identity) {
        collabEngine.writeCheckpoint(identity, {
          pending: state.pending,
          editors: state.editors,
          cleanExit: true,
        })
        writeHeartbeat(identity, state.bootAt || Date.now())
        collabStorage.removeHeartbeat(identity.clientId)
      }
    }
    window.addEventListener('pagehide', flush)
    return () => window.removeEventListener('pagehide', flush)
  }, [state.pending, state.editors, state.bootAt])

  // ---- 视图 = 已同步提交 ∪ 本窗口待并入提交（按 id 幂等归并） ----
  const view = useMemo<CollabView>(
    () => materialize([...state.syncedChanges, ...state.pending]),
    // version 驱动其他窗口写入后的重算
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state.syncedChanges, state.pending, state.version],
  )

  const value = useMemo<CollabContextValue | null>(() => {
    if (!state.identity) return null
    const identity = state.identity
    return {
      identity,
      view,
      pending: state.pending,
      pendingForSample: (sampleId) => state.pending.filter((item) => item.sampleId === sampleId),
      queue: (change) => dispatch(queueLocal(change)),
      syncNow: (changes) => {
        const target = changes ?? state.pending
        if (!target.length) return
        const all = collabEngine.syncPending(identity, target)
        dispatch(commitSynced({ changes: all, syncedAt: Date.now() }))
      },
      appendNow: (changes) => {
        if (!changes.length) return
        // 若追加的提交同时躺在 pending 里，一并视为已并入
        const all = collabEngine.appendChanges(identity, changes)
        dispatch(commitSynced({ changes: all, syncedAt: Date.now() }))
      },
      updateAuthor: (author: string) => {
        const next = { ...identity, author }
        saveIdentity(next)
        identityRef.current = next
        dispatch({ type: 'development/setIdentity', payload: next })
      },
    }
  }, [state.identity, state.pending, view, dispatch])

  if (!value) return null
  return (
    <CollabContext.Provider value={value}>
      {children}
      <RecoveryDialog />
      <ResumedNotice />
    </CollabContext.Provider>
  )
}

function RecoveryDialog() {
  const dispatch = useAppDispatch()
  const state = useAppSelector((root) => root.development)
  const recovered = state.recovered

  if (!recovered || !state.identity) return null
  const identity = state.identity
  const summary = summarizeCheckpoint(recovered)
  const time = new Date(recovered.savedAt).toLocaleString('zh-CN', { hour12: false })

  const restore = () => {
    // 已在日志中的提交按 id 去重，绝不重复生效
    const known = new Set(collabEngine.collectAll().map((item) => item.id))
    const fresh = recovered.pending.filter((item) => !known.has(item.id))
    dispatch(hydrate({
      identity,
      bootAt: state.bootAt,
      syncedChanges: collabEngine.collectAll(),
      pending: fresh,
      editors: { ...state.editors, ...recovered.editors },
    }))
    if (recovered.clientId !== identity.clientId) collabEngine.clearSession(recovered.clientId)
    else collabEngine.removeCheckpoint(identity)
    dispatch(setRecovered(null))
  }

  const discard = () => {
    if (recovered.clientId !== identity.clientId) collabEngine.clearSession(recovered.clientId)
    else collabEngine.removeCheckpoint(identity)
    dispatch(discardPending(recovered.pending.map((item) => item.id)))
    dispatch(setRecovered(null))
  }

  return (
    <Dialog open fullWidth maxWidth="sm">
      <DialogTitle>
        <Stack direction="row" spacing={1} alignItems="center">
          <RestartAltIcon color="warning" />
          <span>恢复 {recovered.fromWindow} 崩溃前的草稿？</span>
        </Stack>
      </DialogTitle>
      <DialogContent>
        <Typography color="text.secondary" fontSize={13} mb={1.5}>
          该窗口在 {time} 异常退出，已自动保存最近完整草稿，其中包含尚未同步给其他窗口的本地改动：
        </Typography>
        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
          {summary.annotations > 0 && <Chip size="small" label={`批注 ${summary.annotations}`} />}
          {summary.proposals > 0 && <Chip size="small" label={`替代方案 ${summary.proposals}`} />}
          {summary.drafts > 0 && <Chip size="small" label={`评审草稿 ${summary.drafts}`} />}
          {summary.decisions > 0 && <Chip size="small" label={`采纳决定 ${summary.decisions}`} />}
          {summary.editors > 0 && <Chip size="small" label={`输入中文本 ${summary.editors}`} />}
        </Stack>
        <Alert severity="info" sx={{ mt: 1.5 }}>恢复后改动仍标记为原窗口来源，确认无误再点「同步」才会并入共享记录。</Alert>
      </DialogContent>
      <DialogActions>
        <Button color="inherit" startIcon={<DeleteOutlineIcon />} onClick={discard}>放弃这些本地改动</Button>
        <Button variant="contained" startIcon={<RestartAltIcon />} onClick={restore}>恢复最近完整草稿</Button>
      </DialogActions>
    </Dialog>
  )
}

function ResumedNotice() {
  const dispatch = useAppDispatch()
  const resumed = useAppSelector((root) => root.development.resumedPending)
  if (!resumed) return null
  return (
    <Box sx={{ position: 'fixed', right: 16, bottom: 16, zIndex: 1400, maxWidth: 320 }}>
      <Alert severity="info" onClose={() => dispatch(setResumedPending(null))}>
        {resumed.fromWindow} 关闭前有 {resumed.count} 项未同步改动，已恢复到本地待并入列表，同步后才会共享。
      </Alert>
    </Box>
  )
}

export function useCollab(): CollabContextValue {
  const ctx = useContext(CollabContext)
  if (!ctx) throw new Error('useCollab 必须在 CollabProvider 内使用')
  return ctx
}
