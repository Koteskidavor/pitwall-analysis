import React from 'react'

export interface DataTierBadgeProps {
  tier: 'full' | 'results' | undefined
}

// Distinguishes a session with full replay telemetry from an older one that
// only has a final classification. Results-only races still open, they just
// hide the replay panels.
export const DataTierBadge: React.FC<DataTierBadgeProps> = ({ tier }) => {
  const full = tier !== 'results'
  return (
    <span
      className="badge badge--tier"
      data-tier={full ? 'full' : 'results'}
      title={full ? 'Motion and gap telemetry available' : 'Only the final results were processed'}
    >
      {full ? 'Full telemetry' : 'Results only'}
    </span>
  )
}
