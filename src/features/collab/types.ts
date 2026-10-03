import type { Annotation, DraftEntry, RevisionProposal, Round, SavedRevision } from '../../api/types'

/**
 * 协作层的所有写操作都是「提交（change）」。
 * 每个窗口只向自己的日志追加提交；读取时合并所有窗口的日志。
 * id 全局唯一，重复同步 / 重复读取都按 id 幂等去重。
 */
export type ChangeBase = {
  /** 全局唯一提交 id，幂等键 */
  id: string
  /** 提交客户端 id */
  clientId: string
  /** 提交来源窗口，例如「窗口 A」 */
  windowLabel: string
  /** 提交人姓名 */
  author: string
  /** 毫秒时间戳，合并排序依据 */
  timestamp: number
  /** 本地化展示时间 */
  createdAt: string
  sampleId: string
}

export type CollabChange =
  | (ChangeBase & { type: 'annotation-add'; annotation: Annotation })
  | (ChangeBase & { type: 'annotation-resolve'; annotationId: string; status: Annotation['status'] })
  | (ChangeBase & { type: 'proposal-add'; proposal: RevisionProposal })
  | (ChangeBase & {
      type: 'proposal-decide'
      proposalId: string
      decision: {
        decision: '已采纳' | '未采纳'
        reason: string
        decidedAt: string
        decidedBy: string
      }
    })
  | (ChangeBase & { type: 'draft-save'; entry: DraftEntry })
  | (ChangeBase & { type: 'lock'; round: Round; note: string })
  | (ChangeBase & { type: 'unlock' })
  | (ChangeBase & { type: 'save-revision'; revision: SavedRevision })

export type ChangeType = CollabChange['type']

/** 崩溃 / 重开后可恢复的最近完整草稿检查点 */
export type SessionCheckpoint = {
  clientId: string
  windowLabel: string
  author: string
  savedAt: number
  /** 正常关闭标记：false 表示页面崩溃 / 异常退出 */
  cleanExit: boolean
  /** 尚未并入共享日志的本地提交 */
  pending: CollabChange[]
  /** 尚未点「保存草稿」的输入框文本，按样衣 id 索引 */
  editors: Record<string, string>
}

export type Heartbeat = {
  clientId: string
  windowLabel: string
  author: string
  bootAt: number
  at: number
}
