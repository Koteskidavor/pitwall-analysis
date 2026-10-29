import React from 'react'
import { Link } from 'react-router-dom'
import type { Session } from '@pitwall/shared'
import { Badge } from './Badge'
import { DataTierBadge } from './DataTierBadge'
import { TrackThumbnail } from './TrackThumbnail'
import { formatDate, prettifyTrack } from '../format'
import { teamColor } from '../teamColors'

export interface RaceCardProps {
  session: Session
}

export const RaceCard: React.FC<RaceCardProps> = ({ session }) => {
  const outline = session.trackOutline ?? []

  return (
    <Link
      to={`/races/${session.id}`}
      className="race-card"
      data-testid={`race-card-${session.id}`}
    >
      <div className="race-card__top">
        <span className="round-number" aria-label={`Round ${session.round}`}>
          {String(session.round).padStart(2, '0')}
        </span>
        <div className="race-card__title">
          <h3>{session.name}</h3>
          <p>{prettifyTrack(session.track)}</p>
        </div>
        {outline.length > 1 && (
          <div className="race-card__thumb">
            <TrackThumbnail points={outline} />
          </div>
        )}
      </div>

      <div className="race-card__meta">
        {session.session_date && <span className="mono">{formatDate(session.session_date)}</span>}
        <Badge>{session.type}</Badge>
        <DataTierBadge tier={session.dataTier} />
        {session.winner && (
          <span className="race-card__winner" title={`Winner: ${session.winner}`}>
            <span
              className="team-dot"
              style={{ background: teamColor(session.winner) }}
              aria-hidden="true"
            />
            {session.winner}
          </span>
        )}
      </div>
    </Link>
  )
}
