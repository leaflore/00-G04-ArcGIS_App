import { FunctionAgent } from "@arcgis/ai-components/agent-utils/FunctionAgent.js";

export function createResearchAgent(executeQuery) {
    return new FunctionAgent({
        name: "Wonderland cited research",
        description: "Search the Wonderland Park Avenue house catalog and cited architectural/landscape research. Use this agent for every question about house addresses, architects, dates, owners, contractors, landscape designers, Eckbo, Ain, social space, landscape, C.O.R.E., or readings. It can show matching research house points in the existing 3D scene. It returns catalog facts and source citations, with contextual theory separated from documented property claims. Examples: Show houses by Gregory Ain; Which houses were built before 1960?; What does Eckbo say about social space?; Tell me about 8941 Wonderland Park Avenue. This agent performs no web searches and no publishing, editing, or arbitrary code execution.",
        async execute(state) {
            const execution = state.agentExecutionContext || {};
            // Source text is searched as data. It never supplies tool names,
            // SQL, JavaScript, URLs to fetch, or instructions to this agent.
            const question = execution.userRequest || execution.assignedTask || "Show all houses";
            // Without outputSchema, FunctionAgent expects final message text;
            // it normalizes the structured orchestrator result itself.
            return executeQuery(String(question).slice(0, 1500));
        }
    });
}
