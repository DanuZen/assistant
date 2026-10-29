import React, { useEffect, useState } from 'react'
import { FloatingOrb } from './components/FloatingOrb'
import { Dashboard } from './components/Dashboard'

export const App: React.FC = () => {
  const [mode, setMode] = useState<'orb' | 'dashboard'>(() =>
    window.location.hash === '#orb' ? 'orb' : 'dashboard'
  )

  useEffect(() => {
    const onHash = () => {
      setMode(window.location.hash === '#orb' ? 'orb' : 'dashboard')
    }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  useEffect(() => {
    if (mode === 'orb') {
      document.documentElement.classList.add('orb-transparent-root')
    } else {
      document.documentElement.classList.remove('orb-transparent-root')
    }
  }, [mode])

  return mode === 'orb' ? <FloatingOrb /> : <Dashboard />
}

