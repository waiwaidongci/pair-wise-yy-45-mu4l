import type { CollabChange } from './types'
import type { Identity } from './identity'
import { collabStorage } from './storage'
import type { Annotation, DraftEntry, RevisionProposal, Round, SavedRevision } from '../../api/types'

let sequence = 0

const uid = (prefix: string) =>
  `${prefix}-${Date.now().toString(36)}-${(sequence++).toString(36)}${Math.random().toString(36).slice(2, 6)}`

const now = () => {
  const timestamp = Date.now()
  return { timestamp, createdAt: new Date(timestamp).toLocaleString('zh-CN', { hour12: false }) }
}

const base = (identity: Identity, sampleId: string) => {
  const { timestamp, createdAt } = now()
  return {
    id: uid('CH'),
    clientId: identity.clientId,
    windowLabel: identity.windowLabel,
    author: identity.author,
    timestamp,
    createdAt,
    sampleId,
  }
}

/** 各类本地编辑的提交工厂，提交一产生就带好提交人与时间 */
export const changeFactory = {
  annotationAdd(
    identity: Identity,
    sampleId: string,
    data: { x: number; y: number; part: string; content: string; round: Round },
  ): CollabChange {
    const { timestamp, createdAt } = now()
    const annotation: Annotation = {
      id: uid('AN'),
      ...data,
      author: identity.author,
      status: '待处理',
      createdAt,
      timestamp,
      sourceWindow: identity.windowLabel,
      clientId: identity.clientId,
    }
    return { ...base(identity, sampleId), type: 'annotation-add', annotation }
  },
  annotationResolve(identity: Identity, sampleId: string, annotationId: string, status: Annotation['status']): CollabChange {
    return { ...base(identity, sampleId), type: 'annotation-resolve', annotationId, status }
  },
  proposalAdd(
    identity: Identity,
    sampleId: string,
    data: { role: string; content: string; affectedPart: string },
  ): CollabChange {
    const { timestamp, createdAt } = now()
    const proposal: RevisionProposal = {
      id: uid('RV'),
      author: identity.author,
      ...data,
      status: '待决定',
      createdAt,
      timestamp,
      sourceWindow: identity.windowLabel,
      clientId: identity.clientId,
    }
    return { ...base(identity, sampleId), type: 'proposal-add', proposal }
  },
  proposalDecide(
    identity: Identity,
    sampleId: string,
    proposalId: string,
    decision: { decision: '已采纳' | '未采纳'; reason: string; decidedAt: string },
  ): CollabChange {
    return {
      ...base(identity, sampleId),
      type: 'proposal-decide',
      proposalId,
      decision: { ...decision, decidedBy: identity.author },
    }
  },
  draftSave(identity: Identity, sampleId: string, content: string): CollabChange {
    const { timestamp, createdAt } = now()
    const entry: DraftEntry = {
      id: uid('DR'),
      author: identity.author,
      sourceWindow: identity.windowLabel,
      clientId: identity.clientId,
      content,
      createdAt,
      timestamp,
    }
    return { ...base(identity, sampleId), type: 'draft-save', entry }
  },
  lock(identity: Identity, sampleId: string, round: Round, note: string): CollabChange {
    return { ...base(identity, sampleId), type: 'lock', round, note }
  },
  unlock(identity: Identity, sampleId: string): CollabChange {
    return { ...base(identity, sampleId), type: 'unlock' }
  },
  saveRevision(identity: Identity, sampleId: string, reason: string, pending: CollabChange[]): CollabChange {
    const { timestamp, createdAt } = now()
    const revision: SavedRevision = {
      id: uid('SREV'),
      author: identity.author,
      sourceWindow: identity.windowLabel,
      reason,
      createdAt,
      timestamp,
      annotations: pending.filter((c) => c.type === 'annotation-add').map((c) => (c as Extract<CollabChange, { type: 'annotation-add' }>).annotation),
      proposals: pending.filter((c) => c.type === 'proposal-add').map((c) => (c as Extract<CollabChange, { type: 'proposal-add' }>).proposal),
      drafts: pending.filter((c) => c.type === 'draft-save').map((c) => (c as Extract<CollabChange, { type: 'draft-save' }>).entry),
    }
    return { ...base(identity, sampleId), type: 'save-revision', revision }
  },
}

export const collabEngine = {
  /**
   * 把一批本地提交并入共享日志。
   * - 只追加写自己客户端的日志，绝不重写他人数据；
   * - 全局 id 去重，重复点同步 / 崩溃后重试都只生效一次；
   * - 返回去重后全部日志，由 Redux 重新归并。
   */
  syncPending(identity: Identity, pending: CollabChange[]): CollabChange[] {
    const known = new Set(collabStorage.collectAllChanges().map((item) => item.id))
    const fresh = pending.filter((item) => !known.has(item.id))
    if (fresh.length) collabStorage.appendLog(identity.clientId, fresh)
    return collabStorage.collectAllChanges()
  },

  appendChanges(identity: Identity, changes: CollabChange[]) {
    collabStorage.appendLog(identity.clientId, changes)
    return collabStorage.collectAllChanges()
  },

  collectAll(): CollabChange[] {
    return collabStorage.collectAllChanges()
  },

  /** 最近完整草稿检查点（未同步提交 + 输入中草稿一并落盘） */
  writeCheckpoint(identity: Identity, payload: { pending: CollabChange[]; editors: Record<string, string>; cleanExit: boolean }) {
    collabStorage.writeCheckpoint({
      clientId: identity.clientId,
      windowLabel: identity.windowLabel,
      author: identity.author,
      savedAt: Date.now(),
      cleanExit: payload.cleanExit,
      pending: payload.pending,
      editors: payload.editors,
    })
  },

  removeCheckpoint(identity: Identity) {
    collabStorage.removeCheckpoint(identity.clientId)
  },

  /**
   * 启动时扫描其他客户端遗留检查点：
   * - cleanExit=false 且心跳已失活 → 崩溃，返回待恢复检查点（由 UI 弹窗确认）；
   * - cleanExit=true 且仍有 pending → 正常关闭，调用方静默并入；
   * - 在线客户端（心跳新鲜）的检查点跳过。
   */
  scanSessions(selfClientId: string): {
    crashed: Array<SessionLike>
    closed: Array<SessionLike>
  } {
    const STALE_MS = 8000
    const crashed: SessionLike[] = []
    const closed: SessionLike[] = []
    for (const clientId of collabStorage.allClientIds()) {
      if (clientId === selfClientId || clientId === 'legacy') continue
      const cp = collabStorage.readCheckpoint(clientId)
      if (!cp) continue
      const hb = collabStorage.readHeartbeat(clientId)
      const alive = hb && Date.now() - hb.at < STALE_MS
      if (alive) continue
      if (!cp.cleanExit) crashed.push({ clientId, cp })
      else if (cp.pending.length || Object.values(cp.editors).some((value) => value.trim())) closed.push({ clientId, cp })
    }
    // 只恢复最近一次崩溃的检查点
    crashed.sort((a, b) => b.cp.savedAt - a.cp.savedAt)
    closed.sort((a, b) => b.cp.savedAt - a.cp.savedAt)
    return { crashed: crashed.slice(0, 1), closed }
  },

  /** 恢复或放弃后清理其他客户端的遗留检查点 / 心跳 */
  clearSession(clientId: string) {
    collabStorage.removeCheckpoint(clientId)
    collabStorage.removeHeartbeat(clientId)
  },

  /** 清理本客户端检查点中已同步的提交（同步后调用，缩小恢复面） */
  checkpointPendingIds(identity: Identity): Set<string> {
    const cp = collabStorage.readCheckpoint(identity.clientId)
    return new Set((cp?.pending ?? []).map((item) => item.id))
  },
}

type SessionLike = {
  clientId: string
  cp: import('./types').SessionCheckpoint
}
