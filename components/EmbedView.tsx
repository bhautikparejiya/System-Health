"use client";

import { useEffect, useState } from "react";
import { Dashboard } from "./Dashboard";

/** Read-only view for the HighLevel dashboard "Embed" widget: /embed?l=<locationId>&k=<key> */
export function EmbedView() {
  const [params, setParams] = useState<{ l: string; k: string } | null | undefined>(undefined);
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const l = p.get("l");
    const k = p.get("k");
    setParams(l && k ? { l, k } : null);
  }, []);
  if (params === undefined) return null;
  if (params === null) return <div className="center muted">This link is incomplete. Copy it again from the app&apos;s Settings tab.</div>;
  return <Dashboard locationId={params.l} auth={{ embedKey: params.k }} compact />;
}
