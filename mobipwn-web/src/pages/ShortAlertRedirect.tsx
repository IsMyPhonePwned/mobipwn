import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { resolveAlertId } from "@/lib/shortUrl";

export default function ShortAlertRedirect() {
  const { token = "" } = useParams();
  const navigate = useNavigate();
  const [error, setError] = useState("");

  useEffect(() => {
    if (!token) {
      navigate("/alerts", { replace: true });
      return;
    }
    void resolveAlertId(token)
      .then((id) => navigate(`/alerts?id=${id}`, { replace: true }))
      .catch((e) => setError(String(e)));
  }, [token, navigate]);

  if (error) {
    return (
      <div className="p-4">
        <p className="error">Alert link not found: {error}</p>
        <button type="button" className="btn btn-secondary" onClick={() => navigate("/alerts")}>
          Back to alerts
        </button>
      </div>
    );
  }

  return <p className="muted p-4">Opening alert…</p>;
}
