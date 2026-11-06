import { describe, expect, it } from "vitest";
import { observeHttpStatus, type HttpStatusObservation } from "../eval/http-status-observer.js";

describe("evaluation status-only diagnostics", () => {
  it("records rejection status without reading or replacing the body or request", async () => {
    const records: HttpStatusObservation[] = [];
    const response = new Response("private upstream body", { status: 402 });
    const init = {
      method: "POST",
      headers: { authorization: "private credential" },
      body: "private text",
    };
    const send: typeof fetch = async (input, received) => {
      expect(input).toBe("https://api.example.invalid/inference");
      expect(received).toBe(init);
      return response;
    };
    const result = await observeHttpStatus(send, (r) => records.push(r))(
      "https://api.example.invalid/inference",
      init,
    );
    expect(result).toBe(response);
    expect(result.bodyUsed).toBe(false);
    expect(records).toEqual([{ sequence: 1, status: 402 }]);
    expect(JSON.stringify(records)).not.toContain("private");
  });
  it("distinguishes absence of an HTTP response and preserves the original error", async () => {
    const records: HttpStatusObservation[] = [];
    const error = new Error("private network detail");
    const send: typeof fetch = async () => {
      throw error;
    };
    const observed = observeHttpStatus(send, (r) => records.push(r));
    await expect(observed("https://api.example.invalid")).rejects.toBe(error);
    expect(records).toEqual([{ sequence: 1, status: null }]);
  });
});
