import React from 'react'
import { Link } from 'react-router-dom'

export const TopBar: React.FC = () => {
  return (
    <header className="topbar">
      <div className="topbar__brand">
        <Link to="/" className="wordmark" aria-label="Pitwall home">
          Pitwall
        </Link>
        <span className="tagline">Replay and inspect any race</span>
      </div>
      <div className="topbar__spacer" />
      <span className="badge" title="Community project, not affiliated with Formula 1">
        unofficial data
      </span>
    </header>
  )
}
