import { useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";

/** Legacy route — redirects to inline editor on the rules page. */
export default function RuleEditorPage() {
  const { id } = useParams();
  const navigate = useNavigate();

  useEffect(() => {
    if (!id || id === "new") {
      navigate("/rules?new=1", { replace: true });
    } else {
      navigate(`/rules?edit=${id}`, { replace: true });
    }
  }, [id, navigate]);

  return null;
}
