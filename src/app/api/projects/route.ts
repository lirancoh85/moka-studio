import { route } from "@/lib/http";
import { createProject, listProjects } from "@/lib/project";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = route(async () => ({ projects: await listProjects() }));
export const POST = route(async () => ({ meta: await createProject() }));
