"use client";

import { useEffect, useRef, useState } from "react";

type RecognitionResult = { isFinal: boolean; 0: { transcript: string } };
type Recognition = {
  lang: string; continuous: boolean; interimResults: boolean;
  onresult: ((event: { results: ArrayLike<RecognitionResult> }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void; stop(): void; abort(): void;
};
type RecognitionConstructor = new () => Recognition;

export function MessageComposer({ channel, title }: { channel: "web" | "test"; title: string }) {
  const [draft, setDraft] = useState("");
  const [consent, setConsent] = useState(false);
  const [recording, setRecording] = useState(false);
  const [status, setStatus] = useState("");
  const recognition = useRef<Recognition | null>(null);
  useEffect(() => () => {
    const current = recognition.current;
    if (current) { current.onresult = null; current.onerror = null; current.onend = null; current.abort(); }
  }, []);

  function dictate() {
    if (recognition.current) { recognition.current.stop(); return; }
    if (!consent) return;
    const speechWindow = window as unknown as { SpeechRecognition?: RecognitionConstructor; webkitSpeechRecognition?: RecognitionConstructor };
    const Constructor = speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition;
    if (!Constructor) { setStatus("La dictée n’est pas disponible dans ce navigateur. Saisissez votre message au clavier."); return; }
    const current = new Constructor();
    const initialDraft = draft.trimEnd();
    current.lang = "fr-FR"; current.continuous = false; current.interimResults = true;
    current.onresult = (event) => {
      const words = Array.from(event.results).map((result) => result[0].transcript).join(" ").trim();
      const text = [initialDraft, words].filter(Boolean).join(" ");
      setDraft(text.slice(0, 16_000));
      if (text.length > 16_000) { setStatus("Limite de 16 000 caractères atteinte."); current.stop(); }
    };
    current.onerror = (event) => {
      setStatus(event.error === "not-allowed" ? "L’accès au microphone a été refusé." : "La dictée a été interrompue. Vérifiez le texte avant de l’envoyer.");
      current.abort(); recognition.current = null; setRecording(false);
    };
    current.onend = () => { recognition.current = null; setRecording(false); setStatus(previous => previous.startsWith("Dictée en cours") ? "Dictée terminée. Relisez le texte avant de l’envoyer." : previous); };
    recognition.current = current;
    try { current.start(); setRecording(true); setStatus("Dictée en cours. Arrêtez puis relisez votre message avant de l’envoyer."); }
    catch { recognition.current = null; setRecording(false); setStatus("Impossible de démarrer le microphone."); }
  }

  return <>
    <textarea id={`message-${channel}`} name="message" aria-label={title} required maxLength={16_000} rows={3}
      value={draft} onChange={(event) => setDraft(event.target.value)} readOnly={recording}
      placeholder={channel === "web" ? "Que voulez-vous accomplir ?" : "Réponse simulée depuis un autre canal"}
      className="mt-3 w-full resize-y rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-100" />
    {channel === "web" ? <label className="mt-3 block text-xs text-slate-600">Joindre un document (TXT, CSV ou PDF texte, 512 Ko maximum)
      <input name="attachmentFile" type="file" accept=".txt,.csv,.pdf" disabled={recording} className="mt-1 block w-full" />
      L’original est conservé chiffré. L’extrait est filtré ; les PDF scannés nécessitent une version texte.
    </label> : null}
    {channel === "web" ? <div className="mt-2 space-y-2 text-xs text-slate-600">
      <label className="flex items-start gap-2"><input type="checkbox" checked={consent} disabled={recording}
        onChange={(event) => setConsent(event.target.checked)} />
        J’autorise la dictée du navigateur. Le fournisseur du navigateur peut traiter l’audio. Je relirai le texte avant envoi.
      </label>
      <button type="button" disabled={!consent} onClick={dictate} className="min-h-11 rounded border px-3 py-2 disabled:opacity-50">
        {recording ? "Arrêter la dictée" : "Dicter mon message"}
      </button>
      <p role="status" aria-live="polite">{status}</p>
    </div> : null}
    <button disabled={recording} className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-md bg-[#08111f] px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50">Envoyer</button>
  </>;
}
