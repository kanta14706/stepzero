import { createService, realDeps } from "./service.ts";

const service = createService(realDeps);
Deno.serve((req) => service.handle(req));
