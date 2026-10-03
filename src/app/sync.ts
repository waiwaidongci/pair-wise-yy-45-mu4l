import type { Middleware } from '@reduxjs/toolkit'
import type { AppDispatch, RootState } from './store'
import { markSynced, mergeChange, mergeChanges, setLastSyncedAt, setPeerCount } from '../features/developmentSlice'
import type {
  Annotation,
  ChangeEnvelope,
  ChangePayload,
  Decision,
  DraftRevision,
  LockedSnapshot,
  RevisionProposal,
} from '../api/types'

const CHANNEL_NAME = 'garment-sampling-sync-v1'
const ANNOUNCE_CHANNEL = 'garment-sampling-announce-v1'

const selfChannelId = `self-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
const knownPeers = new Set<string>()

let syncChannel: BroadcastChannel | null = null
let announceChannel: BroadcastChannel | null = null
let pendingSyncTimer: ReturnType<typeof setTimeout> | null = null

export function genId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
}

export function createChangeEnvelope<TPayload extends ChangePayload>(
  type: ChangeEnvelope<TPayload>['type'],
  sampleId: string,
  author: string,
  payload: TPayload,
): ChangeEnvelope<TPayload> {
  return {
    changeId: genId('CH'),
    type,
    sampleId,
    author,
    createdAt: new Date().toISOString(),
    payload,
  }
}

function getSyncChannel(): BroadcastChannel | null {
  if (syncChannel) return syncChannel
  if (typeof BroadcastChannel === 'undefined') return null
  syncChannel = new BroadcastChannel(CHANNEL_NAME)
  return syncChannel
}

function getAnnounceChannel(): BroadcastChannel | null {
  if (announceChannel) return announceChannel
  if (typeof BroadcastChannel === 'undefined') return null
  announceChannel = new BroadcastChannel(ANNOUNCE_CHANNEL)
  return announceChannel
}

export function broadcastChange(envelope: ChangeEnvelope): void {
  getSyncChannel()?.postMessage({ kind: 'change', envelope })
}

export function broadcastHello(): void {
  getSyncChannel()?.postMessage({ kind: 'hello' })
}

export function broadcastBulk(envelopes: ChangeEnvelope[]): void {
  getSyncChannel()?.postMessage({ kind: 'bulk', envelopes })
}

function broadcastAnnounce(): void {
  getAnnounceChannel()?.postMessage({ kind: 'announce', channelId: selfChannelId })
}

/** 从当前状态重建全部改动信封；pendingOnly 时仅取尚未并入的本地改动 */
function buildEnvelopesFromState(state: RootState['development'], pendingOnly = false): ChangeEnvelope[] {
  const envelopes: ChangeEnvelope[] = []
  for (const sample of state.samples) {
    for (const annotation of sample.annotations) {
      if (pendingOnly && !(annotation.origin === 'local' && annotation.syncedAt === null)) continue
      envelopes.push(envelopeFromAnnotation(sample.id, annotation))
    }
    for (const proposal of sample.proposals) {
      if (pendingOnly && !(proposal.origin === 'local' && proposal.syncedAt === null)) continue
      envelopes.push(envelopeFromProposal(sample.id, proposal))
    }
  }
  for (const [sampleId, revisions] of Object.entries(state.draftRevisions)) {
    for (const revision of revisions) {
      if (pendingOnly && !(revision.origin === 'local' && revision.syncedAt === null)) continue
      envelopes.push(envelopeFromDraft(sampleId, revision))
    }
  }
  for (const decision of state.decisions) {
    if (pendingOnly && !(decision.origin === 'local' && decision.syncedAt === null)) continue
      envelopes.push(envelopeFromDecision(decision))
  }
  for (const snapshot of Object.values(state.lockedSnapshots)) {
    envelopes.push(envelopeFromSnapshot(snapshot))
  }
  return envelopes
}

function envelopeFromAnnotation(sampleId: string, annotation: Annotation): ChangeEnvelope {
  return {
    changeId: annotation.changeId,
    type: 'annotation',
    sampleId,
    author: annotation.author,
    createdAt: annotation.createdAt,
    payload: {
      id: annotation.id,
      x: annotation.x,
      y: annotation.y,
      part: annotation.part,
      content: annotation.content,
      status: annotation.status,
    },
  }
}

function envelopeFromProposal(sampleId: string, proposal: RevisionProposal): ChangeEnvelope {
  return {
    changeId: proposal.changeId,
    type: 'proposal',
    sampleId,
    author: proposal.author,
    createdAt: proposal.createdAt,
    payload: {
      id: proposal.id,
      role: proposal.role,
      content: proposal.content,
      affectedPart: proposal.affectedPart,
      status: proposal.status,
    },
  }
}

function envelopeFromDraft(sampleId: string, revision: DraftRevision): ChangeEnvelope {
  return {
    changeId: revision.changeId,
    type: 'draft',
    sampleId,
    author: revision.author,
    createdAt: revision.createdAt,
    payload: { content: revision.content },
  }
}

function envelopeFromDecision(decision: Decision): ChangeEnvelope {
  return {
    changeId: decision.changeId,
    type: 'decision',
    sampleId: decision.sampleId,
    author: decision.author,
    createdAt: decision.decidedAt,
    payload: {
      proposalId: decision.proposalId,
      decision: decision.decision,
      reason: decision.reason,
      proposalSnapshot: decision.proposalSnapshot,
    },
  }
}

function envelopeFromSnapshot(snapshot: LockedSnapshot): ChangeEnvelope {
  return {
    changeId: snapshot.changeId,
    type: 'lock',
    sampleId: snapshot.sampleId,
    author: snapshot.lockedBy,
    createdAt: snapshot.lockedAt,
    payload: { note: snapshot.note, snapshot },
  }
}

/** 手动/自动同步：把尚未并入的本地改动广播给其他窗口，并标记为已并入 */
export const syncAll = (): ((dispatch: AppDispatch, getState: () => RootState) => void) => (dispatch, getState) => {
  const pending = buildEnvelopesFromState(getState().development, true)
  if (pending.length > 0) broadcastBulk(pending)
  const ids = pending.map((envelope) => envelope.changeId)
  if (ids.length > 0) dispatch(markSynced(ids))
  dispatch(setLastSyncedAt(new Date().toISOString()))
}

/** 本地改动产生后：立即广播（实时协同），并在静默一段时间后标记为已并入 */
function schedulePendingSync(dispatch: AppDispatch): void {
  if (pendingSyncTimer) clearTimeout(pendingSyncTimer)
  pendingSyncTimer = setTimeout(() => {
    pendingSyncTimer = null
    dispatch(syncAll())
  }, 1000)
}

const SYNCED_ACTION_TYPES = new Set([
  'development/addAnnotation',
  'development/addProposal',
  'development/saveDraft',
  'development/decideProposal',
  'development/lockReview',
  'development/unlockReview',
])

/** 拦截本地改动动作并广播；接收方按 changeId 幂等并入 */
export const syncMiddleware: Middleware = (store) => (next) => (action) => {
  const result = next(action)
  if (
    typeof action === 'object' &&
    action !== null &&
    'type' in action &&
    SYNCED_ACTION_TYPES.has(action.type as string)
  ) {
    const envelope = (action as { payload?: ChangeEnvelope }).payload
    if (envelope && envelope.changeId) {
      broadcastChange(envelope)
      schedulePendingSync(store.dispatch as AppDispatch)
    }
  }
  return result
}

/** 建立跨窗口同步通道，返回清理函数 */
export function setupChannel(dispatch: AppDispatch, getState: () => RootState): () => void {
  const syncCh = getSyncChannel()
  const announceCh = getAnnounceChannel()
  if (!syncCh || !announceCh) return () => {}

  const onSyncMessage = (event: MessageEvent) => {
    const message = event.data as { kind?: string; envelope?: ChangeEnvelope; envelopes?: ChangeEnvelope[] }
    if (!message || !message.kind) return
    if (message.kind === 'change' && message.envelope) {
      dispatch(mergeChange(message.envelope))
    } else if (message.kind === 'bulk' && message.envelopes) {
      dispatch(mergeChanges(message.envelopes))
    } else if (message.kind === 'hello') {
      broadcastBulk(buildEnvelopesFromState(getState().development))
      broadcastAnnounce()
    }
  }

  const onAnnounceMessage = (event: MessageEvent) => {
    const message = event.data as { kind?: string; channelId?: string }
    if (message?.kind === 'announce' && message.channelId && message.channelId !== selfChannelId) {
      knownPeers.add(message.channelId)
      dispatch(setPeerCount(knownPeers.size))
    }
  }

  syncCh.addEventListener('message', onSyncMessage)
  announceCh.addEventListener('message', onAnnounceMessage)

  // 新窗口加入：广播自己并请求已有窗口的状态
  broadcastAnnounce()
  broadcastHello()

  return () => {
    syncCh.removeEventListener('message', onSyncMessage)
    announceCh.removeEventListener('message', onAnnounceMessage)
    if (pendingSyncTimer) clearTimeout(pendingSyncTimer)
  }
}
