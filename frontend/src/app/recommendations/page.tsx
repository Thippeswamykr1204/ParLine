"use client";

import { RecFeed } from "@/components/recs/rec-feed";
import { useApp } from "@/components/providers/app-provider";
import { PageHeader } from "@/components/shared/page-header";
import { ErrorState } from "@/components/shared/states";
import { barLabel } from "@/lib/engine/aggregate";
import { POLICIES } from "@/lib/engine/policy";

export default function RecommendationsPage() {
  const { status, error, retry, bar, policy } = useApp();
  if (status === "error") return <ErrorState message={error ?? "Unknown error."} onRetry={retry} />;
  return (
    <>
      <PageHeader
        title="Recommendations"
        description={`Prioritised actions for ${barLabel(bar)} under ${POLICIES[policy].label.toLowerCase()}. Class A items come first, then the fastest-moving.`}
      />
      <RecFeed />
    </>
  );
}
