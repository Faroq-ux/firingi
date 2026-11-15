"use client";
/**
 * Voice: speak instead of typing (microphone → text in the box, to check and send) and read an answer
 * aloud. Uses the browser's own speech features — nothing to pay, no extra service in FIRINGI:
 * Chrome / Edge / Safari (phones and computers). Where the browser can't, the buttons don't show.
 * Chrome and Edge send the audio to their speech service to turn it into text; the browser asks
 * for the microphone the first time.
 */
import { useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Mic, Square, Volume2, VolumeX } from "lucide-react";

export type VoiceLabels = { speak: string; stop: string; listening: string; readAloud: string; stopReading: string; privacy: string; denied: string; noSpeech: string };
/** FIRINGI back-office pages are English. */
export const EN_VOICE: VoiceLabels = {
  speak: "Speak instead of typing", stop: "Stop", listening: "Listening… speak now, tap again to stop", readAloud: "Read aloud", stopReading: "Stop reading",
  privacy: "Your browser turns your speech into text (Chrome and Edge use their online speech service).", denied: "The microphone is blocked — allow it in your browser settings.", noSpeech: "Didn't catch that — please try again.",
};

/** App locale → the language tag speech engines expect. */
const SPEECH_LANG: Record<string, string> = {
  en: "en-GB", "pt-PT": "pt-PT", pt: "pt-PT", es: "es-ES", bg: "bg-BG", cs: "cs-CZ", da: "da-DK", de: "de-DE", el: "el-GR", et: "et-EE", fi: "fi-FI", fr: "fr-FR", hr: "hr-HR",
  hu: "hu-HU", is: "is-IS", it: "it-IT", lt: "lt-LT", lv: "lv-LV", mt: "mt-MT", nb: "nb-NO", nl: "nl-NL", pl: "pl-PL", ro: "ro-RO", sk: "sk-SK", sl: "sl-SI", sv: "sv-SE",
};
export const speechLang = (locale: string) => SPEECH_LANG[locale] ?? SPEECH_LANG[locale.split("-")[0]] ?? locale;

function useVoiceLabels(labels?: VoiceLabels): VoiceLabels {
  const t = useTranslations("voice");
  return labels ?? { speak: t("speak"), stop: t("stop"), listening: t("listening"), readAloud: t("readAloud"), stopReading: t("stopReading"), privacy: t("privacy"), denied: t("denied"), noSpeech: t("noSpeech") };
}

// Minimal typing for the Web Speech API (not in the TS DOM library everywhere).
type Rec = { lang: string; continuous: boolean; interimResults: boolean; start(): void; stop(): void; abort(): void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null; onend: (() => void) | null };
const recognitionCtor = () => (typeof window === "undefined" ? null : ((window as unknown as { SpeechRecognition?: new () => Rec; webkitSpeechRecognition?: new () => Rec }).SpeechRecognition
  ?? (window as unknown as { webkitSpeechRecognition?: new () => Rec }).webkitSpeechRecognition ?? null));

/**
 * 🎤 Tap, speak, tap again (or pause): what was said is added to the text box through `onText` —
 * the person checks it and sends it themselves.
 */
export function MicButton({ onText, labels, lang, className = "", testId = "mic" }: { onText: (text: string) => void; labels?: VoiceLabels; lang?: string; className?: string; testId?: string }) {
  const L = useVoiceLabels(labels);
  const locale = useLocale();
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const [error, setError] = useState<string | null>(null);
  const rec = useRef<Rec | null>(null);
  useEffect(() => { setSupported(!!recognitionCtor()); return () => rec.current?.abort(); }, []);
  if (!supported) return null;

  const start = () => {
    const Ctor = recognitionCtor();
    if (!Ctor) return;
    setError(null); setInterim("");
    const r = new Ctor();
    r.lang = speechLang(lang ?? locale); r.continuous = true; r.interimResults = true;
    r.onresult = (e) => {
      let finalText = "", live = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        if (res.isFinal) finalText += res[0].transcript; else live += res[0].transcript;
      }
      if (finalText.trim()) onText(finalText.trim());
      setInterim(live);
    };
    r.onerror = (e) => { setError(e.error === "not-allowed" || e.error === "service-not-allowed" ? L.denied : e.error === "no-speech" ? L.noSpeech : null); };
    r.onend = () => { setListening(false); setInterim(""); rec.current = null; };
    rec.current = r;
    try { r.start(); setListening(true); } catch { setListening(false); }
  };
  const stop = () => rec.current?.stop();

  return (
    <span className={`inline-flex flex-col ${className}`}>
      <button type="button" onClick={listening ? stop : start} aria-pressed={listening} aria-label={listening ? L.stop : L.speak} title={`${listening ? L.stop : L.speak} — ${L.privacy}`} data-testid={testId}
        className={`inline-grid size-10 shrink-0 place-items-center rounded-full border transition ${listening ? "animate-pulse border-transparent bg-[linear-gradient(135deg,var(--vivid-pink),var(--vivid-orange))] text-white shadow-md" : "bg-background hover:border-[var(--vivid-violet)] hover:text-[var(--vivid-violet)]"}`}>
        {listening ? <Square className="size-4" aria-hidden /> : <Mic className="size-4" aria-hidden />}
      </button>
      {(listening || error) && (
        <span role="status" className={`mt-1 max-w-64 text-xs ${error ? "text-destructive" : "text-muted-foreground"}`} data-testid={`${testId}-status`}>
          {error ?? (interim ? `“${interim}”` : L.listening)}
        </span>
      )}
    </span>
  );
}

/** Text without Markdown marks, for reading aloud. */
const plain = (s: string) => s.replace(/```[\s\S]*?```/g, " ").replace(/[#*_`>|]/g, " ").replace(/\[(.*?)\]\(.*?\)/g, "$1").replace(/\s+/g, " ").trim();

/** 🔊 Read a message aloud in the person's language (optional; never automatic). */
export function SpeakButton({ text, labels, lang, testId = "speak" }: { text: string; labels?: VoiceLabels; lang?: string; testId?: string }) {
  const L = useVoiceLabels(labels);
  const locale = useLocale();
  const [supported, setSupported] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const speakingRef = useRef(false);
  useEffect(() => {
    setSupported(typeof window !== "undefined" && !!window.speechSynthesis && typeof window.SpeechSynthesisUtterance === "function");
    return () => { if (typeof window !== "undefined" && window.speechSynthesis && speakingRef.current) window.speechSynthesis.cancel(); };
  }, []);
  if (!supported || !text.trim()) return null;

  const toggle = () => {
    const synth = window.speechSynthesis;
    if (speaking) { synth.cancel(); setSpeaking(false); speakingRef.current = false; return; }
    synth.cancel();
    const tag = speechLang(lang ?? locale);
    const u = new SpeechSynthesisUtterance(plain(text));
    u.lang = tag;
    const voice = synth.getVoices().find((v) => v.lang === tag) ?? synth.getVoices().find((v) => v.lang.startsWith(tag.split("-")[0]));
    if (voice) u.voice = voice;
    u.onend = u.onerror = () => { setSpeaking(false); speakingRef.current = false; };
    synth.speak(u);
    setSpeaking(true); speakingRef.current = true;
  };
  return (
    <button type="button" onClick={toggle} aria-pressed={speaking} aria-label={speaking ? L.stopReading : L.readAloud} title={speaking ? L.stopReading : L.readAloud} data-testid={testId}
      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs text-muted-foreground transition hover:bg-muted hover:text-foreground">
      {speaking ? <VolumeX className="size-3.5" aria-hidden /> : <Volume2 className="size-3.5" aria-hidden />}
      <span>{speaking ? L.stopReading : L.readAloud}</span>
    </button>
  );
}

/** Adds spoken text to what is already typed. */
export const appendSpoken = (current: string, spoken: string) => (current.trim() ? `${current.trimEnd()} ${spoken}` : spoken);
