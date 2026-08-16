export function EmptyState({
  title,
  children
}: {
  title: string
  children?: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 p-10 text-center">
      <p className="text-[13px] text-(--color-ink-muted)">{title}</p>
      {children}
    </div>
  )
}
