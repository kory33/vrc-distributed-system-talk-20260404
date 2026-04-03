import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";

const rootElement = document.getElementById("root");
if (rootElement === null) {
  throw new Error('Expected an element with id "root" to mount the application.');
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
