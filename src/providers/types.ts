export type JsonValue =
  null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type EntryValue = null | string | JsonValue[] | { [key: string]: JsonValue };
export interface ChoiceQuestion {
  type: "choice";
  instructions: EntryValue;
  criteria: Record<string, EntryValue>;
}
export interface DecisionPayload {
  model: string;
  state: { [key: string]: JsonValue };
  questions: Record<string, ChoiceQuestion>;
}
export interface DecisionProvider {
  id: string;
  model: string;
  validateInput?(payload: DecisionPayload): void;
  classify(payload: DecisionPayload, signal: AbortSignal): Promise<unknown>;
}
