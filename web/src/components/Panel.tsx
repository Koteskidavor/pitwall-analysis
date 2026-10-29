import React from 'react'

export interface PanelProps {
  title?: React.ReactNode
  subtitle?: React.ReactNode
  actions?: React.ReactNode
  children: React.ReactNode
  className?: string
}

// Shared chrome for the panels stacked around the track map. Keeping it dumb
// means every feature can wrap its own content without inheriting layout rules.
export const Panel: React.FC<PanelProps> = ({
  title,
  subtitle,
  actions,
  children,
  className,
}) => {
  const hasHeader = Boolean(title || subtitle || actions)

  return (
    <section className={['panel', className].filter(Boolean).join(' ')}>
      {hasHeader && (
        <header className="panel__header">
          <div className="panel__heading">
            {title && <h2 className="panel__title">{title}</h2>}
            {subtitle && <p className="panel__subtitle">{subtitle}</p>}
          </div>
          {actions && <div className="panel__actions">{actions}</div>}
        </header>
      )}
      <div className="panel__body">{children}</div>
    </section>
  )
}
