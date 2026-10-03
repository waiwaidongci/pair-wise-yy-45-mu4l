import { useMemo, useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import {
  AppBar,
  Box,
  Chip,
  Drawer,
  IconButton,
  List,
  ListItemButton,
  ListItemText,
  Popover,
  TextField,
  Toolbar,
  Typography,
} from '@mui/material'
import MenuIcon from '@mui/icons-material/Menu'
import CheckroomIcon from '@mui/icons-material/Checkroom'
import DashboardOutlinedIcon from '@mui/icons-material/DashboardOutlined'
import Inventory2OutlinedIcon from '@mui/icons-material/Inventory2Outlined'
import CompareArrowsOutlinedIcon from '@mui/icons-material/CompareArrowsOutlined'
import HistoryOutlinedIcon from '@mui/icons-material/HistoryOutlined'
import CloudDoneOutlinedIcon from '@mui/icons-material/CloudDoneOutlined'
import CloudQueueOutlinedIcon from '@mui/icons-material/CloudQueueOutlined'
import EditOutlinedIcon from '@mui/icons-material/EditOutlined'
import { useAppSelector } from '../app/hooks'
import { useCollab } from '../features/collab/CollabProvider'

const nav = [
  { to: '/', label: '开发总览', icon: <DashboardOutlinedIcon /> },
  { to: '/styles', label: '款式档案', icon: <Inventory2OutlinedIcon /> },
  { to: '/review', label: '样品评审', icon: <CompareArrowsOutlinedIcon /> },
  { to: '/history', label: '修订历史', icon: <HistoryOutlinedIcon /> },
]

export default function Layout() {
  const [mobileOpen, setMobileOpen] = useState(false)

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh' }}>
      <AppBar position="fixed" color="transparent" elevation={0} sx={{ display: { md: 'none' }, bgcolor: '#262a2b' }}>
        <Toolbar sx={{ minHeight: 52 }}>
          <IconButton color="inherit" onClick={() => setMobileOpen(true)}><MenuIcon /></IconButton>
          <Typography fontWeight={800} ml={1}>MORROW 开发台</Typography>
        </Toolbar>
      </AppBar>
      <Box component="nav" sx={{ width: { md: 242 }, flexShrink: { md: 0 } }}>
        <Drawer variant="temporary" open={mobileOpen} onClose={() => setMobileOpen(false)} sx={{ display: { xs: 'block', md: 'none' } }}>
          <DrawerBody onNavigate={() => setMobileOpen(false)} />
        </Drawer>
        <Drawer variant="permanent" open sx={{ display: { xs: 'none', md: 'block' }, '& .MuiDrawer-paper': { width: 242, border: 0 } }}>
          <DrawerBody onNavigate={() => setMobileOpen(false)} />
        </Drawer>
      </Box>
      <Box component="main" sx={{ flex: 1, minWidth: 0, pt: { xs: '52px', md: 0 } }}>
        <Outlet />
      </Box>
    </Box>
  )
}

function DrawerBody({ onNavigate }: { onNavigate: () => void }) {
  const { identity, updateAuthor, pending } = useCollab()
  const peerCount = useAppSelector((state) => state.development.peerCount)
  const lastSyncAt = useAppSelector((state) => state.development.lastSyncAt)
  const [anchor, setAnchor] = useState<null | HTMLElement>(null)
  const [name, setName] = useState(identity.author)

  const syncText = useMemo(() => {
    if (lastSyncAt) {
      return `最后同步 ${new Date(lastSyncAt).toLocaleTimeString('zh-CN', { hour12: false, hour: '2-digit', minute: '2-digit' })} · ${peerCount} 个窗口在线`
    }
    return `尚未同步 · ${peerCount} 个窗口在线`
  }, [lastSyncAt, peerCount])

  return (
    <Box sx={{ width: 242, minHeight: '100%', bgcolor: '#262a2b', color: '#eef1ef', display: 'flex', flexDirection: 'column' }}>
      <Box sx={{ p: 2, display: 'flex', alignItems: 'center', gap: 1.2, borderBottom: '1px solid rgba(255,255,255,.1)' }}>
        <Box sx={{ width: 38, height: 38, display: 'grid', placeItems: 'center', border: '1px solid #74aaa0', borderRadius: 1 }}>
          <CheckroomIcon fontSize="small" />
        </Box>
        <Box>
          <Typography fontWeight={800} fontSize={14}>MORROW 开发台</Typography>
          <Typography color="#9aa6a3" fontSize={11}>2026 秋冬 · 女装</Typography>
        </Box>
      </Box>
      <List sx={{ px: 1.2, py: 2 }}>
        {nav.map((item) => (
          <ListItemButton
            key={item.to}
            component={NavLink}
            to={item.to}
            end={item.to === '/'}
            onClick={onNavigate}
            sx={{
              color: '#cbd3d1',
              borderRadius: 1,
              mb: 0.4,
              '&.active': { color: '#fff', bgcolor: '#374a48', boxShadow: 'inset 3px 0 #6eb0a4' },
            }}
          >
            <Box sx={{ mr: 1.2, display: 'flex' }}>{item.icon}</Box>
            <ListItemText primary={item.label} primaryTypographyProps={{ fontSize: 13, fontWeight: 650 }} />
          </ListItemButton>
        ))}
      </List>
      <Box sx={{ mx: 1.5, mt: 'auto', mb: 1.5 }}>
        <Box
          sx={{ p: 1.3, border: '1px solid rgba(255,255,255,.14)', borderRadius: 1.5, cursor: 'pointer' }}
          onClick={(event) => { setName(identity.author); setAnchor(event.currentTarget) }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.7 }}>
            <EditOutlinedIcon sx={{ fontSize: 15, color: '#74b79d' }} />
            <Typography fontSize={12} fontWeight={750}>{identity.author}</Typography>
            <Chip size="small" label={identity.windowLabel} sx={{ ml: 'auto', height: 18, fontSize: 10, '.MuiChip-label': { px: 0.7 } }} color="primary" />
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.7, mt: 0.8 }}>
            {pending.length ? (
              <CloudQueueOutlinedIcon sx={{ fontSize: 15, color: '#e0a864' }} />
            ) : (
              <CloudDoneOutlinedIcon sx={{ fontSize: 16, color: '#74b79d' }} />
            )}
            <Typography fontSize={11}>{pending.length ? `${pending.length} 项本地改动待同步` : '本地已全部并入'}</Typography>
          </Box>
          <Typography color="#8f9a98" fontSize={10} mt={0.8}>{syncText}</Typography>
        </Box>
      </Box>

      <Popover
        open={Boolean(anchor)}
        anchorEl={anchor}
        onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
        transformOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Box sx={{ p: 1.8, width: 250 }}>
          <Typography fontWeight={800} fontSize={13} mb={1}>设置提交人身份</Typography>
          <Typography color="text.secondary" fontSize={11} mb={1.2}>
            新窗口自动分配标签（{identity.windowLabel}）。批注、草稿和方案都会带上这个姓名与窗口来源。
          </Typography>
          <TextField
            size="small"
            fullWidth
            label="提交人姓名"
            value={name}
            onChange={(event) => setName(event.target.value)}
            autoFocus
            onKeyDown={(event) => {
              if (event.key === 'Enter' && name.trim()) {
                updateAuthor(name.trim())
                setAnchor(null)
              }
            }}
          />
          <Box sx={{ display: 'flex', justifyContent: 'flex-end', mt: 1.3 }}>
            <IconButton
              size="small"
              disabled={!name.trim()}
              onClick={() => { updateAuthor(name.trim()); setAnchor(null) }}
            >
              <CheckroomIcon fontSize="small" />
            </IconButton>
          </Box>
        </Box>
      </Popover>
    </Box>
  )
}
