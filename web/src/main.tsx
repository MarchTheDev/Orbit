import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App";
import { windowReady } from "./services/native";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);

// The window this is drawn in was created hidden, so that the opening animation
// is the first thing in it rather than the last thing after a flash of empty
// window. Two frames is enough for the overlay to be on screen, and the timer is
// there so that a front end which somehow never gets that far still appears.
requestAnimationFrame(() => requestAnimationFrame(() => void windowReady()));
window.setTimeout(() => void windowReady(), 2500);
