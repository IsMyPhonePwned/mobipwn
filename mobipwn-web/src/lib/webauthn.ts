/** Convert WebAuthn JSON (base64url) to/from the browser Credential API. */

function b64urlToBuf(value: string): ArrayBuffer {
  const pad = "=".repeat((4 - (value.length % 4)) % 4);
  const b64 = (value + pad).replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

function bufToB64url(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function toBuffer(value: unknown): ArrayBuffer {
  if (typeof value === "string") return b64urlToBuf(value);
  if (value instanceof ArrayBuffer) return value;
  if (ArrayBuffer.isView(value)) {
    return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength);
  }
  if (Array.isArray(value)) return new Uint8Array(value).buffer;
  throw new Error("invalid WebAuthn binary field");
}

type JsonObject = Record<string, unknown>;

function publicKeyFromOptions(options: JsonObject): PublicKeyCredentialCreationOptions | PublicKeyCredentialRequestOptions {
  const pk = (options.publicKey as JsonObject | undefined) ?? options;
  const converted: JsonObject = { ...pk, challenge: toBuffer(pk.challenge) };
  if (pk.user && typeof pk.user === "object") {
    const user = { ...(pk.user as JsonObject) };
    user.id = toBuffer(user.id);
    converted.user = user;
  }
  if (Array.isArray(pk.excludeCredentials)) {
    converted.excludeCredentials = pk.excludeCredentials.map((c) => {
      const cred = { ...(c as JsonObject) };
      cred.id = toBuffer(cred.id);
      return cred;
    });
  }
  if (Array.isArray(pk.allowCredentials)) {
    converted.allowCredentials = pk.allowCredentials.map((c) => {
      const cred = { ...(c as JsonObject) };
      cred.id = toBuffer(cred.id);
      return cred;
    });
  }
  return converted as unknown as PublicKeyCredentialCreationOptions;
}

function credentialToJson(cred: PublicKeyCredential): JsonObject {
  if (typeof cred.toJSON === "function") {
    return cred.toJSON() as JsonObject;
  }
  const response = cred.response;
  const base: JsonObject = {
    id: cred.id,
    rawId: bufToB64url(cred.rawId),
    type: cred.type,
    authenticatorAttachment: cred.authenticatorAttachment ?? undefined,
  };
  if (response instanceof AuthenticatorAttestationResponse) {
    base.response = {
      clientDataJSON: bufToB64url(response.clientDataJSON),
      attestationObject: bufToB64url(response.attestationObject),
      transports: response.getTransports?.() ?? [],
    };
  } else if (response instanceof AuthenticatorAssertionResponse) {
    base.response = {
      clientDataJSON: bufToB64url(response.clientDataJSON),
      authenticatorData: bufToB64url(response.authenticatorData),
      signature: bufToB64url(response.signature),
      userHandle: response.userHandle ? bufToB64url(response.userHandle) : null,
    };
  }
  return base;
}

export function webauthnAvailable(): boolean {
  return typeof window !== "undefined" && !!window.PublicKeyCredential;
}

export async function createSecurityKey(options: JsonObject): Promise<JsonObject> {
  const cred = (await navigator.credentials.create({
    publicKey: publicKeyFromOptions(options) as PublicKeyCredentialCreationOptions,
  })) as PublicKeyCredential | null;
  if (!cred) throw new Error("Security key registration was cancelled");
  return credentialToJson(cred);
}

export async function assertSecurityKey(options: JsonObject): Promise<JsonObject> {
  const cred = (await navigator.credentials.get({
    publicKey: publicKeyFromOptions(options) as PublicKeyCredentialRequestOptions,
  })) as PublicKeyCredential | null;
  if (!cred) throw new Error("Security key verification was cancelled");
  return credentialToJson(cred);
}
