import { Component, createElement, type ErrorInfo, type ReactNode } from "react";
import { createRoot } from "react-dom/client";

import "./app/app.css";

import { SleiApp } from "./app/SleiApp";
import { installFrontendCrashLogging, reportFrontendCrash } from "./lib/frontend-crash-logging";

class FrontendErrorBoundary extends Component<{ children: ReactNode }, { crashed: boolean }> {
  state = { crashed: false };

  componentDidCatch(error: Error, info: ErrorInfo) {
    this.setState({ crashed: true });
    reportFrontendCrash("react", error, info.componentStack ?? undefined);
  }

  render() {
    if (this.state.crashed) {
      return createElement(
        "main",
        { className: "slei-crash-screen", role: "alert" },
        createElement("h1", null, "Slei 前端渲染异常"),
        createElement("p", null, "崩溃日志已写入开发终端，请搜索 [slei-frontend-crash]。"),
      );
    }
    return this.props.children;
  }
}

const root = document.querySelector<HTMLElement>("#app");

if (!root) {
  throw new Error("Slei desktop root element is missing");
}

installFrontendCrashLogging();

createRoot(root).render(createElement(FrontendErrorBoundary, null, createElement(SleiApp)));
