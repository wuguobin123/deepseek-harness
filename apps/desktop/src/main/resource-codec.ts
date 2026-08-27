/** Location-bearing identifiers used by the federated desktop. */
export type HostLocation = 'local' | 'cloud'

export interface ResourceRef {
  readonly location: HostLocation
  readonly id: string
}

const PREFIX = 'dsh:'
const ENCODED_ID = /^[A-Za-z0-9_-]+$/u

/** Encode a host-local identifier without losing its execution location. */
export function encodeResourceId(location: HostLocation, id: string): string {
  if (id.length === 0) throw new Error('resource id must be non-empty')
  return `${PREFIX}${location}:${Buffer.from(id, 'utf8').toString('base64url')}`
}

/** Decode a location-bearing id; plain ids are intentionally rejected. */
export function decodeResourceId(value: unknown): ResourceRef {
  if (typeof value !== 'string' || !value.startsWith(PREFIX)) throw new Error('resource id has no host location')
  const rest = value.slice(PREFIX.length)
  const separator = rest.indexOf(':')
  const location = rest.slice(0, separator)
  const encoded = rest.slice(separator + 1)
  if ((location !== 'local' && location !== 'cloud') || !ENCODED_ID.test(encoded)) {
    throw new Error('invalid location-bearing resource id')
  }
  const id = Buffer.from(encoded, 'base64url').toString('utf8')
  if (id.length === 0 || Buffer.from(id, 'utf8').toString('base64url') !== encoded) {
    throw new Error('invalid location-bearing resource id')
  }
  return { location, id }
}

/** Add a location to an RPC result while preserving all host-owned fields. */
export function tagResource<T extends Record<string, unknown>>(location: HostLocation, resource: T): T & { location: HostLocation } {
  return { ...resource, location }
}

/** Recursively decode the first location-bearing resource in an RPC payload. */
export function findResourceLocation(payload: unknown): HostLocation | undefined {
  if (typeof payload === 'string' && payload.startsWith(PREFIX)) return decodeResourceId(payload).location
  if (Array.isArray(payload)) {
    for (const value of payload) {
      const location = findResourceLocation(value)
      if (location !== undefined) return location
    }
    return undefined
  }
  if (payload !== null && typeof payload === 'object') {
    for (const value of Object.values(payload)) {
      const location = findResourceLocation(value)
      if (location !== undefined) return location
    }
  }
  return undefined
}

/** Replace location-bearing ids in a request with host-local ids. */
export function stripResourceIds(value: unknown, location: HostLocation): unknown {
  if (typeof value === 'string' && value.startsWith(PREFIX)) {
    const resource = decodeResourceId(value)
    if (resource.location !== location) throw new Error(`resource belongs to ${resource.location} Host`)
    return resource.id
  }
  if (Array.isArray(value)) return value.map(item => stripResourceIds(item, location))
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, stripResourceIds(item, location)]))
  }
  return value
}
