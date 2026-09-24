import { useCallback, useRef, useState } from "react";
import { createRealtimeSession, searchPolicy } from "./toolHandlers";
import type { ConnectionStatus, TranscriptEntry } from "./types";

const MAX_CALL_DURATION_MS = 5 * 60 * 1000;
const CLOSING_LEAD_MS = 15 * 1000;
// Gap between the closing statement's text finishing (response.done) and its
// audio actually finishing playback through the <audio> element — tearing
// down the connection right at response.done cuts the tail of the audio off.
const CLOSING_AUDIO_GRACE_MS = 1800;
const WRAP_UP_INSTRUCTIONS =
  "The available session time has ended. Wrap up immediately — do not continue the explanation " +
  "or answer further questions. Give your closing statement now, exactly as defined in your " +
  "system instructions, and say nothing else.";

let entryCounter = 0;
function nextId(): string {
  entryCounter += 1;
  return `entry-${entryCounter}`;
}

export function useRealtimeSession() {
  const [status, setStatus] = useState<ConnectionStatus>("idle");
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const assistantDeltaBuffers = useRef<Map<string, string>>(new Map());
  const wrapUpTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hardStopTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const awaitingClosingRef = useRef(false);
  const closingReasonRef = useRef("Session ended after closing statement.");
  const responseActiveRef = useRef(false);
  const pendingResponseCreateRef = useRef<(() => void) | null>(null);

  const appendEntry = useCallback((role: TranscriptEntry["role"], text: string) => {
    setTranscript((prev) => [...prev, { id: nextId(), role, text }]);
  }, []);

  // Sends response.create immediately if no response is currently in progress,
  // otherwise defers it until the active response's "response.done" arrives.
  // Sending response.create while one is already active is rejected by the
  // Realtime API ("Conversation already has an active response in progress").
  const requestResponse = useCallback((payload?: Record<string, unknown>) => {
    const send = () => dcRef.current?.send(JSON.stringify({ type: "response.create", ...payload }));
    if (responseActiveRef.current) {
      pendingResponseCreateRef.current = send;
    } else {
      send();
    }
  }, []);

  const disconnect = useCallback((reason?: string) => {
    if (wrapUpTimeoutRef.current) {
      clearTimeout(wrapUpTimeoutRef.current);
      wrapUpTimeoutRef.current = null;
    }
    if (hardStopTimeoutRef.current) {
      clearTimeout(hardStopTimeoutRef.current);
      hardStopTimeoutRef.current = null;
    }
    awaitingClosingRef.current = false;
    responseActiveRef.current = false;
    pendingResponseCreateRef.current = null;
    dcRef.current?.close();
    pcRef.current?.close();
    micStreamRef.current?.getTracks().forEach((t) => t.stop());
    dcRef.current = null;
    pcRef.current = null;
    micStreamRef.current = null;
    setStatus("closed");
    setTranscript([]);
    if (reason) console.log(`[disconnect] ${reason}`);
  }, []);

  const handleDataChannelMessage = useCallback(async (raw: string) => {
    let event: any;
    try {
      event = JSON.parse(raw);
    } catch {
      return;
    }

    switch (event.type) {
      case "conversation.item.input_audio_transcription.completed": {
        if (event.transcript) appendEntry("user", event.transcript);
        break;
      }

      // GA Azure/OpenAI realtime schemas have used both "response.audio_transcript.*"
      // (beta-era naming) and "response.output_audio_transcript.*" (current GA naming)
      // for the assistant's spoken transcript — handle both defensively.
      case "response.audio_transcript.delta":
      case "response.output_audio_transcript.delta": {
        const itemId = event.item_id ?? "current";
        const prevText = assistantDeltaBuffers.current.get(itemId) ?? "";
        assistantDeltaBuffers.current.set(itemId, prevText + (event.delta ?? ""));
        break;
      }

      case "response.audio_transcript.done":
      case "response.output_audio_transcript.done": {
        const itemId = event.item_id ?? "current";
        const text = event.transcript ?? assistantDeltaBuffers.current.get(itemId) ?? "";
        if (text) appendEntry("assistant", text);
        assistantDeltaBuffers.current.delete(itemId);
        break;
      }

      case "response.function_call_arguments.done": {
        const { call_id, name, arguments: argsJson } = event;

        if (name === "end_call") {
          // The model is speaking its closing line in this same response —
          // wait for that response to actually finish before hanging up
          // (same mechanism as the 5-minute wrap-up flow).
          console.log("[end_call] requested by model");
          closingReasonRef.current = "Session ended — user requested end of call, closing statement given.";
          awaitingClosingRef.current = true;
          break;
        }

        if (name !== "search_policy") break;

        let question = "";
        let product: string | undefined;
        try {
          const parsed = JSON.parse(argsJson);
          question = parsed?.question ?? "";
          product = parsed?.product || undefined;
        } catch {
          // fall through with empty question; backend will 400
        }

        // Tool-call activity is internal plumbing, not part of the spoken
        // conversation — keep it out of the user-facing transcript, log for debugging only.
        console.log(`[search_policy] question: "${question}"${product ? ` (product: "${product}")` : ""}`);

        try {
          const result = await searchPolicy(question, product);
          console.log(
            `[search_policy] result:`,
            result.sufficient
              ? `${result.evidence.length} chunk(s), top match in "${result.evidence[0]?.document}" / "${result.evidence[0]?.section}"`
              : "no sufficient evidence found"
          );

          dcRef.current?.send(
            JSON.stringify({
              type: "conversation.item.create",
              item: {
                type: "function_call_output",
                call_id,
                output: JSON.stringify(result),
              },
            })
          );
          requestResponse();
        } catch (err) {
          console.error("[search_policy] error:", err);
          dcRef.current?.send(
            JSON.stringify({
              type: "conversation.item.create",
              item: {
                type: "function_call_output",
                call_id,
                output: JSON.stringify({ evidence: [], sufficient: false }),
              },
            })
          );
          requestResponse();
        }
        break;
      }

      case "response.created": {
        responseActiveRef.current = true;
        break;
      }

      case "response.done": {
        responseActiveRef.current = false;

        // Run any deferred response.create first (e.g. the closing statement,
        // queued behind a response that was still active/being cancelled).
        // Only check awaitingClosingRef once nothing is pending, so we don't
        // disconnect on the *cancelled* response's done event instead of the
        // actual closing statement's.
        const pending = pendingResponseCreateRef.current;
        if (pending) {
          pendingResponseCreateRef.current = null;
          pending();
          break;
        }

        if (awaitingClosingRef.current) {
          awaitingClosingRef.current = false;
          // Grace delay so the closing line's audio finishes playing before
          // the connection is torn down (see CLOSING_AUDIO_GRACE_MS above).
          setTimeout(() => disconnect(closingReasonRef.current), CLOSING_AUDIO_GRACE_MS);
        }
        break;
      }

      case "error": {
        // Realtime API errors (e.g. a rejected event) aren't meant for the end user —
        // log for debugging, don't surface raw technical text in the UI.
        console.error("[realtime error]", event.error);
        break;
      }

      default:
        break;
    }
  }, [appendEntry, disconnect, requestResponse]);

  const connect = useCallback(async () => {
    setStatus("connecting");
    setTranscript([]);

    try {
      const { clientSecret, realtimeCallUrl } = await createRealtimeSession();
      const ephemeralKey: string = clientSecret?.value ?? clientSecret?.client_secret?.value;
      if (!ephemeralKey) {
        throw new Error("Backend did not return a usable ephemeral client secret.");
      }
      if (!realtimeCallUrl) {
        throw new Error("Backend did not return a realtime call URL.");
      }

      const pc = new RTCPeerConnection();
      pcRef.current = pc;

      const audioEl = document.createElement("audio");
      audioEl.autoplay = true;
      audioElRef.current = audioEl;
      pc.ontrack = (e) => {
        audioEl.srcObject = e.streams[0];
      };

      // Explicit constraints (not just `audio: true`) so echo cancellation is
      // actually requested — without it, the assistant's own voice bleeding
      // back into the mic gets picked up as fake user speech.
      const micStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      micStreamRef.current = micStream;
      micStream.getTracks().forEach((track) => pc.addTrack(track, micStream));

      const dc = pc.createDataChannel("oai-events");
      dcRef.current = dc;
      dc.addEventListener("message", (e) => handleDataChannelMessage(e.data));
      dc.addEventListener("open", () => {
        setStatus("connected");
        // Kick off the model's first turn so it speaks the scripted greeting.
        requestResponse();

        // A bit before the hard limit, ask the model to speak its closing line
        // and wait for that response to finish (see "response.done" handling)
        // before actually disconnecting, so it isn't cut off mid-sentence.
        wrapUpTimeoutRef.current = setTimeout(() => {
          const sendClosing = () => {
            closingReasonRef.current = "Session ended automatically — 5 minute call limit reached, closing statement given.";
            awaitingClosingRef.current = true;
            dc.send(
              JSON.stringify({
                type: "response.create",
                response: { instructions: WRAP_UP_INSTRUCTIONS },
              })
            );
          };
          if (responseActiveRef.current) {
            // Wait for the in-progress response's own "response.done" before
            // asking for the closing statement, rather than racing a cancel
            // against an immediate response.create.
            dc.send(JSON.stringify({ type: "response.cancel" }));
            pendingResponseCreateRef.current = sendClosing;
          } else {
            sendClosing();
          }
        }, MAX_CALL_DURATION_MS - CLOSING_LEAD_MS);

        // Safety net in case the closing response never completes.
        hardStopTimeoutRef.current = setTimeout(
          () => disconnect("Session ended automatically — 5 minute call limit reached."),
          MAX_CALL_DURATION_MS
        );
      });
      dc.addEventListener("close", () => setStatus("closed"));

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      const sdpResponse = await fetch(realtimeCallUrl, {
        method: "POST",
        body: offer.sdp,
        headers: {
          Authorization: `Bearer ${ephemeralKey}`,
          "Content-Type": "application/sdp",
        },
      });

      if (!sdpResponse.ok) {
        throw new Error(`Realtime SDP exchange failed: ${sdpResponse.status} ${await sdpResponse.text()}`);
      }

      const answerSdp = await sdpResponse.text();
      await pc.setRemoteDescription({ type: "answer", sdp: answerSdp });
    } catch (err) {
      console.error("[connect] failed:", err);
      setStatus("error");
    }
  }, [handleDataChannelMessage, disconnect, requestResponse]);

  return { status, transcript, connect, disconnect };
}
