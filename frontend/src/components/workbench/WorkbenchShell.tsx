"use client";

import { useEffect, useState } from "react";
import NavRail from "@/components/workbench/NavRail";
import TopBar from "@/components/workbench/TopBar";
import BottomDock, { type DockTab } from "@/components/workbench/BottomDock";
import StatusBar from "@/components/StatusBar";
import AssistantDrawer from "@/components/assistant/AssistantDrawer";

function usePersistentFlag(key: string, initial: boolean): [boolean, () => void] {
  // Narrow viewports overlay panels on top of the canvas: default them to
  // collapsed so the workspace stays visible. A stored preference always wins.
  const [value, setValue] = useState(initial);
  useEffect(() => {
    try {
      const stored = localStorage.getItem(key);
      if (stored !== null) setValue(stored === "1");
      else if (window.innerWidth < 1024) setValue(false);
    } catch {
      /* private mode */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const toggle = () => {
    setValue((v) => {
      try {
        localStorage.setItem(key, v ? "0" : "1");
      } catch {
        /* private mode */
      }
      return !v;
    });
  };
  return [value, toggle];
}

export default function WorkbenchShell({
  project,
  actions,
  leftTitle,
  leftPanel,
  rightTitle,
  rightPanel,
  dockTabs,
  children,
  centerScroll = true,
}: {
  project?: React.ReactNode;
  actions?: React.ReactNode;
  leftTitle?: string;
  leftPanel?: React.ReactNode;
  rightTitle?: string;
  rightPanel?: React.ReactNode;
  dockTabs?: DockTab[];
  children: React.ReactNode;
  centerScroll?: boolean;
}) {
  const [leftOpen, toggleLeft] = usePersistentFlag("nx-panel-left", true);
  const [rightOpen, toggleRight] = usePersistentFlag("nx-panel-right", true);
  const [dockOpen, toggleDock] = usePersistentFlag("nx-dock", false);
  const [dockTab, setDockTab] = useState(dockTabs?.[0]?.id ?? "");

  const showLeft = leftOpen && leftPanel;
  const showRight = rightOpen && rightPanel;

  return (
    <div className="flex h-screen flex-col">
      <TopBar project={project} actions={actions} />
      <div className="flex min-h-0 flex-1">
        <NavRail />
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="relative flex min-h-0 flex-1">
            {leftPanel && (
              <button
                onClick={toggleLeft}
                aria-expanded={leftOpen}
                title={leftOpen ? "Collapse left panel" : "Expand left panel"}
                className="z-10 flex w-5 shrink-0 items-center justify-center border-r border-nx-line bg-nx-panel font-mono text-[10px] text-nx-muted hover:text-nx-accent"
              >
                {leftOpen ? "◂" : "▸"}
              </button>
            )}
            {showLeft && (
              <aside className="nx-panel-left flex w-56 shrink-0 flex-col border-r border-nx-line bg-nx-panel max-lg:absolute max-lg:bottom-0 max-lg:left-5 max-lg:top-0 max-lg:z-20 max-lg:w-64 max-lg:shadow-2xl xl:w-64">
                {leftTitle && (
                  <p className="nx-label shrink-0 border-b border-nx-line px-4 py-3">{leftTitle}</p>
                )}
                <div className="min-h-0 flex-1 overflow-y-auto p-4">{leftPanel}</div>
              </aside>
            )}
            <main className={`relative min-w-0 flex-1 bg-nx-workspace ${centerScroll ? "overflow-y-auto" : "overflow-hidden"}`}>
              {children}
            </main>
            {showRight && (
              <aside className="nx-panel-right flex w-72 shrink-0 flex-col border-l border-nx-line bg-nx-panel max-lg:absolute max-lg:bottom-0 max-lg:right-0 max-lg:top-0 max-lg:z-20 max-lg:w-80 max-lg:shadow-2xl xl:w-80">
                {rightTitle && (
                  <p className="nx-label shrink-0 border-b border-nx-line px-4 py-3">{rightTitle}</p>
                )}
                <div className="min-h-0 flex-1 overflow-y-auto p-4">{rightPanel}</div>
              </aside>
            )}
            {rightPanel && (
              <button
                onClick={toggleRight}
                aria-expanded={rightOpen}
                title={rightOpen ? "Collapse inspector" : "Expand inspector"}
                className="z-10 flex w-5 shrink-0 items-center justify-center border-l border-nx-line bg-nx-panel font-mono text-[10px] text-nx-muted hover:text-nx-accent"
              >
                {rightOpen ? "▸" : "◂"}
              </button>
            )}
            <AssistantDrawer />
          </div>
          {dockTabs && dockTabs.length > 0 && (
            <BottomDock
              tabs={dockTabs}
              open={dockOpen}
              activeTab={dockTab || dockTabs[0].id}
              onToggle={toggleDock}
              onSelectTab={setDockTab}
            />
          )}
        </div>
      </div>
      <StatusBar />
    </div>
  );
}
