import "@/components/app-shell/app-shell.css";

/**
 * Layout of the no-access page. It only loads the frame's stylesheet: the
 * page sits OUTSIDE the `(app)` group on purpose, because that layout calls
 * `requireAccess()` and would redirect here again (a loop).
 */
export default function NoAccessLayout({ children }: { children: React.ReactNode }) {
  return children;
}
