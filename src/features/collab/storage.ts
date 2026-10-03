import type { CollabChange, Heartbeat, SessionCheckpoint } from './types'
import { seedSamples } from '../../api/seed'
import type { Annotation, DraftEntry, RevisionProposal } from '../../api/types'

/**
 * 存储布局（localStorage 全部按客户端分文件，避免两个窗口整包覆盖）：
 * - garment-log-<clientId>   该客户端已同步的追加提交日志（只读追加，不重写他人数据）
 * - garment-cp-<clientId>    该客户端最近完整草稿检查点（含未同步提交）
 * - garment-hb-<clientId>    该客户端在线心跳
 * - garment-identity         当前窗口身份（clientId / 窗口标签 / 姓名，仅本标签页用 sessionStorage）
 *
 * 旧版本曾把整个 Redux 状态写进单一 key（garment-sampling-draft-v1），
 * 两个窗口后保存者整体覆盖对方；首次启动时做一次性迁移并删除旧 key。
 */
const LOG_PREFIX = 'garment-log-'
const CP_PREFIX = 'garment-cp-'
const HB_PREFIX = 'garment-hb-'
export const IDENTITY_KEY = 'garment-identity'
const LEGACY_KEY = 'garment-sampling-draft-v1'

export const collabStorage = {
  readJson<T>(key: string): T | null {
    try {
      const raw = localStorage.getItem(key)
      return raw ? (JSON.parse(raw) as T) : null
    } catch {
      return null
    }
  },
  writeJson(key: string, value: unknown) {
    try {
      localStorage.setItem(key, JSON.stringify(value))
    } catch {
      // 存储不可用时静默降级（隐私模式 / 配额已满）
    }
  },
  remove(key: string) {
    try {
      localStorage.removeItem(key)
    } catch {
      /* ignore */
    }
  },

  readSession<T>(key: string): T | null {
    try {
      const raw = sessionStorage.getItem(key)
      return raw ? (JSON.parse(raw) as T) : null
    } catch {
      return null
    }
  },

  logKey(clientId: string) {
    return `${LOG_PREFIX}${clientId}`
  },
  cpKey(clientId: string) {
    return `${CP_PREFIX}${clientId}`
  },
  hbKey(clientId: string) {
    return `${HB_PREFIX}${clientId}`
  },

  readLog(clientId: string): CollabChange[] {
    return this.readJson<CollabChange[]>(this.logKey(clientId)) ?? []
  },
  appendLog(clientId: string, changes: CollabChange[]) {
    if (!changes.length) return
    const current = this.readLog(clientId)
    const seen = new Set(current.map((item) => item.id))
    const merged = [...current, ...changes.filter((item) => !seen.has(item.id))]
    this.writeJson(this.logKey(clientId), merged)
  },

  readCheckpoint(clientId: string): SessionCheckpoint | null {
    return this.readJson<SessionCheckpoint>(this.cpKey(clientId))
  },
  writeCheckpoint(cp: SessionCheckpoint) {
    this.writeJson(this.cpKey(cp.clientId), cp)
  },
  removeCheckpoint(clientId: string) {
    this.remove(this.cpKey(clientId))
  },

  readHeartbeat(clientId: string): Heartbeat | null {
    return this.readJson<Heartbeat>(this.hbKey(clientId))
  },
  writeHeartbeat(hb: Heartbeat) {
    this.writeJson(this.hbKey(hb.clientId), hb)
  },
  removeHeartbeat(clientId: string) {
    this.remove(this.hbKey(clientId))
  },

  /** 枚举所有客户端 id（日志 / 检查点 / 心跳三类 key 的并集） */
  allClientIds(): string[] {
    const ids = new Set<string>()
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i)
      if (!key) continue
      if (key.startsWith(LOG_PREFIX)) ids.add(key.slice(LOG_PREFIX.length))
      if (key.startsWith(CP_PREFIX)) ids.add(key.slice(CP_PREFIX.length))
      if (key.startsWith(HB_PREFIX)) ids.add(key.slice(HB_PREFIX.length))
    }
    return [...ids]
  },

  /** 合并所有客户端日志并按提交 id 幂等去重 */
  collectAllChanges(): CollabChange[] {
    const byId = new Map<string, CollabChange>()
    for (const clientId of this.allClientIds()) {
      for (const change of this.readLog(clientId)) {
        if (!byId.has(change.id)) byId.set(change.id, change)
      }
    }
    return [...byId.values()].sort((a, b) => a.timestamp - b.timestamp || a.id.localeCompare(b.id))
  },

  /**
   * 一次性迁移旧版整包状态，只在没有任何新日志且旧 key 存在时执行。
   * 旧数据里的批注 / 方案本就是种子数据，仅迁移评审草稿、方案决定和锁定态。
   */
  migrateLegacyIfNeeded() {
    const hasLogs = this.allClientIds().some((id) => this.readLog(id).length > 0)
    if (hasLogs) {
      this.remove(LEGACY_KEY)
      return
    }
    const legacy = this.readJson<{
      decisions?: Array<{ proposalId: string; decision: '已采纳' | '未采纳'; reason: string; decidedAt: string }>
      draftNotes?: Record<string, string>
      locked?: boolean
    }>(LEGACY_KEY)
    if (!legacy) return

    const now = Date.now()
    const meta = (id: string, sampleId: string) => ({
      id,
      clientId: 'legacy',
      windowLabel: '旧版数据迁移',
      author: '当前用户',
      timestamp: now,
      createdAt: new Date(now).toLocaleString('zh-CN', { hour12: false }),
      sampleId,
    })
    const changes: CollabChange[] = []
    const sampleId = seedSamples[0]?.id
    if (sampleId) {
      for (const [sid, content] of Object.entries(legacy.draftNotes ?? {})) {
        if (!content.trim()) continue
        const entry: DraftEntry = {
          id: `DR-LEGACY-${sid}`,
          author: '当前用户',
          sourceWindow: '旧版数据迁移',
          clientId: 'legacy',
          content,
          createdAt: meta('', sid).createdAt,
          timestamp: meta('', sid).timestamp,
        }
        changes.push({ ...meta(`CH-LEGACY-DRAFT-${sid}`, sid), type: 'draft-save', entry })
      }
      for (const [index, decision] of (legacy.decisions ?? []).entries()) {
        changes.push({
          ...meta(`CH-LEGACY-DECISION-${index}`, sampleId),
          type: 'proposal-decide',
          proposalId: decision.proposalId,
          decision: {
            decision: decision.decision,
            reason: decision.reason,
            decidedAt: decision.decidedAt,
            decidedBy: '当前用户',
          },
        })
      }
      if (legacy.locked) {
        changes.push({ ...meta('CH-LEGACY-LOCK', sampleId), type: 'lock', round: '第三轮', note: '旧版数据迁移：保留已锁定状态' })
      }
    }
    if (changes.length) this.appendLog('legacy', changes)
    this.remove(LEGACY_KEY)
  },
}

/** 供迁移之外的模块构造实体时复用 */
export type { Annotation, RevisionProposal }
