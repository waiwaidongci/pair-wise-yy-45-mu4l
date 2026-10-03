import { createSlice, type PayloadAction } from '@reduxjs/toolkit'
import { seedSamples } from '../api/seed'
import type {
  Annotation,
  AnnotationPayload,
  ChangeEnvelope,
  Decision,
  DecisionPayload,
  DraftPayload,
  DraftRevision,
  LockedSnapshot,
  LockPayload,
  ProposalPayload,
  RevisionProposal,
  RevisionRecord,
  Sample,
  UnlockPayload,
} from '../api/types'

type DevelopmentState = {
  samples: Sample[]
  selectedId: string
  roundA: '第一轮' | '第二轮' | '第三轮'
  roundB: '第一轮' | '第二轮' | '第三轮'
  decisions: Decision[]
  draftRevisions: Record<string, DraftRevision[]>
  locked: boolean
  lockedSnapshots: Record<string, LockedSnapshot>
  revisions: RevisionRecord[]
  activeAnnotation: string | null
  /** 已应用的改动 changeId 集合，用于幂等去重（重复同步只算一次） */
  appliedChangeIds: string[]
  lastSyncedAt: string | null
  peerCount: number
  crashRecovery: { available: boolean; savedAt: string | null }
}

const storageKey = 'garment-sampling-draft-v1'
const recoveryKey = 'garment-sampling-recovery-v1'
const dirtyKey = 'garment-sampling-dirty-v1'

const fallbackState: DevelopmentState = {
  samples: structuredClone(seedSamples).map(normalizeSample),
  selectedId: seedSamples[0].id,
  roundA: '第二轮',
  roundB: '第三轮',
  decisions: [],
  draftRevisions: {},
  locked: false,
  lockedSnapshots: {},
  revisions: [],
  activeAnnotation: null,
  appliedChangeIds: [],
  lastSyncedAt: null,
  peerCount: 0,
  crashRecovery: { available: false, savedAt: null },
}

function normalizeSample(sample: Sample): Sample {
  return {
    ...sample,
    annotations: sample.annotations.map((annotation, index) => ({
      ...annotation,
      changeId: annotation.changeId ?? `seed-${sample.id}-AN-${index}`,
      createdAt: annotation.createdAt ?? '2026-09-27T10:00:00.000Z',
      syncedAt: annotation.syncedAt ?? '2026-09-27T10:00:00.000Z',
      origin: annotation.origin ?? ('remote' as const),
    })),
    proposals: sample.proposals.map((proposal, index) => ({
      ...proposal,
      changeId: proposal.changeId ?? `seed-${sample.id}-RV-${index}`,
      createdAt: proposal.createdAt ?? '2026-09-27T10:00:00.000Z',
      syncedAt: proposal.syncedAt ?? '2026-09-27T10:00:00.000Z',
      origin: proposal.origin ?? ('remote' as const),
    })),
  }
}

function normalizeDecisions(raw: unknown, samples: Sample[]): Decision[] {
  if (!Array.isArray(raw)) return []
  return raw
    .map((item) => {
      const row = item as Partial<Decision> & { proposalId?: string }
      if (!row || !row.proposalId) return null
      const sample = samples.find((s) => s.proposals.some((p) => p.id === row.proposalId))
      const proposal = sample?.proposals.find((p) => p.id === row.proposalId)
      return {
        changeId: row.changeId ?? `seed-dec-${row.proposalId}`,
        sampleId: row.sampleId ?? sample?.id ?? '',
        proposalId: row.proposalId,
        decision: row.decision ?? '待决定',
        reason: row.reason ?? '',
        decidedAt: row.decidedAt ?? '2026-09-27T10:00:00.000Z',
        author: row.author ?? '品类负责人',
        origin: row.origin ?? ('remote' as const),
        syncedAt: row.syncedAt ?? '2026-09-27T10:00:00.000Z',
        proposalSnapshot: row.proposalSnapshot ?? {
          id: proposal?.id ?? row.proposalId,
          changeId: proposal?.changeId ?? '',
          content: proposal?.content ?? '',
          author: proposal?.author ?? '',
          role: proposal?.role ?? '',
          affectedPart: proposal?.affectedPart ?? '',
          status: row.decision ?? '待决定',
        },
      } as Decision
    })
    .filter((item): item is Decision => item !== null)
}

function loadInitialState(): DevelopmentState {
  try {
    const saved = localStorage.getItem(storageKey)
    if (saved) {
      const parsed = JSON.parse(saved) as Partial<DevelopmentState>
      const samples = (parsed.samples ?? fallbackState.samples).map(normalizeSample)
      const state: DevelopmentState = {
        ...fallbackState,
        ...parsed,
        samples,
        decisions: normalizeDecisions(parsed.decisions, samples),
        draftRevisions: parsed.draftRevisions ?? {},
        lockedSnapshots: parsed.lockedSnapshots ?? {},
        revisions: parsed.revisions ?? [],
        appliedChangeIds: parsed.appliedChangeIds ?? [],
        crashRecovery: { available: false, savedAt: null },
      }
      const dirty = sessionStorage.getItem(dirtyKey) === '1'
      if (dirty) {
        const recoveryRaw = localStorage.getItem(recoveryKey)
        if (recoveryRaw) {
          const recovery = JSON.parse(recoveryRaw) as { savedAt?: string }
          state.crashRecovery = { available: true, savedAt: recovery.savedAt ?? null }
        }
      }
      return state
    }
  } catch {
    // 草稿损坏时回退到种子数据
  }
  return structuredClone(fallbackState)
}

function deepFreeze<T>(obj: T): T {
  if (obj && typeof obj === 'object') {
    for (const value of Object.values(obj as Record<string, unknown>)) deepFreeze(value)
    return Object.freeze(obj)
  }
  return obj
}

function currentDraftOf(state: DevelopmentState, sampleId: string): string | null {
  const list = state.draftRevisions[sampleId]
  if (!list || list.length === 0) return null
  return [...list].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0].content
}

/** 收集某样品尚未并入共享状态的本地改动（syncedAt 为 null） */
function collectPendingEnvelopesForSample(state: DevelopmentState, sampleId: string): ChangeEnvelope[] {
  const envelopes: ChangeEnvelope[] = []
  const sample = state.samples.find((item) => item.id === sampleId)
  if (sample) {
    for (const annotation of sample.annotations) {
      if (annotation.origin === 'local' && annotation.syncedAt === null) {
        envelopes.push({
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
          } as AnnotationPayload,
        })
      }
    }
    for (const proposal of sample.proposals) {
      if (proposal.origin === 'local' && proposal.syncedAt === null) {
        envelopes.push({
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
          } as ProposalPayload,
        })
      }
    }
  }
  for (const revision of state.draftRevisions[sampleId] ?? []) {
    if (revision.origin === 'local' && revision.syncedAt === null) {
      envelopes.push({
        changeId: revision.changeId,
        type: 'draft',
        sampleId,
        author: revision.author,
        createdAt: revision.createdAt,
        payload: { content: revision.content } as DraftPayload,
      })
    }
  }
  for (const decision of state.decisions) {
    if (decision.sampleId === sampleId && decision.origin === 'local' && decision.syncedAt === null) {
      envelopes.push({
        changeId: decision.changeId,
        type: 'decision',
        sampleId,
        author: decision.author,
        createdAt: decision.decidedAt,
        payload: {
          proposalId: decision.proposalId,
          decision: decision.decision,
          reason: decision.reason,
          proposalSnapshot: decision.proposalSnapshot,
        } as DecisionPayload,
      })
    }
  }
  return envelopes
}

/** 将改动信封并入状态，按 changeId 幂等去重 */
function applyEnvelope(state: DevelopmentState, envelope: ChangeEnvelope): void {
  if (state.appliedChangeIds.includes(envelope.changeId)) return
  state.appliedChangeIds.push(envelope.changeId)
  state.lastSyncedAt = new Date().toISOString()
  const sample = state.samples.find((item) => item.id === envelope.sampleId)
  if (!sample) return
  const now = new Date().toISOString()

  switch (envelope.type) {
    case 'annotation': {
      const payload = envelope.payload as AnnotationPayload
      const annotation: Annotation = {
        id: payload.id,
        changeId: envelope.changeId,
        x: payload.x,
        y: payload.y,
        part: payload.part,
        content: payload.content,
        author: envelope.author,
        status: payload.status ?? '待处理',
        createdAt: envelope.createdAt,
        syncedAt: now,
        origin: 'remote',
      }
      sample.annotations.push(annotation)
      break
    }
    case 'proposal': {
      const payload = envelope.payload as ProposalPayload
      const proposal: RevisionProposal = {
        id: payload.id,
        changeId: envelope.changeId,
        author: envelope.author,
        role: payload.role,
        content: payload.content,
        affectedPart: payload.affectedPart,
        status: payload.status ?? '待决定',
        createdAt: envelope.createdAt,
        syncedAt: now,
        origin: 'remote',
      }
      sample.proposals.push(proposal)
      break
    }
    case 'draft': {
      const payload = envelope.payload as DraftPayload
      const list = state.draftRevisions[envelope.sampleId] ?? []
      list.push({
        changeId: envelope.changeId,
        sampleId: envelope.sampleId,
        author: envelope.author,
        content: payload.content,
        createdAt: envelope.createdAt,
        syncedAt: now,
        origin: 'remote',
      })
      state.draftRevisions[envelope.sampleId] = list
      break
    }
    case 'decision': {
      const payload = envelope.payload as DecisionPayload
      state.decisions.push({
        changeId: envelope.changeId,
        sampleId: envelope.sampleId,
        proposalId: payload.proposalId,
        decision: payload.decision,
        reason: payload.reason,
        decidedAt: envelope.createdAt,
        author: envelope.author,
        origin: 'remote',
        syncedAt: now,
        proposalSnapshot: payload.proposalSnapshot,
      })
      const proposal = sample.proposals.find((item) => item.id === payload.proposalId)
      if (proposal) proposal.status = payload.decision
      break
    }
    case 'lock': {
      const payload = envelope.payload as LockPayload
      if (state.lockedSnapshots[envelope.sampleId] || !payload.snapshot) break
      state.lockedSnapshots[envelope.sampleId] = deepFreeze(payload.snapshot)
      sample.status = '已锁定'
      state.locked = true
      break
    }
    case 'unlock': {
      sample.status = '待审核'
      state.locked = false
      break
    }
  }
}

const slice = createSlice({
  name: 'development',
  initialState: loadInitialState(),
  reducers: {
    selectSample(state, action: PayloadAction<string>) {
      state.selectedId = action.payload
      state.activeAnnotation = null
    },
    setRounds(state, action: PayloadAction<{ a?: DevelopmentState['roundA']; b?: DevelopmentState['roundB'] }>) {
      if (action.payload.a) state.roundA = action.payload.a
      if (action.payload.b) state.roundB = action.payload.b
    },
    addAnnotation(state, action: PayloadAction<ChangeEnvelope<AnnotationPayload>>) {
      const envelope = action.payload
      if (state.appliedChangeIds.includes(envelope.changeId)) return
      state.appliedChangeIds.push(envelope.changeId)
      const sample = state.samples.find((item) => item.id === envelope.sampleId)
      if (!sample || state.locked) return
      const payload = envelope.payload
      sample.annotations.push({
        id: payload.id,
        changeId: envelope.changeId,
        x: payload.x,
        y: payload.y,
        part: payload.part,
        content: payload.content,
        author: envelope.author,
        status: payload.status ?? '待处理',
        createdAt: envelope.createdAt,
        syncedAt: null,
        origin: 'local',
      })
    },
    addProposal(state, action: PayloadAction<ChangeEnvelope<ProposalPayload>>) {
      const envelope = action.payload
      if (state.appliedChangeIds.includes(envelope.changeId)) return
      state.appliedChangeIds.push(envelope.changeId)
      const sample = state.samples.find((item) => item.id === envelope.sampleId)
      if (!sample || state.locked) return
      const payload = envelope.payload
      sample.proposals.push({
        id: payload.id,
        changeId: envelope.changeId,
        author: envelope.author,
        role: payload.role,
        content: payload.content,
        affectedPart: payload.affectedPart,
        status: payload.status ?? '待决定',
        createdAt: envelope.createdAt,
        syncedAt: null,
        origin: 'local',
      })
    },
    saveDraft(state, action: PayloadAction<ChangeEnvelope<DraftPayload>>) {
      const envelope = action.payload
      if (state.appliedChangeIds.includes(envelope.changeId)) return
      state.appliedChangeIds.push(envelope.changeId)
      const sample = state.samples.find((item) => item.id === envelope.sampleId)
      if (!sample || state.locked) return
      const list = state.draftRevisions[envelope.sampleId] ?? []
      list.push({
        changeId: envelope.changeId,
        sampleId: envelope.sampleId,
        author: envelope.author,
        content: envelope.payload.content,
        createdAt: envelope.createdAt,
        syncedAt: null,
        origin: 'local',
      })
      state.draftRevisions[envelope.sampleId] = list
    },
    decideProposal(state, action: PayloadAction<ChangeEnvelope<DecisionPayload>>) {
      const envelope = action.payload
      if (state.appliedChangeIds.includes(envelope.changeId)) return
      state.appliedChangeIds.push(envelope.changeId)
      const sample = state.samples.find((item) => item.id === envelope.sampleId)
      if (!sample || state.locked) return
      const payload = envelope.payload
      state.decisions.push({
        changeId: envelope.changeId,
        sampleId: envelope.sampleId,
        proposalId: payload.proposalId,
        decision: payload.decision,
        reason: payload.reason,
        decidedAt: envelope.createdAt,
        author: envelope.author,
        origin: 'local',
        syncedAt: null,
        proposalSnapshot: payload.proposalSnapshot,
      })
      const proposal = sample.proposals.find((item) => item.id === payload.proposalId)
      if (proposal) proposal.status = payload.decision
    },
    lockReview(state, action: PayloadAction<ChangeEnvelope<LockPayload>>) {
      const envelope = action.payload
      if (state.appliedChangeIds.includes(envelope.changeId)) return
      state.appliedChangeIds.push(envelope.changeId)
      const sample = state.samples.find((item) => item.id === envelope.sampleId)
      if (!sample) return
      // 快照在放弃 / 另存修订之后生成，因此不包含未并入的本地改动
      const snapshot: LockedSnapshot = {
        changeId: envelope.changeId,
        sampleId: sample.id,
        lockedAt: envelope.createdAt,
        lockedBy: envelope.author,
        note: envelope.payload.note,
        sample: JSON.parse(JSON.stringify(sample)),
        decisions: JSON.parse(JSON.stringify(state.decisions.filter((item) => item.sampleId === sample.id))),
        draft: currentDraftOf(state, sample.id),
      }
      state.lockedSnapshots[sample.id] = deepFreeze(snapshot)
      sample.status = '已锁定'
      state.locked = true
      // 回填快照，供中间件广播给其他窗口
      envelope.payload.snapshot = snapshot
    },
    unlockReview(state, action: PayloadAction<ChangeEnvelope<UnlockPayload>>) {
      const envelope = action.payload
      if (state.appliedChangeIds.includes(envelope.changeId)) return
      state.appliedChangeIds.push(envelope.changeId)
      const sample = state.samples.find((item) => item.id === envelope.sampleId)
      if (sample) sample.status = '待审核'
      state.locked = false
    },
    resolveAnnotation(state, action: PayloadAction<{ sampleId: string; annotationId: string }>) {
      const sample = state.samples.find((item) => item.id === action.payload.sampleId)
      const annotation = sample?.annotations.find((item) => item.id === action.payload.annotationId)
      if (annotation) annotation.status = annotation.status === '待处理' ? '已解决' : '待处理'
    },
    toggleAnnotation(state, action: PayloadAction<string | null>) {
      state.activeAnnotation = action.payload
    },
    mergeChange(state, action: PayloadAction<ChangeEnvelope>) {
      applyEnvelope(state, action.payload)
    },
    mergeChanges(state, action: PayloadAction<ChangeEnvelope[]>) {
      for (const envelope of action.payload) applyEnvelope(state, envelope)
    },
    markSynced(state, action: PayloadAction<string[]>) {
      const ids = new Set(action.payload)
      const now = new Date().toISOString()
      for (const sample of state.samples) {
        for (const annotation of sample.annotations) {
          if (ids.has(annotation.changeId)) annotation.syncedAt = now
        }
        for (const proposal of sample.proposals) {
          if (ids.has(proposal.changeId)) proposal.syncedAt = now
        }
      }
      for (const list of Object.values(state.draftRevisions)) {
        for (const revision of list) if (ids.has(revision.changeId)) revision.syncedAt = now
      }
      for (const decision of state.decisions) {
        if (ids.has(decision.changeId)) decision.syncedAt = now
      }
    },
    setPeerCount(state, action: PayloadAction<number>) {
      state.peerCount = action.payload
    },
    setLastSyncedAt(state, action: PayloadAction<string | null>) {
      state.lastSyncedAt = action.payload
    },
    discardPendingChanges(state, action: PayloadAction<{ sampleId: string }>) {
      const { sampleId } = action.payload
      const sample = state.samples.find((item) => item.id === sampleId)
      if (sample) {
        sample.annotations = sample.annotations.filter(
          (item) => !(item.origin === 'local' && item.syncedAt === null),
        )
        sample.proposals = sample.proposals.filter(
          (item) => !(item.origin === 'local' && item.syncedAt === null),
        )
      }
      state.draftRevisions[sampleId] = (state.draftRevisions[sampleId] ?? []).filter(
        (item) => !(item.origin === 'local' && item.syncedAt === null),
      )
      state.decisions = state.decisions.filter(
        (item) => !(item.sampleId === sampleId && item.origin === 'local' && item.syncedAt === null),
      )
    },
    saveAsRevision(state, action: PayloadAction<{ sampleId: string; name: string }>) {
      const { sampleId, name } = action.payload
      const envelopes = collectPendingEnvelopesForSample(state, sampleId)
      if (envelopes.length === 0) return
      const record: RevisionRecord = {
        id: `REV-${Date.now()}`,
        sampleId,
        name,
        createdAt: new Date().toISOString(),
        author: '当前用户',
        changes: envelopes,
      }
      state.revisions.push(record)
      const sample = state.samples.find((item) => item.id === sampleId)
      if (sample) {
        sample.annotations = sample.annotations.filter(
          (item) => !(item.origin === 'local' && item.syncedAt === null),
        )
        sample.proposals = sample.proposals.filter(
          (item) => !(item.origin === 'local' && item.syncedAt === null),
        )
      }
      state.draftRevisions[sampleId] = (state.draftRevisions[sampleId] ?? []).filter(
        (item) => !(item.origin === 'local' && item.syncedAt === null),
      )
      state.decisions = state.decisions.filter(
        (item) => !(item.sampleId === sampleId && item.origin === 'local' && item.syncedAt === null),
      )
    },
    restoreRevision(state, action: PayloadAction<{ revisionId: string }>) {
      const record = state.revisions.find((item) => item.id === action.payload.revisionId)
      if (!record || state.locked) return
      // 移除这些改动的去重记录，使另存的修订可以重新并入
      const ids = new Set(record.changes.map((envelope) => envelope.changeId))
      state.appliedChangeIds = state.appliedChangeIds.filter((id) => !ids.has(id))
      for (const envelope of record.changes) applyEnvelope(state, envelope)
      state.revisions = state.revisions.filter((item) => item.id !== record.id)
    },
    recoverDraft(state) {
      try {
        const raw = localStorage.getItem(recoveryKey)
        if (!raw) return
        const recovery = JSON.parse(raw) as { savedAt?: string; state?: Partial<DevelopmentState> }
        const parsed = recovery.state ?? {}
        state.samples = (parsed.samples ?? state.samples).map(normalizeSample)
        state.decisions = normalizeDecisions(parsed.decisions, state.samples)
        state.draftRevisions = parsed.draftRevisions ?? state.draftRevisions
        state.lockedSnapshots = parsed.lockedSnapshots ?? state.lockedSnapshots
        state.revisions = parsed.revisions ?? state.revisions
        state.appliedChangeIds = parsed.appliedChangeIds ?? state.appliedChangeIds
        state.locked = parsed.locked ?? state.locked
        state.selectedId = parsed.selectedId ?? state.selectedId
        state.roundA = parsed.roundA ?? state.roundA
        state.roundB = parsed.roundB ?? state.roundB
        state.crashRecovery = { available: false, savedAt: null }
      } catch {
        state.crashRecovery = { available: false, savedAt: null }
      }
    },
    dismissRecovery(state) {
      state.crashRecovery = { available: false, savedAt: null }
      sessionStorage.removeItem(dirtyKey)
    },
    resetToSeed(state) {
      const fresh = structuredClone(fallbackState)
      Object.assign(state, fresh)
      localStorage.removeItem(storageKey)
      localStorage.removeItem(recoveryKey)
      sessionStorage.removeItem(dirtyKey)
    },
  },
})

export const developmentActions = slice.actions

export const {
  selectSample,
  setRounds,
  addAnnotation,
  addProposal,
  saveDraft,
  decideProposal,
  lockReview,
  unlockReview,
  resolveAnnotation,
  toggleAnnotation,
  mergeChange,
  mergeChanges,
  markSynced,
  setPeerCount,
  setLastSyncedAt,
  discardPendingChanges,
  saveAsRevision,
  restoreRevision,
  recoverDraft,
  dismissRecovery,
  resetToSeed,
} = slice.actions

export const developmentReducer = slice.reducer

export const selectCurrentDraft = (state: DevelopmentState, sampleId: string): string | null =>
  currentDraftOf(state, sampleId)

export const selectPendingChanges = (state: DevelopmentState, sampleId: string): ChangeEnvelope[] =>
  collectPendingEnvelopesForSample(state, sampleId)

export const selectPendingCount = (state: DevelopmentState, sampleId: string): number =>
  collectPendingEnvelopesForSample(state, sampleId).length
