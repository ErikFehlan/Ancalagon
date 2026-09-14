import {handleAuthenticatedAnalysis} from "../analyze-patterns-beta/handler.ts";
export {handleAnalysis} from "./analysis.ts";
// Both public routes enforce a real user and workspace membership.
if (import.meta.main) Deno.serve(handleAuthenticatedAnalysis);
