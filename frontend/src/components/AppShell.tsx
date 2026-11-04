"use client";

import WorkbenchShell from "@/components/workbench/WorkbenchShell";

export default function AppShell({
  children,
  title,
  subtitle,
  actions,
}: {
  children: React.ReactNode;
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
}) {
  return (
    <WorkbenchShell
      project={
        <div className="min-w-0">
          <span className="truncate text-[13px] font-semibold tracking-tight text-nx-ink">{title}</span>
          {subtitle && <span className="ml-2 hidden truncate text-xs text-nx-muted lg:inline">{subtitle}</span>}
        </div>
      }
      actions={actions}
    >
      <div className="p-4">{children}</div>
    </WorkbenchShell>
  );
}
