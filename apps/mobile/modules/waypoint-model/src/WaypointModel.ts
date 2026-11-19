import { requireNativeModule } from "expo";

export type ModelAvailability = "available" | "device_not_eligible" | "apple_intelligence_off" | "model_not_ready" | "unavailable";

type NativeModel = {
  getAvailability(): ModelAvailability;
  getContextSize(): number;
  makeCards(text: string, max: number): Promise<unknown>;
  makeQuiz(text: string, count: number): Promise<unknown>;
  helpWithProblem(problem: string, context: string): Promise<unknown>;
};

const native = requireNativeModule<NativeModel>("WaypointModel");

export const getAvailability = (): ModelAvailability => native.getAvailability();
export const getContextSize = (): number => native.getContextSize();
export const makeCards = (text: string, max: number): Promise<unknown> => native.makeCards(text, max);
export const makeQuiz = (text: string, count: number): Promise<unknown> => native.makeQuiz(text, count);
export const helpWithProblem = (problem: string, context: string): Promise<unknown> => native.helpWithProblem(problem, context);
