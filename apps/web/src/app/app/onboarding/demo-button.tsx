"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui";
import { apiSend } from "@/lib/api";

export function DemoButton({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <>
      <Button
        size="sm"
        loading={loading}
        onClick={async () => {
          setLoading(true);
          setErr(null);
          try {
            const r = await apiSend<{ source: { id: string } }>(`/api/v1/projects/${projectId}/demo`, "POST", {});
            router.push(`/app/p/${projectId}/overview?source=${r.source.id}&range=-30d`);
          } catch (e) {
            setErr((e as Error).message);
            setLoading(false);
          }
        }}
      >
        Explore the demo
      </Button>
      {err && <span className="text-neg">{err}</span>}
    </>
  );
}
