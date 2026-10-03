export type Measurement = {
  key: string
  name: string
  spec: number
  actual: number
  tolerance: number
}

/** 改动来源：本地产生 / 从协同窗口并入 */
export type ChangeOrigin = 'local' | 'remote'

export type AnnotationPayload = Pick<Annotation, 'id' | 'x' | 'y' | 'part' | 'content'> & {
  status?: Annotation['status']
}
export type ProposalPayload = Pick<RevisionProposal, 'id' | 'role' | 'content' | 'affectedPart'> & {
  status?: RevisionProposal['status']
}
export type DraftPayload = { content: string }
export type DecisionPayload = {
  proposalId: string
  decision: Decision['decision']
  reason: string
  proposalSnapshot: ProposalSnapshot
}
export type LockPayload = { note: string; snapshot?: LockedSnapshot }
export type UnlockPayload = { note: string }

export type ChangePayload =
  | AnnotationPayload
  | ProposalPayload
  | DraftPayload
  | DecisionPayload
  | LockPayload
  | UnlockPayload

/** 跨窗口同步的改动信封，changeId 用于幂等去重（重复同步只算一次） */
export type ChangeEnvelope<TPayload = ChangePayload> = {
  changeId: string
  type: 'annotation' | 'proposal' | 'draft' | 'decision' | 'lock' | 'unlock'
  sampleId: string
  author: string
  createdAt: string
  payload: TPayload
}

export type Annotation = {
  id: string
  changeId: string
  x: number
  y: number
  part: string
  content: string
  author: string
  status: '待处理' | '已解决'
  createdAt: string
  syncedAt: string | null
  origin: ChangeOrigin
}

export type RevisionProposal = {
  id: string
  changeId: string
  author: string
  role: string
  content: string
  affectedPart: string
  status: '待决定' | '已采纳' | '未采纳'
  createdAt: string
  syncedAt: string | null
  origin: ChangeOrigin
}

/** 评审草稿的一次提交，按时间追加保留 */
export type DraftRevision = {
  changeId: string
  sampleId: string
  author: string
  content: string
  createdAt: string
  syncedAt: string | null
  origin: ChangeOrigin
}

/** 采纳决定对原方案的快照，保证已采纳方案保持原依据 */
export type ProposalSnapshot = {
  id: string
  changeId: string
  content: string
  author: string
  role: string
  affectedPart: string
  status: string
}

export type Decision = {
  changeId: string
  sampleId: string
  proposalId: string
  decision: '已采纳' | '未采纳'
  reason: string
  decidedAt: string
  author: string
  origin: ChangeOrigin
  syncedAt: string | null
  proposalSnapshot: ProposalSnapshot
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
  measurements: Record<'第一轮' | '第二轮' | '第三轮', Measurement[]>
  annotations: Annotation[]
  proposals: RevisionProposal[]
  attachments: Array<{ name: string; type: string; owner: string }>
  comments: Array<{ id: string; author: string; content: string; date: string }>
}

/** 锁定时生成的不可变快照 */
export type LockedSnapshot = {
  changeId: string
  sampleId: string
  lockedAt: string
  lockedBy: string
  note: string
  sample: Sample
  decisions: Decision[]
  draft: string | null
}

/** 审核锁定时“另存修订”的独立修订记录，不并入锁定快照 */
export type RevisionRecord = {
  id: string
  sampleId: string
  name: string
  createdAt: string
  author: string
  changes: ChangeEnvelope[]
}
