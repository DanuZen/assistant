import poseIdle from '../assets/character/pose-idle.png'
import poseListen from '../assets/character/pose-listen.png'
import poseAlert from '../assets/character/pose-alert.png'
import poseIdea from '../assets/character/pose-idea.png'
import type { OrbStatus } from '../types/assistant'

export type PoseKey = 'idle' | 'listen' | 'idea' | 'alert'

export interface PoseMeta {
  key: PoseKey
  src: string
  label: string
}

export const CHARACTER_POSES: Record<PoseKey, PoseMeta> = {
  idle: {
    key: 'idle',
    src: poseIdle,
    label: 'Siaga'
  },
  listen: {
    key: 'listen',
    src: poseListen,
    label: 'Mendengarkan'
  },
  idea: {
    key: 'idea',
    src: poseIdea,
    label: 'Punya Ide / Menjawab'
  },
  alert: {
    key: 'alert',
    src: poseAlert,
    label: 'Semangat / Alarm'
  }
}

export const POSE_ORDER: PoseKey[] = ['idle', 'listen', 'idea', 'alert']

export function getPoseForStatus(status: OrbStatus, manualPose?: PoseKey | null): PoseMeta {
  if (manualPose) {
    return CHARACTER_POSES[manualPose]
  }
  switch (status) {
    case 'awake':
      return CHARACTER_POSES.listen
    case 'thinking':
    case 'speaking':
      return CHARACTER_POSES.idea
    case 'alert':
      return CHARACTER_POSES.alert
    case 'idle':
    case 'standby':
    default:
      return CHARACTER_POSES.idle
  }
}

