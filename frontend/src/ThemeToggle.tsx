import { Icon } from "./Icon.js";
import type { Theme } from "./useTheme.js";

/** Icon button that switches between the light and dark appearance. */
export function ThemeToggle(props: { theme: Theme; onToggle: () => void; className?: string }) {
  const label = "Switch to " + (props.theme === "dark" ? "light" : "dark") + " theme";
  return <button type="button" className={"theme-toggle" + (props.className ? " " + props.className : "")}
    onClick={props.onToggle} aria-label={label} title={label}>
    <Icon name={props.theme === "dark" ? "sun" : "moon"} size={18}/>
  </button>;
}
