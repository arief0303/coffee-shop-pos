import { SignOutButton } from "@/components/auth-context";

type TopBarProps = {
  subtitle: string;
  online: boolean;
  pending: number;
  children?: React.ReactNode;
};

export function TopBar({ subtitle, online, pending, children }: TopBarProps) {
  return (
    <header className="topbar">
      <div className="brand-lockup">
        <span className="brand-mark" aria-hidden="true">☕</span>
        <div><strong>Bean Counter</strong><span>{subtitle}</span></div>
      </div>
      <nav className="topbar-actions" aria-label="Main">
        <span className={`connection ${online ? "is-online" : "is-offline"}`}><i aria-hidden="true" />{online ? "Online" : "Offline"}</span>
        {pending > 0 && <span className="pending-chip" title="Changes saved on this device that have not reached Google Sheets yet">{pending} unsynced</span>}
        {children}
        <SignOutButton />
      </nav>
    </header>
  );
}
