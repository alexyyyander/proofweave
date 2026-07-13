import { Footer, Header } from "../ui";
import { WorkbenchClient } from "./WorkbenchClient";

export default function WorkbenchPage() {
  return (
    <div className="site-shell app-shell">
      <Header active="workbench" />
      <main className="workbench-main">
        <WorkbenchClient />
      </main>
      <Footer />
    </div>
  );
}
