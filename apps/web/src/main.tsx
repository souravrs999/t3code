import React from "react";
import ReactDOM from "react-dom/client";
import { RouterProvider } from "@tanstack/react-router";
import { createHashHistory, createBrowserHistory } from "@tanstack/react-router";

import "@xterm/xterm/css/xterm.css";
import "./index.css";

import { isDesktop, isTauri } from "./env";
import { getRouter } from "./router";
import { APP_DISPLAY_NAME } from "./branding";

// Initialize the Tauri bridge eagerly — before React renders — so that
// window.desktopBridge is populated by the time WsTransport resolves the URL.
if (isTauri) {
  const { createTauriBridge, initTauriBridge, initAutoZoom } = await import("./tauriBridge");
  initTauriBridge();
  window.desktopBridge = createTauriBridge();
  initAutoZoom().catch(() => {});
}

// Tauri and Electron both use hash routing so back-navigation works inside
// a desktop WebView without needing a server. Plain browser gets history-API.
const history = isDesktop ? createHashHistory() : createBrowserHistory();

const router = getRouter(history);

document.title = APP_DISPLAY_NAME;

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>,
);
