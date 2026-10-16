import { useState } from "react";
import { getTheme, NEXT_THEME, setTheme, THEME_LABEL, type Theme } from "../theme";
import { Icon } from "./Icon";

const ICON: Record<Theme, string> = { system: "monitor", light: "sun", dark: "moon" };

export function ThemeToggle() {
  const [theme, set] = useState<Theme>(getTheme);
  const next = NEXT_THEME[theme];
  return (
    <button
      type="button"
      className="icon-btn"
      onClick={() => {
        setTheme(next);
        set(next);
      }}
      aria-label={`Colour theme: ${THEME_LABEL[theme]}. Switch to ${THEME_LABEL[next]}`}
      title={`Theme: ${THEME_LABEL[theme]}`}
    >
      <Icon name={ICON[theme]} />
    </button>
  );
}
