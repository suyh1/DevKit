import { createRoot } from "react-dom/client";
import ProjectCenter from "./ProjectCenter";
import "./styles.css";
document.documentElement.dataset.theme = matchMedia(
  "(prefers-color-scheme: dark)",
).matches
  ? "dark"
  : "light";
createRoot(document.getElementById("root")!).render(<ProjectCenter portal />);
