import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { pushActivity } from "@/lib/activity-log";
import { apiFetch } from "@/lib/api";
import { getSessionToken } from "@/lib/auth";

export type LlmMessage = { role: "user" | "assistant"; content: string };

type LlmStatus = { configured: boolean; local?: boolean };

type LlmContextValue = {
  open: boolean;
  setOpen: (v: boolean) => void;
  messages: LlmMessage[];
  send: (text: string) => void;
  loading: boolean;
  configured: boolean;
  mock: boolean;
  local: boolean;
  refreshStatus: () => Promise<void>;
};

const LlmContext = createContext<LlmContextValue | null>(null);

export function LlmProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<LlmMessage[]>([
    {
      role: "assistant",
      content:
        "Assistant — ask live questions (e.g. “list alerts in the queue”). Configure your LLM in Settings → LLM; for Cursor/Claude use mobipwn-mcp instead.",
    },
  ]);
  const [loading, setLoading] = useState(false);
  const [configured, setConfigured] = useState(false);
  const [mock, setMock] = useState(false);
  const [local, setLocal] = useState(false);

  const refreshStatus = useCallback(async () => {
    if (!getSessionToken()) {
      setConfigured(false);
      setLocal(false);
      setMock(true);
      return;
    }
    try {
      const s = await apiFetch<LlmStatus>("/v1/llm/status");
      setConfigured(s.configured);
      setLocal(Boolean(s.local));
      setMock(!s.configured);
    } catch {
      setConfigured(false);
      setLocal(false);
      setMock(true);
    }
  }, []);

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  useEffect(() => {
    if (open) void refreshStatus();
  }, [open, refreshStatus]);

  const send = async (text: string) => {
    if (!text.trim()) return;
    pushActivity("info", "app", "LLM chat", { detail: text.trim().slice(0, 200) });
    const next = [...messages, { role: "user" as const, content: text.trim() }];
    setMessages(next);
    setLoading(true);
    try {
      const res = await apiFetch<{
        message: { role: string; content: string };
        mock: boolean;
      }>("/v1/llm/chat", {
        method: "POST",
        body: JSON.stringify({
          messages: next.map((m) => ({ role: m.role, content: m.content })),
        }),
      });
      setMock(res.mock);
      setMessages((m) => [...m, { role: "assistant", content: res.message.content }]);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setMessages((m) => [...m, { role: "assistant", content: `Error: ${msg}` }]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <LlmContext.Provider
      value={{ open, setOpen, messages, send, loading, configured, mock, local, refreshStatus }}
    >
      {children}
    </LlmContext.Provider>
  );
}

export function useLlm() {
  const ctx = useContext(LlmContext);
  if (!ctx) throw new Error("useLlm requires LlmProvider");
  return ctx;
}
