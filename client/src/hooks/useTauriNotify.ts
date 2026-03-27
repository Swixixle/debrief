import { useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";

function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export function useTauriNotify() {
  const notify = useCallback(async (title: string, body: string) => {
    if (!isTauri()) return;
    try {
      await invoke("notify_complete", { title, body });
    } catch {
      /* ignore */
    }
  }, []);

  const setTrayStatus = useCallback(async (tooltip: string) => {
    if (!isTauri()) return;
    try {
      await invoke("update_tray_tooltip", { tooltip });
    } catch {
      /* ignore */
    }
  }, []);

  return { notify, setTrayStatus, isTauri: isTauri() };
}
