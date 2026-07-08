"use client";

import { useState, useEffect } from "react";
import { Header } from "./header";
import { SystemStatusIndicator } from "./system-status-indicator";
import { useSystemStats } from "@/lib/hooks";
import { getApiClient } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertTriangle,
  Lock,
  Play,
  Pause,
  Trash2,
  Settings,
  ShieldAlert,
  Check,
} from "lucide-react";

export function SettingsPage() {
  const {
    stats,
    loading: statsLoading,
    refetch: refetchStats,
  } = useSystemStats();
  const [password, setPassword] = useState("");
  const [isSaved, setIsSaved] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);
  const [isWipeOpen, setIsWipeOpen] = useState(false);
  const [wipePasswordConfirm, setWipePasswordConfirm] = useState("");
  const [isWiping, setIsWiping] = useState(false);
  const [isTogglingEngine, setIsTogglingEngine] = useState(false);

  // Load password from localStorage on mount
  useEffect(() => {
    const savedPassword = localStorage.getItem("vector_admin_password") || "";
    setPassword(savedPassword);
  }, []);

  const handleSavePassword = (e: React.FormEvent) => {
    e.preventDefault();
    localStorage.setItem("vector_admin_password", password);
    setIsSaved(true);
    setActionSuccess("Admin password saved locally.");
    setTimeout(() => {
      setIsSaved(false);
      setActionSuccess(null);
    }, 3000);
  };

  const handleToggleEngine = async () => {
    if (!password) {
      setActionError("Please save or enter your Admin Password first.");
      return;
    }
    setActionError(null);
    setActionSuccess(null);
    setIsTogglingEngine(true);

    try {
      const api = getApiClient();
      const isCurrentlyPaused = stats?.orchestrator?.paused ?? false;

      if (isCurrentlyPaused) {
        await api.resumeSystem(password);
        setActionSuccess("Trading system resumed successfully.");
      } else {
        await api.pauseSystem(password);
        setActionSuccess("Trading system paused successfully.");
      }
      await refetchStats();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setActionError(
        message || "Failed to toggle engine status. Verify your password.",
      );
    } finally {
      setIsTogglingEngine(false);
      setTimeout(() => setActionSuccess(null), 4000);
    }
  };

  const handleWipeSystem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!wipePasswordConfirm) {
      setActionError("Password required to wipe system data.");
      return;
    }
    setActionError(null);
    setActionSuccess(null);
    setIsWiping(true);

    try {
      const api = getApiClient();
      await api.wipeSystem(wipePasswordConfirm);
      setActionSuccess(
        "Simulation database wiped and portfolio reset to initial capital.",
      );
      setIsWipeOpen(false);
      setWipePasswordConfirm("");
      await refetchStats();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setActionError(
        message || "Failed to wipe system. Please check your password.",
      );
    } finally {
      setIsWiping(false);
      setTimeout(() => setActionSuccess(null), 5000);
    }
  };

  const isPaused = stats?.orchestrator?.paused ?? false;
  const isRunning = stats?.orchestrator?.running ?? false;

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col font-mono">
      <Header />
      <main className="flex-1 px-4 py-6 pb-16 max-w-4xl mx-auto w-full space-y-6">
        <div className="flex items-center gap-2 pb-2 border-b border-border/20">
          <Settings className="w-5 h-5 text-muted-foreground" />
          <h2 className="text-lg font-bold tracking-wider text-foreground">
            SYSTEM SETTINGS
          </h2>
        </div>

        {actionError && (
          <div className="flex items-center gap-2 p-3 bg-red-500/10 border border-red-500/20 text-red-400 text-xs rounded">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>{actionError}</span>
          </div>
        )}

        {actionSuccess && (
          <div className="flex items-center gap-2 p-3 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs rounded">
            <Check className="w-4 h-4 shrink-0" />
            <span>{actionSuccess}</span>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Left Column: Admin Credentials & System Operations */}
          <div className="space-y-6">
            {/* Admin Credentials Card */}
            <Card className="border-border/30 bg-card/30">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-semibold tracking-wider flex items-center gap-2 text-foreground">
                  <Lock className="w-4 h-4 text-muted-foreground" />
                  ADMIN CREDENTIALS
                </CardTitle>
                <CardDescription className="text-[11px] text-muted-foreground leading-normal">
                  Configure the authorization credentials required to execute
                  administrator commands on the backend.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleSavePassword} className="space-y-3">
                  <div className="space-y-1.5">
                    <label className="text-[10px] text-muted-foreground tracking-wider uppercase">
                      Admin Password
                    </label>
                    <Input
                      type="password"
                      placeholder="Enter admin password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="bg-background/50 border-border/40 focus:border-border/80 h-9 font-sans"
                    />
                  </div>
                  <Button
                    type="submit"
                    className="w-full h-8 text-[11px] font-semibold bg-muted hover:bg-muted/80 text-foreground border border-border/50"
                  >
                    {isSaved ? "SAVED LOCALLY" : "SAVE PASSWORD"}
                  </Button>
                </form>
              </CardContent>
            </Card>

            {/* System Actions Card */}
            <Card className="border-border/30 bg-card/30">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-semibold tracking-wider flex items-center gap-2 text-foreground">
                  <ShieldAlert className="w-4 h-4 text-muted-foreground" />
                  SYSTEM CONTROLS
                </CardTitle>
                <CardDescription className="text-[11px] text-muted-foreground leading-normal">
                  Admin commands to manage execution simulation and reset
                  databases.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Pause/Resume Section */}
                <div className="flex items-center justify-between p-3 border border-border/20 rounded bg-background/20">
                  <div className="space-y-0.5">
                    <div className="text-[11px] font-bold text-foreground">
                      TRADING ENGINE
                    </div>
                    <div className="text-[10px] text-muted-foreground">
                      Status:{" "}
                      <span
                        className={
                          isPaused
                            ? "text-red-400 font-bold"
                            : isRunning
                              ? "text-emerald-400 font-bold"
                              : "text-muted-foreground"
                        }
                      >
                        {isPaused ? "PAUSED" : isRunning ? "ACTIVE" : "IDLE"}
                      </span>
                    </div>
                  </div>
                  <Button
                    onClick={handleToggleEngine}
                    disabled={isTogglingEngine || statsLoading}
                    variant={isPaused ? "default" : "destructive"}
                    className={`h-8 px-4 text-[10px] font-bold tracking-wider flex items-center gap-1.5 ${
                      isPaused
                        ? "bg-emerald-600 hover:bg-emerald-500 text-white"
                        : "bg-red-950/40 hover:bg-red-950/60 border border-red-500/30 text-red-400"
                    }`}
                  >
                    {isTogglingEngine ? (
                      <span className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
                    ) : isPaused ? (
                      <>
                        <Play className="w-3.5 h-3.5" /> RESUME
                      </>
                    ) : (
                      <>
                        <Pause className="w-3.5 h-3.5" /> PAUSE
                      </>
                    )}
                  </Button>
                </div>

                {/* Wipe Section */}
                <div className="flex items-center justify-between p-3 border border-red-950/20 rounded bg-red-950/5">
                  <div className="space-y-0.5">
                    <div className="text-[11px] font-bold text-red-400">
                      WIPE DATABASE
                    </div>
                    <div className="text-[10px] text-muted-foreground">
                      Reset simulated trades, portfolio cash, and ROI logs.
                    </div>
                  </div>

                  <Dialog open={isWipeOpen} onOpenChange={setIsWipeOpen}>
                    <DialogTrigger asChild>
                      <Button
                        variant="destructive"
                        className="h-8 px-4 text-[10px] font-bold tracking-wider bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 text-red-400 flex items-center gap-1.5"
                      >
                        <Trash2 className="w-3.5 h-3.5" /> WIPE DATA
                      </Button>
                    </DialogTrigger>
                    <DialogContent className="bg-card border-border/30 max-w-md font-mono text-xs">
                      <DialogHeader className="space-y-2">
                        <DialogTitle className="text-sm font-bold text-red-400 flex items-center gap-2">
                          <AlertTriangle className="w-4 h-4" />
                          CONFIRM WIPE ACTION
                        </DialogTitle>
                        <DialogDescription className="text-[11px] text-muted-foreground font-mono leading-normal">
                          This action is highly destructive and completely
                          irreversible. It will wipe all simulated trade
                          positions (both open and closed) and reset the
                          portfolio balance to initial starting capital.
                        </DialogDescription>
                      </DialogHeader>

                      <form
                        onSubmit={handleWipeSystem}
                        className="space-y-4 pt-2"
                      >
                        <div className="space-y-1.5">
                          <label className="text-[10px] text-muted-foreground uppercase tracking-wider">
                            Type Admin Password to Confirm:
                          </label>
                          <Input
                            type="password"
                            placeholder="Admin Password"
                            required
                            value={wipePasswordConfirm}
                            onChange={(e) =>
                              setWipePasswordConfirm(e.target.value)
                            }
                            className="bg-background border-border/40 focus:border-border/80 h-9 font-sans text-xs"
                          />
                        </div>

                        <DialogFooter className="gap-2 sm:gap-0">
                          <Button
                            type="button"
                            variant="ghost"
                            onClick={() => {
                              setIsWipeOpen(false);
                              setWipePasswordConfirm("");
                            }}
                            className="h-9 text-[10px] tracking-wider"
                          >
                            CANCEL
                          </Button>
                          <Button
                            type="submit"
                            disabled={isWiping}
                            className="h-9 text-[10px] tracking-wider bg-red-600 hover:bg-red-500 text-white"
                          >
                            {isWiping ? (
                              <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                            ) : (
                              "CONFIRM WIPE & RESET"
                            )}
                          </Button>
                        </DialogFooter>
                      </form>
                    </DialogContent>
                  </Dialog>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Right Column: Read-only Server Configuration Display */}
          <div>
            <Card className="border-border/30 bg-card/30 h-full">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-semibold tracking-wider flex items-center gap-2 text-foreground">
                  <Settings className="w-4 h-4 text-muted-foreground" />
                  SERVER CONFIGURATION
                </CardTitle>
                <CardDescription className="text-[11px] text-muted-foreground leading-normal">
                  Read-only execution parameters. These values are configured
                  via server config json / environment files.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {statsLoading ? (
                  <div className="flex items-center justify-center py-12 text-xs text-muted-foreground animate-pulse">
                    Retrieving server configuration...
                  </div>
                ) : stats?.config ? (
                  <div className="divide-y divide-border/10 text-xs">
                    <ConfigItem
                      label="Initial Capital"
                      value={`$${stats.config.startingCapital}`}
                    />
                    <ConfigItem
                      label="Max Open Positions"
                      value={stats.config.maxPositions?.toString() ?? "N/A"}
                    />
                    <ConfigItem
                      label="Min NO Entry Price"
                      value={`${(stats.config.minNoEntryPrice * 100).toFixed(1)}¢`}
                    />
                    <ConfigItem
                      label="Max NO Entry Price"
                      value={`${(stats.config.maxNoEntryPrice * 100).toFixed(1)}¢`}
                    />

                    <ConfigItem
                      label="Min Risk/Reward"
                      value={`${stats.config.minRiskReward}×`}
                    />
                  </div>
                ) : (
                  <div className="text-center py-12 text-xs text-muted-foreground">
                    Unable to fetch server configuration.
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </main>

      <SystemStatusIndicator stats={stats} />
    </div>
  );
}

function ConfigItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between py-2 text-[11px]">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-foreground font-semibold font-mono">{value}</span>
    </div>
  );
}
