import React from 'react'

export type BadgeTone =
  | 'neutral'
  | 'soft'
  | 'medium'
  | 'hard'
  | 'intermediate'
  | 'wet'
  | 'danger'
  | 'success'
  | 'info'

export interface BadgeProps {
  tone?: BadgeTone
  children: React.ReactNode
  title?: string
}

// Compact status pill used for tyre compounds, pit flags and event types.
export const Badge: React.FC<BadgeProps> = ({ tone = 'neutral', children, title }) => {
  return (
    <span className="badge" data-tone={tone} title={title}>
      {children}
    </span>
  )
}
