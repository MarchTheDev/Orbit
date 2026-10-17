import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { getCurrentWindow } from "@tauri-apps/api/window";
import "./index.css";
import App from "./App";
import { OverlayView } from "./components/OverlayView";
import { isNative } from "./services/native";

function overlayWindow(): boolean {
  if ((window as Window & { __ORBIT_OVERLAY__?: boolean }).__ORBIT_OVERLAY__ === true) return true;
  if (!isNative()) return false;
  try {
    return getCurrentWindow().label === "overlay";
  } catch {
    return false;
  }
}

const Root = overlayWindow() ? OverlayView : App;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Root />
  </StrictMode>
);
