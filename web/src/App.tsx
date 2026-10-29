import React from 'react'
import { Link, Route, Routes } from 'react-router-dom'
import { RacePickerPage } from './pages/RacePickerPage'
import { RacePage } from './pages/RacePage'

const NotFound: React.FC = () => (
  <div className="state-card state-card--error" role="alert">
    <h2>Page not found</h2>
    <p>That route does not exist.</p>
    <Link className="button" to="/">
      Back to races
    </Link>
  </div>
)

export const App: React.FC = () => {
  return (
    <Routes>
      <Route path="/" element={<RacePickerPage />} />
      <Route path="/races/:sessionId" element={<RacePage />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  )
}
