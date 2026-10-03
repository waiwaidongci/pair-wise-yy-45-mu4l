import { useEffect, useState } from 'react'
import { Button, Dialog, DialogActions, DialogContent, DialogTitle, Typography } from '@mui/material'
import { useAppDispatch, useAppSelector } from './hooks'
import { dismissRecovery, recoverDraft } from '../features/developmentSlice'
import { setupChannel } from './sync'
import { store } from './store'

const dirtyKey = 'garment-sampling-dirty-v1'

/**
 * 负责跨窗口协同通道、崩溃恢复标记与恢复提示。
 * 挂载时写入 dirty 标记，正常退出（beforeunload）时清除；
 * 若页面崩溃，标记残留，下次进入即提示恢复最近完整草稿。
 */
export default function SyncManager({ children }: { children: React.ReactNode }) {
  const dispatch = useAppDispatch()
  const crashRecovery = useAppSelector((state) => state.development.crashRecovery)
  const [recoveryOpen, setRecoveryOpen] = useState(false)

  useEffect(() => {
    // 用 sessionStorage 区分“同一标签页崩溃后重载”与“新开标签页”：
    // 崩溃后重载同一标签页，标记残留；新开标签页 sessionStorage 为空，不误报。
    sessionStorage.setItem(dirtyKey, '1')
    const clearDirty = () => sessionStorage.removeItem(dirtyKey)
    window.addEventListener('beforeunload', clearDirty)

    const teardown = setupChannel(dispatch, () => store.getState())

    return () => {
      window.removeEventListener('beforeunload', clearDirty)
      teardown()
    }
  }, [dispatch])

  useEffect(() => {
    if (crashRecovery.available) setRecoveryOpen(true)
  }, [crashRecovery.available])

  const savedAt = crashRecovery.savedAt ? new Date(crashRecovery.savedAt).toLocaleString('zh-CN') : '未知时间'

  return (
    <>
      {children}
      <Dialog open={recoveryOpen} onClose={() => {}} fullWidth maxWidth="xs">
        <DialogTitle>恢复最近草稿</DialogTitle>
        <DialogContent>
          <Typography color="text.secondary">
            检测到上次页面未正常退出。已为你保留最近完整草稿（保存于 {savedAt}）。是否恢复？
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button
            color="inherit"
            onClick={() => {
              dispatch(dismissRecovery())
              setRecoveryOpen(false)
            }}
          >
            放弃草稿
          </Button>
          <Button
            variant="contained"
            onClick={() => {
              dispatch(recoverDraft())
              setRecoveryOpen(false)
            }}
          >
            恢复草稿
          </Button>
        </DialogActions>
      </Dialog>
    </>
  )
}
