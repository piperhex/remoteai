import { initializeTheme } from './theme/preference';
import React from "react";
import ReactDOM from "react-dom/client";
import { Provider } from "react-redux";
import { App as AntApp } from "antd";
import { WebLocaleProvider } from './i18n/WebLocaleProvider';
import App from "./App";
import { StartupUpdatePrompt } from './update/StartupUpdatePrompt';
import { store } from "./store";
import "antd/dist/reset.css";
import "antd-mobile/es/global";
import "./styles.css";

initializeTheme();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Provider store={store}>
      <WebLocaleProvider><AntApp><App /><StartupUpdatePrompt /></AntApp></WebLocaleProvider>
    </Provider>
  </React.StrictMode>,
);
