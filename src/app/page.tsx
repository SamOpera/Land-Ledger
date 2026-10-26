"use client";

import dynamic from "next/dynamic";

// The app keeps its chain state in the browser, so it renders on the client only.
const App = dynamic(() => import("@/components/App"), {
  ssr: false,
  loading: () => (
    <div className="boot">
      <p>Loading Land-Ledger…</p>
    </div>
  ),
});

export default function Page() {
  return <App />;
}
