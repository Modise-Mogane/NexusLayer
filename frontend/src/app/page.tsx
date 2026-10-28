"use client";

import { useState } from "react";
import TopToolbar from "@/components/TopToolbar";
import Sidebar from "@/components/Sidebar";
import PropertiesPanel from "@/components/PropertiesPanel";
import StatusBar from "@/components/StatusBar";
import TopologyCanvas, { type Selection } from "@/components/TopologyCanvas";

export default function DashboardPage() {
  const [selection, setSelection] = useState<Selection | null>(null);

  return (
    <div className="flex h-screen flex-col">
      <TopToolbar />
      <div className="flex min-h-0 flex-1">
        <Sidebar />
        <main className="min-w-0 flex-1 bg-slate-100">
          <TopologyCanvas onSelect={setSelection} />
        </main>
        <PropertiesPanel selection={selection} />
      </div>
      <StatusBar />
    </div>
  );
}
