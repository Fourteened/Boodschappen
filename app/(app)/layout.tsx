import { requireHousehold } from "@/lib/household";
import { BottomNav } from "./bottom-nav";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  await requireHousehold();

  return (
    <div className="shell">
      <main className="shell-main">{children}</main>
      <BottomNav />
    </div>
  );
}
