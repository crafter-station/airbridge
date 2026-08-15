import { networkInterfaces } from 'node:os'

import type { NetworkAddress } from '@shared/types'

/**
 * Adapters that exist but do not reach the LAN. Advertising on a Docker or WSL bridge is the
 * classic reason two machines never see each other: the record is published on 172.17.x.x,
 * which nothing on the real network can route to.
 *
 * macOS names are exact and numbered (`utun0`, `awdl0`), so they anchor. Windows names are
 * free text ("vEthernet (WSL)"), so they match anywhere — but never on a prefix alone, or
 * "Local Area Connection" would be mistaken for loopback.
 */
const VIRTUAL_UNIX = /^(utun|awdl|llw|bridge|vmnet|vboxnet|tap|tun|ipsec|gif|stf|anpi|ap)\d*$/i
const VIRTUAL_WINDOWS =
  /(vEthernet|VirtualBox|VMware|Hyper-V|Loopback|Npcap|TAP-Windows|Tailscale|ZeroTier|Bluetooth|WSL)/i

function isVirtual(name: string): boolean {
  return VIRTUAL_UNIX.test(name) || VIRTUAL_WINDOWS.test(name)
}

/**
 * IPv4 addresses this machine can plausibly be reached on, best candidates first.
 *
 * IPv4 only, by decision: link-local IPv6 adds a second failure surface for no gain on a
 * two-machine LAN.
 */
export function localAddresses(): NetworkAddress[] {
  const found: NetworkAddress[] = []

  for (const [name, addresses] of Object.entries(networkInterfaces())) {
    if (!addresses || isVirtual(name)) continue

    for (const address of addresses) {
      if (address.internal || address.family !== 'IPv4') continue
      found.push({ name, address: address.address })
    }
  }

  return found
}

/** Interface names worth advertising an mDNS record on. */
export function advertisableInterfaces(): string[] {
  return [...new Set(localAddresses().map((entry) => entry.name))]
}
