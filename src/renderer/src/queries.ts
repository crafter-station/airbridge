import { useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query'
import { useEffect } from 'react'

import type {
  DirEntry,
  KnownDevice,
  LocalListing,
  LocalPlace,
  PublicShare,
  ServerStatus,
  Share,
  TransferJob
} from '@shared/types'

/**
 * Directory listings are cached so that going back is instant rather than a fresh round trip
 * over the network. Nothing is refetched on its own: the main process pushes when something
 * actually changes, and these hooks invalidate on that.
 */
export function useDevices(): UseQueryResult<KnownDevice[]> {
  const client = useQueryClient()

  useEffect(
    () =>
      window.airbridge.devices.onChanged((devices) => client.setQueryData(['devices'], devices)),
    [client]
  )

  return useQuery({ queryKey: ['devices'], queryFn: () => window.airbridge.devices.list() })
}

export function useOwnShares(): UseQueryResult<Share[]> {
  const client = useQueryClient()

  useEffect(
    () => window.airbridge.shares.onChanged((shares) => client.setQueryData(['shares'], shares)),
    [client]
  )

  return useQuery({ queryKey: ['shares'], queryFn: () => window.airbridge.shares.list() })
}

export function useTransfers(): UseQueryResult<TransferJob[]> {
  const client = useQueryClient()

  useEffect(
    () => window.airbridge.transfers.onChanged((jobs) => client.setQueryData(['transfers'], jobs)),
    [client]
  )

  return useQuery({ queryKey: ['transfers'], queryFn: () => window.airbridge.transfers.list() })
}

export function useServerStatus(): UseQueryResult<ServerStatus> {
  return useQuery({ queryKey: ['server'], queryFn: () => window.airbridge.serverStatus() })
}

export function usePeerShares(deviceId: string | null): UseQueryResult<PublicShare[]> {
  return useQuery({
    queryKey: ['peer-shares', deviceId],
    enabled: deviceId !== null,
    queryFn: async () => (await window.airbridge.peer.shares(deviceId as string)).shares
  })
}

export function usePeerDirectory(
  deviceId: string | null,
  shareId: string | null,
  path: string
): UseQueryResult<DirEntry[]> {
  return useQuery({
    queryKey: ['peer-dir', deviceId, shareId, path],
    enabled: deviceId !== null && shareId !== null,
    queryFn: () => window.airbridge.peer.list(deviceId as string, shareId as string, path)
  })
}

export function useLocalDirectory(path: string | null): UseQueryResult<LocalListing> {
  return useQuery({
    queryKey: ['local-dir', path],
    enabled: path !== null,
    queryFn: () => window.airbridge.local.list(path as string)
  })
}

export function useLocalPlaces(): UseQueryResult<LocalPlace[]> {
  return useQuery({
    queryKey: ['local-places'],
    // The user's home and desktop do not move while the app is open.
    staleTime: Infinity,
    queryFn: () => window.airbridge.local.places()
  })
}
