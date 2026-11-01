import type { ReactNode } from "react";
import { Icon, type IconName } from "./icon";

/** What is missing, in a sentence, and the one action that fixes it. */
export function EmptyState({
  icon = "calendar",
  title,
  children,
  action,
}: {
  icon?: IconName;
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 px-4 py-10 text-center">
      <Icon name={icon} size={32} className="text-text-muted" />
      <h2 className="t-title-2 m-0">{title}</h2>
      <p className="t-body m-0 max-w-[36ch] text-text-muted">{children}</p>
      {action}
    </div>
  );
}
