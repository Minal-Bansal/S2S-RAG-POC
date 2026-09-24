import { useCallback, useRef, useState } from "react";
import { createRealtimeSession, searchPolicy } from "./toolHandlers";
import type { ConnectionStatus, TranscriptEntry } from "./types";

const MAX_CALL_DURATION_MS = 5 * 60 * 1000;
// Runway before the unconditional hard stop, for: cancelling any in-progress
// response, generating the demanded closing line, speaking it in full (~8s
// for the English line), and the CLOSING_AUDIO_GRACE_MS playback grace below.
const CLOSING_LEAD_MS = 25 * 1000;
// Gap between the closing statement's transcript finishing (response.done)
// and its audio actually finishing playback through the <audio> element.
// response.done only means the server is done *generating* — it does not
// mean the client has finished *playing* the buffered audio for a full
// sentence (~8s for the English closing line). 1.8s was tuned for a small
// flush-the-tail-end delay and cut the goodbye off mid-sentence in practice;
// this needs to cover the full spoken length of the closing line, not just
// a buffer flush. A few extra seconds of "still connected" after a goodbye
// is harmless; a truncated goodbye is not.
const CLOSING_AUDIO_GRACE_MS = 6000;
// Fallback for the end_call path only: if the model calls "end_call" but the
// content-based detection below never sees matching closing text (e.g. it
// paraphrased, or the tool call landed in a response with little/no audio in
// it), force the call to end anyway rather than leaving it open indefinitely.
// This is deliberately NOT tied to that response's "response.done" — a
// function-call-only response can complete almost instantly, and disconnecting
// off of *that* is exactly what caused the goodbye to sometimes never be
// spoken at all. A plain wall-clock timer gives the real closing line, if one
// is still coming, a generous window to actually arrive and be detected first.
const CLOSING_WATCHDOG_MS = 10000;
const WRAP_UP_INSTRUCTIONS =
  "The available session time has ended. Wrap up immediately — do not continue the explanation " +
  "or answer further questions. Give your closing statement now, exactly as defined in your " +
  "system instructions, and say nothing else.";

// Short, distinctive tail phrases from the (English / Hindi) closing lines in
// backend/src/prompt.ts. Detecting the closing from what was actually SAID,
// rather than from whether the model happened to call the "end_call" tool in
// the same generation turn as the audio, is the reliable signal — tool-call
// and audio-content timing/bundling within a single response turned out not
// to be something we could depend on. These phrases are specific enough that
// they won't appear in normal policy explanations.
const CLOSING_SIGNATURE_EN = "take care";
const CLOSING_SIGNATURE_HI = "ख्याल रखिए";

function looksLikeClosing(text: string): boolean {
  const normalized = text.toLowerCase();
  return normalized.includes(CLOSING_SIGNATURE_EN) || normalized.includes(CLOSING_SIGNATURE_HI);
}

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
  const assistantEntryIds = useRef<Map<string, string>>(new Map());
  const userDeltaBuffers = useRef<Map<string, string>>(new Map());
  const userEntryIds = useRef<Map<string, string>>(new Map());
  // A user turn's bubble is reserved the instant VAD detects speech starting
  // (before any item_id exists for it), so its array position is locked in
  // ahead of whatever the assistant does next. Once a real item_id shows up
  // (via conversation.item.created or the first transcription event for that
  // turn), it gets linked to this pre-reserved id instead of creating a new one.
  const pendingUserEntryIdRef = useRef<string | null>(null);
  const wrapUpTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hardStopTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closingWatchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Guards against scheduling the disconnect twice — content-based detection
  // (on the transcript) and the end_call watchdog fallback both funnel
  // through here, and whichever notices first should win.
  const closingHandledRef = useRef(false);
  const responseActiveRef = useRef(false);
  const pendingResponseCreateRef = useRef<(() => void) | null>(null);

  // Live-update a single bubble as speech streams in (one bubble per item_id),
  // instead of only adding it once the whole utterance is done — otherwise the
  // transcript looks frozen and then dumps a whole paragraph in at once.
  const upsertEntry = useCallback(
    (role: TranscriptEntry["role"], idMap: Map<string, string>, itemId: string, text: string) => {
      // Resolve/create the id and write it to idMap *before* calling setTranscript,
      // not inside the updater — React (StrictMode in particular) can invoke a
      // state updater twice, and mutating idMap inside it made the second call
      // see an id whose entry the first call's result never actually got committed,
      // silently dropping the update.
      let id = idMap.get(itemId);
      const isNew = !id;
      if (!id) {
        id = nextId();
        idMap.set(itemId, id);
      }
      const entryId = id;
      setTranscript((prev) =>
        isNew ? [...prev, { id: entryId, role, text }] : prev.map((e) => (e.id === entryId ? { ...e, text } : e))
      );
    },
    []
  );

  // Reserve a user bubble's array position immediately, before any item_id
  // exists for it yet (see pendingUserEntryIdRef above).
  const reservePendingUserEntry = useCallback(() => {
    if (pendingUserEntryIdRef.current) return; // already one pending, don't stack another
    const id = nextId();
    pendingUserEntryIdRef.current = id;
    setTranscript((prev) => [...prev, { id, role: "user", text: "" }]);
  }, []);

  // The first time a real item_id shows up for a user turn (whichever event
  // gets there first — conversation.item.created or a transcription event),
  // link it to the pre-reserved bubble instead of letting upsertEntry create
  // a brand new one further down the array.
  const linkPendingUserEntry = useCallback((itemId: string) => {
    if (pendingUserEntryIdRef.current && !userEntryIds.current.has(itemId)) {
      userEntryIds.current.set(itemId, pendingUserEntryIdRef.current);
    }
    pendingUserEntryIdRef.current = null;
  }, []);

  // Once we've decided the call is ending, the assistant's own closing-line
  // audio can echo back into the mic and get misread by server-side VAD as
  // the user interrupting — which auto-cancels the response mid-sentence and
  // truncates the goodbye. Turn off server VAD for this final turn so nothing
  // can self-interrupt it; we're hanging up right after anyway, so there's no
  // barge-in to preserve.
  const disableInterruptionsForClosing = useCallback(() => {
    dcRef.current?.send(
      JSON.stringify({
        type: "session.update",
        session: { audio: { input: { turn_detection: null } } },
      })
    );
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
    if (closingWatchdogRef.current) {
      clearTimeout(closingWatchdogRef.current);
      closingWatchdogRef.current = null;
    }
    closingHandledRef.current = false;
    responseActiveRef.current = false;
    pendingResponseCreateRef.current = null;
    assistantDeltaBuffers.current.clear();
    assistantEntryIds.current.clear();
    userDeltaBuffers.current.clear();
    userEntryIds.current.clear();
    pendingUserEntryIdRef.current = null;
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
      // The earliest possible signal that a user turn has begun — fires the
      // instant server-side VAD detects speech, before any item_id exists for
      // it, and necessarily before any response to that turn could start.
      // Reserve its bubble's array position right here so it can never end up
      // ordered after the assistant's next reply, regardless of how late the
      // actual item_id / transcription text for this turn shows up.
      case "input_audio_buffer.speech_started": {
        reservePendingUserEntry();
        break;
      }

      // Fires when a conversation item is created. For assistant turns this
      // is the ordering anchor (there's no earlier signal available for them);
      // for user turns it's a second chance to link up the item_id in case a
      // transcription event doesn't arrive first.
      case "conversation.item.created": {
        const item = event.item;
        if (item?.type === "message" && item.id && (item.role === "user" || item.role === "assistant")) {
          if (item.role === "user") {
            linkPendingUserEntry(item.id);
            if (!userEntryIds.current.has(item.id)) upsertEntry("user", userEntryIds.current, item.id, "");
          } else if (!assistantEntryIds.current.has(item.id)) {
            upsertEntry("assistant", assistantEntryIds.current, item.id, "");
          }
        }
        break;
      }

      // Streamed word-by-word as the user talks (when the API sends it) — keep
      // one bubble updating live instead of waiting for ".completed".
      case "conversation.item.input_audio_transcription.delta": {
        const itemId = event.item_id ?? "current";
        linkPendingUserEntry(itemId);
        const prevText = userDeltaBuffers.current.get(itemId) ?? "";
        const text = prevText + (event.delta ?? "");
        userDeltaBuffers.current.set(itemId, text);
        upsertEntry("user", userEntryIds.current, itemId, text);
        break;
      }

      case "conversation.item.input_audio_transcription.completed": {
        const itemId = event.item_id ?? "current";
        linkPendingUserEntry(itemId);
        const text = event.transcript ?? userDeltaBuffers.current.get(itemId) ?? "";
        if (text) upsertEntry("user", userEntryIds.current, itemId, text);
        userDeltaBuffers.current.delete(itemId);
        userEntryIds.current.delete(itemId);
        break;
      }

      // GA Azure/OpenAI realtime schemas have used both "response.audio_transcript.*"
      // (beta-era naming) and "response.output_audio_transcript.*" (current GA naming)
      // for the assistant's spoken transcript — handle both defensively. Update the
      // bubble live on every delta so the transcript flows as it's spoken, rather
      // than dumping the whole line in at once when the utterance finishes.
      case "response.audio_transcript.delta":
      case "response.output_audio_transcript.delta": {
        const itemId = event.item_id ?? "current";
        const prevText = assistantDeltaBuffers.current.get(itemId) ?? "";
        const text = prevText + (event.delta ?? "");
        assistantDeltaBuffers.current.set(itemId, text);
        upsertEntry("assistant", assistantEntryIds.current, itemId, text);
        // The moment the closing line is recognizably starting, stop server
        // VAD from possibly self-interrupting on the assistant's own echoed
        // voice partway through it — don't wait for the "done" event or for
        // an "end_call" tool call that may not arrive in this same turn.
        if (!closingHandledRef.current && looksLikeClosing(text)) {
          disableInterruptionsForClosing();
        }
        break;
      }

      case "response.audio_transcript.done":
      case "response.output_audio_transcript.done": {
        const itemId = event.item_id ?? "current";
        const text = event.transcript ?? assistantDeltaBuffers.current.get(itemId) ?? "";
        if (text) upsertEntry("assistant", assistantEntryIds.current, itemId, text);
        assistantDeltaBuffers.current.delete(itemId);
        assistantEntryIds.current.delete(itemId);

        // Authoritative "the closing has actually been spoken" signal — based
        // on what was actually said, not on whether/when the model called the
        // "end_call" tool. This is what actually ends the call in practice;
        // the end_call-tool path below is now just a fallback in case the
        // model paraphrases the closing enough that this text match misses it.
        if (!closingHandledRef.current && text && looksLikeClosing(text)) {
          closingHandledRef.current = true;
          console.log("[closing] detected from spoken content — disconnecting after grace period");
          disableInterruptionsForClosing();
          setTimeout(
            () => disconnect("Session ended — closing statement detected in transcript."),
            CLOSING_AUDIO_GRACE_MS
          );
        }
        break;
      }

      case "response.function_call_arguments.done": {
        const { call_id, name, arguments: argsJson } = event;

        if (name === "end_call") {
          console.log("[end_call] requested by model");
          disableInterruptionsForClosing();
          // The content-based detection above is what normally ends the call
          // (as soon as the actual closing text is seen). This watchdog is
          // only a backstop in case that never fires — e.g. the model
          // paraphrased the closing, or this tool call landed in a response
          // with no audio of its own — so the call doesn't hang open forever.
          if (closingWatchdogRef.current) clearTimeout(closingWatchdogRef.current);
          closingWatchdogRef.current = setTimeout(() => {
            if (closingHandledRef.current) return;
            closingHandledRef.current = true;
            console.log("[closing] end_call fired but no matching closing text seen in time — disconnecting anyway");
            disconnect("Session ended — end_call requested, closing statement not confirmed in time.");
          }, CLOSING_WATCHDOG_MS);
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

        // Run any deferred response.create (e.g. the closing statement demanded
        // by the 5-minute wrap-up, queued behind a response that was still
        // active/being cancelled). Ending the call itself is handled entirely
        // by the content-based detection above (plus the end_call watchdog and
        // the hard 5-minute stop below) — not by this event.
        const pending = pendingResponseCreateRef.current;
        if (pending) {
          pendingResponseCreateRef.current = null;
          pending();
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
  }, [upsertEntry, reservePendingUserEntry, linkPendingUserEntry, disconnect, requestResponse, disableInterruptionsForClosing]);

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

        // A bit before the hard limit, ask the model to speak its closing line.
        // The content-based detection in handleDataChannelMessage takes it from
        // there (it'll see the closing text and disconnect after a grace period);
        // hardStopTimeoutRef below is the unconditional backstop if that never happens.
        wrapUpTimeoutRef.current = setTimeout(() => {
          const sendClosing = () => {
            disableInterruptionsForClosing();
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
  }, [handleDataChannelMessage, disconnect, requestResponse, disableInterruptionsForClosing]);

  return { status, transcript, connect, disconnect };
}
