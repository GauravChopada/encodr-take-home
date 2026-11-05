"use client";

import { useEffect, useReducer, useRef } from "react";
import { fetchEventSource } from "@microsoft/fetch-event-source";
import { authedFetch } from "@/lib/client/api";
import { isTerminalStage, parseRunEvent, type RunEvent, type Stage } from "@/lib/types";

export interface RunStreamState {
  stage: Stage | null;
  progressPct: number;
  log: string[];
  error: string | null;
  connected: boolean;
  done: boolean;
  /** Id (tick) of the last event applied; replays at or below it are ignored. */
  lastId: number;
}

export const initialRunStreamState: RunStreamState = {
  stage: null,
  progressPct: 0,
  log: [],
  error: null,
  connected: false,
  done: false,
  lastId: -1,
};

/** Applies one SSE event. Idempotent for replays, and a no-op once the run is terminal. */
export function reduceRunEvent(state: RunStreamState, event: RunEvent, id: number): RunStreamState {
  if (state.done || id <= state.lastId) return state;
  return {
    stage: event.stage,
    progressPct: event.progressPct,
    log: [...state.log, event.message],
    error: event.stage === "FAILED" ? event.error : state.error,
    connected: true,
    done: isTerminalStage(event.stage),
    lastId: id,
  };
}

type Action =
  | { type: "reset" }
  | { type: "event"; event: RunEvent; id: number }
  | { type: "connection"; connected: boolean }
  | { type: "fatal"; message: string };

function reducer(state: RunStreamState, action: Action): RunStreamState {
  switch (action.type) {
    case "reset":
      return initialRunStreamState;
    case "event":
      return reduceRunEvent(state, action.event, action.id);
    case "connection":
      return state.done ? state : { ...state, connected: action.connected };
    case "fatal":
      return state.done ? state : { ...state, connected: false, error: action.message };
  }
}

/** An error the stream should not retry (the run is gone, or we are not allowed to read it). */
class FatalStreamError extends Error {}

/**
 * Subscribes to /api/runs/:id/events and tracks live progress.
 *
 * The connection is opened with fetch-event-source (native EventSource can't send an Authorization
 * header) through the same `authedFetch` as every other call, so each (re)connect carries a fresh
 * token and benefits from the single-flight refresh. The library resends `Last-Event-ID` on retries
 * and the server resumes from that tick. The connection is aborted on a terminal event, on unmount,
 * and whenever `runId` changes.
 */
export function useRunStream(runId: string | null, onTerminal?: () => void): RunStreamState {
  const [state, dispatch] = useReducer(reducer, initialRunStreamState);
  const onTerminalRef = useRef(onTerminal);
  useEffect(() => {
    onTerminalRef.current = onTerminal;
  });

  useEffect(() => {
    dispatch({ type: "reset" });
    if (!runId) return;

    const controller = new AbortController();
    let terminal = false;
    let attempt = 0; // consecutive failed connection attempts, for backoff

    fetchEventSource(`/api/runs/${runId}/events`, {
      signal: controller.signal,
      openWhenHidden: true,
      fetch: (input, init) => authedFetch(String(input), init),
      async onopen(res) {
        if (res.ok && res.headers.get("content-type")?.startsWith("text/event-stream")) {
          dispatch({ type: "connection", connected: true });
          return;
        }
        if (res.status >= 400 && res.status < 500 && res.status !== 429) {
          throw new FatalStreamError(`Live updates unavailable (${res.status})`);
        }
        throw new Error(`Unexpected response (${res.status})`);
      },
      onmessage(message) {
        if (controller.signal.aborted) return;
        const event = parseRunEvent(message.data);
        if (!event) return; // ignore a malformed frame rather than crash the stream
        attempt = 0; // events are flowing again
        dispatch({ type: "event", event, id: Number(message.id) });
        if (isTerminalStage(event.stage) && !terminal) {
          terminal = true;
          controller.abort();
          onTerminalRef.current?.();
        }
      },
      onclose() {
        // A clean close is only expected after a terminal event. Anything earlier means the
        // connection dropped, so throw to make the library retry (resuming via Last-Event-ID).
        if (!terminal) throw new Error("Stream closed before the run finished");
      },
      onerror(err) {
        if (err instanceof FatalStreamError) throw err;
        dispatch({ type: "connection", connected: false });
        const delay = Math.min(1000 * 2 ** attempt, 10_000); // 1s, 2s, 4s ... capped at 10s
        attempt += 1;
        return delay;
      },
    }).catch((err: unknown) => {
      if (controller.signal.aborted) return;
      dispatch({ type: "fatal", message: err instanceof Error ? err.message : "Live updates stopped" });
    });

    return () => controller.abort();
  }, [runId]);

  return state;
}
