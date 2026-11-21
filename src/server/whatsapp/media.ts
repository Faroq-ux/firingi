import "server-only";
/**
 * WhatsApp media (Phase 58): downloading a photo or voice note the customer sent, and turning a voice note
 * into text.
 *   - Twilio: MediaUrl0 (basic auth with the account SID / token).
 *   - Meta Cloud API: "meta:<media id>" → GET graph.facebook.com/<id> → its url (Bearer WHATSAPP_TOKEN).
 *   - Speech to text: STT_URL (an OpenAI-compatible /audio/transcriptions endpoint) + STT_API_KEY + STT_MODEL.
 *     WA_MEDIA_SIMULATE=1 (tests, development): media comes back as a tiny file, voice notes as STT_SIMULATE_TEXT.
 */

export type Media = { buf: Buffer; mime: string };

export async function downloadMedia(ref: string, mimeHint: string | null, fetchImpl: typeof fetch = fetch): Promise<Media | null> {
  if (process.env.WA_MEDIA_SIMULATE === "1") {
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64");
    return { buf: mimeHint?.startsWith("audio") ? Buffer.from("simulated audio") : png, mime: mimeHint ?? "image/png" };
  }
  try {
    if (ref.startsWith("meta:")) {
      const token = process.env.WHATSAPP_TOKEN;
      if (!token) return null;
      const meta = await fetchImpl(`https://graph.facebook.com/v21.0/${ref.slice(5)}`, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15000) });
      const j = (await meta.json().catch(() => ({}))) as { url?: string; mime_type?: string };
      if (!meta.ok || !j.url) return null;
      const res = await fetchImpl(j.url, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30000) });
      if (!res.ok) return null;
      return { buf: Buffer.from(await res.arrayBuffer()), mime: j.mime_type ?? mimeHint ?? res.headers.get("content-type") ?? "application/octet-stream" };
    }
    if (/^https:\/\//.test(ref)) {
      const sid = process.env.TWILIO_ACCOUNT_SID, tok = process.env.TWILIO_AUTH_TOKEN;
      const res = await fetchImpl(ref, { headers: sid && tok ? { authorization: `Basic ${Buffer.from(`${sid}:${tok}`).toString("base64")}` } : {}, redirect: "follow", signal: AbortSignal.timeout(30000) });
      if (!res.ok) return null;
      return { buf: Buffer.from(await res.arrayBuffer()), mime: mimeHint ?? res.headers.get("content-type") ?? "application/octet-stream" };
    }
  } catch {
    return null;
  }
  return null;
}

export const transcriptionReady = () => process.env.WA_MEDIA_SIMULATE === "1" || !!(process.env.STT_URL && process.env.STT_API_KEY);

/** A voice note as text (null when speech-to-text isn't set up or fails). */
export async function transcribe(m: Media, language: string, fetchImpl: typeof fetch = fetch): Promise<string | null> {
  if (process.env.WA_MEDIA_SIMULATE === "1") return process.env.STT_SIMULATE_TEXT ?? "add 2 Coca-Cola";
  const url = process.env.STT_URL, key = process.env.STT_API_KEY;
  if (!url || !key) return null;
  try {
    const form = new FormData();
    const ext = m.mime.includes("ogg") ? "ogg" : m.mime.includes("mpeg") ? "mp3" : m.mime.includes("mp4") ? "m4a" : "audio";
    form.append("file", new Blob([new Uint8Array(m.buf)], { type: m.mime }), `voice.${ext}`);
    form.append("model", process.env.STT_MODEL ?? "whisper-1");
    form.append("language", language.slice(0, 2));
    const res = await fetchImpl(url, { method: "POST", headers: { authorization: `Bearer ${key}` }, body: form, signal: AbortSignal.timeout(60000) });
    const j = (await res.json().catch(() => ({}))) as { text?: string };
    return res.ok && j.text?.trim() ? j.text.trim() : null;
  } catch {
    return null;
  }
}
