"use client";

import { useState } from "react";
import type { GameMode } from "@/lib/types";
import Game from "./Game";

export default function GameTabs() {
  const [mode, setMode] = useState<GameMode>("classic");
  return <Game key={mode} mode={mode} onModeChange={setMode} />;
}
