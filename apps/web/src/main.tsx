import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import { App } from "./App";
import { SessionProvider } from "./shell/session";
import { ConfirmProvider, ToastProvider } from "./ui";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <ToastProvider>
        <ConfirmProvider>
          <SessionProvider>
            <App />
          </SessionProvider>
        </ConfirmProvider>
      </ToastProvider>
    </BrowserRouter>
  </StrictMode>,
);
