import type { CollabChange } from './types'
import type { DraftEntry, LockSnapshot, RevisionProposal, Sample, SavedRevision } from '../../api/types'
import { seedSamples } from '../../api/seed'

export type MaterializedSample = Sample & {
  lock: LockSnapshot | null
  savedRevisions: SavedRevision[]
}

export type CollabView = {
  samples: MaterializedSample[]
  /** 全局已见 change id，供「重复同步只算一次」校验 */
  changeIds: Set<string>
}

/** 按 timestamp + id 稳定排序，保证同一部位的多份批注都保留且按提交时间排列 */
const sortByTime = <T extends { timestamp: number; id: string }>(items: T[]): T[] =>
  [...items].sort((a, b) => a.timestamp - b.timestamp || a.id.localeCompare(b.id))

/**
 * 把所有窗口的提交日志折叠成当前视图：
 * - 批注 / 方案 / 草稿均为「追加实体」，按 id 幂等，永不因后保存而被覆盖；
 * - 决定类提交只在方案仍处于「待决定」时生效——
 *   一旦某方案已被采纳（其依据已进入锁定快照），后续提交无法再改变它；
 * - lock 提交冻结当时全部依据的深拷贝，解锁后的新提交只影响新一轮活动视图。
 */
export function materialize(changes: CollabChange[]): CollabView {
  const samples: MaterializedSample[] = seedSamples.map((sample) => ({
    ...structuredClone(sample),
    annotations: [],
    proposals: [],
    draftEntries: [],
    lock: null,
    savedRevisions: [],
  }))
  const index = new Map(samples.map((sample) => [sample.id, sample]))

  const changeIds = new Set<string>()

  for (const change of changes) {
    if (changeIds.has(change.id)) continue // 重复同步只算一次
    changeIds.add(change.id)

    const sample = index.get(change.sampleId)
    if (!sample) continue

    switch (change.type) {
      case 'annotation-add': {
        if (sample.annotations.some((item) => item.id === change.annotation.id)) break
        // 已锁定：新批注不能进入锁定快照，只可能在解锁后的新一轮出现
        sample.annotations.push(structuredClone(change.annotation))
        break
      }
      case 'annotation-resolve': {
        if (sample.lock) break // 锁定后批注只读
        const annotation = sample.annotations.find((item) => item.id === change.annotationId)
        if (annotation) annotation.status = change.status
        break
      }
      case 'proposal-add': {
        if (sample.proposals.some((item) => item.id === change.proposal.id)) break
        sample.proposals.push(structuredClone(change.proposal))
        break
      }
      case 'proposal-decide': {
        if (sample.lock) break
        const proposal = sample.proposals.find((item) => item.id === change.proposalId)
        // 只有第一个决定生效：已采纳 / 已否决方案的依据不被后续提交改动
        if (proposal && proposal.status === '待决定') {
          proposal.status = change.decision.decision
          proposal.decision = { ...change.decision }
        }
        break
      }
      case 'draft-save': {
        // 同一客户端重复保存同一条草稿（同 id）只更新内容；不同提交人各留一条
        const existing = sample.draftEntries.find((item) => item.id === change.entry.id)
        if (existing) {
          existing.content = change.entry.content
        } else {
          sample.draftEntries.push(structuredClone(change.entry))
        }
        break
      }
      case 'lock': {
        if (sample.lock) break // 快照只生成一次，之后不可变
        // 服务端归并层强制校验：有待处理批注 / 待决定方案时锁定无效，不允许绕过 UI 锁定
        const hasPendingAnnotation = sample.annotations.some((item) => item.status === '待处理')
        const hasPendingProposal = sample.proposals.some((item) => item.status === '待决定')
        if (hasPendingAnnotation || hasPendingProposal) break
        const frozen: LockSnapshot = {
          lockedAt: change.createdAt,
          timestamp: change.timestamp,
          lockedBy: change.author,
          round: change.round,
          note: change.note,
          annotations: structuredClone(sortByTime(sample.annotations)),
          proposals: structuredClone(sortByTime(sample.proposals)),
          drafts: structuredClone(sortByTime(sample.draftEntries)),
          savedRevisions: [],
        }
        sample.lock = frozen
        sample.status = '已锁定'
        break
      }
      case 'unlock': {
        // 解锁开新修订分支：快照保留，活动数据继续可编辑
        sample.status = '待审核'
        break
      }
      case 'save-revision': {
        if (!sample.lock) break // 「另存修订」只允许挂在已锁定快照上
        if (sample.savedRevisions.some((item) => item.id === change.revision.id)) break
        sample.lock.savedRevisions.push(structuredClone(change.revision))
        sample.savedRevisions.push(structuredClone(change.revision))
        break
      }
      // no default
    }
  }

  for (const sample of samples) {
    sample.annotations = sortByTime(sample.annotations)
    sample.proposals = sortByTime(sample.proposals)
    sample.draftEntries = sortByTime(sample.draftEntries) as DraftEntry[]
  }

  return { samples, changeIds }
}

/** 已锁定样衣的展示数据以快照为准（保持原依据），未锁定样衣直接用活动视图 */
export function effectiveData(sample: MaterializedSample) {
  const annotations = sample.lock ? sample.lock.annotations : sample.annotations
  const proposals = sample.lock ? sample.lock.proposals : sample.proposals
  const drafts = sample.lock ? sample.lock.drafts : sample.draftEntries
  return { annotations, proposals, drafts }
}

/** 判断一条方案的当前状态是否已被锁定依据固定 */
export function isProposalFrozen(sample: MaterializedSample, proposal: RevisionProposal): boolean {
  if (!sample.lock) return false
  return sample.lock.proposals.some((item) => item.id === proposal.id)
}
