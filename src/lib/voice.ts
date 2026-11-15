/** Voice labels shared by server and client components (a "use client" module can't export values to server files). */
export type VoiceLabels = { speak: string; stop: string; listening: string; readAloud: string; stopReading: string; privacy: string; denied: string; noSpeech: string };
/** FIRINGI back-office pages are English. */
export const EN_VOICE: VoiceLabels = {
  speak: "Speak instead of typing", stop: "Stop", listening: "Listening… speak now, tap again to stop", readAloud: "Read aloud", stopReading: "Stop reading",
  privacy: "Your browser turns your speech into text (Chrome and Edge use their online speech service).", denied: "The microphone is blocked — allow it in your browser settings.", noSpeech: "Didn't catch that — please try again.",
};
