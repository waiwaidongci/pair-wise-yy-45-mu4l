import { useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material'
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline'
import CancelOutlinedIcon from '@mui/icons-material/CancelOutlined'
import AddLocationAltOutlinedIcon from '@mui/icons-material/AddLocationAltOutlined'
import PhotoCameraBackOutlinedIcon from '@mui/icons-material/PhotoCameraBackOutlined'
import CloudSyncOutlinedIcon from '@mui/icons-material/CloudSyncOutlined'
import DifferenceOutlinedIcon from '@mui/icons-material/DifferenceOutlined'
import { useAppDispatch, useAppSelector } from '../app/hooks'
import { discardPending, pendingSavedAsRevision, setEditor, setRounds, toggleAnnotation } from '../features/developmentSlice'
import { useCollab } from '../features/collab/CollabProvider'
import { changeFactory } from '../features/collab/engine'
import { effectiveData } from '../features/collab/materialize'
import type { CollabChange } from '../features/collab/types'

const rounds = ['第一轮', '第二轮', '第三轮'] as const

export function changeLabel(change: CollabChange): string {
  switch (change.type) {
    case 'annotation-add':
      return `批注 · ${change.annotation.part}`
    case 'annotation-resolve':
      return `批注状态更新 · ${change.annotationId}`
    case 'proposal-add':
      return `替代方案 · ${change.proposal.affectedPart}`
    case 'proposal-decide':
      return `方案决定 · ${change.proposalId} ${change.decision.decision}`
    case 'draft-save':
      return '评审草稿'
    case 'lock':
      return '审核锁定'
    case 'unlock':
      return '解锁修订'
    case 'save-revision':
      return '另存修订'
    default:
      return '改动'
  }
}

export default function SampleReviewPage() {
  const dispatch = useAppDispatch()
  const navigate = useNavigate()
  const state = useAppSelector((root) => root.development)
  const { identity, view, pendingForSample, queue, syncNow, appendNow } = useCollab()
  const sample = view.samples.find((item) => item.id === state.selectedId) ?? view.samples[0]
  const locked = Boolean(sample.lock)
  const { annotations, proposals, drafts } = effectiveData(sample)

  const [annotationOpen, setAnnotationOpen] = useState(false)
  const [proposalOpen, setProposalOpen] = useState(false)
  const [decisionDialog, setDecisionDialog] = useState<string | null>(null)
  const [decisionReason, setDecisionReason] = useState('')
  const [revisionOpen, setRevisionOpen] = useState(false)
  const [revisionReason, setRevisionReason] = useState('')
  const [annotationDraft, setAnnotationDraft] = useState({ x: 50, y: 42, part: '版型', content: '' })
  const [proposalDraft, setProposalDraft] = useState({ affectedPart: '肩袖', role: '版师', content: '' })
  const imageRef = useRef<HTMLDivElement>(null)

  const pending = pendingForSample(sample.id)
  const editorText = state.editors[sample.id] ?? ''

  const comparison = useMemo(() => {
    const a = sample.measurements[state.roundA]
    const b = sample.measurements[state.roundB]
    return a.map((item, index) => ({
      ...item,
      previous: item.actual,
      current: b[index].actual,
      delta: b[index].actual - item.actual,
      inTolerance: Math.abs(b[index].actual - b[index].spec) <= b[index].tolerance,
    }))
  }, [sample, state.roundA, state.roundB])

  const roundAnnotations = useMemo(
    () => annotations.filter((item) => item.round === state.roundB),
    [annotations, state.roundB],
  )

  /** 同一部位的批注分组：两份都保留，分别标注提交人、来源窗口与时间 */
  const annotationsByPart = useMemo(() => {
    const groups = new Map<string, typeof roundAnnotations>()
    for (const annotation of roundAnnotations) {
      const list = groups.get(annotation.part) ?? []
      list.push(annotation)
      groups.set(annotation.part, list)
    }
    return [...groups.entries()]
  }, [roundAnnotations])

  const handleImageClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (locked) return
    const rect = imageRef.current?.getBoundingClientRect()
    if (!rect) return
    setAnnotationDraft((current) => ({
      ...current,
      x: Math.round(((event.clientX - rect.left) / rect.width) * 100),
      y: Math.round(((event.clientY - rect.top) / rect.height) * 100),
    }))
    setAnnotationOpen(true)
  }

  const submitDecision = (decision: '已采纳' | '未采纳') => {
    if (!decisionDialog || !decisionReason.trim()) return
    queue(
      changeFactory.proposalDecide(identity, sample.id, decisionDialog, {
        decision,
        reason: decisionReason,
        decidedAt: new Date().toLocaleString('zh-CN', { hour12: false }),
      }),
    )
    setDecisionDialog(null)
    setDecisionReason('')
  }

  const saveDraft = () => {
    if (!editorText.trim()) return
    queue(changeFactory.draftSave(identity, sample.id, editorText.trim()))
    dispatch(setEditor({ sampleId: sample.id, value: '' }))
  }

  const saveAsRevision = () => {
    const source = pending
    if (!source.length || !revisionReason.trim()) return
    const revision = changeFactory.saveRevision(identity, sample.id, revisionReason.trim(), source)
    appendNow([revision])
    dispatch(pendingSavedAsRevision(source.map((item) => item.id)))
    setRevisionOpen(false)
    setRevisionReason('')
  }

  return (
    <Box className="page">
      <Box className="page-head">
        <Box>
          <Typography className="eyebrow">SAMPLE REVIEW / 样品评审</Typography>
          <Typography component="h1" fontWeight={800}>{sample.styleCode} · 轮次对比</Typography>
          <Typography color="text.secondary">
            批注、评审草稿与替代方案按提交人和时间合并；你正以「{identity.author} · {identity.windowLabel}」协作。
          </Typography>
        </Box>
        <Stack direction="row" spacing={1}>
          <Button variant="outlined" startIcon={<PhotoCameraBackOutlinedIcon />}>上传样衣照片</Button>
        </Stack>
      </Box>

      {locked && <Alert severity="success" sx={{ mb: 1.5 }}>该轮次已审核锁定，快照依据只读。解锁后才能新增批注或采纳方案。</Alert>}
      {locked && pending.length > 0 && (
        <Alert
          severity="warning"
          sx={{ mb: 1.5 }}
          action={
            <Button color="inherit" size="small" onClick={() => navigate('/history')}>去处理</Button>
          }
        >
          快照锁定后，本窗口仍有 {pending.length} 项本地改动未并入（不会改动已锁定依据，也未显示在上方只读列表中）。请到「修订历史」选择放弃或另存修订。
        </Alert>
      )}
      {!locked && roundAnnotations.some((item) => item.status === '待处理') && (
        <Alert severity="warning" sx={{ mb: 1.5 }}>
          当前仍有 {roundAnnotations.filter((item) => item.status === '待处理').length} 项待处理批注，审核锁定前必须逐项关闭。
        </Alert>
      )}

      <PendingBar
        pending={pending}
        locked={locked}
        onSync={() => syncNow()}
        onDiscard={(id) => dispatch(discardPending([id]))}
        onSaveRevision={() => setRevisionOpen(true)}
      />

      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', xl: 'minmax(0,1.15fr) minmax(340px,.85fr)' }, gap: 1.5 }}>
        <Box className="panel">
          <Box sx={{ px: 2, py: 1.4, borderBottom: '1px solid #ece9e4', display: 'flex', justifyContent: 'space-between', gap: 1, flexWrap: 'wrap' }}>
            <Typography fontWeight={800}>尺寸实测差异</Typography>
            <Stack direction="row" spacing={1}>
              <FormControl size="small" sx={{ minWidth: 110 }}>
                <InputLabel>基准轮次</InputLabel>
                <Select label="基准轮次" value={state.roundA} onChange={(event) => dispatch(setRounds({ a: event.target.value as typeof state.roundA }))}>
                  {rounds.map((round) => <MenuItem key={round} value={round}>{round}</MenuItem>)}
                </Select>
              </FormControl>
              <FormControl size="small" sx={{ minWidth: 110 }}>
                <InputLabel>对比轮次</InputLabel>
                <Select label="对比轮次" value={state.roundB} onChange={(event) => dispatch(setRounds({ b: event.target.value as typeof state.roundB }))}>
                  {rounds.map((round) => <MenuItem key={round} value={round}>{round}</MenuItem>)}
                </Select>
              </FormControl>
            </Stack>
          </Box>
          <Box sx={{ overflowX: 'auto' }}>
            <Table size="small" sx={{ minWidth: 620 }}>
              <TableHead>
                <TableRow sx={{ bgcolor: '#f6f5f2' }}>
                  <TableCell>部位</TableCell>
                  <TableCell>规格</TableCell>
                  <TableCell>±容差</TableCell>
                  <TableCell>{state.roundA}</TableCell>
                  <TableCell>{state.roundB}</TableCell>
                  <TableCell>变化</TableCell>
                  <TableCell>判定</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {comparison.map((item) => (
                  <TableRow key={item.key} sx={{ bgcolor: item.inTolerance ? 'transparent' : '#fff4ef' }}>
                    <TableCell sx={{ fontWeight: 750 }}>{item.name}</TableCell>
                    <TableCell>{item.spec} cm</TableCell>
                    <TableCell>±{item.tolerance}</TableCell>
                    <TableCell>{item.previous.toFixed(1)}</TableCell>
                    <TableCell sx={{ fontWeight: 800, color: item.inTolerance ? '#2d7665' : '#b44b2d' }}>{item.current.toFixed(1)}</TableCell>
                    <TableCell>
                      <Chip size="small" label={`${item.delta >= 0 ? '+' : ''}${item.delta.toFixed(1)}`} color={Math.abs(item.delta) > 0.5 ? 'warning' : 'default'} />
                    </TableCell>
                    <TableCell>
                      <Chip size="small" icon={item.inTolerance ? <CheckCircleOutlineIcon /> : <CancelOutlinedIcon />} label={item.inTolerance ? '达标' : '超差'} color={item.inTolerance ? 'success' : 'error'} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Box>

          {/* 评审草稿：按提交人分别保留，多窗口同时保存互不覆盖 */}
          <Box sx={{ p: 1.5, borderTop: '1px solid #ece9e4' }}>
            <Typography fontWeight={800} fontSize={13} mb={1}>轮次评审草稿（{drafts.length} 位提交人）</Typography>
            <Stack spacing={1} mb={1.2}>
              {drafts.map((draft) => {
                const mine = draft.clientId === identity.clientId
                return (
                  <Box key={draft.id} sx={{ p: 1.1, borderLeft: `3px solid ${mine ? '#2d7b72' : '#c88a3c'}`, bgcolor: '#f8f7f4', borderRadius: 1 }}>
                    <Stack direction="row" spacing={0.8} alignItems="center" flexWrap="wrap" useFlexGap>
                      <Chip size="small" label={draft.sourceWindow} color={mine ? 'success' : 'warning'} variant={mine ? 'filled' : 'outlined'} />
                      <Typography fontWeight={800} fontSize={12}>{draft.author}</Typography>
                      <Typography color="#9aa6a3" fontSize={10}>{draft.createdAt}</Typography>
                    </Stack>
                    <Typography color="text.secondary" fontSize={12} mt={0.5} sx={{ whiteSpace: 'pre-wrap' }}>{draft.content}</Typography>
                  </Box>
                )
              })}
              {drafts.length === 0 && <Typography color="text.secondary" fontSize={12}>暂无草稿，在下方撰写后保存。</Typography>}
            </Stack>
            <Stack direction="row" spacing={1} alignItems="flex-start">
              <TextField
                multiline
                minRows={2}
                fullWidth
                size="small"
                label={`${identity.windowLabel} 的评审草稿`}
                placeholder="输入评审意见，保存后按你的身份独立成条"
                value={editorText}
                disabled={locked}
                onChange={(event) => dispatch(setEditor({ sampleId: sample.id, value: event.target.value }))}
              />
              <Button variant="contained" disabled={locked || !editorText.trim()} onClick={saveDraft} sx={{ mt: 0.4 }}>保存草稿</Button>
            </Stack>
          </Box>
        </Box>

        <Box className="panel">
          <Box sx={{ px: 1.8, py: 1.4, borderBottom: '1px solid #ece9e4', display: 'flex', justifyContent: 'space-between' }}>
            <Typography fontWeight={800}>样衣部位批注 · {state.roundB}（{roundAnnotations.length} 条）</Typography>
            <Button size="small" startIcon={<AddLocationAltOutlinedIcon />} disabled={locked} onClick={() => setAnnotationOpen(true)}>添加批注</Button>
          </Box>
          <Box
            ref={imageRef}
            onClick={handleImageClick}
            sx={{
              position: 'relative',
              height: 420,
              m: 1.5,
              overflow: 'hidden',
              cursor: locked ? 'default' : 'crosshair',
              borderRadius: 1.5,
              background: 'linear-gradient(180deg,#dfe5e4 0%,#cbd4d1 100%)',
              backgroundImage: 'linear-gradient(180deg,#dce4e2 0%,#c7d2cf 100%), repeating-linear-gradient(90deg,transparent 0 39px,rgba(255,255,255,.18) 40px)',
            }}
          >
            <Box sx={{ position: 'absolute', left: '50%', top: 32, transform: 'translateX(-50%)', width: 170, height: 55, border: '3px solid #526a65', borderRadius: '50% 50% 22% 22%', bgcolor: '#657d77' }} />
            <Box sx={{ position: 'absolute', left: '50%', top: 80, transform: 'translateX(-50%)', width: 210, height: 230, border: '3px solid #526a65', borderRadius: '38px 38px 22px 22px', bgcolor: '#718983' }}>
              <Box sx={{ position: 'absolute', left: 50, top: 72, width: 110, height: 76, border: '1px dashed rgba(255,255,255,.6)', borderRadius: 2 }} />
              <Box sx={{ position: 'absolute', left: 35, top: 30, right: 35, borderTop: '2px solid rgba(255,255,255,.45)' }} />
              <Box sx={{ position: 'absolute', left: 38, top: 148, width: 34, height: 48, border: '2px solid #455c57', borderRadius: 1 }} />
              <Box sx={{ position: 'absolute', right: 38, top: 148, width: 34, height: 48, border: '2px solid #455c57', borderRadius: 1 }} />
            </Box>
            <Box sx={{ position: 'absolute', left: 50, top: 96, width: 52, height: 200, border: '3px solid #526a65', borderRadius: '25px 8px 12px 25px', bgcolor: '#657d77', transform: 'rotate(7deg)' }} />
            <Box sx={{ position: 'absolute', right: 50, top: 96, width: 52, height: 200, border: '3px solid #526a65', borderRadius: '8px 25px 25px 12px', bgcolor: '#657d77', transform: 'rotate(-7deg)' }} />
            {roundAnnotations.map((annotation) => (
              <Tooltip key={annotation.id} title={`${annotation.part}（${annotation.sourceWindow} · ${annotation.author} ${annotation.createdAt}）：${annotation.content}`}>
                <Box
                  onClick={(event) => {
                    event.stopPropagation()
                    if (locked) return
                    dispatch(toggleAnnotation(state.activeAnnotation === annotation.id ? null : annotation.id))
                  }}
                  sx={{
                    position: 'absolute',
                    left: `${annotation.x}%`,
                    top: `${annotation.y}%`,
                    width: 24,
                    height: 24,
                    display: 'grid',
                    placeItems: 'center',
                    transform: 'translate(-50%,-50%)',
                    borderRadius: '50%',
                    color: '#fff',
                    bgcolor: annotation.status === '待处理' ? '#cf6236' : '#397c69',
                    border: '3px solid rgba(255,255,255,.9)',
                    boxShadow: '0 3px 10px rgba(0,0,0,.25)',
                    fontSize: 10,
                    fontWeight: 800,
                    cursor: locked ? 'default' : 'pointer',
                  }}
                >
                  {annotation.part.slice(0, 1)}
                </Box>
              </Tooltip>
            ))}
            <Chip label={locked ? '已锁定，批注只读' : '点击样衣任意部位添加批注'} size="small" sx={{ position: 'absolute', left: 12, bottom: 12, bgcolor: 'rgba(255,255,255,.9)' }} />
          </Box>

          {/* 同一部位分组：每个窗口 / 每位提交人的批注都保留 */}
          <Stack spacing={1} sx={{ px: 1.5, pb: 1.5 }}>
            {annotationsByPart.map(([part, list]) => (
              <Box key={part} sx={{ p: 1.2, border: '1px solid #e6e2db', borderRadius: 1 }}>
                <Stack direction="row" justifyContent="space-between" alignItems="center" mb={list.length > 1 ? 0.8 : 0}>
                  <Typography fontWeight={800} fontSize={12}>{part}</Typography>
                  {list.length > 1 && <Chip size="small" color="secondary" variant="outlined" label={`${list.length} 份合并 · 均保留`} />}
                </Stack>
                <Stack spacing={0.8}>
                  {list.map((annotation) => {
                    const mine = annotation.clientId === identity.clientId
                    return (
                      <Box key={annotation.id} sx={{ borderLeft: `3px solid ${annotation.status === '待处理' ? '#cf6236' : '#397c69'}`, pl: 1 }}>
                        <Stack direction="row" spacing={0.6} alignItems="center" flexWrap="wrap" useFlexGap>
                          <Chip size="small" label={annotation.sourceWindow} color={mine ? 'success' : 'warning'} variant={mine ? 'filled' : 'outlined'} />
                          <Typography fontWeight={800} fontSize={11}>{annotation.author}</Typography>
                          <Chip size="small" label={annotation.status} color={annotation.status === '待处理' ? 'warning' : 'success'} />
                          <Typography color="#9aa6a3" fontSize={10}>{annotation.createdAt}</Typography>
                        </Stack>
                        <Typography color="text.secondary" fontSize={11} mt={0.4}>{annotation.content}</Typography>
                        {!locked && (
                          <Button
                            size="small"
                            sx={{ mt: 0.4, py: 0.2, minWidth: 0, fontSize: 11 }}
                            onClick={() => queue(changeFactory.annotationResolve(identity, sample.id, annotation.id, annotation.status === '待处理' ? '已解决' : '待处理'))}
                          >
                            {annotation.status === '待处理' ? '关闭批注' : '重新打开'}
                          </Button>
                        )}
                      </Box>
                    )
                  })}
                </Stack>
              </Box>
            ))}
            {roundAnnotations.length === 0 && <Typography color="text.secondary" fontSize={12}>{state.roundB} 暂无批注。</Typography>}
          </Stack>
        </Box>
      </Box>

      <Box className="panel" sx={{ mt: 1.5 }}>
        <Box sx={{ px: 2, py: 1.4, borderBottom: '1px solid #ece9e4', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Typography fontWeight={800}>替代修改方案与采纳决定</Typography>
          <Button size="small" startIcon={<DifferenceOutlinedIcon />} disabled={locked} onClick={() => setProposalOpen(true)}>提交替代方案</Button>
        </Box>
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(2,1fr)' }, gap: 1.5, p: 1.5 }}>
          {proposals.map((proposal) => {
            const mine = proposal.clientId === identity.clientId
            return (
              <Box key={proposal.id} sx={{ p: 1.5, border: '1px solid #e2dfda', borderRadius: 1.2 }}>
                <Stack direction="row" justifyContent="space-between" alignItems="center">
                  <Typography fontWeight={800}>{proposal.affectedPart} · {proposal.role}</Typography>
                  <Chip size="small" label={proposal.status} color={proposal.status === '已采纳' ? 'success' : proposal.status === '未采纳' ? 'default' : 'warning'} />
                </Stack>
                <Typography fontSize={13} mt={1}>{proposal.content}</Typography>
                <Stack direction="row" spacing={0.6} mt={0.7} flexWrap="wrap" useFlexGap alignItems="center">
                  <Chip size="small" label={proposal.sourceWindow} color={mine ? 'success' : 'warning'} variant={mine ? 'filled' : 'outlined'} />
                  <Typography color="text.secondary" fontSize={11}>提交人：{proposal.author} · {proposal.createdAt}</Typography>
                </Stack>
                {proposal.decision && (
                  <Box sx={{ mt: 0.8, p: 1, bgcolor: proposal.decision.decision === '已采纳' ? '#edf5f2' : '#f5f4f1', borderRadius: 1 }}>
                    <Typography fontSize={11} fontWeight={750}>
                      {proposal.decision.decision} · {proposal.decision.decidedBy} · {proposal.decision.decidedAt}
                    </Typography>
                    <Typography color="text.secondary" fontSize={11} mt={0.3}>{proposal.decision.reason}</Typography>
                  </Box>
                )}
                {proposal.status === '待决定' && (
                  <Button size="small" variant="outlined" sx={{ mt: 1.2 }} onClick={() => setDecisionDialog(proposal.id)} disabled={locked}>
                    作出决定
                  </Button>
                )}
              </Box>
            )
          })}
        </Box>
      </Box>

      <Dialog open={annotationOpen} onClose={() => setAnnotationOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>添加部位批注</DialogTitle>
        <DialogContent>
          <Stack spacing={1.5} pt={1}>
            <TextField label="详细部位" value={annotationDraft.part} onChange={(event) => setAnnotationDraft({ ...annotationDraft, part: event.target.value })} />
            <TextField multiline minRows={3} label="批注内容" value={annotationDraft.content} onChange={(event) => setAnnotationDraft({ ...annotationDraft, content: event.target.value })} />
            <Typography color="text.secondary" fontSize={12}>
              批注锚点：{annotationDraft.x}% / {annotationDraft.y}% · 轮次 {state.roundB} · 来源 {identity.windowLabel}（{identity.author}）
            </Typography>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAnnotationOpen(false)}>取消</Button>
          <Button
            variant="contained"
            disabled={!annotationDraft.part.trim() || !annotationDraft.content.trim()}
            onClick={() => {
              queue(changeFactory.annotationAdd(identity, sample.id, { ...annotationDraft, round: state.roundB }))
              setAnnotationDraft({ x: 50, y: 42, part: '版型', content: '' })
              setAnnotationOpen(false)
            }}
          >
            添加（先存本地，待同步）
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={proposalOpen} onClose={() => setProposalOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>提交替代改版方案</DialogTitle>
        <DialogContent>
          <Stack spacing={1.5} pt={1}>
            <TextField label="影响部位" value={proposalDraft.affectedPart} onChange={(event) => setProposalDraft({ ...proposalDraft, affectedPart: event.target.value })} />
            <TextField label="提交人角色" value={proposalDraft.role} onChange={(event) => setProposalDraft({ ...proposalDraft, role: event.target.value })} />
            <TextField multiline minRows={3} label="方案内容" value={proposalDraft.content} onChange={(event) => setProposalDraft({ ...proposalDraft, content: event.target.value })} />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setProposalOpen(false)}>取消</Button>
          <Button
            variant="contained"
            disabled={!proposalDraft.affectedPart.trim() || !proposalDraft.content.trim()}
            onClick={() => {
              queue(changeFactory.proposalAdd(identity, sample.id, proposalDraft))
              setProposalDraft({ affectedPart: '肩袖', role: '版师', content: '' })
              setProposalOpen(false)
            }}
          >
            提交（先存本地，待同步）
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={Boolean(decisionDialog)} onClose={() => setDecisionDialog(null)} fullWidth maxWidth="sm">
        <DialogTitle>填写采纳决定说明</DialogTitle>
        <DialogContent>
          <TextField autoFocus multiline minRows={3} fullWidth label="决定理由（必填）" value={decisionReason} onChange={(event) => setDecisionReason(event.target.value)} sx={{ mt: 1 }} />
        </DialogContent>
        <DialogActions>
          <Button color="inherit" disabled={!decisionReason.trim()} startIcon={<CancelOutlinedIcon />} onClick={() => submitDecision('未采纳')}>不采纳</Button>
          <Button variant="contained" disabled={!decisionReason.trim()} startIcon={<CheckCircleOutlineIcon />} onClick={() => submitDecision('已采纳')}>采纳方案</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={revisionOpen} onClose={() => setRevisionOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>锁定状态下另存修订</DialogTitle>
        <DialogContent>
          <Typography color="text.secondary" fontSize={13} mb={1.5}>
            轮次已锁定，{pending.length} 项本地改动不会并入只读快照，将作为独立修订挂在锁定快照上：
          </Typography>
          <Stack spacing={0.6} mb={1.5}>
            {pending.map((change) => (
              <Stack key={change.id} direction="row" spacing={1} alignItems="center">
                <Chip size="small" label={change.windowLabel} />
                <Typography fontSize={12}>{changeLabel(change)}</Typography>
              </Stack>
            ))}
          </Stack>
          <TextField multiline minRows={2} fullWidth label="修订说明（必填）" value={revisionReason} onChange={(event) => setRevisionReason(event.target.value)} />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRevisionOpen(false)}>取消</Button>
          <Button variant="contained" startIcon={<DifferenceOutlinedIcon />} disabled={!revisionReason.trim()} onClick={saveAsRevision}>
            另存为修订
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}

function PendingBar({
  pending,
  locked,
  onSync,
  onDiscard,
  onSaveRevision,
}: {
  pending: CollabChange[]
  locked: boolean
  onSync: () => void
  onDiscard: (id: string) => void
  onSaveRevision: () => void
}) {
  if (!pending.length) {
    return (
      <Alert severity="success" icon={<CloudSyncOutlinedIcon fontSize="inherit" />} sx={{ mb: 1.5 }}>
        本地改动已全部并入共享记录，与其他窗口一致。
      </Alert>
    )
  }
  return (
    <Alert
      severity={locked ? 'warning' : 'info'}
      sx={{ mb: 1.5 }}
      action={
        <Stack direction="row" spacing={0.8}>
          {locked && <Button color="inherit" size="small" startIcon={<DifferenceOutlinedIcon />} onClick={onSaveRevision}>另存修订</Button>}
          <Button color="inherit" size="small" startIcon={<CancelOutlinedIcon />} onClick={() => pending.forEach((item) => onDiscard(item.id))}>全部放弃</Button>
          {!locked && <Button variant="contained" size="small" startIcon={<CloudSyncOutlinedIcon />} onClick={onSync}>同步并入</Button>}
        </Stack>
      }
    >
      <Box>
        <Typography fontWeight={800} fontSize={13}>
          有 {pending.length} 项本地改动尚未并入（{locked ? '轮次已锁定，不能直接并入' : '其他窗口此刻看不到'}）
        </Typography>
        <Stack direction="row" spacing={0.6} mt={0.5} flexWrap="wrap" useFlexGap>
          {pending.map((change) => (
            <Chip
              key={change.id}
              size="small"
              variant="outlined"
              label={`${changeLabel(change)} · ${change.createdAt}`}
              onDelete={() => onDiscard(change.id)}
            />
          ))}
        </Stack>
      </Box>
    </Alert>
  )
}
