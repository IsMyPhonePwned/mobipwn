import { useState } from "react";
import { Bot, Send } from "lucide-react";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useActivityLog } from "@/contexts/ActivityLogContext";
import { useLlm } from "@/contexts/LlmContext";

export function AssistantPanel() {
  const { open, setOpen, messages, send, loading, configured, mock, local } = useLlm();
  const [draft, setDraft] = useState("");

  const submit = () => {
    send(draft);
    setDraft("");
  };

  const statusLabel = !configured ? "offline" : mock ? "demo" : local ? "local" : "live";

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetContent side="right" className="w-full max-w-lg sm:max-w-lg">
        <div className="flex items-center gap-2 pr-8">
          <Bot className="h-5 w-5 text-[var(--accent-purple)]" />
          <span className="font-medium">Assistant</span>
          <Badge variant="ai">{statusLabel}</Badge>
        </div>
        <p className="mt-1 text-xs text-[var(--muted-foreground)]">
          {!configured
            ? "Configure Ollama (local) or a hosted API in Settings → LLM assistant."
            : mock
              ? "Demo replies — set base URL and model in Settings → LLM assistant."
              : local
                ? "Local LLM · OpenAI-compatible /chat/completions"
                : "Remote LLM · OpenAI-compatible API"}
        </p>
        <ScrollArea className="mt-4 flex-1 min-h-[300px] max-h-[calc(100vh-200px)]">
          <div className="flex flex-col gap-3 pr-2">
            {messages.map((m, i) => (
              <div
                key={i}
                className={
                  m.role === "user"
                    ? "ml-8 rounded-[var(--radius)] bg-[color-mix(in_srgb,var(--accent-purple)_12%,var(--card-2))] p-2 text-xs"
                    : "mr-4 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--card-2)] p-2 text-xs"
                }
              >
                <div className="mb-1 font-mono text-[10px] uppercase tracking-wide text-[var(--muted-foreground)]">
                  {m.role}
                </div>
                {m.content}
              </div>
            ))}
            {loading && <p className="text-xs text-[var(--muted-foreground)]">Thinking…</p>}
          </div>
        </ScrollArea>
        <div className="mt-4 flex gap-2">
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Ask about alerts, mPL hunts, rules, triage…"
            onKeyDown={(e) => e.key === "Enter" && submit()}
          />
          <Button size="icon" onClick={submit} disabled={loading}>
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

export function AssistantSummon() {
  const { setOpen } = useLlm();
  const { log } = useActivityLog();
  return (
    <Button
      variant="outline"
      size="sm"
      className="border-[color-mix(in_srgb,var(--accent-purple)_35%,var(--border))] text-[var(--accent-purple)]"
      onClick={() => {
        log("info", "Open assistant panel");
        setOpen(true);
      }}
    >
      <Bot className="h-3.5 w-3.5" />
      Assistant
    </Button>
  );
}
