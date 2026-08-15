import { useEffect, useState } from 'react'

import type { AppInfo } from '@shared/types'

/** M0 placeholder. Its only job is to prove the preload bridge round-trips before the
 *  Finder shell lands in M4 — if this renders, main <-> renderer is wired correctly. */
export function App(): React.JSX.Element {
  const [info, setInfo] = useState<AppInfo | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    window.airbridge
      .getAppInfo()
      .then(setInfo)
      .catch((cause: unknown) => setError(String(cause)))
  }, [])

  return (
    <main className="flex h-full flex-col items-center justify-center gap-6 px-8">
      <h1 className="text-2xl font-semibold tracking-tight">airbridge</h1>

      {error && <p className="text-red-600">{error}</p>}

      {info && (
        <dl className="grid grid-cols-[auto_auto] gap-x-6 gap-y-1.5 text-[13px]">
          <Row label="Device">{info.deviceName}</Row>
          <Row label="Identity">
            <span className="font-mono text-[11px]">{info.deviceId}</span>
          </Row>
          <Row label="Platform">{info.platform}</Row>
          <Row label="Electron">{info.electronVersion}</Row>
        </dl>
      )}

      <p className="text-(--color-ink-muted)">
        M0 — scaffold. Sharing arrives in M1.
      </p>
    </main>
  )
}

function Row({
  label,
  children
}: {
  label: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <>
      <dt className="justify-self-end text-(--color-ink-muted)">{label}</dt>
      <dd className="m-0">{children}</dd>
    </>
  )
}
