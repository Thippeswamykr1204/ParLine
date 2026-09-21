"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { useApp } from "@/components/providers/app-provider";
import { ReplayPlayer } from "@/components/simulation/replay-player";
import { PolicyTable } from "@/components/simulation/policy-table";
import { PageHeader } from "@/components/shared/page-header";
import { ErrorState } from "@/components/shared/states";
import { Skeleton } from "@/components/ui/skeleton";
import { POLICIES } from "@/lib/engine/policy";

function Replay() {
  const params = useSearchParams();
  return <ReplayPlayer key={params.get("item") ?? "default"} initialItem={params.get("item")} />;
}

export default function SimulationPage() {
  const { status, error, retry, policy } = useApp();
  if (status === "error") return <ErrorState message={error ?? "Unknown error."} onRetry={retry} />;
  return (
    <div className="space-y-6">
      <PageHeader
        title="Simulation replay"
        description={`Watch ${POLICIES[policy].label.toLowerCase()} run through the backtest day by day. Stock is drawn against the par line, and every order, delivery and stockout is logged.`}
      />
      <Suspense fallback={<Skeleton className="h-[34rem] w-full rounded-panel" />}>
        <Replay />
      </Suspense>
      <PolicyTable />
    </div>
  );
}
