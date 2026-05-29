import { createElement } from "react";
import { createRoot } from "react-dom/client";

import "@slei/ui/styles/tokens.css";
import "@slei/ui/styles/globals.css";

import { SleiApp } from "./app/SleiApp";

const root = document.querySelector<HTMLElement>("#app");

if (!root) {
  throw new Error("Slei desktop root element is missing");
}

createRoot(root).render(createElement(SleiApp));
