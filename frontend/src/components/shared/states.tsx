import { AlertOctagon, SearchX } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export function ErrorState({ title = "The data could not be loaded", message, onRetry }: { title?: string; message: string; onRetry?: () => void }) {
  return (
    <Card className="mx-auto mt-10 max-w-xl p-8 text-center" role="alert">
      <AlertOctagon className="mx-auto h-8 w-8 text-critical" aria-hidden="true" />
      <h2 className="mt-3 text-xl font-semibold">{title}</h2>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{message}</p>
      {onRetry && (
        <Button className="mt-5" onClick={onRetry}>
          Try again
        </Button>
      )}
    </Card>
  );
}

export function EmptyState({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      <SearchX className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
      <h3 className="mt-3 text-lg font-semibold">{title}</h3>
      <p className="mt-1 max-w-sm text-sm text-muted-foreground">{description}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
