"use client";

import { Suspense } from "react";
import { InventoryTable, TableSkeleton } from "@/components/inventory/inventory-table";
import { useApp } from "@/components/providers/app-provider";
import { PageHeader } from "@/components/shared/page-header";
import { ErrorState } from "@/components/shared/states";
import { barLabel } from "@/lib/engine/aggregate";
import { POLICIES } from "@/lib/engine/policy";

export default function InventoryPage() {
  const { status, error, retry, bar, policy } = useApp();
  if (status === "error") return <ErrorState message={error ?? "Unknown error."} onRetry={retry} />;
  return (
    <>
      <PageHeader
        title="Inventory"
        description={`Par levels, reorder points and cover for ${barLabel(bar)}, using ${POLICIES[policy].label.toLowerCase()}.`}
      />
      <Suspense fallback={<TableSkeleton />}>
        <InventoryTable />
      </Suspense>
    </>
  );
}
