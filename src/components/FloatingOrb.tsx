import React, { useCallback, useEffect, useRef, useState } from 'react'
import {
  ChevronDown,
  GripHorizontal,
  LayoutDashboard,
  Mic,
  MicOff,
  Music,
  Pause,
  Play,
  SkipBack,
  SkipForward,
  Smile
} from 'lucide-react'
import type {
  AssistantSettings,
  MediaControlAction,
  MediaPlaybackState,
  ModelStatus,
  OrbStatus
} from '../types/assistant'
import { VoiceActivityRecorder } from '../utils/audioRecorder'
import { matchWakeWord } from '../utils/wakeWord'
import { playSuccessChime, playWakeChime, speakText, stopSpeaking } from '../utils/tts'
import { CHARACTER_POSES, getPoseForStatus, POSE_ORDER, type PoseKey } from '../utils/characterPoses'

export const FloatingOrb: React.FC = () => {
  const [settings, setSettings] = useState<AssistantSettings | null>(null)
  const [orbStatus, setOrbStatus] = useState<OrbStatus>('standby')
  const [manualPose, setManualPose] = useState<PoseKey | null>(null)
  const [bubbleTitle, setBubbleTitle] = useState<string>('')
  const [bubbleText, setBubbleText] = useState<string>('')
  const [bubbleVisible, setBubbleVisible] = useState(false)
  const [modelStatus, setModelStatus] = useState<ModelStatus | null>(null)
  const [mediaState, setMediaState] = useState<MediaPlaybackState | null>(null)
  const [lyricLineIdx, setLyricLineIdx] = useState<number>(-1)
  const [showNoLyricIntro, setShowNoLyricIntro] = useState(false)
  const [contextMenuOpen, setContextMenuOpen] = useState(false)
  // Slide-up / slide-down state from bottom of desktop!
  const [isSlidDown, setIsSlidDown] = useState(true)

  const settingsRef = useRef<AssistantSettings | null>(null)
  const statusRef = useRef<OrbStatus>('standby')
  const mediaActiveRef = useRef<boolean>(false)
  const mediaSongKeyRef = useRef<string>('')
  const recorderRef = useRef<VoiceActivityRecorder | null>(null)
  const awakeTimerRef = useRef<number | null>(null)
  const bubbleHideTimerRef = useRef<number | null>(null)
  const lastActivityRef = useRef<number>(Date.now())
  const noLyricTimerRef = useRef<number | null>(null)
  const mouseLeaveTimerRef = useRef<number | null>(null)
  const lastSeenSongKeyRef = useRef<string>('')
  const manuallySlidDownSongRef = useRef<string>('')
  const pausedMusicForSummonRef = useRef<boolean>(false)
  const dragRef = useRef<{ dragging: boolean; lastX: number }>({
    dragging: false,
    lastX: 0
  })

  const touchActivity = useCallback(() => {
    lastActivityRef.current = Date.now()
  }, [])

  const syncStatus = useCallback((next: OrbStatus, transcript?: string, reply?: string) => {
    statusRef.current = next
    setOrbStatus(next)
    window.dannAPI.broadcastOrbStatus({ status: next, transcript, reply })
  }, [])

  const showBubble = useCallback((title: string, text: string, autoHideMs = 6000) => {
    if (bubbleHideTimerRef.current) {
      window.clearTimeout(bubbleHideTimerRef.current)
    }
    if (!text) {
      setBubbleVisible(false)
      bubbleHideTimerRef.current = window.setTimeout(() => {
        setBubbleTitle('')
        setBubbleText('')
      }, 280)
      return
    }
    setBubbleTitle(title)
    setBubbleText(text)
    setBubbleVisible(true)
    if (autoHideMs > 0) {
      bubbleHideTimerRef.current = window.setTimeout(() => {
        setBubbleVisible(false)
        window.setTimeout(() => {
          setBubbleTitle('')
          setBubbleText('')
        }, 280)
      }, autoHideMs)
    }
  }, [])

  const clearAwakeTimeout = useCallback(() => {
    if (awakeTimerRef.current) {
      window.clearTimeout(awakeTimerRef.current)
      awakeTimerRef.current = null
    }
  }, [])

  const slideDownAndLeave = useCallback(() => {
    if (mediaSongKeyRef.current) {
      // Remember that user dismissed Dann on this track so singing lyrics won't pop him right back up!
      manuallySlidDownSongRef.current = mediaSongKeyRef.current
    }
    setContextMenuOpen(false)
    showBubble('', '', 0)
    setIsSlidDown(true)
    window.dannAPI.setOrbIgnoreMouse(true)
  }, [showBubble])

  const enterStandbyOrIdle = useCallback(
    (hideImmediately = false) => {
      clearAwakeTimeout()
      touchActivity()

      // Jika musik sebelumnya di-pause khusus karena dipanggil ("Woii Dann") dan pengguna tidak mengganti musik:
      if (pausedMusicForSummonRef.current) {
        pausedMusicForSummonRef.current = false
        void window.dannAPI.controlMedia('play')
      }

      const s = settingsRef.current
      if (s?.alwaysListen) {
        recorderRef.current?.setSilenceTimeout(600)
        recorderRef.current?.setMaxUtteranceMs(4800)
        recorderRef.current?.setPaused(false)
        syncStatus('standby')
      } else {
        recorderRef.current?.setPaused(true)
        syncStatus('idle')
      }

      if (hideImmediately) {
        window.setTimeout(() => {
          slideDownAndLeave()
        }, 600)
      }
    },
    [clearAwakeTimeout, slideDownAndLeave, syncStatus, touchActivity]
  )

  const summonAwake = useCallback(
    (greetingBubble = 'Iya? Silakan ucapkan perintahmu.', speakGreeting = false) => {
      clearAwakeTimeout()
      touchActivity()
      setManualPose(null)
      manuallySlidDownSongRef.current = ''
      // Always slide UP from bottom of desktop when summoned ("Woi Dan" / Alt+Space)!
      setIsSlidDown(false)
      stopSpeaking()
      playWakeChime()

      // Saat musik sedang aktif dan pengguna memanggil "Woii Dann",
      // otomatis JEDA musiknya agar Dann bisa merespon jernih dan mendengar perintah user tanpa kebisingan!
      let finalGreeting = greetingBubble
      if (mediaActiveRef.current) {
        pausedMusicForSummonRef.current = true
        void window.dannAPI.controlMedia('pause')
        if (speakGreeting) {
          finalGreeting = 'Iya! Musiknya aku pause dulu ya. Mau dibantu apa nih?'
        }
      } else {
        pausedMusicForSummonRef.current = false
      }

      const startListeningWindow = () => {
        touchActivity()
        recorderRef.current?.setSilenceTimeout(820)
        recorderRef.current?.setMaxUtteranceMs(6800)
        recorderRef.current?.setPaused(false)
        syncStatus('awake')
        showBubble(
          `${settingsRef.current?.assistantName || 'Dann'} Mendengarkan`,
          finalGreeting,
          10000
        )

        awakeTimerRef.current = window.setTimeout(() => {
          if (statusRef.current === 'awake') {
            showBubble('', '', 0)
            enterStandbyOrIdle()
          }
        }, 12000)
      }

      if (speakGreeting && settingsRef.current?.ttsEnabled) {
        recorderRef.current?.setPaused(true)
        syncStatus('speaking')
        showBubble(settingsRef.current?.assistantName || 'Dann', finalGreeting, 8000)
        speakText(
          finalGreeting,
          settingsRef.current.ttsRate || 1.05,
          undefined,
          () => startListeningWindow()
        )
      } else {
        startListeningWindow()
      }
    },
    [clearAwakeTimeout, enterStandbyOrIdle, showBubble, syncStatus, touchActivity]
  )

  const executeCommandText = useCallback(
    async (commandText: string) => {
      clearAwakeTimeout()
      touchActivity()
      setManualPose(null)
      setIsSlidDown(false)
      recorderRef.current?.setPaused(true)
      syncStatus('thinking', commandText)
      showBubble('Kamu', `"${commandText}"`, 0)

      // Jika user memberikan perintah musik eksplisit, jangan auto-resume musik lama
      if (
        /^(?:pause|paus|jeda|stop|berhenti|play|plei|resume|unpause|lanjut|lanjutkan|next|neks|skip|prev|previous|ganti|putar|setel|mainkan)/i.test(
          commandText.trim()
        )
      ) {
        pausedMusicForSummonRef.current = false
      }

      try {
        const res = await window.dannAPI.processCommand(commandText)
        playSuccessChime()
        touchActivity()

        const s = settingsRef.current
        const shownUserText = res.normalizedInput || commandText
        const replyState: OrbStatus = res.triggerPose === 'alert' ? 'alert' : 'speaking'
        showBubble(res.actionBadge || s?.assistantName || 'Dann', res.reply, 7500)

        if (s?.ttsEnabled) {
          syncStatus(replyState, shownUserText, res.reply)
          speakText(
            res.reply,
            s.ttsRate || 1.05,
            undefined,
            () => {
              if (res.dismissMascot) {
                enterStandbyOrIdle(true)
              } else if (res.shouldContinueConversation) {
                summonAwake('Ada lagi yang bisa dibantu?', false)
              } else {
                enterStandbyOrIdle()
              }
            }
          )
        } else {
          syncStatus(replyState, shownUserText, res.reply)
          window.setTimeout(() => {
            if (res.dismissMascot) {
              enterStandbyOrIdle(true)
            } else if (res.shouldContinueConversation) {
              summonAwake('Ada lagi yang bisa dibantu?', false)
            } else {
              enterStandbyOrIdle()
            }
          }, 2600)
        }
      } catch (err: any) {
        syncStatus('alert')
        showBubble('Waduh!', err?.message || 'Gagal memproses perintah', 5000)
        window.setTimeout(() => enterStandbyOrIdle(), 3500)
      }
    },
    [clearAwakeTimeout, enterStandbyOrIdle, showBubble, summonAwake, syncStatus, touchActivity]
  )

  const handleUtterance = useCallback(
    async (pcm16k: Float32Array, wavBase64: string) => {
      const currentMode = statusRef.current
      if (currentMode !== 'standby' && currentMode !== 'awake') return

      const s = settingsRef.current
      if (!s) return

      if (currentMode === 'awake') {
        clearAwakeTimeout()
        syncStatus('thinking')
        showBubble('Bentar ya...', 'Lagi nyerna omonganmu...', 0)
      }

      const { text, error } = await window.dannAPI.transcribeAudio(pcm16k, wavBase64)

      if (error || !text.trim()) {
        if (currentMode === 'awake') {
          // If music is actively playing and a lyric bleed / beat spike was filtered out,
          // stay in 'awake' listening mode so user can finish speaking over the music!
          if (!error && mediaActiveRef.current) {
            syncStatus('awake')
            showBubble(
              `${s.assistantName || 'Dann'} Mendengarkan`,
              'Aku dengerin kok meski ada musik, ngomong aja!',
              7000
            )
            awakeTimerRef.current = window.setTimeout(() => {
              if (statusRef.current === 'awake') {
                showBubble('', '', 0)
                enterStandbyOrIdle()
              }
            }, 9000)
            return
          }

          showBubble(
            'Kurang Jelas',
            error ? `Info: ${error}` : 'Eh, suaranya gak kedengeran nih. Panggil lagi ya!',
            3500
          )
          enterStandbyOrIdle()
        }
        return
      }

      if (currentMode === 'standby') {
        const trimmed = text.trim()

        // 1. Direct Instant Media & Dismiss Commands (Bisa diucapkan langsung TANPA kata "Woii Dann"!)
        const isDirectMediaOrDismiss =
          /^(?:pause|paus|pos|jeda|stop|berhenti|play|plei|resume|unpause|lanjut|lanjutkan|next|neks|nek|skip|previous|preverius|previus|privius|prev|pref)(?:\s+(?:musik|lagu|videonya|lagunya|musiknya))?$/i.test(
            trimmed
          ) ||
          /^(?:lagu|musik)\s+(?:selanjutnya|berikutnya|sebelumnya)$/i.test(trimmed) ||
          /^(?:ganti|lewati|balik|ulang)\s+lagu$/i.test(trimmed) ||
          /^(?:pergi(?:\s+(?:dulu|sana|aja))?|sana\s+pergi|hus|hush|syuh|minggir(?:\s+dulu)?|cabut(?:\s+dulu)?|ngumpet(?:\s+dulu)?|turun(?:\s+dulu)?|dadah|bye)$/i.test(
            trimmed
          )

        if (isDirectMediaOrDismiss) {
          touchActivity()
          summonAwake(undefined, false)
          await executeCommandText(trimmed)
          return
        }

        const match = matchWakeWord(text, s.wakeWord, s.wakeAliases)
        if (!match.matched) {
          return
        }

        // Slide UP immediately upon hearing "Woii Dann"!
        manuallySlidDownSongRef.current = ''
        setIsSlidDown(false)

        if (match.remainderCommand.length >= 2) {
          playWakeChime()
          await executeCommandText(match.remainderCommand)
        } else {
          summonAwake('Hadir! Mau dibantu apa hari ini?', true)
        }
      } else if (currentMode === 'awake') {
        const match = matchWakeWord(text, s.wakeWord, s.wakeAliases)
        const cleanCmd = match.matched && match.remainderCommand ? match.remainderCommand : text
        await executeCommandText(cleanCmd)
      }
    },
    [clearAwakeTimeout, enterStandbyOrIdle, executeCommandText, showBubble, summonAwake, syncStatus]
  )

  useEffect(() => {
    window.dannAPI.setOrbIgnoreMouse(true)

    let mounted = true

    const recorder = new VoiceActivityRecorder({
      onLevel: () => {},
      onUtterance: (pcm, wav) => {
        handleUtterance(pcm, wav)
      },
      onError: (msg) => {
        showBubble('Mikrofon', msg, 7000)
      }
    })
    recorderRef.current = recorder

    window.dannAPI.getStore().then(async (store) => {
      if (!mounted) return
      settingsRef.current = store.settings
      setSettings(store.settings)
      // Stay hidden below desktop at launch until user says "Woii Dann" (unless autoHideMascot explicitly disabled)
      if (store.settings.autoHideMascot === false) {
        setIsSlidDown(false)
        touchActivity()
      } else {
        setIsSlidDown(true)
      }
      recorder.setThreshold(store.settings.micSensitivity || 0.014)

      const started = await recorder.start()
      if (started) {
        if (store.settings.alwaysListen) {
          recorder.setPaused(false)
          syncStatus('standby')
        } else {
          recorder.setPaused(true)
          syncStatus('idle')
        }
      }
    })

    window.dannAPI.getModelStatus().then((st) => {
      if (mounted) setModelStatus(st)
    })

    window.dannAPI.getMediaState().then((ms) => {
      if (mounted) {
        mediaActiveRef.current = Boolean(ms?.active)
        mediaSongKeyRef.current = ms?.title ? `${ms.source}::${ms.title}::${ms.artist}` : ''
        recorder.setMusicPlaying(Boolean(ms?.active))
        setMediaState(ms)
      }
    })

    const unsubStore = window.dannAPI.onStoreUpdated((data) => {
      const prevAlways = settingsRef.current?.alwaysListen
      settingsRef.current = data.settings
      setSettings(data.settings)
      recorder.setThreshold(data.settings.micSensitivity || 0.014)

      if (prevAlways !== data.settings.alwaysListen && statusRef.current !== 'awake') {
        if (data.settings.alwaysListen) {
          recorder.setPaused(false)
          syncStatus('standby')
        } else {
          recorder.setPaused(true)
          syncStatus('idle')
        }
      }
    })

    const unsubModel = window.dannAPI.onModelStatus((st) => {
      setModelStatus(st)
    })

    const unsubMedia = window.dannAPI.onMediaState((ms) => {
      mediaActiveRef.current = Boolean(ms?.active)
      mediaSongKeyRef.current = ms?.title ? `${ms.source}::${ms.title}::${ms.artist}` : ''
      recorder.setMusicPlaying(Boolean(ms?.active))
      setMediaState(ms)
    })

    const unsubSummon = window.dannAPI.onSummonTrigger(() => {
      summonAwake('Siap! Langsung ucapkan perintahmu...', false)
    })

    const unsubToggleSlide = window.dannAPI.onToggleSlide(() => {
      touchActivity()
      setIsSlidDown((prev) => {
        const next = !prev
        if (next) {
          setContextMenuOpen(false)
          showBubble('', '', 0)
          window.dannAPI.setOrbIgnoreMouse(true)
        } else {
          manuallySlidDownSongRef.current = ''
        }
        return next
      })
    })

    const unsubReminder = window.dannAPI.onReminderFired((reminder) => {
      playWakeChime()
      touchActivity()
      setManualPose(null)
      setIsSlidDown(false)
      syncStatus('alert')
      showBubble('⏰ Pengingat!', reminder.label, 9500)
      if (settingsRef.current?.ttsEnabled) {
        recorder.setPaused(true)
        speakText(
          `Perhatian! Pengingat selesai: ${reminder.label}`,
          settingsRef.current.ttsRate || 1.05,
          () => syncStatus('alert'),
          () => enterStandbyOrIdle()
        )
      } else {
        window.setTimeout(() => enterStandbyOrIdle(), 6000)
      }
    })

    return () => {
      mounted = false
      if (noLyricTimerRef.current) window.clearTimeout(noLyricTimerRef.current)
      clearAwakeTimeout()
      recorder.stop()
      unsubStore()
      unsubModel()
      unsubMedia()
      unsubSummon()
      unsubToggleSlide()
      unsubReminder()
    }
  }, [clearAwakeTimeout, enterStandbyOrIdle, handleUtterance, showBubble, summonAwake, syncStatus, touchActivity])

  // Real-time Lyric Line Sync Ticker (160ms resolution while music is playing)
  useEffect(() => {
    const singEnabled = settings?.singAlongLyrics !== false
    if (!mediaState?.active || !singEnabled) {
      setLyricLineIdx(-1)
      setShowNoLyricIntro(false)
      return
    }

    const songKey = `${mediaState.source}::${mediaState.title}::${mediaState.artist}`
    if (songKey !== lastSeenSongKeyRef.current) {
      lastSeenSongKeyRef.current = songKey
      setLyricLineIdx(-1)

      // Slide character UP when a song with lyrics plays (unless user manually hid during this song)
      if (
        manuallySlidDownSongRef.current !== songKey &&
        (mediaState.source === 'Spotify' ||
          mediaState.source === 'YouTube Music' ||
          mediaState.lyricsStatus === 'ready')
      ) {
        setIsSlidDown(false)
      }
    }

    // Also slide up if YouTube finished resolving synced lyrics for the active song
    if (
      mediaState.lyricsStatus === 'ready' &&
      mediaState.lyrics.length > 0 &&
      manuallySlidDownSongRef.current !== songKey &&
      settings?.autoHideMascot
    ) {
      setIsSlidDown(false)
    }

    if (mediaState.lyricsStatus === 'not-found') {
      if (mediaState.source === 'Spotify' || mediaState.source === 'YouTube Music') {
        setShowNoLyricIntro(true)
        if (noLyricTimerRef.current) window.clearTimeout(noLyricTimerRef.current)
        noLyricTimerRef.current = window.setTimeout(() => {
          setShowNoLyricIntro(false)
        }, 7000)
      } else {
        setShowNoLyricIntro(false)
      }
      return
    }

    setShowNoLyricIntro(false)
    if (mediaState.lyricsStatus !== 'ready' || mediaState.lyrics.length === 0) {
      setLyricLineIdx(-1)
      return
    }

    const updateActiveLine = () => {
      const liveMs = mediaState.positionMs + Math.max(0, Date.now() - mediaState.updatedAt)
      // +260ms anticipation so lyric bubble lands right on the vocal downbeat!
      const targetMs = liveMs + 260
      const lines = mediaState.lyrics
      let idx = -1
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].timeMs <= targetMs) {
          idx = i
        } else {
          break
        }
      }
      setLyricLineIdx((prev) => (prev !== idx ? idx : prev))
    }

    updateActiveLine()
    const timer = window.setInterval(updateActiveLine, 160)
    return () => window.clearInterval(timer)
  }, [mediaState, settings?.singAlongLyrics, settings?.autoHideMascot])

  // Horizontal dragging along the bottom desktop edge + close right-click menu on outside click (blur / Esc)
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragRef.current.dragging) return
      const dx = e.screenX - dragRef.current.lastX
      dragRef.current.lastX = e.screenX
      if (dx !== 0) {
        window.dannAPI.moveOrbWindow(dx, 0)
      }
    }
    const onUp = () => {
      dragRef.current.dragging = false
    }
    const onBlur = () => {
      if (!dragRef.current.dragging) {
        setContextMenuOpen(false)
      }
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setContextMenuOpen(false)
      }
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    window.addEventListener('blur', onBlur)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      window.removeEventListener('blur', onBlur)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [])

  const handleMouseEnterInteractive = () => {
    if (mouseLeaveTimerRef.current) {
      window.clearTimeout(mouseLeaveTimerRef.current)
      mouseLeaveTimerRef.current = null
    }
    window.dannAPI.setOrbIgnoreMouse(false)
  }

  const handleMouseLeaveInteractive = () => {
    if (mouseLeaveTimerRef.current) {
      window.clearTimeout(mouseLeaveTimerRef.current)
    }
    mouseLeaveTimerRef.current = window.setTimeout(() => {
      if (!dragRef.current.dragging) {
        window.dannAPI.setOrbIgnoreMouse(true)
      }
    }, 90)
  }

  const handleCharacterClick = () => {
    touchActivity()
    setContextMenuOpen(false)
    if (orbStatus === 'awake') {
      showBubble('', '', 0)
      enterStandbyOrIdle()
    } else if (orbStatus === 'speaking' || orbStatus === 'alert') {
      stopSpeaking()
      enterStandbyOrIdle()
    } else {
      summonAwake('Iya? Silakan ucapkan perintahmu.', false)
    }
  }

  const handleCharacterContextMenu = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    touchActivity()
    setContextMenuOpen((prev) => !prev)
  }

  const cyclePosePreview = (e: React.MouseEvent) => {
    e.stopPropagation()
    setManualPose((prev) => {
      if (!prev) {
        showBubble('Pose Karakter', 'Pose: Siaga (Klik lagi untuk ganti)', 2500)
        return POSE_ORDER[0]
      }
      const nextIdx = POSE_ORDER.indexOf(prev) + 1
      if (nextIdx >= POSE_ORDER.length) {
        showBubble('Pose Karakter', 'Mode Pose Otomatis aktif!', 2200)
        return null
      }
      const nextKey = POSE_ORDER[nextIdx]
      const meta = getPoseForStatus(orbStatus, nextKey)
      showBubble('Pose Karakter', `Pose: ${meta.label}`, 2500)
      return nextKey
    })
  }

  const toggleAlwaysListen = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!settings) return
    await window.dannAPI.updateSettings({ alwaysListen: !settings.alwaysListen })
  }

  const handleMediaControl = async (e: React.MouseEvent, action: MediaControlAction) => {
    e.stopPropagation()
    touchActivity()
    await window.dannAPI.controlMedia(action)
  }

  const toggleSingAlong = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!settings) return
    const next = settings.singAlongLyrics === false
    await window.dannAPI.updateSettings({ singAlongLyrics: next })
    showBubble(
      '🎵 Mode Bernyanyi',
      next
        ? 'Bubble lirik bernyanyi aktif untuk Spotify, YT Music & YouTube!'
        : 'Bubble lirik bernyanyi dinonaktifkan.',
      2600
    )
  }

  const isDownloadingModel = modelStatus?.status === 'loading'
  const isAssistantBusy =
    orbStatus === 'awake' ||
    orbStatus === 'thinking' ||
    orbStatus === 'speaking' ||
    orbStatus === 'alert' ||
    Boolean(bubbleText) ||
    isDownloadingModel

  const singAlongEnabled = settings?.singAlongLyrics !== false
  const isMediaActive = Boolean(mediaState?.active && singAlongEnabled)

  // Determine whether Singing Lyric Bubble should display right now
  let singingLyricMain = ''
  let singingLyricNext = ''
  let shouldShowSingingBubble = false

  if (isMediaActive && mediaState && !isAssistantBusy) {
    if (mediaState.lyricsStatus === 'loading' && mediaState.source !== 'YouTube') {
      shouldShowSingingBubble = true
      singingLyricMain = `Menyiapkan lirik "${mediaState.cleanTitle}"...`
    } else if (mediaState.lyricsStatus === 'ready' && mediaState.lyrics.length > 0) {
      shouldShowSingingBubble = true
      if (lyricLineIdx < 0) {
        singingLyricMain = `${mediaState.cleanTitle}${
          mediaState.cleanArtist ? ` — ${mediaState.cleanArtist}` : ''
        }`
        singingLyricNext = mediaState.lyrics[0]?.text || ''
      } else {
        const cur = mediaState.lyrics[lyricLineIdx]?.text || '...'
        singingLyricMain = cur
        const nxt = mediaState.lyrics[lyricLineIdx + 1]?.text
        if (nxt && nxt !== '...') {
          singingLyricNext = nxt
        }
      }
    } else if (mediaState.lyricsStatus === 'not-found' && showNoLyricIntro) {
      shouldShowSingingBubble = true
      singingLyricMain = `Sedang memutar "${mediaState.cleanTitle}"`
    }
  }

  const isGroovingMusic =
    isMediaActive &&
    !isAssistantBusy &&
    (mediaState?.source === 'Spotify' ||
      mediaState?.source === 'YouTube Music' ||
      mediaState?.lyricsStatus === 'ready')

  // Wear headphones pose automatically when vibing/singing along to music!
  const activePose =
    !manualPose && isGroovingMusic
      ? CHARACTER_POSES.listen
      : getPoseForStatus(orbStatus, manualPose)

  const showSpeechCard = (bubbleText || isDownloadingModel) && !isSlidDown
  const showSingingCard = shouldShowSingingBubble && !isSlidDown

  // Auto-leave (slide down) when there is no response/interaction from user for a couple minutes!
  useEffect(() => {
    if (isSlidDown) return
    if (settings?.autoHideMascot === false) return

    const minutes = settings?.autoHideMinutes ?? 2
    if (minutes <= 0) return
    const timeoutMs = minutes * 60_000

    const interval = window.setInterval(() => {
      // Keep character awake while conversing, right-click menu is open, or actively singing lyrics
      const busyNow =
        orbStatus === 'awake' ||
        orbStatus === 'thinking' ||
        orbStatus === 'speaking' ||
        orbStatus === 'alert' ||
        contextMenuOpen ||
        shouldShowSingingBubble

      if (busyNow) {
        lastActivityRef.current = Date.now()
        return
      }

      if (Date.now() - lastActivityRef.current >= timeoutMs) {
        slideDownAndLeave()
      }
    }, 3000)

    return () => window.clearInterval(interval)
  }, [
    isSlidDown,
    settings?.autoHideMascot,
    settings?.autoHideMinutes,
    orbStatus,
    contextMenuOpen,
    shouldShowSingingBubble,
    slideDownAndLeave
  ])

  const sourceBadgeClass =
    mediaState?.source === 'Spotify'
      ? 'src-spotify'
      : mediaState?.source === 'YouTube Music'
        ? 'src-ytmusic'
        : 'src-youtube'

  return (
    <div className="orb-screen-root">
      {/* Main Character Stage — Slides purely UP and DOWN from the bottom edge of desktop! */}
      <div className={`mascot-slide-wrapper ${isSlidDown ? 'slid-down' : 'slid-up'}`}>
        {/* 1. Assistant Speech Bubble (Priority when talking/listening to user) */}
        {(bubbleText || isDownloadingModel) && (
          <div
            className={`nb-speech-bubble status-${orbStatus} ${
              showSpeechCard && (bubbleVisible || isDownloadingModel) ? 'bubble-up' : 'bubble-down'
            }`}
          >
            <div className="nb-bubble-tag">{bubbleTitle || 'MENYIAPKAN SUARA'}</div>
            <p className="nb-bubble-body">{bubbleText || modelStatus?.message}</p>
          </div>
        )}

        {/* 2. Neubrutalist Singing Lyric Bubble (Spotify / YouTube Music / YouTube) */}
        {showSingingCard && mediaState && (
          <div className="nb-singing-wrap">
            <div className="nb-singing-bubble">
              <div className="nb-singing-head">
                <span className={`nb-source-pill ${sourceBadgeClass}`}>
                  <span className="nb-eq-bars" aria-hidden="true">
                    <i />
                    <i />
                    <i />
                  </span>
                  {mediaState.source === 'YouTube Music'
                    ? 'YT MUSIC'
                    : (mediaState.source || 'MUSIK').toUpperCase()}
                </span>
                <span className="nb-song-meta" title={`${mediaState.cleanTitle} — ${mediaState.cleanArtist}`}>
                  {mediaState.cleanTitle}
                  {mediaState.cleanArtist ? ` • ${mediaState.cleanArtist}` : ''}
                </span>
              </div>

              <div key={`${mediaState.title}-${lyricLineIdx}`} className="nb-lyric-stage">
                <p className="nb-lyric-current">{singingLyricMain}</p>
                {singingLyricNext && <p className="nb-lyric-next">{singingLyricNext}</p>}
              </div>
            </div>
          </div>
        )}

        <div className="mascot-bottom-stage">
          {/* Neubrutalist Context Controls — Shown ONLY on Right-Click of Character! */}
          <div
            className={`nb-quick-controls ${contextMenuOpen && !isSlidDown ? 'visible' : ''}`}
            onMouseEnter={contextMenuOpen ? handleMouseEnterInteractive : undefined}
            onMouseLeave={contextMenuOpen ? handleMouseLeaveInteractive : undefined}
            onContextMenu={(e) => e.preventDefault()}
          >
            <button
              className="nb-mini-btn"
              title="Geser Kiri / Kanan di Bawah Layar"
              onMouseDown={(e) => {
                e.stopPropagation()
                dragRef.current = {
                  dragging: true,
                  lastX: e.screenX
                }
              }}
            >
              <GripHorizontal size={14} strokeWidth={2.5} />
            </button>
            <button
              className="nb-mini-btn"
              title="Lagu Sebelumnya (Previous)"
              onClick={(e) => handleMediaControl(e, 'previous')}
            >
              <SkipBack size={13} strokeWidth={2.6} />
            </button>
            <button
              className={`nb-mini-btn ${mediaState?.active ? 'active-sky' : ''}`}
              title={mediaState?.active ? 'Jeda Musik (Pause)' : 'Putar / Lanjutkan Musik (Play)'}
              onClick={(e) => handleMediaControl(e, 'toggle')}
            >
              {mediaState?.active ? (
                <Pause size={13} strokeWidth={2.6} />
              ) : (
                <Play size={13} strokeWidth={2.6} />
              )}
            </button>
            <button
              className="nb-mini-btn"
              title="Lagu Selanjutnya (Next)"
              onClick={(e) => handleMediaControl(e, 'next')}
            >
              <SkipForward size={13} strokeWidth={2.6} />
            </button>
            <button
              className={`nb-mini-btn ${singAlongEnabled ? 'active-pink' : ''}`}
              title={
                singAlongEnabled
                  ? 'Mode Ikut Bernyanyi (Lirik) Aktif — Klik untuk Matikan'
                  : 'Aktifkan Mode Ikut Bernyanyi (Lirik)'
              }
              onClick={toggleSingAlong}
            >
              <Music size={14} strokeWidth={2.5} />
            </button>
            <button
              className={`nb-mini-btn ${manualPose ? 'active-yellow' : ''}`}
              title="Ganti Pose Karakter"
              onClick={cyclePosePreview}
            >
              <Smile size={14} strokeWidth={2.5} />
            </button>
            <button
              className={`nb-mini-btn ${settings?.alwaysListen ? 'active-mint' : 'active-coral'}`}
              title={
                settings?.alwaysListen
                  ? `Mikrofon "${settings.wakeWord}" Aktif`
                  : 'Mikrofon Nonaktif'
              }
              onClick={toggleAlwaysListen}
            >
              {settings?.alwaysListen ? (
                <Mic size={14} strokeWidth={2.5} />
              ) : (
                <MicOff size={14} strokeWidth={2.5} />
              )}
            </button>
            <button
              className="nb-mini-btn"
              title="Buka Dashboard Dann"
              onClick={(e) => {
                e.stopPropagation()
                setContextMenuOpen(false)
                window.dannAPI.openDashboard('home')
              }}
            >
              <LayoutDashboard size={14} strokeWidth={2.5} />
            </button>
            <button
              className="nb-mini-btn"
              title="Turunkan Karakter ke Bawah Desktop"
              onClick={(e) => {
                e.stopPropagation()
                if (mediaState?.active) {
                  manuallySlidDownSongRef.current = `${mediaState.source}::${mediaState.title}::${mediaState.artist}`
                }
                setContextMenuOpen(false)
                showBubble('', '', 0)
                setIsSlidDown(true)
              }}
            >
              <ChevronDown size={15} strokeWidth={3} />
            </button>
          </div>

          {/* Character Flush with Bottom Desktop Edge (bottom: 0, zero gap underneath!) */}
          <button
            className={`mascot-flush-btn state-${orbStatus} ${isGroovingMusic ? 'is-singing' : ''}`}
            onMouseEnter={handleMouseEnterInteractive}
            onMouseLeave={handleMouseLeaveInteractive}
            onClick={handleCharacterClick}
            onContextMenu={handleCharacterContextMenu}
            title={`Klik Kiri: Bicara langsung • Klik Kanan: Menu Kontrol`}
          >
            <img
              key={activePose.key}
              src={activePose.src}
              alt={activePose.label}
              draggable={false}
              className="mascot-flush-img"
            />
          </button>
        </div>
      </div>
    </div>
  )
}
