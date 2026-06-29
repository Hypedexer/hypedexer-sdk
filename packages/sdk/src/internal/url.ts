/**
 * Safe URL path-segment encoder.
 *
 * Hyperliquid HIP-3 trade ids contain ':' (e.g. `trade_xyz:EWY_0xab...`).
 * While ':' is technically allowed in URL path segments per RFC 3986, several
 * HTTP routers (and intermediate proxies) parse it as a scheme/host delimiter
 * and break. The SDK therefore always `%3A`-encodes ':' in path segments on
 * top of standard `encodeURIComponent` behavior. `encodeURIComponent` already
 * encodes '@' as '%40' and the other reserved sub-delims we care about.
 */
export function encodeSegment(value: string): string {
  return encodeURIComponent(value).replace(/:/g, '%3A')
}

/**
 * Join path segments with '/'. Each segment is run through `encodeSegment`.
 * The result always starts with '/'. Empty segments are preserved as encoded
 * empty strings (callers should filter them out beforehand if they don't want
 * empty path components).
 */
export function joinPath(...segments: string[]): string {
  return `/${segments.map(encodeSegment).join('/')}`
}
