/* 协作核心逻辑验证：内存版 localStorage，模拟两个窗口各自追加日志 */
const mem = new Map<string, string>()
const g = globalThis as unknown as {
  localStorage: Storage
  sessionStorage: Storage
  structuredClone: (v: unknown) => unknown
}
class MemStorage implements Storage {
  get length() { return mem.size }
  clear() { mem.clear() }
  getItem(key: string) { return mem.has(key) ? mem.get(key)! : null }
  key(index: number) { return [...mem.keys()][index] ?? null }
  removeItem(key: string) { mem.delete(key) }
  setItem(key: string, value: string) { mem.set(key, String(value)) }
}
g.localStorage = new MemStorage()
g.sessionStorage = new MemStorage()
g.structuredClone = (v: unknown) => (v === undefined ? v : JSON.parse(JSON.stringify(v)))

import { collabStorage } from '../src/features/collab/storage'
import { materialize } from '../src/features/collab/materialize'
import type { Identity } from '../src/features/collab/identity'
import { changeFactory, collabEngine } from '../src/features/collab/engine'
import type { CollabChange } from '../src/features/collab/types'

let failures = 0
const check = (name: string, cond: boolean, detail = '') => {
  if (cond) console.log(`  ✓ ${name}`)
  else {
    failures += 1
    console.error(`  ✗ ${name} ${detail}`)
  }
}

const winA: Identity = { clientId: 'a', windowLabel: '窗口 A', author: '陈曼' }
const winB: Identity = { clientId: 'b', windowLabel: '窗口 B', author: '周研' }
const SAMPLE = 'SMP-26018'

// ---- 场景 1：两个窗口同时为同一部位「领口」提交批注 ----
{
  console.log('场景 1：同部位两份批注按提交人/时间合并，来源都保留')
  const a1 = changeFactory.annotationAdd(winA, SAMPLE, { x: 10, y: 10, part: '领口', content: 'A：领尖外翘', round: '第三轮' })
  const a2 = changeFactory.annotationAdd(winB, SAMPLE, { x: 12, y: 11, part: '领口', content: 'B：领底衬要加', round: '第三轮' })
  collabStorage.appendLog('a', [a1])
  collabStorage.appendLog('b', [a2])
  const all = collabStorage.collectAllChanges()
  const view = materialize(all)
  const sample = view.samples.find((s) => s.id === SAMPLE)!
  const collar = sample.annotations.filter((x) => x.part === '领口')
  check('领口存在两份批注', collar.length === 2, `实际 ${collar.length}`)
  check('来源分别是窗口 A / 窗口 B', collar.some((x) => x.sourceWindow === '窗口 A' && x.author === '陈曼') && collar.some((x) => x.sourceWindow === '窗口 B' && x.author === '周研'))
  check('按时间升序排列', collar[0].timestamp <= collar[1].timestamp)
}

// ---- 场景 2：重复同步只算一次 ----
{
  console.log('场景 2：重复同步（同一 change id 重放）幂等')
  const before = materialize(collabStorage.collectAllChanges())
  const dup = before.samples[0].annotations.length
  // 模拟崩溃重试：A 把自己日志整包再追加一遍
  collabStorage.appendLog('a', collabStorage.readLog('a'))
  const view = materialize(collabStorage.collectAllChanges())
  check('批注数不因重复追加而增加', view.samples[0].annotations.length === dup, `实际 ${view.samples[0].annotations.length}`)
}

// ---- 场景 3：评审草稿按提交人各留一份 ----
{
  console.log('场景 3：评审草稿两份都保留')
  const d1 = changeFactory.draftSave(winA, SAMPLE, 'A 的草稿')
  const d2 = changeFactory.draftSave(winB, SAMPLE, 'B 的草稿')
  collabStorage.appendLog('a', [d1])
  collabStorage.appendLog('b', [d2])
  const view = materialize(collabStorage.collectAllChanges())
  const drafts = view.samples[0].draftEntries
  check('两份草稿均在', drafts.length >= 2 && drafts.some((d) => d.content === 'A 的草稿') && drafts.some((d) => d.content === 'B 的草稿'))
}

// ---- 场景 4：锁定后已采纳方案不被后续提交改动，快照不可变 ----
{
  console.log('场景 4：锁定快照与已采纳方案保持原依据')
  // 先处理掉待处理批注 + 待决定方案（新的一轮场景，独立构造）
  const changes: CollabChange[] = []
  const ann = changeFactory.annotationAdd(winA, SAMPLE, { x: 1, y: 1, part: '袖口', content: '偏移', round: '第三轮' })
  changes.push(ann)
  changes.push(changeFactory.annotationResolve(winA, SAMPLE, ann.annotation.id, '已解决'))
  const prop = changeFactory.proposalAdd(winB, SAMPLE, { role: '版师', content: '肩线内收', affectedPart: '肩袖' })
  changes.push(prop)
  changes.push(changeFactory.proposalDecide(winA, SAMPLE, prop.proposal.id, { decision: '已采纳', reason: '采纳依据 X', decidedAt: 't1' }))
  changes.push(changeFactory.lock(winA, SAMPLE, '第三轮', '锁定说明'))
  // 锁定之后：有人试图翻案、追加批注、加方案、再加锁
  changes.push(changeFactory.proposalDecide(winB, SAMPLE, prop.proposal.id, { decision: '未采纳', reason: '想推翻', decidedAt: 't2' }))
  changes.push(changeFactory.annotationAdd(winB, SAMPLE, { x: 2, y: 2, part: '袖口', content: '锁定后批注', round: '第三轮' }))
  changes.push(changeFactory.proposalAdd(winB, SAMPLE, { role: '供应商', content: '锁后方案', affectedPart: '袖口' }))
  changes.push(changeFactory.lock(winB, SAMPLE, '第三轮', '二次锁定'))

  const view = materialize(changes)
  const sample = view.samples.find((s) => s.id === SAMPLE)!
  check('生成了锁定快照', sample.lock !== null)
  const frozen = sample.lock!.proposals.find((p) => p.id === prop.proposal.id)
  check('快照里方案保持「已采纳」', frozen?.status === '已采纳')
  check('采纳理由仍是最初依据 X', frozen?.decision?.reason === '采纳依据 X')
  check('第二次 lock 未覆盖锁定人 / 时间', sample.lock!.lockedBy === '陈曼' && sample.lock!.note === '锁定说明')
  check('锁后批注未进入快照', !sample.lock!.annotations.some((a) => a.content === '锁定后批注'))
  check('锁后方案未进入快照', !sample.lock!.proposals.some((p) => p.content === '锁后方案'))
  check('锁后 resolve 对快照只读', sample.lock!.annotations.every((a) => a.status === '已解决' || a.status === '待处理'))
}

// ---- 场景 5：锁定后未并入的本地改动可另存修订，不影响快照 ----
{
  console.log('场景 5：另存修订挂在快照上，快照依据不变')
  const base: CollabChange[] = []
  const ann = changeFactory.annotationAdd(winA, SAMPLE, { x: 3, y: 3, part: '腰节', content: '基础批注', round: '第三轮' })
  base.push(ann)
  base.push(changeFactory.annotationResolve(winA, SAMPLE, ann.annotation.id, '已解决'))
  base.push(changeFactory.lock(winA, SAMPLE, '第三轮', '先锁'))

  // 窗口 B 本地有两条未并入改动，锁定后选择另存修订
  const localAnn = changeFactory.annotationAdd(winB, SAMPLE, { x: 4, y: 4, part: '腰节', content: 'B 锁后新批注', round: '第三轮' })
  const localDraft = changeFactory.draftSave(winB, SAMPLE, 'B 的修订草稿')
  const revision = changeFactory.saveRevision(winB, SAMPLE, '补充腰节意见', [localAnn, localDraft])
  base.push(revision)

  const view = materialize(base)
  const sample = view.samples.find((s) => s.id === SAMPLE)!
  check('快照上挂了 1 份另存修订', sample.lock!.savedRevisions.length === 1)
  check('修订带来源窗口 B', sample.lock!.savedRevisions[0].sourceWindow === '窗口 B')
  check('修订内含 1 批注 1 草稿', sample.lock!.savedRevisions[0].annotations.length === 1 && sample.lock!.savedRevisions[0].drafts.length === 1)
  check('快照原批注数不被修订改动', sample.lock!.annotations.length === 1)
}

// ---- 场景 6：第一个决定先生效（同一待决定方案，并发决定只取一次） ----
{
  console.log('场景 6：并发采纳/否决只生效第一个决定')
  const prop = changeFactory.proposalAdd(winA, SAMPLE, { role: '版师', content: '方案 P', affectedPart: '门襟' })
  const dAdopt = changeFactory.proposalDecide(winA, SAMPLE, prop.proposal.id, { decision: '已采纳', reason: 'A 先采纳', decidedAt: 't1' })
  const dReject = changeFactory.proposalDecide(winB, SAMPLE, prop.proposal.id, { decision: '未采纳', reason: 'B 后否决', decidedAt: 't2' })
  const view = materialize([prop, dAdopt, dReject])
  const p = view.samples[0].proposals.find((x) => x.id === prop.proposal.id)!
  check('方案保持先到的「已采纳」', p.status === '已采纳' && p.decision?.reason === 'A 先采纳')
}

// ---- 场景 7：检查点崩溃检测 / 恢复 / 重复同步幂等 ----
{
  console.log('场景 7：崩溃检查点可被扫描恢复，重复同步只算一次')
  mem.clear()
  const winC: Identity = { clientId: 'c', windowLabel: '窗口 C', author: '顾恺' }
  const local = changeFactory.annotationAdd(winC, SAMPLE, { x: 5, y: 5, part: '门襟', content: '未同步的本地批注', round: '第三轮' })
  collabEngine.writeCheckpoint(winC, { pending: [local], editors: { [SAMPLE]: '输入到一半' }, cleanExit: false })
  // 无心跳 → 视为崩溃
  const scan = collabEngine.scanSessions('self-x')
  check('扫描到 1 个崩溃窗口', scan.crashed.length === 1)
  check('崩溃窗口是 C', scan.crashed[0].cp.clientId === 'c')
  check('检查点保留未同步提交与输入文本', scan.crashed[0].cp.pending.length === 1 && scan.crashed[0].cp.editors[SAMPLE] === '输入到一半')

  // 恢复时同步进日志，再模拟「重复同步」整包重放
  const firstAll = collabEngine.syncPending(winC, scan.crashed[0].cp.pending)
  collabEngine.syncPending(winC, scan.crashed[0].cp.pending) // 第二次（用户重复点 / 重试）
  collabStorage.appendLog(winC.clientId, scan.crashed[0].cp.pending) // 日志层重复追加
  const view = materialize(collabEngine.collectAll())
  const count = view.samples[0].annotations.filter((a) => a.content === '未同步的本地批注').length
  check('重复同步后批注仍只有 1 条', count === 1, `实际 ${count}`)
  check('syncPending 返回的全集长度稳定', firstAll.length === collabEngine.collectAll().length)

  collabEngine.clearSession('c')
  check('恢复处理完后检查点已清理', collabStorage.readCheckpoint('c') === null)
}

console.log(failures === 0 ? '\n全部通过 ✅' : `\n${failures} 项失败 ❌`)
process.exit(failures === 0 ? 0 : 1)
