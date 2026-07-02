import { ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { navigate } from "../App";
import { userIsAdmin, watchAuth } from "../lib/firebaseClient";

interface AdminGateProps {
  children: React.ReactNode;
}

export function AdminGate({ children }: AdminGateProps) {
  const [state, setState] = useState<"checking" | "allowed" | "denied">("checking");

  useEffect(() => {
    return watchAuth((user) => {
      if (!user) {
        setState("denied");
        return;
      }
      userIsAdmin(user)
        .then((allowed) => setState(allowed ? "allowed" : "denied"))
        .catch(() => setState("denied"));
    });
  }, []);

  if (state === "allowed") return <>{children}</>;

  return (
    <main className="page-shell narrow">
      <section className="empty-state">
        <ShieldCheck size={42} />
        <h1>{state === "checking" ? "Checking access" : "Member login required"}</h1>
        <p>
          Sign in with an authorized member account to continue. Customer accounts stay on the
          member side unless they are granted owner access.
        </p>
        {state === "denied" && (
          <button className="button button-primary" type="button" onClick={() => navigate("/login")}>
            Go to Login
          </button>
        )}
      </section>
    </main>
  );
}
