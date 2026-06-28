export type {
  AlertTimelineEvent,
  DailyTrajectory,
  OutbreakParams,
  OutbreakSummary,
  RunDetail,
  RunResult,
  ScenarioDetail,
  ScenarioRunSummary,
  ScenarioSummary,
} from "@/lib/platform-api";

export {
  getScenario,
  getScenarioRun,
  injectScenario,
  listScenarios,
  runScenario,
} from "@/lib/platform-api";

/** @deprecated Use ScenarioRunSummary from platform-api */
export type SimulationRun = import("@/lib/platform-api").ScenarioRunSummary;
