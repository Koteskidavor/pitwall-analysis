import React from 'react'
import { Link } from 'react-router-dom'
import { Badge } from './Badge'
import { DataTierBadge } from './DataTierBadge'
import { formatDate } from '../format'

export interface RaceHeaderProps {
  year: number
  round: number
  type: string
  name: string
  circuit: string
  date: string | null
  schemaVersion: string
  tier: 'full' | 'results'
  flaggedLaps: number
}

export const RaceHeader: React.FC<RaceHeaderProps> = ({
  year,
  round,
  type,
  name,
  circuit,
  date,
  schemaVersion,
  tier,
  flaggedLaps,
}) => {
  return (
    <header className="race-header">
      <Link to="/" className="back-link">
        <span aria-hidden="true">←</span> All races
      </Link>

      <div className="race-header__title">
        <h1>{name}</h1>
      </div>

      <div className="race-header__meta">
        <span className="eyebrow">
          {year} · Round {round} · {type}
        </span>
        <span aria-hidden="true">·</span>
        <span>{circuit}</span>
        {date && (
          <>
            <span aria-hidden="true">·</span>
            <span className="mono">{formatDate(date)}</span>
          </>
        )}
      </div>

      <div className="badge-row">
        <DataTierBadge tier={tier} />
        <Badge title="Data schema version">schema {schemaVersion}</Badge>
        {flaggedLaps > 0 && (
          <Badge tone="danger" title="Laps whose timing could not be trusted">
            {flaggedLaps} laps flagged
          </Badge>
        )}
      </div>
    </header>
  )
}
