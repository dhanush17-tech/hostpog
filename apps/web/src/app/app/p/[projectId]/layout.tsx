import { notFound, redirect } from "next/navigation";
import { Suspense, type ReactNode } from "react";
import { ProjectProvider } from "@/components/project-context";
import { Shell } from "@/components/shell";
import { getSessionUser, listAccessible, requireProject } from "@/server/authz";
import { HttpError } from "@/server/http";

export const dynamic = "force-dynamic";

export default async function ProjectLayout({ children, params }: { children: ReactNode; params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const user = await getSessionUser();
  if (!user) redirect(`/login?next=/app/p/${projectId}/overview`);
  let access;
  try {
    access = await requireProject(projectId);
  } catch (e) {
    if (e instanceof HttpError && e.status === 404) notFound();
    throw e;
  }
  const workspaces = await listAccessible(user.id);
  return (
    <Suspense>
      <ProjectProvider
        projectId={access.project.id}
        projectName={access.project.name}
        timezone={access.project.timezone}
        workspaceId={access.workspace.id}
        workspaceName={access.workspace.name}
        role={access.role}
      >
        <Shell workspaces={workspaces} user={{ name: user.name, email: user.email }}>
          {children}
        </Shell>
      </ProjectProvider>
    </Suspense>
  );
}
