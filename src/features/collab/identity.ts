import { collabStorage, IDENTITY_KEY } from './storage'
import type { Heartbeat } from './types'

export type Identity = {
  clientId: string
  /** 窗口标签 A / B / C…，同一浏览器内按在线顺序分配 */
  windowLabel: string
  author: string
}

const randomId = () =>
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

/**
 * 取本标签页身份。身份存在 sessionStorage，因此：
 * - 同一个标签页内刷新仍是同一个窗口（崩溃恢复可找回它）
 * - 新开窗口 / 新标签页自动成为独立客户端，绝不共享或覆盖身份
 */
export function getIdentity(): Identity {
  const existing = collabStorage.readSession<Identity>(IDENTITY_KEY)
  if (existing) return existing

  const clientId = randomId()
  const windowLabel = claimWindowLabel(clientId)
  const identity: Identity = { clientId, windowLabel, author: '当前用户' }
  sessionStorage.setItem(IDENTITY_KEY, JSON.stringify(identity))
  return identity
}

export function saveIdentity(identity: Identity) {
  sessionStorage.setItem(IDENTITY_KEY, JSON.stringify(identity))
}

/** 依据当前在线心跳分配 A / B / C…，已占用的标签顺延 */
function claimWindowLabel(clientId: string): string {
  const used = new Set<string>()
  for (const id of collabStorage.allClientIds()) {
    if (id === clientId) continue
    const hb = collabStorage.readHeartbeat(id)
    if (hb && Date.now() - hb.at < 8000) used.add(hb.windowLabel)
    else {
      // 已不在线的旧标签：它的检查点恢复提示仍需要可辨认的标签
      const cp = collabStorage.readCheckpoint(id)
      if (cp) used.add(cp.windowLabel)
    }
  }
  for (let i = 0; i < 26; i += 1) {
    const label = String.fromCharCode(65 + i)
    if (!used.has(label)) return `窗口 ${label}`
  }
  return `窗口 ${randomId().slice(0, 4)}`
}

export function writeHeartbeat(identity: Identity, bootAt: number) {
  const hb: Heartbeat = {
    clientId: identity.clientId,
    windowLabel: identity.windowLabel,
    author: identity.author,
    bootAt,
    at: Date.now(),
  }
  collabStorage.writeHeartbeat(hb)
}
