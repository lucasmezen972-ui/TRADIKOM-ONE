"use client";
import { useState } from "react";
export function DocumentDownload({ attachmentId, fileName }: { attachmentId: string; fileName: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function download() {
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/conversation/files/${encodeURIComponent(attachmentId)}`, { method: "POST", credentials: "same-origin", cache: "no-store" });
      if (!response.ok) throw new Error();
      const url = URL.createObjectURL(await response.blob());
      const anchor = document.createElement("a"); anchor.href = url; anchor.download = fileName; anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch { setError("Téléchargement indisponible. Vérifiez votre accès au fil."); }
    finally { setBusy(false); }
  }
  return <div><button type="button" disabled={busy} onClick={download} className="min-h-11 rounded border px-3 py-2 text-xs">{busy ? "Téléchargement…" : `Télécharger ${fileName}`}</button>
    {error ? <p role="alert" className="text-xs text-red-700">{error}</p> : null}</div>;
}
