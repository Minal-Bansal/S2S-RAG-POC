import { useCallback, useRef, useState } from "react";
import { createRealtimeSession, searchPolicy } from "./toolHandlers";
import type { ConnectionStatus, TranscriptEntry } from "./types";

const REALTIME_BASE_URL = "https://api.openai.com/v1/realtime";

let entryCounter = 0;
function nextId(): string {
  entryCounter += 1;
  return `entry-${entryCounter}`;
}

export function useRealtimeSession() {
  const [status, setStatus] = useState<ConnectionStatus>("idle");
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const assistantDeltaBuffers = useRef<Map<string, string>>(new Map());

  const appendEntry = useCallback((role: TranscriptEntry["role"], text: string) => {
    setTranscript((prev) => [...prev, { id: nextId(), role, text }]);
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

      case "response.audio_transcript.delta": {
        const itemId = event.item_id ?? "current";
        const prevText = assistantDeltaBuffers.current.get(itemId) ?? "";
        assistantDeltaBuffers.current.set(itemId, prevText + (event.delta ?? ""));
        break;
      }

      case "response.audio_transcript.done": {
        const itemId = event.item_id ?? "current";
        const text = event.transcript ?? assistantDeltaBuffers.current.get(itemId) ?? "";
        if (text) appendEntry("assistant", text);
        assistantDeltaBuffers.current.delete(itemId);
        break;
      }

      case "response.function_call_arguments.done": {
        const { call_id, name, arguments: argsJson } = event;
        if (name !== "search_policy") break;

        let question = "";
        try {
          question = JSON.parse(argsJson)?.question ?? "";
        } catch {
          // fall through with empty question; backend will 400
        }

        appendEntry("tool", `search_policy("${question}")`);

        try {
          const result = await searchPolicy(question);
          appendEntry(
            "tool",
            result.sufficient
              ? `-> ${result.evidence.length} chunk(s), top match in "${result.evidence[0]?.section}"`
              : "-> no sufficient evidence found"
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
          dcRef.current?.send(JSON.stringify({ type: "response.create" }));
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          appendEntry("tool", `-> error: ${message}`);
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
          dcRef.current?.send(JSON.stringify({ type: "response.create" }));
        }
        break;
      }

      case "error": {
        setErrorMessage(event.error?.message ?? "Unknown realtime error");
        break;
      }

      default:
        break;
    }
  }, [appendEntry]);

  const connect = useCallback(async () => {
    setStatus("connecting");
    setErrorMessage(null);
    setTranscript([]);

    try {
      const { clientSecret } = await createRealtimeSession();
      const ephemeralKey: string = clientSecret?.value ?? clientSecret?.client_secret?.value;
      if (!ephemeralKey) {
        throw new Error("Backend did not return a usable ephemeral client secret.");
      }

      const pc = new RTCPeerConnection();
      pcRef.current = pc;

      const audioEl = document.createElement("audio");
      audioEl.autoplay = true;
      audioElRef.current = audioEl;
      pc.ontrack = (e) => {
        audioEl.srcObject = e.streams[0];
      };

      const micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      micStreamRef.current = micStream;
      micStream.getTracks().forEach((track) => pc.addTrack(track, micStream));

      const dc = pc.createDataChannel("oai-events");
      dcRef.current = dc;
      dc.addEventListener("message", (e) => handleDataChannelMessage(e.data));
      dc.addEventListener("open", () => {
        setStatus("connected");
        // Kick off the model's first turn so it speaks the scripted greeting.
        dc.send(JSON.stringify({ type: "response.create" }));
      });
      dc.addEventListener("close", () => setStatus("closed"));

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      const sdpResponse = await fetch(
        `${REALTIME_BASE_URL}?model=${encodeURIComponent(clientSecret?.session?.model ?? "gpt-realtime")}`,
        {
          method: "POST",
          body: offer.sdp,
          headers: {
            Authorization: `Bearer ${ephemeralKey}`,
            "Content-Type": "application/sdp",
          },
        }
      );

      if (!sdpResponse.ok) {
        throw new Error(`Realtime SDP exchange failed: ${sdpResponse.status} ${await sdpResponse.text()}`);
      }

      const answerSdp = await sdpResponse.text();
      await pc.setRemoteDescription({ type: "answer", sdp: answerSdp });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setErrorMessage(message);
      setStatus("error");
    }
  }, [handleDataChannelMessage]);

  const disconnect = useCallback(() => {
    dcRef.current?.close();
    pcRef.current?.close();
    micStreamRef.current?.getTracks().forEach((t) => t.stop());
    dcRef.current = null;
    pcRef.current = null;
    micStreamRef.current = null;
    setStatus("closed");
  }, []);

  return { status, transcript, errorMessage, connect, disconnect };
}
