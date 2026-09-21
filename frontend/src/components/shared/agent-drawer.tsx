"use client";

/**
 * Tier 7: minimal chat panel that asks the backend agent (POST /api/v1/agent/ask)
 * to explain already-computed numbers. It never computes anything client-side --
 * it only renders the grounded answer (and the tool calls behind it) the backend returns.
 * Requires NEXT_PUBLIC_DATA_SOURCE=api (or NEXT_PUBLIC_AGENT_BASE_URL set) since the agent
 * lives on the FastAPI backend, not in the static CSV mode.
 */
import { useState } from "react";
import { MessageCircle, Send, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useApp } from "@/components/providers/app-provider";
import { cn } from "@/lib/utils";

interface ToolCall {
  tool: string;
  input: Record<string, unknown>;
  result: Record<string, unknown>;
}
interface Turn {
  role: "user" | "assistant";
  text: string;
  toolCalls?: ToolCall[];
  isError?: boolean;
}

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000";

const EXAMPLES = ["Why is Grey Goose high-risk at Johnson's Bar?", "What's the par level for this item?", "Which policy actually won the simulation, and why?"];

/** Minimal, safe renderer for the assistant's light formatting: **bold**, "- " / "* " bullets, paragraphs. */
function renderInline(text: string) {
  return text
    .split(/(\*\*[^*]+\*\*)/g)
    .filter(Boolean)
    .map((part, i) =>
      part.startsWith("**") && part.endsWith("**")
        ? <strong key={i} className="font-semibold">{part.slice(2, -2)}</strong>
        : <span key={i}>{part.replace(/\*\*/g, "")}</span>,
    );
}

function AnswerText({ text }: { text: string }) {
  const blocks: { type: "p" | "ul"; items: string[] }[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const bullet = line.match(/^(?:[-*\u2022])\s+(.*)$/);
    const last = blocks[blocks.length - 1];
    if (bullet) {
      if (last?.type === "ul") last.items.push(bullet[1]);
      else blocks.push({ type: "ul", items: [bullet[1]] });
    } else blocks.push({ type: "p", items: [line] });
  }
  return (
    <div className="space-y-2 leading-relaxed">
      {blocks.map((b, i) =>
        b.type === "ul" ? (
          <ul key={i} className="list-disc space-y-1 pl-4">
            {b.items.map((it, j) => <li key={j}>{renderInline(it)}</li>)}
          </ul>
        ) : (
          <p key={i}>{renderInline(b.items[0])}</p>
        ),
      )}
    </div>
  );
}

export function AgentDrawer() {
  const { bar } = useApp();
  const [open, setOpen] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);

  async function ask(question: string) {
    if (!question.trim() || busy) return;
    setTurns((t) => [...t, { role: "user", text: question }]);
    setInput("");
    setBusy(true);
    try {
      const res = await fetch(`${API_BASE}/api/v1/agent/ask`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, bar: bar !== "all" ? bar : undefined }),
      });
      const data = await res.json();
      if (data.error || !data.answer) {
        setTurns((t) => [...t, { role: "assistant", text: data.error || "I don't have data to answer that.", isError: true }]);
      } else {
        setTurns((t) => [...t, { role: "assistant", text: data.answer, toolCalls: data.tool_calls }]);
      }
    } catch {
      setTurns((t) => [...t, { role: "assistant", text: "Couldn't reach the agent backend. Is the API running?", isError: true }]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button
        onClick={() => setOpen(true)}
        size="icon"
        aria-label="Ask ParLine about this data"
        className="fixed bottom-5 right-5 z-50 h-12 w-12 rounded-full shadow-lg"
      >
        <MessageCircle className="h-5 w-5" />
      </Button>

      {open && (
        <div className="fixed inset-y-0 right-0 z-50 flex w-full max-w-sm flex-col border-l bg-background shadow-2xl">
          <div className="flex items-center justify-between border-b px-4 py-3">
            <div>
              <p className="font-display text-sm font-semibold">Ask ParLine</p>
              <p className="text-xs text-muted-foreground">Explains the numbers already on screen. Never re-forecasts.</p>
            </div>
            <Button variant="ghost" size="icon" onClick={() => setOpen(false)} aria-label="Close">
              <X className="h-4 w-4" />
            </Button>
          </div>

          <div className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
            {turns.length === 0 && (
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">Try asking:</p>
                {EXAMPLES.map((ex) => (
                  <button key={ex} onClick={() => ask(ex)} className="block w-full rounded-md border px-3 py-2 text-left text-xs hover:bg-muted">
                    {ex}
                  </button>
                ))}
              </div>
            )}
            {turns.map((t, i) => (
              <div key={i} className={cn("rounded-lg px-3 py-2 text-sm", t.role === "user" ? "ml-6 bg-primary text-primary-foreground" : "mr-6 bg-muted", t.isError && "border border-destructive/40 text-destructive")}>
                {t.role === "assistant" && !t.isError ? <AnswerText text={t.text} /> : <p className="whitespace-pre-wrap">{t.text}</p>}
                {!!t.toolCalls?.length && (
                  <details className="mt-1.5 text-[11px] opacity-70">
                    <summary className="cursor-pointer">grounded in {t.toolCalls.length} tool call{t.toolCalls.length > 1 ? "s" : ""}</summary>
                    <ul className="mt-1 space-y-1">
                      {t.toolCalls.map((tc, j) => (
                        <li key={j} className="font-mono">{tc.tool}({JSON.stringify(tc.input)})</li>
                      ))}
                    </ul>
                  </details>
                )}
              </div>
            ))}
            {busy && <p className="mr-6 rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">Checking the data…</p>}
          </div>

          <form
            className="flex items-center gap-2 border-t p-3"
            onSubmit={(e) => {
              e.preventDefault();
              ask(input);
            }}
          >
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask about a bar, brand, or policy…"
              className="h-9 flex-1 rounded-md border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
            />
            <Button type="submit" size="icon" disabled={busy} aria-label="Send">
              <Send className="h-4 w-4" />
            </Button>
          </form>
        </div>
      )}
    </>
  );
}