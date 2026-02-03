import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";

/* 🔥 GLOBAL STYLES — REQUIRED */
import "./index.css";
import "./App.css";

const savedTheme = localStorage.getItem("vine_theme");
if (savedTheme === "dark") {
  document.documentElement.classList.add("theme-dark");
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
);
