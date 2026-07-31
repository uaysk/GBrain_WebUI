import { isIP } from "node:net";

export interface RequestConnection {
  address: string | null;
  secure?: boolean;
}

export interface RequestNetwork {
  clientIp: string;
  secure: boolean;
}

function forwardedValues(value: string | null): string[] {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeForwardedAddress(value: string): string | null {
  const unquoted = value.startsWith('"') && value.endsWith('"') ? value.slice(1, -1) : value;
  if (isIP(unquoted)) return unquoted;
  const bracketed = /^\[([^\]]+)](?::\d+)?$/.exec(unquoted)?.[1];
  if (bracketed && isIP(bracketed)) return bracketed;
  const ipv4WithPort = /^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/.exec(unquoted)?.[1];
  return ipv4WithPort && isIP(ipv4WithPort) ? ipv4WithPort : null;
}

/**
 * Resolve the client boundary from the right side of the proxy chain.
 * A value of zero ignores every forwarded header and uses the socket peer.
 */
export function resolveRequestNetwork(
  request: Request,
  connection: RequestConnection,
  trustProxyHops: number,
): RequestNetwork {
  const requestSecure = connection.secure ?? new URL(request.url).protocol === "https:";
  const socketAddress = connection.address?.trim() || "unknown";
  if (trustProxyHops === 0) return { clientIp: socketAddress, secure: requestSecure };

  const forwardedFor = forwardedValues(request.headers.get("x-forwarded-for"));
  const addressIndex = forwardedFor.length - trustProxyHops;
  const forwardedAddress = addressIndex >= 0
    ? normalizeForwardedAddress(forwardedFor[addressIndex]!)
    : null;

  const forwardedProto = forwardedValues(request.headers.get("x-forwarded-proto"));
  const protoIndex = forwardedProto.length - trustProxyHops;
  const proto = protoIndex >= 0 ? forwardedProto[protoIndex]!.toLowerCase() : null;
  return {
    clientIp: forwardedAddress ?? socketAddress,
    secure: proto === "https" ? true : proto === "http" ? false : requestSecure,
  };
}

export function directRequestNetwork(request: Request): RequestNetwork {
  return resolveRequestNetwork(request, { address: "local" }, 0);
}
