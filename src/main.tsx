import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles.css";

// Prevent scroll wheel from changing number/date/month inputs unless the user
// has explicitly clicked into them. This stops accidental value changes while
// scrolling the page on a laptop trackpad or mouse wheel.
document.addEventListener("wheel", () => {
  const el = document.activeElement as HTMLInputElement | null;
  if (
    el &&
    el.tagName === "INPUT" &&
    ["number", "date", "month", "time", "week"].includes(el.type) &&
    !el.readOnly
  ) {
    el.blur();
  }
}, { passive: true });

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
