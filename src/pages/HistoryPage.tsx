import { useMemo, useState } from 'react'
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
  TextField,
  Typography,
} from '@mui/material'
import LockOutlineIcon from '@mui/icons-material/LockOutlined'
import LockOpenOutlinedIcon from '@mui/icons-material/LockOpenOutlined'
import HistoryOutlinedIcon from '@mui/icons-material/HistoryOutlined'
import DifferenceOutlinedIcon from '@mui/icons-material/DifferenceOutlined'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline'
import { useAppDispatch, useAppSelector } from '../app/hooks'
import { discardPending, pendingSavedAsRevision } from '../features/developmentSlice'
import { useCollab } from '../features/collab/CollabProvider'
import { changeFactory, collabEngine } from '../features/collab/engine'
import { effectiveData, materialize as materializeNow } from '../features/collab/materialize'
import { changeLabel } from './SampleReviewPage'

export default function HistoryPage() {
  const dispatch = useAppDispatch()
  const state = useAppSelector((root) => root.development)
  const { identity, view, pendingForSample, appendNow } = useCollab()
  const sample = view.samples.find((item) => item.id === state.selectedId) ?? view.samples[0]
  const locked = Boolean(sample.lock)
  const { annotations, proposals } = effectiveData(sample)
  const pending = pendingForSample(sample.id)

  const [mode, setMode] = useState<'none' | 'lock' | 'revision'>('none')
  const [lockNote, setLockNote] = useState('')
  const [revisionReason, setRevisionReason] = useState('')
  const [lockRejected, setLockRejected] = useState(false)

  // 锁定校验覆盖全部轮次，与归并层 lock 守卫口径一致
  const pendingAnnotations = (locked ? annotations : sample.annotations).filter((item) => item.status === '待处理').length
  const pendingProposals = (locked ? proposals : sample.proposals).filter((item) => item.status === '待决定').length
  const canLock = pendingAnnotations === 0 && pendingProposals === 0

  /** 审计时间线：批注 / 方案 / 草稿 / 本地待并入改动统一按时间排列，均带来源窗口 */
  const events = useMemo(() => {
    const list: Array<{ timestamp: number; date: string; title: string; owner: string; source: string; detail: string; status: string }> = []
    for (const annotation of annotations) {
      list.push({
        timestamp: annotation.timestamp,
        date: annotation.createdAt,
        title: `${annotation.round} · ${annotation.part}批注`,
        owner: annotation.author,
        source: annotation.sourceWindow,
        detail: annotation.content,
        status: annotation.status,
      })
    }
    for (const proposal of proposals) {
      list.push({
        timestamp: proposal.timestamp,
        date: proposal.createdAt,
        title: `${proposal.affectedPart}改版方案`,
        owner: proposal.author,
        source: proposal.sourceWindow,
        detail: proposal.content,
        status: proposal.status,
      })
    }
    for (const change of pending) {
      list.push({
        timestamp: change.timestamp,
        date: change.createdAt,
        title: `【本地未并入】${changeLabel(change)}`,
        owner: change.author,
        source: change.windowLabel,
        detail: change.type === 'annotation-add' ? change.annotation.content : change.type === 'proposal-add' ? change.proposal.content : change.type === 'draft-save' ? change.entry.content : '等待同步后写入审计记录',
        status: '未并入',
      })
    }
    if (sample.lock) {
      list.push({
        timestamp: sample.lock.timestamp,
        date: sample.lock.lockedAt,
        title: `${sample.lock.round}审核锁定（不可变快照）`,
        owner: sample.lock.lockedBy,
        source: '审核锁定',
        detail: sample.lock.note,
        status: '已锁定',
      })
    }
    return list.sort((a, b) => a.timestamp - b.timestamp)
  }, [annotations, proposals, pending, sample.lock])

  const closeAll = () => {
    setMode('none')
    setLockRejected(false)
  }

  /** 锁定提交直接落共享日志；若归并层因仍有待办而拒绝（例如被其他窗口抢先），给出提示 */
  const submitLock = (note: string): boolean => {
    const lock = changeFactory.lock(identity, sample.id, state.roundB, note)
    appendNow([lock])
    const after = materializeNow(collabEngine.collectAll()).samples.find((item) => item.id === sample.id)
    if (after?.lock && after.lock.timestamp === lock.timestamp) return true
    setLockRejected(true)
    return false
  }

  /** 确认锁定：本地干净 → 直接锁；有未并入改动 → 切到「先决定」视图 */
  const startLock = () => {
    setLockNote(`确认 ${state.roundB} 版型与工艺资料完整，可进入下一阶段。`)
    setLockRejected(false)
    setMode(pending.length ? 'revision' : 'lock')
  }

  const doLock = () => {
    if (submitLock(lockNote.trim() || '审核锁定')) closeAll()
  }

  const doUnlock = () => {
    appendNow([changeFactory.unlock(identity, sample.id)])
  }

  const discardAllThenLock = () => {
    dispatch(discardPending(pending.map((item) => item.id)))
    if (submitLock(lockNote.trim() || '审核锁定（放弃本地未并入改动）')) closeAll()
  }

  const saveRevisionThenLock = () => {
    if (!revisionReason.trim()) return
    const revision = changeFactory.saveRevision(identity, sample.id, revisionReason.trim(), pending)
    appendNow([revision])
    dispatch(pendingSavedAsRevision(pending.map((item) => item.id)))
    if (submitLock(lockNote.trim() || '审核锁定（本地改动另存修订）')) {
      setRevisionReason('')
      closeAll()
    }
  }

  /** 已锁定后才发现本地改动：只允许放弃或另存，不能进快照 */
  const saveRevisionOnly = () => {
    if (!revisionReason.trim()) return
    const revision = changeFactory.saveRevision(identity, sample.id, revisionReason.trim(), pending)
    appendNow([revision])
    dispatch(pendingSavedAsRevision(pending.map((item) => item.id)))
    setRevisionReason('')
    closeAll()
  }

  return (
    <Box className="page">
      <Box className="page-head">
        <Box>
          <Typography className="eyebrow">AUDIT TRAIL / 修订历史</Typography>
          <Typography component="h1" fontWeight={800}>{sample.styleCode} · 审核与锁定</Typography>
          <Typography color="text.secondary">每次尺寸调整、批注和替代方案均保留时间、责任人、来源窗口与决定理由。</Typography>
        </Box>
        <Stack direction="row" spacing={1}>
          <Button variant="outlined">导出修订记录</Button>
          {locked ? (
            <Button variant="outlined" startIcon={<LockOpenOutlinedIcon />} onClick={doUnlock}>解锁开新修订分支</Button>
          ) : (
            <Button variant="contained" startIcon={<LockOutlineIcon />} onClick={startLock} disabled={!canLock}>审核锁定</Button>
          )}
        </Stack>
      </Box>

      {!canLock && !locked && (
        <Alert severity="warning" sx={{ mb: 1.5 }}>
          审核前需处理 {pendingAnnotations} 项待处理批注和 {pendingProposals} 项待决定改版方案。
        </Alert>
      )}

      {locked && (
        <Alert severity="success" sx={{ mb: 1.5 }}>
          {sample.lock!.round}已于 {sample.lock!.lockedAt} 由 {sample.lock!.lockedBy} 锁定，快照只读；已采纳方案保持原依据不变。解锁后将新增一个修订分支。
        </Alert>
      )}

      {locked && pending.length > 0 && (
        <Alert
          severity="warning"
          sx={{ mb: 1.5 }}
          action={
            <Stack direction="row" spacing={0.8}>
              <Button color="inherit" size="small" startIcon={<DeleteOutlineIcon />} onClick={() => dispatch(discardPending(pending.map((item) => item.id)))}>放弃</Button>
              <Button variant="contained" size="small" startIcon={<DifferenceOutlinedIcon />} onClick={() => { setRevisionReason(''); setMode('revision') }}>
                另存修订
              </Button>
            </Stack>
          }
        >
          快照锁定后本窗口仍有 {pending.length} 项本地改动未并入。它们不会改动锁定依据，请选择放弃或另存为快照上的修订。
        </Alert>
      )}

      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: 'minmax(0,1fr) 310px' }, gap: 1.5 }}>
        <Box className="panel" sx={{ p: 2 }}>
          <Stack direction="row" spacing={1} alignItems="center" mb={2}>
            <HistoryOutlinedIcon color="primary" />
            <Typography fontWeight={800}>完整审计时间线（按提交时间合并）</Typography>
          </Stack>
          <Box>
            {events.map((event, index) => (
              <Box key={`${event.title}-${index}`} sx={{ display: 'grid', gridTemplateColumns: { xs: '110px 24px 1fr', sm: '150px 24px 1fr' }, gap: 1 }}>
                <Typography color="text.secondary" fontSize={11} pt={0.6}>{event.date}</Typography>
                <Box sx={{ position: 'relative', '&:before': { content: '""', position: 'absolute', left: 8, top: 8, bottom: -8, width: 1, bgcolor: '#d5ddd9' }, '&:after': { content: '""', position: 'absolute', left: 4, top: 7, width: 7, height: 7, bgcolor: '#25756d', border: '2px solid #fff', borderRadius: '50%', boxShadow: '0 0 0 1px #25756d' } }} />
                <Box sx={{ pb: 2.2 }}>
                  <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                    <Typography fontWeight={800} fontSize={13}>{event.title}</Typography>
                    <Chip size="small" label={event.source} color={event.status === '未并入' ? 'warning' : 'default'} variant={event.status === '未并入' ? 'outlined' : 'filled'} />
                    <Chip size="small" label={event.status} color={event.status === '已锁定' ? 'success' : event.status === '未并入' ? 'warning' : 'default'} />
                  </Stack>
                  <Typography color="text.secondary" fontSize={12} mt={0.5}>{event.detail}</Typography>
                  <Typography color="#8a918d" fontSize={10} mt={0.5}>操作者：{event.owner}</Typography>
                </Box>
              </Box>
            ))}
          </Box>
        </Box>

        <Stack spacing={1.5}>
          <Box className="panel" sx={{ alignSelf: 'start' }}>
            <Box sx={{ p: 1.6, borderBottom: '1px solid #ece9e4' }}>
              <Typography fontWeight={800}>锁定快照依据</Typography>
            </Box>
            <Stack spacing={1.2} p={1.6}>
              {(['第一轮', '第二轮', '第三轮'] as const).map((round) => {
                const isSnapshot = sample.lock?.round === round
                return (
                  <Box key={round} sx={{ p: 1.3, border: '1px solid #e4e1dc', borderRadius: 1, bgcolor: isSnapshot ? '#edf5f2' : '#fff' }}>
                    <Stack direction="row" justifyContent="space-between">
                      <Typography fontWeight={800} fontSize={13}>{round}</Typography>
                      <Chip size="small" label={isSnapshot ? '已锁定快照' : '已归档'} />
                    </Stack>
                    <Typography color="text.secondary" fontSize={11} mt={0.8}>
                      {sample.measurements[round].length} 项实测
                      {isSnapshot ? ` · ${annotations.length} 条批注 · ${proposals.length} 个方案` : ''}
                    </Typography>
                  </Box>
                )
              })}
            </Stack>
          </Box>

          {sample.lock && sample.lock.savedRevisions.length > 0 && (
            <Box className="panel" sx={{ alignSelf: 'start' }}>
              <Box sx={{ p: 1.6, borderBottom: '1px solid #ece9e4' }}>
                <Typography fontWeight={800}>锁定后另存修订（{sample.lock.savedRevisions.length}）</Typography>
              </Box>
              <Stack spacing={1.2} p={1.6}>
                {sample.lock.savedRevisions.map((revision) => (
                  <Box key={revision.id} sx={{ p: 1.3, border: '1px dashed #c88a3c', borderRadius: 1 }}>
                    <Stack direction="row" spacing={0.6} alignItems="center" flexWrap="wrap" useFlexGap>
                      <Chip size="small" icon={<DifferenceOutlinedIcon />} label={revision.sourceWindow} color="warning" />
                      <Typography fontWeight={800} fontSize={12}>{revision.author}</Typography>
                      <Typography color="#9aa6a3" fontSize={10}>{revision.createdAt}</Typography>
                    </Stack>
                    <Typography fontSize={12} mt={0.6}>{revision.reason}</Typography>
                    <Typography color="text.secondary" fontSize={11} mt={0.5}>
                      {revision.annotations.length} 条批注 · {revision.proposals.length} 个方案 · {revision.drafts.length} 段草稿（不影响快照原依据）
                    </Typography>
                  </Box>
                ))}
              </Stack>
            </Box>
          )}
        </Stack>
      </Box>

      {/* 锁定确认（无本地未并入改动） */}
      <Dialog open={mode === 'lock'} onClose={closeAll} fullWidth maxWidth="sm">
        <DialogTitle>确认锁定 {state.roundB}</DialogTitle>
        <DialogContent>
          {lockRejected && (
            <Alert severity="error" sx={{ mb: 1.5 }}>
              锁定未生效：合并后仍存在待处理批注或待决定方案（可能是其他窗口刚同步了新内容）。请处理后再锁定。
            </Alert>
          )}
          <Typography color="text.secondary" mb={1.5}>锁定后本轮尺寸、批注和采纳方案将变为只读，并生成不可覆盖的审核快照。</Typography>
          <TextField fullWidth multiline minRows={2} label="锁定说明" value={lockNote} onChange={(event) => setLockNote(event.target.value)} />
        </DialogContent>
        <DialogActions>
          <Button onClick={closeAll}>取消</Button>
          <Button variant="contained" onClick={doLock}>确认锁定</Button>
        </DialogActions>
      </Dialog>

      {/* 锁定前 / 锁定后：本地改动处置，必须先列出来由人决定 */}
      <Dialog open={mode === 'revision'} onClose={closeAll} fullWidth maxWidth="sm">
        <DialogTitle>
          {locked ? '本地改动未并入（快照已锁定）' : `锁定 ${state.roundB} 前先决定本地改动`}
        </DialogTitle>
        <DialogContent>
          {lockRejected && (
            <Alert severity="error" sx={{ mb: 1.5 }}>
              锁定未生效：合并后仍存在待处理批注或待决定方案（可能是其他窗口刚同步了新内容）。修订已另存，请先处理待办再锁定。
            </Alert>
          )}
          <Typography color="text.secondary" fontSize={13} mb={1.5}>
            以下 {pending.length} 项来自 {identity.windowLabel} 的改动尚未并入共享记录。
            {locked ? '锁定快照不可修改，改动只能放弃或另存为修订。' : '请先逐条核对，再决定放弃还是另存修订后锁定。'}
          </Typography>
          <Stack spacing={0.8} mb={2} maxHeight={220} overflow="auto">
            {pending.map((change) => (
              <Box key={change.id} sx={{ display: 'flex', gap: 1, alignItems: 'center', p: 0.8, bgcolor: '#f8f7f4', borderRadius: 1 }}>
                <Chip size="small" label={change.windowLabel} />
                <Box sx={{ minWidth: 0 }}>
                  <Typography fontSize={12} fontWeight={750}>{changeLabel(change)}</Typography>
                  <Typography fontSize={11} color="text.secondary" noWrap>
                    {change.type === 'annotation-add' ? change.annotation.content : change.type === 'proposal-add' ? change.proposal.content : change.type === 'draft-save' ? change.entry.content : change.type === 'proposal-decide' ? change.decision.reason : ''}
                  </Typography>
                </Box>
              </Box>
            ))}
          </Stack>
          <TextField fullWidth multiline minRows={2} label={locked ? '修订说明（必填）' : '另存修订说明（必填，选择另存时使用）'} value={revisionReason} onChange={(event) => setRevisionReason(event.target.value)} />
        </DialogContent>
        <DialogActions sx={{ flexWrap: 'wrap' }}>
          <Button onClick={closeAll}>取消</Button>
          <Button color="inherit" startIcon={<DeleteOutlineIcon />} onClick={locked ? () => { dispatch(discardPending(pending.map((item) => item.id))); closeAll() } : discardAllThenLock}>
            放弃改动{locked ? '' : '并锁定'}
          </Button>
          <Button
            variant="contained"
            color="secondary"
            startIcon={<DifferenceOutlinedIcon />}
            disabled={!revisionReason.trim()}
            onClick={locked ? saveRevisionOnly : saveRevisionThenLock}
          >
            另存修订{locked ? '' : '后锁定'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}
