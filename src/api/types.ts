export type Measurement = {
  key: string
  name: string
  spec: number
  actual: number
  tolerance: number
}

export type Round = '第一轮' | '第二轮' | '第三轮'

export type Annotation = {
  id: string
  x: number
  y: number
  part: string
  content: string
  author: string
  status: '待处理' | '已解决'
  /** 批注所属评审轮次 */
  round: Round
  /** 提交时间（ISO 字符串） */
  createdAt: string
  /** 提交时间的原始毫秒值，用于稳定排序 */
  timestamp: number
  /** 提交来源窗口，例如「窗口 A」 */
  sourceWindow: string
  /** 提交客户端 id */
  clientId: string
}

export type RevisionProposal = {
  id: string
  author: string
  role: string
  content: string
  affectedPart: string
  status: '待决定' | '已采纳' | '未采纳'
  createdAt: string
  timestamp: number
  sourceWindow: string
  clientId: string
  /** 采纳/否决决定 */
  decision?: { decision: '已采纳' | '未采纳'; reason: string; decidedAt: string; decidedBy: string }
}

/** 评审草稿条目：按提交人分别保留，多窗口同一样衣不互相覆盖 */
export type DraftEntry = {
  id: string
  author: string
  sourceWindow: string
  clientId: string
  content: string
  createdAt: string
  timestamp: number
}

/** 锁定时另存、未并入只读快照的本地修订 */
export type SavedRevision = {
  id: string
  author: string
  sourceWindow: string
  reason: string
  createdAt: string
  timestamp: number
  annotations: Annotation[]
  proposals: RevisionProposal[]
  drafts: DraftEntry[]
}

/** 审核锁定瞬间的不可变快照，锁定后不再被任何后续提交修改 */
export type LockSnapshot = {
  lockedAt: string
  timestamp: number
  lockedBy: string
  round: Round
  note: string
  annotations: Annotation[]
  proposals: RevisionProposal[]
  drafts: DraftEntry[]
  savedRevisions: SavedRevision[]
}

export type Sample = {
  id: string
  styleCode: string
  styleName: string
  category: string
  developmentSeason: string
  supplier: string
  dueDate: string
  owner: string
  status: '开发中' | '待审核' | '已锁定'
  fabric: string
  colorway: string
  craft: string[]
  measurements: Record<Round, Measurement[]>
  annotations: Annotation[]
  proposals: RevisionProposal[]
  /** 按提交人合并后的评审草稿 */
  draftEntries: DraftEntry[]
  attachments: Array<{ name: string; type: string; owner: string }>
  comments: Array<{ id: string; author: string; content: string; date: string }>
}
