import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { resolveRuleId } from "@/lib/shortUrl";

export default function ShortRuleRedirect() {
  const { token = "" } = useParams();
  const navigate = useNavigate();
  const [error, setError] = useState("");

  useEffect(() => {
    if (!token) {
      navigate("/rules", { replace: true });
      return;
    }
    void resolveRuleId(token)
      .then((id) => navigate(`/rules?edit=${id}`, { replace: true }))
      .catch((e) => setError(String(e)));
  }, [token, navigate]);

  if (error) {
    return (
      <div className="p-4">
        <p className="error">Rule link not found: {error}</p>
        <button type="button" className="btn btn-secondary" onClick={() => navigate("/rules")}>
          Back to rules
        </button>
      </div>
    );
  }

  return <p className="muted p-4">Opening rule…</p>;
}
