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
import Inventory2OutlinedIcon from '@mui/icons-material/Inventory2Outlined'
import { useAppDispatch, useAppSelector } from '../app/hooks'
import {
  discardPendingChanges,
  lockReview,
  restoreRevision,
  saveAsRevision,
  selectPendingChanges,
  unlockReview,
} from '../features/developmentSlice'
import { createChangeEnvelope } from '../app/sync'
import type { ChangeEnvelope, LockPayload } from '../api/types'

const changeTypeLabel: Record<ChangeEnvelope['type'], string> = {
  annotation: '批注',
  proposal: '替代方案',
  draft: '评审草稿',
  decision: '采纳决定',
  lock: '锁定',
  unlock: '解锁',
}

export default function HistoryPage() {
  const dispatch = useAppDispatch()
  const state = useAppSelector((root) => root.development)
  const sample = state.samples.find((item) => item.id === state.selectedId) ?? state.samples[0]
  const snapshot = state.lockedSnapshots[sample.id]

  const [confirmOpen, setConfirmOpen] = useState(false)
  const [pendingOpen, setPendingOpen] = useState(false)
  const [lockNote, setLockNote] = useState('')

  // 已同步的工作流待办会阻止锁定；本地未并入改动不阻止（锁定时单独列出处理）
  const workflowPendingAnnotations = sample.annotations.filter(
    (item) => item.status === '待处理' && !(item.origin === 'local' && item.syncedAt === null),
  ).length
  const workflowPendingProposals = sample.proposals.filter(
    (item) => item.status === '待决定' && !(item.origin === 'local' && item.syncedAt === null),
  ).length
  const canLock = workflowPendingAnnotations === 0 && workflowPendingProposals === 0

  const pendingChanges = useAppSelector((root) => selectPendingChanges(root.development, sample.id))

  const source = state.locked && snapshot ? snapshot.sample : sample
  const decisionSource = state.locked && snapshot ? snapshot.decisions : state.decisions

  const events = useMemo(
    () => [
      ...source.annotations.map((item) => ({
        date: new Date(item.createdAt).toLocaleDateString('zh-CN'),
        title: `${item.part}批注`,
        owner: item.author,
        detail: item.content,
        status: item.status,
      })),
      ...source.proposals.map((item) => ({
        date: new Date(item.createdAt).toLocaleDateString('zh-CN'),
        title: `${item.affectedPart}改版方案`,
        owner: item.author,
        detail: item.content,
        status: item.status,
      })),
      ...decisionSource.map((item) => ({
        date: new Date(item.decidedAt).toLocaleDateString('zh-CN'),
        title: `方案 ${item.proposalId} ${item.decision}`,
        owner: item.author,
        detail: item.proposalSnapshot.content || item.reason,
        status: '已记录',
      })),
      { date: '2026-09-26', title: '第三轮尺寸实测导入', owner: '苏州明裁制衣', detail: '导入 6 个部位实测值，系统发现 2 项超过容差。', status: '已同步' },
      { date: '2026-09-22', title: '第二轮试穿评审', owner: '陈曼', detail: '完成动态试穿记录，肩袖活动量改善。', status: '已归档' },
    ],
    [source, decisionSource],
  )

  const buildLockEnvelope = (note: string): ChangeEnvelope<LockPayload> =>
    createChangeEnvelope('lock', sample.id, '当前用户', { note })

  const handleLockClick = () => {
    if (pendingChanges.length > 0) setPendingOpen(true)
    else setConfirmOpen(true)
  }

  const handleDiscardAndLock = () => {
    dispatch(discardPendingChanges({ sampleId: sample.id }))
    dispatch(lockReview(buildLockEnvelope(lockNote || '确认版型与工艺资料完整，可进入下一阶段。')))
    setPendingOpen(false)
    setLockNote('')
  }

  const handleSaveRevisionAndLock = () => {
    dispatch(saveAsRevision({ sampleId: sample.id, name: `另存修订 ${new Date().toLocaleString('zh-CN')}` }))
    dispatch(lockReview(buildLockEnvelope(lockNote || '确认版型与工艺资料完整，可进入下一阶段。')))
    setPendingOpen(false)
    setLockNote('')
  }

  const handleConfirmLock = () => {
    dispatch(lockReview(buildLockEnvelope(lockNote || '确认版型与工艺资料完整，可进入下一阶段。')))
    setConfirmOpen(false)
    setLockNote('')
  }

  return (
    <Box className="page">
      <Box className="page-head">
        <Box>
          <Typography className="eyebrow">AUDIT TRAIL / 修订历史</Typography>
          <Typography component="h1" fontWeight={800}>{sample.styleCode} · 审核与锁定</Typography>
          <Typography color="text.secondary">每次尺寸调整、批注和替代方案均保留时间、责任人与决定理由；锁定后生成不可覆盖的快照。</Typography>
        </Box>
        <Stack direction="row" spacing={1}>
          <Button variant="outlined">导出修订记录</Button>
          {state.locked ? (
            <Button variant="outlined" startIcon={<LockOpenOutlinedIcon />} onClick={() => dispatch(unlockReview(createChangeEnvelope('unlock', sample.id, '当前用户', { note: '解锁修订' })))}>
              解锁修订
            </Button>
          ) : (
            <Button variant="contained" startIcon={<LockOutlineIcon />} onClick={handleLockClick} disabled={!canLock}>
              审核锁定
            </Button>
          )}
        </Stack>
      </Box>

      {!canLock && !state.locked && (
        <Alert severity="warning" sx={{ mb: 1.5 }}>
          审核前需处理 {workflowPendingAnnotations} 项待处理批注和 {workflowPendingProposals} 项待决定改版方案。
        </Alert>
      )}
      {state.locked && snapshot && (
        <Alert severity="success" sx={{ mb: 1.5 }}>
          该轮次已于 {new Date(snapshot.lockedAt).toLocaleString('zh-CN')} 由 {snapshot.lockedBy} 锁定，快照只读，保留 {snapshot.sample.annotations.length} 条批注、{snapshot.sample.proposals.length} 项方案与 {snapshot.decisions.length} 项决定的原依据。
        </Alert>
      )}
      {state.locked && !snapshot && <Alert severity="success" sx={{ mb: 1.5 }}>当前轮次已锁定，只能查看历史。解锁后将新增一个修订分支。</Alert>}

      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: 'minmax(0,1fr) 310px' }, gap: 1.5 }}>
        <Box className="panel" sx={{ p: 2 }}>
          <Stack direction="row" spacing={1} alignItems="center" mb={2}>
            <HistoryOutlinedIcon color="primary" />
            <Typography fontWeight={800}>完整审计时间线</Typography>
          </Stack>
          <Box>
            {events.map((event, index) => (
              <Box key={`${event.title}-${index}`} sx={{ display: 'grid', gridTemplateColumns: '92px 24px 1fr', gap: 1 }}>
                <Typography color="text.secondary" fontSize={11} pt={0.6}>{event.date}</Typography>
                <Box sx={{ position: 'relative', '&:before': { content: '""', position: 'absolute', left: 8, top: 8, bottom: -8, width: 1, bgcolor: '#d5ddd9' }, '&:after': { content: '""', position: 'absolute', left: 4, top: 7, width: 7, height: 7, bgcolor: '#25756d', border: '2px solid #fff', borderRadius: '50%', boxShadow: '0 0 0 1px #25756d' } }} />
                <Box sx={{ pb: 2.2 }}>
                  <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
                    <Typography fontWeight={800} fontSize={13}>{event.title}</Typography>
                    <Chip size="small" label={event.status} />
                  </Stack>
                  <Typography color="text.secondary" fontSize={12} mt={0.5}>{event.detail}</Typography>
                  <Typography color="#8a918d" fontSize={10} mt={0.5}>操作者：{event.owner}</Typography>
                </Box>
              </Box>
            ))}
          </Box>
        </Box>

        <Box className="panel" sx={{ alignSelf: 'start' }}>
          <Box sx={{ p: 1.6, borderBottom: '1px solid #ece9e4' }}>
            <Typography fontWeight={800}>轮次摘要</Typography>
          </Box>
          <Stack spacing={1.5} p={1.6}>
            {(['第一轮', '第二轮', '第三轮'] as const).map((round, index) => (
              <Box key={round} sx={{ p: 1.3, border: '1px solid #e4e1dc', borderRadius: 1, bgcolor: round === state.roundB ? '#edf5f2' : '#fff' }}>
                <Stack direction="row" justifyContent="space-between">
                  <Typography fontWeight={800} fontSize={13}>{round}</Typography>
                  <Chip size="small" label={index === 2 ? sample.status : '已归档'} />
                </Stack>
                <Typography color="text.secondary" fontSize={11} mt={0.8}>
                  {sample.measurements[round].length} 项实测 · {index === 2 ? source.annotations.length : index + 2} 条评审记录
                </Typography>
              </Box>
            ))}
          </Stack>
        </Box>
      </Box>

      {state.revisions.length > 0 && (
        <Box className="panel" sx={{ mt: 1.5 }}>
          <Box sx={{ px: 2, py: 1.4, borderBottom: '1px solid #ece9e4', display: 'flex', alignItems: 'center', gap: 1 }}>
            <Inventory2OutlinedIcon color="primary" />
            <Typography fontWeight={800}>另存修订</Typography>
          </Box>
          <Stack spacing={1} sx={{ p: 1.5 }}>
            {state.revisions.map((revision) => (
              <Box key={revision.id} sx={{ p: 1.3, border: '1px dashed #d8d3cc', borderRadius: 1.2 }}>
                <Stack direction="row" justifyContent="space-between" alignItems="center" gap={1}>
                  <Box>
                    <Typography fontWeight={800} fontSize={13}>{revision.name}</Typography>
                    <Typography color="text.secondary" fontSize={11} mt={0.3}>
                      {revision.author} · {new Date(revision.createdAt).toLocaleString('zh-CN')} · {revision.changes.length} 项改动
                    </Typography>
                  </Box>
                  <Button size="small" variant="outlined" disabled={state.locked} onClick={() => dispatch(restoreRevision({ revisionId: revision.id }))}>
                    恢复修订
                  </Button>
                </Stack>
              </Box>
            ))}
          </Stack>
        </Box>
      )}

      {/* 无本地未并入改动时的确认锁定 */}
      <Dialog open={confirmOpen} onClose={() => setConfirmOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>确认锁定 {state.roundB}</DialogTitle>
        <DialogContent>
          <Typography color="text.secondary" mb={1.5}>锁定后本轮尺寸、批注和采纳方案将变为只读，并生成不可覆盖的审核快照。</Typography>
          <TextField
            fullWidth
            label="锁定说明"
            value={lockNote}
            onChange={(event) => setLockNote(event.target.value)}
            placeholder={`确认 ${state.roundB} 版型与工艺资料完整，可进入下一阶段。`}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmOpen(false)}>取消</Button>
          <Button variant="contained" onClick={handleConfirmLock}>确认锁定</Button>
        </DialogActions>
      </Dialog>

      {/* 有本地未并入改动时：先列出，放弃或另存修订 */}
      <Dialog open={pendingOpen} onClose={() => setPendingOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>有本地改动尚未并入</DialogTitle>
        <DialogContent>
          <Typography color="text.secondary" mb={1.5}>
            以下 {pendingChanges.length} 项本地改动尚未并入共享版本。锁定快照不会包含它们，你可以放弃，或另存为独立修订稍后再处理。
          </Typography>
          <Stack spacing={1}>
            {pendingChanges.map((change) => (
              <Box key={change.changeId} sx={{ p: 1.1, border: '1px solid #e4e1dc', borderRadius: 1 }}>
                <Stack direction="row" justifyContent="space-between" alignItems="center">
                  <Typography fontWeight={800} fontSize={12}>
                    {changeTypeLabel[change.type]} · {change.author}
                  </Typography>
                  <Typography color="#a09a94" fontSize={10}>{new Date(change.createdAt).toLocaleString('zh-CN')}</Typography>
                </Stack>
                <Typography color="text.secondary" fontSize={11} mt={0.3}>
                  {change.type === 'annotation' && `部位 ${(change.payload as { part: string }).part}：${(change.payload as { content: string }).content}`}
                  {change.type === 'proposal' && `${(change.payload as { affectedPart: string }).affectedPart}：${(change.payload as { content: string }).content}`}
                  {change.type === 'draft' && (change.payload as { content: string }).content}
                  {change.type === 'decision' && `方案 ${(change.payload as { proposalId: string }).proposalId} ${(change.payload as { decision: string }).decision}`}
                </Typography>
              </Box>
            ))}
          </Stack>
          <TextField
            fullWidth
            sx={{ mt: 1.5 }}
            label="锁定说明"
            value={lockNote}
            onChange={(event) => setLockNote(event.target.value)}
            placeholder={`确认 ${state.roundB} 版型与工艺资料完整，可进入下一阶段。`}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPendingOpen(false)}>取消</Button>
          <Button color="inherit" onClick={handleDiscardAndLock}>放弃改动并锁定</Button>
          <Button variant="contained" onClick={handleSaveRevisionAndLock}>另存修订并锁定</Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}
