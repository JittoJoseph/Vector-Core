"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

export function Header() {
  const [time, setTime] = useState<Date | null>(null);
  const [mounted, setMounted] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    setMounted(true);
    setTime(new Date());
    const timer = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const navItems = [
    { href: "/", label: "Dashboard" },
    { href: "/settings", label: "Settings" },
  ];

  if (!mounted || !time) {
    return (
      <div className="pt-4 px-4 max-w-7xl mx-auto w-full">
        <header className="flex items-center justify-between w-full h-10 px-5 border border-border/30 bg-card/25 rounded-xl">
          <h1 className="text-sm font-bold font-sans tracking-tight text-foreground">
            Vector Core
          </h1>
          <div className="text-xs font-medium text-muted-foreground tabular-nums">
            Loading...
          </div>
        </header>
      </div>
    );
  }

  return (
    <div className="pt-4 px-4 max-w-7xl mx-auto w-full">
      <header className="flex items-center justify-between w-full h-10 px-5 border border-border/30 bg-card/25 rounded-xl">
        <div className="flex items-center gap-6">
          <h1 className="text-sm font-bold font-sans tracking-tight text-foreground">
            Vector Core
          </h1>
          <nav className="flex items-center gap-4">
            {navItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={`text-xs font-medium font-sans transition-colors ${
                  pathname === item.href
                    ? "text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </div>

        <div className="text-[11px] font-medium font-sans text-muted-foreground tabular-nums flex items-center gap-2">
          <span className="hidden sm:inline">
            {time.toLocaleDateString("en-US", {
              weekday: "short",
              month: "short",
              day: "numeric",
            })}
          </span>
          <span className="text-foreground/80">
            {time.toLocaleTimeString("en-US", { hour12: false })}
          </span>
        </div>
      </header>
    </div>
  );
}
