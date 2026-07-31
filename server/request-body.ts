export class RequestBodyError extends Error {
  constructor(
    public readonly status: 400 | 413 | 415,
    message: string,
  ) {
    super(message);
    this.name = "RequestBodyError";
  }
}

export async function readBoundedUtf8Body(request: Request, maxBytes: number): Promise<string> {
  const declaredLength = request.headers.get("content-length");
  if (declaredLength !== null) {
    const parsedLength = Number(declaredLength);
    if (!Number.isSafeInteger(parsedLength) || parsedLength < 0) {
      throw new RequestBodyError(400, "Invalid Content-Length");
    }
    if (parsedLength > maxBytes) throw new RequestBodyError(413, "Request too large");
  }
  if (!request.body) return "";

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new RequestBodyError(413, "Request too large");
    }
    chunks.push(value);
  }

  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(body);
  } catch {
    throw new RequestBodyError(400, "Request body must be valid UTF-8");
  }
}

function validatePercentEncoding(component: string): void {
  for (let index = 0; index < component.length; index += 1) {
    if (component[index] !== "%") continue;
    if (!/^[0-9a-f]{2}$/i.test(component.slice(index + 1, index + 3))) {
      throw new RequestBodyError(400, "Malformed URL-encoded form");
    }
    index += 2;
  }
  try {
    decodeURIComponent(component.replaceAll("+", " "));
  } catch {
    throw new RequestBodyError(400, "URL-encoded form must contain valid UTF-8");
  }
}

export async function readUrlEncodedForm(request: Request, maxBytes: number): Promise<URLSearchParams> {
  const mediaType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (mediaType !== "application/x-www-form-urlencoded") {
    throw new RequestBodyError(415, "Login requests must use application/x-www-form-urlencoded");
  }
  const body = await readBoundedUtf8Body(request, maxBytes);
  for (const pair of body.split("&")) {
    const separator = pair.indexOf("=");
    validatePercentEncoding(separator < 0 ? pair : pair.slice(0, separator));
    if (separator >= 0) validatePercentEncoding(pair.slice(separator + 1));
  }
  return new URLSearchParams(body);
}
